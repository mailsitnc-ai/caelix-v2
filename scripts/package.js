#!/usr/bin/env node
'use strict';
// Builds dist/CAELIX.app from Electron's prebuilt bundle (no build tools): renames it, swaps in our icon and metadata,
// copies the app code, signs ad-hoc. With --install it also copies to /Applications and puts a shortcut on the Desktop.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const DIST = path.join(ROOT, 'dist'); const APP = path.resolve(arg('--out', path.join(DIST, 'CAELIX.app')));
const run = (cmd, args, opts) => execFileSync(cmd, args, { stdio: 'pipe', ...opts }).toString();
const pb = (plist, cmd) => { try { run('/usr/libexec/PlistBuddy', ['-c', cmd, plist]); } catch (_) {} };

const src = path.resolve(arg('--electron-app', path.join(ROOT, 'node_modules', 'electron', 'dist', 'Electron.app')));
if (!fs.existsSync(src)) { console.error('Electron.app not found; run npm install first'); process.exit(1); }
fs.rmSync(APP, { recursive: true, force: true }); fs.mkdirSync(path.dirname(APP), { recursive: true });
run('ditto', [src, APP]);

const macos = path.join(APP, 'Contents', 'MacOS'); fs.renameSync(path.join(macos, 'Electron'), path.join(macos, 'CAELIX'));
const plist = path.join(APP, 'Contents', 'Info.plist');
pb(plist, 'Set :CFBundleName CAELIX'); pb(plist, 'Set :CFBundleDisplayName CAELIX'); pb(plist, 'Set :CFBundleExecutable CAELIX');
pb(plist, 'Set :CFBundleIdentifier com.caelix.desktop'); pb(plist, 'Set :CFBundleIconFile icon.icns'); pb(plist, 'Set :CFBundleShortVersionString 2.0.0'); pb(plist, 'Set :CFBundleVersion 2.0.0');
pb(plist, 'Add :NSHumanReadableCopyright string CAELIX'); pb(plist, 'Delete :ElectronAsarIntegrity');
const res = path.join(APP, 'Contents', 'Resources');
fs.rmSync(path.join(res, 'electron.icns'), { force: true }); fs.rmSync(path.join(res, 'default_app.asar'), { force: true });
fs.copyFileSync(path.join(ROOT, 'assets', 'icons', 'icon.icns'), path.join(res, 'icon.icns'));

const appDir = path.join(res, 'app'); fs.mkdirSync(path.join(appDir, 'assets', 'icons'), { recursive: true });
for (const f of ['boot.js', 'main.js', 'preload.js']) fs.copyFileSync(path.join(ROOT, f), path.join(appDir, f));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')); delete pkg.devDependencies; delete pkg.scripts; fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify(pkg, null, 2));
// which commit this build is made from (the updater compares it with GitHub)
try { const sha = run('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).trim(); const ct = run('git', ['show', '-s', '--format=%cI', 'HEAD'], { cwd: ROOT }).trim(); fs.writeFileSync(path.join(appDir, 'build-info.json'), JSON.stringify({ sha, commitTime: ct, builtAt: new Date().toISOString() }, null, 2)); } catch (e) { console.error('warning: no git info, updates will treat this build as a development build'); }
for (const d of ['src', 'renderer', 'bin']) run('cp', ['-R', path.join(ROOT, d), path.join(appDir, d)]);
for (const f of fs.readdirSync(path.join(ROOT, 'assets', 'icons'))) { const sp = path.join(ROOT, 'assets', 'icons', f); if (fs.statSync(sp).isFile()) fs.copyFileSync(sp, path.join(appDir, 'assets', 'icons', f)); }
// fail the build if the interface references a file that is not in the bundle
for (const page of ['renderer/index.html']) {
  const html = fs.readFileSync(path.join(appDir, page), 'utf8'); const missing = [];
  for (const m of html.matchAll(/(?:src|href)="([^"#?]+)"/g)) { if (/^(https?:|data:)/.test(m[1])) continue; if (!fs.existsSync(path.resolve(path.dirname(path.join(appDir, page)), m[1]))) missing.push(m[1]); }
  for (const m of fs.readFileSync(path.join(appDir, 'renderer', 'modals.js'), 'utf8').matchAll(/src="(\.\.\/[^"]+)"/g)) if (!fs.existsSync(path.resolve(appDir, 'renderer', m[1]))) missing.push(m[1]);
  if (missing.length) { console.error('Missing files referenced by ' + page + ': ' + missing.join(', ')); process.exit(1); }
}
// renderer references ../assets/icons/icon-128.png: same relative layout inside the app folder.

run('codesign', ['--force', '--deep', '--sign', '-', APP]);
console.log('built', APP);

if (process.argv.includes('--install')) {  // (only for the machine you build on)
  let dest = '/Applications/CAELIX.app';
  try { fs.rmSync(dest, { recursive: true, force: true }); run('ditto', [APP, dest]); }
  catch (e) { dest = path.join(os.homedir(), 'Applications', 'CAELIX.app'); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.rmSync(dest, { recursive: true, force: true }); run('ditto', [APP, dest]); }
  console.log('installed', dest);
  // refresh icon caches / register with Launch Services
  try { run('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', dest]); } catch (_) {}
  try { run('touch', [dest]); } catch (_) {}
  const desk = path.join(os.homedir(), 'Desktop'); const link = path.join(desk, 'CAELIX');
  try { fs.rmSync(path.join(desk, 'CAELIX.app'), { force: true }); fs.rmSync(link, { force: true }); } catch (_) {}
  try {
    run('osascript', ['-e', `tell application "Finder" to make new alias file to POSIX file "${dest}" at POSIX file "${desk}" with properties {name:"CAELIX"}`]);
    console.log('desktop shortcut: Finder alias', path.join(desk, 'CAELIX'));
  } catch (e) { fs.symlinkSync(dest, path.join(desk, 'CAELIX.app')); console.log('desktop shortcut: symlink', path.join(desk, 'CAELIX.app')); }
}
