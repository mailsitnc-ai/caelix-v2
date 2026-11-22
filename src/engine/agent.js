'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const providers = require('./providers');
const { streamPretend } = require('./pretend');
const { IMPL, DEFS, READ_ONLY, CHAT_TOOLS, toolDefs } = require('./tools');
const { decide, summarize, ruleFor, SAFE_BASH } = require('./permissions');
const config = require('./config');
const { globalMemoryText } = require('./builtin');

// images count as about 1,500 tokens each instead of their (huge) base64 text
const IMG_PAD = 'x'.repeat(6000);
const strip = (k, v) => (k === 'url' && typeof v === 'string' && v.startsWith('data:') ? IMG_PAD : v);
const estTokens = (msgs) => Math.ceil(JSON.stringify(msgs, strip).length / 4);
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => (p.type === 'text' ? p.text : '[image]')).join(' ') : c == null ? '' : JSON.stringify(c));
// only the two most recent image-carrying messages keep their pictures; older ones become a short note
function prepareMessages(msgs) {
  const idx = []; msgs.forEach((m, i) => { if (Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url')) idx.push(i); });
  const keep = new Set(idx.slice(-2)); if (keep.size === idx.length) return msgs;
  return msgs.map((m, i) => (idx.includes(i) && !keep.has(i) ? { ...m, content: m.content.map((p) => (p.type === 'image_url' ? { type: 'text', text: '[earlier image omitted]' } : p)) } : m));
}

function buildSystem(rt, env) {
  const chat = rt.kind === 'chat';
  const mem = chat ? '' : config.loadMemory(env.userDir, rt.st.cwd);
  const gm = globalMemoryText(env.userDir);
  const lines = chat ? [
    'You are CAELIX in Chat mode: a helpful, direct assistant. There is no project folder in this mode and you cannot read or change the user\'s files or run shell commands.',
    'You can browse the web, keep a checklist, ask the user a question, use saved memory, and create documents (md, txt, html, pdf) with WriteDocument; they are saved in the user\'s CAELIX Chats folder.',
    'If the user wants code changed in a project, tell them to switch to Code mode and open the folder.',
    `Date: ${new Date().toISOString().slice(0, 10)}`,
  ] : [
    'You are CAELIX in Code mode, a coding agent running on the user\'s computer. You work inside the project folder using tools.',
    'Be direct and brief. Read before you edit. Prefer small exact edits. Run independent tool calls together in one reply.',
    'Never claim something works unless a tool result shows it. When a task needs several steps, keep a checklist with TodoWrite.',
    `Working directory: ${rt.st.cwd}`, `Platform: ${process.platform} (${os.release()})`, `Date: ${new Date().toISOString().slice(0, 10)}`,
    `Permission mode: ${rt.st.mode}. In plan mode you may only read; present a plan with ExitPlanMode.`,
  ];
  if (rt.team) lines.push('Team mode is on: split independent parts of the work across sub-agents (Agent tool) and combine their reports.');
  if (gm) lines.push('\nSaved memories (all chats):\n' + gm);
  if (mem) lines.push('\nProject memory:\n' + mem);
  if (rt.summary) lines.push('\nSummary of the conversation before the last reset:\n' + rt.summary);
  return lines.join('\n');
}

// OmniRoute order: whichever objective was chosen, a failure rolls on to the next one (wrapping around) until a model answers.
const OMNI_CHAIN = ['auto', 'auto/coding', 'auto/smart', 'auto/fast', 'auto/cheap'];
function omniChain(first) { const at = OMNI_CHAIN.indexOf(first); return at < 0 ? [first, ...OMNI_CHAIN] : [first, ...OMNI_CHAIN.slice(at + 1), ...OMNI_CHAIN.slice(0, at)]; }

async function routeAcross(objective, env, args, onText) {
  const by = {};
  await Promise.all(env.connected().map(async (pid) => { try { by[pid] = await providers.listModels(pid, env.getCreds(pid).key, env.bases()); } catch (_) {} }));
  let lastErr; let attempts = 0; const tried = new Set();
  for (const obj of omniChain(objective)) {
    const cands = providers.routeCandidates(obj, by);
    const sk = providers.sticky.get(obj); if (sk) { const i = cands.findIndex((x) => x.provider === sk.provider && x.model === sk.model); if (i > 0) cands.unshift(...cands.splice(i, 1)); }
    for (const cand of cands.slice(0, 8)) {
      const key = cand.provider + '/' + cand.model; if (tried.has(key)) continue; tried.add(key);
      if (++attempts > 16) break;
      const cr = env.getCreds(cand.provider);
      env.emit({ type: 'route', provider: cand.provider, model: cand.model });
      let started = false;
      try {
        const out = await providers.streamChat({ ...args, onText: (t) => { started = true; onText && onText(t); }, provider: cand.provider, key: cr.key, base: cr.base, model: cand.model });
        providers.markOk(cand.provider, cand.model); providers.sticky.set(obj, { provider: cand.provider, model: cand.model }); return out;
      } catch (e) { if (e.name === 'AbortError' || started) throw e; lastErr = e; providers.markFailed(cand.provider, cand.model, e); env.emit({ type: 'route_fail', provider: cand.provider, model: cand.model, error: String(e.message).slice(0, 160) }); }
    }
  }
  if (!attempts) throw new Error('OmniRoute has no connected providers yet. Add a key on the Keys screen.');
  throw lastErr || new Error('OmniRoute failed');
}

async function callModel(rt, env, messages, tools, onText, onThinking) {
  messages = prepareMessages(messages);
  const args = { messages, tools, signal: env.signal, onText, onThinking, effort: rt.effort };
  if (rt.provider === 'pretend') return streamPretend({ messages, onText, signal: env.signal });
  // A chat still set to an archived (Claude) model is routed like OmniRoute's coding objective instead of failing.
  if (rt.provider !== 'omniroute' && providers.isClaudeArchived(rt.model)) {
    env.emit({ type: 'route_note', message: 'Claude models are archived; routing this turn automatically.' });
    return routeAcross('auto/coding', env, args, onText);
  }
  if (rt.provider === 'omniroute') {
    const c = env.getCreds('omniroute');
    if (c.base) { // a self-hosted OmniRoute: use it first, and keep going through the connected providers if it fails
      let started = false;
      try { return await providers.streamChat({ ...args, onText: (t) => { started = true; onText && onText(t); }, provider: 'omniroute', key: c.key, base: c.base, model: rt.model }); }
      catch (e) { if (e.name === 'AbortError' || started || !env.connected().length) throw e; env.emit({ type: 'route_fail', provider: 'omniroute', model: rt.model, error: String(e.message).slice(0, 160) }); }
    }
    return routeAcross(rt.model, env, args, onText);
  }
  const p = providers.byId(rt.provider); const c = env.getCreds(rt.provider);
  if (!c.key && !p.keyOptional) throw new Error(`No key for ${p.name}. Open Keys and paste one.`);
  return providers.streamChat({ ...args, provider: rt.provider, key: c.key, base: c.base, model: rt.model });
}

async function summarise(rt, env, msgs) {
  const transcript = msgs.map((m) => `${m.role}: ${m.content ? textOf(m.content) : JSON.stringify(m.tool_calls || '')}`).join('\n').slice(0, 120000);
  let summary = '';
  try { const r = await callModel(rt, env, [{ role: 'system', content: 'Summarise the conversation so far for an assistant that will continue the work. Keep decisions, facts about the user, file paths, open tasks and errors. Be concise but complete.' }, { role: 'user', content: transcript }], null); summary = r.text.trim(); } catch (_) {}
  return summary || 'Earlier conversation (' + msgs.length + ' messages) was trimmed to save space.';
}
// /compact: summarise older messages, keep the last few
async function compact(rt, env, why) {
  const msgs = rt.messages; if (msgs.length < 8) return false;
  const keep = msgs.slice(-4); const old = msgs.slice(1, -4); const summary = await summarise(rt, env, old);
  rt.messages = [msgs[0], { role: 'user', content: 'Summary of the earlier conversation:\n' + summary }, { role: 'assistant', content: 'Understood. Continuing from that summary.' }, ...keep];
  env.emit({ type: 'compacted', why: why || 'compact', before: msgs.length, after: rt.messages.length }); return true;
}
// /reset and auto-reset at 80%: summarise everything, drop the history, keep memory + the summary; token count returns to baseline
async function resetContext(rt, env, why) {
  const msgs = rt.messages; if (msgs.length < 2) return false;
  const before = estTokens(msgs); const summary = await summarise(rt, env, msgs.slice(1));
  rt.summary = (rt.summary ? rt.summary + '\n' : '') + summary; rt.summary = rt.summary.slice(-12000);
  rt.messages = [{ role: 'system', content: buildSystem(rt, env) }]; rt.checkpoints = rt.checkpoints.map((c) => ({ ...c, msgIndex: 1 }));
  env.emit({ type: 'reset', why: why || 'manual', before, after: estTokens(rt.messages) }); return true;
}
function breakdown(messages) {
  let sys = 0, msg = 0, tool = 0;
  for (const m of messages) { const n = Math.ceil(JSON.stringify(m, strip).length / 4); if (m.role === 'system') sys += n; else if (m.role === 'tool') tool += n; else msg += n; }
  return { system: sys, messages: msg, tools: tool, total: sys + msg + tool, active: messages.length - (messages[0] && messages[0].role === 'system' ? 1 : 0) };
}

async function loop(rt, env, { messages, tools, depth, readOnly }) {
  const st = rt.st; let final = '';
  for (let iter = 0; iter < 60; iter++) {
    if (env.signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    if (depth === 0) {
      const limit = rt.ctxLimit || 2000000;
      if (estTokens(messages) > limit * 0.8) await resetContext(rt, env, 'auto');
      messages = rt.messages;
    }
    const msgId = 'm' + Date.now().toString(36) + iter; let started = false;
    const r = await callModel(rt, env, messages, tools, (t) => { if (depth === 0) { if (!started) { started = true; env.emit({ type: 'text_start', id: msgId }); } env.emit({ type: 'text', id: msgId, delta: t }); } },
      (t) => depth === 0 && env.emit({ type: 'thinking', delta: t }));
    if (r.usage) { rt.usage.in += r.usage.in; rt.usage.out += r.usage.out; }
    messages.push({ role: 'assistant', content: r.text || null, ...(r.toolCalls.length ? { tool_calls: r.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args } })) } : {}) });
    if (depth === 0) { env.emit({ type: 'text_end', id: msgId }); env.emit({ type: 'context', used: estTokens(messages), limit: rt.ctxLimit || 2000000, usage: rt.usage, breakdown: breakdown(messages) }); }
    if (!r.toolCalls.length) { final = r.text; break; }
    // 1) decide permissions sequentially (prompts are shown one at a time)
    const plan = [];
    for (const c of r.toolCalls) {
      let input; try { input = JSON.parse(c.args || '{}'); } catch (_) { plan.push({ c, err: 'Error: tool arguments were not valid JSON.' }); continue; }
      if (readOnly && !['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Bash'].includes(c.name)) { plan.push({ c, input, err: 'Error: this sub-agent is read-only.' }); continue; }
      if (depth === 0) env.emit({ type: 'tool_start', id: c.id, name: c.name, input, summary: summarize(c.name, input) });
      const pre = await config.runHooks(env.settings, 'PreToolUse', { tool_name: c.name, tool_input: input }, st.cwd, c.name);
      if (pre.blocked) { plan.push({ c, input, err: 'Blocked by hook: ' + pre.reason }); continue; }
      const dec = decide({ tool: c.name, input, mode: st.mode, rules: env.settings.permissions, cwd: st.cwd });
      if (dec.d === 'deny') { plan.push({ c, input, err: 'Permission denied: ' + dec.why }); continue; }
      if (dec.d === 'ask') {
        if (depth > 0) { plan.push({ c, input, err: 'Permission needed but sub-agents cannot ask.' }); continue; }
        const ans = await env.ask({ kind: 'permission', tool: c.name, input, summary: summarize(c.name, input), rule: ruleFor(c.name, input) });
        if (ans.decision === 'deny') { plan.push({ c, input, err: 'The user denied this action' + (ans.comment ? ': ' + ans.comment : '.') }); continue; }
        if (ans.decision === 'always') { try { config.addLocalAllowRule(st.cwd, ruleFor(c.name, input)); env.settings.permissions.allow.push(ruleFor(c.name, input)); } catch (_) {} }
      }
      plan.push({ c, input });
    }
    // 2) run: read-only tools together, mutating ones in order
    const results = new Map();
    const run = async (p) => {
      const t0 = Date.now(); let out; let isErr = false;
      try {
        if (p.err) { out = p.err; isErr = true; }
        else if (rt.mcp && rt.mcp.route[p.c.name]) { const rr = rt.mcp.route[p.c.name]; out = await rr.server.call(rr.tool, p.input); }
        else if (rt.kind === 'chat' && !CHAT_TOOLS.includes(p.c.name)) { out = 'Error: this tool is not available in Chat mode.'; isErr = true; }
        else if (IMPL[p.c.name]) { st.signal = env.signal; out = await IMPL[p.c.name](st, p.input); if (/^Error/.test(String(out))) isErr = true; }
        else { out = 'Error: unknown tool ' + p.c.name; isErr = true; }
      } catch (e) { out = 'Error: ' + e.message; isErr = true; }
      out = String(out); if (out.length > 60000) out = out.slice(0, 60000) + '\n[truncated]';
      if (!p.err) config.runHooks(env.settings, 'PostToolUse', { tool_name: p.c.name, tool_input: p.input, tool_output: out.slice(0, 2000) }, st.cwd, p.c.name);
      results.set(p.c.id, out);
      if (depth === 0) env.emit({ type: 'tool_result', id: p.c.id, name: p.c.name, output: out.length > 4000 ? out.slice(0, 4000) + '\n…' : out, error: isErr, ms: Date.now() - t0 });
    };
    const indep = (p) => p.err || READ_ONLY.has(p.c.name) || p.c.name === 'Agent' || (p.c.name === 'Bash' && p.input && (p.input.run_in_background || SAFE_BASH.test(p.input.command || '')));
    const ro = plan.filter(indep);
    const mu = plan.filter((p) => !ro.includes(p));
    await Promise.all(ro.map(run));
    for (const p of mu) { if (env.signal.aborted) break; await run(p); }
    for (const c of r.toolCalls) messages.push({ role: 'tool', tool_call_id: c.id, content: results.get(c.id) || 'Cancelled.' });
    if (depth === 0) env.emit({ type: 'mode', mode: st.mode });
  }
  return final;
}

