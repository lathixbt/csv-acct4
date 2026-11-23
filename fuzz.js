// fuzz.js — differential fuzzer: fast solve.js vs literal oracle.js.
// Usage: node fuzz.js [randomN] [randomSeed] [structuredN] [structuredSeed]
// Exit code 0 when every input agrees, 1 otherwise. No vendor code here:
// oracle.js is our own slow literal implementation written from the spec.
import { run as oracleRun } from './oracle.js';
import { run as solveRun } from './solve.js';

const canon = (v) => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
};

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const codes = (t) => [...t].map((c) => c.codePointAt(0).toString(16)).join(' ');

function check(text, header, tag, state) {
  const input = { text, header };
  let a, b;
  try { a = oracleRun(input); } catch (e) { a = { __threw: String(e) }; }
  try { b = solveRun(input); } catch (e) { b = { __threw: String(e) }; }
  if (canon(a) !== canon(b)) {
    state.mismatch++;
    if (state.shown.length < 4) {
      state.shown.push({ tag, text: JSON.stringify(text), codes: codes(text), header, oracle: canon(a).slice(0, 600), solve: canon(b).slice(0, 600) });
    }
  }
}

// --- random alphabet fuzz: , " \r \n FEFF a b, lengths 0-60 ---
const ALPHA = [',', '"', '\r', '\n', '\uFEFF', 'a', 'b'];
{
  const N = Number(process.argv[2] || 100000);
  const seed = Number(process.argv[3] || 3);
  const rand = rng(seed);
  const state = { mismatch: 0, shown: [] };
  for (let t = 0; t < N; t++) {
    const len = Math.floor(rand() * 61);
    let text = '';
    for (let k = 0; k < len; k++) text += ALPHA[Math.floor(rand() * ALPHA.length)];
    check(text, rand() < 0.5, 'random', state);
  }
  console.log(`random fuzz oracle-vs-solve: ${N} inputs, mismatches=${state.mismatch}`);
  for (const m of state.shown) console.log(JSON.stringify(m, null, 1));
  if (state.mismatch) process.exitCode = 1;
}

// --- structured fuzz: multi-line records, quoted fields, stray CRs ---
const WORDS = ['alpha', 'bravo', 'x', '', 'a,b', 'q"q', 'naïve', 'café', '12', '2024-01-02', 'a b', 'x\ny', 'p\rq', 's\r\nt', '"', '""', 'kg', ' (est.)'];
{
  const N = Number(process.argv[4] || 8000);
  const seed = Number(process.argv[5] || 11);
  const rand = rng(seed);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const randField = () => {
    const w = pick(WORDS);
    const r = rand();
    if (r < 0.25) return '"' + w.replaceAll('"', '""') + '"';
    if (r < 0.30) return '"' + w.replaceAll('"', '""') + '"' + pick(['kg', 'x', '!', 'x"y', '']);
    if (r < 0.35) return w + '\r' + pick(WORDS);
    return w;
  };
  const randText = () => {
    const lines = Math.floor(rand() * 12);
    const eol = pick(['\n', '\r\n']);
    let out = '';
    if (rand() < 0.3) out += '\uFEFF';
    for (let l = 0; l < lines; l++) {
      const r = rand();
      if (r < 0.08) { out += eol; continue; }
      if (r < 0.12) { out += '\r'; continue; }
      const nf = 1 + Math.floor(rand() * 5);
      const fs = [];
      for (let f = 0; f < nf; f++) fs.push(randField());
      out += fs.join(',');
      if (rand() < 0.1) out += ',';
      out += rand() < 0.85 ? eol : '';
      if (rand() < 0.05) out += '"unterminated start';
    }
    if (rand() < 0.2) out += '"tail never closes\nmore,text\n';
    return out;
  };
  const state = { mismatch: 0, shown: [] };
  for (let t = 0; t < N; t++) check(randText(), rand() < 0.5, 'structured', state);
  console.log(`structured fuzz oracle-vs-solve: ${N} inputs, mismatches=${state.mismatch}`);
  for (const m of state.shown) console.log(JSON.stringify(m, null, 1));
  if (state.mismatch) process.exitCode = 1;
}
