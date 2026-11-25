'use strict';
// "Eyes" for models that cannot see. Everything is turned into text on this computer:
//  - text in images is read with the operating system's own OCR (no AI vision model, no downloads),
//  - web pages are rendered in a hidden window and reported as layout + errors + screenshot text.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|tiff?|heic)$/i;

const MAC_OCR = `ObjC.import('Vision'); ObjC.import('Foundation');
function run(argv) {
  const handler = $.VNImageRequestHandler.alloc.initWithURLOptions($.NSURL.fileURLWithPath(argv[0]), $.NSDictionary.dictionary);
  const req = $.VNRecognizeTextRequest.alloc.init; req.recognitionLevel = 0;
  handler.performRequestsError($.NSArray.arrayWithObject(req), null);
  const res = req.results; const out = [];
  for (let i = 0; i < res.count; i++) { const o = res.objectAtIndex(i); const b = o.boundingBox; out.push({ t: ObjC.unwrap(o.topCandidates(1).objectAtIndex(0).string), x: b.origin.x, y: 1 - b.origin.y - b.size.height }); }
  return JSON.stringify(out);
}`;

const WIN_OCR = `param([string]$Path)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics,ContentType=WindowsRuntime] | Out-Null
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Path)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$dec = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bmp = Await ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
$res = Await ($engine.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
$out = @($res.Lines | ForEach-Object { $r = $_.Words[0].BoundingRect; @{ t = $_.Text; x = $r.X / $dec.PixelWidth; y = $r.Y / $dec.PixelHeight } })
ConvertTo-Json -InputObject $out -Compress
`;

