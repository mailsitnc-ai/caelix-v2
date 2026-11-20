'use strict';
// Tiny markdown renderer for chat text (escape first, then format). Written for CAELIX.
(function () {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function inline(s) {
    s = esc(s);
    const codes = []; s = s.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return '\u0001' + (codes.length - 1) + '\u0001'; });
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>');
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" data-ext="1">$1</a>');
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" data-ext="1">$2</a>');
    s = s.replace(/\u0001(\d+)\u0001/g, (_, i) => '<code>' + codes[+i] + '</code>');
    return s;
  }
  function render(src) {
    const lines = src.replace(/\r/g, '').split('\n'); const out = []; let i = 0; let para = [];
    const flush = () => { if (para.length) { out.push('<p>' + inline(para.join('\n')).replace(/\n/g, '<br>') + '</p>'); para = []; } };
    while (i < lines.length) {
      const l = lines[i];
      const fence = /^```(\w*)\s*$/.exec(l);
      if (fence) { flush(); const buf = []; i++; while (i < lines.length && !/^```\s*$/.test(lines[i])) buf.push(lines[i++]); i++; out.push('<pre class="code"><code>' + esc(buf.join('\n')) + '</code></pre>'); continue; }
      const hd = /^(#{1,4})\s+(.*)$/.exec(l); if (hd) { flush(); out.push(`<h${hd[1].length + 1}>${inline(hd[2])}</h${hd[1].length + 1}>`); i++; continue; }
      if (/^\s*[-*]\s+/.test(l)) { flush(); const it = []; while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) it.push('<li>' + inline(lines[i++].replace(/^\s*[-*]\s+/, '')) + '</li>'); out.push('<ul>' + it.join('') + '</ul>'); continue; }
      if (/^\s*\d+\.\s+/.test(l)) { flush(); const it = []; while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) it.push('<li>' + inline(lines[i++].replace(/^\s*\d+\.\s+/, '')) + '</li>'); out.push('<ol>' + it.join('') + '</ol>'); continue; }
      if (/^>\s?/.test(l)) { flush(); const it = []; while (i < lines.length && /^>\s?/.test(lines[i])) it.push(lines[i++].replace(/^>\s?/, '')); out.push('<blockquote>' + inline(it.join('\n')) + '</blockquote>'); continue; }
      if (/^---+\s*$/.test(l)) { flush(); out.push('<hr>'); i++; continue; }
      if (!l.trim()) { flush(); i++; continue; }
      para.push(l); i++;
    }
    flush(); return out.join('');
  }
  const api = { render, esc }; if (typeof window !== 'undefined') window.md = api; if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
