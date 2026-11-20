'use strict';
const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell, Menu, nativeImage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');

const BOOT = Date.now() - Math.round(process.uptime() * 1000);
app.setName('CAELIX');
const ROOT = __dirname;
const SELF = process.argv.includes('--self-check');
const ICON = path.join(ROOT, 'assets', 'icons', 'icon.png');
if (SELF) app.setPath('userData', path.join(require('os').tmpdir(), 'caelix-selfcheck-userdata'));
else {
  // Own data folder, so files written by the earlier CAELIX (different formats) never break this one.
  // Saved provider keys are copied over once, because their format is the same.
  const oldDir = app.getPath('userData'); const newDir = path.join(path.dirname(oldDir), 'CAELIX v2');
  try { fs.mkdirSync(newDir, { recursive: true }); for (const f of ['keys.enc.json', 'keys.enc']) { const a = path.join(oldDir, f), b = path.join(newDir, f); if (fs.existsSync(a) && !fs.existsSync(b)) fs.copyFileSync(a, b); } } catch (_) {}
  app.setPath('userData', newDir);
}
if (SELF) { try { fs.rmSync(app.getPath('userData'), { recursive: true, force: true }); } catch (_) {} }

let win = null; const timing = { boot: BOOT };
const live = new Map(); // sessionId -> live state
let keys, store, engine = null;
const CHAT_DIR = SELF ? path.join(require('os').tmpdir(), 'caelix-selfcheck-chats') : path.join(app.getPath('documents'), 'CAELIX Chats');
const mcpPool = new Map(); // config key -> connection

const E = () => engine || (engine = {
  agent: require('./src/engine/agent'), providers: require('./src/engine/providers'), config: require('./src/engine/config'),
  runtime: require('./src/engine/runtime'), mcpBuiltinDesc: (n) => (require('./src/engine/builtin').builtins('', '')[n] || { description: '' }).description, perms: require('./src/engine/permissions'), diff: require('./src/engine/diff'), mcp: require('./src/engine/mcp'),
});
const userDir = () => app.getPath('userData');
const provFile = () => path.join(userDir(), 'providers.json');
const readProv = () => { try { return JSON.parse(fs.readFileSync(provFile(), 'utf8')); } catch (_) { return { bases: {}, last: {} }; } };
const writeProv = (o) => { fs.mkdirSync(userDir(), { recursive: true }); fs.writeFileSync(provFile(), JSON.stringify(o)); };
const send = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };

// ---------- sessions ----------
function serSnap(m) { return Array.from(m.entries()); }
function saveSession(L) {
  const { rt, meta } = L; meta.updated = Date.now();
  store.save({ ...meta, messages: rt.messages, items: L.items, usage: rt.usage, turn: rt.turn, effort: rt.effort, kind: rt.kind, summary: rt.summary || '', team: !!rt.team,
    checkpoints: rt.checkpoints.map((c) => ({ turn: c.turn, msgIndex: c.msgIndex, prompt: c.prompt, snap: serSnap(c.snap) })), baseSnap: serSnap(rt.baseSnap), todos: rt.st.todos, mode: rt.st.mode, cwd: rt.st.cwd });
}
function makeLive(s) {
  const { newRuntime } = E().runtime;
  const rt = newRuntime({ provider: s.provider, model: s.model, cwd: s.cwd, mode: s.mode, kind: s.kind || 'code', messages: s.messages || [], checkpoints: (s.checkpoints || []).map((c) => ({ ...c, snap: new Map(c.snap) })) });
  rt.baseSnap = new Map(s.baseSnap || []); rt.turn = s.turn || 0; rt.usage = s.usage || { in: 0, out: 0 }; rt.effort = s.effort || 'medium'; rt.st.todos = s.todos || []; rt.summary = s.summary || ''; rt.team = !!s.team;
  const meta = { id: s.id, title: s.title, cwd: s.cwd, created: s.created, updated: s.updated, archived: !!s.archived, pinned: !!s.pinned, provider: s.provider, model: s.model, mode: s.mode, effort: rt.effort, kind: rt.kind, team: rt.team };
  const L = { meta, rt, items: s.items || [], ctrl: null, asks: new Map(), busy: false, askSeq: 0, bg: [], assistantBuf: '' };
  live.set(s.id, L); return L;
}
function getLive(id) { return live.get(id) || (store.load(id) && makeLive(store.load(id))); }

