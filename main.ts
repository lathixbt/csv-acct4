// csv-reader-speed entry point (Node 22, run as `node /bot/main.ts`).
// Reads cases from $MAKEFUN_INPUT_DIR/cases.json, answers every case with
// run() from ./solve.js, writes $MAKEFUN_OUTPUT_DIR/answers.json.
// The V8 flag must be set before solve.js is loaded, so solve.js is
// imported dynamically (a static import would load before this body runs).
import { setFlagsFromString } from 'node:v8';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

setFlagsFromString('--no-incremental-marking');

const { run } = await import('./solve.js');

const inDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(inDir, 'cases.json'), 'utf8'));
const answers = new Array(cases.length);
for (let i = 0; i < cases.length; i++) {
  answers[i] = run(cases[i].input);
}
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'answers.json'), JSON.stringify(answers));
