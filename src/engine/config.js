'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return {}; } }

// ---- settings: user < project < local ----
function settingsPaths(userDir, cwd) {
  return [path.join(userDir, 'settings.json'), path.join(cwd, '.caelix', 'settings.json'), path.join(cwd, '.caelix', 'settings.local.json')];
}
function loadSettings(userDir, cwd) {
  const out = { permissions: { allow: [], ask: [], deny: [] }, hooks: {}, mcpServers: {}, env: {} };
  for (const f of settingsPaths(userDir, cwd)) {
    const s = readJson(f);
    for (const k of ['allow', 'ask', 'deny']) out.permissions[k] = out.permissions[k].concat((s.permissions && s.permissions[k]) || []);
    if (s.permissions && s.permissions.defaultMode) out.permissions.defaultMode = s.permissions.defaultMode;
    for (const [ev, list] of Object.entries(s.hooks || {})) out.hooks[ev] = (out.hooks[ev] || []).concat(list);
    Object.assign(out.mcpServers, s.mcpServers || {}); Object.assign(out.env, s.env || {});
    for (const k of Object.keys(s)) if (!['permissions', 'hooks', 'mcpServers', 'env'].includes(k)) out[k] = s[k];
  }
  return out;
}
function saveUserSetting(userDir, patch) {
  const f = path.join(userDir, 'settings.json'); const cur = readJson(f); fs.mkdirSync(userDir, { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ ...cur, ...patch }, null, 2));
}
function addLocalAllowRule(cwd, rule) {
  const f = path.join(cwd, '.caelix', 'settings.local.json'); const cur = readJson(f);
  cur.permissions = cur.permissions || {}; cur.permissions.allow = Array.from(new Set((cur.permissions.allow || []).concat(rule)));
  fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(cur, null, 2));
}

// ---- project memory ----
function loadMemory(userDir, cwd) {
  const parts = []; const seen = new Set();
  const add = (f, label) => {
    if (seen.has(f) || !fs.existsSync(f)) return; seen.add(f);
    let t = fs.readFileSync(f, 'utf8');
    t = t.replace(/^@(\S+\.md)\s*$/gm, (m, rel) => { try { return fs.readFileSync(path.resolve(path.dirname(f), rel), 'utf8'); } catch (_) { return m; } });
    parts.push(`## ${label} (${f})\n${t.trim()}`);
  };
  add(path.join(os.homedir(), '.caelix', 'CAELIX.md'), 'User instructions');
  const chain = []; let d = cwd; for (let i = 0; i < 12; i++) { chain.unshift(d); const up = path.dirname(d); if (up === d || d === os.homedir()) break; d = up; }
  for (const dir of chain) { add(path.join(dir, 'CAELIX.md'), 'Project instructions'); add(path.join(dir, 'AGENTS.md'), 'Project instructions'); }
  const rules = path.join(cwd, '.caelix', 'rules');
  if (fs.existsSync(rules)) for (const f of fs.readdirSync(rules).filter((x) => x.endsWith('.md')).sort()) add(path.join(rules, f), 'Rule');
  const notes = notesFile(userDir, cwd); if (fs.existsSync(notes)) parts.push(`## Saved notes\n${fs.readFileSync(notes, 'utf8').trim()}`);
  return parts.join('\n\n');
}
function notesFile(userDir, cwd) { return path.join(userDir, 'memory', cwd.replace(/[^a-zA-Z0-9]/g, '-') + '.md'); }
function addNote(userDir, cwd, text) { const f = notesFile(userDir, cwd); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.appendFileSync(f, '- ' + text.trim() + '\n'); return f; }

// ---- hooks ----
// settings.hooks = { PreToolUse: [{matcher:"Bash", command:"..."}], ... }. Command gets JSON on stdin. Exit 2 = block (stderr is the reason).
function runHooks(settings, event, payload, cwd, matchName) {
  const list = (settings.hooks && settings.hooks[event]) || [];
  const todo = list.filter((h) => !h.matcher || h.matcher === '*' || new RegExp('^(?:' + h.matcher + ')$').test(matchName || ''));
  return Promise.all(todo.map((h) => new Promise((resolve) => {
    const c = spawn('/bin/bash', ['-c', h.command], { cwd, env: { ...process.env, CAELIX_PROJECT_DIR: cwd } });
    let err = '', out = ''; c.stdout.on('data', (d) => (out += d)); c.stderr.on('data', (d) => (err += d));
    c.on('error', () => resolve({ code: 0 })); c.on('close', (code) => resolve({ code, err: err.trim(), out: out.trim() }));
    c.stdin.on('error', () => {}); c.stdin.end(JSON.stringify({ hook_event_name: event, cwd, ...payload }));
    setTimeout(() => { try { c.kill(); } catch (_) {} }, 30000);
  }))).then((rs) => { const b = rs.find((r) => r.code === 2); return b ? { blocked: true, reason: b.err || 'blocked by hook' } : { blocked: false, outputs: rs.map((r) => r.out).filter(Boolean) }; });
}

module.exports = { loadSettings, saveUserSetting, addLocalAllowRule, loadMemory, addNote, runHooks, readJson };
