'use strict';
// Proves: Claude models are archived, and every OmniRoute loop keeps going until a model answers.
// No key, no network. Run: node scripts/verify-routing.js
const assert = require('assert'); const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path');
delete process.env.CAELIX_SHOW_CLAUDE;
const providers = require('../src/engine/providers.js');
const agent = require('../src/engine/agent.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'caelix-v2-route-'));
providers.setArchiveFile(path.join(tmp, 'archive.json')); providers.setHealthFile(path.join(tmp, 'health.json'));
let pass = 0, fail = 0;
async function check(name, fn) { try { await fn(); pass++; console.log('ok   ' + name); } catch (e) { fail++; console.log('FAIL ' + name + '\n     ' + e.message); } }

const seen = []; let works = new Set(); const dead = new Set();
const srv = http.createServer((req, res) => {
  if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: ['aaa-coder', 'bbb-coder', 'ccc-coder', 'zzz-mini', 'anthropic/claude-sonnet-5.5', 'claude-opus-5-5'].map((id) => ({ id })) })); }
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const m = JSON.parse(raw).model; seen.push(m);
    if (!works.has(m)) { res.writeHead(503, { 'content-type': 'application/json' }); return res.end('{"error":"down"}'); }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'ok from ' + m } }] }) + '\n\n');
    res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'); res.end();
  });
});
(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const events = [];
  const mkEnv = (extra = {}) => ({ emit: (e) => events.push(e), connected: () => ['kilo'], getCreds: (p) => (p === 'omniroute' ? { key: '', base: extra.omniBase || '' } : { key: 'k', base }), bases: () => ({ kilo: base }) });
  const run = (rt, env) => { let text = ''; return agent.callModel(rt, env, [{ role: 'user', content: 'hi' }], [], (t) => { text += t; }).then((o) => ({ o, text })); };

  await check('Claude models are hidden from listing and recorded in the archive', async () => {
    const models = await providers.listModels('kilo', 'k', { kilo: base }, { force: true });
    assert(!models.some((m) => /claude/i.test(m.id)), 'a Claude model is still listed: ' + models.map((m) => m.id));
    const arch = providers.getArchive();
    assert(arch['kilo/anthropic/claude-sonnet-5.5'] && arch['kilo/claude-opus-5-5'], 'Claude models missing from the archive');
    assert(providers.isArchived('kilo', 'claude-anything') && !providers.isArchived('kilo', 'aaa-coder'));
  });

  await check('OmniRoute: three failing models, then the next objective finds the one that works', async () => {
    seen.length = 0; works = new Set(['zzz-mini']);
    const { text } = await run({ provider: 'omniroute', model: 'auto/coding' }, mkEnv());
    assert(/ok from zzz-mini/.test(text), 'final text: ' + text);
    assert(seen.length >= 4 && seen[seen.length - 1] === 'zzz-mini', 'order: ' + seen.join(' > '));
    assert(!seen.some((m) => /claude/i.test(m)), 'a Claude model was called');
    assert(events.some((e) => e.type === 'route_fail'), 'failures must be reported');
  });

  await check('a chat saved on a Claude model is routed instead of failing', async () => {
    seen.length = 0; works = new Set(['ccc-coder']); for (const m of ['aaa-coder', 'bbb-coder', 'ccc-coder', 'zzz-mini']) providers.markOk('kilo', m);
    const { text } = await run({ provider: 'kilo', model: 'anthropic/claude-sonnet-5.5' }, mkEnv());
    assert(/ok from ccc-coder/.test(text), text); assert(!seen.some((m) => /claude/i.test(m)), seen.join());
  });

  await check('self-hosted OmniRoute that fails falls through to connected providers', async () => {
    seen.length = 0; works = new Set(['aaa-coder']); for (const m of ['aaa-coder', 'bbb-coder', 'ccc-coder', 'zzz-mini']) providers.markOk('kilo', m);
    const { text } = await run({ provider: 'omniroute', model: 'auto/coding' }, mkEnv({ omniBase: base }));
    assert(seen[0] === 'auto/coding', 'the self-hosted gateway must be tried first: ' + seen.join());
    assert(/ok from /.test(text), text);
  });

  await check('with nothing connected the error says so', async () => {
    const env = mkEnv(); env.connected = () => [];
    await assert.rejects(run({ provider: 'omniroute', model: 'auto' }, env), /no connected providers/i);
  });

  await check('chain order rolls on after the chosen objective and wraps', () => {
    assert.deepStrictEqual(agent.omniChain('auto/smart'), ['auto/smart', 'auto/fast', 'auto/cheap', 'auto', 'auto/coding']);
  });

  srv.closeAllConnections && srv.closeAllConnections(); srv.close(); fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\n' + pass + '/' + (pass + fail) + ' v2 routing checks passed'); process.exit(fail ? 1 : 0);
})();
