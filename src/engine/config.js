'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

// readList: always an array, even if the file holds an object such as {hooks:[...]} or something unexpected.
function asList(v, key) { if (Array.isArray(v)) return v; if (v && typeof v === 'object' && Array.isArray(v[key])) return v[key]; return []; }
function readList(f, key) { return asList(readJson(f, []), key); }
function readJson(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return d === undefined ? {} : d; } }
function writeJson(f, o) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2)); }

// ---- file locations ----
const mcpFiles = (userDir, cwd) => ({ user: path.join(userDir, 'mcp.json'), project: cwd ? path.join(cwd, '.mcp.json') : null });
const hookFiles = (userDir, cwd) => ({ user: path.join(userDir, 'hooks.json'), project: cwd ? path.join(cwd, '.caelix', 'hooks.json') : null });
const settingsPaths = (userDir, cwd) => [path.join(userDir, 'settings.json'), path.join(cwd, '.caelix', 'settings.json'), path.join(cwd, '.caelix', 'settings.local.json')];

// ---- MCP entries: {mcpServers:{name:{command,args,env|url,headers,disabled}}} ----
function listMcp(userDir, cwd) {
  const out = []; const f = mcpFiles(userDir, cwd);
  for (const scope of ['user', 'project']) { if (!f[scope]) continue; const j = readJson(f[scope]); for (const [name, cfg] of Object.entries(j.mcpServers || {})) out.push({ name, scope, cfg, disabled: !!cfg.disabled }); }
  const s = readJson(path.join(userDir, 'settings.json')); for (const [name, cfg] of Object.entries(s.mcpServers || {})) out.push({ name, scope: 'settings', cfg, disabled: !!cfg.disabled });
  if (cwd) { const ps = readJson(path.join(cwd, '.caelix', 'settings.json')); for (const [name, cfg] of Object.entries(ps.mcpServers || {})) out.push({ name, scope: 'settings', cfg, disabled: !!cfg.disabled }); }
  return out;
}
function parseCommand(line) {
  line = line.trim(); if (/^https?:\/\//i.test(line)) return { url: line };
  const parts = line.match(/"[^"]*"|'[^']*'|\S+/g) || []; const un = (s) => s.replace(/^["']|["']$/g, '');
  return { command: un(parts[0] || ''), args: parts.slice(1).map(un) };
}
function addMcp(userDir, cwd, { name, scope, command }) {
  if (!name || !/^[\w.-]+$/.test(name)) throw new Error('Server name may use letters, numbers, dash, dot, underscore.');
  const cfg = parseCommand(command || ''); if (!cfg.url && !cfg.command) throw new Error('Enter a command or an http(s) URL.');
  const f = mcpFiles(userDir, cwd)[scope === 'project' ? 'project' : 'user']; if (!f) throw new Error('Open a project folder first to add a project server.');
  const j = readJson(f); j.mcpServers = j.mcpServers || {}; j.mcpServers[name] = cfg; writeJson(f, j); return true;
}
function removeMcp(userDir, cwd, name, scope) { const f = mcpFiles(userDir, cwd)[scope]; if (!f) return false; const j = readJson(f); if (j.mcpServers) delete j.mcpServers[name]; writeJson(f, j); return true; }
function toggleMcp(userDir, cwd, name, scope, disabled) { const f = mcpFiles(userDir, cwd)[scope]; if (!f) return false; const j = readJson(f); if (j.mcpServers && j.mcpServers[name]) j.mcpServers[name].disabled = !!disabled; writeJson(f, j); return true; }
function builtinDisabled(userDir) { return readList(path.join(userDir, 'builtin-off.json'), 'off').filter((x) => typeof x === 'string'); }
function toggleBuiltin(userDir, name, disabled) { const l = new Set(builtinDisabled(userDir)); disabled ? l.add(name) : l.delete(name); writeJson(path.join(userDir, 'builtin-off.json'), Array.from(l)); }
function importClaudeMcp(userDir) {
  const f = path.join(os.homedir(), '.claude.json'); const j = readJson(f); const src = j.mcpServers || {}; const dest = path.join(userDir, 'mcp.json'); const cur = readJson(dest); cur.mcpServers = cur.mcpServers || {}; let n = 0;
  for (const [k, v] of Object.entries(src)) { if (cur.mcpServers[k]) continue; if (v.command || v.url) { cur.mcpServers[k] = v.url ? { url: v.url } : { command: v.command, args: v.args || [], env: v.env || {} }; n++; } }
  writeJson(dest, cur); return n;
}