function summaryFor(L) {
  let i = L.items.length - 1; while (i >= 0 && L.items[i].type !== 'user') i--; const tools = L.items.slice(i + 1).filter((x) => x.type === 'tool' && x.output !== undefined);
  if (!tools.length) return null; const failed = tools.filter((t) => t.error); const files = [];
  for (const t of tools) { if (t.error) continue; const f = t.input && (t.input.file_path || t.input.notebook_path || t.input.filename); if (f && ['Write', 'Edit', 'NotebookEdit', 'WriteDocument'].includes(t.name)) { const b = path.basename(f); if (!files.includes(b)) files.push(b); } }
  const last = failed[failed.length - 1];
  return { actions: tools.length, ok: tools.length - failed.length, failed: failed.length, failedNames: Array.from(new Set(failed.map((t) => t.name))).slice(0, 4), files: files.slice(0, 8), issue: last ? String(last.output || '').split('\n')[0].slice(0, 220) : '', secs: ((Date.now() - (L.turnT0 || Date.now())) / 1000).toFixed(1) };
}
function record(L, e) {
  switch (e.type) {
    case 'turn_start': L.turnT0 = Date.now(); break;
    case 'text': L.assistantBuf += e.delta; break;
    case 'text_end': if (L.assistantBuf.trim()) L.items.push({ type: 'assistant', text: L.assistantBuf }); L.assistantBuf = ''; break;
    case 'tool_start': L.items.push({ type: 'tool', id: e.id, name: e.name, input: e.input, summary: e.summary }); break;
    case 'tool_result': { const it = [...L.items].reverse().find((x) => x.type === 'tool' && x.id === e.id); if (it) { it.output = e.output; it.error = e.error; it.ms = e.ms; } break; }
    case 'error': L.items.push({ type: 'error', message: e.message }); break;
    case 'todos': { const i = L.items.findIndex((x) => x.type === 'todos'); const t = { type: 'todos', todos: e.todos }; if (i >= 0) L.items.splice(i, 1); L.items.push(t); break; }
    case 'compacted': L.items.push({ type: 'info', text: `Conversation compacted (${e.before} → ${e.after} messages).` }); break;
    case 'route': L.items.push({ type: 'info', text: `OmniRoute → ${e.provider} / ${e.model}` }); break;
  }
}

function envFor(L) {
  const { providers, config } = E();
  if (!providers.__hf) { providers.__hf = true; providers.setHealthFile(path.join(userDir(), 'model-health.json')); }
  const settings = config.loadSettings(userDir(), L.rt.st.cwd);
  return {
    userDir: userDir(), settings, signal: L.ctrl.signal, docsDir: CHAT_DIR, renderDocument,
    getCreds: (pid) => ({ key: keys.get(pid), base: readProv().bases[pid] || '' }),
    connected: () => providers.PROVIDERS.filter((p) => !p.virtual && (keys.has(p.id) || p.anonymous)).map((p) => p.id),
    bases: () => readProv().bases,
    emit: (e) => { record(L, e); send('evt', { sid: L.meta.id, e }); if (e.type === 'turn_end') { const sm = summaryFor(L); if (sm) { L.items.push({ type: 'summary', ...sm }); send('evt', { sid: L.meta.id, e: { type: 'summary', summary: sm } }); } } },
    ask: (req) => new Promise((resolve) => {
      const id = 'ask' + (++L.askSeq); L.asks.set(id, resolve);
      send('evt', { sid: L.meta.id, e: { type: 'ask', id, req } });
      L.ctrl.signal.addEventListener('abort', () => { if (L.asks.delete(id)) resolve(req.kind === 'permission' ? { decision: 'deny', comment: 'interrupted' } : 'interrupted'); }, { once: true });
    }),
  };
}