async function runTurn(rt, env, userText, images) {
  const st = rt.st;
  Object.assign(st, {
    emit: env.emit, ask: env.ask, signal: env.signal, docsDir: env.docsDir, renderDocument: env.renderDocument, setMode: (m) => { st.mode = m; env.emit({ type: 'mode', mode: m }); },
    setCwd: (d) => { st.cwd = d; env.emit({ type: 'cwd', cwd: d }); },
    onBeforeWrite: (f) => { if (!rt.turnSnap.has(f)) rt.turnSnap.set(f, fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null); if (!rt.baseSnap.has(f)) rt.baseSnap.set(f, fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null); },
    changed: (f) => env.emit({ type: 'file_changed', file: f }),
    onBgStart: (t) => env.emit({ type: 'bg_start', id: t.id, command: t.command }), onBgDone: (id, code) => env.emit({ type: 'bg_done', id, code }),
    runSubagent: async (a) => {
      env.emit({ type: 'subagent', phase: 'start', description: a.description || a.prompt.slice(0, 60) });
      const ro = (a.subagent_type || 'explore').toLowerCase().startsWith('explore');
      const msgs = [{ role: 'system', content: buildSystem(rt, env) + '\nYou are a sub-agent. Do the task and finish with a concise report.' }, { role: 'user', content: a.prompt }];
      const out = await loop(rt, env, { messages: msgs, tools: toolDefs(rt.mcp && rt.mcp.defs, { readOnly: ro }), depth: 1, readOnly: ro });
      env.emit({ type: 'subagent', phase: 'end', description: a.description || '' }); return out || '(no report)';
    },
  });
  rt.turnSnap = new Map(); rt.turn = (rt.turn || 0) + 1;
  const ups = await config.runHooks(env.settings, 'UserPromptSubmit', { prompt: userText }, st.cwd);
  if (ups.blocked) { env.emit({ type: 'error', message: 'Prompt blocked by hook: ' + ups.reason }); return; }
  if (!rt.messages.length) rt.messages.push({ role: 'system', content: buildSystem(rt, env) }); else rt.messages[0] = { role: 'system', content: buildSystem(rt, env) };
  rt.checkpoints.push({ turn: rt.turn, msgIndex: rt.messages.length, prompt: userText.slice(0, 80), snap: rt.turnSnap });
  const fullText = userText + ((ups.outputs || []).length ? '\n\n' + ups.outputs.join('\n') : '');
  rt.messages.push({ role: 'user', content: images && images.length ? [{ type: 'text', text: fullText || 'Look at the attached image.' }, ...images.map((u) => ({ type: 'image_url', image_url: { url: u } }))] : fullText });
  env.emit({ type: 'turn_start', turn: rt.turn });
  const mainSel = { provider: rt.provider, model: rt.model };
  const teamOn = rt.kind === 'code' && rt.team && rt.coder && rt.coder.model;
  if (teamOn) { rt.provider = rt.coder.provider; rt.model = rt.coder.model; env.emit({ type: 'info', text: `Team: coder is ${rt.coder.provider} / ${rt.coder.model}` }); }
  try {
    const tools = toolDefs(rt.mcp && rt.mcp.defs, { kind: rt.kind });
    const reply = await loop(rt, env, { messages: rt.messages, tools, depth: 0 });
    if (rt.kind === 'code' && rt.team && rt.reviewer && rt.reviewer.model && rt.turnSnap.size) {
      const verdict = await reviewPass(rt, env, userText, reply);
      if (verdict && verdict.changes && !env.signal.aborted) {
        rt.messages.push({ role: 'user', content: 'A separate reviewer checked your work and asked for these changes. Make them now, then finish with a short note:\n\n' + verdict.text });
        await loop(rt, env, { messages: rt.messages, tools, depth: 0 });
      }
    }
    env.emit({ type: 'turn_end', ok: true });
  } catch (e) {
    if (e.name === 'AbortError') env.emit({ type: 'turn_end', ok: false, aborted: true });
    else { env.emit({ type: 'error', message: String(e.message || e) }); env.emit({ type: 'turn_end', ok: false }); }
  } finally { if (teamOn) { rt.provider = mainSel.provider; rt.model = mainSel.model; } }
  config.runHooks(env.settings, 'Stop', {}, st.cwd);
}

