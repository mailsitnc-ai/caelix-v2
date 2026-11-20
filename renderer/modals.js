'use strict';
// Modals and pickers: Keys, models, MCP, Hooks, memory, permission, rewind, side chat, settings, help. Loaded on first use.
(function () {
  const host = () => $('#modal-host');
  const btn = (t, cls, fn) => { const b = el('button', 'btn ' + (cls || ''), esc(t)); b.onclick = fn; return b; };
  // v1-style dialog: logo, title, subtitle, close button
  function dialog(title, sub, bodyNode, footerNodes, opts) {
    opts = opts || {}; const sc = el('div', 'scrim'); const m = el('div', 'modal' + (opts.cls ? ' ' + opts.cls : '')); if (opts.width) m.style.width = opts.width;
    const h = el('div', 'mhead'); h.innerHTML = `<img src="../assets/icons/icon-256.png" width="62" height="62" alt=""><div><h2>${esc(title)}</h2>${sub ? `<p>${sub}</p>` : ''}</div>`; const x = el('button', 'mx', '✕'); x.onclick = close; h.appendChild(x);
    const mb = el('div', 'mb'); mb.appendChild(bodyNode); m.append(h, mb);
    if (footerNodes && footerNodes.length) { const f = el('footer'); footerNodes.forEach((n) => f.appendChild(n)); m.appendChild(f); }
    sc.appendChild(m); sc.onmousedown = (e) => { if (e.target === sc && !opts.sticky) close(); }; host().appendChild(sc);
    function close() { sc.remove(); if (opts.onClose) opts.onClose(); } return { close, root: sc, body: mb };
  }
  const cwd = () => (S.cur ? S.cur.cwd : S.draft.cwd) || '';
  const projCwd = () => (S.kind === 'code' ? cwd() : '');

  // ---------- Keys ----------
  async function keys() {
    host().innerHTML = ''; const body = el('div'); const info = await api.init(); S.providers = info.providers;
    if (!info.secure) body.appendChild(el('div', 'err', 'Secure storage is not available on this computer, so keys cannot be saved.'));
    function row(p) {
      const r = el('div', 'prow'); const ok = p.virtual || p.hasKey || p.anonymous;
      r.innerHTML = `<div class="pt"><i style="width:10px;height:10px;border-radius:50%;background:${DOT[p.id] || '#4d9bff'};display:inline-block"></i> ${esc(p.name)} <span class="badge ${ok ? 'ok' : ''}">${p.virtual || (p.anonymous && !p.hasKey) ? 'built in · no key needed' : p.hasKey ? 'connected · ' + esc(p.masked) : 'not connected'}</span></div>${p.note ? `<div class="pn">${esc(p.note)}</div>` : ''}`;
      if (p.editableBase) { const f = el('div', 'f'); const i = el('input'); i.placeholder = p.id === 'omniroute' ? 'Optional OmniRoute server URL, e.g. http://localhost:20128/v1' : 'OpenAI-compatible base URL'; i.value = p.base || ''; f.append(i, btn('Save URL', '', async () => { S.providers = await api.setBase(p.id, i.value); toast('Base URL saved'); })); r.appendChild(f); }
      if (!p.virtual) {
        const f = el('div', 'f'); const i = el('input'); i.type = 'password'; i.placeholder = p.hasKey ? 'Replace key (' + p.masked + ')' : 'Paste ' + (p.keyHint || 'key'); i.autocomplete = 'off'; i.spellcheck = false;
        const save = btn('Save', 'pri', async () => {
          const v = i.value.trim(); if (!v) return; save.disabled = true;
          try { S.providers = await api.setKey(p.id, v); i.value = ''; toast('Saved. Loading models…'); const m = await api.models(p.id, true); S.models[p.id] = m; toast(`${p.name}: ${m.length} models available`); } catch (e) { toast(e.message, 5000); }
          redraw();
        }); f.append(i, save);
        if (p.hasKey) { f.appendChild(btn('Test', '', async () => { try { const m = await api.models(p.id, true); S.models[p.id] = m; toast(`${p.name}: ${m.length} models`); } catch (e) { toast(e.message, 5000); } })); f.appendChild(btn('Check models', '', async (ev) => { const b = ev.target; b.disabled = true; api.onProbe && api.onProbe((d) => { if (d.pid === p.id) b.textContent = `Checking ${d.d}/${d.n}…`; }); try { const r = await api.probe(p.id); const bad = r.filter((x) => x.status !== 200 && x.status !== 429); toast(`${p.name}: ${r.length - bad.length} of ${r.length} models work on your account; ${bad.length} do not (hidden from routing)`, 8000); S.probe = S.probe || {}; S.probe[p.id] = r; } catch (e) { toast(e.message, 6000); } b.disabled = false; b.textContent = 'Check models'; })); f.appendChild(btn('Remove', 'dng', async () => { S.providers = await api.removeKey(p.id); delete S.models[p.id]; redraw(); })); }
        r.appendChild(f);
      }
      if (p.docs) { const a = el('div', 'pn'); a.style.marginTop = '8px'; a.innerHTML = `Get a key: <a href="${esc(p.docs)}" data-ext="1" style="color:var(--accent2)">${esc(p.docs)}</a>`; r.appendChild(a); }
      return r;
    }
    const list = el('div'); body.appendChild(list); function redraw() { list.innerHTML = ''; S.providers.forEach((p) => list.appendChild(row(p))); window.updateChips(); } redraw();
    dialog('Model provider keys', 'Keys are stored encrypted on this computer, outside the project folder, and only the last 4 characters are ever shown. Models load as soon as you save a key.', body, [btn('Done', 'pri', () => (host().innerHTML = ''))], { width: '720px' });
  }

  // ---------- Model picker ----------
  async function modelPicker(anchor, onPick) {
    window.closePop && window.closePop(); host().innerHTML = ''; document.querySelectorAll('.mpicker').forEach((n) => n.remove());
    const pop = el('div', 'popup mpicker'); pop.style.position = 'fixed'; if (onPick) pop.style.zIndex = '500'; const top = el('div', 'mtop'); const inp = el('input'); inp.placeholder = 'Search models'; const refresh = el('button', null, 'Refresh'); top.append(inp, refresh); const list = el('div', 'mlist'); pop.append(top, list); document.body.appendChild(pop);
    const a = (anchor || $('#chip-model')).getBoundingClientRect(); const wide = Math.min(580, innerWidth - 20); pop.style.width = wide + 'px'; pop.style.left = Math.max(10, Math.min(a.left, innerWidth - wide - 10)) + 'px';
    if (a.top > innerHeight / 2) pop.style.bottom = (innerHeight - a.top + 8) + 'px'; else pop.style.top = a.bottom + 8 + 'px';
    const cur = S.cur ? { provider: S.cur.provider, model: S.cur.model } : { provider: S.draft.provider, model: S.draft.model }; let groups = []; let favs = new Set(S.fav || []);
    function close() { pop.remove(); document.removeEventListener('mousedown', away, true); document.removeEventListener('keydown', esc2, true); }
    const away = (e) => { if (!pop.contains(e.target) && !e.target.closest('#chip-model') && !e.target.closest('#chip-model-top')) close(); }; const esc2 = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', away, true); document.addEventListener('keydown', esc2, true);
    function item(g, m) {
      const key = g.id + '|' + m.id; const r = el('div', 'mi' + (cur.provider === g.id && cur.model === m.id ? ' cur' : ''));
      r.innerHTML = `<span class="dot" style="background:${DOT[g.id] || '#4d9bff'}"></span><div><span class="mn">${esc(m.id)}</span>${(m.free ? '<span class="md"> Free</span>' : '') + (m.desc ? `<span class="md"> · ${esc(m.desc)}</span>` : '')}</div><button class="star ${favs.has(key) ? 'on' : ''}" title="Favorite">★</button>`;
      r.onclick = (e) => { if (e.target.closest('.star')) { e.stopPropagation(); api.toggleFav(key).then((f) => { favs = new Set(f); S.fav = f; draw(); }); return; } (onPick || window.setModel)(g.id, m.id); close(); }; return r;
    }
    let arch = {}; let showArch = false; api.archive().then((a) => { arch = a || {}; draw(); }).catch(() => {});
    const isArch = (pid, id) => !!arch[pid + '/' + id];
    function draw() {
      const q = inp.value.trim().toLowerCase(); list.innerHTML = '';
      const match = (m) => !q || m.id.toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q) || (m.desc || '').toLowerCase().includes(q);
      const fav = []; for (const g of groups) for (const m of g.models || []) if (favs.has(g.id + '|' + m.id) && match(m) && !isArch(g.id, m.id)) fav.push([g, m]);
      if (fav.length) { list.appendChild(el('div', 'mg', `★ FAVORITES (${fav.length})`)); fav.forEach(([g, m]) => list.appendChild(item(g, m))); }
      for (const g of groups) {
        const ms = (g.models || []).filter((m) => match(m) && !isArch(g.id, m.id)); if (q && !ms.length) continue;
        list.appendChild(el('div', 'mg', `${esc(g.name.toUpperCase())} (${g.loading ? '…' : ms.length})${g.err ? `<span class="why">${esc(g.err)}</span>` : ''}`));
        if (g.loading) list.appendChild(el('div', 'info', 'Loading models…'));
        ms.slice(0, q ? 300 : 120).forEach((m) => list.appendChild(item(g, m)));
        if (!q && ms.length > 120) list.appendChild(el('div', 'info', `${ms.length - 120} more: type to search`));
      }
      const ar = Object.values(arch).filter((a) => !q || a.id.toLowerCase().includes(q));
      if (ar.length) {
        const h = el('div', 'mg', `${showArch ? '▾' : '▸'} ARCHIVED — not working on your account (${ar.length})`); h.style.cursor = 'pointer'; h.onclick = () => { showArch = !showArch; draw(); }; list.appendChild(h);
        if (showArch) { list.appendChild(el('div', 'info', 'Kept in case they work later. Run Check models on the Keys screen again to re-test them; any that now work move back automatically.'));
          ar.sort((a, b) => (a.provider + a.id).localeCompare(b.provider + b.id)).forEach((a) => { const r = el('div', 'mi'); r.style.opacity = '.7'; r.innerHTML = `<span class="dot" style="background:${DOT[a.provider] || '#4d9bff'}"></span><div><span class="mn">${esc(a.id)}</span><span class="md"> · ${esc(a.provider)} · ${esc(a.verdict)} · checked ${esc((a.at || '').slice(0, 10))}</span></div>`; const b = el('button', 'star', 'Restore'); b.title = 'Move back to the normal list'; b.style.width = 'auto'; b.onclick = (e) => { e.stopPropagation(); api.unarchive(a.provider, a.id).then((x) => { arch = x || {}; draw(); }); }; r.appendChild(b); list.appendChild(r); }); }
      }
      const missing = S.providers.filter((p) => !p.virtual && !p.hasKey && !p.anonymous);
      if (!q && missing.length) { const d = el('div', 'mg', 'Not connected'); const n = el('div', 'info', 'Add a key to load models from: ' + esc(missing.map((p) => p.name).join(', ')) + ' — '); const l = el('a', null, 'open Keys'); l.href = '#'; l.style.color = 'var(--accent2)'; l.onclick = (e) => { e.preventDefault(); close(); keys(); }; n.appendChild(l); list.append(d, n); }
    }
    inp.oninput = draw; inp.focus();
    async function load(force) {
      const info = await api.init(); S.providers = info.providers; S.fav = info.fav || []; favs = new Set(S.fav);
      groups = [{ id: 'omniroute', name: 'OmniRoute', models: await api.models('omniroute').catch(() => []) }];
      for (const p of S.providers.filter((p) => !p.virtual && (p.hasKey || p.anonymous))) groups.push({ id: p.id, name: p.name, models: force ? [] : S.models[p.id] || [], loading: force || !S.models[p.id] });
      groups.push({ id: 'pretend', name: 'Pretend AI (offline test)', models: await api.models('pretend') }); draw();
      groups.filter((g) => g.loading).forEach(async (g) => { try { g.models = await api.models(g.id, force); S.models[g.id] = g.models; g.err = ''; } catch (e) { g.err = e.message; g.models = []; } g.loading = false; draw(); });
    }
    refresh.onclick = () => load(true); load(false);
  }

  // ---------- MCP ----------
  async function mcp() {
    host().innerHTML = ''; const body = el('div'); const list = el('div'); body.appendChild(list);
    const code = S.kind === 'code' && cwd(); const wd = code ? cwd() : '';
    async function draw(force) {
      list.innerHTML = '<div class="info">Connecting…</div>'; let rows = []; try { rows = await api.mcpList(S.cur ? S.cur.id : '', wd, !!force); } catch (e) { list.innerHTML = ''; list.appendChild(el('div', 'err', e.message)); return; }
      list.innerHTML = ''; if (!rows.length) list.appendChild(el('div', 'info', 'No servers yet.'));
      rows.forEach((r) => {
        const d = el('div', 'erow'); const t = el('div', 'top'); t.innerHTML = `<b class="nm">${esc(r.name)}</b><span class="tag">${esc(r.scope)}</span>${r.disabled ? '<span class="tag">disabled</span>' : r.error ? '<span class="tag bad">error</span>' : `<span class="tag ok">${r.tools} tool(s)</span>`}`;
        const bt = el('div', 'btns'); bt.appendChild(btn(r.disabled ? 'Enable' : 'Disable', '', async () => { await api.mcpToggle(wd, r.name, r.scope, !r.disabled, !!r.builtin); draw(true); }));
        if (!r.builtin) bt.appendChild(btn('Remove', '', async () => { await api.mcpRemove(wd, r.name, r.scope); draw(true); })); t.appendChild(bt); d.appendChild(t); d.appendChild(el('div', 'desc', esc(r.error || r.desc || ''))); list.appendChild(d);
      });
    }
    const chips = el('div', 'chips'); const name = el('input', 'fin'); name.placeholder = 'Server name (e.g. filesystem)'; const scope = el('select', 'fin'); scope.innerHTML = (code ? '<option value="project">Project (.mcp.json)</option>' : '') + '<option value="user">User (mcp.json)</option>'; const cmd = el('input', 'fin'); cmd.placeholder = 'Command (e.g. npx @modelcontextprotocol/server-filesystem .) or HTTP URL';
    const fill = (n, c) => () => { name.value = n; cmd.value = c; cmd.focus(); };
    [['+ Filesystem MCP', fill('filesystem', 'npx -y @modelcontextprotocol/server-filesystem ' + (wd || '.'))], ['+ Fetch MCP', fill('fetch', 'uvx mcp-server-fetch')], ['+ Git MCP', fill('git', 'uvx mcp-server-git --repository ' + (wd || '.'))]].forEach(([l, f]) => { const b = el('button', 'chipbtn', esc(l)); b.onclick = f; chips.appendChild(b); });
    const imp = el('button', 'chipbtn', 'Import from Claude'); imp.title = 'Copies server commands from ~/.claude.json into CAELIX'; imp.onclick = async () => { try { const n = await api.mcpImport(); toast(n ? `Imported ${n} server(s)` : 'Nothing new to import'); draw(true); } catch (e) { toast(e.message); } }; chips.appendChild(imp);
    const f1 = el('div', 'frow'); f1.append(name, scope); const f2 = el('div', 'frow'); const add = el('button', 'addbtn', 'Add & Connect'); add.onclick = async () => { add.disabled = true; try { await api.mcpAdd(wd, { name: name.value.trim(), scope: scope.value, command: cmd.value }); name.value = ''; cmd.value = ''; toast('Added. Connecting…'); await draw(true); } catch (e) { toast(e.message, 4500); } add.disabled = false; }; f2.append(cmd, add);
    const foot = el('div', 'fnote'); foot.style.display = 'flex'; foot.style.justifyContent = 'space-between'; foot.innerHTML = '<span>Configs are read from .mcp.json and user mcp.json.</span>'; const re = el('button', 'mini', 'Reconnect all'); re.onclick = () => draw(true); foot.appendChild(re);
    body.append(chips, f1, f2, foot); dialog('MCP Servers', 'Connect stdio or HTTP Model Context Protocol servers. Discovered tools are prefixed with <code>mcp__</code> and obey your permission mode.', body, null, { width: '760px' }); draw(false);
  }

  // ---------- Hooks ----------
  const PRESETS = [
    ['+ Turn Finished Bell', { event: 'Stop', matcher: '*', command: '(afplay /System/Library/Sounds/Glass.aiff >/dev/null 2>&1 &); exit 0' }],
    ['+ Block Force Push', { event: 'PreToolUse', matcher: '^bash$', command: "python3 -c 'import json,re,sys\nd=json.load(sys.stdin)\nc=(d.get(\"tool_input\") or {}).get(\"command\",\"\")\nif re.search(r\"git\\s+push\\b.*(--force|\\s-f\\b)\",c):\n    sys.stderr.write(\"Blocked: force push is not allowed\"); sys.exit(2)'" }],
    ['+ Log Tool Calls', { event: 'PostToolUse', matcher: '*', command: 'mkdir -p ~/Library/Logs/CAELIX && { cat; echo; } >> ~/Library/Logs/CAELIX/tool-calls.jsonl' }],
  ];
  async function hooks() {
    host().innerHTML = ''; const body = el('div'); const list = el('div'); body.appendChild(list); const code = S.kind === 'code' && cwd(); const wd = code ? cwd() : '';
    async function draw() {
      let rows = []; try { rows = await api.hooksList(wd); } catch (e) { list.appendChild(el('div', 'err', e.message)); } list.innerHTML = ''; if (!rows.length) list.appendChild(el('div', 'info', 'No hooks yet. Add one below or pick a preset.'));
      rows.forEach((h) => {
        const d = el('div', 'erow'); const t = el('div', 'top'); t.innerHTML = `<b class="nm">${esc(h.event)}</b><span class="tag">${esc(h.matcher)}</span><span class="tag">${esc(h.scope)}</span><span class="tag ${h.enabled === false ? '' : 'ok'}">${h.enabled === false ? 'Disabled' : 'Enabled'}</span>`;
        const bt = el('div', 'btns'); bt.appendChild(btn(h.enabled === false ? 'Enable' : 'Disable', '', async () => { await api.hooksToggle(wd, h.id, h.scope, h.enabled === false); draw(); })); bt.appendChild(btn('Remove', '', async () => { await api.hooksRemove(wd, h.id, h.scope); draw(); })); t.appendChild(bt); d.appendChild(t); d.appendChild(el('div', 'desc', esc(h.command.replace(/\n/g, ' ')))); list.appendChild(d);
      });
    }
    const chips = el('div', 'chips'); PRESETS.forEach(([l, h]) => { const b = el('button', 'chipbtn', esc(l)); b.onclick = async () => { try { await api.hooksAdd(wd, { ...h, scope: 'user' }); toast('Hook added'); draw(); } catch (e) { toast(e.message, 4500); } }; chips.appendChild(b); });
    const ev = el('select', 'fin'); ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop', 'SessionStart', 'PreCompact', 'Notification'].forEach((n) => ev.appendChild(el('option', null, n))); const mt = el('input', 'fin'); mt.value = '*'; mt.placeholder = 'Matcher regex (tool name), * for all';
    const scope = el('select', 'fin'); scope.innerHTML = (code ? '<option value="project">Project (.caelix/hooks.json)</option>' : '') + '<option value="user">User (hooks.json)</option>';
    const f1 = el('div', 'frow'); ev.style.flex = '0 0 190px'; scope.style.flex = '0 0 270px'; f1.append(ev, mt, scope); const f2 = el('div', 'frow'); const cmd = el('input', 'fin'); cmd.placeholder = 'Shell command (e.g. jq -r .tool | logger)'; const add = el('button', 'addbtn', 'Add Hook'); add.onclick = async () => { try { await api.hooksAdd(wd, { event: ev.value, matcher: mt.value || '*', scope: scope.value, command: cmd.value }); cmd.value = ''; toast('Hook added'); draw(); } catch (e) { toast(e.message, 4500); } }; f2.append(cmd, add);
    body.append(chips, f1, f2, el('div', 'fnote', 'Hooks run with CAELIX_HOOK_EVENT and CAELIX_PROJECT_DIR set.')); dialog('Lifecycle Hooks', 'Run shell commands on tool or prompt events. Hooks receive JSON on stdin; exit code 2 blocks the action.', body, null, { width: '860px' }); draw();
  }

  // ---------- Memory / system prompt ----------
  async function memory() {
    host().innerHTML = ''; const b = el('div'); const r = await api.memoryInfo(projCwd());
    if (!r.count) b.appendChild(el('div', 'info', 'No memory yet. Add a CAELIX.md or AGENTS.md to the project, use /remember, or ask CAELIX to remember something (saved memories are shared by every chat).'));
    r.files.forEach((f) => { const d = el('div', 'erow'); d.innerHTML = `<div class="top"><b class="nm" style="font-size:15px">${esc(f.label)}</b><span class="tag">${esc(f.file.replace(/^\/Users\/[^/]+/, '~'))}</span></div><pre class="code" style="margin:10px 0 0"><code>${esc(f.text)}</code></pre>`; b.appendChild(d); });
    if (r.global) { const d = el('div', 'erow'); d.innerHTML = `<div class="top"><b class="nm" style="font-size:15px">Saved memories (all chats)</b></div><pre class="code" style="margin:10px 0 0"><code>${esc(r.global)}</code></pre>`; b.appendChild(d); }
    dialog('Project memory', 'Instructions and notes CAELIX loads at the start of every conversation.', b, [btn('Done', 'pri', () => (host().innerHTML = ''))]);
  }
  async function system() { host().innerHTML = ''; const t = await api.systemPrompt(S.cur.id); const pre = el('pre', 'code'); pre.innerHTML = `<code>${esc(t)}</code>`; dialog('System prompt', 'What CAELIX sends before your messages (memory included).', pre, [btn('Done', 'pri', () => (host().innerHTML = ''))]); }

  // ---------- Permission pop-up ----------
  function permission(id, req) {
    const body = el('div', 'perm'); const t = req.tool; const i = req.input || {}; let detail = '';
    if (t === 'Bash') detail = `<pre>$ ${esc(i.command)}</pre>${i.description ? `<div class="info">${esc(i.description)}</div>` : ''}`;
    else if (t === 'Edit') detail = `<div class="info">${esc(i.file_path)}</div><pre>${esc((i.old_string || '').split('\n').map((l) => '- ' + l).join('\n') + '\n' + (i.new_string || '').split('\n').map((l) => '+ ' + l).join('\n'))}</pre>`;
    else if (t === 'Write') detail = `<div class="info">${esc(i.file_path)}</div><pre>${esc((i.content || '').slice(0, 1500))}</pre>`;
    else detail = `<pre>${esc(JSON.stringify(i, null, 1).slice(0, 1200))}</pre>`;
    body.innerHTML = `<div>CAELIX wants to use <b>${esc(t)}</b>.</div>${detail}`;
    const why = el('input', 'fin'); why.placeholder = 'Optional: tell CAELIX why (used if you deny)'; why.style.width = '100%'; body.appendChild(why);
    let done = false; const answer = (decision) => { if (done) return; done = true; api.answer(S.cur.id, id, { decision, comment: why.value.trim() }); mm.close(); document.removeEventListener('keydown', kh, true); };
    const deny = btn('Deny', 'dng', () => answer('deny')); const once = btn('Allow once', 'pri', () => answer('allow')); const always = btn('Always allow ' + req.rule, '', () => answer('always')); once.id = 'perm-allow'; deny.id = 'perm-deny';
    const mm = dialog('Permission needed', '', body, [deny, always, once], { sticky: true, cls: 'perm', width: '600px' }); once.focus();
    const kh = (e) => { if (e.key === 'Enter' && document.activeElement !== why) { e.preventDefault(); answer('allow'); } if (e.key === 'Escape') answer('deny'); }; document.addEventListener('keydown', kh, true);
  }

  // ---------- Rewind ----------
  function rewind() {
    const body = el('div'); if (!S.checkpoints.length) body.appendChild(el('div', 'empty-note', 'No checkpoints yet. One is saved before each prompt.'));
    S.checkpoints.slice().reverse().forEach((c) => {
      const r = el('div', 'prow'); r.innerHTML = `<div class="pt">Before: ${esc(c.prompt || '(prompt)')}</div>`; const f = el('div', 'f');
      const go = (code, conv) => async () => { const res = await api.rewind(S.cur.id, c.turn, { code, conversation: conv }); mm.close(); toast(`Restored ${res.restored ? res.restored.length : 0} file(s)`); window.openSession(S.cur.id); window.refreshChanges(); };
      f.append(btn('Restore code', '', go(true, false)), btn('Restore conversation', '', go(false, true)), btn('Restore both', 'pri', go(true, true))); r.appendChild(f); body.appendChild(r);
    });
    const mm = dialog('Rewind', 'Go back to before one of your prompts.', body, [btn('Never mind', '', () => mm.close())]);
  }

  // ---------- Side chat ----------
  let sideBody = null;
  function side(q) {
    if (!S.cur) { toast('Start a conversation first'); return; } const old = $('.sidechat'); if (old) { old.remove(); if (!q) return; }
    const w = el('div', 'sidechat popup', '<div class="sh"><span style="flex:1">Side chat — not saved</span><button class="tbi" style="width:24px;height:24px">✕</button></div><div class="sb"></div><input placeholder="Ask a side question…">'); w.style.position = 'absolute'; $('#chatcol').appendChild(w);
    sideBody = w.querySelector('.sb'); w.querySelector('button').onclick = () => w.remove(); const inp = w.querySelector('input'); inp.focus();
    async function ask(text) { const u = el('div', 'msg user', esc(text)); u.style.marginBottom = '8px'; sideBody.appendChild(u); const a = el('div', 'msg assistant'); sideBody.appendChild(a); sideBody.cur = a; sideBody.buf = ''; try { const r = await api.side(S.cur.id, text); if (!sideBody.buf) a.innerHTML = md.render(r); } catch (e) { a.innerHTML = `<span style="color:var(--red)">${esc(e.message)}</span>`; } }
    inp.onkeydown = (e) => { if (e.key === 'Enter' && inp.value.trim()) { const t = inp.value; inp.value = ''; ask(t); } if (e.key === 'Escape') w.remove(); }; if (q) ask(q);
  }
  function sideAppend(d) { if (sideBody && sideBody.cur) { sideBody.buf += d; sideBody.cur.innerHTML = md.render(sideBody.buf); sideBody.scrollTop = sideBody.scrollHeight; } }

  // ---------- Settings / Help ----------
  async function settings() {
    host().innerHTML = ''; const st = await api.getSettings(S.cur ? S.cur.cwd : S.info.home); const body = el('div');
    const sel = (label, id, opts, val) => `<div style="display:flex;justify-content:space-between;padding:9px 0;align-items:center"><span>${label}</span><select class="fin" style="flex:0 0 210px" id="${id}">${opts.map(([v, t]) => `<option value="${v}" ${v === val ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
    const perm = st.permissions || {};
    body.innerHTML = sel('Theme', 'set-theme', [['dark', 'Midnight (dark)'], ['light', 'Glacier (light)'], ['system', 'Match system']], st.theme || 'dark')
      + sel('Default permission mode for new Code sessions', 'set-mode', [['default', 'Manual'], ['acceptEdits', 'Accept edits'], ['plan', 'Plan'], ['auto', 'Auto'], ['bypassPermissions', 'Bypass permissions']], st.defaultMode || 'default')
      + sel('Transcript view', 'set-view', [['normal', 'Normal'], ['thinking', 'Thinking'], ['verbose', 'Verbose']], st.viewMode || 'normal')
      + `<h4 style="margin:18px 0 6px">Permission rules in effect</h4><div class="info">Edit them in <span class="kbd">.caelix/settings.json</span> (project) or <span class="kbd">${esc(S.info.userDir)}/settings.json</span>.</div><pre class="code"><code>${esc(JSON.stringify({ allow: perm.allow || [], ask: perm.ask || [], deny: perm.deny || [] }, null, 1))}</code></pre>`
      + `<h4 style="margin:18px 0 6px">Where things are stored</h4><div class="info">Sessions, notes and encrypted keys: <span class="kbd">${esc(S.info.userDir)}</span><br>Chat documents: <span class="kbd">${esc(S.info.chatDir)}</span></div>`;
    const m = dialog('Settings', '', body, [btn('Done', 'pri', () => m.close())]);
    body.querySelector('#set-theme').onchange = (e) => { api.setSettings({ theme: e.target.value }); document.documentElement.dataset.theme = e.target.value === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : e.target.value; };
    body.querySelector('#set-mode').onchange = (e) => { api.setSettings({ defaultMode: e.target.value }); api.setLast({ mode: e.target.value }); if (!S.cur) { S.draft.mode = e.target.value; window.updateChips(); } };
    body.querySelector('#set-view').onchange = (e) => { api.setSettings({ viewMode: e.target.value }); document.body.classList.remove('view-normal', 'view-thinking', 'view-verbose'); document.body.classList.add('view-' + e.target.value); S.view = e.target.value; window.updateChips(); };
  }
  function help() {
    host().innerHTML = ''; const rows = [['⌘N', 'New chat / session'], ['⌘⇧D', 'Changes'], ['⌃`', 'Terminal'], ['⌘⇧B', 'Browser'], ['⌘\\', 'Close pane'], ['⌘;', 'Side chat'], ['⌃O', 'Cycle view'], ['⌘⇧M', 'Permission mode'], ['⌘⇧I', 'Model'], ['⌘⇧E', 'Effort'], ['⌃Tab', 'Next session'], ['Esc', 'Stop'], ['↵ / ⌘↵', 'Send / queue'], ['/reset', 'Summarise, keep memory, reset tokens'], ['/compact', 'Summarise older messages'], ['/btw', 'Side question'], ['@', 'Mention a file (Code)'], ['⌘/', 'This list']];
    const b = el('div'); b.innerHTML = rows.map(([k, d]) => `<div class="pi"><span class="kbd">${k}</span><span class="d">${d}</span></div>`).join(''); dialog('Keyboard shortcuts', 'Type / in the composer for every command.', b, []);
  }

  function askText(title, initial, sub) {
    return new Promise((resolve) => {
      const body = el('div'); const inp = document.createElement('input'); inp.type = 'text'; inp.value = initial || ''; inp.maxLength = 120; inp.style.cssText = 'width:100%;padding:11px 13px;border-radius:12px;border:1px solid var(--border2);background:var(--glass3);color:inherit;font:inherit;outline:none';
      body.appendChild(inp); let done = false; const fin = (v) => { if (done) return; done = true; host().innerHTML = ''; resolve(v); };
      const ok = btn('Save', 'pri', () => fin(inp.value.trim() || null)); inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); ok.click(); } if (e.key === 'Escape') fin(null); };
      dialog(title, sub || '', body, [btn('Cancel', '', () => fin(null)), ok], { width: '520px' }); setTimeout(() => { inp.focus(); inp.select(); }, 30);
    });
  }
  function team() {
    const cur = S.cur || S.draft; let on = !!cur.team; let coder = cur.coder || { provider: cur.provider, model: cur.model }; let reviewer = cur.reviewer || null;
    const body = el('div'); const save = async () => {
      if (on && !reviewer) { toast('Choose a reviewer model first'); return false; }
      const patch = { team: on, coder: on ? coder : null, reviewer: on ? reviewer : null };
      if (S.cur) { await api.setSession(S.cur.id, patch); Object.assign(S.cur, patch); } else Object.assign(S.draft, patch);
      window.updateChips(); toast(on ? `Team on: ${coder.model} codes, ${reviewer.model} reviews` : 'Team mode off'); return true;
    };
    function draw() {
      body.innerHTML = ''; const intro = el('div', 'info', 'Team mode uses two models. The coder does the work and edits files. After it finishes, the reviewer reads the changes and either approves them or sends the coder back to fix problems.'); body.appendChild(intro);
      const r0 = el('div', 'teamrow'); const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = on; cb.onchange = () => { on = cb.checked; draw(); }; r0.append(cb, el('div', 'tl', 'Team mode'), el('div', 'tm', on ? 'On' : 'Off')); body.appendChild(r0);
      if (on) for (const [lab, get, set] of [['Coder', () => coder, (v) => (coder = v)], ['Reviewer', () => reviewer, (v) => (reviewer = v)]]) {
        const r = el('div', 'teamrow'); const v = get(); const b = btn(v ? 'Change' : 'Choose model', '', (ev) => modelPicker(ev.currentTarget, (provider, model) => { set({ provider, model }); draw(); }));
        r.append(el('div', 'tl', lab), el('div', 'tm', v ? `${v.provider} / ${v.model}` : 'Not chosen yet'), b); body.appendChild(r);
      }
    }
    draw(); dialog('Team mode', 'Pick one model to write code and a different one to review it.', body, [btn('Cancel', '', () => (host().innerHTML = '')), btn('Save', 'pri', async () => { if (await save()) host().innerHTML = ''; })], { width: '620px' });
  }
  window.Modals = { askText, team, keys, modelPicker, mcp, hooks, memory, system, permission, rewind, side, sideAppend, settings, help };
})();