// ---- hooks: arrays of {id,event,matcher,command,enabled} ----
const HOOK_EVENTS = ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop', 'SessionStart', 'PreCompact', 'Notification'];
function listHooks(userDir, cwd) {
  const out = []; const f = hookFiles(userDir, cwd);
  for (const scope of ['user', 'project']) { if (!f[scope]) continue; for (const h of readList(f[scope], 'hooks').filter((x) => x && typeof x === 'object')) out.push({ ...h, scope }); }
  return out;
}
function addHook(userDir, cwd, h) {
  if (!HOOK_EVENTS.includes(h.event)) throw new Error('Unknown event ' + h.event); if (!h.command || !h.command.trim()) throw new Error('Enter a shell command.');
  try { if (h.matcher && h.matcher !== '*') new RegExp(h.matcher); } catch (_) { throw new Error('Matcher must be a valid regular expression (or *).'); }
  const f = hookFiles(userDir, cwd)[h.scope === 'project' ? 'project' : 'user']; if (!f) throw new Error('Open a project folder first to add a project hook.');
  const list = readList(f, 'hooks'); list.push({ id: crypto.randomUUID().slice(0, 8), event: h.event, matcher: h.matcher || '*', command: h.command, enabled: true }); writeJson(f, list); return true;
}
function removeHook(userDir, cwd, id, scope) { const f = hookFiles(userDir, cwd)[scope]; if (!f) return false; writeJson(f, readList(f, 'hooks').filter((h) => h.id !== id)); return true; }
function toggleHook(userDir, cwd, id, scope, enabled) { const f = hookFiles(userDir, cwd)[scope]; if (!f) return false; writeJson(f, readList(f, 'hooks').map((h) => (h.id === id ? { ...h, enabled } : h))); return true; }

// ---- settings: user < project < local, plus mcp and hook files ----
function loadSettings(userDir, cwd) {
  const out = { permissions: { allow: [], ask: [], deny: [] }, hooks: {}, mcpServers: {}, env: {} };
  for (const f of settingsPaths(userDir, cwd || os.homedir())) {
    const s = readJson(f);
    for (const k of ['allow', 'ask', 'deny']) out.permissions[k] = out.permissions[k].concat(Array.isArray(s.permissions && s.permissions[k]) ? s.permissions[k] : []);
    if (s.permissions && s.permissions.defaultMode) out.permissions.defaultMode = s.permissions.defaultMode;
    for (const [ev, list] of Object.entries(s.hooks && typeof s.hooks === 'object' && !Array.isArray(s.hooks) ? s.hooks : {})) out.hooks[ev] = (out.hooks[ev] || []).concat(Array.isArray(list) ? list : []);
    Object.assign(out.mcpServers, s.mcpServers || {}); Object.assign(out.env, s.env || {});
    for (const k of Object.keys(s)) if (!['permissions', 'hooks', 'mcpServers', 'env'].includes(k)) out[k] = s[k];
  }
  for (const e of listMcp(userDir, cwd)) if (!e.disabled) out.mcpServers[e.name] = e.cfg;
  for (const h of listHooks(userDir, cwd)) if (h.enabled !== false) (out.hooks[h.event] = out.hooks[h.event] || []).push({ matcher: h.matcher, command: h.command });
  out.builtinOff = builtinDisabled(userDir);
  return out;
}
function saveUserSetting(userDir, patch) { const f = path.join(userDir, 'settings.json'); writeJson(f, { ...readJson(f), ...patch }); }
function addLocalAllowRule(cwd, rule) {
  const f = path.join(cwd, '.caelix', 'settings.local.json'); const cur = readJson(f);
  cur.permissions = cur.permissions || {}; cur.permissions.allow = Array.from(new Set((cur.permissions.allow || []).concat(rule))); writeJson(f, cur);
}

