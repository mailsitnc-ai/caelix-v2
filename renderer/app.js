'use strict';
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => md.esc(String(s == null ? '' : s));
  const api = window.caelix;
  const MODES = [['default', 'Manual', 'Ask before editing files or running commands'], ['acceptEdits', 'Accept edits', 'Auto-accept file edits, ask for other commands'], ['plan', 'Plan', 'Read-only: explore and propose a plan'], ['auto', 'Auto', 'Run without routine prompts; destructive commands are blocked'], ['bypassPermissions', 'Bypass permissions', 'Run everything without asking'], ['dontAsk', "Don't ask", 'Only pre-approved tools run']];
  const EFFORTS = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']];
  const SLASH = [['/clear', 'Clear this conversation'], ['/compact', 'Summarise to free context'], ['/model', 'Choose model'], ['/mode', 'Change permission mode'], ['/plan', 'Switch to plan mode'], ['/rename', 'Rename session: /rename <title>'], ['/rewind', 'Undo changes from a past prompt'], ['/diff', 'Show changes'], ['/memory', 'Show project memory'], ['/remember', 'Save a note: /remember <text>'], ['/init', 'Create CAELIX.md for this project'], ['/cost', 'Show token usage'], ['/context', 'Show context use'], ['/export', 'Export as Markdown'], ['/btw', 'Ask a side question: /btw <question>'], ['/skills', 'List skills'], ['/hooks', 'Show hook setup'], ['/mcp', 'Show MCP setup'], ['/keys', 'Open the Keys screen'], ['/settings', 'Open settings'], ['/theme', 'Toggle light / dark'], ['/help', 'Show shortcuts']];
  const S = { sessions: [], cur: null, items: [], providers: [], models: {}, view: 'normal', pane: null, rail: false, queue: [], busy: false, todos: [], ctx: 0, ctxLimit: 128000, usage: { in: 0, out: 0 }, draft: { cwd: '', provider: 'omniroute', model: 'auto', mode: 'default', effort: 'medium' }, tg: null, curText: null, curBuf: '', workT: 0, bg: [], changes: [], checkpoints: [], archivedShown: false, filter: '' };
  window.S = S; window.$ = $; window.el = el; window.esc = esc; window.api = api;

  function toast(msg, ms) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms || 2600); }
  window.toast = toast;
  const folderName = (p) => (p ? p.split('/').filter(Boolean).pop() || '/' : '');
  const modeLabel = (m) => (MODES.find((x) => x[0] === m) || [0, m])[1];
  const eff = () => (S.cur ? S.cur.effort : S.draft.effort) || 'medium';
  const curMode = () => (S.cur ? S.cur.mode : S.draft.mode);
  const curModel = () => (S.cur ? { provider: S.cur.provider, model: S.cur.model } : { provider: S.draft.provider, model: S.draft.model });
  const curCwd = () => (S.cur ? S.cur.cwd : S.draft.cwd);

  // ---------- theme ----------
  function applyTheme(t) { const dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches); document.documentElement.dataset.theme = dark ? 'dark' : 'light'; S.theme = t; }
  window.toggleTheme = () => { const n = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; applyTheme(n); api.setSettings({ theme: n }); };

  // ---------- sidebar ----------
  function renderSidebar() {
    const list = $('#session-list'); list.innerHTML = '';
    const q = S.filter.toLowerCase(); const now = new Date(); const sod = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const vis = S.sessions.filter((s) => (S.archivedShown ? s.archived : !s.archived) && (!q || (s.title || '').toLowerCase().includes(q) || (s.cwd || '').toLowerCase().includes(q)));
    const groups = [['Pinned', vis.filter((s) => s.pinned)], ['Today', vis.filter((s) => !s.pinned && s.updated >= sod)], ['Yesterday', vis.filter((s) => !s.pinned && s.updated < sod && s.updated >= sod - 864e5)], ['Earlier', vis.filter((s) => !s.pinned && s.updated < sod - 864e5)]];
    for (const [name, arr] of groups) {
      if (!arr.length) continue; list.appendChild(el('div', 'grp', name));
      for (const s of arr) {
        const r = el('div', 'srow' + (S.cur && S.cur.id === s.id ? ' active' : '') + (s.running ? ' running' : ''));
        r.dataset.id = s.id; r.innerHTML = `<span class="st"></span><div class="tt">${esc(s.title || 'New session')}<div class="sub">${esc(folderName(s.cwd))}</div></div><button class="dots" title="Options">⋯</button>`;
        r.onclick = (e) => { if (e.target.closest('.dots')) return sessionMenu(s, e.target); openSession(s.id); };
        list.appendChild(r);
      }
    }
    const t = el('div', 'grp'); t.style.cursor = 'pointer'; t.textContent = S.archivedShown ? '← Back to sessions' : 'View archived'; t.onclick = () => { S.archivedShown = !S.archivedShown; renderSidebar(); }; list.appendChild(t);
    if (!vis.length) list.insertBefore(el('div', 'empty-note', S.archivedShown ? 'No archived sessions' : 'No sessions yet'), list.firstChild);
  }
  async function refreshSessions() { S.sessions = await api.listSessions(); renderSidebar(); }
  function sessionMenu(s, anchor) {
    popMenu(anchor, [['Rename…', async () => { const t = prompt('Rename session', s.title); if (t) { await api.setSession(s.id, { title: t }); if (S.cur && S.cur.id === s.id) { S.cur.title = t; setTitle(); } refreshSessions(); } }],
      [s.pinned ? 'Unpin' : 'Pin', async () => { await api.setSession(s.id, { pinned: !s.pinned }); refreshSessions(); }],
      ['Fork', async () => { const r = await api.forkSession(s.id); await refreshSessions(); openSession(r.id); }],
      [s.archived ? 'Unarchive' : 'Archive', async () => { await api.setSession(s.id, { archived: !s.archived }); if (S.cur && S.cur.id === s.id && !s.archived) newScreen(); refreshSessions(); }],
      ['Delete', async () => { if (confirm('Delete this session permanently?')) { await api.deleteSession(s.id); if (S.cur && S.cur.id === s.id) newScreen(); refreshSessions(); } }]]);
  }

  // ---------- generic popup menu ----------
  let openPop = null;
  function closePop() { if (openPop) { openPop.remove(); openPop = null; } }
  document.addEventListener('mousedown', (e) => { if (openPop && !openPop.contains(e.target) && !e.target.closest('[data-popanchor]')) closePop(); });
  function popMenu(anchor, items, opts) {
    closePop(); const m = el('div', 'popup'); m.style.position = 'fixed';
    items.forEach(([label, fn, extra], i) => { const r = el('div', 'pi' + (extra && extra.cur ? ' cur' : '')); r.innerHTML = `<span>${esc(label)}</span>${extra && extra.desc ? `<span class="d">${esc(extra.desc)}</span>` : ''}<span class="k">${i < 9 ? i + 1 : ''}</span>`; r.onclick = () => { closePop(); fn(); }; m.appendChild(r); });
    document.body.appendChild(m); const b = anchor.getBoundingClientRect(); const w = m.offsetWidth, h = m.offsetHeight;
    let x = Math.min(b.left, innerWidth - w - 8), y = b.bottom + 4; if (y + h > innerHeight - 8 || (opts && opts.up)) y = Math.max(8, b.top - h - 4);
    m.style.left = Math.max(8, x) + 'px'; m.style.top = y + 'px'; m.dataset.items = items.length; openPop = m; anchor.dataset.popanchor = 1; return m;
  }
  window.popMenu = popMenu; window.closePop = closePop;

  // ---------- title / chips ----------
  function setTitle() { $('#title-text').textContent = S.cur ? S.cur.title || 'New session' : 'CAELIX'; document.title = S.cur ? (S.cur.title || 'CAELIX') + ' — CAELIX' : 'CAELIX'; }
  function updateChips() {
    $('#folder-name').textContent = curCwd() ? folderName(curCwd()) : 'Choose folder';
    const m = curModel(); $('#model-name').textContent = m.model ? (m.provider === 'omniroute' ? m.model : m.model.split('/').pop()) : 'Pick a model';
    $('#model-name').title = m.provider + ' / ' + m.model; $('#effort-name').textContent = (EFFORTS.find((e) => e[0] === eff()) || [0, 'Medium'])[1];
    $('#mode-name').textContent = modeLabel(curMode());
    const pct = Math.min(1, S.ctx / S.ctxLimit); $('#ctx-arc').setAttribute('stroke-dashoffset', String(50.3 * (1 - pct))); $('#ctx-ring').setAttribute('title', `Context ${Math.round(pct * 100)}% of ${Math.round(S.ctxLimit / 1000)}k`);
    updateRail();
  }
  window.updateChips = updateChips;

  // ---------- screens ----------
  function newScreen() {
    S.cur = null; S.items = []; S.todos = []; S.ctx = 0; S.busy = false; S.queue = []; renderQueue();
    $('#transcript').innerHTML = ''; $('#chatcol').classList.add('empty'); setTitle(); setBusy(false); updateChips(); renderSidebar(); $('#input').focus(); closeAllPanes(); S.tg = null;
  }
  async function openSession(id) {
    const r = await api.openSession(id); S.cur = r.meta; S.items = r.items; S.todos = r.todos || []; S.ctx = r.ctx; S.ctxLimit = r.ctxLimit; S.usage = r.usage; S.checkpoints = r.checkpoints || [];
    $('#chatcol').classList.remove('empty'); renderTranscript(); setTitle(); setBusy(r.busy); updateChips(); renderSidebar(); refreshChanges(); $('#input').focus();
    if (S.pane && window.Panes) window.Panes.refresh();
  }
  window.openSession = openSession;

  // ---------- transcript ----------
  const scroller = () => $('#chat');
  function stick() { const c = scroller(); if (S.follow !== false) c.scrollTop = c.scrollHeight; }
  scroller().addEventListener('scroll', () => { const c = scroller(); S.follow = c.scrollHeight - c.scrollTop - c.clientHeight < 80; });
  function addUser(text) { const d = el('div', 'msg user'); d.textContent = text; $('#transcript').appendChild(d); S.tg = null; }
  function startAssistant() { const d = el('div', 'msg assistant'); $('#transcript').appendChild(d); S.curText = d; S.curBuf = ''; S.tg = null; moveWorkingLast(); return d; }
  function groupSummary(g) {
    const c = {}; g.items.forEach((t) => { const k = { Bash: 'command', Read: 'read', Glob: 'search', Grep: 'search', Write: 'edit', Edit: 'edit', NotebookEdit: 'edit', WebFetch: 'web', WebSearch: 'web', Agent: 'agent' }[t.name] || 'tool'; c[k] = (c[k] || 0) + 1; });
    const parts = []; const pl = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;
    if (c.command) parts.push('Ran ' + pl(c.command, 'command')); if (c.read) parts.push('Read ' + pl(c.read, 'file')); if (c.edit) parts.push('Edited ' + pl(c.edit, 'file')); if (c.search) parts.push('Searched ' + pl(c.search, 'time')); if (c.web) parts.push('Browsed ' + pl(c.web, 'page')); if (c.agent) parts.push('Ran ' + pl(c.agent, 'sub-agent')); if (c.tool) parts.push('Used ' + pl(c.tool, 'tool'));
    const running = g.items.some((t) => !t.done);
    const last = g.items[g.items.length - 1];
    g.sum.innerHTML = (running ? '<span class="run"></span> ' : '') + esc(running ? (last.name + ' ' + (last.summary || '').slice(0, 60)) : parts.join(', '));
  }
  function addTool(t) {
    if (t.name === 'TodoWrite') return null;
    if (!S.tg) { const d = el('details', 'tg'); if (S.view === 'verbose') d.open = true; const sum = el('summary'); const body = el('div', 'tg-body'); d.append(sum, body); $('#transcript').appendChild(d); S.tg = { d, sum, body, items: [] }; moveWorkingLast(); }
    const card = el('div', 'tool'); const inputHtml = toolInput(t);
    card.innerHTML = `<div class="tool-h"><b>${esc(t.name)}</b><span class="sum">${esc((t.summary || '').slice(0, 160))}</span><span class="ms"></span></div>${inputHtml}`;
    S.tg.body.appendChild(card); const rec = { name: t.name, summary: t.summary, id: t.id, card, done: !!t.output || t.output === '' }; S.tg.items.push(rec); card._rec = rec; S.tg.map = S.tg.map || {}; S.tg.map[t.id] = rec; groupSummary(S.tg);
    if (t.output != null) finishTool(t.id, t, S.tg);
    return rec;
  }
  function toolInput(t) {
    const i = t.input || {};
    if (t.name === 'Bash') return `<pre>$ ${esc(i.command || '')}</pre>`;
    if (t.name === 'Edit') return `<pre class="diffy">${(i.old_string || '').split('\n').map((l) => `<span class="d">- ${esc(l)}</span>`).join('')}${(i.new_string || '').split('\n').map((l) => `<span class="a">+ ${esc(l)}</span>`).join('')}</pre>`;
    if (t.name === 'Write') return `<pre class="diffy">${(i.content || '').split('\n').slice(0, 30).map((l) => `<span class="a">+ ${esc(l)}</span>`).join('')}</pre>`;
    if (t.name === 'TodoWrite' || t.name === 'Read') return '';
    return `<pre>${esc(JSON.stringify(i, null, 1).slice(0, 600))}</pre>`;
  }
  function finishTool(id, e, g) {
    g = g || S.tg || findGroup(id); if (!g || !g.map || !g.map[id]) return; const rec = g.map[id]; rec.done = true;
    rec.card.classList.add(e.error ? 'error' : 'done'); rec.card.querySelector('.ms').textContent = e.ms != null ? e.ms + ' ms' : '';
    if (e.output) { const pre = el('pre'); pre.textContent = e.output; rec.card.appendChild(pre); }
    groupSummary(g);
  }
  function findGroup(id) { for (const d of document.querySelectorAll('details.tg')) if (d._g && d._g.map && d._g.map[id]) return d._g; return null; }
  function renderTodos() {
    let c = $('#todos-card'); if (c) c.remove(); if (!S.todos.length) return;
    c = el('div', 'todos'); c.id = 'todos-card'; c.innerHTML = S.todos.map((t) => `<div class="todo ${esc(t.status)}"><span class="ci"></span><span>${esc(t.content)}</span></div>`).join('');
    $('#transcript').appendChild(c); S.tg = null; moveWorkingLast();
  }
  function addNotice(cls, text) { const d = el('div', cls); d.textContent = text; $('#transcript').appendChild(d); S.tg = null; moveWorkingLast(); }
  function setWorking(on) {
    let w = $('#working');
    if (!on) { if (w) w.remove(); clearInterval(S.workT); return; }
    if (!w) { w = el('div', 'working'); w.id = 'working'; w.innerHTML = '<span class="dots4"><i></i><i></i><i></i><i></i></span><span id="work-t">Working…</span>'; $('#transcript').appendChild(w); S.t0 = Date.now(); clearInterval(S.workT); S.workT = setInterval(() => { const t = $('#work-t'); if (t) t.textContent = 'Working… ' + Math.round((Date.now() - S.t0) / 1000) + 's'; }, 1000); }
  }
  function moveWorkingLast() { const w = $('#working'); if (w) $('#transcript').appendChild(w); }
  function renderTranscript() {
    $('#transcript').innerHTML = ''; S.tg = null; S.curText = null;
    for (const it of S.items) {
      if (it.type === 'user') addUser(it.text);
      else if (it.type === 'assistant') { const d = el('div', 'msg assistant', md.render(it.text)); $('#transcript').appendChild(d); S.tg = null; }
      else if (it.type === 'tool') { addTool(it); if (S.tg) S.tg.d._g = S.tg; }
      else if (it.type === 'error') addNotice('err', it.message);
      else if (it.type === 'info') addNotice('info', it.text);
    }
    document.querySelectorAll('details.tg').forEach((d) => { /* groups were detached from S.tg; recompute summaries */ });
    renderTodos(); if (S.busy) setWorking(true); S.follow = true; stick();
  }

  // ---------- events ----------
  api.onEvent(({ sid, e }) => {
    if (e.type === 'idle' || e.type === 'turn_end') { refreshSessions(); }
    if (!S.cur || sid !== S.cur.id) return;
    switch (e.type) {
      case 'turn_start': setBusy(true); break;
      case 'text_start': startAssistant(); break;
      case 'text': if (!S.curText) startAssistant(); S.curBuf += e.delta; S.curText.innerHTML = md.render(S.curBuf); stick(); break;
      case 'text_end': S.items.push({ type: 'assistant', text: S.curBuf }); S.curText = null; break;
      case 'thinking': { let t = $('.thinking:last-child'); if (!t || !t.classList.contains('thinking-only')) { t = el('div', 'thinking thinking-only'); $('#transcript').appendChild(t); } t.textContent += e.delta; break; }
      case 'tool_start': { const rec = addTool(e); if (S.tg) S.tg.d._g = S.tg; S.items.push({ type: 'tool', ...e }); stick(); break; }
      case 'tool_result': { const g = S.tg && S.tg.map && S.tg.map[e.id] ? S.tg : findGroup(e.id); finishTool(e.id, e, g); const it = S.items.find((x) => x.type === 'tool' && x.id === e.id); if (it) Object.assign(it, { output: e.output, error: e.error }); stick(); break; }
      case 'todos': S.todos = e.todos; renderTodos(); stick(); break;
      case 'error': addNotice('err', e.message); stick(); break;
      case 'info': addNotice('info', e.text); break;
      case 'route': addNotice('info', `OmniRoute → ${e.provider} / ${e.model}`); break;
      case 'route_fail': addNotice('info', `OmniRoute: ${e.provider} failed (${e.error}); trying the next provider`); break;
      case 'compacted': addNotice('info', `Conversation compacted (${e.before} → ${e.after} messages).`); break;
      case 'mode': if (S.cur) { S.cur.mode = e.mode; updateChips(); } break;
      case 'cwd': if (S.cur) { S.cur.cwd = e.cwd; updateChips(); } break;
      case 'context': S.ctx = e.used; S.ctxLimit = e.limit; S.usage = e.usage; updateChips(); break;
      case 'file_changed': refreshChanges(); break;
      case 'bg_start': S.bg.push({ id: e.id, command: e.command, status: 'running' }); updateRail(); break;
      case 'bg_done': { const b = S.bg.find((x) => x.id === e.id); if (b) b.status = e.code === 0 ? 'done' : 'failed'; updateRail(); break; }
      case 'mcp': S.mcp = e; updateRail(); break;
      case 'ask': handleAsk(e); break;
      case 'subagent': addNotice('info', e.phase === 'start' ? `Sub-agent started: ${e.description}` : 'Sub-agent finished'); break;
      case 'idle': S.ctx = e.ctx; S.ctxLimit = e.ctxLimit; S.usage = e.usage; S.checkpoints = e.checkpoints || S.checkpoints; setBusy(false); updateChips(); refreshChanges(); drainQueue(); break;
      case 'side_text': if (window.Modals && window.Modals.sideAppend) window.Modals.sideAppend(e.delta); break;
    }
  });
  api.onSessionsChanged(refreshSessions);

  function handleAsk({ id, req }) {
    if (req.kind === 'permission') return window.lazy('modals').then(() => window.Modals.permission(id, req));
    const c = el('div', 'qcard'); const send = (ans) => { c.querySelectorAll('button').forEach((b) => (b.disabled = true)); api.answer(S.cur.id, id, ans); };
    if (req.kind === 'question') { c.innerHTML = `<div>${esc(req.question)}</div>`; const o = el('div', 'opts'); (req.options || []).forEach((t) => { const b = el('button', 'btn', esc(t)); b.onclick = () => { send(t); b.classList.add('pri'); }; o.appendChild(b); }); c.appendChild(o); }
    else { c.innerHTML = `<div><b>Proposed plan</b></div><div class="msg assistant" style="margin-top:8px">${md.render(req.plan || '')}</div>`; const o = el('div', 'opts'); const a = el('button', 'btn pri', 'Approve plan'); a.onclick = () => send('approve'); const r = el('button', 'btn', 'Keep planning'); r.onclick = () => send('rejected: keep planning'); o.append(a, r); c.appendChild(o); }
    $('#transcript').appendChild(c); S.tg = null; moveWorkingLast(); stick();
  }

  // ---------- composer ----------
  function setBusy(b) { S.busy = b; $('#btn-stop').hidden = !b; setWorking(b); if (!b) S.curText = null; }
  function renderQueue() { const q = $('#queue'); q.innerHTML = ''; S.queue.forEach((t, i) => { const d = el('div', 'qitem', `<span>Queued: ${esc(t.slice(0, 70))}</span><button class="x" title="Remove">✕</button>`); d.querySelector('.x').onclick = () => { S.queue.splice(i, 1); renderQueue(); }; q.appendChild(d); }); }
  function drainQueue() { if (S.queue.length && !S.busy) { const t = S.queue.shift(); renderQueue(); submit(t, true); } }
  async function ensureSession() {
    if (S.cur) return true;
    if (!S.draft.cwd) { const f = await api.pickFolder(); if (!f) { toast('Choose a project folder first'); return false; } S.draft.cwd = f; api.setLast({ cwd: f }); }
    const r = await api.newSession({ cwd: S.draft.cwd, provider: S.draft.provider, model: S.draft.model, mode: S.draft.mode });
    S.cur = r.meta; await api.setSession(r.meta.id, { effort: S.draft.effort }); S.cur.effort = S.draft.effort; S.items = []; $('#chatcol').classList.remove('empty'); $('#transcript').innerHTML = ''; await refreshSessions(); return true;
  }
  async function submit(text, fromQueue) {
    text = text.trim(); if (!text) return;
    if (!fromQueue && text.startsWith('/')) { const handled = await runSlash(text); if (handled) return; }
    if (S.busy && !fromQueue) { S.queue.push(text); renderQueue(); $('#input').value = ''; autosize(); return; }
    if (!(await ensureSession())) return;
    const m = curModel(); if (m.provider !== 'pretend' && !S.providers.find((p) => p.id === m.provider && (p.hasKey || p.keyOptional || p.virtual))) { toast('Add a key for this provider first'); window.lazy('modals').then(() => window.Modals.keys()); return; }
    $('#input').value = ''; autosize(); hidePops(); S.items.push({ type: 'user', text }); addUser(text); S.follow = true; setBusy(true); stick(); setTitleFromFirst(text);
    try { await api.send(S.cur.id, text); } catch (e) { addNotice('err', e.message); setBusy(false); }
  }
  function setTitleFromFirst(text) { if (S.cur && S.cur.title === 'New session') { S.cur.title = text.replace(/\s+/g, ' ').slice(0, 56); setTitle(); } }
  window.submit = submit;
  function autosize() { const t = $('#input'); t.style.height = 'auto'; t.style.height = Math.min(220, t.scrollHeight) + 'px'; }
  function hidePops() { $('#slash-menu').hidden = true; S.slashSel = 0; }
  function showSlash(q) {
    const items = SLASH.filter((s) => s[0].startsWith(q.split(' ')[0])); const m = $('#slash-menu'); if (!items.length || q.includes(' ')) return hidePops();
    m.innerHTML = ''; S.slashItems = items; S.slashSel = Math.min(S.slashSel || 0, items.length - 1);
    items.forEach(([c, d], i) => { const r = el('div', 'pi' + (i === S.slashSel ? ' sel' : ''), `<span>${esc(c)}</span><span class="d">${esc(d)}</span>`); r.onmousedown = (ev) => { ev.preventDefault(); $('#input').value = c + ' '; hidePops(); $('#input').focus(); }; m.appendChild(r); }); m.hidden = false;
  }
  async function showMentions(q) {
    if (!curCwd()) return; const files = await api.mentions(curCwd(), q); const m = $('#slash-menu'); if (!files.length) return hidePops(); m.innerHTML = ''; S.slashItems = null;
    files.forEach((f) => { const r = el('div', 'pi', `<span>@${esc(f)}</span>`); r.onmousedown = (ev) => { ev.preventDefault(); const t = $('#input'); t.value = t.value.replace(/@[^\s@]*$/, '@' + f + ' '); hidePops(); t.focus(); autosize(); }; m.appendChild(r); }); m.hidden = false;
  }
  $('#input').addEventListener('input', () => {
    autosize(); const v = $('#input').value;
    if (v.startsWith('/')) showSlash(v); else { const m = /@([^\s@]*)$/.exec(v); if (m) showMentions(m[1]); else hidePops(); }
  });
  $('#input').addEventListener('keydown', (e) => {
    const menu = $('#slash-menu');
    if (!menu.hidden && S.slashItems) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); S.slashSel = (S.slashSel + (e.key === 'ArrowDown' ? 1 : -1) + S.slashItems.length) % S.slashItems.length; showSlash($('#input').value); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && !$('#input').value.includes(' '))) { e.preventDefault(); $('#input').value = S.slashItems[S.slashSel][0] + ' '; hidePops(); autosize(); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault(); const v = $('#input').value; if (e.metaKey && S.busy) { S.queue.push(v.trim()); renderQueue(); $('#input').value = ''; autosize(); } else submit(v);
    }
    if (e.key === 'Escape') { hidePops(); if (S.busy) stop(); }
  });
  function stop() { if (S.cur && S.busy) api.stop(S.cur.id); }
  $('#btn-stop').onclick = stop; $('#btn-send').onclick = () => submit($('#input').value);
  $('#btn-plus').onclick = (e) => popMenu(e.currentTarget, [['Add files or photos…', async () => { const fs = await api.pickFiles(); if (fs.length) { $('#input').value += (fs.map((f) => '@' + f).join(' ')) + ' '; autosize(); $('#input').focus(); } }], ['Skills…', async () => { const k = curCwd() ? await api.skills(curCwd()) : []; popMenu($('#btn-plus'), k.length ? k.map((n) => ['/' + n, () => { $('#input').value = 'Use the skill ' + n + ': '; $('#input').focus(); }]) : [['No skills in .caelix/skills yet', () => {}]], { up: true }); }], ['Connectors (MCP)…', () => runSlash('/mcp')], ['Choose project folder…', pickFolder]], { up: true });

  async function pickFolder() {
    const f = await api.pickFolder(); if (!f) return;
    if (S.cur) { await api.setSession(S.cur.id, { cwd: f }); S.cur.cwd = f; } else { S.draft.cwd = f; }
    api.setLast({ cwd: f }); updateChips(); refreshSessions();
  }
  $('#chip-folder').onclick = pickFolder;
  function modeMenu(anchor) { popMenu(anchor || $('#chip-mode'), MODES.map(([id, label, desc]) => [label, () => setMode(id), { desc, cur: curMode() === id }]), { up: true }); }
  async function setMode(id) { if (S.cur) { await api.setSession(S.cur.id, { mode: id }); S.cur.mode = id; } else S.draft.mode = id; api.setLast({ mode: id }); updateChips(); }
  $('#chip-mode').onclick = (e) => modeMenu(e.currentTarget);
  function effortMenu(anchor) { popMenu(anchor || $('#chip-effort'), EFFORTS.map(([id, l]) => [l, async () => { if (S.cur) { await api.setSession(S.cur.id, { effort: id }); S.cur.effort = id; } else S.draft.effort = id; updateChips(); }, { cur: eff() === id }]), { up: true }); }
  $('#chip-effort').onclick = (e) => effortMenu(e.currentTarget);
  $('#chip-model').onclick = () => window.lazy('modals').then(() => window.Modals.modelPicker());
  window.setModel = async (provider, model) => { if (S.cur) { await api.setSession(S.cur.id, { provider, model }); S.cur.provider = provider; S.cur.model = model; } else { S.draft.provider = provider; S.draft.model = model; } api.setLast({ provider, model }); updateChips(); };

  // ---------- slash commands ----------
  async function runSlash(text) {
    const [cmd, ...rest] = text.split(/\s+/); const arg = rest.join(' ').trim(); const known = SLASH.find((s) => s[0] === cmd); if (!known) return false;
    $('#input').value = ''; autosize(); hidePops();
    const needSession = ['/compact', '/rewind', '/diff', '/memory', '/remember', '/init', '/export', '/btw', '/rename', '/clear'].includes(cmd);
    if (needSession && !S.cur) { toast('Start a session first'); return true; }
    switch (cmd) {
      case '/clear': await api.clear(S.cur.id); S.items = []; S.todos = []; S.ctx = 0; renderTranscript(); updateChips(); break;
      case '/compact': { addNotice('info', 'Compacting…'); const r = await api.compact(S.cur.id); S.ctx = r.ctx; addNotice('info', r.ok ? 'Compacted.' : 'Nothing to compact yet.'); updateChips(); break; }
      case '/model': window.lazy('modals').then(() => window.Modals.modelPicker()); break;
      case '/mode': modeMenu(); break;
      case '/plan': setMode('plan'); toast('Plan mode on'); break;
      case '/rename': if (arg) { await api.setSession(S.cur.id, { title: arg }); S.cur.title = arg; setTitle(); refreshSessions(); } else toast('Usage: /rename <title>'); break;
      case '/rewind': window.lazy('modals').then(() => window.Modals.rewind()); break;
      case '/diff': openPane('diff'); break;
      case '/memory': addNotice('info', await api.showMemory(S.cur.id)); break;
      case '/remember': if (arg) { await api.addNote(S.cur.id, arg); toast('Saved to project notes'); } break;
      case '/init': { const f = await api.initProject(S.cur.id); toast('CAELIX.md ready: ' + f); break; }
      case '/cost': case '/context': addNotice('info', `Tokens: ${S.usage.in} in / ${S.usage.out} out. Context ≈ ${Math.round((S.ctx / S.ctxLimit) * 100)}% (${S.ctx} of ${S.ctxLimit}).`); break;
      case '/export': toast('Saved ' + (await api.exportChat(S.cur.id))); break;
      case '/btw': window.lazy('modals').then(() => window.Modals.side(arg)); break;
      case '/skills': { const k = curCwd() ? await api.skills(curCwd()) : []; addNotice('info', k.length ? 'Skills: ' + k.join(', ') : 'No skills found. Add .caelix/skills/<name>/SKILL.md'); break; }
      case '/hooks': addNotice('info', 'Hooks live in .caelix/settings.json under "hooks": {"PreToolUse":[{"matcher":"Bash","command":"…"}]}. Exit code 2 blocks the tool.'); break;
      case '/mcp': addNotice('info', S.mcp ? 'MCP: ' + S.mcp.servers.map((s) => `${s.name} (${s.tools} tools)`).join(', ') + (S.mcp.errors.length ? ' — errors: ' + S.mcp.errors.join('; ') : '') : 'No MCP servers. Add "mcpServers": {"name": {"command": "…", "args": []}} to .caelix/settings.json.'); break;
      case '/keys': window.lazy('modals').then(() => window.Modals.keys()); break;
      case '/settings': window.lazy('modals').then(() => window.Modals.settings()); break;
      case '/theme': window.toggleTheme(); break;
      case '/help': window.lazy('modals').then(() => window.Modals.help()); break;
    }
    return true;
  }

  // ---------- panes / rail ----------
  const loaded = {};
  window.lazy = (name) => loaded[name] || (loaded[name] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = name + '.js'; s.onload = res; s.onerror = () => rej(new Error('load ' + name)); document.head.appendChild(s); }));
  function openPane(name) { if (S.pane === name) return closeAllPanes(); S.pane = name; $('#sidepane').hidden = false; window.lazy('panes').then(() => window.Panes.show(name)); setPaneButtons(); }
  function closeAllPanes() { S.pane = null; $('#sidepane').hidden = true; setPaneButtons(); }
  function setPaneButtons() { for (const n of ['terminal', 'diff', 'browser', 'files']) $('#tb-' + n).classList.toggle('on', S.pane === n); $('#tb-rail').classList.toggle('on', S.rail); }
  window.openPane = openPane; window.closeAllPanes = closeAllPanes;
  $('#tb-terminal').onclick = () => openPane('terminal'); $('#tb-diff').onclick = () => openPane('diff'); $('#tb-browser').onclick = () => openPane('browser'); $('#tb-files').onclick = () => openPane('files');
  $('#tb-rail').onclick = toggleRail;
  function toggleRail() { S.rail = !S.rail; $('#rail').hidden = !S.rail; setPaneButtons(); updateRail(); }
  $('#tb-more').onclick = (e) => popMenu(e.currentTarget, [['Transcript view: Normal', () => setView('normal'), { cur: S.view === 'normal' }], ['Transcript view: Thinking', () => setView('thinking'), { cur: S.view === 'thinking' }], ['Transcript view: Verbose', () => setView('verbose'), { cur: S.view === 'verbose' }], ['Side chat', () => window.lazy('modals').then(() => window.Modals.side(''))], ['Keyboard shortcuts', () => window.lazy('modals').then(() => window.Modals.help())], ['Toggle theme', window.toggleTheme]]);
  $('#title').onclick = (e) => { if (!S.cur) return; popMenu(e.currentTarget, [['Rename…', () => { const t = prompt('Rename session', S.cur.title); if (t) runSlash('/rename ' + t); }], ['Export as Markdown', () => runSlash('/export')], ['Archive', async () => { await api.setSession(S.cur.id, { archived: true }); newScreen(); refreshSessions(); }], ['Reveal folder in Finder', () => api.reveal(S.cur.cwd)]]); };
  function setView(v) { S.view = v; document.body.classList.remove('view-normal', 'view-thinking', 'view-verbose'); document.body.classList.add('view-' + v); document.querySelectorAll('details.tg').forEach((d) => (d.open = v === 'verbose')); api.setSettings({ viewMode: v }); toast('View: ' + v); }
  async function refreshChanges() { if (!S.cur) { S.changes = []; return updateRail(); } try { S.changes = await api.diff(S.cur.id); } catch (_) { S.changes = []; } updateRail(); if (S.pane === 'diff' && window.Panes) window.Panes.refresh(); }
  function updateRail() {
    const r = $('#rail'); if (r.hidden) return; const c = S.cur; const add = S.changes.reduce((a, x) => a + x.add, 0), del = S.changes.reduce((a, x) => a + x.del, 0); const pct = Math.round((S.ctx / S.ctxLimit) * 100) || 0;
    const mc = S.mcp ? S.mcp.servers.length + ' connected' : 'None configured';
    r.innerHTML = `
      <div class="card"><h4>Environment</h4>
        <div class="row"><span class="ic">▭</span>This computer</div>
        <div class="row click" id="rl-folder"><span class="ic">▢</span><span>${esc(c ? folderName(c.cwd) : folderName(S.draft.cwd) || 'No folder')} <span style="color:var(--muted)">· ${esc((curCwd() || '').replace(/^\/Users\/[^/]+/, '~'))}</span></span></div>
        <div class="row"><span class="ic">⑂</span><span id="rl-branch">…</span></div>
        <div class="row"><span class="ic">⌁</span>${esc(modeLabel(curMode()))}</div></div>
      <div class="card"><h4>Context <span style="font-weight:400;color:var(--muted)">${pct}%</span></h4><div class="bar"><i style="width:${Math.min(100, pct)}%"></i></div><div style="color:var(--muted);font-size:12.5px;margin-top:6px">${S.usage.in} in · ${S.usage.out} out tokens</div></div>
      <div class="card"><h4>Changes</h4>${S.changes.length ? `<div class="row click" id="rl-diff"><span class="ic">±</span>${S.changes.length} file${S.changes.length > 1 ? 's' : ''}<span class="v"><span class="plus-ln">+${add}</span> <span class="minus-ln">-${del}</span></span></div>` : '<div class="row" style="color:var(--faint)">No changes yet</div>'}</div>
      <div class="card"><h4>Connectors</h4><div class="row"><span class="ic">⛓</span>MCP<span class="v">${esc(mc)}</span></div></div>
      <div class="card"><h4>Outputs</h4>${S.changes.length ? S.changes.slice(0, 8).map((x, i) => `<div class="row click" data-f="${i}"><span class="ic">▤</span>${esc(x.rel.split('/').pop())}</div>`).join('') : '<div class="row" style="color:var(--faint)">Files you create appear here</div>'}</div>
      <div class="card"><h4>Background tasks</h4>${S.bg.length ? S.bg.map((b) => `<div class="row"><span class="ic">${b.status === 'running' ? '◐' : '✓'}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(b.command)}</span><span class="v">${esc(b.status)}</span></div>`).join('') : '<div class="row" style="color:var(--faint)">None running</div>'}</div>`;
    if (curCwd()) api.gitBranch(curCwd()).then((b) => { const x = $('#rl-branch'); if (x) x.textContent = b || 'no git'; });
    const f = $('#rl-folder'); if (f) f.onclick = () => curCwd() && api.reveal(curCwd()); const d = $('#rl-diff'); if (d) d.onclick = () => openPane('diff');
    r.querySelectorAll('[data-f]').forEach((n) => (n.onclick = () => { window.pendingFile = S.changes[+n.dataset.f].file; openPane('files'); }));
  }
  window.updateRail = updateRail; window.refreshChanges = refreshChanges;

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
    else if (e.ctrlKey && e.key === 'Tab') { e.preventDefault(); const l = S.sessions.filter((s) => !s.archived); if (!l.length) return; const i = l.findIndex((s) => S.cur && s.id === S.cur.id); openSession(l[(i + (e.shiftKey ? -1 : 1) + l.length) % l.length].id); }
    else if (openPop && /^[1-9]$/.test(e.key)) { const it = openPop.children[+e.key - 1]; if (it) { e.preventDefault(); it.click(); } }
    else if (e.key === 'Escape' && openPop) closePop();
  });
  $('#btn-new').onclick = newScreen; $('#btn-keys').onclick = () => window.lazy('modals').then(() => window.Modals.keys()); $('#btn-settings').onclick = () => window.lazy('modals').then(() => window.Modals.settings());
  $('#search').addEventListener('input', (e) => { S.filter = e.target.value; renderSidebar(); });
  document.addEventListener('click', (e) => { const a = e.target.closest('a[data-ext]'); if (a) { e.preventDefault(); api.openUrl(a.href); } });

  // ---------- boot ----------
  (async function boot() {
    const info = await api.init(); S.providers = info.providers; S.sessions = info.sessions; S.info = info;
    const st = await api.getSettings(info.home).catch(() => ({})); applyTheme(st.theme || 'system'); setView0(st.viewMode || 'normal');
    const l = info.last || {}; S.draft.cwd = l.cwd || ''; if (l.provider) { S.draft.provider = l.provider; S.draft.model = l.model || 'auto'; } if (l.mode) S.draft.mode = l.mode;
    const hasConnected = S.providers.some((p) => !p.virtual && p.hasKey);
    if (!l.provider && !hasConnected) { S.draft.provider = 'omniroute'; S.draft.model = 'auto'; }
    renderSidebar(); newScreen(); updateChips(); api.uiReady();
    if (!hasConnected && !(S.sessions.length)) setTimeout(() => toast('Tip: open Keys to add a provider key and load its models'), 600);
  })();
  function setView0(v) { S.view = v; document.body.classList.add('view-' + v); }
  window.addEventListener('error', (e) => console.error('window error:', e.message));
  window.addEventListener('unhandledrejection', (e) => console.error('unhandled rejection:', e.reason && e.reason.message || e.reason));

  // hooks for self-check
  window.__caelix = { S, submit, openSession, newScreen, refreshSessions, openPane, toggleRail, setMode, runSlash, renderTranscript };
})();