// Team mode: a second model reviews what the coder changed. Returns { text, changes }.
async function reviewPass(rt, env, userText, coderReply) {
  const files = []; let budget = 24000;
  for (const [f, before] of rt.turnSnap) {
    let now = null; try { now = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; } catch (_) {}
    const body = now === null ? '(deleted)' : now.slice(0, Math.min(6000, budget)); budget -= body.length;
    files.push(`### ${f} (${before === null ? 'new file' : now === null ? 'deleted' : 'modified'})\n${body}${now && now.length > body.length ? '\n…(truncated)' : ''}`);
    if (budget <= 0) break;
  }
  const sys = 'You are a strict, fair code reviewer. You are given a request, the coder\'s final message and the files the coder changed. Look for bugs, missed requirements, broken edge cases and security problems. Start your reply with exactly APPROVED or CHANGES NEEDED on the first line. If changes are needed, list them as short numbered points with the file and what to fix. Keep it brief.';
  const user = `REQUEST:\n${userText}\n\nCODER'S FINAL MESSAGE:\n${(coderReply || '').slice(0, 3000)}\n\nCHANGED FILES:\n${files.join('\n\n')}`;
  const r = { ...rt, provider: rt.reviewer.provider, model: rt.reviewer.model };
  const id = 'rv' + Date.now().toString(36); let text = ''; let started = false;
  env.emit({ type: 'info', text: `Team: reviewer is ${r.provider} / ${r.model}` });
  try {
    const out = await callModel(r, env, [{ role: 'system', content: sys }, { role: 'user', content: user }], [], (t) => {
      if (!started) { started = true; env.emit({ type: 'text_start', id }); env.emit({ type: 'text', id, delta: `**Reviewer (${r.model})**\n\n` }); }
      text += t; env.emit({ type: 'text', id, delta: t });
    }, () => {});
    if (!started) { env.emit({ type: 'text_start', id }); env.emit({ type: 'text', id, delta: `**Reviewer (${r.model})**\n\n${out.text || ''}` }); text = out.text || ''; }
    env.emit({ type: 'text_end', id });
  } catch (e) { if (e.name === 'AbortError') throw e; env.emit({ type: 'error', message: 'Reviewer failed: ' + String(e.message).slice(0, 200) }); return null; }
  return { text, changes: /^\s*CHANGES NEEDED/i.test(text) };
}

