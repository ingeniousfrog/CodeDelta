mod server;

use tauri::{Manager, RunEvent, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            if let Some(hint) = server::port_in_use_hint() {
                eprintln!("{hint}");
            }
            server::start(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                server::stop(window.app_handle());
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build CodeDelta desktop")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                server::stop(app);
            }
        });
}
