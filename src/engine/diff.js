'use strict';
// Small line diff (LCS) producing unified-style hunks. Written for CAELIX.
function diffLines(a, b) {
  const A = a === '' ? [] : a.split('\n'), B = b === '' ? [] : b.split('\n');
  let s = 0; while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let ea = A.length, eb = B.length; while (ea > s && eb > s && A[ea - 1] === B[eb - 1]) { ea--; eb--; }
  const x = A.slice(s, ea), y = B.slice(s, eb); const n = x.length, m = y.length;
  const ops = [];
  if (n * m > 4e6) { x.forEach((l) => ops.push(['-', l])); y.forEach((l) => ops.push(['+', l])); }
  else {
    const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) { if (x[i] === y[j]) { ops.push([' ', x[i]]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) ops.push(['-', x[i++]]); else ops.push(['+', y[j++]]); }
    while (i < n) ops.push(['-', x[i++]]); while (j < m) ops.push(['+', y[j++]]);
  }
  const pre = A.slice(Math.max(0, s - 3), s).map((l) => [' ', l]); const post = A.slice(ea, ea + 3).map((l) => [' ', l]);
  const lines = pre.concat(ops, post); let add = 0, del = 0; ops.forEach((o) => { if (o[0] === '+') add++; if (o[0] === '-') del++; });
  return { lines, add, del, startLine: Math.max(0, s - 3) + 1 };
}
module.exports = { diffLines };
