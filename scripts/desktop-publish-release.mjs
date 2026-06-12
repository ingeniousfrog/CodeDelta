#!/usr/bin/env node
/**
 * Upload desktop installer assets to GitHub Releases under codedelta-desktop-v*.
 * Usage: node scripts/desktop-publish-release.mjs <macos|windows> <asset-path> [...]
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const TAURI_CONF = path.join(REPO_ROOT, 'apps/desktop/src-tauri/tauri.conf.json');

const platform = process.argv[2];
const assets = process.argv.slice(3);

if (!platform || !['macos', 'windows'].includes(platform) || assets.length === 0) {
  console.error('Usage: node scripts/desktop-publish-release.mjs <macos|windows> <asset> [...]');
  process.exit(1);
}

for (const asset of assets) {
  if (!fs.existsSync(asset)) {
    console.error(`Asset not found: ${asset}`);
    process.exit(1);
  }
}

const version = JSON.parse(fs.readFileSync(TAURI_CONF, 'utf8')).version;
const tag = `codedelta-desktop-v${version}`;
const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
  cwd: REPO_ROOT,
  encoding: 'utf8',
}).trim();

function releaseNotes() {
  return [
    `CodeDelta Desktop v${version}`,
    '',
    'Bundled: web UI (Delta, Trace, Panorama, Wiki), API server, CodeGraph runtime, and Node 22 — no separate Node install required.',
    '',
    '**Downloads**',
    '- **macOS** (Apple Silicon arm64): `CodeDelta_*_aarch64.dmg` — unsigned; if blocked, right-click → Open',
    '- **Windows** (x64): `CodeDelta_*_x64-setup.exe` — NSIS installer',
    '',
    `- Built from commit \`${sha}\``,
    '- Requires **git** on `PATH`',
    '- macOS runtime data: `~/Library/Application Support/CodeDelta`',
    '- Windows runtime data: `%APPDATA%\\CodeDelta`',
    '',
    'Bump `apps/desktop/src-tauri/tauri.conf.json` `version` for a new release tag.',
  ].join('\n');
}

function gh(args) {
  execFileSync('gh', args, { cwd: REPO_ROOT, stdio: 'inherit' });
}

const exists = (() => {
  try {
    execFileSync('gh', ['release', 'view', tag], { cwd: REPO_ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

if (exists) {
  gh(['release', 'upload', tag, ...assets, '--clobber']);
  gh(['release', 'edit', tag, '--title', `CodeDelta Desktop v${version}`, '--notes', releaseNotes()]);
} else {
  gh([
    'release',
    'create',
    tag,
    ...assets,
    '--title',
    `CodeDelta Desktop v${version}`,
    '--notes',
    releaseNotes(),
  ]);
}

console.log(`[desktop-publish] Published ${assets.join(', ')} to ${tag}`);
