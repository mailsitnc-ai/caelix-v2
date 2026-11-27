'use strict';
// Provider registry, model listing and streaming chat for CAELIX.
// Every provider is spoken to through the OpenAI-style chat-completions wire format.

const PROVIDERS = [
  { id: 'gemini', name: 'Google Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai', keyHint: 'AIza…', docs: 'https://aistudio.google.com/apikey' },
  { id: 'openrouter', name: 'OpenRouter', base: 'https://openrouter.ai/api/v1', keyHint: 'sk-or-…', docs: 'https://openrouter.ai/keys' },
  { id: 'nvidia', name: 'NVIDIA NIM', base: 'https://integrate.api.nvidia.com/v1', keyHint: 'nvapi-…', docs: 'https://build.nvidia.com' },
  { id: 'groq', name: 'Groq', base: 'https://api.groq.com/openai/v1', keyHint: 'gsk_…', docs: 'https://console.groq.com/keys' },
  { id: 'coarena', name: 'CoArena', base: 'https://coarena.ai/api/v1', editableBase: true, keyHint: 'key', docs: 'https://coarena.ai/account/api', note: 'Uses https://coarena.ai/. Create a key at coarena.ai/account/api.' },
  { id: 'kilo', name: 'Kilo Gateway', base: 'https://ai-gateway.kilo.ai/api/v1', keyOptional: true, anonymous: true, keyHint: 'optional', docs: 'https://kilo.ai', note: 'Built in: free models work with no key.' },
  { id: 'zen', name: 'OpenCode Zen', base: 'https://opencode.ai/zen/v1', keyOptional: true, anonymous: true, keyHint: 'optional', docs: 'https://opencode.ai/zen', note: 'Built in: free models work with no key.' },
  { id: 'axforge', name: 'AxForge', base: 'https://api.axforge.ai/v1', keyHint: 'key', docs: 'https://console.axforge.ai/keys', note: 'Free: 3M tokens per 30 days, no card. Qwen, GLM and MiMo models with vision.' },
  { id: 'runcrate', name: 'Runcrate', base: 'https://api.runcrate.ai/v1', keyHint: 'key', docs: 'https://www.runcrate.ai/dashboard/api-keys', note: 'Free weekly allowance with a GitHub sign-in (account at least 30 days old). Only the free models are listed.' },
  { id: 'zai', name: 'Z.ai (GLM)', base: 'https://api.z.ai/api/paas/v4', editableBase: true, keyHint: 'id.secret', docs: 'https://z.ai/manage-apikey/apikey-list', note: 'Free models: GLM-4.7-Flash, GLM-4.5-Flash, GLM-4.6V-Flash. Use a key made at z.ai (not bigmodel.cn) with the base https://api.z.ai/api/paas/v4. A GLM Coding Plan key needs https://api.z.ai/api/coding/paas/v4 instead.' },
  { id: 'numes', name: 'Numes', base: 'https://api.numes.ai/api/v1', keyHint: 'key', docs: 'https://numes.ai/dashboard/keys' },
  { id: 'abliteration', name: 'Abliteration AI', base: 'https://api.abliteration.ai/v1', keyHint: 'key', docs: 'https://abliteration.ai' },
  { id: 'omniroute', name: 'OmniRoute', virtual: true, base: '', editableBase: true, keyOptional: true,
    note: 'Routes across your connected providers. Optionally set the base URL of a self-hosted OmniRoute server.' },
  { id: 'pretend', name: 'Pretend AI (offline test)', virtual: true, keyOptional: true, hidden: true },
];

const OMNI_MODELS = [
  { id: 'auto', desc: 'OmniRoute router · Falls back across your connected providers' },
  { id: 'auto/coding', desc: 'OmniRoute · Coding objective' },
  { id: 'auto/fast', desc: 'OmniRoute · Speed objective' },
  { id: 'auto/cheap', desc: 'OmniRoute · Cheapest eligible first' },
  { id: 'auto/smart', desc: 'OmniRoute · Quality objective' },
];