async function getMcp(cwd, settings, force) {
  const key = (cwd || '') + '|' + JSON.stringify(settings.mcpServers || {}) + '|' + JSON.stringify(settings.builtinOff || []);
  if (force) { for (const pr of mcpPool.values()) Promise.resolve(pr).then((c) => c && c.stop && c.stop()).catch(() => {}); mcpPool.clear(); }
  if (!mcpPool.has(key)) mcpPool.set(key, E().mcp.connectAll(settings.mcpServers, cwd, { userDir: userDir(), disabled: settings.builtinOff }).catch((e) => ({ defs: [], route: {}, servers: [], errors: [e.message], stop() {} })));
  return mcpPool.get(key);
}
async function ensureMcp(L, env) {
  const cwd = L.rt.kind === 'chat' ? CHAT_DIR : L.rt.st.cwd; L.rt.mcp = await getMcp(cwd, env.settings);
  send('evt', { sid: L.meta.id, e: { type: 'mcp', servers: L.rt.mcp.servers.map((s) => ({ name: s.name, tools: s.tools.length })), errors: L.rt.mcp.errors } });
}
function mdToHtml(src) { const md = require('./renderer/md.js'); return `<!doctype html><meta charset="utf-8"><style>body{font:14px/1.6 -apple-system,Helvetica,Arial,sans-serif;color:#111;max-width:760px;margin:36px auto;padding:0 24px}h2,h3,h4{margin:1.3em 0 .4em}code{background:#f0f2f6;padding:1px 5px;border-radius:4px;font-family:Menlo,monospace;font-size:12.5px}pre{background:#f0f2f6;padding:10px 12px;border-radius:8px;overflow:auto}blockquote{border-left:3px solid #cbd3e0;margin:0;padding-left:12px;color:#556}a{color:#1a56db}</style>${md.render(src)}`; }
async function renderDocument(file, content, fmt) {
  const html = /<html|<!doctype/i.test(content) ? content : mdToHtml(content);
  if (fmt === 'html') { fs.writeFileSync(file, html); return file; }
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, offscreen: false } });
  try { await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)); const pdf = await w.webContents.printToPDF({ printBackground: true, pageSize: 'A4' }); fs.writeFileSync(file, pdf); } finally { w.destroy(); }
  return file;
}

// ---------- IPC ----------
function handle(name, fn) { ipcMain.handle(name, async (_e, ...a) => { try { return await fn(...a); } catch (err) { return { __error: String(err && err.message || err) }; } }); }

function providerState() {
  const { providers } = E(); const pv = readProv();
  return providers.PROVIDERS.filter((p) => !p.hidden).map((p) => ({ id: p.id, name: p.name, virtual: !!p.virtual, keyOptional: !!p.keyOptional, anonymous: !!p.anonymous, editableBase: !!p.editableBase, base: pv.bases[p.id] || p.base || '', keyHint: p.keyHint || '', note: p.note || '', docs: p.docs || '', hasKey: keys.has(p.id), masked: keys.masked(p.id) }));
}

