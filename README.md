[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/lathixbt/csv-acct4/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/lathixbt/csv-acct4/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

# csv-acct4 — Read broken CSV files faster

A fast, exact re-implementation of csv-reader 1.0.0 semantics for the
[csv-reader-speed-01-run-20261121](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
bounty. Every case is answered exactly like csv-reader 1.0.0 — same rows,
columns, and errors (including `stray_cr`, `quote_junk`,
`unterminated_quote`, `short_row`, `long_row` with their exact line/row
numbers) — only faster.

## Approach: two-phase parse

1. **Phase 1 — split into record spans.** One scan cuts the text into
   record spans, tracking open quotes so commas and newlines inside quoted
   fields never split a record. Lone CRs inside quotes count as line
   breaks; lone CRs outside quotes are dropped without advancing the line.
2. **Phase 2 — parse fields within each span.** A span with no quote and
   no CR takes a tight comma-split loop. Otherwise each field is handled
   on its own: quoted fields resolve `""` escapes and CR/LF folding only
   when the content actually needs it, junk after a closing quote is kept
   verbatim, and an unclosed quote is re-read as unquoted text.

No imports, no dependencies, no caching across cases. Hot paths use
`indexOf`/`charCodeAt` and `slice`; new strings are built only when a
quoted field contains `""` or CR handling, and every CR check is bounded
to the field it belongs to (an unbounded `indexOf('\r')` would scan far
past short fields whenever CRs are sparse in the file).

## Files

- `solve.js` — the parser: `export function run({ text, header })` returns
  `{ columns, rows, errors }`.
- `main.ts` — harness entry point (Node 22): reads
  `$MAKEFUN_INPUT_DIR/cases.json`, answers every case with `run()`, writes
  `$MAKEFUN_OUTPUT_DIR/answers.json` in a single write. Sets
  `--no-incremental-marking` before importing `solve.js`.
- `oracle.js` — a slow, literal reference implementation written straight
  from the spec, used only to check `solve.js`.
- `fuzz.js` — differential fuzzer (`oracle.js` vs `solve.js`).
- `bench.js` — CPU benchmark vs the csv-reader 1.0.0 baseline.

## Verification

- Fuzz vs the vendor oracle: 100,000 random inputs + 8,000 structured
  inputs, 0 mismatches.
- Fuzz vs the literal oracle: 100,000 random + 8,000 structured, 0 mismatches.
- Practice set: 6/6 cases byte-exact vs the reference answers.
- Benchmark (median CPU, 7 runs): ~290 ms total for the 6 practice cases
  vs ~718 ms for csv-reader 1.0.0 — about 2.5x faster.
