'use strict';
// MCP client: stdio and HTTP servers, plus CAELIX's built-in in-process servers. Tools appear as mcp__<server>__<tool>.
const { spawn } = require('child_process');
const { builtins } = require('./builtin');

class McpStdio {
  constructor(name, cfg, cwd) { this.name = name; this.cfg = cfg; this.cwd = cwd; this.id = 0; this.pending = new Map(); this.buf = ''; this.tools = []; }
  start() {
    return new Promise((resolve, reject) => {
      const done = (fn, v) => { clearTimeout(timer); fn(v); };
      const timer = setTimeout(() => reject(new Error('timed out starting ' + this.name)), 20000);
      try { this.proc = spawn(this.cfg.command, this.cfg.args || [], { cwd: this.cwd, env: { ...process.env, ...(this.cfg.env || {}) }, stdio: ['pipe', 'pipe', 'ignore'] }); } catch (e) { return done(reject, e); }
      this.proc.on('error', (e) => done(reject, e));
      this.proc.stdout.on('data', (d) => {
        this.buf += d; let i;
        while ((i = this.buf.indexOf('\n')) >= 0) {
          const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1); if (!line) continue;
          let m; try { m = JSON.parse(line); } catch (_) { continue; }
          const p = m.id != null && this.pending.get(m.id); if (p) { this.pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
        }
      });
      this.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'CAELIX', version: '2.0.0' } })
        .then(() => { this.notify('notifications/initialized'); return this.rpc('tools/list', {}); })
        .then((r) => { this.tools = r.tools || []; done(resolve, this); }).catch((e) => done(reject, e));
    });
  }
  rpc(method, params) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); }); }
  notify(method, params) { this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); }
  async call(tool, args) { const r = await this.rpc('tools/call', { name: tool, arguments: args }); return (r.content || []).map((c) => c.text || JSON.stringify(c)).join('\n') || '(no output)'; }
  stop() { try { this.proc.kill(); } catch (_) {} }
}

class McpHttp {
  constructor(name, cfg) { this.name = name; this.cfg = cfg; this.id = 0; this.tools = []; this.sid = null; }
  async rpc(method, params, notify) {
    const body = notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: ++this.id, method, params };
    const h = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(this.cfg.headers || {}) }; if (this.sid) h['mcp-session-id'] = this.sid;
    const r = await fetch(this.cfg.url, { method: 'POST', headers: h, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    if (r.headers.get('mcp-session-id')) this.sid = r.headers.get('mcp-session-id');
    if (notify) return null; if (!r.ok) throw new Error('HTTP ' + r.status);
    const txt = await r.text(); let m;
    if ((r.headers.get('content-type') || '').includes('event-stream')) { const datas = txt.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()); for (const d of datas) { try { const j = JSON.parse(d); if (j.id === body.id) m = j; } catch (_) {} } } else m = JSON.parse(txt);
    if (!m) throw new Error('empty MCP response'); if (m.error) throw new Error(m.error.message); return m.result;
  }
  async start() { await this.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'CAELIX', version: '2.0.0' } }); await this.rpc('notifications/initialized', {}, true); this.tools = (await this.rpc('tools/list', {})).tools || []; return this; }
  async call(tool, args) { const r = await this.rpc('tools/call', { name: tool, arguments: args }); return (r.content || []).map((c) => c.text || JSON.stringify(c)).join('\n') || '(no output)'; }
  stop() {}
}

// servers: {name: {command,args,env} | {url,headers}}; opts: {userDir, disabled:[names], builtinsOff:[names]}
async function connectAll(servers, cwd, opts) {
  opts = opts || {}; const dis = new Set(opts.disabled || []); const out = []; const errors = [];
  if (opts.userDir) { const b = builtins(opts.userDir, cwd); for (const [name, s] of Object.entries(b)) if (!dis.has(name)) out.push({ name, builtin: true, tools: s.tools, call: s.call, stop() {} }); }
  await Promise.all(Object.entries(servers || {}).filter(([n, c]) => !dis.has(n) && !c.disabled).map(async ([name, cfg]) => {
    try { out.push(await (cfg.url ? new McpHttp(name, cfg) : new McpStdio(name, cfg, cwd)).start()); } catch (e) { errors.push(`${name}: ${e.message}`); }
  }));
  const defs = []; const route = {};
  for (const s of out) for (const t of s.tools) {
    const n = `mcp__${s.name}__${t.name}`; route[n] = { server: s, tool: t.name };
    defs.push({ type: 'function', function: { name: n, description: t.description || '', parameters: t.inputSchema || { type: 'object', properties: {} } } });
  }
  return { defs, route, servers: out, errors, stop() { out.forEach((s) => s.stop()); } };
}
module.exports = { connectAll };
