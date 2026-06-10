#!/usr/bin/env node
/**
 * Assemble bundled Node runtime + CodeDelta server deps for desktop (Tauri).
 * Run on the target OS (macOS or Windows) so native modules match the platform.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync, spawnSync } from 'child_process';
import https from 'https';
import { createWriteStream } from 'fs';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const RUNTIME_ROOT = path.join(REPO_ROOT, 'apps/desktop/src-tauri/resources/runtime');
const APP_ROOT = path.join(RUNTIME_ROOT, 'app');
const WEB_DIST = path.join(RUNTIME_ROOT, 'web-dist');
const NODE_ROOT = path.join(RUNTIME_ROOT, 'node');

// CodeGraph requires node:sqlite (Node.js 22.5+). Keep in sync with scripts/build-bundle.sh LTS line.
const NODE_VERSION = process.env.CODEDELTA_NODE_VERSION ?? '22.19.0';
const CODEDELTA_PACKAGES = [
  'codedelta-types',
  'codedelta-repo-manager',
  'codedelta-graph-diff',
  'codedelta-graph-subgraph',
  'codedelta-impact-score',
  'codedelta-delta-summary',
  'codedelta-provider-runtime',
  'codedelta-trace-engine',
  'codedelta-snapshot-manager',
  'codedelta-server',
];

function log(msg) {
  console.log(`[desktop-stage] ${msg}`);
}

function run(cmd, args, opts = {}) {
  log(`${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: REPO_ROOT, shell: process.platform === 'win32', ...opts });
  if (r.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(' ')}`);
  }
}

function rmrf(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function resolveArch() {
  const target = process.env.TARGETARCH ?? process.arch;
  if (target === 'arm64') return 'arm64';
  if (target === 'x64' || target === 'amd64' || target === 'x86_64') return 'x64';
  throw new Error(`Unsupported arch for desktop staging: ${target}`);
}

function nodeLayout() {
  if (process.platform === 'win32') {
    return {
      nodeBin: path.join(NODE_ROOT, 'node.exe'),
      npmCli: path.join(NODE_ROOT, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      pathDir: NODE_ROOT,
    };
  }
  return {
    nodeBin: path.join(NODE_ROOT, 'bin', 'node'),
    npmCli: path.join(NODE_ROOT, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    pathDir: path.join(NODE_ROOT, 'bin'),
  };
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          file.close();
          fs.unlinkSync(dest);
          download(res.headers.location, dest).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => {
          file.close(resolve);
        });
      })
      .on('error', reject);
  });
}

async function ensureNodeBinary() {
  const arch = resolveArch();
  const { nodeBin } = nodeLayout();
  const versionStamp = path.join(NODE_ROOT, '.node-version');
  const stamped =
    fs.existsSync(versionStamp) && fs.readFileSync(versionStamp, 'utf8').trim() === NODE_VERSION;
  if (fs.existsSync(nodeBin) && stamped) {
    log(`Reusing embedded Node ${NODE_VERSION} at ${nodeBin}`);
    return nodeBin;
  }
  if (fs.existsSync(nodeBin)) {
    log(`Embedded Node version changed — re-downloading ${NODE_VERSION}`);
  }
  rmrf(NODE_ROOT);
  fs.mkdirSync(RUNTIME_ROOT, { recursive: true });

  if (process.platform === 'darwin') {
    const base = `node-v${NODE_VERSION}-darwin-${arch}`;
    const tarName = `${base}.tar.gz`;
    const url = `https://nodejs.org/dist/v${NODE_VERSION}/${tarName}`;
    const tmpTar = path.join(RUNTIME_ROOT, tarName);
    log(`Downloading ${url}`);
    await download(url, tmpTar);
    run('tar', ['-xzf', tarName], { cwd: RUNTIME_ROOT });
    fs.renameSync(path.join(RUNTIME_ROOT, base), NODE_ROOT);
    fs.unlinkSync(tmpTar);
  } else if (process.platform === 'win32') {
    const base = `node-v${NODE_VERSION}-win-${arch}`;
    const zipName = `${base}.zip`;
    const url = `https://nodejs.org/dist/v${NODE_VERSION}/${zipName}`;
    const tmpZip = path.join(RUNTIME_ROOT, zipName);
    const extractDir = path.join(RUNTIME_ROOT, '_node_extract');
    log(`Downloading ${url}`);
    await download(url, tmpZip);
    rmrf(extractDir);
    fs.mkdirSync(extractDir, { recursive: true });
    run('powershell', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath '${tmpZip.replace(/'/g, "''")}' -DestinationPath '${extractDir.replace(/'/g, "''")}' -Force`,
    ]);
    fs.renameSync(path.join(extractDir, base), NODE_ROOT);
    rmrf(extractDir);
    fs.unlinkSync(tmpZip);
  } else {
    throw new Error(`desktop-stage unsupported platform: ${process.platform}`);
  }

  if (!fs.existsSync(nodeBin)) {
    throw new Error(`Node binary missing after extract: ${nodeBin}`);
  }
  fs.writeFileSync(versionStamp, `${NODE_VERSION}\n`);
  return nodeBin;
}

function copyMonorepoRootDist() {
  const distSrc = path.join(REPO_ROOT, 'dist');
  const distDest = path.join(APP_ROOT, 'dist');
  if (!fs.existsSync(distSrc)) {
    throw new Error('CodeGraph dist/ missing — run npm run build first');
  }
  rmrf(distDest);
  copyDir(distSrc, distDest);
}

function copyPackages() {
  const packagesDest = path.join(APP_ROOT, 'packages');
  rmrf(packagesDest);
  fs.mkdirSync(packagesDest, { recursive: true });
  for (const pkg of CODEDELTA_PACKAGES) {
    const src = path.join(REPO_ROOT, 'packages', pkg);
    const dest = path.join(packagesDest, pkg);
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(path.join(src, 'package.json'), path.join(dest, 'package.json'));
    const dist = path.join(src, 'dist');
    if (!fs.existsSync(dist)) {
      throw new Error(`Missing dist for ${pkg} — run npm run build:codedelta`);
    }
    copyDir(dist, path.join(dest, 'dist'));
  }
  const snapPkgPath = path.join(packagesDest, 'codedelta-snapshot-manager', 'package.json');
  const snapPkg = JSON.parse(fs.readFileSync(snapPkgPath, 'utf8'));
  delete snapPkg.dependencies['@codedelta/monorepo'];
  fs.writeFileSync(snapPkgPath, JSON.stringify(snapPkg, null, 2) + '\n');
}

function writeRuntimePackageJson() {
  const rootPkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const deps = { ...(rootPkg.dependencies ?? {}) };
  for (const pkg of CODEDELTA_PACKAGES) {
    const name = `@codedelta/${pkg.replace('codedelta-', '')}`;
    deps[name] = `file:./packages/${pkg}`;
  }
  const runtimePkg = {
    name: '@codedelta/monorepo',
    version: rootPkg.version ?? '0.1.0',
    private: true,
    description: 'CodeDelta desktop bundled runtime',
    main: 'dist/index.js',
    dependencies: deps,
  };
  fs.writeFileSync(path.join(APP_ROOT, 'package.json'), JSON.stringify(runtimePkg, null, 2) + '\n');
}

function copyWebDist() {
  const src = path.join(REPO_ROOT, 'apps/web/dist');
  if (!fs.existsSync(path.join(src, 'index.html'))) {
    throw new Error('apps/web/dist missing — run npm run build -w @codedelta/web');
  }
  rmrf(WEB_DIST);
  copyDir(src, WEB_DIST);
}

function npmInstallProduction(nodeBin) {
  log('Installing production dependencies in staged runtime…');
  const { npmCli, pathDir } = nodeLayout();
  const pathSep = process.platform === 'win32' ? ';' : ':';
  const args = ['install', '--omit=dev', '--install-links', '--no-audit', '--no-fund'];
  const r = spawnSync(nodeBin, [npmCli, ...args], {
    cwd: APP_ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      PATH: `${pathDir}${pathSep}${process.env.PATH ?? ''}`,
    },
  });
  if (r.status !== 0) {
    throw new Error('npm install failed in staged runtime');
  }
  verifyPhysicalWorkspaceDeps();
}

function verifyPhysicalWorkspaceDeps() {
  const serverPkg = path.join(APP_ROOT, 'node_modules/@codedelta/server');
  if (!fs.existsSync(serverPkg)) {
    throw new Error('Missing @codedelta/server after staging npm install');
  }
  if (fs.lstatSync(serverPkg).isSymbolicLink()) {
    throw new Error(
      '@codedelta/server is still a symlink; bundled apps need `npm install --install-links`',
    );
  }
  log('Verified physical @codedelta/* packages in node_modules');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(port) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return true;
    } catch {
      // retry
    }
    await delay(300);
  }
  return false;
}

async function smokeTest(nodeBin) {
  log('Smoke test: node:sqlite + CodeGraph load + health endpoint');
  const sqliteCheck = spawnSync(
    nodeBin,
    ['-e', "const { DatabaseSync } = require('node:sqlite'); new DatabaseSync(':memory:').close()"],
    { cwd: APP_ROOT, stdio: 'inherit' },
  );
  if (sqliteCheck.status !== 0) {
    throw new Error(
      'Embedded Node lacks node:sqlite (need Node 22.5+). Bump CODEDELTA_NODE_VERSION in desktop-stage.mjs',
    );
  }

  const cgCheck = spawnSync(
    nodeBin,
    ['-e', "const m=require('./dist/index.js'); if(!m.default&&!m.CodeGraph) process.exit(1)"],
    { cwd: APP_ROOT, stdio: 'inherit' },
  );
  if (cgCheck.status !== 0) {
    throw new Error('CodeGraph dist failed to load in staged runtime');
  }

  const serverEntry = path.join(
    APP_ROOT,
    'node_modules',
    '@codedelta',
    'server',
    'dist',
    'index.js',
  );
  if (!fs.existsSync(serverEntry)) {
    throw new Error(`Server entry not found: ${serverEntry}`);
  }

  const port = 13847;
  const cacheDir = path.join(REPO_ROOT, '.codedelta-desktop-smoke');
  rmrf(cacheDir);

  const child = spawn(nodeBin, [serverEntry], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      CODEDELTA_PORT: String(port),
      CODEDELTA_STATIC_DIR: WEB_DIST,
      CODEDELTA_MONOREPO_ROOT: APP_ROOT,
      CODEDELTA_CACHE_DIR: cacheDir,
      CODEDELTA_DESKTOP: '1',
    },
    stdio: 'ignore',
  });

  try {
    const ok = await waitForHealth(port);
    if (!ok) throw new Error('Health check timed out');
    log('Smoke test passed');
  } finally {
    child.kill();
    rmrf(cacheDir);
  }
}

async function buildPackages() {
  log('Building CodeGraph core…');
  run('npm', ['run', 'build']);
  log('Building CodeDelta packages…');
  run('npm', ['run', 'build', '-w', '@codedelta/types']);
  for (const pkg of CODEDELTA_PACKAGES) {
    run('npm', ['run', 'build', '-w', `@codedelta/${pkg.replace('codedelta-', '')}`]);
  }
  run('npm', ['run', 'build', '-w', '@codedelta/web']);
}

async function main() {
  log(`Staging desktop runtime for ${process.platform} (${resolveArch()})`);
  await buildPackages();

  log('Preparing runtime directories…');
  fs.mkdirSync(RUNTIME_ROOT, { recursive: true });
  rmrf(APP_ROOT);
  fs.mkdirSync(APP_ROOT, { recursive: true });

  copyMonorepoRootDist();
  copyPackages();
  writeRuntimePackageJson();
  copyWebDist();

  const nodeBin = await ensureNodeBinary();
  npmInstallProduction(nodeBin);
  await smokeTest(nodeBin);

  const sizeMb = Math.round(walkSize(RUNTIME_ROOT) / (1024 * 1024));
  log(`Staged runtime at ${RUNTIME_ROOT} (~${sizeMb} MB)`);
}

function walkSize(dir) {
  let total = 0;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) total += walkSize(p);
    else total += fs.statSync(p).size;
  }
  return total;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