// ---- project memory ----
function memoryFiles(userDir, cwd) {
  const files = []; const seen = new Set();
  const add = (f, label) => { if (!seen.has(f) && fs.existsSync(f)) { seen.add(f); files.push({ file: f, label }); } };
  add(path.join(os.homedir(), '.caelix', 'CAELIX.md'), 'User instructions');
  if (cwd) {
    const chain = []; let d = cwd; for (let i = 0; i < 12; i++) { chain.unshift(d); const up = path.dirname(d); if (up === d || d === os.homedir()) break; d = up; }
    for (const dir of chain) { add(path.join(dir, 'CAELIX.md'), 'Project instructions'); add(path.join(dir, 'AGENTS.md'), 'Project instructions'); }
    const rules = path.join(cwd, '.caelix', 'rules'); if (fs.existsSync(rules)) for (const f of fs.readdirSync(rules).filter((x) => x.endsWith('.md')).sort()) add(path.join(rules, f), 'Rule');
    const notes = notesFile(userDir, cwd); add(notes, 'Saved notes');
  }
  return files;
}
function loadMemory(userDir, cwd) {
  const parts = [];
  for (const { file, label } of memoryFiles(userDir, cwd)) {
    let t = fs.readFileSync(file, 'utf8'); t = t.replace(/^@(\S+\.md)\s*$/gm, (m, rel) => { try { return fs.readFileSync(path.resolve(path.dirname(file), rel), 'utf8'); } catch (_) { return m; } });
    parts.push(`## ${label} (${file})\n${t.trim()}`);
  }
  return parts.join('\n\n');
}
function notesFile(userDir, cwd) { return path.join(userDir, 'memory', cwd.replace(/[^a-zA-Z0-9]/g, '-') + '.md'); }
function addNote(userDir, cwd, text) { const f = notesFile(userDir, cwd || 'chat'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.appendFileSync(f, '- ' + text.trim() + '\n'); return f; }

// ---- hook runner: command gets JSON on stdin; exit code 2 blocks ----
function runHooks(settings, event, payload, cwd, matchName) {
  const list = (settings.hooks && settings.hooks[event]) || [];
  const todo = list.filter((h) => { if (!h.matcher || h.matcher === '*') return true; try { return new RegExp(h.matcher, 'i').test(matchName || '') || new RegExp('^(?:' + h.matcher + ')$', 'i').test(matchName || ''); } catch (_) { return false; } });
  return Promise.all(todo.map((h) => new Promise((resolve) => {
    const c = spawn('/bin/bash', ['-c', h.command], { cwd: cwd || os.homedir(), env: { ...process.env, CAELIX_PROJECT_DIR: cwd || '', CAELIX_HOOK_EVENT: event } });
    let err = '', out = ''; c.stdout.on('data', (d) => (out += d)); c.stderr.on('data', (d) => (err += d));
    c.on('error', () => resolve({ code: 0 })); c.on('close', (code) => resolve({ code, err: err.trim(), out: out.trim() }));
    c.stdin.on('error', () => {}); c.stdin.end(JSON.stringify({ hook_event_name: event, cwd, ...payload }));
    setTimeout(() => { try { c.kill(); } catch (_) {} }, 30000);
  }))).then((rs) => { const b = rs.find((r) => r.code === 2); return b ? { blocked: true, reason: b.err || 'blocked by hook' } : { blocked: false, outputs: rs.map((r) => r.out).filter(Boolean) }; });
}

module.exports = { loadSettings, saveUserSetting, addLocalAllowRule, loadMemory, memoryFiles, addNote, runHooks, readJson, listMcp, addMcp, removeMcp, toggleMcp, toggleBuiltin, builtinDisabled, importClaudeMcp, listHooks, addHook, removeHook, toggleHook, HOOK_EVENTS };
