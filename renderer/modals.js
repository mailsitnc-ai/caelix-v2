'use strict';
// Modals and pickers: Keys, model picker, permission pop-up, rewind, side chat, settings, help. Loaded on first use.
(function () {
  const host = () => $('#modal-host');
  function modal(title, bodyNode, footerNodes, opts) {
    const sc = el('div', 'scrim'); const m = el('div', 'modal' + (opts && opts.cls ? ' ' + opts.cls : '')); if (opts && opts.width) m.style.width = opts.width;
    const h = el('header', null, `<h2>${esc(title)}</h2>`); const x = el('button', 'tbi', '✕'); x.onclick = close; h.appendChild(x);
    const mb = el('div', 'mb'); mb.appendChild(bodyNode); m.append(h, mb);
    if (footerNodes && footerNodes.length) { const f = el('footer'); footerNodes.forEach((n) => f.appendChild(n)); m.appendChild(f); }
    sc.appendChild(m); sc.onmousedown = (e) => { if (e.target === sc && !(opts && opts.sticky)) close(); }; host().appendChild(sc);
    function close() { sc.remove(); if (opts && opts.onClose) opts.onClose(); } sc._close = close; return { close, root: sc };
  }
  const btn = (t, cls, fn) => { const b = el('button', 'btn ' + (cls || ''), esc(t)); b.onclick = fn; return b; };

  // ---------- Keys ----------
  async function keys() {
    const body = el('div'); const info = await api.init(); S.providers = info.providers;
    if (!info.secure) body.appendChild(el('div', 'err', 'Secure storage is not available on this computer, so keys cannot be saved.'));
    body.appendChild(el('div', 'info', 'Keys are stored encrypted on this computer, outside the project folder, and only the last 4 characters are ever shown. Paste a key, then Save: its models load right away.'));
    function row(p) {
      const r = el('div', 'prow'); const ok = p.virtual ? true : p.hasKey;
      r.innerHTML = `<div class="pt">${esc(p.name)} <span class="badge ${ok ? 'ok' : ''}">${p.virtual ? 'built in' : p.hasKey ? 'connected · ' + esc(p.masked) : 'not connected'}</span></div>${p.note ? `<div class="pn">${esc(p.note)}</div>` : ''}`;
      if (p.editableBase) { const f = el('div', 'f'); const i = el('input'); i.placeholder = p.id === 'omniroute' ? 'Optional OmniRoute server URL, e.g. http://localhost:20128/v1' : 'OpenAI-compatible base URL'; i.value = p.base || ''; const sb = btn('Save URL', '', async () => { S.providers = await api.setBase(p.id, i.value); toast('Base URL saved'); }); f.append(i, sb); r.appendChild(f); }
      if (!p.virtual || p.id === 'omniroute') {
        if (p.id !== 'omniroute') {
          const f = el('div', 'f'); const i = el('input'); i.type = 'password'; i.placeholder = p.hasKey ? 'Replace key (' + p.masked + ')' : 'Paste ' + (p.keyHint || 'key'); i.autocomplete = 'off'; i.spellcheck = false;
          const save = btn('Save', 'pri', async () => {
            const v = i.value.trim(); if (!v) return; save.disabled = true;
            try { S.providers = await api.setKey(p.id, v); i.value = ''; toast('Saved. Loading models…'); const m = await api.models(p.id, true); S.models[p.id] = m; toast(`${p.name}: ${m.length} models available`); } catch (e) { toast(e.message, 5000); }
            redraw();
          }); f.append(i, save);
          if (p.hasKey) { f.appendChild(btn('Test', '', async () => { try { const m = await api.models(p.id, true); S.models[p.id] = m; toast(`${p.name}: ${m.length} models`); } catch (e) { toast(e.message, 5000); } })); f.appendChild(btn('Remove', 'dng', async () => { S.providers = await api.removeKey(p.id); delete S.models[p.id]; redraw(); })); }
          r.appendChild(f);
        }
      }
      if (p.docs) { const a = el('div', 'pn'); a.style.marginTop = '8px'; a.innerHTML = `Get a key: <a href="${esc(p.docs)}" data-ext="1" style="color:var(--accent)">${esc(p.docs)}</a>`; r.appendChild(a); }
      return r;
    }
    const list = el('div'); body.appendChild(list);
    function redraw() { list.innerHTML = ''; S.providers.forEach((p) => list.appendChild(row(p))); window.updateChips(); }
    redraw(); modal('Model provider keys', body, [btn('Done', 'pri', () => m.close())], { width: '680px' }); var m = { close: () => host().innerHTML = '' };
  }

  // ---------- Model picker ----------
  async function modelPicker() {
    window.closePop && window.closePop(); host().innerHTML = '';
    const pop = el('div', 'popup mpicker'); pop.style.position = 'fixed'; const inp = el('input'); inp.placeholder = 'Search models…'; const list = el('div', 'mlist'); pop.append(inp, list); document.body.appendChild(pop);
    const a = $('#chip-model').getBoundingClientRect(); pop.style.left = Math.max(10, Math.min(a.right - 560, innerWidth - 570)) + 'px'; pop.style.bottom = (innerHeight - a.top + 6) + 'px';
    const cur = (S.cur ? { provider: S.cur.provider, model: S.cur.model } : { provider: S.draft.provider, model: S.draft.model });
    let groups = [];
    function close() { pop.remove(); document.removeEventListener('mousedown', away, true); document.removeEventListener('keydown', esc2, true); }
    const away = (e) => { if (!pop.contains(e.target) && !e.target.closest('#chip-model')) close(); }; const esc2 = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', away, true); document.addEventListener('keydown', esc2, true);
    function draw() {
      const q = inp.value.trim().toLowerCase(); list.innerHTML = '';
      for (const g of groups) {
        const ms = (g.models || []).filter((m) => !q || m.id.toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q) || (m.desc || '').toLowerCase().includes(q));
        if (q && !ms.length) continue;
        list.appendChild(el('div', 'mg', `${esc(g.name.toUpperCase())} (${g.loading ? '…' : ms.length})${g.err ? `<span class="why">${esc(g.err)}</span>` : ''}`));
        if (g.loading) list.appendChild(el('div', 'info', 'Loading models…'));
        ms.slice(0, q ? 300 : 120).forEach((m) => {
          const r = el('div', 'mi' + (cur.provider === g.id && cur.model === m.id ? ' cur' : '')); r.innerHTML = `<span class="dot"></span><div><span class="mn">${esc(m.id)}</span>${m.desc ? `<span class="md"> · ${esc(m.desc)}</span>` : ''}</div>`;
          r.onclick = () => { window.setModel(g.id, m.id); close(); }; list.appendChild(r);
        });
        if (!q && ms.length > 120) list.appendChild(el('div', 'info', `${ms.length - 120} more: type to search`));
      }
      const missing = S.providers.filter((p) => !p.virtual && !p.hasKey);
      if (!q && missing.length) { const d = el('div', 'mg', 'Not connected'); const n = el('div', 'info', 'Add a key to load models from: ' + esc(missing.map((p) => p.name).join(', ')) + ' — '); const l = el('a', null, 'open Keys'); l.href = '#'; l.style.color = 'var(--accent)'; l.onclick = (e) => { e.preventDefault(); close(); keys(); }; n.appendChild(l); list.append(d, n); }
    }
    inp.oninput = draw; inp.focus();
    const info = await api.init(); S.providers = info.providers;
    const omni = S.providers.find((p) => p.id === 'omniroute');
    groups = [{ id: 'omniroute', name: 'OmniRoute', models: await api.models('omniroute').catch(() => []) }];
    for (const p of S.providers.filter((p) => !p.virtual && p.hasKey)) groups.push({ id: p.id, name: p.name, models: S.models[p.id] || [], loading: !S.models[p.id] });
    groups.push({ id: 'pretend', name: 'Pretend AI (offline test)', models: await api.models('pretend') });
    draw();
    groups.filter((g) => g.loading).forEach(async (g) => { try { g.models = await api.models(g.id); S.models[g.id] = g.models; } catch (e) { g.err = e.message; g.models = []; } g.loading = false; draw(); });
  }

  // ---------- Permission pop-up ----------
  function permission(id, req) {
    const body = el('div', 'perm'); const t = req.tool; const i = req.input || {};
    let detail = '';
    if (t === 'Bash') detail = `<pre>$ ${esc(i.command)}</pre>${i.description ? `<div class="info">${esc(i.description)}</div>` : ''}`;
    else if (t === 'Edit') detail = `<div class="info">${esc(i.file_path)}</div><pre>${esc((i.old_string || '').split('\n').map((l) => '- ' + l).join('\n') + '\n' + (i.new_string || '').split('\n').map((l) => '+ ' + l).join('\n'))}</pre>`;
    else if (t === 'Write') detail = `<div class="info">${esc(i.file_path)}</div><pre>${esc((i.content || '').slice(0, 1500))}</pre>`;
    else detail = `<pre>${esc(JSON.stringify(i, null, 1).slice(0, 1200))}</pre>`;
    body.innerHTML = `<div>CAELIX wants to use <b>${esc(t)}</b>.</div>${detail}`;
    const why = el('input'); why.placeholder = 'Optional: tell CAELIX why (used if you deny)'; why.style.cssText = 'width:100%;border:1px solid var(--border);border-radius:8px;padding:6px 10px;background:var(--bg)'; body.appendChild(why);
    let done = false; const answer = (decision) => { if (done) return; done = true; api.answer(S.cur.id, id, { decision, comment: why.value.trim() }); mm.close(); document.removeEventListener('keydown', kh, true); };
    const deny = btn('Deny', 'dng', () => answer('deny')); const once = btn('Allow once', 'pri', () => answer('allow')); const always = btn('Always allow ' + req.rule, '', () => answer('always')); once.id = 'perm-allow'; deny.id = 'perm-deny';
    const mm = modal('Permission needed', body, [deny, always, once], { sticky: true, cls: 'perm', width: '560px' }); once.focus();
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
    const mm = modal('Rewind', body, [btn('Never mind', '', () => mm.close())]);
  }

  // ---------- Side chat ----------
  let sideBody = null;
  function side(q) {
    if (!S.cur) { toast('Start a session first'); return; } const old = $('.sidechat'); if (old) { old.remove(); if (!q) return; }
    const w = el('div', 'sidechat', '<div class="sh"><span style="flex:1">Side chat — not saved</span><button class="tbi" style="width:24px;height:24px">✕</button></div><div class="sb"></div><input placeholder="Ask a side question…">'); $('#chatcol').appendChild(w);
    sideBody = w.querySelector('.sb'); w.querySelector('button').onclick = () => w.remove(); const inp = w.querySelector('input'); inp.focus();
    async function ask(text) { sideBody.appendChild(el('div', 'msg user', esc(text))).style.marginBottom = '8px'; const a = el('div', 'msg assistant'); sideBody.appendChild(a); sideBody.cur = a; sideBody.buf = ''; try { const r = await api.side(S.cur.id, text); if (!sideBody.buf) a.innerHTML = md.render(r); } catch (e) { a.innerHTML = `<span style="color:var(--red)">${esc(e.message)}</span>`; } }
    inp.onkeydown = (e) => { if (e.key === 'Enter' && inp.value.trim()) { const t = inp.value; inp.value = ''; ask(t); } if (e.key === 'Escape') w.remove(); };
    if (q) ask(q);
  }
  function sideAppend(d) { if (sideBody && sideBody.cur) { sideBody.buf += d; sideBody.cur.innerHTML = md.render(sideBody.buf); sideBody.scrollTop = sideBody.scrollHeight; } }

  // ---------- Settings ----------
  async function settings() {
    const st = await api.getSettings(S.cur ? S.cur.cwd : S.info.home); const body = el('div');
    const sel = (label, id, opts, val) => `<div class="row" style="display:flex;justify-content:space-between;padding:8px 0;align-items:center"><span>${label}</span><select id="${id}" style="border:1px solid var(--border);border-radius:8px;padding:5px 8px;background:var(--bg)">${opts.map(([v, t]) => `<option value="${v}" ${v === val ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
    const perm = st.permissions || {};
    body.innerHTML = sel('Theme', 'set-theme', [['system', 'Match system'], ['light', 'Light'], ['dark', 'Dark']], st.theme || 'system')
      + sel('Default permission mode for new sessions', 'set-mode', [['default', 'Manual'], ['acceptEdits', 'Accept edits'], ['plan', 'Plan'], ['auto', 'Auto'], ['bypassPermissions', 'Bypass permissions']], st.defaultMode || 'default')
      + sel('Transcript view', 'set-view', [['normal', 'Normal'], ['thinking', 'Thinking'], ['verbose', 'Verbose']], st.viewMode || 'normal')
      + `<h4 style="margin:16px 0 6px">Permission rules in effect</h4><div class="info">Edit them in <span class="kbd">.caelix/settings.json</span> (project) or <span class="kbd">${esc(S.info.userDir)}/settings.json</span> (all projects).</div><pre class="code"><code>${esc(JSON.stringify({ allow: perm.allow || [], ask: perm.ask || [], deny: perm.deny || [] }, null, 1))}</code></pre>`
      + `<h4 style="margin:16px 0 6px">Where things are stored</h4><div class="info">Sessions, notes and encrypted keys: <span class="kbd">${esc(S.info.userDir)}</span></div>`;
    const m = modal('Settings', body, [btn('Done', 'pri', () => m.close())]);
    body.querySelector('#set-theme').onchange = (e) => { api.setSettings({ theme: e.target.value }); document.documentElement.dataset.theme = e.target.value === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : e.target.value; };
    body.querySelector('#set-mode').onchange = (e) => { api.setSettings({ defaultMode: e.target.value }); api.setLast({ mode: e.target.value }); if (!S.cur) { S.draft.mode = e.target.value; window.updateChips(); } };
    body.querySelector('#set-view').onchange = (e) => { api.setSettings({ viewMode: e.target.value }); document.body.classList.remove('view-normal', 'view-thinking', 'view-verbose'); document.body.classList.add('view-' + e.target.value); S.view = e.target.value; };
  }

  // ---------- Help ----------
  function help() {
    const rows = [['⌘N', 'New session'], ['⌘⇧D', 'Toggle changes'], ['⌃`', 'Toggle terminal'], ['⌘⇧B', 'Toggle browser'], ['⌘\\', 'Close pane'], ['⌘;', 'Side chat'], ['⌃O', 'Cycle view mode'], ['⌘⇧M', 'Permission mode'], ['⌘⇧I', 'Model'], ['⌘⇧E', 'Effort'], ['⌃Tab', 'Next session'], ['Esc', 'Stop'], ['↵ / ⌘↵', 'Send / queue'], ['/', 'Slash commands'], ['@', 'Mention a file'], ['⌘/', 'This list']];
    const b = el('div'); b.innerHTML = rows.map(([k, d]) => `<div class="pi"><span class="kbd">${k}</span><span class="d">${d}</span></div>`).join(''); modal('Keyboard shortcuts', b, []);
  }

  window.Modals = { keys, modelPicker, permission, rewind, side, sideAppend, settings, help };
})();
