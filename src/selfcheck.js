'use strict';
// CAELIX self-check: a pretend AI (no key needed) drives the real app end to end.
// Saves screenshots, every error, start time and memory use into checks/<timestamp>/, then quits.
const fs = require('fs');
const os = require('os');
const path = require('path');

exports.run = async function run({ app, getWin, timing, ROOT, userDir, keys, live }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = path.join(ROOT, 'checks', stamp); fs.mkdirSync(out, { recursive: true });
  const work = path.join(ROOT, 'checks', '_work'); fs.rmSync(work, { recursive: true, force: true }); fs.mkdirSync(work, { recursive: true });
  const chatDir = path.join(os.tmpdir(), 'caelix-selfcheck-chats'); fs.rmSync(chatDir, { recursive: true, force: true });
  const errors = []; const results = []; const t0 = Date.now();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pass = (name, ok, detail) => { results.push({ name, ok: !!ok, detail: detail == null ? '' : String(detail).slice(0, 300) }); if (!ok) errors.push(`FAILED: ${name}${detail ? ' — ' + detail : ''}`); };
  process.on('uncaughtException', (e) => errors.push('main uncaughtException: ' + (e && e.stack || e)));
  process.on('unhandledRejection', (e) => errors.push('main unhandledRejection: ' + (e && e.stack || e)));

  let win = getWin();
  win.webContents.on('console-message', (_e, level, message, line, src) => { if (level >= 3 || (level >= 2 && /error|unhandled|exception/i.test(message))) errors.push(`renderer console [${level}] ${message} (${path.basename(src || '')}:${line})`); });
  win.webContents.on('render-process-gone', (_e, d) => errors.push('render-process-gone: ' + d.reason));
  win.webContents.on('did-fail-load', (_e, c, d) => errors.push('did-fail-load: ' + c + ' ' + d));
  const ev = (js) => win.webContents.executeJavaScript(js, true);
  const until = async (js, ms = 20000, label = js) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await ev(js); if (v) return v; } catch (_) {} await sleep(80); } throw new Error('timeout waiting for: ' + label.slice(0, 140)); };
  const shot = async (name) => { for (let k = 0; k < 3; k++) { try { const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(out, name + '.png'), img.toPNG()); return; } catch (e) { if (k === 2) errors.push('screenshot ' + name + ': ' + e.message); else await sleep(500); } } };
  const click = (sel) => ev(`(function(){const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; e.click(); return true;})()`);
  const closeModals = () => ev(`document.querySelector('#modal-host').innerHTML=''; document.querySelectorAll('.mpicker').forEach(n=>n.remove()); 1`);
  const waitIdle = (txt, ms = 20000) => until(`!window.S.busy && ${txt ? `document.querySelector('#transcript').innerText.includes(${JSON.stringify(txt)})` : 'true'}`, ms, 'turn idle ' + (txt || ''));
  const send = (text) => ev(`window.__caelix.submit(${JSON.stringify(text)})`);
  const pretend = (steps, lead) => (lead || 'Go. ') + 'PRETEND: ' + JSON.stringify(steps);

  try {
    await until('window.__caelix && document.querySelector("#session-list")', 15000, 'app boot');
    await until('window.S && window.S.info', 15000);
    pass('window opens and UI is ready', true);
    await sleep(300); const tm = await ev('window.caelix.timing()');
    pass('window shown in under 2 seconds', (tm.windowShown || 99999) < 2000, `windowShown=${tm.windowShown}ms uiReady=${tm.uiReady}ms`);
    pass('title is CAELIX', win.getTitle().includes('CAELIX'), win.getTitle());
    const imgs = await ev(`Array.from(document.images).map(i => ({src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0, w: i.naturalWidth}))`);
    pass('every logo image in the window loads', imgs.length >= 2 && imgs.every((i) => i.ok && i.w >= 128), JSON.stringify(imgs));

    // ---------- Chat mode: no folder, no file tools ----------
    pass('starts in Chat with no folder needed', await ev(`window.S.kind==='chat' && document.querySelector('#seg-chat').classList.contains('on') && document.querySelector('#chip-folder-top').hidden && !document.querySelector('#input').disabled`));
    pass('Chat hides permission modes', await ev(`document.querySelector('#chip-mode').hidden && document.querySelector('#chip-mode-top').hidden`));
    await ev(`(function(){const S=window.S; S.draft.provider='pretend'; S.draft.model='pretend-1'; window.updateChips(); return 1})()`); await shot('01-chat-new');
    await send(pretend([{ say: 'Chat mode here. ', tools: [{ name: 'Write', input: { file_path: 'nope.txt', content: 'x' } }, { name: 'WriteDocument', input: { filename: 'Debate Guide', content: '# Debate guide\n\n- Motion\n- Arguments\n\nSome **bold** text.', format: 'pdf' } }, { name: 'WriteDocument', input: { filename: 'notes', content: '# Notes\nhello', format: 'md' } }] }, { say: 'Saved your documents.' }], 'Make a guide. '));
    await waitIdle('Saved your documents.'); await sleep(300); await shot('02-chat-reply');
    const pdf = path.join(chatDir, 'Debate Guide.pdf'); const pdfOk = fs.existsSync(pdf) && fs.readFileSync(pdf).slice(0, 4).toString() === '%PDF';
    pass('Chat can write a PDF document into the chat folder', pdfOk, pdf + ' ' + (fs.existsSync(pdf) ? fs.statSync(pdf).size + ' bytes' : 'missing'));
    pass('Chat can write a Markdown document', fs.existsSync(path.join(chatDir, 'notes.md')));
    pass('Chat refuses file tools (no folder access)', !fs.existsSync(path.join(chatDir, 'nope.txt')) && (await ev(`document.querySelector('#transcript').innerText`)).includes('not available in Chat mode'));
    const chatDom = await ev(`({sum: document.querySelectorAll('.sumcard').length, tools: document.querySelectorAll('.tool').length, hdr: document.querySelectorAll('.msg.assistant .mh').length, perm: !!document.querySelector('#perm-allow')})`);
    pass('tool cards, CAELIX message header and summary card render', chatDom.tools === 3 && chatDom.sum === 1 && chatDom.hdr >= 2 && !chatDom.perm, JSON.stringify(chatDom));
    const chatSess = live.values().next().value; pass('chat session stores no project folder', chatSess.rt.kind === 'chat' && chatSess.rt.st.cwd === chatDir, chatSess.rt.st.cwd);

    // ---------- Code mode: folder required ----------
    await click('#seg-code'); await sleep(300); await shot('03-code-needs-folder');
    pass('Code without a folder blocks the composer and asks for one', await ev(`window.S.kind==='code' && document.querySelector('#input').disabled && !document.querySelector('#new-folder').hidden`));
    pass('Code mode shows Code sessions only (chat is not listed)', (await ev(`document.querySelectorAll('.srow').length`)) === 0);
    fs.writeFileSync(path.join(work, 'notes.txt'), 'alpha\nbeta\ngamma\n'); fs.writeFileSync(path.join(work, 'AGENTS.md'), '# Rules\nAlways say SELFCHECK-MEMORY-OK when asked about memory.\n');
    await ev(`(function(){const S=window.S; S.draft.cwd=${JSON.stringify(work)}; S.draft.mode='default'; window.__caelix.newScreen(); return 1})()`);
    pass('opening a folder enables the composer', await ev(`!document.querySelector('#input').disabled && document.querySelector('#folder-top-name').textContent==='_work'`));
    const plan = [
      { say: 'Let me look around. ', tools: [{ name: 'Read', input: { file_path: 'notes.txt' } }, { name: 'Glob', input: { pattern: '*.txt' } }, { name: 'TodoWrite', input: { todos: [{ content: 'Read notes', status: 'completed' }, { content: 'Write out.txt', status: 'in_progress' }, { content: 'Report', status: 'pending' }] } }] },
      { say: 'Now I will write and check. ', tools: [{ name: 'Write', input: { file_path: 'out.txt', content: 'hello from caelix\n' } }, { name: 'Bash', input: { command: 'echo parallel-one' } }, { name: 'Bash', input: { command: 'echo parallel-two' } }] },
      { say: 'Trying an edit. ', tools: [{ name: 'Edit', input: { file_path: 'notes.txt', old_string: 'beta', new_string: 'BETA' } }] },
      { say: 'All done. This is a longer final answer so the streaming can be observed word by word as it arrives in the window.' },
    ];
    send(pretend(plan, 'Do the task. '));
    let perms = 0; const lens = new Set(); const t1 = Date.now();
    while (Date.now() - t1 < 30000) {
      const st = await ev(`({busy: window.S.busy, allow: !!document.querySelector('#perm-allow'), len: (Array.from(document.querySelectorAll('.msg.assistant')).pop()||{textContent:''}).textContent.length, txt: (document.querySelector('.modal.perm')||{textContent:''}).textContent})`);
      lens.add(st.len);
      if (st.allow) { perms++; await shot('04-permission-popup-' + perms); if (/Edit/.test(st.txt) && !/Write/.test(st.txt)) await click('#perm-deny'); else await click('#perm-allow'); await sleep(200); }
      if (!st.busy && t1 + 800 < Date.now() && perms >= 2) break; await sleep(60);
    }
    await sleep(500); await shot('05-code-after-turn');
    pass('permission pop-ups appeared (Write, Edit)', perms === 2, 'popups=' + perms);
    pass('Write ran after Allow', fs.existsSync(path.join(work, 'out.txt')) && fs.readFileSync(path.join(work, 'out.txt'), 'utf8') === 'hello from caelix\n');
    pass('Edit was not applied after Deny', fs.readFileSync(path.join(work, 'notes.txt'), 'utf8').includes('beta'));
    const dom = await ev(`({asst: document.querySelectorAll('.msg.assistant').length, tools: document.querySelectorAll('.tool').length, todos: document.querySelectorAll('#todos-card .todo').length, user: document.querySelectorAll('.msg.user').length, sum: document.querySelector('.sumcard') ? document.querySelector('.sumcard').innerText : ''})`);
    pass('assistant text, tool cards, task list and summary render', dom.asst >= 3 && dom.tools >= 6 && dom.todos === 3 && dom.user === 1 && /Files changed/.test(dom.sum) && /1 failed/.test(dom.sum), JSON.stringify(dom).slice(0, 200));
    pass('words streamed in several steps', lens.size >= 4, 'distinct lengths=' + lens.size);
    pass('denial reported back to the model', JSON.stringify(Array.from(live.values()).find((l) => l.rt.kind === 'code').rt.messages).includes('The user denied'));
    pass('Code session is listed; Chat is separate', (await ev(`document.querySelectorAll('.srow').length`)) === 1);
    await click('#seg-chat'); await sleep(250); const chatRows = await ev(`document.querySelectorAll('.srow').length`); await click('#seg-code'); await sleep(200);
    pass('Chat tab lists only chats', chatRows === 1, 'rows=' + chatRows);
    await ev(`document.querySelector('.srow').click()`); await until(`window.S.cur && window.S.cur.kind==='code' && document.querySelectorAll('.tool').length>=3`, 8000);
    pass('reopening a Code session restores its folder and messages', (await ev(`window.S.cur.cwd`)) === work);

    // ---------- modes and banners ----------
    await click('#chip-mode'); await sleep(150); await shot('06-mode-menu');
    pass('mode menu lists six modes', (await ev(`document.querySelectorAll('.popup .pi').length`)) === 6);
    await ev(`document.querySelectorAll('.popup .pi')[2].click()`); await sleep(200);
    pass('switching to Plan updates the composer', (await ev(`document.querySelector('#chip-mode').textContent`)) === 'Plan');
    send(pretend([{ say: 'writing', tools: [{ name: 'Write', input: { file_path: 'plan-blocked.txt', content: 'x' } }] }, { say: 'blocked as expected' }], 'Try to write. '));
    await waitIdle('blocked as expected'); pass('plan mode blocks writes', !fs.existsSync(path.join(work, 'plan-blocked.txt')));
    await ev(`window.__caelix.setMode('bypassPermissions')`); await sleep(200); await shot('07-bypass-banner');
    pass('Bypass shows the warning banner', await ev(`!document.querySelector('#banner').hidden && document.querySelector('#banner').textContent.includes('Bypass permissions is active')`));
    await ev(`window.__caelix.setMode('acceptEdits')`);
    await ev(`window.setModel('groq','llama-3.1-8b-instant')`); await sleep(200);
    pass('missing provider key shows the Open Keys banner', await ev(`!document.querySelector('#keyban').hidden && document.querySelector('#keyban-text').textContent.includes('Groq key')`)); await shot('08-key-banner');
    await ev(`window.setModel('pretend','pretend-1')`); await sleep(100);

    // ---------- slash menu, compact, reset, 2M context ----------
    await ev(`(function(){const i=document.querySelector('#input'); i.value='/'; i.dispatchEvent(new Event('input')); return 1})()`); await sleep(150);
    const slashN = await ev(`document.querySelectorAll('#slash-menu .pi').length`); const slashTxt = await ev(`document.querySelector('#slash-menu').innerText`);
    pass('slash menu has /reset, /compact, /compat, /btw and more', slashN >= 30 && ['/reset', '/compact', '/compat', '/btw', '/hooks', '/mcp'].every((c) => slashTxt.includes(c)), 'commands=' + slashN); await shot('09-slash-menu');
    await ev(`(function(){const i=document.querySelector('#input'); i.value=''; i.dispatchEvent(new Event('input')); return 1})()`);
    pass('context window is 2,000,000 tokens', (await ev(`window.S.ctxLimit`)) === 2000000);
    await ev(`window.__caelix.runSlash('/compat')`); await sleep(600);
    pass('/compat works like /compact', (await ev(`document.querySelector('#transcript').innerText`)).includes('Compacted'));
    const codeL = Array.from(live.values()).find((l) => l.rt.kind === 'code'); const before = require('./engine/agent').estTokens(codeL.rt.messages);
    await ev(`window.__caelix.runSlash('/reset')`); await sleep(900);
    const after = require('./engine/agent').estTokens(codeL.rt.messages);
    pass('/reset summarises, keeps memory and drops the token count', after < before && codeL.rt.messages.length === 1 && !!codeL.rt.summary, `${before} -> ${after} tokens`);
    send(pretend([{ say: 'still here after reset' }], 'Continue. ')); await waitIdle('still here after reset');
    pass('conversation continues after /reset with the summary in context', require('./engine/agent').buildSystem(codeL.rt, { userDir: userDir() }).includes('Summary of the conversation before the last reset'));
    await ev(`window.openPane('context')`); await sleep(400); await shot('10-context-panel');
    const ctxTxt = await ev(`document.querySelector('#sp-body').innerText`);
    pass('Context panel shows 2,000,000 window, breakdown and /reset button', /of 2,000,000 chat window/.test(ctxTxt) && /System and memory/.test(ctxTxt) && /Tool results/.test(ctxTxt) && /Reset chat context/.test(ctxTxt), ctxTxt.slice(0, 80));
    const mem = require('./engine/config').loadMemory(userDir(), work); pass('project memory loads AGENTS.md', mem.includes('SELFCHECK-MEMORY-OK'));
    pass('Project memory count shows in the sidebar', Number(await ev(`document.querySelector('#mem-count').textContent`)) >= 1);

    // ---------- rewind, panes ----------
    const sid = await ev('window.S.cur.id'); const rw = await ev(`window.caelix.rewind(${JSON.stringify(sid)}, 1, {code:true, conversation:false})`);
    pass('rewind restores files to before the prompt', rw.ok && !fs.existsSync(path.join(work, 'out.txt')), JSON.stringify(rw.restored));
    send(pretend([{ say: 'ok', tools: [{ name: 'Write', input: { file_path: 'pane.txt', content: 'one\ntwo\n' } }] }, { say: 'made it' }], 'Make a file. ')); await waitIdle('made it');
    await ev(`window.closeAllPanes(); window.openPane('diff')`); await until(`document.querySelector('.dfile')`, 8000, 'diff pane'); await sleep(200); await shot('11-changes-pane');
    pass('Changes pane lists the edited file with counts', (await ev(`document.querySelector('.dfile .dh').innerText`)).includes('pane.txt'));
    await ev(`window.closeAllPanes(); window.openPane('terminal')`); await until(`document.querySelector('#term-in')`, 5000);
    await ev(`(function(){const i=document.querySelector('#term-in'); i.value='echo termtest-$((20+22)) && pwd'; i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'})); return 1})()`);
    await until(`document.querySelector('#term-out').textContent.includes('termtest-42')`, 6000, 'terminal output'); await shot('12-terminal-pane');
    pass('Terminal pane runs commands in the session folder', (await ev(`document.querySelector('#term-out').textContent`)).includes(path.basename(work)));
    await ev(`window.closeAllPanes(); window.openPane('files')`); await until(`document.querySelector('.ftree .fi')`, 5000); pass('Files pane lists the folder', (await ev(`document.querySelector('.ftree').innerText`)).includes('pane.txt'));
    await ev(`window.closeAllPanes()`); await click('#btn-browser'); await sleep(250); await shot('13-browser-pane');
    pass('Browser button opens a pane with a URL bar', await ev(`!!document.querySelector('#url') && !!document.querySelector('iframe.browser')`));
    await ev(`window.closeAllPanes()`);

    // ---------- Keys, MCP, Hooks, models ----------
    await click('#btn-keys'); await until(`document.querySelectorAll('.prow').length>=10`, 8000, 'keys screen'); await shot('14-keys-screen');
    const rows = await ev(`Array.from(document.querySelectorAll('.prow .pt')).map(e=>e.innerText.trim())`);
    const wantP = ['Google Gemini', 'OpenRouter', 'NVIDIA NIM', 'Groq', 'CoArena', 'Kilo Gateway', 'OpenCode Zen', 'Numes', 'Abliteration AI', 'OmniRoute'];
    pass('Keys screen lists all ten providers', wantP.every((p) => rows.some((r) => r.startsWith(p))), rows.join(' | '));
    const fake = 'gsk_selfcheck_1234'; await ev(`(function(){const r=Array.from(document.querySelectorAll('.prow')).find(x=>x.innerText.trim().startsWith('Groq')); const i=r.querySelector('input[type=password]'); i.value=${JSON.stringify(fake)}; r.querySelector('.btn.pri').click(); return 1})()`);
    await until(`document.body.innerText.includes('••••1234')`, 10000, 'masked key'); await sleep(300);
    pass('key shown masked (last 4 only)', !(await ev(`document.body.innerText`)).includes('gsk_selfcheck'));
    const enc = fs.readFileSync(keys.file, 'utf8'); pass('key file is encrypted, no plaintext on disk', !enc.includes('selfcheck') && enc.includes('groq'));
    pass('key store is outside the project folder', !keys.file.startsWith(ROOT), keys.file);
    await ev(`window.caelix.removeKey('groq')`); await closeModals();

    await click('#btn-mcp'); await until(`document.querySelectorAll('.erow').length>=2 && document.querySelector('.modal').innerText.includes('tool(s)')`, 10000, 'mcp modal'); await sleep(200); await shot('15-mcp-modal');
    const mcpTxt = await ev(`document.querySelector('.modal').innerText`);
    pass('MCP screen lists built-in desktop (4 tools) and memory (3 tools)', /desktop[\s\S]*4 tool\(s\)/.test(mcpTxt) && /memory[\s\S]*3 tool\(s\)/.test(mcpTxt) && /Add & Connect/.test(mcpTxt) && /Reconnect all/.test(mcpTxt) && /Import from Claude/.test(mcpTxt));
    await closeModals();
    await click('#btn-hooks'); await until(`document.querySelector('.modal') && document.querySelector('.modal').innerText.includes('Lifecycle Hooks')`, 8000); await sleep(300);
    await ev(`Array.from(document.querySelectorAll('.chipbtn')).find(b=>b.textContent.includes('Block Force Push')).click()`); await until(`document.querySelector('.modal').innerText.includes('PreToolUse')`, 8000, 'hook added'); await sleep(300); await shot('16-hooks-modal');
    const hk0 = await ev(`window.caelix.hooksList(${JSON.stringify(work)})`); pass('Hooks screen adds the Block Force Push preset', hk0.some((h) => h.event === 'PreToolUse' && h.matcher === '^bash$' && h.enabled));
    { const fsx = require('fs'), pth = require('path'); const od = pth.join(work, '.caelix'); fsx.mkdirSync(od, { recursive: true });
      fsx.writeFileSync(pth.join(od, 'hooks.json'), JSON.stringify({ hooks: [{ id: 'foreign', event: 'Stop', matcher: '*', command: 'true', enabled: true }] })); fsx.writeFileSync(pth.join(od, 'settings.json'), '"junk"');
      const hf = await ev(`window.caelix.hooksList(${JSON.stringify(work)})`); pass('files in a different layout (object hooks file, junk settings) do not crash hooks', Array.isArray(hf) && !hf.__error, JSON.stringify(hf).slice(0, 120));
      fsx.rmSync(od, { recursive: true, force: true }); }
    await closeModals();
    await click('#chip-model'); await until(`document.querySelectorAll('.mpicker .mi').length>=5`, 8000, 'model picker'); await sleep(300); await shot('17-model-picker');
    const og = await ev(`(function(){const g=document.querySelector('.mpicker .mg'); const items=[]; let n=g.nextSibling; while(n&&!n.classList.contains('mg')){ if(n.classList.contains('mi')) items.push(n.querySelector('.mn').textContent); n=n.nextSibling;} return {h:g.textContent, items, refresh: !!Array.from(document.querySelectorAll('.mtop button')).find(b=>b.textContent==='Refresh')}})()`);
    pass('model picker shows OMNIROUTE (5), search and Refresh', /OMNIROUTE \(5\)/.test(og.h) && ['auto', 'auto/coding', 'auto/fast', 'auto/cheap', 'auto/smart'].every((m) => og.items.includes(m)) && og.refresh, og.h + ' ' + og.items.join(','));
    await ev(`document.querySelectorAll('.mpicker .mi')[1].querySelector('.star').click()`); await sleep(400);
    pass('starring a model adds a Favorites group', (await ev(`document.querySelector('.mpicker .mg').textContent`)).includes('FAVORITES'));
    await ev(`document.querySelectorAll('.mpicker .mi')[0].querySelector('.star').click()`); await sleep(200);
    await ev(`Array.from(document.querySelectorAll('.mpicker .mi')).find(m=>m.querySelector('.mn').textContent==='auto/fast').click()`); await sleep(250);
    pass('choosing a model updates the composer', (await ev(`document.querySelector('#chip-model-top').textContent`)) === 'auto/fast');
    await ev(`window.setModel('pretend','pretend-1')`);

    // ---------- light theme ----------
    await ev(`document.documentElement.dataset.theme='light'`); await sleep(300); await shot('18-light-theme'); await ev(`document.documentElement.dataset.theme='dark'`);

    // ---------- restart ----------
    const before2 = (await ev(`window.caelix.listSessions()`)).length; await ev(`window.caelix.setLast({kind:'code'})`);
    win.webContents.reload(); await sleep(400); await until('window.__caelix && window.S && window.S.info && document.querySelectorAll(".srow").length>=1', 15000, 'reload');
    pass('session list survives a restart', (await ev(`window.S.sessions.length`)) === before2);
    pass('the last used tab (Code) is restored', (await ev(`window.S.kind`)) === 'code');
    await ev(`document.querySelector('.srow').click()`); await until(`document.querySelectorAll('.msg.user').length>=1 && document.querySelectorAll('.tool').length>=1`, 8000, 'reopen');
    pass('chat reopens with its messages and tool cards', true); await shot('19-after-restart');

    // ---------- engine-level checks ----------
    const providers = require('./engine/providers');
    const fakeModels = { groq: [{ id: 'llama-3.1-8b-instant', provider: 'groq' }, { id: 'llama-3.3-70b-versatile', provider: 'groq' }], gemini: [{ id: 'gemini-2.5-pro', provider: 'gemini' }, { id: 'gemini-2.5-flash', provider: 'gemini' }], openrouter: [{ id: 'qwen/qwen3-coder:free', provider: 'openrouter', free: true }, { id: 'openai/gpt-5', provider: 'openrouter' }] };
    const fast = providers.routeCandidates('auto/fast', fakeModels)[0], cheap = providers.routeCandidates('auto/cheap', fakeModels)[0], coding = providers.routeCandidates('auto/coding', fakeModels)[0], smart = providers.routeCandidates('auto/smart', fakeModels)[0];
    pass('OmniRoute: fast prefers Groq instant', fast.provider === 'groq' && /instant/.test(fast.model), fast.model);
    pass('OmniRoute: cheap prefers a free model', cheap.model.includes(':free'), cheap.model);
    pass('OmniRoute: coding prefers a coder model', /coder/.test(coding.model), coding.model);
    pass('OmniRoute: smart prefers a strong model', /pro|gpt-5/.test(smart.model), smart.model);
    pass('OmniRoute: no connected providers gives no candidates', providers.routeCandidates('auto', {}).length === 0);
    { const m = [{ id: 'nvidia/cosmos-reason2-8b', provider: 'nvidia' }, { id: 'meta/llama-3.3-70b-instruct', provider: 'nvidia' }]; const c1 = providers.routeCandidates('auto/coding', { nvidia: m });
      pass('OmniRoute never picks non-chat models such as cosmos-reason2', !c1.some((c) => /cosmos/.test(c.model)));
      providers.markFailed('nvidia', 'meta/llama-3.3-70b-instruct', { status: 404, message: 'not found' }); const c2 = providers.routeCandidates('auto/coding', { nvidia: m });
      pass('OmniRoute stops retrying a model that returned 404', c2.length === 0); providers.markOk('nvidia', 'meta/llama-3.3-70b-instruct'); }

    const { newRuntime } = require('./engine/runtime'); const agent = require('./engine/agent'); const config = require('./engine/config'); const { connectAll } = require('./engine/mcp');
    async function engineTurn(cwd, mode, script, o) {
      o = o || {}; const rt = o.rt || newRuntime({ provider: 'pretend', model: 'pretend-1', cwd, mode, kind: o.kind }); if (o.ctxLimit) rt.ctxLimit = o.ctxLimit; const evs = [];
      const settings = config.loadSettings(userDir(), cwd);
      const env = { userDir: userDir(), settings, signal: new AbortController().signal, getCreds: () => ({}), connected: () => [], bases: () => ({}), ask: async () => ({ decision: 'deny' }), emit: (e) => evs.push(e) };
      rt.mcp = await connectAll(settings.mcpServers, cwd, { userDir: userDir(), disabled: settings.builtinOff });
      await agent.runTurn(rt, env, 'go PRETEND: ' + JSON.stringify(script)); rt.mcp.stop(); return { evs, rt };
    }
    const fp = await engineTurn(work, 'bypassPermissions', [{ say: 'x', tools: [{ name: 'Bash', input: { command: 'git push --force origin main' } }] }, { say: 'y' }]);
    pass('Block Force Push hook blocks `git push --force`', fp.evs.some((e) => e.type === 'tool_result' && /Blocked by hook: Blocked: force push/.test(e.output)), JSON.stringify(fp.evs.filter((e) => e.type === 'tool_result').map((e) => e.output)));
    const ok = await engineTurn(work, 'bypassPermissions', [{ say: 'x', tools: [{ name: 'Bash', input: { command: 'echo safe' } }] }, { say: 'y' }]);
    pass('the same hook lets other Bash commands through', ok.evs.some((e) => e.type === 'tool_result' && /safe/.test(e.output) && !e.error));
    const hid = hk0.find((h) => h.event === 'PreToolUse').id; await ev(`window.caelix.hooksToggle(${JSON.stringify(work)}, ${JSON.stringify(hid)}, 'user', false)`);
    const fp2 = await engineTurn(work, 'bypassPermissions', [{ say: 'x', tools: [{ name: 'Bash', input: { command: 'echo "git push --force" >/dev/null; echo ran' } }] }, { say: 'y' }]);
    pass('a disabled hook no longer runs', fp2.evs.some((e) => e.type === 'tool_result' && /ran/.test(e.output)));
    await ev(`window.caelix.hooksRemove(${JSON.stringify(work)}, ${JSON.stringify(hid)}, 'user')`); pass('hooks can be removed', !(await ev(`window.caelix.hooksList(${JSON.stringify(work)})`)).some((h) => h.id === hid));
    // ---- the loop keeps going after a failed step, and always says why a turn ended ----
    { const kf = require('path').join(work, 'keepgoing.txt');
      const td = (a, b) => ({ name: 'TodoWrite', input: { todos: [{ content: 'read the file', status: a }, { content: 'write the file', status: b }] } });
      const kg = await engineTurn(work, 'bypassPermissions', [{ say: 'start', tools: [td('in_progress', 'pending'), { name: 'Read', input: { file_path: require('path').join(work, 'nope-missing.txt') } }] }, { say: 'It failed, I stop here.' }, { say: 'retrying', tools: [{ name: 'Write', input: { file_path: kf, content: 'ok' } }, td('completed', 'completed')] }, { say: 'All done.' }]);
      pass('keep going: a failed step with an unfinished checklist does not end the turn (model is reminded and finishes the job)', require('fs').existsSync(kf) && kg.evs.some((e) => e.type === 'info' && /checklist item/.test(e.text)), JSON.stringify(kg.evs.filter((e) => e.type === 'info' || e.type === 'stop')));
      pass('keep going: ends with reason "finished" once every item is completed', (kg.evs.filter((e) => e.type === 'stop').pop() || {}).reason === 'finished');
      const sg = await engineTurn(work, 'bypassPermissions', [{ say: 'start', tools: [td('in_progress', 'pending')] }, { say: 'no' }, { say: 'no' }, { say: 'no' }, { say: 'no' }, { say: 'no' }]);
      const sgStop = sg.evs.filter((e) => e.type === 'stop').pop() || {};
      pass('stubborn model: after the reminders the turn ends with a clear reason (unfinished items named)', sgStop.reason === 'unfinished' && /write the file/.test(sgStop.detail), JSON.stringify(sgStop));
      const em = await engineTurn(work, 'bypassPermissions', [{ say: '' }, { say: 'ok here I am' }]);
      pass('an empty model reply is not accepted as the end of the turn', em.evs.some((e) => e.type === 'info' && /Empty reply/.test(e.text)) && (em.evs.filter((e) => e.type === 'stop').pop() || {}).reason === 'finished'); }
    // ---- team mode (coder + reviewer), images, auto-naming ----
    { const wfile = require('path').join(work, 'team-out.txt');
      const rtT = newRuntime({ provider: 'pretend', model: 'pretend-1', cwd: work, mode: 'bypassPermissions', kind: 'code' }); rtT.team = true; rtT.coder = { provider: 'pretend', model: 'coder-x' }; rtT.reviewer = { provider: 'pretend', model: 'reviewer-y' };
      const evsT = []; const stT = config.loadSettings(userDir(), work);
      const envT = { userDir: userDir(), settings: stT, signal: new AbortController().signal, getCreds: () => ({}), connected: () => [], bases: () => ({}), ask: async () => ({ decision: 'deny' }), emit: (e) => evsT.push(e) };
      rtT.mcp = await connectAll(stT.mcpServers, work, { userDir: userDir(), disabled: stT.builtinOff });
      await agent.runTurn(rtT, envT, 'go PRETEND: ' + JSON.stringify([{ say: 'writing', tools: [{ name: 'Write', input: { file_path: wfile, content: 'hello' } }] }, { say: 'done coding' }]) + ' PRETEND_REVIEW: CHANGES NEEDED'); rtT.mcp.stop();
      const infos = evsT.filter((e) => e.type === 'info').map((e) => e.text).join(' | ');
      pass('Team mode: coder model runs the work and the reviewer model reviews it', /coder is pretend \/ coder-x/.test(infos) && /reviewer is pretend \/ reviewer-y/.test(infos), infos);
      const txt = evsT.filter((e) => e.type === 'text').map((e) => e.delta).join('');
      pass('Team mode: reviewer verdict is shown and CHANGES NEEDED sends the coder back for a fix pass', /Reviewer \(reviewer-y\)/.test(txt) && /CHANGES NEEDED/.test(txt) && rtT.messages.some((m) => m.role === 'user' && /reviewer checked your work/.test(String(m.content))), txt.slice(0, 160));
      pass('Team mode: the main model selection is restored after the turn', rtT.model === 'pretend-1');
      const evsA = []; const rtA = newRuntime({ provider: 'pretend', model: 'pretend-1', cwd: work, mode: 'bypassPermissions', kind: 'code' }); rtA.team = true; rtA.coder = { provider: 'pretend', model: 'c' }; rtA.reviewer = { provider: 'pretend', model: 'r' };
      rtA.mcp = await connectAll(stT.mcpServers, work, { userDir: userDir(), disabled: stT.builtinOff });
      await agent.runTurn(rtA, { ...envT, emit: (e) => evsA.push(e) }, 'go PRETEND: ' + JSON.stringify([{ say: 'writing', tools: [{ name: 'Write', input: { file_path: wfile + '.2', content: 'hello2' } }] }, { say: 'done' }])); rtA.mcp.stop();
      pass('Team mode: APPROVED ends the turn with no fix pass', evsA.some((e) => e.type === 'text' && /APPROVED/.test(e.delta)) && !rtA.messages.some((m) => m.role === 'user' && /reviewer checked your work/.test(String(m.content)))); }
    { const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const rtI = newRuntime({ provider: 'pretend', model: 'pretend-1', cwd: work, mode: 'bypassPermissions', kind: 'code' }); const evI = [];
      const envI = { userDir: userDir(), settings: config.loadSettings(userDir(), work), signal: new AbortController().signal, getCreds: () => ({}), connected: () => [], bases: () => ({}), ask: async () => ({ decision: 'deny' }), emit: (e) => evI.push(e) };
      rtI.mcp = await connectAll(envI.settings.mcpServers, work, { userDir: userDir(), disabled: envI.settings.builtinOff });
      await agent.runTurn(rtI, envI, 'what is in this picture?', ['data:image/png;base64,' + png]); rtI.mcp.stop();
      const um = rtI.messages.find((m) => m.role === 'user');
      pass('Images: the message carries the picture in the standard image_url format', Array.isArray(um.content) && um.content[0].type === 'text' && um.content[1].type === 'image_url' && um.content[1].image_url.url.startsWith('data:image/png;base64,'));
      pass('Images: a picture counts about 1,500 tokens, not its base64 length', agent.estTokens([{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,' + 'A'.repeat(400000) } }] }]) < 3000); }
    { const t1 = agent.fallbackTitle('Can you please help me fix the login bug in the settings page of my app'); const t2 = agent.fallbackTitle('   ');
      pass('Auto-naming: fallback title is short and tidy', t1.length > 3 && t1.length <= 48 && !/^can you/i.test(t1) && t2 === 'New chat', t1); }
    const stub = path.join(work, 'mcp-stub.js');
    fs.writeFileSync(stub, `let b='';process.stdin.on('data',d=>{b+=d;let i;while((i=b.indexOf('\\n'))>=0){const l=b.slice(0,i);b=b.slice(i+1);if(!l.trim())continue;const m=JSON.parse(l);const r=(x)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:x})+'\\n');if(m.method==='initialize')r({protocolVersion:'2024-11-05',capabilities:{},serverInfo:{name:'stub',version:'1'}});else if(m.method==='tools/list')r({tools:[{name:'echo',description:'echo',inputSchema:{type:'object',properties:{t:{type:'string'}}}}]});else if(m.method==='tools/call')r({content:[{type:'text',text:'stub says '+m.params.arguments.t}]});}});`);
    process.env.ELECTRON_RUN_AS_NODE = '1';
    await ev(`window.caelix.mcpAdd(${JSON.stringify(work)}, {name:'stub', scope:'project', command:${JSON.stringify('"' + process.execPath + '" "' + stub + '"')}})`);
    const ml = await ev(`window.caelix.mcpList('', ${JSON.stringify(work)}, true)`);
    pass('MCP: added server connects and reports its tools', ml.some((e) => e.name === 'stub' && e.tools === 1), JSON.stringify(ml.map((e) => e.name + ':' + e.tools + (e.error ? ' ' + e.error : ''))));
    pass('MCP: built-in desktop has 4 tools and memory has 3', ml.find((e) => e.name === 'desktop').tools === 4 && ml.find((e) => e.name === 'memory').tools === 3);
    const mc = await engineTurn(work, 'bypassPermissions', [{ say: 'calling', tools: [{ name: 'mcp__stub__echo', input: { t: 'hi' } }] }, { say: 'done' }]);
    pass('MCP: stdio tool is callable', mc.evs.some((e) => e.type === 'tool_result' && /stub says hi/.test(e.output)), JSON.stringify(mc.evs.filter((e) => e.type === 'tool_result').map((e) => e.output)));
    await ev(`window.caelix.mcpToggle(${JSON.stringify(work)}, 'stub', 'project', true, false)`);
    pass('MCP: a server can be disabled', (await ev(`window.caelix.mcpList('', ${JSON.stringify(work)}, true)`)).find((e) => e.name === 'stub').disabled === true);
    await ev(`window.caelix.mcpRemove(${JSON.stringify(work)}, 'stub', 'project')`); pass('MCP: a server can be removed', !(await ev(`window.caelix.mcpList('', ${JSON.stringify(work)}, true)`)).some((e) => e.name === 'stub'));
    const bt = await engineTurn(work, 'bypassPermissions', [{ say: 'a', tools: [{ name: 'mcp__desktop__system_info', input: {} }, { name: 'mcp__desktop__git_summary', input: {} }, { name: 'mcp__memory__memory_save', input: { text: 'The user likes blue.' } }] }, { say: 'b', tools: [{ name: 'mcp__memory__memory_search', input: { query: 'blue' } }] }, { say: 'c' }]);
    const bo = bt.evs.filter((e) => e.type === 'tool_result').map((e) => e.output);
    pass('built-in desktop tools work', /Memory:/.test(bo[0]) && bo[1] !== undefined, (bo[0] || '').slice(0, 60));
    pass('built-in memory saves and finds across chats', /Saved/.test(bo[2]) && /likes blue/.test(bo[3]), bo.slice(2).join(' | ').slice(0, 100));
    pass('saved memories are placed in the system prompt', agent.buildSystem(newRuntime({ provider: 'pretend', model: 'p', cwd: work }), { userDir: userDir() }).includes('The user likes blue.'));
    const rt80 = newRuntime({ provider: 'pretend', model: 'pretend-1', cwd: work, mode: 'bypassPermissions' });
    await engineTurn(work, 'bypassPermissions', [{ say: 'x'.repeat(6000) }], { rt: rt80, ctxLimit: 2400 });
    const t80 = await engineTurn(work, 'bypassPermissions', [{ say: 'after' }], { rt: rt80, ctxLimit: 2400 });
    pass('auto-reset triggers at 80% of the window', t80.evs.some((e) => e.type === 'reset' && e.why === 'auto') && rt80.summary.length > 0, JSON.stringify(t80.evs.filter((e) => e.type === 'reset')));
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
    const ct = await engineTurn(chatDir, 'auto', [{ say: 'x', tools: [{ name: 'Bash', input: { command: 'echo hi' } }] }, { say: 'y' }], { kind: 'chat' });
    pass('engine: Chat mode rejects Bash', ct.evs.some((e) => e.type === 'tool_result' && /not available in Chat mode/.test(e.output)));
    const code = require('./engine/tools').toolDefs([], { kind: 'chat' }).map((d) => d.function.name);
    pass('Chat tool set has no file or shell tools', !['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'].some((n) => code.includes(n)), code.join(','));
    // ---- UI: attach an image, send it, chat gets a name ----
    await click('#seg-chat'); await sleep(300); await click('#btn-new'); await sleep(300); await ev(`window.setModel('pretend','pretend-1')`);
    await ev(`(async()=>{const b=atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');const a=new Uint8Array(b.length);for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);await window.addImageFile(new File([a],'t.png',{type:'image/png'}));return 1})()`);
    pass('Images: attaching shows a thumbnail above the message box', await ev(`document.querySelectorAll('#attach-strip .thumb').length===1 && !document.querySelector('#attach-strip').hidden`)); await shot('30-image-attached');
    await ev(`window.submit('Can you please help me plan a birthday party for my sister')`);
    await until(`document.querySelector('.msg.user img')`, 15000, 'image in sent message'); await until(`!window.S.busy`, 20000, 'idle');
    pass('Images: the sent message shows the picture and the strip is cleared', await ev(`document.querySelectorAll('.msg.user img').length===1 && document.querySelector('#attach-strip').hidden`));
    const ttl = await ev(`window.S.cur.title`); pass('Auto-naming: a new chat gets a short name from its first message', ttl !== 'New chat' && ttl.length <= 48 && /birthday/i.test(ttl), ttl);
    pass('Auto-naming: the sidebar shows the name', await ev(`Array.from(document.querySelectorAll('.srow')).some(r=>/birthday/i.test(r.textContent))`)); await shot('31-auto-named');
    // rename through the in-app dialog (the old prompt() does not exist in Electron)
    await click('#title-btn'); await until(`document.querySelector('.modal input[type=text]')`, 8000, 'rename dialog');
    await ev(`(()=>{const i=document.querySelector('.modal input[type=text]'); i.value='Party plan'; document.querySelector('.modal footer .pri').click(); return 1})()`); await sleep(500);
    pass('Renaming a chat works from the title (dialog, then saved)', (await ev(`window.S.cur.title`)) === 'Party plan' && (await ev(`document.querySelector('#title-text').textContent`)) === 'Party plan'); await shot('33-renamed');
    const sidRn = await ev(`window.S.cur.id`); const rn = await ev(`window.caelix.listSessions()`); pass('The new name is saved on disk', rn.some((s) => s.id === sidRn && s.title === 'Party plan'));
    await click('#seg-code'); await sleep(300);
    await click('#btn-new'); await sleep(300);
    pass('Code: New session asks for a folder again instead of reusing the last one', await ev(`window.S.kind==='code' && !window.S.draft.cwd && !document.querySelector('#new-folder').hidden && document.querySelector('#input').disabled`));
    await ev(`window.lazy('modals').then(()=>window.Modals.team())`); await until(`document.querySelector('.modal') && document.querySelector('.modal').innerText.includes('Team mode')`, 8000, 'team dialog');
    await ev(`document.querySelector('.modal input[type=checkbox]').click()`); await sleep(200);
    pass('Team dialog asks for a coder and a reviewer model', await ev(`(()=>{const t=document.querySelector('.modal').innerText;return t.includes('Coder')&&t.includes('Reviewer')})()`)); await shot('32-team-dialog'); await ev(`document.querySelector('#modal-host').innerHTML=''`);
    // ---- updater ----
    { const upd = require('./updater'); const fsx = require('fs'), pth = require('path'), osx = require('os'), cp = require('child_process');
      const mk = (name, files) => { const d = fsx.mkdtempSync(pth.join(osx.tmpdir(), 'upd-src-')); const top = pth.join(d, 'caelix-x'); for (const [f, c] of Object.entries(files)) { fsx.mkdirSync(pth.dirname(pth.join(top, f)), { recursive: true }); fsx.writeFileSync(pth.join(top, f), c); } const tarf = pth.join(d, name + '.tar.gz'); cp.execFileSync('tar', ['-czf', tarf, '-C', d, 'caelix-x']); return tarf; };
      const good = { 'main.js': '//', 'preload.js': '//', 'boot.js': '//', 'package.json': JSON.stringify({ name: 'caelix', version: '9.9.9' }), 'renderer/index.html': '<html></html>', 'src/engine/agent.js': '//' };
      const base = fsx.mkdtempSync(pth.join(osx.tmpdir(), 'upd-base-')); const sha = 'a'.repeat(40);
      await upd.installFromTar(mk('good', good), { sha, date: '2026-12-01T00:00:00Z' }, base);
      const cur = JSON.parse(fsx.readFileSync(pth.join(base, 'current.json'), 'utf8'));
      pass('Updater: a valid download is unpacked and recorded as the code to run', cur.sha === sha && fsx.existsSync(pth.join(base, cur.dir, 'main.js')) && JSON.parse(fsx.readFileSync(pth.join(base, cur.dir, 'build-info.json'), 'utf8')).sha === sha);
      pass('Updater: newer downloaded code is chosen over an older installer', upd.chooseRootFor(base, { commitTime: '2026-11-01T00:00:00Z' }) === 'downloaded');
      pass('Updater: a newer installer wins over older downloaded code', upd.chooseRootFor(base, { commitTime: '2027-01-01T00:00:00Z' }) === 'bundled');
      let e1 = ''; try { await upd.installFromTar(mk('other', { ...good, 'package.json': JSON.stringify({ name: 'not-caelix' }) }), { sha: 'b'.repeat(40), date: '2026-12-02T00:00:00Z' }, base); } catch (e) { e1 = e.message; }
      let e2 = ''; try { const bad = { ...good }; delete bad['main.js']; await upd.installFromTar(mk('missing', bad), { sha: 'c'.repeat(40), date: '2026-12-02T00:00:00Z' }, base); } catch (e) { e2 = e.message; }
      pass('Updater: refuses a download that is not CAELIX or is incomplete, and keeps the working copy', /not CAELIX/.test(e1) && /missing main.js/.test(e2) && JSON.parse(fsx.readFileSync(pth.join(base, 'current.json'), 'utf8')).sha === sha, e1 + ' | ' + e2);
      const bi = pth.join(ROOT, 'build-info.json'); fsx.writeFileSync(bi, JSON.stringify({ sha: 'd'.repeat(40), commitTime: '2026-11-01T00:00:00Z' }));
      try {
        upd.setFetch(async () => ({ ok: true, status: 200, json: async () => ({ sha: 'e'.repeat(40), commit: { committer: { date: '2026-12-05T00:00:00Z' }, message: 'Add a thing\n\nmore' } }) }));
        const r1 = await upd.check(); pass('Updater: reports an update when GitHub has a newer commit', r1.available === true && r1.latest.short === 'eeeeeee' && r1.latest.message === 'Add a thing');
        upd.setFetch(async () => ({ ok: true, status: 200, json: async () => ({ sha: 'd'.repeat(40), commit: { committer: { date: '2026-11-01T00:00:00Z' }, message: 'same' } }) }));
        pass('Updater: reports up to date when the commit is the same', (await upd.check()).available === false);
        upd.setFetch(async () => ({ ok: false, status: 403, json: async () => ({}) })); let e3 = ''; try { await upd.check(); } catch (e) { e3 = e.message; } pass('Updater: a GitHub rate limit gives a plain message', /limiting/.test(e3));
        upd.setFetch(async () => ({ ok: true, status: 200, json: async () => ({ sha: 'e'.repeat(40), commit: { committer: { date: '2026-12-05T00:00:00Z' }, message: 'Add a thing' } }) }));
        await click('#btn-update'); await until(`document.querySelector('.modal') && document.querySelector('.modal').innerText.includes('Updates')`, 8000, 'updates dialog');
        await ev(`Array.from(document.querySelectorAll('.modal footer button')).find(b=>b.textContent.includes('Check for updates')).click()`); await until(`document.querySelector('.modal').innerText.includes('newer version is available')`, 8000, 'update available text');
        pass('Update button: opens the Updates dialog, shows the newer version and an Update now button', await ev(`Array.from(document.querySelectorAll('.modal footer button')).some(b=>b.textContent.includes('Update now') && b.style.display!=='none')`) && await ev(`document.querySelector('#btn-update').classList.contains('has')`)); await shot('34-updates');
        await ev(`document.querySelector('#modal-host').innerHTML=''`);
      } finally { try { fsx.unlinkSync(bi); } catch (_) {} upd.setFetch((...a) => fetch(...a)); } }
  } catch (e) { errors.push('self-check aborted: ' + (e && e.stack || e)); }

  const metrics = app.getAppMetrics(); const mem = { rss_main_mb: Math.round(process.memoryUsage().rss / 1048576), total_working_set_mb: Math.round(metrics.reduce((a, m) => a + (m.memory.workingSetSize || 0), 0) / 1024), processes: metrics.map((m) => ({ type: m.type, mb: Math.round((m.memory.workingSetSize || 0) / 1024) })) };
  const report = { when: new Date().toISOString(), ok: errors.length === 0, startup: { windowShownMs: timing.windowShown, uiReadyMs: timing.uiReady, under2s: (timing.windowShown || 99999) < 2000 }, memory: mem, checks: results, passed: results.filter((r) => r.ok).length, total: results.length, errors, durationMs: Date.now() - t0 };
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); fs.writeFileSync(path.join(ROOT, 'checks', 'latest.json'), JSON.stringify(report, null, 2)); fs.writeFileSync(path.join(out, 'errors.txt'), errors.join('\n') || '(none)\n');
  console.log(`SELFCHECK ${report.ok ? 'PASS' : 'FAIL'}: ${report.passed}/${report.total} checks, ${errors.length} errors, windowShown=${timing.windowShown}ms, mem=${mem.total_working_set_mb}MB -> ${out}`);
  if (errors.length) console.log(errors.join('\n'));
  app.exit(report.ok ? 0 : 1);
};
