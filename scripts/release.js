#!/usr/bin/env node
'use strict';
// Builds every download for a release into dist/release/:
//   CAELIX-<v>-mac-arm64.dmg   Apple Silicon Macs
//   CAELIX-<v>-mac-x64.dmg     Intel Macs
//   CAELIX-<v>-win-x64-Setup.exe   Windows installer (needs makensis)   and   CAELIX-<v>-win-x64-portable.zip
//   SHA256SUMS.txt
// Usage: node scripts/release.js --mac-x64-zip <electron-darwin-x64.zip> --win-x64-zip <electron-win32-x64.zip> [--only mac-arm64,mac-x64,win]
// The runtimes are the official Electron downloads; this script never compiles anything.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const only = (arg('--only') || 'mac-arm64,mac-x64,win').split(',');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')); const V = pkg.version;
const OUT = path.join(ROOT, 'dist', 'release'); fs.mkdirSync(OUT, { recursive: true });
const sh = (cmd, args, o) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26, ...o }).toString();
const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), 'caelix-' + n + '-'));
const log = (m) => console.log('[release] ' + m);

function appCode(dest) { // the same files for every platform
  fs.mkdirSync(dest, { recursive: true });
  for (const f of ['boot.js', 'main.js', 'preload.js']) fs.copyFileSync(path.join(ROOT, f), path.join(dest, f));
  const p = JSON.parse(JSON.stringify(pkg)); delete p.devDependencies; delete p.scripts; fs.writeFileSync(path.join(dest, 'package.json'), JSON.stringify(p, null, 2));
  for (const d of ['src', 'renderer', 'bin']) sh('cp', ['-R', path.join(ROOT, d), path.join(dest, d)]);
  fs.mkdirSync(path.join(dest, 'assets', 'icons'), { recursive: true });
  for (const f of fs.readdirSync(path.join(ROOT, 'assets', 'icons'))) { const s = path.join(ROOT, 'assets', 'icons', f); if (fs.statSync(s).isFile()) fs.copyFileSync(s, path.join(dest, 'assets', 'icons', f)); }
  const sha = sh('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).trim(); const ct = sh('git', ['show', '-s', '--format=%cI', 'HEAD'], { cwd: ROOT }).trim();
  fs.writeFileSync(path.join(dest, 'build-info.json'), JSON.stringify({ sha, commitTime: ct, builtAt: new Date().toISOString() }, null, 2));
  return sha;
}

function mac(archName, electronApp) {
  const stage = tmp('mac-' + archName); const app = path.join(stage, 'CAELIX.app');
  const a = ['scripts/package.js', '--out', app]; if (electronApp) a.push('--electron-app', electronApp);
  sh(process.execPath, a, { cwd: ROOT });
  fs.symlinkSync('/Applications', path.join(stage, 'Applications'));
  fs.writeFileSync(path.join(stage, 'READ ME FIRST.txt'), 'Drag CAELIX onto Applications.\n\nThe first time you open it, macOS may say it cannot verify the developer (the app is not notarized by Apple).\nRight-click CAELIX in Applications, choose Open, then Open again.\nIf macOS says the app is "damaged", run this once in Terminal and open it again:\n\n  xattr -cr /Applications/CAELIX.app\n\nAfter that, use the arrows button in the top bar to update CAELIX without downloading it again.\n');
  const dmg = path.join(OUT, `CAELIX-${V}-mac-${archName}.dmg`); fs.rmSync(dmg, { force: true });
  sh('hdiutil', ['create', '-volname', 'CAELIX', '-srcfolder', stage, '-fs', 'HFS+', '-format', 'UDZO', '-imagekey', 'zlib-level=9', '-ov', dmg]);
  fs.rmSync(stage, { recursive: true, force: true }); log('built ' + dmg); return dmg;
}

function win(zip) {
  const stage = tmp('win'); const dir = path.join(stage, 'CAELIX'); fs.mkdirSync(dir);
  sh('unzip', ['-q', zip, '-d', dir]);
  fs.renameSync(path.join(dir, 'electron.exe'), path.join(dir, 'CAELIX.exe'));
  fs.rmSync(path.join(dir, 'resources', 'default_app.asar'), { force: true });
  appCode(path.join(dir, 'resources', 'app'));
  const icon = path.join(ROOT, 'assets', 'icons', 'icon.ico');
  if (fs.existsSync(icon)) { try { sh(process.execPath, [path.join(__dirname, 'set-exe-icon.js'), path.join(dir, 'CAELIX.exe'), icon, V], { cwd: ROOT, env: { ...process.env, NODE_PATH: process.env.NODE_PATH || path.join(ROOT, 'dist', 'release-tools', 'node_modules') } }); log('set exe icon and name'); } catch (e) { log('exe icon NOT set (install resedit and set NODE_PATH): ' + String(e.stderr || e.message).slice(0, 200)); } }
  const outs = [];
  const zipOut = path.join(OUT, `CAELIX-${V}-win-x64-portable.zip`); fs.rmSync(zipOut, { force: true });
  sh('zip', ['-q', '-r', '-X', zipOut, 'CAELIX'], { cwd: stage }); outs.push(zipOut); log('built ' + zipOut);
  let mk = ''; try { mk = sh('which', ['makensis']).trim(); } catch (_) {}
  if (mk) {
    const nsi = path.join(stage, 'setup.nsi'); const exeOut = path.join(OUT, `CAELIX-${V}-win-x64-Setup.exe`); fs.rmSync(exeOut, { force: true });
    fs.writeFileSync(nsi, fs.readFileSync(path.join(__dirname, 'installer.nsi'), 'utf8').replace(/@VERSION@/g, V).replace(/@SRC@/g, dir.replace(/\//g, '\\')).replace(/@OUT@/g, exeOut.replace(/\//g, '\\')).replace(/@ICON@/g, icon.replace(/\//g, '\\')));
    sh(mk, ['-V1', nsi]); outs.push(exeOut); log('built ' + exeOut);
  } else log('makensis not found: installer skipped, portable zip only');
  fs.rmSync(stage, { recursive: true, force: true }); return outs;
}

const built = [];
if (only.includes('mac-arm64')) built.push(mac('arm64'));
if (only.includes('mac-x64')) { const z = arg('--mac-x64-zip'); if (!z) throw new Error('--mac-x64-zip is required'); const d = tmp('x64'); sh('ditto', ['-x', '-k', z, d]); built.push(mac('x64', path.join(d, 'Electron.app'))); fs.rmSync(d, { recursive: true, force: true }); }
if (only.includes('win')) { const z = arg('--win-x64-zip'); if (!z) throw new Error('--win-x64-zip is required'); built.push(...win(z)); }
const crypto = require('crypto'); const sums = [];
for (const f of fs.readdirSync(OUT).filter((x) => /\.(dmg|exe|zip)$/.test(x)).sort()) sums.push(crypto.createHash('sha256').update(fs.readFileSync(path.join(OUT, f))).digest('hex') + '  ' + f);
fs.writeFileSync(path.join(OUT, 'SHA256SUMS.txt'), sums.join('\n') + '\n'); log('wrote SHA256SUMS.txt'); console.log(sums.join('\n'));
