'use strict';
const see = require('./see');
const { webSearch } = require('./search');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'out', '.DS_Store']);
const MUTATING = new Set(['Write', 'Edit', 'NotebookEdit', 'Bash']);
const READ_ONLY = new Set(['LookAtPage', 'WriteDocument', 'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TodoWrite', 'Skill', 'AskUserQuestion', 'TaskStop', 'EnterPlanMode', 'ExitPlanMode']);

const def = (name, description, properties, required) => ({
  type: 'function', function: { name, description, parameters: { type: 'object', properties, required: required || [] } },
});

const DEFS = [
  def('Read', 'Read a text file (returns numbered lines) or an image file (returns its size, colours and the text in it). Use offset/limit for big files.', { file_path: { type: 'string' }, offset: { type: 'number' }, limit: { type: 'number' } }, ['file_path']),
  def('Write', 'Create or overwrite a file. An existing file must have been read first.', { file_path: { type: 'string' }, content: { type: 'string' } }, ['file_path', 'content']),
  def('Edit', 'Replace an exact string in a file. old_string must match once unless replace_all is true. File must have been read first.', { file_path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' }, replace_all: { type: 'boolean' } }, ['file_path', 'old_string', 'new_string']),
  def('NotebookEdit', 'Replace the source of one cell of a .ipynb notebook.', { notebook_path: { type: 'string' }, cell_index: { type: 'number' }, new_source: { type: 'string' } }, ['notebook_path', 'cell_index', 'new_source']),
  def('Glob', 'Find files by glob pattern (e.g. **/*.js). Newest first.', { pattern: { type: 'string' }, path: { type: 'string' } }, ['pattern']),
  def('Grep', 'Search file contents with a regular expression.', { pattern: { type: 'string' }, path: { type: 'string' }, glob: { type: 'string' }, output_mode: { type: 'string', enum: ['content', 'files_with_matches', 'count'] }, case_insensitive: { type: 'boolean' } }, ['pattern']),
  def('Bash', 'Run a shell command. Default timeout 120s (max 600s); slower commands move to the background. Set run_in_background for servers.', { command: { type: 'string' }, description: { type: 'string' }, timeout: { type: 'number' }, run_in_background: { type: 'boolean' } }, ['command']),
  def('TaskStop', 'Stop a background command by task id.', { task_id: { type: 'string' } }, ['task_id']),
  def('LookAtPage', 'SEE a web page, game or UI you built, without a vision model. Renders an HTML file or URL in a hidden window and returns console errors, layout problems, every visible element with position and colour, whether canvases are blank, and the text read from a screenshot. Use it after creating or changing anything visual. Optional clicks (CSS selectors or button text) and keys are applied before looking.', { target: { type: 'string', description: 'HTML file path (relative to the project) or http(s) URL, e.g. index.html or http://localhost:3000' }, width: { type: 'number' }, height: { type: 'number' }, wait_ms: { type: 'number' }, clicks: { type: 'array', items: { type: 'string' } }, keys: { type: 'array', items: { type: 'string' } } }, ['target']),
  def('WebFetch', 'Fetch a URL and return its text.', { url: { type: 'string' } }, ['url']),
  def('WebSearch', 'Search the web; returns titles, URLs and snippets.', { query: { type: 'string' } }, ['query']),
  def('TodoWrite', 'Replace the task checklist. Statuses: pending, in_progress, completed.', { todos: { type: 'array', items: { type: 'object', properties: { content: { type: 'string' }, status: { type: 'string' } } } } }, ['todos']),
  def('AskUserQuestion', 'Ask the user a multiple-choice question and wait for the answer.', { question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } }, ['question', 'options']),
  def('EnterPlanMode', 'Switch to plan mode: explore read-only and propose a plan.', {}),
  def('ExitPlanMode', 'Present the plan for approval and leave plan mode.', { plan: { type: 'string' } }, ['plan']),
  def('Agent', 'Run a sub-agent with its own context. subagent_type: explore (read-only) or general.', { description: { type: 'string' }, prompt: { type: 'string' }, subagent_type: { type: 'string' } }, ['prompt']),
  def('WriteDocument', 'Create a document for the user in their CAELIX Chats folder. format: md, txt, html or pdf. Returns the saved path.', { filename: { type: 'string' }, content: { type: 'string', description: 'Markdown (for pdf/html/md) or plain text' }, format: { type: 'string', enum: ['md', 'txt', 'html', 'pdf'] } }, ['filename', 'content']),
  def('Skill', 'Load a skill by name from .caelix/skills/<name>/SKILL.md.', { name: { type: 'string' } }, ['name']),
];

function resolveP(ctx, p) {
  if (!p) throw new Error('missing path');
  const r = p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : path.resolve(ctx.cwd, p);
  return r;
}
function isText(buf) { for (let i = 0; i < Math.min(buf.length, 4096); i++) if (buf[i] === 0) return false; return true; }
function globToRe(g) {
  let s = '^'; for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') { if (g[i + 1] === '*') { i++; if (g[i + 1] === '/') { i++; s += '(?:.*/)?'; } else s += '.*'; } else s += '[^/]*'; }
    else if (c === '?') s += '[^/]'; else if (c === '{') { const e = g.indexOf('}', i); s += '(?:' + g.slice(i + 1, e).split(',').map((x) => x.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|') + ')'; i = e; }
    else s += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(s + '$');
}
function walk(dir, out, limit, depth = 0) {
  if (out.length >= limit || depth > 25) return;
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of ents) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out, limit, depth + 1); else if (e.isFile()) out.push(full);
    if (out.length >= limit) return;
  }
}
function snapshot(ctx, file) { if (ctx.onBeforeWrite) ctx.onBeforeWrite(file); }
function html2text(h) {
  return h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
}

