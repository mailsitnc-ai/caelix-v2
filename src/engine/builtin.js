'use strict';
// Built-in "MCP servers" that run in-process: `desktop` (system info, git summary, open ports, clipboard) and `memory` (cross-chat store).
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const sh = (cmd, args, opts) => new Promise((res) => execFile(cmd, args, { timeout: 8000, maxBuffer: 1e6, ...opts }, (e, o, er) => res(e ? `(${cmd} failed: ${String(er || e.message).trim().slice(0, 200)})` : String(o).trim())));
const obj = (props, required) => ({ type: 'object', properties: props, required: required || [] });

function memFile(userDir) { return path.join(userDir, 'memory', 'global.json'); }
function readMem(userDir) { try { return JSON.parse(fs.readFileSync(memFile(userDir), 'utf8')); } catch (_) { return []; } }

function builtins(userDir, cwd) {
  return {
    desktop: {
      description: 'Built-in macOS system info, Git summary, open ports, and clipboard tools',
      tools: [
        { name: 'system_info', description: 'Operating system, CPU, memory and uptime of this computer.', inputSchema: obj({}) },
        { name: 'git_summary', description: 'Branch, status and recent commits of a git folder (default: the project folder).', inputSchema: obj({ path: { type: 'string' } }) },
        { name: 'open_ports', description: 'List TCP ports that are listening on this computer, with the process using each.', inputSchema: obj({}) },
        { name: 'clipboard', description: 'Read or write the system clipboard. action: read | write (text required for write).', inputSchema: obj({ action: { type: 'string', enum: ['read', 'write'] }, text: { type: 'string' } }, ['action']) },
      ],
      async call(tool, a) {
        if (tool === 'system_info') {
          const v = process.platform === 'darwin' ? await sh('sw_vers', []) : os.release();
          return `${v}\nCPU: ${os.cpus()[0] ? os.cpus()[0].model : '?'} x${os.cpus().length}\nMemory: ${(os.totalmem() / 2 ** 30).toFixed(1)} GB total, ${(os.freemem() / 2 ** 30).toFixed(1)} GB free\nUptime: ${(os.uptime() / 3600).toFixed(1)} h\nHost: ${os.hostname()}\nArch: ${os.arch()}`;
        }
        if (tool === 'git_summary') { const d = a.path ? path.resolve(cwd, a.path) : cwd; return [await sh('git', ['status', '-sb'], { cwd: d }), await sh('git', ['log', '--oneline', '-n', '8'], { cwd: d })].join('\n\n'); }
        if (tool === 'open_ports') return (await sh('lsof', ['-iTCP', '-sTCP:LISTEN', '-n', '-P'])).split('\n').slice(0, 60).join('\n');
        if (tool === 'clipboard') {
          if (a.action === 'write') return new Promise((res) => { const p = spawn('pbcopy'); p.on('error', () => res('(pbcopy unavailable)')); p.on('close', () => res('Copied to clipboard.')); p.stdin.end(a.text || ''); });
          const t = await sh('pbpaste', []); return t.length > 20000 ? t.slice(0, 20000) + '\n[truncated]' : t || '(clipboard is empty)';
        }
        return 'Unknown tool';
      },
    },
    memory: {
      description: 'Built-in cross-chat persistent memory store',
      tools: [
        { name: 'memory_save', description: 'Save a durable fact or preference that should be remembered in every future chat.', inputSchema: obj({ text: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }, ['text']) },
        { name: 'memory_search', description: 'Search saved memories by keyword.', inputSchema: obj({ query: { type: 'string' } }, ['query']) },
        { name: 'memory_list', description: 'List all saved memories.', inputSchema: obj({}) },
      ],
      async call(tool, a) {
        const list = readMem(userDir);
        if (tool === 'memory_save') { list.push({ id: Date.now().toString(36), text: String(a.text || '').slice(0, 2000), tags: a.tags || [], at: new Date().toISOString() }); fs.mkdirSync(path.dirname(memFile(userDir)), { recursive: true }); fs.writeFileSync(memFile(userDir), JSON.stringify(list, null, 1)); return `Saved (${list.length} memories).`; }
        if (tool === 'memory_search') { const q = String(a.query || '').toLowerCase(); const hit = list.filter((m) => m.text.toLowerCase().includes(q) || (m.tags || []).some((t) => t.toLowerCase().includes(q))); return hit.length ? hit.map((m) => `- ${m.text}`).join('\n') : 'No matching memories.'; }
        if (tool === 'memory_list') return list.length ? list.map((m) => `- ${m.text}`).join('\n') : 'No memories saved yet.';
        return 'Unknown tool';
      },
    },
  };
}
function globalMemoryText(userDir) { const l = readMem(userDir); return l.length ? l.map((m) => '- ' + m.text).join('\n') : ''; }
module.exports = { builtins, globalMemoryText };
