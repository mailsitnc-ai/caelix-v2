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

const estTokens = (msgs) => Math.ceil(JSON.stringify(msgs).length / 4);

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

async function callModel(rt, env, messages, tools, onText, onThinking) {
  const args = { messages, tools, signal: env.signal, onText, onThinking, effort: rt.effort };
  if (rt.provider === 'pretend') return streamPretend({ messages, onText, signal: env.signal });
  if (rt.provider === 'omniroute') {
    const c = env.getCreds('omniroute');
    if (c.base) return providers.streamChat({ ...args, provider: 'omniroute', key: c.key, base: c.base, model: rt.model });
    const connected = env.connected();
    const by = {};
    await Promise.all(connected.map(async (pid) => { try { by[pid] = await providers.listModels(pid, env.getCreds(pid).key, env.bases()); } catch (_) {} }));
    const cands = providers.routeCandidates(rt.model, by);
    if (!cands.length) throw new Error('OmniRoute has no connected providers yet. Add a key on the Keys screen.');
    let lastErr;
    const sk = providers.sticky.get(rt.model);
    if (sk) { const i = cands.findIndex((x) => x.provider === sk.provider && x.model === sk.model); if (i > 0) cands.unshift(...cands.splice(i, 1)); }
    for (const cand of cands.slice(0, 8)) {
      const cr = env.getCreds(cand.provider);
      env.emit({ type: 'route', provider: cand.provider, model: cand.model });
      try {
        let started = false;
        const out = await providers.streamChat({ ...args, onText: (t) => { started = true; onText && onText(t); }, provider: cand.provider, key: cr.key, base: cr.base, model: cand.model });
        providers.markOk(cand.provider, cand.model); providers.sticky.set(rt.model, { provider: cand.provider, model: cand.model }); return out;
      } catch (e) { if (e.name === 'AbortError' || started) throw e; lastErr = e; providers.markFailed(cand.provider, cand.model, e); env.emit({ type: 'route_fail', provider: cand.provider, model: cand.model, error: String(e.message).slice(0, 160) }); }
    }
    throw lastErr || new Error('OmniRoute failed');
  }
  const p = providers.byId(rt.provider); const c = env.getCreds(rt.provider);
  if (!c.key && !p.keyOptional) throw new Error(`No key for ${p.name}. Open Keys and paste one.`);
  return providers.streamChat({ ...args, provider: rt.provider, key: c.key, base: c.base, model: rt.model });
}

async function summarise(rt, env, msgs) {
  const transcript = msgs.map((m) => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content || m.tool_calls || '')}`).join('\n').slice(0, 120000);
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
  for (const m of messages) { const n = Math.ceil(JSON.stringify(m).length / 4); if (m.role === 'system') sys += n; else if (m.role === 'tool') tool += n; else msg += n; }
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

async function runTurn(rt, env, userText) {
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
  rt.messages.push({ role: 'user', content: userText + ((ups.outputs || []).length ? '\n\n' + ups.outputs.join('\n') : '') });
  env.emit({ type: 'turn_start', turn: rt.turn });
  try {
    await loop(rt, env, { messages: rt.messages, tools: toolDefs(rt.mcp && rt.mcp.defs, { kind: rt.kind }), depth: 0 });
    env.emit({ type: 'turn_end', ok: true });
  } catch (e) {
    if (e.name === 'AbortError') env.emit({ type: 'turn_end', ok: false, aborted: true });
    else { env.emit({ type: 'error', message: String(e.message || e) }); env.emit({ type: 'turn_end', ok: false }); }
  }
  config.runHooks(env.settings, 'Stop', {}, st.cwd);
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

module.exports = { runTurn, compact, resetContext, breakdown, rewind, buildSystem, estTokens };
