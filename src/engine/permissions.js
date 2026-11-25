'use strict';
const path = require('path');

const MODES = ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions', 'dontAsk'];
const MODE_LABEL = { default: 'Manual', acceptEdits: 'Accept edits', plan: 'Plan', auto: 'Auto', bypassPermissions: 'Bypass permissions', dontAsk: "Don't ask" };

const SAFE_BASH = /^\s*(ls|pwd|cat|head|tail|wc|echo|which|whoami|date|uname|env|printenv|file|stat|du|df|tree|grep|rg|find(?!.*(-exec|-delete))|sort|uniq|diff|git\s+(status|diff|log|show|branch|remote|rev-parse)|node\s+(-v|--version)|npm\s+(-v|--version))\b[^;&|`$()<>]*$/;
const FS_BASH = /^\s*(mkdir|touch|mv|cp)\b[^;&|`$()<>]*$/;
const DANGER = /(\brm\s+-[a-z]*r[a-z]*f?\s+(\/|~|\*)|\bsudo\b|\bmkfs\b|\bdd\s+if=|:\(\)\s*\{|curl[^|]*\|\s*(ba)?sh|>\s*\/dev\/sd|chmod\s+-R\s+777\s+\/)/;

function globRe(g) { return new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '$'); }
function wild(spec, s) { return new RegExp('^' + spec.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 's').test(s); }

function parseRule(r) { const m = /^([A-Za-z_][\w]*)(?:\((.*)\))?$/s.exec(r.trim()); return m ? { tool: m[1], spec: m[2] } : null; }

function matches(rule, tool, input, cwd) {
  const r = typeof rule === 'string' ? parseRule(rule) : rule; if (!r) return false;
  const toolOk = r.tool === tool || (r.tool.endsWith('*') && tool.startsWith(r.tool.slice(0, -1)));
  if (!toolOk) return false;
  if (r.spec == null || r.spec === '*') return true;
  if (tool === 'Bash') return wild(r.spec.replace(/:\*$/, ' *'), (input.command || '').trim());
  if (tool === 'WebFetch') { const m = /^domain:(.+)$/.exec(r.spec); if (m) { try { return new URL(input.url).hostname === m[1]; } catch (_) { return false; } } return false; }
  const p = input.file_path || input.notebook_path || input.path || '';
  if (p) { const abs = path.resolve(cwd, p); const spec = r.spec.startsWith('/') ? r.spec : path.resolve(cwd, r.spec); return globRe(spec).test(abs); }
  const pm = /^(\w+):(.*)$/.exec(r.spec); if (pm) return wild(pm[2], String(input[pm[1]] ?? ''));
  return false;
}

// returns 'allow' | 'ask' | 'deny' plus a reason
function decide({ tool, input, mode, rules, cwd }) {
  rules = rules || {};
  for (const r of rules.deny || []) if (matches(r, tool, input, cwd)) return { d: 'deny', why: 'denied by rule ' + r };
  for (const r of rules.ask || []) if (matches(r, tool, input, cwd)) return { d: 'ask', why: 'rule ' + r };
  for (const r of rules.allow || []) if (matches(r, tool, input, cwd)) return { d: 'allow', why: 'allowed by rule ' + r };
  const mut = tool === 'Write' || tool === 'Edit' || tool === 'NotebookEdit';
  const bash = tool === 'Bash' ? (input.command || '') : '';
  if (mode === 'bypassPermissions') return { d: 'allow', why: 'bypass mode' };
  if (tool === 'Bash' && DANGER.test(bash) && mode !== 'plan') return { d: mode === 'auto' || mode === 'dontAsk' ? 'deny' : 'ask', why: 'looks destructive' };
  if (mode === 'plan') {
    if (mut) return { d: 'deny', why: 'plan mode is read-only; call ExitPlanMode with your plan' };
    if (tool === 'Bash') return SAFE_BASH.test(bash) ? { d: 'allow', why: 'read-only command' } : { d: 'deny', why: 'plan mode allows only read-only commands' };
  }
  if (tool === 'ExitPlanMode') return { d: 'allow', why: 'asks the user itself' };
  if (['Read', 'Glob', 'Grep', 'TodoWrite', 'AskUserQuestion', 'EnterPlanMode', 'Skill', 'TaskStop', 'Agent', 'WriteDocument'].includes(tool)) return { d: 'allow', why: 'read-only tool' };
  // looking at a local page or localhost is read-only; other web addresses follow the web rules
  if (tool === 'LookAtPage' && !/^https?:\/\/(?!(localhost|127\.0\.0\.1|\[::1\])([:/]|$))/i.test(String(input.target || ''))) return { d: 'allow', why: 'looks at a local page' };
  if (mode === 'dontAsk') return { d: 'deny', why: "don't-ask mode allows only pre-approved tools" };
  if (mode === 'auto') return { d: 'allow', why: 'auto mode' };
  if (mode === 'acceptEdits' && (mut || (tool === 'Bash' && FS_BASH.test(bash)))) return { d: 'allow', why: 'accept-edits mode' };
  if (tool === 'Bash' && SAFE_BASH.test(bash)) return { d: 'allow', why: 'read-only command' };
  if (tool.startsWith('mcp__') || tool === 'WebFetch' || tool === 'WebSearch' || tool === 'Bash' || mut) return { d: 'ask', why: 'needs approval' };
  return { d: 'ask', why: 'needs approval' };
}

function summarize(tool, input) {
  if (tool === 'Bash') return input.command;
  if (input.file_path) return input.file_path;
  if (input.notebook_path) return input.notebook_path;
  if (input.url) return input.url;
  if (input.target) return input.target;
  if (input.query) return input.query;
  return JSON.stringify(input).slice(0, 200);
}
function ruleFor(tool, input) {
  if (tool === 'Bash') { const w = (input.command || '').trim().split(/\s+/)[0]; return `Bash(${w} *)`; }
  if (tool === 'WebFetch') { try { return `WebFetch(domain:${new URL(input.url).hostname})`; } catch (_) {} }
  return tool;
}
module.exports = { MODES, MODE_LABEL, decide, matches, summarize, ruleFor, SAFE_BASH };
