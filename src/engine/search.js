'use strict';
// Web search with no API key. Search sites often answer scripts with a bot check, so several routes are tried in turn:
// a plain request, then a real (hidden) browser window on three engines, then two simple feeds as a last resort.
const UA = 'Mozilla/5.0 CAELIX';
const MAX = 8;

const text = (h) => String(h || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// Search engines wrap result links in their own redirect; give back the real address.
function realUrl(u) {
  try {
    const url = new URL(u, 'https://duckduckgo.com');
    const dd = url.searchParams.get('uddg'); if (dd) return dd;
    if (/(^|\.)bing\.com$/.test(url.hostname) && url.pathname.startsWith('/ck/')) { const b = url.searchParams.get('u'); if (b && b.startsWith('a1')) return Buffer.from(b.slice(2), 'base64url').toString('utf8'); }
    return url.href;
  } catch (_) { return u; }
}
const isAd = (u) => /duckduckgo\.com\/y\.js|bing\.com\/aclick|[?&]ad_(domain|provider)=/.test(u);

function tidy(rows) {
  const seen = new Set(); const out = [];
  for (const r of rows || []) {
    const url = realUrl(r.url || ''); const title = text(r.title);
    if (!title || !/^https?:\/\//.test(url) || isAd(url) || seen.has(url)) continue;
    seen.add(url); out.push({ title, url, snippet: text(r.snippet).slice(0, 320) }); if (out.length >= MAX) break;
  }
  return out;
}

async function get(url, signal, ua) {
  const r = await fetch(url, { headers: { 'User-Agent': ua || UA, 'Accept-Language': 'en-US,en;q=0.9' }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000) });
  if (r.status !== 200) throw new Error(r.status === 202 || r.status === 429 ? 'bot check' : 'HTTP ' + r.status);
  return r.text();
}

async function ddgDirect(q, signal) {
  const h = await get('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), signal);
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>(?:[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g; const rows = []; let m;
  while ((m = re.exec(h))) rows.push({ url: m[1].replace(/&amp;/g, '&'), title: m[2], snippet: m[3] });
  if (!rows.length && /anomaly|captcha/i.test(h)) throw new Error('bot check');
  return rows;
}

const PAGES = [
  { name: 'DuckDuckGo', url: 'https://html.duckduckgo.com/html/?q=', js: `Array.from(document.querySelectorAll('.result__body')).map((e) => { const a = e.querySelector('.result__a'); return a && { title: a.innerText, url: a.href, snippet: (e.querySelector('.result__snippet') || {}).innerText }; }).filter(Boolean)` },
  { name: 'Bing', url: 'https://www.bing.com/search?q=', js: `Array.from(document.querySelectorAll('li.b_algo')).map((e) => { const a = e.querySelector('h2 a'); return a && { title: a.innerText, url: a.href, snippet: (e.querySelector('.b_caption p, p') || {}).innerText }; }).filter(Boolean)` },
  { name: 'Brave', url: 'https://search.brave.com/search?q=', js: `Array.from(document.querySelectorAll('[data-type=web]')).map((e) => { const a = e.querySelector('a[href^=http]'); return a && { title: (e.querySelector('.title') || a).innerText, url: a.href, snippet: (e.querySelector('.snippet-description, .content, .generic-snippet') || {}).innerText }; }).filter(Boolean)` },
];

async function viaWindow(page, q, signal) {
  const { BrowserWindow } = require('electron');
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, images: false, disableDialogs: true, partition: 'caelix-search' } });
  const stop = () => { if (!win.isDestroyed()) win.destroy(); };
  if (signal) signal.addEventListener('abort', stop, { once: true });
  try {
    const wc = win.webContents; wc.setAudioMuted(true); wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.setUserAgent(wc.getUserAgent().replace(/ (Electron|CAELIX[^/]*|caelix)\/[\d.]+/gi, ''));
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await Promise.race([wc.loadURL(page.url + encodeURIComponent(q)).catch(() => {}), wait(10000)]);
    for (let i = 0; i < 6; i++) { const rows = await wc.executeJavaScript(page.js); if (rows.length) return rows; await wait(500); }
    return [];
  } finally { if (signal) signal.removeEventListener('abort', stop); stop(); }
}

async function bingFeed(q, signal) {
  const x = await get('https://www.bing.com/search?format=rss&q=' + encodeURIComponent(q), signal);
  const pick = (s, tag) => (new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(s) || [])[1] || '';
  return (x.match(/<item>[\s\S]*?<\/item>/g) || []).map((i) => ({ title: pick(i, 'title'), url: text(pick(i, 'link')), snippet: pick(i, 'description') }));
}

async function wikipedia(q, signal) {
  const j = JSON.parse(await get('https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=8&srsearch=' + encodeURIComponent(q), signal));
  return ((j.query && j.query.search) || []).map((r) => ({ title: r.title, url: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(r.title.replace(/ /g, '_')), snippet: r.snippet }));
}

function routes() {
  const list = [{ name: 'DuckDuckGo', run: ddgDirect }];
  if (process.versions.electron) for (const p of PAGES) list.push({ name: p.name + ' (browser)', run: (q, s) => viaWindow(p, q, s) });
  list.push({ name: 'Bing feed', run: bingFeed }, { name: 'Wikipedia only', run: wikipedia });
  return list;
}

// Returns { source, results, tried }. `only` replaces the route list (used by the self-check).
async function search(query, { signal, only } = {}) {
  const tried = [];
  for (const r of only || routes()) {
    if (signal && signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    try { const results = tidy(await r.run(query, signal)); if (results.length) return { source: r.name, results, tried }; tried.push(r.name + ': no results'); }
    catch (e) { if (signal && signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' }); tried.push(r.name + ': ' + String(e.message).slice(0, 80)); }
  }
  return { source: '', results: [], tried };
}

async function webSearch(query, opts) {
  const q = String(query || '').trim(); if (!q) return 'Error: the search query is empty.';
  const { source, results, tried } = await search(q, opts);
  if (!results.length) return `Error: web search found nothing for "${q}". Tried ${tried.join('; ')}. Check the internet connection, or try different words.`;
  return `Results from ${source}:\n\n` + results.map((r) => `${r.title}\n${r.url}\n${r.snippet}`).join('\n\n');
}

module.exports = { webSearch, search, tidy, realUrl };