// short chat title from the first exchange (used when the user has not named the chat)
const cleanTitle = (s) => String(s || '').replace(/^["'`*#\s]+|["'`*.\s]+$/g, '').replace(/^title\s*:\s*/i, '').replace(/\s+/g, ' ').slice(0, 48);
function fallbackTitle(text) {
  const t = String(text || '').replace(/\s+/g, ' ').replace(/^(please|can you|could you|help me|i want to|i need to)\s+/i, '').trim(); if (!t) return 'New chat';
  const w = t.split(' ').slice(0, 7).join(' '); return cleanTitle(w.charAt(0).toUpperCase() + w.slice(1));
}
async function makeTitle(rt, env, userText, reply) {
  if (rt.provider === 'pretend') return fallbackTitle(userText);
  try {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 20000);
    const out = await callModel({ ...rt, effort: undefined }, { ...env, signal: ctl.signal, emit: () => {} }, [
      { role: 'system', content: 'You name chats. Reply with only a title of 2 to 5 words that describes the conversation. No quotes, no punctuation at the end, no explanation.' },
      { role: 'user', content: `First message:\n${String(userText).slice(0, 600)}\n\nStart of the reply:\n${String(reply || '').slice(0, 500)}` }], [], () => {}, () => {});
    clearTimeout(to); const t = cleanTitle(out.text); return t.length >= 3 ? t : fallbackTitle(userText);
  } catch (_) { return fallbackTitle(userText); }
}

// restore files (and optionally conversation) to before the given turn
function rewind(rt, turn, { code, conversation }) {
  const idx = rt.checkpoints.findIndex((c) => c.turn === turn); if (idx < 0) return { ok: false, error: 'No such checkpoint' };
  const restored = [];
  if (code) {
    for (let i = rt.checkpoints.length - 1; i >= idx; i--) for (const [f, content] of rt.checkpoints[i].snap) {
      try { if (content === null) { if (fs.existsSync(f)) fs.unlinkSync(f); } else fs.writeFileSync(f, content); restored.push(f); } catch (_) {}
    }
  }
  if (conversation) { rt.messages = rt.messages.slice(0, rt.checkpoints[idx].msgIndex); rt.checkpoints = rt.checkpoints.slice(0, idx); }
  return { ok: true, restored: Array.from(new Set(restored)) };
}

module.exports = { callModel, routeAcross, omniChain, makeTitle, fallbackTitle, textOf, runTurn, compact, resetContext, breakdown, rewind, buildSystem, estTokens };