// Stop a command together with everything it started (it runs in its own process group).
function killTree(child) {
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' }).on('error', () => child.kill());
    else process.kill(-child.pid, 'SIGTERM');
  } catch (_) { try { child.kill('SIGTERM'); } catch (e) {} }
}

// Background task table (per process)
const tasks = new Map(); let taskSeq = 0;

function runBash(ctx, a) {
  return new Promise((resolve) => {
    const id = 'bg' + (++taskSeq); const outFile = path.join(os.tmpdir(), `caelix-${process.pid}-${id}.log`);
    const cwdFile = path.join(os.tmpdir(), `caelix-${process.pid}-${id}.cwd`);
    const wrapped = `{ ${a.command}\n}; __rc=$?; pwd -P > "${cwdFile}"; exit $__rc`;
    const shell = process.env.SHELL && fs.existsSync(process.env.SHELL) ? process.env.SHELL : '/bin/bash';
    const child = spawn(shell, ['-c', wrapped], { cwd: ctx.cwd, env: { ...process.env, TERM: 'dumb' }, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    const outStream = fs.createWriteStream(outFile); let out = ''; let bg = !!a.run_in_background; let finished = false;
    const task = { id, command: a.command, child, outFile, status: 'running', started: Date.now() }; tasks.set(id, task);
    const sink = (d) => { outStream.write(d); if (out.length < 400000) out += d.toString(); if (ctx.onBgOutput && bg) ctx.onBgOutput(id, d.toString()); };
    child.stdout.on('data', sink); child.stderr.on('data', sink);
    const finish = (code, sig) => {
      if (finished) return; finished = true; task.status = code === 0 ? 'done' : 'failed'; task.code = code; outStream.end();
      if (!bg) { try { const nc = fs.readFileSync(cwdFile, 'utf8').trim(); if (nc && ctx.setCwd) ctx.setCwd(nc); } catch (_) {} }
      try { fs.unlinkSync(cwdFile); } catch (_) {}
      if (ctx.onBgDone && bg) ctx.onBgDone(id, code);
      if (bg && !task.reported) return;
      let text = out.length > 30000 ? out.slice(0, 2000) + `\n… [${out.length} chars, full output in ${outFile}] …\n` + out.slice(-8000) : out;
      if (!text.trim()) text = '(no output)';
      resolve(code === 0 ? text : `Exit code ${code}${sig ? ' (' + sig + ')' : ''}\n${text.length > 10000 ? text.slice(-10000) : text}`);
    };
    child.on('close', finish); child.on('error', (e) => { out += String(e); finish(1); });
    if (bg) { task.reported = true; resolve(`Started background task ${id}. Output is written to ${outFile}`); if (ctx.onBgStart) ctx.onBgStart(task); return; }
    const tmo = Math.min(Math.max(a.timeout || 120000, 1000), 600000);
    const timer = setTimeout(() => {
      if (finished) return; bg = true; task.reported = true;
      if (ctx.onBgStart) ctx.onBgStart(task);
      resolve(`Command did not complete within its ${Math.round(tmo / 1000)}s timeout and was moved to the background (task ${id}). Output: ${outFile}`);
    }, tmo);
    child.on('close', () => clearTimeout(timer));
    if (ctx.signal) ctx.signal.addEventListener('abort', () => { if (!finished && !bg) killTree(child); }, { once: true });
  });
}

const IMPL = {
  async Read(ctx, a) {
    const f = resolveP(ctx, a.file_path); const st = fs.statSync(f);
    if (st.isDirectory()) return 'Error: path is a directory: ' + f;
    if (see.IMAGE_EXT.test(f)) { ctx.readFiles.add(f); return see.describeImage(f); }
    const buf = fs.readFileSync(f); if (!isText(buf)) return 'Error: binary file (' + st.size + ' bytes), cannot display';
    ctx.readFiles.add(f);
    const lines = buf.toString('utf8').split('\n'); const off = Math.max(0, (a.offset || 1) - 1); const lim = a.limit || 2000;
    const slice = lines.slice(off, off + lim);
    let out = slice.map((l, i) => `${String(off + i + 1).padStart(6)}\t${l.length > 2000 ? l.slice(0, 2000) + '…' : l}`).join('\n');
    if (off + lim < lines.length) out += `\n[PARTIAL view: lines ${off + 1}-${off + slice.length} of ${lines.length}]`;
    return out || '(empty file)';
  },
  async Write(ctx, a) {
    const f = resolveP(ctx, a.file_path);
    const exists = fs.existsSync(f);
    if (exists && !ctx.readFiles.has(f)) return 'Error: this file already exists; Read it first before overwriting.';
    snapshot(ctx, f); fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, a.content); ctx.readFiles.add(f); ctx.changed && ctx.changed(f);
    return `${exists ? 'Updated' : 'Created'} ${f} (${a.content.split('\n').length} lines)`;
  },
  async Edit(ctx, a) {
    const f = resolveP(ctx, a.file_path);
    if (!fs.existsSync(f)) return 'Error: file does not exist: ' + f;
    if (!ctx.readFiles.has(f)) return 'Error: Read the file first before editing it.';
    const buf = fs.readFileSync(f); if (!isText(buf)) return 'Error: file is not text';
    const txt = buf.toString('utf8');
    if (a.old_string === a.new_string) return 'Error: old_string and new_string are identical.';
    const n = a.old_string ? txt.split(a.old_string).length - 1 : 0;
    if (n === 0) return 'Error: old_string was not found in the file (must match exactly, including whitespace).';
    if (n > 1 && !a.replace_all) return `Error: old_string matches ${n} places; add more context or set replace_all.`;
    snapshot(ctx, f);
    fs.writeFileSync(f, a.replace_all ? txt.split(a.old_string).join(a.new_string) : txt.replace(a.old_string, () => a.new_string));
    ctx.changed && ctx.changed(f);
    return `Edited ${f} (${a.replace_all ? n : 1} replacement${n > 1 && a.replace_all ? 's' : ''})`;
  },
  async NotebookEdit(ctx, a) {
    const f = resolveP(ctx, a.notebook_path); const nb = JSON.parse(fs.readFileSync(f, 'utf8'));
    const c = nb.cells && nb.cells[a.cell_index]; if (!c) return 'Error: no such cell';
    snapshot(ctx, f); c.source = a.new_source.split(/(?<=\n)/); fs.writeFileSync(f, JSON.stringify(nb, null, 1)); ctx.changed && ctx.changed(f);
    return 'Edited cell ' + a.cell_index;
  },
  async Glob(ctx, a) {
    const base = a.path ? resolveP(ctx, a.path) : ctx.cwd; const files = []; walk(base, files, 20000);
    const re = globToRe(a.pattern.startsWith('/') ? a.pattern : a.pattern);
    const hit = files.filter((f) => re.test(path.relative(base, f))).map((f) => ({ f, m: fs.statSync(f).mtimeMs })).sort((x, y) => y.m - x.m).slice(0, 200);
    return hit.length ? hit.map((h) => path.relative(ctx.cwd, h.f) || h.f).join('\n') : 'No files matched.';
  },
  async Grep(ctx, a) {
    const base = a.path ? resolveP(ctx, a.path) : ctx.cwd; let files = [];
    if (fs.existsSync(base) && fs.statSync(base).isFile()) files = [base]; else walk(base, files, 20000);
    const gre = a.glob ? globToRe(a.glob.includes('/') ? a.glob : '**/' + a.glob) : null;
    let re; try { re = new RegExp(a.pattern, a.case_insensitive ? 'i' : ''); } catch (e) { return 'Error: bad regex: ' + e.message; }
    const mode = a.output_mode || 'files_with_matches'; const out = []; let count = 0;
    for (const f of files) {
      if (gre && !gre.test(path.relative(base, f))) continue;
      let st; try { st = fs.statSync(f); } catch (_) { continue; } if (st.size > 2e6) continue;
      let buf; try { buf = fs.readFileSync(f); } catch (_) { continue; } if (!isText(buf)) continue;
      const lines = buf.toString('utf8').split('\n'); let n = 0;
      lines.forEach((l, i) => { if (re.test(l)) { n++; if (mode === 'content' && out.length < 500) out.push(`${path.relative(ctx.cwd, f)}:${i + 1}:${l.slice(0, 300)}`); } });
      if (n) { count += n; if (mode === 'files_with_matches') out.push(path.relative(ctx.cwd, f)); if (mode === 'count') out.push(`${path.relative(ctx.cwd, f)}:${n}`); }
    }
    return out.length ? out.join('\n') : 'No matches.';
  },
  Bash(ctx, a) { return runBash(ctx, a); },
  async TaskStop(ctx, a) { const t = tasks.get(a.task_id); if (!t) return 'No such task.'; killTree(t.child); t.status = 'stopped'; return 'Stopped ' + a.task_id; },
  async WebFetch(ctx, a) {
    const r = await fetch(a.url, { redirect: 'follow', headers: { 'User-Agent': 'CAELIX/2.0' }, signal: AbortSignal.timeout(20000) });
    const t = await r.text(); const ct = r.headers.get('content-type') || '';
    const body = /html/.test(ct) ? html2text(t) : t;
    return `HTTP ${r.status}\n` + (body.length > 30000 ? body.slice(0, 30000) + '\n[truncated]' : body);
  },
  async WebSearch(ctx, a) { return webSearch(a.query, { signal: ctx.signal }); },
  async LookAtPage(ctx, a) { return see.lookAtPage({ ...a, cwd: ctx.cwd }); },
  async TodoWrite(ctx, a) { ctx.todos = a.todos || []; ctx.emit && ctx.emit({ type: 'todos', todos: ctx.todos }); return 'Task list updated.'; },
  async AskUserQuestion(ctx, a) { const ans = await ctx.ask({ kind: 'question', question: a.question, options: a.options || [] }); return 'User answered: ' + ans; },
  async EnterPlanMode(ctx) { ctx.setMode('plan'); return 'Plan mode on: explore read-only, then call ExitPlanMode with your plan.'; },
  async ExitPlanMode(ctx, a) {
    const ans = await ctx.ask({ kind: 'plan', plan: a.plan || '' });
    if (ans === 'approve') { ctx.setMode('default'); return 'Plan approved. Plan mode is off; proceed.'; }
    return 'Plan not approved: ' + ans;
  },
  async WriteDocument(ctx, a) {
    const fmt = (a.format || (a.filename.split('.').pop() || 'md')).toLowerCase(); const base = a.filename.replace(/[\\/:*?"<>|]/g, '_').replace(/\.[A-Za-z0-9]+$/, '') || 'document';
    if (!ctx.docsDir) return 'Error: documents folder is not configured.'; fs.mkdirSync(ctx.docsDir, { recursive: true });
    if (fmt === 'pdf' || fmt === 'html') { if (!ctx.renderDocument) return 'Error: PDF export is unavailable here.'; const f = await ctx.renderDocument(path.join(ctx.docsDir, base + '.' + fmt), a.content, fmt); ctx.changed && ctx.changed(f); return `Saved ${f} (${fs.statSync(f).size} bytes)`; }
    const f = path.join(ctx.docsDir, base + '.' + (fmt === 'txt' ? 'txt' : 'md')); fs.writeFileSync(f, a.content); ctx.changed && ctx.changed(f); return `Saved ${f} (${a.content.length} characters)`;
  },
  async Agent(ctx, a) { if (!ctx.runSubagent) return 'Sub-agents unavailable.'; return ctx.runSubagent(a); },
  async Skill(ctx, a) {
    const dirs = [path.join(ctx.cwd, '.caelix', 'skills'), path.join(os.homedir(), '.caelix', 'skills')];
    for (const d of dirs) { const f = path.join(d, a.name, 'SKILL.md'); if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8'); }
    return 'Skill not found: ' + a.name;
  },
};

const CHAT_TOOLS = ['WebFetch', 'WebSearch', 'TodoWrite', 'AskUserQuestion', 'WriteDocument', 'Skill', 'Agent'];
function toolDefs(extra, { readOnly, kind } = {}) {
  let base = DEFS;
  if (kind === 'chat') base = DEFS.filter((d) => CHAT_TOOLS.includes(d.function.name));
  else if (readOnly) base = DEFS.filter((d) => ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Bash'].includes(d.function.name));
  return base.concat(extra || []);
}
module.exports = { DEFS, IMPL, MUTATING, READ_ONLY, CHAT_TOOLS, toolDefs, tasks, resolveP };
