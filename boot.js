'use strict';
// Tiny loader. It picks which copy of the app code to run: the code shipped inside the installer, or a newer copy
// that the in-app Update button downloaded into the user's data folder. Keep this file small and stable: it is the
// one file an update never replaces.
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } }

function chooseRoot() {
  const bundled = __dirname;
  if (!app.isPackaged) return { root: bundled, why: 'development run' };
  const base = path.join(app.getPath('appData'), 'CAELIX v2', 'code');
  const cur = readJson(path.join(base, 'current.json'));
  const mine = readJson(path.join(bundled, 'build-info.json'));
  if (!cur || cur.bad || !cur.dir) return { root: bundled, why: 'no downloaded update' };
  const dir = path.join(base, cur.dir);
  if (!fs.existsSync(path.join(dir, 'main.js'))) return { root: bundled, why: 'downloaded update is incomplete' };
  // a freshly installed app that is newer than the downloaded code wins
  if (mine && mine.commitTime && cur.commitTime && Date.parse(mine.commitTime) >= Date.parse(cur.commitTime)) return { root: bundled, why: 'installer is newer' };
  return { root: dir, why: 'downloaded update ' + String(cur.sha || '').slice(0, 7), base, cur };
}

const pick = chooseRoot();
try {
  require(path.join(pick.root, 'main.js'));
} catch (e) {
  if (pick.root === __dirname) throw e;
  // the downloaded code failed to start: mark it bad and fall back to the bundled code
  try { const f = path.join(pick.base, 'current.json'); fs.writeFileSync(f, JSON.stringify({ ...pick.cur, bad: String(e && e.message || e).slice(0, 300) })); } catch (_) {}
  console.error('CAELIX: downloaded update failed to start, using the installed version:', e && e.message);
  require(path.join(__dirname, 'main.js'));
}
