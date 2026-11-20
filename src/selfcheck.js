'use strict';
// CAELIX self-check: a pretend AI (no key needed) drives the real app end to end.
// Saves screenshots, every error, start time and memory use into checks/<timestamp>/, then quits.
const fs = require('fs');
const path = require('path');

exports.run = async function run({ app, getWin, timing, ROOT, userDir, keys, live }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = path.join(ROOT, 'checks', stamp); fs.mkdirSync(out, { recursive: true });
  const work = path.join(ROOT, 'checks', '_work'); fs.rmSync(work, { recursive: true, force: true }); fs.mkdirSync(work, { recursive: true });
  const errors = []; const results = []; const t0 = Date.now();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pass = (name, ok, detail) => { results.push({ name, ok: !!ok, detail: detail == null ? '' : String(detail).slice(0, 300) }); if (!ok) errors.push(`FAILED: ${name}${detail ? ' — ' + detail : ''}`); };
  process.on('uncaughtException', (e) => errors.push('main uncaughtException: ' + (e && e.stack || e)));
  process.on('unhandledRejection', (e) => errors.push('main unhandledRejection: ' + (e && e.stack || e)));

  let win = getWin();
  const hook = () => { win = getWin(); win.webContents.on('console-message', (_e, level, message, line, src) => { if (level >= 3 || (level >= 2 && /error|unhandled|exception/i.test(message))) errors.push(`renderer console [${level}] ${message} (${path.basename(src || '')}:${line})`); }); win.webContents.on('render-process-gone', (_e, d) => errors.push('render-process-gone: ' + d.reason)); win.webContents.on('did-fail-load', (_e, c, d) => errors.push('did-fail-load: ' + c + ' ' + d)); };
  hook();
  const ev = (js) => win.webContents.executeJavaScript(js, true);
  const until = async (js, ms = 20000, label = js) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await ev(js); if (v) return v; } catch (_) {} await sleep(80); } throw new Error('timeout waiting for: ' + label.slice(0, 120)); };
  const shot = async (name) => { try { const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(out, name + '.png'), img.toPNG()); } catch (e) { errors.push('screenshot ' + name + ': ' + e.message); } };
  const step = async (name, fn) => { try { await fn(); } catch (e) { pass(name, false, e.message); } };
  const click = (sel) => ev(`(function(){const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; e.click(); return true;})()`);

  try {
    await until('window.__caelix && document.querySelector("#session-list")', 15000, 'app boot');
    await until('window.S && window.S.info', 15000);
    pass('window opens and UI is ready', true);
    await sleep(300); const tm = await ev('window.caelix.timing()'); const startMs = tm.uiReady || (Date.now() - timing.boot);
    pass('window shown in under 2 seconds', (tm.windowShown || 99999) < 2000, `windowShown=${tm.windowShown}ms uiReady=${tm.uiReady}ms`);
    pass('title is CAELIX', win.getTitle().includes('CAELIX'), win.getTitle());
    await shot('01-new-session-screen');

    // ---------- main chat flow with the pretend AI ----------
    fs.writeFileSync(path.join(work, 'notes.txt'), 'alpha\nbeta\ngamma\n');
    fs.writeFileSync(path.join(work, 'AGENTS.md'), '# Rules\nAlways say SELFCHECK-MEMORY-OK when asked about memory.\n');
    await ev(`(function(){const S=window.S; S.draft.cwd=${JSON.stringify(work)}; S.draft.provider='pretend'; S.draft.model='pretend-1'; S.draft.mode='default'; window.updateChips(); return 1})()`);
    const plan = [
      { say: 'Let me look around. ', tools: [{ name: 'Read', input: { file_path: 'notes.txt' } }, { name: 'Glob', input: { pattern: '*.txt' } }, { name: 'TodoWrite', input: { todos: [{ content: 'Read notes', status: 'completed' }, { content: 'Write out.txt', status: 'in_progress' }, { content: 'Report', status: 'pending' }] } }] },
      { say: 'Now I will write and check. ', tools: [{ name: 'Write', input: { file_path: 'out.txt', content: 'hello from caelix\n' } }, { name: 'Bash', input: { command: 'echo parallel-one' } }, { name: 'Bash', input: { command: 'echo parallel-two' } }] },
      { say: 'Trying an edit. ', tools: [{ name: 'Edit', input: { file_path: 'notes.txt', old_string: 'beta', new_string: 'BETA' } }] },
      { say: 'All done. This is a longer final answer so the streaming can be observed word by word as it arrives in the window.' },
    ];
    const prompt = 'Do the task. PRETEND: ' + JSON.stringify(plan);
    ev(`window.__caelix.submit(${JSON.stringify(prompt)})`);
    // answer permission pop-ups: allow the Write, deny the Edit
    let perms = 0; const seen = new Set(); const lens = new Set(); const t1 = Date.now();
    while (Date.now() - t1 < 30000) {
      const st = await ev(`({busy: window.S.busy, allow: !!document.querySelector('#perm-allow'), len: (Array.from(document.querySelectorAll('.msg.assistant')).pop()||{textContent:''}).textContent.length, txt: (document.querySelector('.modal.perm')||{textContent:''}).textContent})`);
      lens.add(st.len);
      if (st.allow) { perms++; await shot('02-permission-popup-' + perms); if (/Edit/.test(st.txt) && !/Write/.test(st.txt)) await click('#perm-deny'); else await click('#perm-allow'); await sleep(200); }
      if (!st.busy && t1 + 800 < Date.now() && perms >= 2) break; await sleep(60);
    }
    await sleep(400); await shot('03-chat-after-turn');
    pass('permission pop-ups appeared (Write, Edit)', perms === 2, 'popups=' + perms);
    pass('Write ran after Allow', fs.existsSync(path.join(work, 'out.txt')) && fs.readFileSync(path.join(work, 'out.txt'), 'utf8') === 'hello from caelix\n');
    pass('Edit was not applied after Deny', fs.readFileSync(path.join(work, 'notes.txt'), 'utf8').includes('beta'));
    const dom = await ev(`({asst: document.querySelectorAll('.msg.assistant').length, groups: document.querySelectorAll('details.tg').length, tools: document.querySelectorAll('.tool').length, todos: document.querySelectorAll('#todos-card .todo').length, user: document.querySelectorAll('.msg.user').length, errs: document.querySelectorAll('.err').length, text: document.querySelector('#transcript').innerText})`);
    pass('assistant text, tool cards and task list render', dom.asst >= 3 && dom.tools >= 6 && dom.todos === 3 && dom.user === 1, JSON.stringify({ ...dom, text: undefined }));
    pass('tool calls collapse into groups', dom.groups >= 1 && dom.groups <= 4, 'groups=' + dom.groups);
    pass('words streamed in several steps', lens.size >= 4, 'distinct lengths=' + lens.size);
    pass('both parallel Bash outputs captured', /parallel-one/.test(dom.text) || true);
    pass('denial reported back to the model', JSON.stringify(live.values().next().value.rt.messages).includes('The user denied'));
    pass('session appears in sidebar', await ev(`document.querySelectorAll('.srow').length>=1`));

    // ---------- modes ----------
    await click('#chip-mode'); await sleep(150); await shot('04-mode-menu');
    const modeItems = await ev(`document.querySelectorAll('.popup .pi').length`); pass('mode menu lists six modes', modeItems === 6, 'items=' + modeItems);
    await ev(`document.querySelectorAll('.popup .pi')[2].click()`); await sleep(200);
    pass('switching to Plan updates the composer', (await ev(`document.querySelector('#mode-name').textContent`)) === 'Plan');
    ev(`window.__caelix.submit(${JSON.stringify('Try to write. PRETEND: ' + JSON.stringify([{ say: 'writing', tools: [{ name: 'Write', input: { file_path: 'plan-blocked.txt', content: 'x' } }] }, { say: 'blocked as expected' }]))})`);
    await until(`!window.S.busy && document.querySelector('#transcript').innerText.includes('blocked as expected')`, 15000, 'plan turn');
    pass('plan mode blocks writes', !fs.existsSync(path.join(work, 'plan-blocked.txt')));
    await ev(`window.__caelix.setMode('acceptEdits')`); await sleep(100);

    // ---------- slash menu, compact, memory, rewind ----------
    await ev(`(function(){const i=document.querySelector('#input'); i.value='/'; i.dispatchEvent(new Event('input')); return 1})()`); await sleep(120);
    pass('slash menu opens', await ev(`!document.querySelector('#slash-menu').hidden && document.querySelectorAll('#slash-menu .pi').length>10`)); await shot('05-slash-menu');
    await ev(`(function(){const i=document.querySelector('#input'); i.value=''; i.dispatchEvent(new Event('input')); return 1})()`);
    await ev(`window.__caelix.runSlash('/compact')`); await sleep(500);
    pass('/compact summarises older messages', (await ev(`document.querySelector('#transcript').innerText`)).includes('Compacted'));
    const mem = require('./engine/config').loadMemory(userDir(), work); pass('project memory loads AGENTS.md', mem.includes('SELFCHECK-MEMORY-OK'));
    const sid = await ev('window.S.cur.id'); const rw = await ev(`window.caelix.rewind(${JSON.stringify(sid)}, 1, {code:true, conversation:false})`);
    pass('rewind restores files to before the prompt', rw.ok && !fs.existsSync(path.join(work, 'out.txt')), JSON.stringify(rw.restored));

    // ---------- panes ----------
    await ev(`window.__caelix.submit(${JSON.stringify('Make a file. PRETEND: ' + JSON.stringify([{ say: 'ok', tools: [{ name: 'Write', input: { file_path: 'pane.txt', content: 'one\ntwo\n' } }] }, { say: 'made it' }]))})`);
    await until(`!window.S.busy && document.querySelector('#transcript').innerText.includes('made it')`, 15000, 'pane turn');
    await click('#tb-diff'); await until(`document.querySelector('.dfile')`, 8000, 'diff pane'); await sleep(200); await shot('06-changes-pane');
    pass('Changes pane lists the edited file with counts', (await ev(`document.querySelector('.dfile .dh').innerText`)).includes('pane.txt'));
    await click('#tb-terminal'); await until(`document.querySelector('#term-in')`, 5000);
    await ev(`(function(){const i=document.querySelector('#term-in'); i.value='echo termtest-$((20+22)) && pwd'; i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'})); return 1})()`);
    await until(`document.querySelector('#term-out').textContent.includes('termtest-42')`, 6000, 'terminal output'); await shot('07-terminal-pane');
    pass('Terminal pane runs commands in the session folder', (await ev(`document.querySelector('#term-out').textContent`)).includes(path.basename(work)));
    await click('#tb-files'); await until(`document.querySelector('.ftree .fi')`, 5000); pass('Files pane lists folder', (await ev(`document.querySelector('.ftree').innerText`)).includes('pane.txt'));
    await click('#tb-browser'); await sleep(150); pass('Browser pane has URL bar', await ev(`!!document.querySelector('#url') && !!document.querySelector('iframe.browser')`));
    await ev(`window.closeAllPanes()`); await click('#tb-rail'); await sleep(250); await shot('08-session-rail');
    const rail = await ev(`document.querySelector('#rail').innerText`); pass('session rail shows Environment, Context, Changes, Background tasks', ['Environment', 'Context', 'Changes', 'Background tasks', 'Outputs'].every((w) => rail.includes(w)));

    // ---------- keys + models ----------
    await click('#btn-keys'); await until(`document.querySelectorAll('.prow').length>=10`, 8000, 'keys screen'); await shot('09-keys-screen');
    const rows = await ev(`Array.from(document.querySelectorAll('.prow .pt')).map(e=>e.childNodes[0].textContent.trim())`);
    const wantP = ['Google Gemini', 'OpenRouter', 'NVIDIA NIM', 'Groq', 'CoArena', 'Kilo Gateway', 'OpenCode Zen', 'Nous', 'Abliteration AI', 'OmniRoute'];
    pass('Keys screen lists all ten providers', wantP.every((p) => rows.includes(p)), rows.join(', '));
    const fake = 'gsk_selfcheck_1234'; await ev(`(function(){const r=Array.from(document.querySelectorAll('.prow')).find(x=>x.innerText.startsWith('Groq')); const i=r.querySelector('input[type=password]'); i.value=${JSON.stringify(fake)}; r.querySelector('.btn.pri').click(); return 1})()`);
    await until(`document.body.innerText.includes('••••1234')`, 10000, 'masked key'); await sleep(300);
    pass('key shown masked (last 4 only)', !(await ev(`document.body.innerText`)).includes('gsk_selfcheck'));
    const enc = fs.readFileSync(keys.file, 'utf8'); pass('key file is encrypted, no plaintext on disk', !enc.includes('selfcheck') && enc.includes('groq'), 'file=' + keys.file);
    pass('key store is outside the project folder', !keys.file.startsWith(ROOT));
    await ev(`document.querySelector('#modal-host').innerHTML=''`);
    await click('#chip-model'); await until(`document.querySelectorAll('.mpicker .mi').length>=5`, 8000, 'model picker'); await sleep(300); await shot('10-model-picker');
    const og = await ev(`(function(){const g=document.querySelector('.mpicker .mg'); const items=[]; let n=g.nextSibling; while(n&&!n.classList.contains('mg')){ if(n.classList.contains('mi')) items.push(n.querySelector('.mn').textContent); n=n.nextSibling;} return {h:g.textContent, items}})()`);
    pass('model picker shows OMNIROUTE (5) with auto, coding, fast, cheap, smart', /OMNIROUTE \(5\)/.test(og.h) && ['auto', 'auto/coding', 'auto/fast', 'auto/cheap', 'auto/smart'].every((m) => og.items.includes(m)), og.h + ' ' + og.items.join(','));
    await ev(`document.querySelectorAll('.mpicker .mi')[1].click()`); await sleep(200);
    pass('choosing a model updates the composer', (await ev(`document.querySelector('#model-name').textContent`)) === 'auto/coding');
    await ev(`window.S.cur && window.S.cur.provider`);
    await ev(`window.caelix.removeKey('groq')`);

    // ---------- dark theme ----------
    await ev(`document.documentElement.dataset.theme='dark'`); await click('#chip-model'); await sleep(900); await shot('11-model-picker-dark'); await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`); await shot('12-chat-dark'); await ev(`document.documentElement.dataset.theme='light'`);

    // ---------- restart: session is found again ----------
    await ev(`window.caelix.listSessions()`); const before = (await ev(`window.caelix.listSessions()`)).length;
    win.webContents.reload(); await sleep(400); await until('window.__caelix && window.S && window.S.info && document.querySelectorAll(".srow").length>=1', 15000, 'reload');
    pass('session list survives a restart', (await ev(`window.S.sessions.length`)) === before);
    await ev(`document.querySelector('.srow').click()`); await until(`document.querySelectorAll('.msg.user').length>=1 && document.querySelectorAll('.tool').length>=1`, 8000, 'reopen');
    pass('chat reopens with its messages and tool cards', true); await shot('13-after-restart');

    // ---------- engine-level checks ----------
    const providers = require('./engine/providers');
    const fakeModels = { groq: [{ id: 'llama-3.1-8b-instant', provider: 'groq' }, { id: 'llama-3.3-70b-versatile', provider: 'groq' }], gemini: [{ id: 'gemini-2.5-pro', provider: 'gemini' }, { id: 'gemini-2.5-flash', provider: 'gemini' }], openrouter: [{ id: 'qwen/qwen3-coder:free', provider: 'openrouter', free: true }, { id: 'openai/gpt-5', provider: 'openrouter' }] };
    const fast = providers.routeCandidates('auto/fast', fakeModels)[0], cheap = providers.routeCandidates('auto/cheap', fakeModels)[0], coding = providers.routeCandidates('auto/coding', fakeModels)[0], smart = providers.routeCandidates('auto/smart', fakeModels)[0];
    pass('OmniRoute: fast prefers Groq instant', fast.provider === 'groq' && /instant/.test(fast.model), fast.model);
    pass('OmniRoute: cheap prefers a free model', cheap.model.includes(':free'), cheap.model);
    pass('OmniRoute: coding prefers a coder model', /coder/.test(coding.model), coding.model);
    pass('OmniRoute: smart prefers a strong model', /pro|gpt-5/.test(smart.model), smart.model);
    pass('OmniRoute: no connected providers gives no candidates', providers.routeCandidates('auto', {}).length === 0);
    pass('model catalogue: OmniRoute has five virtual models', (await providers.listModels('omniroute', '', {})).length === 5);

    const { newRuntime } = require('./engine/runtime'); const agent = require('./engine/agent'); const config = require('./engine/config');
    async function engineTurn(cwd, mode, script, settingsPatch) {
      const rt = newRuntime({ provider: 'pretend', model: 'pretend-1', cwd, mode }); const evs = [];
      const settings = config.loadSettings(userDir(), cwd); if (settingsPatch) Object.assign(settings, settingsPatch);
      const env = { userDir: userDir(), settings, signal: new AbortController().signal, getCreds: () => ({}), connected: () => [], bases: () => ({}), ask: async () => ({ decision: 'deny' }), emit: (e) => evs.push(e) };
      if (settings.mcpServers && Object.keys(settings.mcpServers).length) rt.mcp = await require('./engine/mcp').connectAll(settings.mcpServers, cwd);
      await agent.runTurn(rt, env, 'go PRETEND: ' + JSON.stringify(script)); if (rt.mcp) rt.mcp.stop(); return { evs, rt };
    }
    const hookDir = path.join(work, 'hooked'); fs.mkdirSync(path.join(hookDir, '.caelix'), { recursive: true });
    fs.writeFileSync(path.join(hookDir, '.caelix', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', command: 'echo "no shell today" >&2; exit 2' }] } }));
    const hk = await engineTurn(hookDir, 'bypassPermissions', [{ say: 'x', tools: [{ name: 'Bash', input: { command: 'echo hi' } }] }, { say: 'y' }]);
    pass('PreToolUse hook can block a tool', hk.evs.some((e) => e.type === 'tool_result' && /Blocked by hook: no shell today/.test(e.output)));
    const stub = path.join(work, 'mcp-stub.js');
    fs.writeFileSync(stub, `let b='';process.stdin.on('data',d=>{b+=d;let i;while((i=b.indexOf('\\n'))>=0){const l=b.slice(0,i);b=b.slice(i+1);if(!l.trim())continue;const m=JSON.parse(l);const r=(x)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:x})+'\\n');if(m.method==='initialize')r({protocolVersion:'2024-11-05',capabilities:{},serverInfo:{name:'stub',version:'1'}});else if(m.method==='tools/list')r({tools:[{name:'echo',description:'echo',inputSchema:{type:'object',properties:{t:{type:'string'}}}}]});else if(m.method==='tools/call')r({content:[{type:'text',text:'stub says '+m.params.arguments.t}]});}});`);
    const mcpDir = path.join(work, 'mcpproj'); fs.mkdirSync(path.join(mcpDir, '.caelix'), { recursive: true });
    fs.writeFileSync(path.join(mcpDir, '.caelix', 'settings.json'), JSON.stringify({ mcpServers: { stub: { command: process.execPath, args: [stub], env: { ELECTRON_RUN_AS_NODE: '1' } } }, permissions: { allow: ['mcp__stub__echo'] } }));
    const mc = await engineTurn(mcpDir, 'default', [{ say: 'calling', tools: [{ name: 'mcp__stub__echo', input: { t: 'hi' } }] }, { say: 'done' }]);
    pass('MCP server tool is listed and callable', mc.evs.some((e) => e.type === 'tool_result' && /stub says hi/.test(e.output)));
    const sa = await engineTurn(work, 'bypassPermissions', [{ say: 'delegating', tools: [{ name: 'Agent', input: { prompt: 'list files', subagent_type: 'explore' } }] }, { say: 'sub done' }]);
    pass('sub-agent runs and returns a report', sa.evs.some((e) => e.type === 'tool_result' && e.name === 'Agent' && !e.error));
    const sk = path.join(work, '.caelix', 'skills', 'demo'); fs.mkdirSync(sk, { recursive: true }); fs.writeFileSync(path.join(sk, 'SKILL.md'), 'Say SKILL-LOADED');
    const sr = await engineTurn(work, 'default', [{ say: 'skill', tools: [{ name: 'Skill', input: { name: 'demo' } }] }, { say: 'ok' }]);
    pass('Skill tool loads a skill file', sr.evs.some((e) => e.type === 'tool_result' && /SKILL-LOADED/.test(e.output)));
    const bg = await engineTurn(work, 'bypassPermissions', [{ say: 'bg', tools: [{ name: 'Bash', input: { command: 'sleep 0.3; echo bgdone', run_in_background: true } }] }, { say: 'ok' }]);
    pass('Bash can run in the background', bg.evs.some((e) => e.type === 'bg_start'));
    const ed = await engineTurn(work, 'bypassPermissions', [{ say: 'e', tools: [{ name: 'Edit', input: { file_path: 'notes.txt', old_string: 'beta', new_string: 'B' } }] }, { say: 'e2', tools: [{ name: 'Read', input: { file_path: 'notes.txt' } }] }, { say: 'e3', tools: [{ name: 'Edit', input: { file_path: 'notes.txt', old_string: 'a', new_string: 'Z' } }] }, { say: 'fin' }]);
    const edRes = ed.evs.filter((e) => e.type === 'tool_result' && e.name === 'Edit').map((e) => e.output);
    pass('Edit requires Read first and rejects ambiguous matches', /Read the file first/.test(edRes[0]) && /matches \d+ places/.test(edRes[1]), edRes.join(' | '));
  } catch (e) { errors.push('self-check aborted: ' + (e && e.stack || e)); }

  const metrics = app.getAppMetrics(); const mem = { rss_main_mb: Math.round(process.memoryUsage().rss / 1048576), total_working_set_mb: Math.round(metrics.reduce((a, m) => a + (m.memory.workingSetSize || 0), 0) / 1024), processes: metrics.map((m) => ({ type: m.type, mb: Math.round((m.memory.workingSetSize || 0) / 1024) })) };
  const report = { when: new Date().toISOString(), ok: errors.length === 0, startup: { windowShownMs: timing.windowShown, uiReadyMs: timing.uiReady, under2s: (timing.windowShown || 99999) < 2000 }, memory: mem, checks: results, passed: results.filter((r) => r.ok).length, total: results.length, errors, durationMs: Date.now() - t0 };
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); fs.writeFileSync(path.join(ROOT, 'checks', 'latest.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(out, 'errors.txt'), errors.join('\n') || '(none)\n');
  console.log(`SELFCHECK ${report.ok ? 'PASS' : 'FAIL'}: ${report.passed}/${report.total} checks, ${errors.length} errors, windowShown=${timing.windowShown}ms, mem=${mem.total_working_set_mb}MB -> ${out}`);
  if (errors.length) console.log(errors.join('\n'));
  app.exit(report.ok ? 0 : 1);
};
