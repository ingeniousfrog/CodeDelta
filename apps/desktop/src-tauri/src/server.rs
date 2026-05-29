use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager};

static SERVER_CHILD: Mutex<Option<Child>> = Mutex::new(None);

const API_PORT: u16 = 3847;

pub fn api_base_url() -> String {
    format!("http://127.0.0.1:{API_PORT}")
}

fn health_ok() -> bool {
    let output = Command::new("curl")
        .args([
            "-sf",
            &format!("{}/api/health", api_base_url()),
        ])
        .output();
    matches!(output, Ok(o) if o.status.success())
}

fn cache_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not resolve home directory")?;
    Ok(home.join("Library/Application Support/CodeDelta"))
}

fn resolve_runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let resource = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?;
    let staged = resource.join("runtime");
    if staged.join("node/bin/node").exists() {
        return Ok(staged);
    }

    #[cfg(debug_assertions)]
    {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let dev_staged = manifest.join("resources/runtime");
        if dev_staged.join("node/bin/node").exists() {
            return Ok(dev_staged);
        }
    }

    Err(
        "Bundled runtime not found. Run `npm run stage:desktop` from the repo root, then rebuild."
            .into(),
    )
}

fn spawn_bundled(app: &AppHandle) -> Result<Child, String> {
    let runtime = resolve_runtime_dir(app)?;
    let node = runtime.join("node/bin/node");
    let server_js = runtime
        .join("app/node_modules/@codedelta/server/dist/index.js");
    if !server_js.exists() {
        return Err(format!("Server entry missing: {}", server_js.display()));
    }

    let web_dist = runtime.join("web-dist");
    let app_root = runtime.join("app");
    let cache = cache_dir()?;
    std::fs::create_dir_all(&cache).map_err(|e| e.to_string())?;

    let mut cmd = Command::new(&node);
    cmd.arg(&server_js)
        .current_dir(&app_root)
        .env("CODEDELTA_PORT", API_PORT.to_string())
        .env("CODEDELTA_STATIC_DIR", &web_dist)
        .env("CODEDELTA_MONOREPO_ROOT", &app_root)
        .env("CODEDELTA_CACHE_DIR", &cache)
        .env("CODEDELTA_DESKTOP", "1")
        .env("NODE_ENV", "production")
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    cmd.spawn().map_err(|e| format!("Failed to spawn API: {e}"))
}

fn wait_for_health(timeout: Duration) -> bool {
    let start = std::time::Instant::now();
    while start.elapsed() < timeout {
        if health_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    false
}

pub fn start(app: &AppHandle) -> Result<(), String> {
    if health_ok() {
        return Ok(());
    }

    if cfg!(debug_assertions) {
        if wait_for_health(Duration::from_secs(90)) {
            return Ok(());
        }
        return Err(
            "CodeDelta API is not running on port 3847. Start it with `npm run dev:codedelta` or use `npm run dev:desktop` from the repo root.".into(),
        );
    }

    let mut child = spawn_bundled(app)?;
    if wait_for_health(Duration::from_secs(45)) {
        let mut guard = SERVER_CHILD.lock().map_err(|e| e.to_string())?;
        *guard = Some(child);
        return Ok(());
    }
    let _ = child.kill();
    Err("CodeDelta API failed to start within 45 seconds.".into())
}

pub fn stop(_app: &AppHandle) {
    if let Ok(mut guard) = SERVER_CHILD.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
        }
    }
}

pub fn port_in_use_hint() -> Option<String> {
    let output = Command::new("lsof")
        .args(["-i", &format!(":{API_PORT}")])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    if text.trim().is_empty() {
        return None;
    }
    Some(format!(
        "Port {API_PORT} is already in use. Quit the other CodeDelta or dev server and try again.\n{text}"
    ))
}
