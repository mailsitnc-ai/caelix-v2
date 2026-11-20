#!/usr/bin/env node
'use strict';
// Builds dist/CAELIX.app from Electron's prebuilt bundle (no build tools): renames it, swaps in our icon and metadata,
// copies the app code, signs ad-hoc. With --install it also copies to /Applications and puts a shortcut on the Desktop.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist'); const APP = path.join(DIST, 'CAELIX.app');
const run = (cmd, args, opts) => execFileSync(cmd, args, { stdio: 'pipe', ...opts }).toString();
const pb = (plist, cmd) => { try { run('/usr/libexec/PlistBuddy', ['-c', cmd, plist]); } catch (_) {} };

const src = path.join(ROOT, 'node_modules', 'electron', 'dist', 'Electron.app');
if (!fs.existsSync(src)) { console.error('Electron.app not found; run npm install first'); process.exit(1); }
fs.rmSync(APP, { recursive: true, force: true }); fs.mkdirSync(DIST, { recursive: true });
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
for (const f of ['main.js', 'preload.js']) fs.copyFileSync(path.join(ROOT, f), path.join(appDir, f));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')); delete pkg.devDependencies; delete pkg.scripts; fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify(pkg, null, 2));
for (const d of ['src', 'renderer', 'bin']) run('cp', ['-R', path.join(ROOT, d), path.join(appDir, d)]);
for (const f of ['icon.png', 'icon-128.png', 'icon-512.png', 'icon.icns']) fs.copyFileSync(path.join(ROOT, 'assets', 'icons', f), path.join(appDir, 'assets', 'icons', f));
// renderer references ../assets/icons/icon-128.png: same relative layout inside the app folder.

run('codesign', ['--force', '--deep', '--sign', '-', APP]);
console.log('built', APP);

if (process.argv.includes('--install')) {
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
