#!/usr/bin/env node
'use strict';
// CAELIX command-line (print) mode:  caelix -p "prompt" [--provider id] [--model id] [--permission-mode m] [--output-format text|json|stream-json]
// Keys come from env vars CAELIX_KEY_<PROVIDER> (e.g. CAELIX_KEY_GROQ) because the encrypted store belongs to the desktop app.
const path = require('path');
const os = require('os');
const { runTurn } = require(path.join(__dirname, '../src/engine/agent'));
const { newRuntime } = require(path.join(__dirname, '../src/engine/runtime'));
const config = require(path.join(__dirname, '../src/engine/config'));
const providers = require(path.join(__dirname, '../src/engine/providers'));
const { connectAll } = require(path.join(__dirname, '../src/engine/mcp'));

const a = process.argv.slice(2); const get = (f, d) => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : d; };
if (a.includes('--help') || a.includes('-h') || !a.length) { console.log('usage: caelix -p "prompt" [--provider id] [--model id] [--permission-mode default|acceptEdits|plan|auto|bypassPermissions|dontAsk] [--output-format text|json|stream-json] [--allowedTools "Bash(npm *),Edit"] [--cwd dir]\nproviders: ' + providers.PROVIDERS.filter((p) => !p.hidden).map((p) => p.id).join(', ') + ', pretend'); process.exit(0); }
const prompt = get('-p', get('--print', null));
if (!prompt) { console.error('error: -p "prompt" is required'); process.exit(2); }
const provider = get('--provider', 'pretend'); const model = get('--model', provider === 'pretend' ? 'pretend-1' : 'auto');
const fmt = get('--output-format', 'text'); const cwd = path.resolve(get('--cwd', process.cwd()));
const userDir = path.join(os.homedir(), 'Library', 'Application Support', 'CAELIX');

(async () => {
  const settings = config.loadSettings(userDir, cwd);
  const allowed = get('--allowedTools', ''); if (allowed) settings.permissions.allow.push(...allowed.split(',').map((s) => s.trim()).filter(Boolean));
  const rt = newRuntime({ provider, model, cwd, mode: get('--permission-mode', settings.permissions.defaultMode || 'default') });
  rt.mcp = await connectAll(settings.mcpServers, cwd).catch(() => null);
  const ev = []; let text = ''; let denied = 0; const t0 = Date.now();
  const env = {
    userDir, settings, signal: new AbortController().signal,
    getCreds: (pid) => ({ key: process.env['CAELIX_KEY_' + pid.toUpperCase()] || '', base: process.env['CAELIX_BASE_' + pid.toUpperCase()] || '' }),
    connected: () => providers.PROVIDERS.filter((p) => !p.virtual && process.env['CAELIX_KEY_' + p.id.toUpperCase()]).map((p) => p.id),
    bases: () => ({}),
    ask: async () => { denied++; return { decision: 'deny', comment: 'non-interactive mode' }; },
    emit: (e) => {
      if (fmt === 'stream-json') console.log(JSON.stringify(e));
      if (e.type === 'text') { text += e.delta; if (fmt === 'text') process.stdout.write(e.delta); }
      if (e.type === 'error') { ev.push(e); if (fmt === 'text') console.error('\nerror: ' + e.message); }
    },
  };
  await runTurn(rt, env, prompt);
  if (fmt === 'text') process.stdout.write('\n');
  if (fmt === 'json') console.log(JSON.stringify({ type: 'result', is_error: ev.length > 0, result: text, errors: ev.map((e) => e.message), permission_denials: denied, usage: rt.usage, duration_ms: Date.now() - t0 }));
  if (rt.mcp) rt.mcp.stop();
  process.exit(ev.length ? 1 : 0);
})();
