'use strict';
// Minimal MCP client over stdio (newline-delimited JSON-RPC 2.0). Tools appear as mcp__<server>__<tool>.
const { spawn } = require('child_process');

class McpServer {
  constructor(name, cfg, cwd) { this.name = name; this.cfg = cfg; this.cwd = cwd; this.id = 0; this.pending = new Map(); this.buf = ''; this.tools = []; }
  start() {
    return new Promise((resolve, reject) => {
      this.proc = spawn(this.cfg.command, this.cfg.args || [], { cwd: this.cwd, env: { ...process.env, ...(this.cfg.env || {}) }, stdio: ['pipe', 'pipe', 'ignore'] });
      this.proc.on('error', reject);
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
        .then((r) => { this.tools = r.tools || []; resolve(this); }).catch(reject);
      setTimeout(() => reject(new Error('MCP server timed out: ' + this.name)), 15000);
    });
  }
  rpc(method, params) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); }); }
  notify(method, params) { this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); }
  async call(tool, args) {
    const r = await this.rpc('tools/call', { name: tool, arguments: args });
    return (r.content || []).map((c) => c.text || JSON.stringify(c)).join('\n') || '(no output)';
  }
  stop() { try { this.proc.kill(); } catch (_) {} }
}

async function connectAll(servers, cwd) {
  const out = []; const errors = [];
  await Promise.all(Object.entries(servers || {}).map(async ([name, cfg]) => {
    try { out.push(await new McpServer(name, cfg, cwd).start()); } catch (e) { errors.push(`${name}: ${e.message}`); }
  }));
  const defs = []; const route = {};
  for (const s of out) for (const t of s.tools) {
    const n = `mcp__${s.name}__${t.name}`; route[n] = { server: s, tool: t.name };
    defs.push({ type: 'function', function: { name: n, description: t.description || '', parameters: t.inputSchema || { type: 'object', properties: {} } } });
  }
  return { defs, route, servers: out, errors, stop() { out.forEach((s) => s.stop()); } };
}
module.exports = { connectAll };
