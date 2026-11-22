'use strict';
// In-app updater. Downloads the newest CAELIX code from GitHub into the user's data folder; boot.js runs it next start.
// Only the app code is replaced (JS, HTML, CSS, assets). The Electron runtime itself comes with the installer.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const pkg = (() => { try { return require('../package.json'); } catch (_) { return {}; } })();
const CFG = Object.assign({ repo: 'mailsitnc-ai/caelix-v2', branch: 'main' }, pkg.caelix || {});
let doFetch = (...a) => fetch(...a); // replaceable in tests
const setFetch = (f) => { doFetch = f; };
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } };
const ROOT = path.resolve(__dirname, '..');

// what code is running right now
function current() {
  const info = readJson(path.join(ROOT, 'build-info.json'));
  return { version: pkg.version || '', sha: info && info.sha || '', commitTime: info && info.commitTime || '', known: !!(info && info.sha) };
}

// the newest commit on the branch
async function latest() {
  const r = await doFetch(`https://api.github.com/repos/${CFG.repo}/commits/${CFG.branch}`, { headers: { 'User-Agent': 'CAELIX-updater', Accept: 'application/vnd.github+json' } });
  if (r.status === 403 || r.status === 429) throw new Error('GitHub is limiting update checks right now. Try again in a few minutes.');
  if (r.status === 404) throw new Error('The CAELIX repository was not found at github.com/' + CFG.repo + '.');
  if (!r.ok) throw new Error('GitHub answered HTTP ' + r.status + '.');
  const j = await r.json();
  return { sha: j.sha, short: String(j.sha).slice(0, 7), date: j.commit && j.commit.committer && j.commit.committer.date || '', message: String(j.commit && j.commit.message || '').split('\n')[0].slice(0, 140) };
}

async function check() {
  const cur = current(); const lat = await latest();
  const newer = !cur.commitTime || !lat.date || Date.parse(lat.date) > Date.parse(cur.commitTime);
  const available = cur.known ? lat.sha !== cur.sha && newer : false;
  return { current: { ...cur, short: cur.sha.slice(0, 7) }, latest: lat, available, devBuild: !cur.known, repo: CFG.repo };
}

const run = (cmd, args) => new Promise((res, rej) => execFile(cmd, args, { maxBuffer: 1 << 24 }, (e, so, se) => (e ? rej(new Error((se || e.message).toString().slice(0, 300))) : res(so))));
const rmrf = (p) => { try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {} };

// unpack a tar.gz of the repository, check it looks like CAELIX, and make it the code to run on next start
async function installFromTar(tarFile, meta, baseDir) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'caelix-upd-'));
  try {
    await run('tar', ['-xzf', tarFile, '-C', work, '--strip-components=1']);
    for (const need of ['main.js', 'preload.js', 'boot.js', 'package.json', path.join('renderer', 'index.html'), path.join('src', 'engine', 'agent.js')]) {
      if (!fs.existsSync(path.join(work, need))) throw new Error('The download is missing ' + need + ', so it was not installed.');
    }
    const np = readJson(path.join(work, 'package.json')) || {};
    if (np.name !== 'caelix') throw new Error('The download is not CAELIX, so it was not installed.');
    const needMajor = np.caelix && np.caelix.minElectron; const haveMajor = Number(String(process.versions.electron || '999').split('.')[0]);
    if (needMajor && haveMajor < needMajor) { const e = new Error(`This update needs a newer app shell (Electron ${needMajor}). Download the new installer from github.com/${CFG.repo}/releases.`); e.needsInstaller = true; throw e; }
    fs.mkdirSync(baseDir, { recursive: true });
    const dirName = String(meta.sha).slice(0, 12); const dest = path.join(baseDir, dirName);
    rmrf(dest); fs.renameSync(work, dest);
    fs.writeFileSync(path.join(dest, 'build-info.json'), JSON.stringify({ sha: meta.sha, commitTime: meta.date, installedAt: new Date().toISOString() }, null, 2));
    const prev = readJson(path.join(baseDir, 'current.json'));
    const tmp = path.join(baseDir, 'current.json.tmp'); fs.writeFileSync(tmp, JSON.stringify({ dir: dirName, sha: meta.sha, commitTime: meta.date, previous: prev && prev.dir || null }, null, 2)); fs.renameSync(tmp, path.join(baseDir, 'current.json'));
    for (const d of fs.readdirSync(baseDir)) { if (d !== dirName && d !== (prev && prev.dir) && fs.statSync(path.join(baseDir, d)).isDirectory()) rmrf(path.join(baseDir, d)); } // keep only the new and the previous copy
    return { dir: dest };
  } catch (e) { rmrf(work); throw e; }
}

async function download(meta, baseDir) {
  const r = await doFetch(`https://codeload.github.com/${CFG.repo}/tar.gz/${meta.sha}`, { headers: { 'User-Agent': 'CAELIX-updater' } });
  if (!r.ok) throw new Error('Download failed: HTTP ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 60 * 1024 * 1024) throw new Error('The download is unexpectedly large, so it was not installed.');
  if (buf[0] !== 0x1f || buf[1] !== 0x8b) throw new Error('The download is not a valid archive.');
  const f = path.join(os.tmpdir(), `caelix-${String(meta.sha).slice(0, 7)}.tar.gz`); fs.writeFileSync(f, buf);
  try { return await installFromTar(f, meta, baseDir); } finally { try { fs.unlinkSync(f); } catch (_) {} }
}

function chooseRootFor(base, mine) { // same rule as boot.js, exposed so it can be tested
  const cur = readJson(path.join(base, 'current.json')); if (!cur || cur.bad || !cur.dir) return 'bundled';
  if (!fs.existsSync(path.join(base, cur.dir, 'main.js'))) return 'bundled';
  if (mine && mine.commitTime && cur.commitTime && Date.parse(mine.commitTime) >= Date.parse(cur.commitTime)) return 'bundled';
  return 'downloaded';
}

module.exports = { CFG, setFetch, current, latest, check, installFromTar, download, chooseRootFor };
