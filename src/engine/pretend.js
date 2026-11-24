'use strict';
// The "pretend AI": a scripted model that needs no key. Used by the self-check and for offline demos.
// A user message may contain  PRETEND: [ {say?, tools?:[{name,input}]}, ... ]  -- one step per model call.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function lastUserIndex(messages) { for (let i = messages.length - 1; i >= 0; i--) { const m = messages[i]; if (m.role === 'user' && !(typeof m.content === 'string' && m.content.startsWith('[CAELIX reminder]'))) return i; } return -1; }

async function streamPretend({ messages, onText, signal }) {
  const ui = lastUserIndex(messages); const u = messages[ui];
  const text = typeof u.content === 'string' ? u.content : Array.isArray(u.content) ? u.content.filter((p) => p.type === 'text').map((p) => p.text).join(' ') : '';
  const sys0 = messages[0] && typeof messages[0].content === 'string' ? messages[0].content : '';
  if (/strict, fair code reviewer/.test(sys0)) { // reviewer role in Team mode: verdict comes from "PRETEND_REVIEW: <text>" in the request
    const rv = /PRETEND_REVIEW:\s*([A-Z ]+)/.exec(text); const say = rv ? rv[1].trim() + '\n1. Please rename the variable.' : 'APPROVED\nLooks fine.'; let out = '';
    for (const w of say.split(/(\s+)/)) { out += w; onText && onText(w); await sleep(4); }
    return { text: out, toolCalls: [], finish: 'stop', usage: { in: 10, out: 10 } };
  }
  const m = /PRETEND:\s*(\[[\s\S]*\])/.exec(text);
  const stepNo = messages.slice(ui + 1).filter((x) => x.role === 'assistant').length;
  let step;
  if (m) { let plan; try { plan = JSON.parse(m[1]); } catch (_) { plan = []; } step = plan[stepNo] || { say: 'Done.' }; }
  else step = { say: stepNo === 0 ? 'Pretend AI here. You said: ' + text.slice(0, 120) : 'Done.' };
  let out = '';
  const words = (step.say || '').split(/(\s+)/);
  for (const w of words) { if (signal && signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' }); out += w; onText && onText(w); await sleep(6); }
  const toolCalls = (step.tools || []).map((t, i) => ({ id: `pre_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}_${stepNo}_${i}`, name: t.name, args: JSON.stringify(t.input || {}) }));
  return { text: out, toolCalls, finish: toolCalls.length ? 'tool_calls' : 'stop', usage: { in: Math.ceil(text.length / 4), out: Math.ceil(out.length / 4) } };
}
module.exports = { streamPretend };
