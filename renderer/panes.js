'use strict';
// Side panes: Changes (diff), Terminal, Files, Browser. Loaded on first use.
(function () {
  const TABS = [['diff', 'Changes'], ['terminal', 'Terminal'], ['files', 'Files'], ['browser', 'Browser']];
  const comments = [];
  let termBuf = ''; let termSid = null; let curFile = null; let dirty = false; let saveT = 0;

  function chrome(active) {
    const t = $('#sp-tabs'); t.innerHTML = '';
    TABS.forEach(([id, label]) => { const b = el('button', 'sp-tab' + (id === active ? ' on' : ''), label); b.onclick = () => { S.pane = id; show(id); window.openPaneButtons && 0; document.querySelectorAll('.tbi').forEach(() => {}); for (const n of ['terminal', 'diff', 'browser', 'files']) $('#tb-' + n).classList.toggle('on', id === n); }; t.appendChild(b); });
    const x = el('button', 'sp-x', '✕'); x.title = 'Close pane (⌘\\)'; x.onclick = window.closeAllPanes; t.appendChild(x);
  }
  function show(name) { chrome(name); const b = $('#sp-body'); b.innerHTML = ''; ({ diff, terminal, files, browser })[name](b); }
  function refresh() { if (S.pane) show(S.pane); }

  // ---- Changes ----
  async function diff(b) {
    if (!S.cur) { b.appendChild(el('div', 'empty-note', 'Start a session to see changes.')); return; }
    let list = []; try { list = await api.diff(S.cur.id); } catch (_) {} S.changes = list; window.updateRail();
    if (!list.length) { b.appendChild(el('div', 'empty-note', 'No changes yet. Files CAELIX creates or edits show up here.')); return; }
    list.forEach((f) => {
      const box = el('div', 'dfile'); const h = el('div', 'dh', `<span>${f.status === 'added' ? '＋' : f.status === 'deleted' ? '－' : '✎'}</span><span class="nm">${esc(f.rel)}</span><span class="plus-ln">+${f.add}</span><span class="minus-ln">-${f.del}</span>`);
      const body = el('div'); h.onclick = () => (body.hidden = !body.hidden); box.append(h, body);
      let n = f.start;
      f.lines.forEach(([op, text]) => {
        const num = op === '+' ? '' : n; if (op !== '+') n++;
        const row = el('div', 'dl ' + (op === '+' ? 'a' : op === '-' ? 'd' : ''), `<span class="cmt" title="Add comment">+</span><span class="n">${num}</span><span class="t">${esc(op === ' ' ? '  ' + text : op + ' ' + text)}</span>`);
        row.querySelector('.cmt').onclick = () => {
          if (row.nextSibling && row.nextSibling.classList && row.nextSibling.classList.contains('cbox')) return;
          const cb = el('div', 'cbox', '<input placeholder="Comment for CAELIX, press Enter to add">'); const inp = cb.querySelector('input'); row.after(cb); inp.focus();
          inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); if (inp.value.trim()) { comments.push({ file: f.rel, line: num || '(new)', text: inp.value.trim() }); cb.innerHTML = `<span style="color:var(--muted)">💬 ${esc(inp.value)}</span>`; renderBar(); } else cb.remove(); } if (e.key === 'Escape') cb.remove(); };
        };
        body.appendChild(row);
      });
      b.appendChild(box);
    });
    renderBar(); function renderBar() {
      let bar = $('#cbar'); if (bar) bar.remove(); if (!comments.length) return;
      bar = el('div', 'cbox'); bar.id = 'cbar'; bar.style.cssText = 'position:sticky;bottom:0;border-top:1px solid var(--border);align-items:center;justify-content:space-between';
      bar.innerHTML = `<span>${comments.length} comment${comments.length > 1 ? 's' : ''}</span>`; const go = el('button', 'btn pri', 'Send to CAELIX ⌘↵'); go.onclick = send; bar.appendChild(go); b.appendChild(bar);
    }
    function send() { const t = 'Please address these review comments on your changes:\n' + comments.map((c) => `- ${c.file}:${c.line} — ${c.text}`).join('\n'); comments.length = 0; window.submit(t); }
    b.onkeydown = (e) => { if (e.metaKey && e.key === 'Enter' && comments.length) send(); }; b.tabIndex = 0;
  }

  // ---- Terminal ----
  function terminal(b) {
    if (!S.cur) { b.appendChild(el('div', 'empty-note', 'Start a session to open a terminal in its folder.')); return; }
    const out = el('pre'); out.id = 'term-out'; const inp = el('input'); inp.id = 'term-in'; inp.placeholder = '$ run a command in ' + S.cur.cwd.replace(/^\/Users\/[^/]+/, '~');
    b.append(out, inp); if (termSid !== S.cur.id) { termBuf = ''; termSid = S.cur.id; } out.textContent = termBuf; out.scrollTop = out.scrollHeight;
    const hist = []; let hi = 0;
    inp.onkeydown = (e) => {
      if (e.key === 'Enter' && inp.value.trim()) { const c = inp.value; hist.push(c); hi = hist.length; termBuf += '$ ' + c + '\n'; out.textContent = termBuf; inp.value = ''; api.termRun(S.cur.id, c); }
      if (e.key === 'ArrowUp' && hi > 0) { inp.value = hist[--hi]; e.preventDefault(); } if (e.key === 'ArrowDown') { inp.value = hist[++hi] || ''; e.preventDefault(); }
    };
    inp.focus();
  }
  api.onTerm(({ sid, data }) => { if (!S.cur || sid !== S.cur.id) return; termBuf += data; if (termBuf.length > 200000) termBuf = termBuf.slice(-150000); const o = $('#term-out'); if (o) { o.textContent = termBuf; o.scrollTop = o.scrollHeight; } });

  // ---- Files ----
  function files(b) {
    if (!S.cur) { b.appendChild(el('div', 'empty-note', 'Start a session to browse its files.')); return; }
    const tree = el('div', 'ftree'); const ed = el('textarea'); ed.id = 'editor'; ed.placeholder = 'Select a file'; ed.spellcheck = false;
    const bar = el('div', 'cbox', '<label><input type="checkbox" id="autosave" checked> Auto save</label><span id="fstat" style="color:var(--muted);margin-left:auto"></span>'); b.append(tree, bar, ed);
    async function load(dir, host, depth) {
      let ents; try { ents = await api.listDir(dir); } catch (e) { host.appendChild(el('div', 'fi', esc(e.message))); return; }
      ents.forEach((en) => {
        const row = el('div', 'fi', `<span style="display:inline-block;width:${depth * 14}px"></span>${en.dir ? '▸ ' : '· '}${esc(en.name)}`); const full = dir + '/' + en.name; host.appendChild(row);
        if (en.dir) { const kids = el('div'); host.appendChild(kids); let open = false; row.onclick = async () => { open = !open; kids.innerHTML = ''; if (open) await load(full, kids, depth + 1); }; } else row.onclick = () => openFile(full);
      });
    }
    async function openFile(f) {
      try { ed.value = await api.readFile(f); curFile = f; dirty = false; $('#fstat').textContent = f.replace(S.cur.cwd + '/', ''); } catch (e) { toast(e.message); }
    }
    ed.oninput = () => { dirty = true; $('#fstat').textContent = 'Editing…'; clearTimeout(saveT); if ($('#autosave').checked) saveT = setTimeout(save, 600); };
    async function save() { if (!curFile) return; await api.writeFile(curFile, ed.value); dirty = false; $('#fstat').textContent = 'Saved ' + curFile.split('/').pop(); }
    load(S.cur.cwd, tree, 0).then(() => { if (window.pendingFile) { openFile(window.pendingFile); window.pendingFile = null; } });
  }

  // ---- Browser ----
  function browser(b) {
    const bar = el('div', 'urlbar', '<input id="url" placeholder="http://localhost:3000"><button class="btn" id="go">Go</button>'); const fr = el('iframe', 'browser'); fr.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
    b.append(bar, fr); const inp = $('#url'); inp.value = window.lastUrl || ''; const go = () => { let u = inp.value.trim(); if (!u) return; if (!/^https?:/.test(u)) u = 'http://' + u; window.lastUrl = u; fr.src = u; };
    $('#go').onclick = go; inp.onkeydown = (e) => e.key === 'Enter' && go(); if (inp.value) go(); else inp.focus();
  }

  window.Panes = { show, refresh };
})();
