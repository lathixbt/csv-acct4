// oracle.js — SLOW, literal reference implementation of csv-reader 1.0.0 semantics,
// written directly from the spec in RULES.txt. Correctness only; never graded.
// Own code; does not copy any vendor source.
//
// Rules as verified against the reference:
// - line counts LF and CRLF only, plus LF/CRLF/lone CR *inside quotes*.
//   A lone CR outside quotes is dropped (stray_cr) but does NOT advance line.
// - A record whose raw span holds only dropped CRs is NOT a record, but its
//   stray_cr errors are still emitted, with the row the record would have had.
// - header=true with no records at all gives columns=[] (not null).

export function run(input) {
  const text = input.text;
  const header = input.header === true;
  const n = text.length;
  const recs = []; // {fields, line, row, errs[], dropped}
  let i = 0;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) i = 1;
  let line = 1; // 1-based line number of the character at position i
  let keptCount = 0; // non-dropped records seen so far

  // Parse one unquoted field starting at i. Advances i past the field
  // (stops at ',', LF, CRLF or EOF). Lone CRs are dropped with stray_cr
  // and do NOT advance the line counter.
  function unquotedField(recLine, errs) {
    let start = i;
    let parts = null;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 44 || c === 10) break; // ',' or LF ends the field
      if (c === 13) {
        if (text.charCodeAt(i + 1) === 10) break; // CRLF ends the field
        errs.push({ code: 'stray_cr', line: recLine, row: 0 });
        if (parts === null) parts = [text.slice(start, i)];
        else parts.push(text.slice(start, i));
        i++;
        start = i;
        continue;
      }
      i++;
    }
    if (parts === null) return text.slice(start, i);
    parts.push(text.slice(start, i));
    return parts.join('');
  }

  while (i < n) {
    // A line with zero characters is NOT a record: skip empty lines.
    const c0 = text.charCodeAt(i);
    if (c0 === 10) { i++; line++; continue; }
    if (c0 === 13 && text.charCodeAt(i + 1) === 10) { i += 2; line++; continue; }

    const recStartIdx = i;
    const recLine = line;
    const fields = [];
    const errs = [];
    let done = false;
    let spanEnd = n;

    while (!done) {
      let val;
      if (i < n && text.charCodeAt(i) === 34) {
        // Field starting with a quote: scan for the next quote that is not doubled.
        let j = i + 1;
        let close = -1;
        while (j < n) {
          const cj = text.charCodeAt(j);
          if (cj === 34) {
            if (text.charCodeAt(j + 1) === 34) { j += 2; continue; }
            close = j;
            break;
          }
          j++;
        }
        if (close === -1) {
          // A quote that never closes is a literal char; the rest is re-read as unquoted.
          errs.push({ code: 'unterminated_quote', line: recLine, row: 0 });
          val = unquotedField(recLine, errs);
        } else {
          // Build the value: "" -> one quote; CRLF or lone CR -> LF.
          // Count every line break inside the quotes.
          let out = '';
          let k = i + 1;
          while (k < close) {
            const ck = text.charCodeAt(k);
            if (ck === 34) { out += '"'; k += 2; continue; }
            if (ck === 13) {
              out += '\n';
              line++;
              k += text.charCodeAt(k + 1) === 10 ? 2 : 1;
              continue;
            }
            if (ck === 10) { out += '\n'; line++; k++; continue; }
            out += text[k];
            k++;
          }
          i = close + 1;
          // Text after the closing quote up to next comma/line break is appended as-is.
          let junk = '';
          let junkBad = false;
          while (i < n) {
            const cj = text.charCodeAt(i);
            if (cj === 44 || cj === 10) break;
            if (cj === 13) {
              if (text.charCodeAt(i + 1) === 10) break;
              errs.push({ code: 'stray_cr', line: recLine, row: 0 });
              i++;
              continue;
            }
            junk += text[i];
            junkBad = true;
            i++;
          }
          if (junkBad) {
            val = out + junk;
            errs.push({ code: 'quote_junk', line: recLine, row: 0 });
          } else {
            val = out;
          }
        }
      } else {
        val = unquotedField(recLine, errs);
      }
      fields.push(val);

      // Delimiter after the field.
      if (i >= n) {
        spanEnd = n;
        done = true;
      } else {
        const c = text.charCodeAt(i);
        if (c === 44) {
          i++;
        } else if (c === 10) {
          spanEnd = i;
          i++;
          line++;
          done = true;
        } else if (c === 13 && text.charCodeAt(i + 1) === 10) {
          spanEnd = i;
          i += 2;
          line++;
          done = true;
        } else {
          // Unreachable in practice: lone CRs are consumed inside field parsing.
          errs.push({ code: 'stray_cr', line: recLine, row: 0 });
          i++;
        }
      }
    }

    // A record whose raw span holds only dropped CRs is not a record.
    let dropped = true;
    for (let p = recStartIdx; p < spanEnd; p++) {
      if (text.charCodeAt(p) !== 13) { dropped = false; break; }
    }
    const rowVal = header ? (keptCount === 0 ? null : keptCount - 1) : keptCount;
    for (const e of errs) e.row = rowVal;
    if (!dropped) keptCount++;
    recs.push({ fields, line: recLine, row: rowVal, errs, dropped });
  }

  const kept = recs.filter((r) => !r.dropped);
  const columns = header ? (kept.length > 0 ? kept[0].fields : []) : null;
  const dataRecs = header ? kept.slice(1) : kept;
  const width = kept.length > 0 ? kept[0].fields.length : 0;
  const headerRec = header && kept.length > 0 ? kept[0] : null;
  const rows = [];
  const errors = [];
  for (const r of recs) {
    for (const e of r.errs) errors.push(e);
    if (r.dropped || r === headerRec) continue;
    if (r.fields.length < width) {
      const padded = r.fields.slice();
      while (padded.length < width) padded.push('');
      rows.push(padded);
      errors.push({ code: 'short_row', line: r.line, row: r.row, fields: r.fields.length });
    } else if (r.fields.length > width) {
      rows.push(r.fields.slice(0, width));
      errors.push({ code: 'long_row', line: r.line, row: r.row, extra: r.fields.slice(width) });
    } else {
      rows.push(r.fields);
    }
  }
  return { columns, rows, errors };
}
