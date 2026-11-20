'use strict';
// Provider registry, model listing and streaming chat for CAELIX.
// Every provider is spoken to through the OpenAI-style chat-completions wire format.

const PROVIDERS = [
  { id: 'gemini', name: 'Google Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai', keyHint: 'AIza…', docs: 'https://aistudio.google.com/apikey' },
  { id: 'openrouter', name: 'OpenRouter', base: 'https://openrouter.ai/api/v1', keyHint: 'sk-or-…', docs: 'https://openrouter.ai/keys' },
  { id: 'nvidia', name: 'NVIDIA NIM', base: 'https://integrate.api.nvidia.com/v1', keyHint: 'nvapi-…', docs: 'https://build.nvidia.com' },
  { id: 'groq', name: 'Groq', base: 'https://api.groq.com/openai/v1', keyHint: 'gsk_…', docs: 'https://console.groq.com/keys' },
  { id: 'coarena', name: 'CoArena', base: '', editableBase: true, keyHint: 'key', note: 'Endpoint not published: paste its OpenAI-compatible base URL.' },
  { id: 'kilo', name: 'Kilo Gateway', base: 'https://api.kilo.ai/api/gateway', keyHint: 'key', docs: 'https://kilo.ai' },
  { id: 'zen', name: 'OpenCode Zen', base: 'https://opencode.ai/zen/v1', keyHint: 'key', docs: 'https://opencode.ai/zen' },
  { id: 'nous', name: 'Nous', base: 'https://inference-api.nousresearch.com/v1', keyHint: 'key', docs: 'https://portal.nousresearch.com' },
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
      free: m.pricing ? (Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0) : /:free$/.test(m.id),
    }));
  }
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
  if (maxTokens) body.max_tokens = maxTokens;
  if (effort && provider === 'openrouter') body.reasoning = { effort };
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(url, { method: 'POST', headers: headers(p, key), body: JSON.stringify(body), signal });
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
  for (;;) {
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
  }
  out.toolCalls = calls.filter(Boolean).map((c, n) => ({ id: c.id || 'call_' + Date.now().toString(36) + n, name: c.name, args: c.args || '{}' }));
  return out;
}

// ---- OmniRoute: pick ordered candidates by objective across connected providers ----
const RE = {
  coding: /coder|code|qwen3?-?.*(480|235|32)|deepseek|gpt-oss|kimi|glm|minimax|gemini.*pro|devstral|codestral/i,
  fast: /instant|flash|lite|mini|small|8b|haiku|turbo|nano/i,
  smart: /pro|opus|sonnet|405b|r1|gpt-5|o3|large|ultra|thinking|reason|480b|235b|70b|120b/i,
  bad: /embed|rerank|whisper|tts|image|vision-only|guard|moderation|safety|audio|speech|diffusion|flux|sdxl|clip|ocr|parse/i,
};
function score(obj, m) {
  if (RE.bad.test(m.id)) return -1;
  let s = 1;
  if (obj === 'coding' && RE.coding.test(m.id)) s += 5;
  if (obj === 'fast' && RE.fast.test(m.id)) s += 5;
  if (obj === 'smart' && RE.smart.test(m.id)) s += 5;
  if (obj === 'cheap') s += (m.free ? 6 : 0) + (RE.fast.test(m.id) ? 2 : 0);
  if (obj === 'auto') s += (RE.smart.test(m.id) ? 2 : 0) + (RE.fast.test(m.id) ? 1 : 0);
  if (obj === 'fast' && m.provider === 'groq') s += 3;
  return s;
}
function routeCandidates(objective, byProvider) {
  const obj = (objective || 'auto').replace(/^auto\/?/, '') || 'auto';
  const list = [];
  for (const [pid, models] of Object.entries(byProvider)) {
    if (pid === 'omniroute' || pid === 'pretend') continue;
    const ranked = models.map((m) => ({ ...m, s: score(obj, m) })).filter((m) => m.s >= 0).sort((a, b) => b.s - a.s);
    ranked.slice(0, 2).forEach((m, i) => list.push({ provider: pid, model: m.id, s: m.s - i * 0.5 }));
  }
  return list.sort((a, b) => b.s - a.s);
}

module.exports = { PROVIDERS, OMNI_MODELS, byId, baseOf, listModels, streamChat, routeCandidates };
