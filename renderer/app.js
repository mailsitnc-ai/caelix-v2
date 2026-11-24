'use strict';
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => md.esc(String(s == null ? '' : s));
  const api = window.caelix;
  const MODES = [['default', 'Manual', 'Ask before editing files or running commands'], ['acceptEdits', 'Accept edits', 'Auto-accept file edits, ask for other commands'], ['plan', 'Plan', 'Read-only: explore and propose a plan'], ['auto', 'Auto', 'Run without routine prompts; destructive commands are blocked'], ['bypassPermissions', 'Bypass permissions', 'Run everything without asking'], ['dontAsk', "Don't ask", 'Only pre-approved tools run']];
  const EFFORTS = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']];
  const VIEWS = [['normal', 'Normal'], ['thinking', 'Thinking'], ['verbose', 'Verbose']];
  const SLASH = [['/reset', 'Summarise everything, keep memory, reset the token count'], ['/compact', 'Summarise older messages, keep the recent ones'], ['/compat', 'Same as /compact'], ['/btw', 'Ask a side question: /btw <question>'], ['/clear', 'Clear this conversation'], ['/new', 'Start a new chat or session'], ['/chat', 'Switch to Chat'], ['/code', 'Switch to Code'], ['/model', 'Choose model'], ['/mode', 'Change permission mode'], ['/plan', 'Switch to plan mode'], ['/team', 'Toggle team mode'], ['/agents', 'Pick a sub-agent'], ['/rename', 'Rename: /rename <title>'], ['/rewind', 'Undo changes from a past prompt'], ['/diff', 'Show changes'], ['/terminal', 'Open terminal'], ['/browser', 'Open browser'], ['/files', 'Open files'], ['/context', 'Show context use'], ['/cost', 'Show token usage'], ['/memory', 'Show project memory'], ['/remember', 'Save a note: /remember <text>'], ['/init', 'Create CAELIX.md for this project'], ['/export', 'Export as Markdown'], ['/copy', 'Copy the last reply'], ['/skills', 'List skills'], ['/hooks', 'Manage lifecycle hooks'], ['/mcp', 'Manage MCP servers'], ['/keys', 'Provider keys'], ['/settings', 'Settings'], ['/system', 'Inspect the system prompt'], ['/docs', 'Open the Chat documents folder'], ['/fork', 'Fork this session'], ['/theme', 'Toggle light / dark'], ['/view', 'Cycle transcript view'], ['/help', 'Keyboard shortcuts']];
  const DOT = { gemini: '#4d9bff', openrouter: '#9b7bff', nvidia: '#76d160',  groq: '#ff9a3d', coarena: '#9aa7bd', kilo: '#ffd23f', zen: '#38d2c0', numes: '#ff7ab8', abliteration: '#ff6b7a', omniroute: '#86c9ff', pretend: '#9aa7bd' };
  const S = { kind: 'chat', sessions: [], cur: null, items: [], providers: [], models: {}, fav: [], view: 'normal', pane: null, queue: [], busy: false, todos: [], ctx: 0, ctxLimit: 2000000, bd: { system: 0, messages: 0, tools: 0, active: 0 }, usage: { in: 0, out: 0 }, draft: { cwd: '', provider: 'omniroute', model: 'auto', mode: 'default', effort: 'medium', team: false }, curText: null, curBuf: '', workT: 0, bg: [], changes: [], checkpoints: [], archivedShown: false, filter: '', toolMap: {} };
  window.S = S; window.$ = $; window.el = el; window.esc = esc; window.api = api; window.DOT = DOT;

  function toast(msg, ms) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms || 2600); }
  window.toast = toast;
  const folderName = (p) => (p ? p.split('/').filter(Boolean).pop() || '/' : '');
  const modeLabel = (m) => (MODES.find((x) => x[0] === m) || [0, m])[1];
  const isCode = () => S.kind === 'code';
  const eff = () => (S.cur ? S.cur.effort : S.draft.effort) || 'medium';
  const curMode = () => (S.cur ? S.cur.mode : S.draft.mode);
  const curTeam = () => (S.cur ? !!S.cur.team : S.draft.team);
  const curModel = () => (S.cur ? { provider: S.cur.provider, model: S.cur.model } : { provider: S.draft.provider, model: S.draft.model });
  const curCwd = () => (S.cur ? S.cur.cwd : S.draft.cwd);
  const pctStr = (n) => { const p = (n / S.ctxLimit) * 100; return (p >= 10 ? Math.round(p) : p < 0.05 ? '0' : p.toFixed(1)) + '%'; };
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  window.fmt = fmt;

  // ---------- theme ----------
  function applyTheme(t) { const dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches); document.documentElement.dataset.theme = dark ? 'dark' : 'light'; S.theme = t; }
  window.toggleTheme = () => { const n = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; applyTheme(n); api.setSettings({ theme: n }); };

  // ---------- sidebar ----------
  function bucket(t) { const now = new Date(); const sod = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(); return t >= sod ? 'Today' : t >= sod - 864e5 ? 'Yesterday' : t >= sod - 7 * 864e5 ? 'Previous 7 days' : 'Older'; }
  function renderSidebar() {
    const list = $('#session-list'); list.innerHTML = ''; const q = S.filter.toLowerCase();
    const vis = S.sessions.filter((s) => (s.kind || 'code') === S.kind && (S.archivedShown ? s.archived : !s.archived) && (!q || (s.title || '').toLowerCase().includes(q) || (s.cwd || '').toLowerCase().includes(q)));
    const order = ['Pinned', 'Today', 'Yesterday', 'Previous 7 days', 'Older']; const groups = {};
    vis.forEach((s) => { const g = s.pinned ? 'Pinned' : bucket(s.updated); (groups[g] = groups[g] || []).push(s); });
    for (const g of order) {
      if (!groups[g]) continue; list.appendChild(el('div', 'grp', g));
      for (const s of groups[g]) {
        const r = el('div', 'srow' + (S.cur && S.cur.id === s.id ? ' active' : '') + (s.running ? ' running' : '')); r.dataset.id = s.id;
        const sub = (s.kind === 'chat' ? 'Chat' : folderName(s.cwd)) + ' · ' + (s.model || '');
        r.innerHTML = `<div class="tt"><div class="t1">${esc(s.title || 'New chat')}</div><div class="sub">${esc(sub)}</div></div><button class="x" title="Delete">✕</button>`;
        r.onclick = (e) => { if (e.target.closest('.x')) { e.stopPropagation(); return sessionMenu(s, e.target); } openSession(s.id); };
        r.oncontextmenu = (e) => { e.preventDefault(); sessionMenu(s, r); };
        list.appendChild(r);
      }
    }
    const t = el('div', 'grp'); t.style.cursor = 'pointer'; t.textContent = S.archivedShown ? '← Back' : 'View archived'; t.onclick = () => { S.archivedShown = !S.archivedShown; renderSidebar(); }; list.appendChild(t);
    if (!vis.length) list.insertBefore(el('div', 'empty-note', S.archivedShown ? 'No archived chats' : 'No ' + (isCode() ? 'sessions' : 'chats') + ' yet'), list.firstChild);
    $('#new-label').textContent = isCode() ? 'New session' : 'New chat'; $('#search').placeholder = isCode() ? 'Search sessions' : 'Search chats';
  }
  async function refreshSessions() { S.sessions = await api.listSessions(); renderSidebar(); }
  function sessionMenu(s, anchor) {
    popMenu(anchor, [['Rename…', async () => { await window.lazy('modals'); const t = await window.Modals.askText('Rename chat', s.title); if (t) { await api.setSession(s.id, { title: t }); if (S.cur && S.cur.id === s.id) { S.cur.title = t; setTitle(); } refreshSessions(); } }],
      [s.pinned ? 'Unpin' : 'Pin', async () => { await api.setSession(s.id, { pinned: !s.pinned }); refreshSessions(); }],
      ['Fork', async () => { const r = await api.forkSession(s.id); await refreshSessions(); openSession(r.id); }],
      [s.archived ? 'Unarchive' : 'Archive', async () => { await api.setSession(s.id, { archived: !s.archived }); if (S.cur && S.cur.id === s.id && !s.archived) newScreen(); refreshSessions(); }],
      ['Delete', async () => { if (confirm('Delete this ' + (s.kind === 'chat' ? 'chat' : 'session') + ' permanently?')) { await api.deleteSession(s.id); if (S.cur && S.cur.id === s.id) newScreen(); refreshSessions(); } }]]);
  }

  // ---------- popup menu ----------
  let openPop = null;
  function closePop() { if (openPop) { openPop.remove(); openPop = null; } }
  document.addEventListener('mousedown', (e) => { if (openPop && !openPop.contains(e.target) && !e.target.closest('[data-popanchor]')) closePop(); });
  function popMenu(anchor, items, opts) {
    closePop(); const m = el('div', 'popup'); m.style.position = 'fixed';
    items.forEach(([label, fn, extra], i) => { const r = el('div', 'pi' + (extra && extra.cur ? ' cur' : '')); r.innerHTML = `<span>${esc(label)}</span>${extra && extra.desc ? `<span class="d">${esc(extra.desc)}</span>` : ''}<span class="k">${i < 9 ? i + 1 : ''}</span>`; r.onclick = () => { closePop(); fn(); }; m.appendChild(r); });
    document.body.appendChild(m); const b = anchor.getBoundingClientRect(); const w = m.offsetWidth, h = m.offsetHeight;
    let x = Math.min(b.left, innerWidth - w - 8), y = b.bottom + 6; if (y + h > innerHeight - 8 || (opts && opts.up)) y = Math.max(8, b.top - h - 6);
    m.style.left = Math.max(8, x) + 'px'; m.style.top = y + 'px'; openPop = m; anchor.dataset.popanchor = 1; return m;
  }
  window.popMenu = popMenu; window.closePop = closePop;

  // ---------- chips / chrome ----------
  function setTitle() { const t = S.cur ? S.cur.title || (isCode() ? 'New session' : 'New chat') : isCode() ? 'New session' : 'New chat'; $('#title-text').textContent = t; document.title = t + ' — CAELIX'; }
  function provName(id) { const p = S.providers.find((x) => x.id === id); return p ? p.name : id; }
  function keyProblem() {
    const m = curModel(); if (m.provider === 'pretend') return '';
    const p = S.providers.find((x) => x.id === m.provider); if (!p) return '';
    if (m.provider === 'omniroute') return S.providers.some((x) => !x.virtual && x.hasKey) || p.base ? '' : 'OmniRoute routes across your providers: add at least one provider key in Keys.';
    return p.hasKey || p.keyOptional ? '' : `Add a ${p.name} key in Keys or pick a keyless model to send.`;
  }
  function updateChips() {
    const code = isCode(); document.body.classList.toggle('kind-code', code); $('#seg-chat').classList.toggle('on', !code); $('#seg-code').classList.toggle('on', code);
    $('#chip-folder-top').hidden = !code; $('#folder-top-name').textContent = curCwd() ? folderName(curCwd()) : 'Open folder';
    $('#chip-mode-top').hidden = !code; $('#chip-mode').hidden = !code; $('#chip-team').hidden = !code; $('#chip-team').classList.toggle('on', curTeam());
    const m = curModel(); const mn = m.model || 'Pick a model'; $('#model-name').textContent = mn; $('#chip-model-top').textContent = mn; $('#chip-model-top').title = provName(m.provider) + ' / ' + mn;
    const ml = modeLabel(curMode()); $('#chip-mode').textContent = ml; $('#chip-mode-top').textContent = ml; $('#chip-view').textContent = (VIEWS.find((v) => v[0] === S.view) || [0, 'Normal'])[1];
    $('#foot-ctx').textContent = pctStr(S.ctx) + ' context'; $('#foot-left').textContent = 'CAELIX'; $('#foot-branch').hidden = !code || !curCwd();
    const bp = code && curMode() === 'bypassPermissions'; const b = $('#banner'); b.hidden = !bp; if (bp) b.textContent = 'Bypass permissions is active — in-project edits and commands proceed without asking.';
    const kp = keyProblem(); $('#keyban').hidden = !kp; $('#keyban-text').textContent = kp;
    $('#foot-folder').hidden = !code || !curCwd(); $('#foot-folder-name').textContent = curCwd() || ''; $('#title-text').textContent; setTitle();
    const needFolder = code && !S.cur && !S.draft.cwd; $('#input').disabled = needFolder; $('#btn-send').disabled = needFolder; $('#input').placeholder = needFolder ? 'Open a project folder to start coding' : 'Ask CAELIX anything — MCP, Skills, Hooks & Agents stay active (/ commands)';
    if (code && curCwd()) api.gitBranch(curCwd()).then((br) => { $('#foot-branch').textContent = br || 'no git'; });
    api.memoryInfo(curCwd() || '').then((r) => { $('#mem-count').textContent = r.count; }).catch(() => {});
    if (S.pane === 'context' && window.Panes) window.Panes.refresh();
  }
  window.updateChips = updateChips;

  // ---------- kind (Chat / Code) ----------
  function setKind(k, silent) { if (S.kind === k && !silent) return; S.kind = k; api.setLast({ kind: k }); if (k === 'code') S.draft.cwd = ''; newScreen(); }
  $('#seg-chat').onclick = () => setKind('chat'); $('#seg-code').onclick = () => setKind('code');

  // ---------- screens ----------
  function recentFolders() { const seen = new Map(); S.sessions.filter((s) => s.kind === 'code' && !s.archived).forEach((s) => { if (!seen.has(s.cwd)) seen.set(s.cwd, s.updated); }); return Array.from(seen.keys()).slice(0, 4); }
  function newScreen() {
    S.cur = null; S.items = []; S.todos = []; S.ctx = 0; S.busy = false; S.queue = []; S.toolMap = {}; renderQueue(); $('#transcript').innerHTML = ''; $('#chatcol').classList.add('empty'); setBusy(false);
    const code = isCode(); $('#new-title').textContent = code ? (S.draft.cwd ? 'What should we build in ' + folderName(S.draft.cwd) + '?' : 'Open a project folder to start') : 'What can I help with?';
    $('#new-sub').textContent = code ? 'Code works inside a project folder. Pick one to start a new session, or continue an earlier session from the sidebar.' : 'Chat works anywhere: no folder needed, and it never touches your files.';
    $('#new-folder').hidden = !code || !!S.draft.cwd;
    const rf = $('#recent-folders'); rf.innerHTML = ''; recentFolders().forEach((f) => { const b = el('button', 'rf', `${esc(folderName(f))}<small>${esc(f.replace(/^\/Users\/[^/]+/, '~'))}</small>`); b.onclick = () => { S.draft.cwd = f; api.setLast({ cwd: f }); newScreen(); }; rf.appendChild(b); });
    setTitle(); updateChips(); renderSidebar(); closeAllPanes(); if (!$('#input').disabled) $('#input').focus();
  }
  async function openSession(id) {
    const r = await api.openSession(id); S.kind = r.meta.kind || 'code'; S.cur = r.meta; S.items = r.items; S.todos = r.todos || []; S.ctx = r.ctx; S.ctxLimit = r.ctxLimit || 2000000; S.bd = r.breakdown || S.bd; S.usage = r.usage; S.checkpoints = r.checkpoints || [];
    $('#chatcol').classList.remove('empty'); renderTranscript(); setBusy(r.busy); updateChips(); renderSidebar(); refreshChanges(); $('#input').focus(); if (S.pane && window.Panes) window.Panes.refresh();
  }
  window.openSession = openSession;
  $('#btn-open-folder').onclick = async () => { const f = await api.pickFolder(); if (f) { S.draft.cwd = f; api.setLast({ cwd: f }); newScreen(); } };

  // ---------- transcript ----------
  const scroller = () => $('#chat');
  function stick() { const c = scroller(); if (S.follow !== false) c.scrollTop = c.scrollHeight; }
  scroller().addEventListener('scroll', () => { const c = scroller(); S.follow = c.scrollHeight - c.scrollTop - c.clientHeight < 90; });
  const tr = () => $('#transcript');
  function addUser(text, images) {
    const d = el('div', 'msg user');
    if (images && images.length) { const g = el('div', 'uimgs'); images.forEach((u) => { const i = document.createElement('img'); i.src = u; i.alt = 'attached image'; g.appendChild(i); }); d.appendChild(g); }
    if (text) d.appendChild(document.createTextNode(text)); tr().appendChild(d);
  }
  // ---- image attachments: read, shrink to at most 1568 px, keep as data URLs until sent ----
  S.attach = [];
  const VISION_RE = /vl\b|-vl|vision|vila|gemini|gpt-4|gpt-5|gpt-6|claude|opus|sonnet|haiku|fable|\d+v\b|glm-4\.\dv|pixtral|llava|omni|gemma-[34]|qwen.*vl|cosmos|paligemma|mimo|llama-4|kimi|maverick|scout/i;
  function renderAttach() {
    const s = $('#attach-strip'); s.innerHTML = ''; s.hidden = !S.attach.length;
    S.attach.forEach((u, i) => { const t = el('div', 'thumb'); const im = document.createElement('img'); im.src = u; const x = el('button', null, '✕'); x.title = 'Remove'; x.onclick = () => { S.attach.splice(i, 1); renderAttach(); }; t.append(im, x); s.appendChild(t); });
  }
  async function addImageFile(file) {
    if (!file || !/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) { toast('Only PNG, JPEG, WebP or GIF images can be attached'); return; }
    if (S.attach.length >= 6) { toast('You can attach up to 6 images per message'); return; }
    const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
    const out = await new Promise((res) => {
      const im = new Image(); im.onload = () => {
        const k = Math.min(1, 1568 / Math.max(im.width, im.height)); if (k === 1 && file.size < 900 * 1024) return res(url);
        const c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', 0.86));
      }; im.onerror = () => res(null); im.src = url;
    });
    if (!out) { toast('Could not read that image'); return; }
    S.attach.push(out); renderAttach();
    const m = S.cur ? S.cur.model : S.draft.model; if (m && !VISION_RE.test(m)) toast(`${m} may not read images. Pick a vision model (for example one with "vl" or "omni" in its name) if it fails.`, 6000);
  }
  window.addImageFile = addImageFile;
  function asstShell(raw) {
    const d = el('div', 'msg assistant'); d.innerHTML = '<div class="mh"><span class="star">✦</span><span>CAELIX</span><button class="copy">Copy</button></div><div class="body"></div>'; d._raw = raw || '';
    d.querySelector('.copy').onclick = (e) => { navigator.clipboard.writeText(d._raw).then(() => { e.target.textContent = 'Copied'; setTimeout(() => (e.target.textContent = 'Copy'), 1200); }).catch(() => {}); };
    return d;
  }
  function startAssistant() { const d = asstShell(''); tr().appendChild(d); S.curText = d; S.curBuf = ''; moveWorkingLast(); return d; }
  const TOOLNAME = { WriteDocument: 'Document', TodoWrite: 'Tasks', AskUserQuestion: 'Question', WebFetch: 'Fetch', WebSearch: 'Search' };
  function toolTitle(n) { if (TOOLNAME[n]) return TOOLNAME[n]; if (n.startsWith('mcp__')) { const p = n.split('__'); return p[1] + ' · ' + p.slice(2).join('_'); } return n; }
  function toolInput(t) {
    const i = t.input || {};
    if (t.name === 'Bash') return `<pre>$ ${esc(i.command || '')}</pre>`;
    if (t.name === 'Edit') return `<pre>${(i.old_string || '').split('\n').map((l) => `<span class="d">- ${esc(l)}</span>`).join('')}${(i.new_string || '').split('\n').map((l) => `<span class="a">+ ${esc(l)}</span>`).join('')}</pre>`;
    if (t.name === 'Write') return `<pre>${(i.content || '').split('\n').slice(0, 30).map((l) => `<span class="a">+ ${esc(l)}</span>`).join('')}</pre>`;
    if (t.name === 'WriteDocument') return `<pre>${esc(i.filename || '')}\n${esc((i.content || '').slice(0, 600))}</pre>`;
    return `<pre>${esc(JSON.stringify(i, null, 1).slice(0, 700))}</pre>`;
  }
  function addTool(t) {
    if (t.name === 'TodoWrite') return null;
    const card = el('div', 'tool'); const title = toolTitle(t.name);
    card.innerHTML = `<div class="th"><span class="bd">${esc(title[0].toUpperCase())}</span><span class="nm">${esc(title)}</span><span class="sum">${esc((t.summary || '').slice(0, 140))}</span><span class="st">Running…</span><button class="dt">Details</button></div><div class="tbody">${toolInput(t)}</div>`;
    card.querySelector('.dt').onclick = () => card.classList.toggle('open'); tr().appendChild(card); S.toolMap[t.id] = card; moveWorkingLast();
    if (t.output != null) finishTool(t.id, t); return card;
  }
  function finishTool(id, e) {
    const card = S.toolMap[id]; if (!card) return; card.classList.add(e.error ? 'error' : 'done'); card.querySelector('.st').textContent = e.error ? 'Failed' : 'Done';
    if (e.output) { const pre = el('pre'); pre.textContent = e.output; card.querySelector('.tbody').appendChild(pre); }
  }
  function renderTodos() {
    let c = $('#todos-card'); if (c) c.remove(); if (!S.todos.length) return;
    c = el('div', 'todos'); c.id = 'todos-card'; c.innerHTML = S.todos.map((t) => `<div class="todo ${esc(t.status)}"><span class="ci"></span><span>${esc(t.content)}</span></div>`).join(''); tr().appendChild(c); moveWorkingLast();
  }
  function addSummary(s) {
    const c = el('div', 'sumcard'); const acts = `${s.ok} succeeded${s.failed ? ', ' + s.failed + ' failed' : ''}`; const failedNames = s.failedNames && s.failedNames.length ? ` (${s.failedNames.join(', ')})` : '';
    const text = `Task summary (${s.secs}s)\nActions: ${acts}${failedNames}${s.files.length ? '\nFiles changed: ' + s.files.join(', ') : ''}${s.issue ? '\nIssue: ' + s.issue : ''}${s.stop ? '\nEnded because: ' + s.stop.detail : ''}`;
    c.innerHTML = `<div class="sh">Summary · ${s.actions} action(s) · ${s.secs}s<button class="copybtn">Copy summary</button></div><h5>Task summary <span style="font-weight:400;color:var(--muted)">(${s.secs}s)</span></h5><ul><li><b>Actions:</b> ${esc(acts + failedNames)}</li>${s.files.length ? `<li><b>Files changed:</b> ${s.files.map((f) => `<code>${esc(f)}</code>`).join(' ')}</li>` : ''}${s.issue ? `<li><b>Issue:</b> ${esc(s.issue)}</li>` : ''}${s.stop ? `<li><b>Why it ended:</b> ${esc(s.stop.detail)}</li>` : ''}</ul>`;
    c.querySelector('.copybtn').onclick = (e) => navigator.clipboard.writeText(text).then(() => { e.target.textContent = 'Copied'; setTimeout(() => (e.target.textContent = 'Copy summary'), 1200); }).catch(() => {});
    tr().appendChild(c); moveWorkingLast();
  }
  function addNotice(cls, text) { const d = el('div', cls); d.textContent = text; tr().appendChild(d); moveWorkingLast(); }
  function setWorking(on) {
    let w = $('#working'); if (!on) { if (w) w.remove(); clearInterval(S.workT); return; }
    if (!w) { w = el('div', 'working'); w.id = 'working'; w.innerHTML = '<span class="dots4"><i></i><i></i><i></i><i></i></span><span id="work-t">Working…</span>'; tr().appendChild(w); S.t0 = Date.now(); clearInterval(S.workT); S.workT = setInterval(() => { const t = $('#work-t'); if (t) t.textContent = 'Working… ' + Math.round((Date.now() - S.t0) / 1000) + 's'; }, 1000); }
  }
  function moveWorkingLast() { const w = $('#working'); if (w) tr().appendChild(w); }
  function renderTranscript() {
    tr().innerHTML = ''; S.curText = null; S.toolMap = {};
    for (const it of S.items) {
      if (it.type === 'user') addUser(it.text, it.images);
      else if (it.type === 'assistant') { const d = asstShell(it.text); d.querySelector('.body').innerHTML = md.render(it.text); tr().appendChild(d); }
      else if (it.type === 'tool') addTool(it);
      else if (it.type === 'summary') addSummary(it);
      else if (it.type === 'error') addNotice('err', it.message);
      else if (it.type === 'info') addNotice('info', it.text);
    }
    renderTodos(); if (S.busy) setWorking(true); S.follow = true; stick();
  }

  // ---------- events ----------
  api.onEvent(({ sid, e }) => {
    if (e.type === 'idle' || e.type === 'turn_end') refreshSessions();
    if (!S.cur || sid !== S.cur.id) return;
    switch (e.type) {
      case 'turn_start': setBusy(true); break;
      case 'text_start': startAssistant(); break;
      case 'text': if (!S.curText) startAssistant(); S.curBuf += e.delta; S.curText._raw = S.curBuf; S.curText.querySelector('.body').innerHTML = md.render(S.curBuf); stick(); break;
      case 'text_end': S.items.push({ type: 'assistant', text: S.curBuf }); S.curText = null; break;
      case 'thinking': { let t = tr().lastChild; if (!t || !t.classList || !t.classList.contains('thinking-only')) { t = el('div', 'thinking thinking-only'); tr().appendChild(t); } t.textContent += e.delta; break; }
      case 'tool_start': addTool(e); S.items.push({ type: 'tool', ...e }); stick(); break;
      case 'tool_result': { finishTool(e.id, e); const it = [...S.items].reverse().find((x) => x.type === 'tool' && x.id === e.id); if (it) Object.assign(it, { output: e.output, error: e.error }); stick(); break; }
      case 'todos': S.todos = e.todos; renderTodos(); stick(); break;
      case 'summary': S.items.push({ type: 'summary', ...e.summary }); addSummary(e.summary); stick(); break;
      case 'error': addNotice('err', e.message); stick(); break;
      case 'route': addNotice('info', `OmniRoute → ${provName(e.provider)} / ${e.model}`); break;
      case 'route_fail': addNotice('info', `OmniRoute: ${provName(e.provider)} failed (${e.error}); trying the next provider`); break;
      case 'compacted': addNotice('info', `Conversation compacted (${e.before} → ${e.after} messages).`); break;
      case 'reset': addNotice('info', `Context reset${e.why === 'auto' ? ' automatically at 80%' : ''}: history summarised, memory kept (${fmt(e.before)} → ${fmt(e.after)} tokens).`); break;
      case 'mode': if (S.cur) { S.cur.mode = e.mode; updateChips(); } break;
      case 'cwd': if (S.cur && isCode()) { S.cur.cwd = e.cwd; updateChips(); } break;
      case 'context': S.ctx = e.used; S.ctxLimit = e.limit; S.usage = e.usage; if (e.breakdown) S.bd = e.breakdown; updateChips(); break;
      case 'file_changed': refreshChanges(); break;
      case 'bg_start': S.bg.push({ id: e.id, command: e.command, status: 'running' }); break;
      case 'bg_done': { const b = S.bg.find((x) => x.id === e.id); if (b) b.status = e.code === 0 ? 'done' : 'failed'; break; }
      case 'mcp': S.mcp = e; break;
      case 'ask': handleAsk(e); break;
      case 'subagent': addNotice('info', e.phase === 'start' ? `Sub-agent started: ${e.description}` : 'Sub-agent finished'); break;
      case 'idle': S.ctx = e.ctx; S.ctxLimit = e.ctxLimit; S.usage = e.usage; if (e.breakdown) S.bd = e.breakdown; S.checkpoints = e.checkpoints || S.checkpoints; setBusy(false); updateChips(); refreshChanges(); drainQueue(); break;
      case 'side_text': if (window.Modals && window.Modals.sideAppend) window.Modals.sideAppend(e.delta); break;
    }
  });
  api.onSessionsChanged(refreshSessions);

  function handleAsk({ id, req }) {
    if (req.kind === 'permission') return window.lazy('modals').then(() => window.Modals.permission(id, req));
    const c = el('div', 'qcard'); const send = (ans) => { c.querySelectorAll('button').forEach((b) => (b.disabled = true)); api.answer(S.cur.id, id, ans); };
    if (req.kind === 'question') { c.innerHTML = `<div>${esc(req.question)}</div>`; const o = el('div', 'opts'); (req.options || []).forEach((t) => { const b = el('button', 'btn', esc(t)); b.onclick = () => { send(t); b.classList.add('pri'); }; o.appendChild(b); }); c.appendChild(o); }
    else { c.innerHTML = `<div><b>Proposed plan</b></div><div class="msg assistant" style="margin-top:8px"><div class="body">${md.render(req.plan || '')}</div></div>`; const o = el('div', 'opts'); const a = el('button', 'btn pri', 'Approve plan'); a.onclick = () => send('approve'); const r = el('button', 'btn', 'Keep planning'); r.onclick = () => send('rejected: keep planning'); o.append(a, r); c.appendChild(o); }
    tr().appendChild(c); moveWorkingLast(); stick();
  }

  // ---------- composer ----------
  function setBusy(b) { S.busy = b; $('#btn-stop').hidden = !b; setWorking(b); if (!b) S.curText = null; }
  function renderQueue() { const q = $('#queue'); q.innerHTML = ''; S.queue.forEach((t, i) => { const d = el('div', 'qitem', `<span>Queued: ${esc(t.slice(0, 70))}</span><button class="x" title="Remove">✕</button>`); d.querySelector('.x').onclick = () => { S.queue.splice(i, 1); renderQueue(); }; q.appendChild(d); }); }
  function drainQueue() { if (S.queue.length && !S.busy) { const t = S.queue.shift(); renderQueue(); submit(t, true); } }
  async function ensureSession() {
    if (S.cur) return true;
    if (isCode() && !S.draft.cwd) { toast('Open a project folder first'); return false; }
    const r = await api.newSession({ kind: S.kind, cwd: isCode() ? S.draft.cwd : '', provider: S.draft.provider, model: S.draft.model, mode: S.draft.mode });
    S.cur = r.meta; await api.setSession(r.meta.id, { effort: S.draft.effort, team: S.draft.team, coder: S.draft.coder || null, reviewer: S.draft.reviewer || null }); S.cur.coder = S.draft.coder || null; S.cur.reviewer = S.draft.reviewer || null; S.cur.effort = S.draft.effort; S.cur.team = S.draft.team; S.items = []; $('#chatcol').classList.remove('empty'); tr().innerHTML = ''; await refreshSessions(); return true;
  }
  async function submit(text, fromQueue) {
    text = text.trim(); if (!text && !S.attach.length) return;
    if (!fromQueue && text.startsWith('/')) { const handled = await runSlash(text); if (handled) return; }
    if (S.busy && !fromQueue && S.attach.length) { toast('Wait for the current reply to finish before sending images'); return; }
    if (S.busy && !fromQueue) { S.queue.push(text); renderQueue(); $('#input').value = ''; autosize(); return; }
    if (keyProblem()) { toast(keyProblem(), 3500); return; }
    if (!(await ensureSession())) return;
    $('#input').value = ''; autosize(); hidePops(); const imgs = S.attach.slice(); S.attach = []; renderAttach(); S.items.push({ type: 'user', text, ...(imgs.length ? { images: imgs } : {}) }); addUser(text, imgs); S.follow = true; setBusy(true); stick();
    if (S.cur.title === 'New chat' || S.cur.title === 'New session') { S.cur.title = (text || 'Image').replace(/\s+/g, ' ').slice(0, 40); setTitle(); }
    try { await api.send(S.cur.id, text, imgs); } catch (e) { addNotice('err', e.message); setBusy(false); }
  }
  window.submit = submit;
  function autosize() { const t = $('#input'); t.style.height = 'auto'; t.style.height = Math.min(240, t.scrollHeight) + 'px'; }
  function hidePops() { $('#slash-menu').hidden = true; S.slashSel = 0; }
  function showSlash(q) {
    const items = SLASH.filter((s) => s[0].startsWith(q.split(' ')[0])); const m = $('#slash-menu'); if (!items.length || q.includes(' ')) return hidePops();
    m.innerHTML = ''; S.slashItems = items; S.slashSel = Math.min(S.slashSel || 0, items.length - 1);
    items.forEach(([c, d], i) => { const r = el('div', 'pi' + (i === S.slashSel ? ' sel' : ''), `<span>${esc(c)}</span><span class="d">${esc(d)}</span>`); r.onmousedown = (ev) => { ev.preventDefault(); $('#input').value = c + ' '; hidePops(); $('#input').focus(); }; m.appendChild(r); }); m.hidden = false;
    const sel = m.querySelector('.sel'); if (sel) sel.scrollIntoView({ block: 'nearest' });
  }
  async function showMentions(q) {
    if (!isCode() || !curCwd()) return; const files = await api.mentions(curCwd(), q); const m = $('#slash-menu'); if (!files.length) return hidePops(); m.innerHTML = ''; S.slashItems = null;
    files.forEach((f) => { const r = el('div', 'pi', `<span>@${esc(f)}</span>`); r.onmousedown = (ev) => { ev.preventDefault(); const t = $('#input'); t.value = t.value.replace(/@[^\s@]*$/, '@' + f + ' '); hidePops(); t.focus(); autosize(); }; m.appendChild(r); }); m.hidden = false;
  }
  $('#input').addEventListener('input', () => { autosize(); const v = $('#input').value; if (v.startsWith('/')) showSlash(v); else { const m = /@([^\s@]*)$/.exec(v); if (m) showMentions(m[1]); else hidePops(); } });
  $('#input').addEventListener('keydown', (e) => {
    const menu = $('#slash-menu');
    if (!menu.hidden && S.slashItems) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); S.slashSel = (S.slashSel + (e.key === 'ArrowDown' ? 1 : -1) + S.slashItems.length) % S.slashItems.length; showSlash($('#input').value); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && !$('#input').value.includes(' '))) { e.preventDefault(); $('#input').value = S.slashItems[S.slashSel][0] + ' '; hidePops(); autosize(); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); const v = $('#input').value; if (e.metaKey && S.busy) { S.queue.push(v.trim()); renderQueue(); $('#input').value = ''; autosize(); } else submit(v); }
    if (e.key === 'Escape') { hidePops(); if (S.busy) stop(); }
  });
  function stop() { if (S.cur && S.busy) api.stop(S.cur.id); }
  $('#input').addEventListener('paste', (e) => { const fs = Array.from(e.clipboardData && e.clipboardData.files || []).filter((f) => f.type.startsWith('image/')); if (fs.length) { e.preventDefault(); fs.forEach(addImageFile); } });
  const comp = $('#composer'); ['dragenter', 'dragover'].forEach((n) => comp.addEventListener(n, (e) => { if (Array.from(e.dataTransfer.types || []).includes('Files')) { e.preventDefault(); comp.classList.add('dragover'); } }));
  ['dragleave', 'drop'].forEach((n) => comp.addEventListener(n, () => comp.classList.remove('dragover')));
  comp.addEventListener('drop', (e) => { const fs = Array.from(e.dataTransfer.files || []).filter((f) => f.type.startsWith('image/')); if (fs.length) { e.preventDefault(); fs.forEach(addImageFile); } });
  function pickImages() { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/png,image/jpeg,image/webp,image/gif'; i.multiple = true; i.onchange = () => Array.from(i.files).forEach(addImageFile); i.click(); }
  api.onTitle && api.onTitle(({ sid, title }) => { if (S.cur && S.cur.id === sid) { S.cur.title = title; setTitle(); } });
  $('#btn-stop').onclick = stop; $('#btn-send').onclick = () => submit($('#input').value);
  $('#btn-cmds').onclick = () => { const i = $('#input'); i.focus(); i.value = '/'; i.dispatchEvent(new Event('input')); };
  $('#btn-plus').onclick = (e) => popMenu(e.currentTarget, [['Attach image…', pickImages], ['Attach files…', async () => { const fs = await api.pickFiles(); if (fs.length) { $('#input').value += fs.map((f) => '@' + f).join(' ') + ' '; autosize(); $('#input').focus(); } }], ['Skills…', async () => { const k = isCode() && curCwd() ? await api.skills(curCwd()) : []; popMenu($('#btn-plus'), k.length ? k.map((n) => ['/' + n, () => { $('#input').value = 'Use the skill ' + n + ': '; $('#input').focus(); }]) : [['No skills in .caelix/skills yet', () => {}]], { up: true }); }], ['MCP servers…', () => window.lazy('modals').then(() => window.Modals.mcp())]], { up: true });
  $('#btn-agents').onclick = async (e) => { const a = await api.agents(curCwd() || ''); popMenu(e.currentTarget, a.map((x) => [x.name, () => { $('#input').value = `Use the ${x.name} agent to `; $('#input').focus(); autosize(); }, { desc: x.desc }]), { up: true }); };
  $('#keyban-open').onclick = () => window.lazy('modals').then(() => window.Modals.keys());

  async function pickFolderNew() { const f = await api.pickFolder(); if (!f) return; S.draft.cwd = f; api.setLast({ cwd: f }); newScreen(); }
  $('#chip-folder-top').onclick = () => { if (S.cur) { toast('This session stays in its folder: ' + curCwd()); api.reveal(curCwd()); } else pickFolderNew(); };
  $('#foot-folder').onclick = () => curCwd() && api.reveal(curCwd());
  $('#foot-memory').onclick = () => window.lazy('modals').then(() => window.Modals.memory());
  function modeMenu(anchor) { if (!isCode()) return; popMenu(anchor || $('#chip-mode'), MODES.map(([id, label, desc]) => [label, () => setMode(id), { desc, cur: curMode() === id }])); }
  async function setMode(id) { if (S.cur) { await api.setSession(S.cur.id, { mode: id }); S.cur.mode = id; } else S.draft.mode = id; api.setLast({ mode: id }); updateChips(); }
  $('#chip-mode').onclick = (e) => modeMenu(e.currentTarget); $('#chip-mode-top').onclick = (e) => modeMenu(e.currentTarget);
  $('#chip-team').onclick = () => window.lazy('modals').then(() => window.Modals.team());
  const _oldTeam = async () => { const v = !curTeam(); if (S.cur) { await api.setSession(S.cur.id, { team: v }); S.cur.team = v; } else S.draft.team = v; updateChips(); toast(v ? 'Team mode on: work is split across sub-agents' : 'Team mode off'); };
  function effortMenu(anchor) { popMenu(anchor || $('#chip-model'), EFFORTS.map(([id, l]) => [l, async () => { if (S.cur) { await api.setSession(S.cur.id, { effort: id }); S.cur.effort = id; } else S.draft.effort = id; toast('Effort: ' + l); }, { cur: eff() === id }])); }
  $('#chip-model').onclick = () => window.lazy('modals').then(() => window.Modals.modelPicker($('#chip-model'))); $('#chip-model-top').onclick = () => window.lazy('modals').then(() => window.Modals.modelPicker($('#chip-model-top')));
  window.setModel = async (provider, model) => { if (S.cur) { await api.setSession(S.cur.id, { provider, model }); S.cur.provider = provider; S.cur.model = model; } else { S.draft.provider = provider; S.draft.model = model; } api.setLast({ provider, model }); updateChips(); };
  $('#chip-view').onclick = (e) => popMenu(e.currentTarget, VIEWS.map(([v, l]) => [l, () => setView(v), { cur: S.view === v }]));
  function setView(v) { S.view = v; document.body.classList.remove('view-normal', 'view-thinking', 'view-verbose'); document.body.classList.add('view-' + v); api.setSettings({ viewMode: v }); updateChips(); }

  // ---------- slash commands ----------
  async function runSlash(text) {
    const [cmd0, ...rest] = text.split(/\s+/); const cmd = cmd0 === '/compat' ? '/compact' : cmd0; const arg = rest.join(' ').trim(); const known = SLASH.find((s) => s[0] === cmd0); if (!known) return false;
    $('#input').value = ''; autosize(); hidePops();
    const needSession = ['/compact', '/reset', '/rewind', '/diff', '/remember', '/init', '/export', '/btw', '/rename', '/clear', '/copy', '/fork', '/system'].includes(cmd);
    if (needSession && !S.cur) { toast('Start a conversation first'); return true; }
    switch (cmd) {
      case '/reset': { addNotice('info', 'Resetting context…'); const r = await api.resetChat(S.cur.id); S.ctx = r.ctx; S.bd = r.breakdown; await openSession(S.cur.id); toast(r.ok ? 'Context reset: summary and memory kept' : 'Nothing to reset yet'); break; }
      case '/compact': { addNotice('info', 'Compacting…'); const r = await api.compact(S.cur.id); S.ctx = r.ctx; addNotice('info', r.ok ? 'Compacted.' : 'Nothing to compact yet.'); updateChips(); break; }
      case '/clear': await api.clear(S.cur.id); S.items = []; S.todos = []; S.ctx = 0; renderTranscript(); updateChips(); break;
      case '/new': $('#btn-new').click(); break; case '/chat': setKind('chat'); break; case '/code': setKind('code'); break;
      case '/model': $('#chip-model').click(); break; case '/mode': if (isCode()) modeMenu(); else toast('Chat has no permission modes'); break;
      case '/plan': if (isCode()) { setMode('plan'); toast('Plan mode on'); } break; case '/team': $('#chip-team').click(); break;
      case '/agents': $('#btn-agents').click(); break;
      case '/rename': if (arg) { await api.setSession(S.cur.id, { title: arg }); S.cur.title = arg; setTitle(); refreshSessions(); } else { await window.lazy('modals'); const t = await window.Modals.askText('Rename chat', S.cur.title); if (t) { await api.setSession(S.cur.id, { title: t }); S.cur.title = t; setTitle(); refreshSessions(); } } break;
      case '/rewind': window.lazy('modals').then(() => window.Modals.rewind()); break;
      case '/diff': openPane('diff'); break; case '/terminal': openPane('terminal'); break; case '/browser': openPane('browser'); break; case '/files': openPane('files'); break;
      case '/context': openPane('context'); break;
      case '/cost': addNotice('info', `Tokens: ${fmt(S.usage.in)} in / ${fmt(S.usage.out)} out. Context ≈ ${pctStr(S.ctx)} (${fmt(S.ctx)} of ${fmt(S.ctxLimit)}).`); break;
      case '/memory': window.lazy('modals').then(() => window.Modals.memory()); break;
      case '/remember': if (arg) { await api.addNote(S.cur.id, arg); toast('Saved to notes'); } else toast('Usage: /remember <text>'); break;
      case '/init': { const f = await api.initProject(S.cur.id); toast('CAELIX.md ready: ' + f); break; }
      case '/export': toast('Saved ' + (await api.exportChat(S.cur.id))); break;
      case '/copy': { const last = [...S.items].reverse().find((x) => x.type === 'assistant'); if (last) { await navigator.clipboard.writeText(last.text); toast('Copied last reply'); } break; }
      case '/btw': window.lazy('modals').then(() => window.Modals.side(arg)); break;
      case '/skills': { const k = isCode() && curCwd() ? await api.skills(curCwd()) : []; addNotice('info', k.length ? 'Skills: ' + k.join(', ') : 'No skills found. Add .caelix/skills/<name>/SKILL.md'); break; }
      case '/hooks': window.lazy('modals').then(() => window.Modals.hooks()); break; case '/mcp': window.lazy('modals').then(() => window.Modals.mcp()); break;
      case '/keys': window.lazy('modals').then(() => window.Modals.keys()); break; case '/settings': window.lazy('modals').then(() => window.Modals.settings()); break;
      case '/system': window.lazy('modals').then(() => window.Modals.system()); break;
      case '/docs': api.openDocs(); break;
      case '/fork': { const r = await api.forkSession(S.cur.id); await refreshSessions(); openSession(r.id); break; }
      case '/theme': window.toggleTheme(); break; case '/view': setView({ normal: 'thinking', thinking: 'verbose', verbose: 'normal' }[S.view]); break;
      case '/help': window.lazy('modals').then(() => window.Modals.help()); break;
    }
    return true;
  }

  // ---------- panes ----------
  const loaded = {};
  window.lazy = (name) => loaded[name] || (loaded[name] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = name + '.js'; s.onload = res; s.onerror = () => rej(new Error('load ' + name)); document.head.appendChild(s); }));
  function openPane(name) { if (S.pane === name) return closeAllPanes(); S.pane = name; $('#sidepane').hidden = false; window.lazy('panes').then(() => window.Panes.show(name)); setPaneButtons(); }
  function closeAllPanes() { S.pane = null; $('#sidepane').hidden = true; setPaneButtons(); }
  function setPaneButtons() { $('#btn-browser').classList.toggle('on', S.pane === 'browser'); $('#btn-panel').classList.toggle('on', !!S.pane); }
  window.openPane = openPane; window.closeAllPanes = closeAllPanes; window.setPaneButtons = setPaneButtons;
  $('#btn-browser').onclick = () => openPane('browser'); $('#btn-panel').onclick = () => (S.pane ? closeAllPanes() : openPane(S.lastPane || 'context'));
  $('#btn-keys').onclick = () => window.lazy('modals').then(() => window.Modals.keys()); $('#btn-mcp').onclick = () => window.lazy('modals').then(() => window.Modals.mcp()); $('#btn-hooks').onclick = () => window.lazy('modals').then(() => window.Modals.hooks());
  $('#btn-theme').onclick = () => window.toggleTheme(); $('#tb-sidebar').onclick = () => $('#sidebar').classList.toggle('collapsed');
  $('#btn-update').onclick = () => window.lazy('modals').then(() => window.Modals.updates());
  api.onOpenUpdates && api.onOpenUpdates(() => $('#btn-update').click());
  api.onUpdateStatus && api.onUpdateStatus((r) => { $('#btn-update').classList.add('has'); $('#btn-update').querySelector('.dotbadge').hidden = false; $('#btn-update').title = 'A new version is available: click to update'; toast('A new CAELIX version is available. Click the ⟳ button to update.', 7000); });
  $('#title-btn').onclick = async () => { if (!S.cur) { toast('Send a first message, then you can rename the chat'); return; } await window.lazy('modals'); const t = await window.Modals.askText('Rename chat', S.cur.title); if (t) runSlash('/rename ' + t); };
  async function refreshChanges() { if (!S.cur || !isCode()) { S.changes = []; return; } try { S.changes = await api.diff(S.cur.id); } catch (_) { S.changes = []; } if (S.pane === 'diff' && window.Panes) window.Panes.refresh(); }
  window.refreshChanges = refreshChanges;

  // ---------- keyboard ----------
  document.addEventListener('keydown', (e) => {
    const cmd = e.metaKey, k = e.key.toLowerCase();
    if (cmd && !e.shiftKey && k === 'n') { e.preventDefault(); newScreen(); }
    else if (cmd && e.shiftKey && k === 'd') { e.preventDefault(); openPane('diff'); }
    else if (cmd && e.shiftKey && k === 'b') { e.preventDefault(); openPane('browser'); }
    else if (e.ctrlKey && e.key === '`') { e.preventDefault(); openPane('terminal'); }
    else if (cmd && e.key === '\\') { e.preventDefault(); closeAllPanes(); }
    else if (cmd && e.key === ';') { e.preventDefault(); window.lazy('modals').then(() => window.Modals.side('')); }
    else if (e.ctrlKey && k === 'o') { e.preventDefault(); setView({ normal: 'thinking', thinking: 'verbose', verbose: 'normal' }[S.view]); }
    else if (cmd && e.shiftKey && k === 'm') { e.preventDefault(); modeMenu(); }
    else if (cmd && e.shiftKey && k === 'i') { e.preventDefault(); $('#chip-model').click(); }
    else if (cmd && e.shiftKey && k === 'e') { e.preventDefault(); effortMenu(); }
    else if (cmd && e.key === '/') { e.preventDefault(); window.lazy('modals').then(() => window.Modals.help()); }
    else if (e.ctrlKey && e.key === 'Tab') { e.preventDefault(); const l = S.sessions.filter((s) => !s.archived && (s.kind || 'code') === S.kind); if (!l.length) return; const i = l.findIndex((s) => S.cur && s.id === S.cur.id); openSession(l[(i + (e.shiftKey ? -1 : 1) + l.length) % l.length].id); }
    else if (openPop && /^[1-9]$/.test(e.key)) { const it = openPop.children[+e.key - 1]; if (it) { e.preventDefault(); it.click(); } }
    else if (e.key === 'Escape' && openPop) closePop();
  });
  $('#btn-new').onclick = () => { if (isCode()) S.draft.cwd = ''; newScreen(); }; // a new Code session always starts by choosing a folder $('#search').addEventListener('input', (e) => { S.filter = e.target.value; renderSidebar(); });
  document.addEventListener('click', (e) => { const a = e.target.closest('a[data-ext]'); if (a) { e.preventDefault(); api.openUrl(a.href); } });

  // ---------- boot ----------
  (async function boot() {
    const info = await api.init(); S.providers = info.providers; S.sessions = info.sessions; S.info = info; S.fav = info.fav || [];
    const st = await api.getSettings(info.home).catch(() => ({})); applyTheme(st.theme || 'dark'); S.view = st.viewMode || 'normal'; document.body.classList.add('view-' + S.view);
    const l = info.last || {}; S.draft.cwd = ''; if (l.provider) { S.draft.provider = l.provider; S.draft.model = l.model || 'auto'; } if (l.mode) S.draft.mode = l.mode; if (st.defaultMode && !l.mode) S.draft.mode = st.defaultMode;
    S.kind = l.kind === 'code' ? 'code' : 'chat'; if (S.draft.cwd && !S.sessions.some((s) => s.cwd === S.draft.cwd)) S.draft.cwd = S.draft.cwd;
    renderSidebar(); newScreen(); api.uiReady();
    if (!S.providers.some((p) => !p.virtual && p.hasKey) && !S.sessions.length) setTimeout(() => toast('Tip: open Keys to add a provider key and load its models'), 700);
  })();
  window.addEventListener('error', (e) => console.error('window error:', e.message));
  window.addEventListener('unhandledrejection', (e) => console.error('unhandled rejection:', e.reason && e.reason.message || e.reason));
  window.__caelix = { S, submit, openSession, newScreen, refreshSessions, openPane, setMode, runSlash, renderTranscript, setKind };
})();