function registerIpc() {
  handle('app:init', () => {
    const pv = readProv();
    return { version: app.getVersion(), providers: providerState(), sessions: store.list(), last: pv.last || {}, userDir: userDir(), home: app.getPath('home'), secure: keys.available(), self: SELF, chatDir: CHAT_DIR, fav: pv.fav || [] };
  });
  handle('keys:set', (id, key) => { if (!key || key.trim().length < 4) throw new Error('That key looks too short.'); keys.set(id, key); return providerState(); });
  handle('keys:remove', (id) => { keys.remove(id); return providerState(); });
  handle('keys:base', (id, url) => { const pv = readProv(); pv.bases = pv.bases || {}; if (url) pv.bases[id] = url.trim(); else delete pv.bases[id]; writeProv(pv); return providerState(); });
  handle('models:list', async (pid, force) => { const { providers } = E(); return providers.listModels(pid, keys.get(pid), readProv().bases, { force }); });
  handle('last:set', (patch) => { const pv = readProv(); pv.last = { ...(pv.last || {}), ...patch }; writeProv(pv); return true; });

  handle('session:new', ({ cwd, provider, model, mode, kind }) => {
    kind = kind === 'chat' ? 'chat' : 'code';
    if (kind === 'code') { if (!cwd) throw new Error('Code sessions need a project folder. Open a folder first.'); if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error('That folder does not exist.'); }
    else { fs.mkdirSync(CHAT_DIR, { recursive: true }); cwd = CHAT_DIR; mode = 'auto'; }
    const id = store.newId(); const now = Date.now();
    const s = { id, kind, title: kind === 'chat' ? 'New chat' : 'New session', cwd, created: now, updated: now, provider, model, mode: mode || 'default', messages: [], items: [], checkpoints: [], baseSnap: [] };
    const L = makeLive(s); saveSession(L); return { meta: L.meta, items: [] };
  });
  handle('session:open', (id) => {
    const L = getLive(id); if (!L) throw new Error('Session not found');
    return { meta: { ...L.meta, mode: L.rt.st.mode, cwd: L.rt.st.cwd, kind: L.rt.kind, team: L.rt.team }, items: L.items, busy: L.busy, todos: L.rt.st.todos, usage: L.rt.usage, checkpoints: L.rt.checkpoints.map((c) => ({ turn: c.turn, prompt: c.prompt })), ctx: E().agent.estTokens(L.rt.messages), ctxLimit: L.rt.ctxLimit, breakdown: E().agent.breakdown(L.rt.messages) };
  });
  handle('session:list', () => { const l = store.list(); for (const x of l) { const L = live.get(x.id); if (L) { x.running = L.busy; x.title = L.meta.title; } } return l; });
  handle('session:set', (id, patch) => {
    const L = getLive(id); const { rt, meta } = L;
    if (patch.provider) { rt.provider = meta.provider = patch.provider; } if (patch.model) { rt.model = meta.model = patch.model; }
    if (patch.mode) { rt.st.mode = meta.mode = patch.mode; } if (patch.effort) { rt.effort = meta.effort = patch.effort; }
    if (patch.title != null) meta.title = patch.title.slice(0, 120) || meta.title; if (patch.archived != null) meta.archived = patch.archived; if (patch.pinned != null) meta.pinned = patch.pinned;
    if (patch.cwd && rt.kind === 'code') { rt.st.cwd = meta.cwd = patch.cwd; } if (patch.team != null) { rt.team = meta.team = !!patch.team; }
    saveSession(L); return meta;
  });
  handle('session:delete', (id) => { const L = live.get(id); if (L && L.ctrl) L.ctrl.abort(); live.delete(id); store.remove(id); return true; });
  handle('session:fork', (id) => {
    const L = getLive(id); saveSession(L); const s = store.load(id); const nid = store.newId(); const now = Date.now();
    s.id = nid; s.title = (s.title || 'Session') + ' (fork)'; s.created = s.updated = now; store.save(s); return { id: nid };
  });
  handle('chat:send', async (sid, text) => {
    const L = getLive(sid); if (!L) throw new Error('Session not found'); if (L.busy) throw new Error('Session is busy');
    L.busy = true; L.ctrl = new AbortController(); const env = envFor(L);
    if (L.meta.title === 'New session' || L.meta.title === 'New chat') L.meta.title = text.replace(/\s+/g, ' ').slice(0, 56);
    L.items.push({ type: 'user', text }); send('sessions-changed', 1);
    (async () => {
      try { await ensureMcp(L, env); } catch (e) { env.emit({ type: 'error', message: 'MCP: ' + e.message }); }
      await E().agent.runTurn(L.rt, env, text);
      L.busy = false; saveSession(L); send('sessions-changed', 1);
      send('evt', { sid, e: { type: 'idle', ctx: E().agent.estTokens(L.rt.messages), ctxLimit: L.rt.ctxLimit, usage: L.rt.usage, breakdown: E().agent.breakdown(L.rt.messages), checkpoints: L.rt.checkpoints.map((c) => ({ turn: c.turn, prompt: c.prompt })) } });
      if (win && !win.isFocused() && Notification.isSupported() && !SELF) new Notification({ title: 'CAELIX', body: (L.meta.title || 'Session') + ' finished' }).show();
    })();
    return true;
  });
  handle('chat:stop', (sid) => { const L = live.get(sid); if (L && L.ctrl) L.ctrl.abort(); return true; });
  handle('chat:answer', (sid, askId, answer) => { const L = live.get(sid); const r = L && L.asks.get(askId); if (r) { L.asks.delete(askId); r(answer); } return true; });
  handle('chat:compact', async (sid) => {
    const L = getLive(sid); L.ctrl = new AbortController(); const env = envFor(L);
    const ok = await E().agent.compact(L.rt, env, 'manual'); saveSession(L); return { ok, ctx: E().agent.estTokens(L.rt.messages) };
  });
  handle('chat:rewind', (sid, turn, opts) => {
    const L = getLive(sid); const r = E().agent.rewind(L.rt, turn, opts);
    if (r.ok && opts.conversation) { const keep = L.items.findIndex((x, i) => x.type === 'user' && L.items.slice(0, i + 1).filter((y) => y.type === 'user').length === turn); L.items = keep >= 0 ? L.items.slice(0, keep) : L.items; }
    saveSession(L); return { ...r, items: L.items };
  });
  handle('chat:clear', (sid) => { const L = getLive(sid); L.rt.messages = []; L.rt.checkpoints = []; L.rt.turn = 0; L.items = []; L.rt.usage = { in: 0, out: 0 }; saveSession(L); return true; });
  handle('chat:side', async (sid, question) => {
    const L = getLive(sid); const env = envFor(L); L.ctrl = L.ctrl && !L.ctrl.signal.aborted ? L.ctrl : new AbortController(); env.signal = new AbortController().signal;
    const msgs = L.rt.messages.filter((m) => m.role === 'system' || m.role === 'user' || (m.role === 'assistant' && !m.tool_calls)).slice(-20).concat([{ role: 'user', content: question + '\n\n(Side question: answer briefly; do not use tools.)' }]);
    let text = ''; const rt2 = { ...L.rt, messages: msgs };
    const { providers } = E();
    if (L.rt.provider === 'pretend') return 'Pretend AI side answer to: ' + question;
    const c = env.getCreds(L.rt.provider);
    const r = await providers.streamChat({ provider: L.rt.provider === 'omniroute' ? 'omniroute' : L.rt.provider, key: c.key, base: c.base, model: L.rt.model, messages: msgs, onText: (t) => { text += t; send('evt', { sid, e: { type: 'side_text', delta: t } }); }, signal: env.signal });
    return r.text;
  });
  handle('chat:export', (sid) => {
    const L = getLive(sid); const out = [`# ${L.meta.title}\n`];
    for (const it of L.items) { if (it.type === 'user') out.push(`**You:** ${it.text}\n`); else if (it.type === 'assistant') out.push(`**CAELIX:** ${it.text}\n`); else if (it.type === 'tool') out.push(`- \`${it.name}\` ${it.summary || ''}\n`); }
    const f = path.join(app.getPath('downloads'), `CAELIX-${L.meta.id.slice(0, 8)}.md`); fs.writeFileSync(f, out.join('\n')); return f;
  });
  handle('memory:add', (sid, text) => E().config.addNote(userDir(), getLive(sid).rt.st.cwd, text));
  handle('memory:show', (sid) => E().config.loadMemory(userDir(), getLive(sid).rt.st.cwd) || '(no memory yet: add a CAELIX.md or AGENTS.md to the project, or use /remember)');
  handle('init:project', (sid) => { const L = getLive(sid); const f = path.join(L.rt.st.cwd, 'CAELIX.md'); if (!fs.existsSync(f)) fs.writeFileSync(f, '# Project instructions\n\n- Describe how to build, test and run this project.\n- Note code style rules the agent must follow.\n'); return f; });

  handle('chat:reset', async (sid) => {
    const L = getLive(sid); L.ctrl = new AbortController(); const env = envFor(L);
    const ok = await E().agent.resetContext(L.rt, env, 'manual'); if (ok) L.items.push({ type: 'info', text: 'Context reset: history summarised, memory kept.' }); saveSession(L);
    return { ok, ctx: E().agent.estTokens(L.rt.messages), breakdown: E().agent.breakdown(L.rt.messages) };
  });
  handle('mcp:list', async (sid, cwd, force) => {
    cwd = cwd || CHAT_DIR; const cfg = E().config; const settings = cfg.loadSettings(userDir(), cwd); const conn = await getMcp(cwd, settings, force);
    const entries = [];
    for (const s of conn.servers.filter((x) => x.builtin)) entries.push({ name: s.name, scope: 'built-in', builtin: true, tools: s.tools.length, desc: E().mcpBuiltinDesc(s.name), disabled: false });
    for (const n of settings.builtinOff || []) entries.push({ name: n, scope: 'built-in', builtin: true, tools: 0, desc: E().mcpBuiltinDesc(n), disabled: true });
    for (const e of cfg.listMcp(userDir(), cwd === CHAT_DIR ? null : cwd)) { const live = conn.servers.find((x) => x.name === e.name && !x.builtin); const err = conn.errors.find((x) => x.startsWith(e.name + ':')); entries.push({ name: e.name, scope: e.scope, tools: live ? live.tools.length : 0, desc: e.cfg.url || [e.cfg.command].concat(e.cfg.args || []).join(' '), disabled: e.disabled, error: err || '' }); }
    return entries;
  });
  handle('mcp:add', (cwd, o) => { E().config.addMcp(userDir(), cwd === CHAT_DIR ? null : cwd, o); return true; });
  handle('mcp:remove', (cwd, name, scope) => E().config.removeMcp(userDir(), cwd, name, scope));
  handle('mcp:toggle', (cwd, name, scope, disabled, builtin) => { if (builtin) E().config.toggleBuiltin(userDir(), name, disabled); else E().config.toggleMcp(userDir(), cwd, name, scope, disabled); return true; });
  handle('mcp:import', () => E().config.importClaudeMcp(userDir()));
  handle('hooks:list', (cwd) => E().config.listHooks(userDir(), cwd === CHAT_DIR ? null : cwd));
  handle('hooks:add', (cwd, h) => E().config.addHook(userDir(), cwd === CHAT_DIR ? null : cwd, h));
  handle('hooks:remove', (cwd, id, scope) => E().config.removeHook(userDir(), cwd, id, scope));
  handle('hooks:toggle', (cwd, id, scope, en) => E().config.toggleHook(userDir(), cwd, id, scope, en));
  handle('memory:info', (cwd) => { const files = E().config.memoryFiles(userDir(), cwd === CHAT_DIR ? null : cwd); const g = require('./src/engine/builtin').globalMemoryText(userDir()); return { count: files.length + (g ? 1 : 0), files: files.map((f) => ({ ...f, text: fs.readFileSync(f.file, 'utf8').slice(0, 6000) })), global: g }; });
  handle('agents:list', (cwd) => { const out = [{ name: 'Explore', desc: 'Read-only search of the codebase' }, { name: 'Plan', desc: 'Design an approach before coding' }, { name: 'General', desc: 'Full-tool helper for a sub-task' }]; try { const d = path.join(cwd, '.caelix', 'agents'); for (const f of fs.readdirSync(d)) if (f.endsWith('.md')) out.push({ name: f.replace(/\.md$/, ''), desc: 'Custom agent' }); } catch (_) {} return out; });
  handle('fav:get', () => readProv().fav || []);
  handle('fav:toggle', (key) => { const pv = readProv(); const f = new Set(pv.fav || []); f.has(key) ? f.delete(key) : f.add(key); pv.fav = Array.from(f); writeProv(pv); return pv.fav; });
  handle('docs:open', () => { fs.mkdirSync(CHAT_DIR, { recursive: true }); shell.openPath(CHAT_DIR); return CHAT_DIR; });
  handle('prompt:system', (sid) => E().agent.buildSystem(getLive(sid).rt, { userDir: userDir() }));

  handle('diff:get', (sid) => {
    const L = getLive(sid); const { diff } = E(); const out = [];
    for (const [file, orig] of L.rt.baseSnap) {
      const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null; if (cur === orig) continue;
      const d = diff.diffLines(orig || '', cur || ''); if (!d.add && !d.del) continue;
      out.push({ file, rel: path.relative(L.rt.st.cwd, file), status: orig === null ? 'added' : cur === null ? 'deleted' : 'modified', add: d.add, del: d.del, lines: d.lines.slice(0, 1500), start: d.startLine });
    }
    return out;
  });
  handle('files:list', (dir) => fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.name !== '.DS_Store' && e.name !== '.git').map((e) => ({ name: e.name, dir: e.isDirectory() })).sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name)));
  handle('files:read', (f) => { const st = fs.statSync(f); if (st.size > 1.5e6) throw new Error('File too large to open here'); const b = fs.readFileSync(f); if (b.includes(0)) throw new Error('Binary file'); return b.toString('utf8'); });
  handle('files:write', (f, text) => { fs.writeFileSync(f, text); return true; });
  handle('files:mentions', (cwd, q) => {
    const out = []; const stack = [cwd]; const ql = (q || '').toLowerCase();
    while (stack.length && out.length < 12) {
      const d = stack.shift(); let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { continue; }
      for (const e of ents) { if (['node_modules', '.git', 'dist'].includes(e.name) || e.name.startsWith('.')) continue; const f = path.join(d, e.name); if (e.isDirectory()) { if (stack.length < 200) stack.push(f); } else if (path.relative(cwd, f).toLowerCase().includes(ql)) out.push(path.relative(cwd, f)); if (out.length >= 12) break; }
    }
    return out;
  });
  handle('pick:folder', async () => { const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
  handle('pick:files', async () => { const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] }); return r.canceled ? [] : r.filePaths; });
  handle('git:branch', (cwd) => new Promise((res) => execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd }, (e, o) => res(e ? '' : o.trim()))));
  handle('shell:reveal', (f) => { shell.showItemInFolder(f); return true; });
  handle('shell:open', (u) => { if (/^https?:/.test(u)) shell.openExternal(u); return true; });
  handle('settings:get', (cwd) => E().config.loadSettings(userDir(), cwd || app.getPath('home')));
  handle('settings:set', (patch) => { E().config.saveUserSetting(userDir(), patch); return true; });
  handle('perm:rules', (cwd) => E().config.loadSettings(userDir(), cwd).permissions);
  handle('skills:list', (cwd) => { const out = []; for (const d of [path.join(cwd, '.caelix', 'skills'), path.join(app.getPath('home'), '.caelix', 'skills')]) { try { for (const n of fs.readdirSync(d)) if (fs.existsSync(path.join(d, n, 'SKILL.md'))) out.push(n); } catch (_) {} } return out; });

  // terminal pane: one persistent shell per session (no pty)
  const terms = new Map();
  handle('term:run', (sid, cmd) => {
    const L = getLive(sid); let t = terms.get(sid);
    if (!t) {
      const sh = spawn('/bin/bash', ['--noprofile', '--norc'], { cwd: L.rt.st.cwd, env: { ...process.env, TERM: 'dumb', PS1: '' } });
      const out = (d) => send('term', { sid, data: d.toString() }); sh.stdout.on('data', out); sh.stderr.on('data', out);
      sh.on('close', () => terms.delete(sid)); t = { sh }; terms.set(sid, t);
    }
    t.sh.stdin.write(cmd + '\n'); return true;
  });
  handle('term:kill', (sid) => { const t = terms.get(sid); if (t) { t.sh.kill(); terms.delete(sid); } return true; });

  ipcMain.on('ui-ready', () => { timing.uiReady = Date.now() - BOOT; });
  handle('timing', () => timing);
  handle('selfcheck:report', (r) => { global.__selfcheckRenderer = r; return true; });
}