function sh(cmd, args) {
  return new Promise((resolve, reject) => execFile(cmd, args, { timeout: 45000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (e, out, err) => (e ? reject(new Error(String(err || e.message).split('\n')[0])) : resolve(out))));
}

// Read the text in an image file: [{t, x, y}] with x/y as fractions of the image, top-left origin.
async function ocr(file) {
  let rows;
  if (process.platform === 'darwin') rows = JSON.parse(await sh('/usr/bin/osascript', ['-l', 'JavaScript', '-e', MAC_OCR, file]));
  else if (process.platform === 'win32') {
    const script = path.join(os.tmpdir(), 'caelix-ocr.ps1'); fs.writeFileSync(script, WIN_OCR);
    rows = JSON.parse((await sh('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, file])).trim() || '[]');
  } else rows = (await sh('tesseract', [file, 'stdout'])).split('\n').filter((t) => t.trim()).map((t, i) => ({ t, x: 0, y: i / 100 }));
  return (Array.isArray(rows) ? rows : [rows]).sort((a, b) => (Math.abs(a.y - b.y) < 0.012 ? a.x - b.x : a.y - b.y));
}

const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
function colours(img, rect) {
  const { nativeImage } = require('electron');
  let part = rect ? img.crop(rect) : img; if (part.isEmpty()) return [];
  part = nativeImage.createFromBuffer(part.resize({ width: 48, height: 48 }).toPNG());
  const b = part.toBitmap(); const seen = new Map(); // BGRA
  for (let i = 0; i + 3 < b.length; i += 4) { const k = hex(b[i + 2] & 0xf0, b[i + 1] & 0xf0, b[i] & 0xf0); seen.set(k, (seen.get(k) || 0) + 1); }
  const total = b.length / 4;
  return [...seen.entries()].sort((a, z) => z[1] - a[1]).slice(0, 5).map(([c, n]) => ({ c, pct: Math.round((n / total) * 100) }));
}

const where = (x, y) => `${y < 0.33 ? 'top' : y < 0.66 ? 'middle' : 'bottom'}-${x < 0.33 ? 'left' : x < 0.66 ? 'centre' : 'right'}`;

// Text description of an image file.
async function describeImage(file) {
  const lines = []; let img = null;
  try { img = require('electron').nativeImage.createFromPath(file); } catch (_) {}
  if (img && !img.isEmpty()) { const s = img.getSize(); lines.push(`Image size: ${s.width}x${s.height}.`, 'Main colours: ' + colours(img).map((c) => `${c.c} ${c.pct}%`).join(', ') + '.'); }
  try {
    const rows = await ocr(file);
    lines.push(rows.length ? `Text read from the image (${rows.length} lines, top to bottom):\n` + rows.slice(0, 220).map((r) => `[${where(r.x, r.y)} ${Math.round(r.x * 100)}%,${Math.round(r.y * 100)}%] ${r.t}`).join('\n') : 'No text was found in the image.');
  } catch (e) { lines.push('Text could not be read from this image: ' + e.message); }
  return lines.join('\n');
}

const cache = new Map();
async function describeDataUrl(url) {
  const key = crypto.createHash('sha1').update(url).digest('hex'); if (cache.has(key)) return cache.get(key);
  const m = /^data:image\/([\w+.-]+);base64,(.*)$/s.exec(url); if (!m) return 'An image was attached but its data could not be decoded.';
  const file = path.join(os.tmpdir(), `caelix-img-${key.slice(0, 12)}.${m[1] === 'jpeg' ? 'jpg' : m[1].replace(/[^\w]/g, '')}`);
  fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
  try { const d = await describeImage(file); cache.set(key, d); return d; } finally { try { fs.unlinkSync(file); } catch (_) {} }
}

// Runs inside the rendered page and returns what is visible there.
const PROBE = `(() => {
  const W = innerWidth, H = innerHeight, items = [], problems = [];
  const name = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\\s+/).slice(0, 2).join('.') : '');
  for (const e of document.querySelectorAll('body, body *')) {
    if (items.length > 140) break;
    const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) continue;
    const r = e.getBoundingClientRect();
    const own = Array.from(e.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').replace(/\\s+/g, ' ').trim();
    const widget = /^(BUTTON|A|INPUT|SELECT|TEXTAREA|IMG|CANVAS|SVG|VIDEO|H1|H2|H3|NAV|HEADER|FOOTER|MAIN|FORM|TABLE|DIALOG)$/i.test(e.tagName);
    if (!own && !widget) continue;
    const label = own || e.value || e.alt || e.placeholder || e.getAttribute('aria-label') || '';
    if (e.tagName === 'IMG' && e.complete && !e.naturalWidth) problems.push('Broken image: ' + (e.getAttribute('src') || '').slice(0, 120));
    if (r.width < 1 || r.height < 1) { if (widget && /^(CANVAS|BUTTON|IMG|INPUT)$/i.test(e.tagName)) problems.push(name(e) + ' has zero size, so it is invisible'); continue; }
    if (r.right > W + 2 && r.left < W + 2000) problems.push(name(e) + ' sticks out past the right edge (' + Math.round(r.right - W) + 'px)');
    if (r.right < 0 || r.bottom < 0) problems.push(name(e) + ' is positioned off screen');
    if (own && e.scrollWidth > e.clientWidth + 2 && s.overflow === 'hidden') problems.push('Text is cut off in ' + name(e) + ': "' + own.slice(0, 50) + '"');
    if (own && s.color === s.backgroundColor) problems.push('Text has the same colour as its background in ' + name(e));
    items.push({ el: name(e), text: String(label).slice(0, 80), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), color: own ? s.color : '', bg: s.backgroundColor === 'rgba(0, 0, 0, 0)' ? '' : s.backgroundColor, size: own ? s.fontSize : '' });
  }
  const canvases = Array.from(document.querySelectorAll('canvas')).map((c) => { const r = c.getBoundingClientRect(); return { el: name(c), x: Math.max(0, Math.round(r.left)), y: Math.max(0, Math.round(r.top)), w: Math.round(Math.min(r.width, W - Math.max(0, r.left))), h: Math.round(Math.min(r.height, H - Math.max(0, r.top))) }; });
  return { title: document.title, W, H, scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight, bg: getComputedStyle(document.body).backgroundColor, items, canvases, problems: Array.from(new Set(problems)).slice(0, 30) };
})()`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function toUrl(target, cwd) {
  if (/^(https?|file):\/\//i.test(target)) return target;
  const f = path.resolve(cwd || '.', target); if (!fs.existsSync(f)) throw new Error('No such file: ' + f);
  return pathToFileURL(f).href;
}

// Render a page in a hidden window and report what is on it.
async function lookAtPage({ target, cwd, width, height, wait_ms, clicks, keys }) {
  const { BrowserWindow } = require('electron');
  const url = toUrl(String(target || ''), cwd);
  const w = Math.min(2400, Math.max(320, width || 1280)); const h = Math.min(1800, Math.max(320, height || 800));
  const win = new BrowserWindow({ show: false, width: w, height: h, useContentSize: true, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, disableDialogs: true, partition: 'caelix-look' } });
  const logs = [];
  try {
    const wc = win.webContents; wc.setAudioMuted(true); wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('console-message', (e, level, message) => { const lv = e && e.level !== undefined ? e.level : level; const msg = e && e.message !== undefined ? e.message : message; if ((lv === 'error' || lv === 'warning' || lv >= 2) && logs.length < 25 && !/Electron Security Warning/.test(msg)) logs.push(`${lv === 'warning' || lv === 2 ? 'warning' : 'error'}: ${String(msg).slice(0, 300)}`); });
    wc.on('render-process-gone', () => logs.push('error: the page crashed'));
    await Promise.race([win.loadURL(url), wait(20000)]);
    await wait(Math.min(10000, Math.max(300, wait_ms || 900)));
    const done = [];
    for (const c of (clicks || []).slice(0, 10)) {
      const r = await wc.executeJavaScript(`(() => { const q = ${JSON.stringify(String(c))}; let e = null; try { e = document.querySelector(q); } catch (_) {} if (!e) e = Array.from(document.querySelectorAll('button,a,[role=button],input,label,li,div,span')).filter((x) => (x.innerText || x.value || '').trim().toLowerCase() === q.toLowerCase()).pop(); if (!e) return false; e.click(); return true; })()`);
      done.push(`click "${c}": ${r ? 'done' : 'NOTHING MATCHED'}`); await wait(350);
    }
    for (const k of (keys || []).slice(0, 30)) { wc.sendInputEvent({ type: 'keyDown', keyCode: String(k) }); if (String(k).length === 1) wc.sendInputEvent({ type: 'char', keyCode: String(k) }); wc.sendInputEvent({ type: 'keyUp', keyCode: String(k) }); done.push('pressed ' + k); await wait(150); }
    const p = await wc.executeJavaScript(PROBE);
    let img = await wc.capturePage(); if (img.isEmpty()) { await wait(500); img = await wc.capturePage(); }
    const out = [`Page: ${url}`, `Title: ${p.title || '(none)'} | viewport ${p.W}x${p.H}, content ${p.scrollW}x${p.scrollH} | background ${p.bg}`];
    if (done.length) out.push('Interactions: ' + done.join('; '));
    out.push(logs.length ? 'Console errors and warnings:\n' + logs.map((l) => '- ' + l).join('\n') : 'Console: no errors.');
    const problems = p.problems.slice(); let shot = ''; let ocrRows = null;
    if (!img.isEmpty()) {
      const dir = path.join(os.tmpdir(), 'caelix-shots'); fs.mkdirSync(dir, { recursive: true });
      shot = path.join(dir, `shot-${Date.now()}.png`); fs.writeFileSync(shot, img.toPNG());
      const s = img.getSize(); const fx = s.width / p.W;
      for (const c of p.canvases) if (c.w > 4 && c.h > 4) { const cs = colours(img, { x: Math.round(c.x * fx), y: Math.round(c.y * fx), width: Math.min(s.width - Math.round(c.x * fx), Math.round(c.w * fx)), height: Math.min(s.height - Math.round(c.y * fx), Math.round(c.h * fx)) }); if (cs.length === 1) problems.push(`${c.el} (${c.w}x${c.h}) is one flat colour (${cs[0].c}): nothing seems to be drawn on it`); else if (cs.length) out.push(`${c.el} colours: ${cs.map((x) => `${x.c} ${x.pct}%`).join(', ')}`); }
      const all = colours(img); out.push('Screen colours: ' + all.map((x) => `${x.c} ${x.pct}%`).join(', '));
      if (all.length === 1) problems.push('The whole screen is one flat colour: the page looks blank');
      try { ocrRows = await ocr(shot); } catch (e) { out.push('Screenshot text could not be read: ' + e.message); }
    } else problems.push('No screenshot could be taken');
    out.push(problems.length ? 'Problems seen:\n' + problems.map((x) => '- ' + x).join('\n') : 'Problems seen: none detected automatically.');
    out.push('Visible elements (x,y widthxheight in pixels):\n' + (p.items.map((i) => `- ${i.el} @${i.x},${i.y} ${i.w}x${i.h}${i.text ? ` "${i.text}"` : ''}${i.size ? ' ' + i.size : ''}${i.color ? ' text ' + i.color : ''}${i.bg ? ' bg ' + i.bg : ''}`).join('\n') || '(none)'));
    if (ocrRows) out.push('Text actually readable on the screenshot:\n' + (ocrRows.slice(0, 120).map((r) => r.t).join(' | ') || '(none)'));
    if (shot) out.push('Screenshot saved: ' + shot);
    return out.join('\n');
  } finally { if (!win.isDestroyed()) win.destroy(); }
}

module.exports = { IMAGE_EXT, ocr, describeImage, describeDataUrl, lookAtPage };