const RUNCRATE_FREE = /^(deepseek-ai\/DeepSeek-V4\.1-Flash|zai-org\/GLM-5\.3-Flash|zai-org\/GLM-5\.3|Qwen\/Qwen3\.8-Flash|openai\/gpt-oss-120b)$/i;
const byId = (id) => PROVIDERS.find((p) => p.id === id);
const modelCache = new Map(); // providerId -> {at, models}

function baseOf(p, overrides) { return ((overrides && overrides[p.id]) || p.base || '').replace(/\/+$/, ''); }

function headers(p, key) {
  const h = { 'Content-Type': 'application/json' };
  if (key) h.Authorization = 'Bearer ' + key;
  if (p.id === 'openrouter') { h['X-Title'] = 'CAELIX'; }
  return h;
}

async function listModels(providerId, key, overrides, { force } = {}) {
  const p = byId(providerId);
  if (!p) throw new Error('Unknown provider ' + providerId);
  if (providerId === 'pretend') return [{ id: 'pretend-1', name: 'Pretend AI', provider: 'pretend', desc: 'Offline scripted model' }];
  if (providerId === 'omniroute' && !baseOf(p, overrides)) return OMNI_MODELS.map((m) => ({ id: m.id, name: m.id, provider: 'omniroute', desc: m.desc }));
  const c = modelCache.get(providerId);
  if (c && !force && Date.now() - c.at < 10 * 60 * 1000) return c.models;
  const base = baseOf(p, overrides);
  if (!base) throw new Error(p.name + ' needs a base URL (Keys screen).');
  if (p.id === 'gemini' && !key) throw new Error('Add your Gemini key on the Keys screen to load its models.');
  let models;
  if (p.id === 'gemini' && key) {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=' + encodeURIComponent(key));
    if (!r.ok) throw new Error('Gemini model list failed: HTTP ' + r.status);
    const j = await r.json();
    models = (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => ({ id: m.name.replace(/^models\//, ''), name: m.displayName || m.name, provider: p.id, desc: (m.description || '').slice(0, 120), ctx: m.inputTokenLimit }));
  } else {
    const r = await fetch(base + '/models', { headers: headers(p, key) });
    if (!r.ok) throw new Error(p.name + ' model list failed: HTTP ' + r.status + (r.status === 401 ? ' (check the key)' : ''));
    const j = await r.json();
    models = (j.data || j.models || []).map((m) => ({
      id: m.id, name: m.name || m.id, provider: p.id, desc: (m.description || '').slice(0, 120),
      ctx: m.context_length || m.context_window,
      free: m.pricing ? (Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0) : (/:free$/.test(m.id)),
    }));
  }
  if (p.id === 'zai') { models = models.filter((m) => /^glm-[\d.]+v?-flash$/i.test(m.id)); models.forEach((m) => { m.free = true; }); } // only the Flash models are free; others answer 1113 (needs balance)
  if (p.id === 'runcrate') { models = models.filter((m) => RUNCRATE_FREE.test(m.id)); models.forEach((m) => { m.free = true; }); }
  if (p.id === 'axforge') models.forEach((m) => { m.free = true; });
  archiveClaude(providerId, models); models = models.filter((m) => !isClaudeArchived(m.id));
  if (p.id === 'nvidia') models = models.filter((m) => !RE.nochat.test(m.id)); // NIM lists embedding / safety / vision-only functions that cannot chat
  models.sort((a, b) => a.id.localeCompare(b.id));
  modelCache.set(providerId, { at: Date.now(), models });
  return models;
}

// ---- streaming chat (OpenAI-compatible SSE) ----
async function streamChat({ provider, key, base, model, messages, tools, signal, onText, onThinking, maxTokens, effort }) {
  const p = byId(provider);
  const url = (base || p.base).replace(/\/+$/, '') + '/chat/completions';
  const body = { model, messages, stream: true, stream_options: { include_usage: true } };
  if (tools && tools.length) { body.tools = tools; body.tool_choice = 'auto'; }
  if (maxTokens) body.max_tokens = maxTokens; else if (provider === 'openrouter') body.max_tokens = 8192; // OpenRouter otherwise reserves the model's full output size and refuses with 402 when credits are low
  if (effort && provider === 'openrouter') body.reasoning = { effort };
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(url, { method: 'POST', headers: headers(p, key), body: JSON.stringify(body), signal });
    if (res.status === 402 && provider === 'openrouter' && attempt < 2) {
      const t402 = await res.text().catch(() => ''); const m = /afford (\d+)/.exec(t402); const can = m ? Number(m[1]) : 0;
      if (can >= 256) { body.max_tokens = Math.max(256, can - 64); continue; }
      const e = new Error(`${p.name}: HTTP 402 ${t402.slice(0, 300)}`); e.status = 402; throw e;
    }
    if (res.status === 429 && provider === 'zai') { // Z.ai answers 1113 (no balance / wrong endpoint) with HTTP 429; retrying cannot help
      const tz = await res.text().catch(() => '');
      if (/"1113"|"code":\s*1113/.test(tz)) { const e = new Error(`${p.name}: no free balance for this model or wrong endpoint (code 1113). Use a Flash model, and the base https://api.z.ai/api/paas/v4 (Coding Plan keys: https://api.z.ai/api/coding/paas/v4). ${tz.slice(0, 160)}`); e.status = 402; throw e; }
      if (attempt < 2) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
      const e = new Error(`${p.name}: HTTP 429 ${tz.slice(0, 300)}`); e.status = 429; throw e;
    }
    if (res.status === 429 && attempt < 2) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
    break;
  }
  if (!res.ok) {
    let t = ''; try { t = (await res.text()).slice(0, 400); } catch (_) {}
    const e = new Error(`${p.name}: HTTP ${res.status} ${t}`); e.status = res.status; throw e;
  }
  const out = { text: '', toolCalls: [], finish: null, usage: null };
  const calls = [];
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
  try { for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let j; try { j = JSON.parse(data); } catch (_) { continue; }
      if (j.usage) out.usage = { in: j.usage.prompt_tokens || 0, out: j.usage.completion_tokens || 0 };
      const ch = j.choices && j.choices[0]; if (!ch) continue;
      const d = ch.delta || {};
      if (d.reasoning_content || d.reasoning) onThinking && onThinking(d.reasoning_content || d.reasoning);
      if (d.content) { out.text += d.content; onText && onText(d.content); }
      for (const tc of d.tool_calls || []) {
        const k = tc.index == null ? 0 : tc.index;
        const c = calls[k] || (calls[k] = { id: '', name: '', args: '' });
        if (tc.id) c.id = tc.id;
        if (tc.function && tc.function.name) c.name += tc.function.name;
        if (tc.function && tc.function.arguments) c.args += tc.function.arguments;
      }
      if (ch.finish_reason) out.finish = ch.finish_reason;
    }
  } } finally { reader.cancel().catch(() => {}); } // also closes the connection when a reply is cut off early
  out.toolCalls = calls.filter(Boolean).map((c, n) => ({ id: c.id || 'call_' + Date.now().toString(36) + n, name: c.name, args: c.args || '{}' }));
  return out;
}

// ---- model health: remember models that cannot work so routing stops retrying them ----
const health = new Map(); // 'provider/model' -> { until, why }
let healthFile = null;
function setHealthFile(f) { healthFile = f; try { const j = JSON.parse(require('fs').readFileSync(f, 'utf8')); for (const [k, v] of Object.entries(j)) if (v && v.until > Date.now()) health.set(k, v); } catch (_) {} }
function saveHealth() { if (!healthFile) return; try { require('fs').writeFileSync(healthFile, JSON.stringify(Object.fromEntries(health))); } catch (_) {} }
const hkey = (p, m) => p + '/' + m;
function isBenched(p, m) { if (isArchived(p, m)) return true; const h = health.get(hkey(p, m)); if (!h) return false; if (h.until <= Date.now()) { health.delete(hkey(p, m)); return false; } return true; }
function bench(p, m, minutes, why) { health.set(hkey(p, m), { until: Date.now() + minutes * 60000, why }); for (const [k, v] of sticky) if (v.provider === p && v.model === m) sticky.delete(k); saveHealth(); }
function markFailed(p, m, err) {
  const s = err && err.status; const msg = String((err && err.message) || '');
  // 404 / 401 / 403 / 402 / 400: this model will not work for this account right now -> long rest. 429 / 5xx / network: short rest.
  const hard = [400, 401, 402, 403, 404, 422].includes(s) || /not found for account|no credits|insufficient/i.test(msg);
  health.set(hkey(p, m), { until: Date.now() + (hard ? 6 * 3600e3 : 4 * 60e3), why: msg.slice(0, 120) }); saveHealth();
}
// archive: models that do not work on this account. Kept until a later check finds them working again.
let archive = {}; let archiveFile = null; // { 'provider/model': { provider, id, status, verdict, detail, at } }
function setArchiveFile(f) { archiveFile = f; try { archive = JSON.parse(require('fs').readFileSync(f, 'utf8')) || {}; } catch (_) { archive = {}; } }
function saveArchive() { if (archiveFile) try { require('fs').writeFileSync(archiveFile, JSON.stringify(archive, null, 1)); } catch (_) {} }
const getArchive = () => archive;
// Claude models are archived for now (none of them work on this account). They are recorded in the
// archive so the pickers list them under ARCHIVED, and never offered or routed to. CAELIX_SHOW_CLAUDE=1 restores them.
const SHOW_CLAUDE = process.env.CAELIX_SHOW_CLAUDE === '1';
const isClaudeArchived = (m) => !SHOW_CLAUDE && /claude/i.test(String(m || ''));
function archiveClaude(providerId, models) {
  let changed = false;
  for (const m of models) {
    if (!isClaudeArchived(m.id) || archive[hkey(providerId, m.id)]) continue;
    archive[hkey(providerId, m.id)] = { provider: providerId, id: m.id, status: 0, verdict: 'Claude models are archived', detail: 'Turned off for now. Set CAELIX_SHOW_CLAUDE=1 to bring them back.', at: Date.now() };
    changed = true;
  }
  if (changed) saveArchive();
}
const isArchived = (p, m) => !!archive[hkey(p, m)] || isClaudeArchived(m);
function unarchive(p, m) { if (archive[hkey(p, m)]) { delete archive[hkey(p, m)]; saveArchive(); } }
function markOk(p, m) { unarchive(p, m); if (health.delete(hkey(p, m))) saveHealth(); }

const sticky = new Map(); // objective -> {provider, model}

// ---- probe: send a 5-token request to each model to find which ones this key can really use ----
async function probeModels(providerId, key, overrides, { onProgress, concurrency = 8 } = {}) {
  const p = byId(providerId); const models = await listModels(providerId, key, overrides, { force: true });
  const base = baseOf(p, overrides); const out = []; let i = 0, done = 0;
  async function one(m) {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 45000); let status = 0, text = '';
    try {
      const r = await fetch(base + '/chat/completions', { method: 'POST', headers: headers(p, key), body: JSON.stringify({ model: m.id, messages: [{ role: 'user', content: 'Say ok' }], max_tokens: 8, stream: false }), signal: ctl.signal });
      status = r.status; text = (await r.text()).slice(0, 300);
    } catch (e) { text = e.name === 'AbortError' ? 'timed out after 45 s' : String(e.message); }
    clearTimeout(to);
    const verdict = (p.anonymous && !key && [401, 402, 403].includes(status)) ? 'needs your own key (paid model)' : status === 200 ? 'ok' : status === 404 ? 'not available on this account' : status === 401 || status === 403 ? 'no access (key or terms)' : status === 402 ? 'needs credits' : status === 429 ? 'rate limited (inconclusive)' : status === 400 || status === 422 ? 'not a chat model / rejected request' : status ? 'error ' + status : 'no answer';
    const row = { id: m.id, status, verdict, detail: status === 200 ? '' : text.replace(/\s+/g, ' ').slice(0, 160) };
    if (status === 200) markOk(providerId, m.id); else if ([400, 401, 402, 403, 404, 422].includes(status)) markFailed(providerId, m.id, { status, message: text });
    out.push(row); done++; onProgress && onProgress(done, models.length);
  }
  await Promise.all(Array.from({ length: concurrency }, async () => { while (i < models.length) await one(models[i++]); }));
  // keep a lasting record of the ones that cannot work; skip inconclusive answers (timeouts, rate limits, overload)
  const keyBad = out.length > 3 && out.every((r) => r.status === 401 || r.status === 403);
  if (!keyBad) for (const r of out) { if (r.status === 200) unarchive(providerId, r.id); else if ([400, 402, 404, 422, 500].includes(r.status) || r.status === 401 || r.status === 403) archive[hkey(providerId, r.id)] = { provider: providerId, id: r.id, status: r.status, verdict: r.verdict, detail: r.detail, at: new Date().toISOString() }; }
  saveArchive();
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// ---- OmniRoute: pick ordered candidates by objective across connected providers ----
const RE = {
  coding: /coder|code|qwen3?-?.*(480|235|32)|deepseek|gpt-oss|kimi|glm|minimax|gemini.*pro|devstral|codestral/i,
  fast: /instant|flash|lite|mini|small|8b|haiku|turbo|nano/i,
  smart: /pro|opus|sonnet|405b|r1|gpt-5|o3|large|ultra|thinking|reason|480b|235b|70b|120b/i,
  // models that can never chat (hidden from pickers and routing)
  nochat: /nemoguard|content-safety|topic-control|retriev|reward|riva|parakeet|canary|nv-embed|nvclip|embed|rerank|\bclip\b|deplot/i,
  // vision / niche models: shown in the picker, but the automatic router never picks them
  vision: /cosmos|reason2|neva|paligemma|kosmos|fuyu|vila|-vl\b|vision/i,
  bad: /embed|rerank|whisper|tts|image|vision-only|guard|moderation|safety|audio|speech|diffusion|flux|sdxl|clip|ocr|parse/i,
};
function score(obj, m) {
  if (RE.bad.test(m.id) || RE.nochat.test(m.id) || RE.vision.test(m.id)) return -1;
  let s = 1;
  if (obj === 'coding' && RE.coding.test(m.id)) s += 5 + (/coder|codestral|devstral/i.test(m.id) ? 2 : 0);
  if (obj === 'fast' && RE.fast.test(m.id)) s += 5;
  if (obj === 'smart' && RE.smart.test(m.id)) s += 5 + (/(pro|opus|gpt-5|o3|405b|ultra)/i.test(m.id) ? 2 : 0);
  if (obj === 'cheap') s += (m.free ? 6 : 0) + (RE.fast.test(m.id) ? 2 : 0);
  if (obj === 'auto') s += (RE.smart.test(m.id) ? 2 : 0) + (RE.fast.test(m.id) ? 1 : 0);
  if (obj === 'fast' && m.provider === 'groq') s += 3;
  return s;
}
// without a key only the free models can answer (music and image models are free too, but cannot chat)
const usableWithoutKey = (m) => (m.free || /(:|-|\/)free$/i.test(m.id)) && !/lyria|imagen|veo|whisper|tts|embed/i.test(m.id);

function routeCandidates(objective, byProvider) {
  const obj = (objective || 'auto').replace(/^auto\/?/, '') || 'auto';
  const list = [];
  for (const [pid, models] of Object.entries(byProvider)) {
    if (pid === 'omniroute' || pid === 'pretend') continue;
    const ranked = models.map((m) => ({ ...m, s: score(obj, m) })).filter((m) => m.s >= 0).sort((a, b) => b.s - a.s);
    ranked.filter((m) => !isBenched(pid, m.id)).slice(0, 3).forEach((m, i) => list.push({ provider: pid, model: m.id, s: m.s - i * 0.5 - (byId(pid) && byId(pid).anonymous ? 3 : 0) }));
  }
  return list.sort((a, b) => b.s - a.s);
}

module.exports = { isClaudeArchived, setArchiveFile, getArchive, isArchived, unarchive, probeModels, setHealthFile, isBenched, bench, markFailed, markOk, sticky, PROVIDERS, OMNI_MODELS, byId, baseOf, listModels, streamChat, routeCandidates, usableWithoutKey };