function buildMenu() {
  const t = [
    { label: 'CAELIX', submenu: [{ role: 'about', label: 'About CAELIX' }, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide', label: 'Hide CAELIX' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit', label: 'Quit CAELIX' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(t));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1408, height: 881, minWidth: 900, minHeight: 600, show: false, title: 'CAELIX', icon: ICON,
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 17 }, backgroundColor: '#05070d',
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  win.once('ready-to-show', () => { timing.windowShown = Date.now() - BOOT; win.show(); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  const { createKeyStore } = require('./src/engine/keys'); const { createSessionStore } = require('./src/engine/sessions');
  keys = createKeyStore(userDir(), safeStorage); store = createSessionStore(userDir());
  app.setAboutPanelOptions({ applicationName: 'CAELIX', applicationVersion: '2.0.0', copyright: 'CAELIX', iconPath: ICON });
  if (process.platform === 'darwin' && app.dock) { try { app.dock.setIcon(nativeImage.createFromPath(ICON)); } catch (_) {} }
  buildMenu(); registerIpc(); createWindow();
  if (SELF) require('./src/selfcheck').run({ app, getWin: () => win, timing, ROOT, userDir, keys, live });
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin' || SELF) app.quit(); });
app.on('before-quit', () => { for (const L of live.values()) { try { if (L.ctrl) L.ctrl.abort(); saveSession(L); } catch (_) {} } for (const c of mcpPool.values()) Promise.resolve(c).then((x) => x && x.stop && x.stop()).catch(() => {}); });
