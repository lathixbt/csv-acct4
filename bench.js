// bench.js — CPU benchmark: solve.js run() vs the vendor baseline
// (csv-reader 1.0.0 readCsv) on the 6 practice cases, via process.cpuUsage().
// Usage: node bench.js [runsPerCase] [practiceInputDir]
// The vendor is imported only when the kit is present (guarded dynamic
// import); without it, only solve.js is timed. Test/bench script only —
// the harness never runs it.
import { readFileSync, existsSync } from 'node:fs';
import { run as solveRun } from './solve.js';

const KIT = '/home/hatch/workspace/makefun/kit-csv/csv-reader-speed-01-run-20261121-kit';
const VENDOR_PATH = KIT + '/program/generator/vendor/csv-reader/index.js';

const runs = Number(process.argv[2] || 5);
const casesPath = (process.argv[3] || KIT + '/practice/input') + '/cases.json';
const cases = JSON.parse(readFileSync(casesPath, 'utf8'));

let vendorRun = null;
if (existsSync(VENDOR_PATH)) {
  vendorRun = (await import(VENDOR_PATH)).readCsv;
}

function timeIt(fn, input) {
  fn(input); // warmup (JIT + inline caches)
  const times = [];
  for (let r = 0; r < runs; r++) {
    const before = process.cpuUsage();
    fn(input);
    const after = process.cpuUsage(before);
    times.push((after.user + after.system) / 1000);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)]; // median ms
}

console.log(`bench: ${cases.length} cases, ${runs} runs each, median CPU ms per case`);
let solveTotal = 0;
let vendorTotal = 0;
for (const c of cases) {
  const s = timeIt(solveRun, c.input);
  solveTotal += s;
  let line = `${c.id}: solve ${s.toFixed(1)} ms`;
  if (vendorRun) {
    const v = timeIt(vendorRun, c.input);
    vendorTotal += v;
    line += ` | vendor ${v.toFixed(1)} ms | speedup ${(v / s).toFixed(2)}x`;
  }
  console.log(line);
}
console.log(`total: solve ${solveTotal.toFixed(1)} ms` + (vendorRun ? ` | vendor ${vendorTotal.toFixed(1)} ms | speedup ${(vendorTotal / solveTotal).toFixed(2)}x` : ''));
