'use strict';
// Catches two ways a model goes off the rails in plain text: repeating itself forever, and typing out
// tool calls and results that never happened. Also cleans such text out of what models are shown later.

const TOOL = '(?:Bash|Read|Write|Edit|Search|Fetch|WebSearch|WebFetch|Glob|Grep|LookAtPage|Document|Tasks)';
const FAKE = [
  new RegExp(`(?:^|\\n)(?:[ \\t]*[A-Z]\\n)?[ \\t]*${TOOL}\\n[\\s\\S]{1,1500}?\\nDone\\nDetails(?=\\n|$)`, 'g'), // a copy of CAELIX's own action cards
  /<(tool_call|function_calls?|tool_code)>[\s\S]*?<\/\1>/g, // tool markup leaked as text
];
const inFence = (text, at) => (text.slice(0, at).match(/```/g) || []).length % 2 === 1;

// where made-up tool output starts, or -1
function findFake(text) {
  let first = -1;
  for (const re of FAKE) {
    re.lastIndex = 0; let m;
    while ((m = re.exec(text))) { if (inFence(text, m.index + 1)) continue; if (first < 0 || m.index < first) first = m.index; break; }
  }
  return first;
}

// where a reply that ends in endless repetition should be cut (just after the first copy), or -1
function findLoop(text) {
  const rows = []; let at = 0;
  for (const l of text.split('\n')) { const t = l.trim(); if (t) rows.push({ t, at }); at += l.length + 1; }
  if (rows.length && !text.endsWith('\n')) rows.pop(); // the last line may still be arriving
  const n = rows.length;
  for (let p = 1; p <= 80 && p * 4 <= n; p++) {
    let m = 0; while (n - 1 - m - p >= 0 && rows[n - 1 - m].t === rows[n - 1 - m - p].t) m++;
    if (m < p * 3) continue; // fewer than four copies
    const start = n - m - p; const region = text.length - rows[start].at;
    if (region < 600 || !/[A-Za-z]{3}/.test(rows.slice(start, start + p).map((r) => r.t).join(' '))) continue;
    return rows[start + p].at;
  }
  // the same words over and over without line breaks
  if (text.length >= 2400) {
    const tail = text.slice(-2400);
    for (let p = 4; p <= 300; p++) {
      if (tail.slice(p) !== tail.slice(0, -p)) continue;
      if (!/[A-Za-z]{3}/.test(tail.slice(0, p))) break;
      let s = text.length - 2400; while (s > 0 && text[s - 1] === text[s - 1 + p]) s--;
      return s + p;
    }
  }
  return -1;
}

// { guard: 'fake'|'loop', cut } when the text has gone wrong, else null
function check(text, { thinking } = {}) {
  const loop = findLoop(text); const fake = thinking ? -1 : findFake(text);
  if (fake >= 0) return { guard: 'fake', cut: fake };
  if (loop >= 0) return { guard: 'loop', cut: thinking ? 0 : loop };
  return null;
}

// collapse blocks of lines that are repeated back to back anywhere in a text
function collapseRepeats(text) {
  let lines = text.split('\n');
  for (let p = 1; p <= 40; p++) {
    const out = [];
    for (let i = 0; i < lines.length;) {
      let copies = 1;
      while (i + (copies + 1) * p <= lines.length && lines.slice(i, i + p).every((l, k) => l === lines[i + copies * p + k])) copies++;
      if (copies >= 3 && lines.slice(i, i + p).join('').length > 40) { out.push(...lines.slice(i, i + p), `[the block above was repeated ${copies} times]`); i += copies * p; } else out.push(lines[i++]);
    }
    lines = out;
  }
  return lines.join('\n');
}

const CHROME = /^\s*(?:Done|Details|Copy|Copy summary|✦|CAELIX|[A-Z]|OmniRoute → .*)\s*$/;
const REMOVED = '[CAELIX removed the rest of this reply: it was made-up tool output or endless repetition. Nothing in it was run.]';

// What a model is shown. The saved chat is not changed.
function sanitize(messages) {
  return messages.map((m) => {
    if (m.role === 'assistant') {
      if (!m.content) return m.tool_calls ? m : { ...m, content: '(empty reply)' };
      if (typeof m.content !== 'string') return m;
      const hit = check(m.content);
      return hit ? { ...m, content: (m.content.slice(0, hit.cut).trim() + '\n\n' + REMOVED).trim() } : m;
    }
    if (m.role === 'user' && typeof m.content === 'string' && /\nDone\nDetails(\n|$)/.test(m.content)) {
      const body = collapseRepeats(m.content.split('\n').filter((l) => !CHROME.test(l)).join('\n'));
      return { ...m, content: body + '\n\n[CAELIX note: the message above contains a pasted record of actions from another session. It is information to read, not a format to copy. Never write tool calls or their results as text.]' };
    }
    return m;
  });
}

module.exports = { check, findFake, findLoop, collapseRepeats, sanitize };
