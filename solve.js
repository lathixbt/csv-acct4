// solve.js — fast csv-reader 1.0.0-compatible parser (own code; no imports).
//
// Two-phase design:
//   Phase 1 (splitSpans): scan the text once and cut it into record spans.
//     A record ends at an LF or CRLF that is NOT inside a quoted field, so
//     the scan tracks field-opening quotes with indexOf jumps and only walks
//     a line's fields when the line holds a quote at all. Line numbers are
//     counted here: LF and CRLF count once, a lone CR inside quotes counts
//     once, a lone CR outside quotes counts never.
//   Phase 2 (parseSpan): parse the fields inside one span. Plain spans
//     (no quote, no CR) split on ',' with indexOf only; quoted fields are
//     sliced and only rebuilt when they hold "" or a CR. Errors carry the
//     record's start line; short_row/long_row are applied at assembly time.
// A whole-text fast path handles the quote-free, CR-free case in one loop.

const COMMA = 44;
const QUOTE = 34;
const LF = 10;
const CR = 13;

// Count the '\r' in [a, b) that are NOT followed by '\n' (lone CRs).
// Bounded loop: the range is short, and an indexOf would scan past b
// into the rest of the text whenever CRs are sparse.
function countLoneCR(text, a, b) {
  let n = 0;
  for (let k = a; k < b; k++) {
    if (text.charCodeAt(k) === CR && text.charCodeAt(k + 1) !== LF) n++;
  }
  return n;
}

// True when [a, b) holds a CR. Bounded: never scans past b, so a check
// on a short field stays cheap even when CRs are rare in the file.
function hasCR(text, a, b) {
  for (let k = a; k < b; k++) if (text.charCodeAt(k) === CR) return true;
  return false;
}

// Index of the next '"' in [from, end) that is not doubled (not followed
// by another '"'), or -1. A '"' whose next char is outside the range still
// counts: the char after the range is never a quote here (LF or EOF).
function findClose(text, from, end) {
  let q = text.indexOf('"', from);
  while (q !== -1 && q < end) {
    if (text.charCodeAt(q + 1) === QUOTE) { q = text.indexOf('"', q + 2); continue; }
    return q;
  }
  return -1;
}

// Index of the closing quote for a field open before `from` (searches to
// the end of the text), or -1 when the quote never closes.
function findCloseLater(text, from) {
  let q = text.indexOf('"', from);
  while (q !== -1) {
    if (text.charCodeAt(q + 1) === QUOTE) { q = text.indexOf('"', q + 2); continue; }
    return q;
  }
  return -1;
}

// Phase 1: cut the text into record spans. Returns a flat array
// [start0, end0, line0, start1, end1, line1, ...]; end excludes the
// record's LF/CRLF terminator, line is the record's 1-based start line.
function splitSpans(text, n, start) {
  const spans = [];
  let line = 1;
  let i = start;
  while (i < n) {
    const c0 = text.charCodeAt(i);
    if (c0 === LF) { i++; line++; continue; }
    if (c0 === CR && text.charCodeAt(i + 1) === LF) { i += 2; line++; continue; }
    const recStart = i;
    const recLine = line;
    let p = i;
    let open = -1;        // index of an unclosed opening quote, or -1
    let openExtra = 0;    // extraCR as it stood when the open quote opened
    let extraCR = 0;      // lone CRs inside quoted fields of this record
    let knownClose = -1;  // cached closing-quote index for the open quote
    let fs = true;        // at a field start (only meaningful when open === -1)
    let spanEnd = n;
    let term = 0;         // terminator length: 1 LF, 2 CRLF, 0 EOF
    for (;;) {
      let lf = text.indexOf('\n', p);
      if (lf === -1) lf = n;
      const segEnd = lf;
      let q = p;
      while (q < segEnd) {
        if (open !== -1) {
          let cl = -1;
          if (knownClose !== -1) {
            if (knownClose >= q && knownClose < segEnd) cl = knownClose;
          } else {
            cl = findClose(text, q, segEnd);
          }
          if (cl === -1) {
            extraCR += countLoneCR(text, q, segEnd);
            q = segEnd;
            break;
          }
          extraCR += countLoneCR(text, q, cl);
          q = cl + 1;
          open = -1;
          knownClose = -1;
          fs = false;
          continue;
        }
        if (fs && text.charCodeAt(q) === QUOTE) {
          const cl = findClose(text, q + 1, segEnd);
          if (cl === -1) {
            open = q;
            openExtra = extraCR;
            knownClose = -1;
            extraCR += countLoneCR(text, q + 1, segEnd);
            q = segEnd;
            break;
          }
          extraCR += countLoneCR(text, q + 1, cl);
          q = cl + 1;
          fs = false;
          continue;
        }
        const cm = text.indexOf(',', q);
        if (cm === -1 || cm >= segEnd) { q = segEnd; break; }
        q = cm + 1;
        fs = true;
      }
      if (open === -1) {
        if (lf === n) { spanEnd = n; term = 0; }
        else {
          const crlf = segEnd > recStart && text.charCodeAt(segEnd - 1) === CR;
          spanEnd = crlf ? segEnd - 1 : segEnd;
          term = crlf ? 2 : 1;
        }
        break;
      }
      // A quote is still open at this segment's end. If it never closes
      // anywhere later in the file, it is unterminated: the record ends
      // here as if unquoted, and the CRs counted inside the quote do not
      // count as line breaks.
      if (knownClose === -1) knownClose = findCloseLater(text, segEnd + 1);
      if (knownClose === -1) {
        extraCR = openExtra;
        if (lf === n) { spanEnd = n; term = 0; }
        else {
          const crlf = segEnd > recStart && text.charCodeAt(segEnd - 1) === CR;
          spanEnd = crlf ? segEnd - 1 : segEnd;
          term = crlf ? 2 : 1;
        }
        break;
      }
      line++;
      p = lf + 1;
      if (lf === n) { spanEnd = n; term = 0; break; }
    }
    spans.push(recStart, spanEnd, recLine);
    // extraCR: lone CRs inside quoted fields each start a new line.
    // The terminator itself (LF or CRLF) is one more line, whatever its
    // byte length; term is only the byte length for advancing i.
    line += extraCR + (term === 0 ? 0 : 1);
    i = spanEnd + term;
  }
  return spans;
}

// Build a quoted field's value from its raw content [a, b): "" -> one
// quote, CRLF or lone CR -> LF. Plain runs are sliced, never rebuilt char
// by char.
function quotedValue(text, a, b) {
  let out = '';
  let k = a;
  while (k < b) {
    const c = text.charCodeAt(k);
    if (c === QUOTE) { out += '"'; k += 2; continue; }
    if (c === CR) { out += '\n'; k += text.charCodeAt(k + 1) === LF ? 2 : 1; continue; }
    if (c === LF) { out += '\n'; k++; continue; }
    let m = k + 1;
    while (m < b) {
      const d = text.charCodeAt(m);
      if (d === QUOTE || d === CR || d === LF) break;
      m++;
    }
    out += text.slice(k, m);
    k = m;
  }
  return out;
}

// Segment [a, b) holds only lone CRs: drop them (one stray_cr each) and
// join the rest. Bounded loop: the field is short.
function cleanCRs(text, a, b, recLine, errs) {
  let out = '';
  let s = a;
  for (let k = a; k < b; k++) {
    if (text.charCodeAt(k) === CR) {
      errs.push({ code: 'stray_cr', line: recLine, row: 0 });
      out += text.slice(s, k);
      s = k + 1;
    }
  }
  out += text.slice(s, b);
  return out;
}

// Phase 2: parse the fields of one span [s, e). Returns
// {fields, errs, dropped}; dropped is true when the span holds only
// dropped CRs (no record, though its errors still stand).
function parseSpan(text, s, e, recLine) {
  const fields = [];
  const errs = [];
  // Fast path when the span holds no quote and no CR: one bounded scan
  // (an indexOf for '\r' would run past e whenever CRs are sparse).
  let plain = true;
  for (let k = s; k < e; k++) {
    const c = text.charCodeAt(k);
    if (c === QUOTE || c === CR) { plain = false; break; }
  }
  if (plain) {
    let f = s;
    for (;;) {
      const cm = text.indexOf(',', f);
      if (cm === -1 || cm >= e) { fields.push(text.slice(f, e)); break; }
      fields.push(text.slice(f, cm));
      f = cm + 1;
    }
  } else {
    let p = s;
    for (;;) {
      let val;
      if (p < e && text.charCodeAt(p) === QUOTE) {
        const cl = findClose(text, p + 1, e);
        if (cl === -1) {
          errs.push({ code: 'unterminated_quote', line: recLine, row: 0 });
          const cm = text.indexOf(',', p);
          const fend = cm === -1 || cm >= e ? e : cm;
          val = hasCR(text, p, fend) ? cleanCRs(text, p, fend, recLine, errs) : text.slice(p, fend);
          p = fend;
        } else {
          const cqi = text.indexOf('"', p + 1);
          val = (cqi === -1 || cqi >= cl) && !hasCR(text, p + 1, cl)
            ? text.slice(p + 1, cl)
            : quotedValue(text, p + 1, cl);
          p = cl + 1;
          const cm = text.indexOf(',', p);
          const jend = cm === -1 || cm >= e ? e : cm;
          if (jend > p) {
            if (!hasCR(text, p, jend)) {
              val += text.slice(p, jend);
              errs.push({ code: 'quote_junk', line: recLine, row: 0 });
            } else {
              const junk = cleanCRs(text, p, jend, recLine, errs);
              if (junk.length > 0) {
                val += junk;
                errs.push({ code: 'quote_junk', line: recLine, row: 0 });
              }
            }
          }
          p = jend;
        }
      } else {
        const cm = text.indexOf(',', p);
        const fend = cm === -1 || cm >= e ? e : cm;
        val = hasCR(text, p, fend) ? cleanCRs(text, p, fend, recLine, errs) : text.slice(p, fend);
        p = fend;
      }
      fields.push(val);
      if (p >= e) break;
      p++; // skip the comma
    }
  }
  let dropped = false;
  if (fields.length === 1 && fields[0] === '') {
    dropped = true;
    for (let k = s; k < e; k++) {
      if (text.charCodeAt(k) !== CR) { dropped = false; break; }
    }
  }
  return { fields, errs, dropped };
}

// Fast path: the text holds no quote and no CR at all.
function runPlain(text, n, start, header) {
  const recs = [];
  let line = 1;
  let i = start;
  while (i < n) {
    const lf = text.indexOf('\n', i);
    const le = lf === -1 ? n : lf;
    if (le === i) { i = le + 1; line++; continue; }
    const fields = [];
    let f = i;
    for (;;) {
      const cm = text.indexOf(',', f);
      if (cm === -1 || cm >= le) { fields.push(text.slice(f, le)); break; }
      fields.push(text.slice(f, cm));
      f = cm + 1;
    }
    recs.push({ fields, line });
    i = le + 1;
    line++;
  }
  const columns = header ? (recs.length > 0 ? recs[0].fields : []) : null;
  const dataRecs = header ? recs.slice(1) : recs;
  const width = recs.length > 0 ? recs[0].fields.length : 0;
  const rows = [];
  const errors = [];
  for (let r = 0; r < dataRecs.length; r++) {
    const rec = dataRecs[r];
    if (rec.fields.length < width) {
      const padded = rec.fields.slice();
      while (padded.length < width) padded.push('');
      rows.push(padded);
      errors.push({ code: 'short_row', line: rec.line, row: r, fields: rec.fields.length });
    } else if (rec.fields.length > width) {
      rows.push(rec.fields.slice(0, width));
      errors.push({ code: 'long_row', line: rec.line, row: r, extra: rec.fields.slice(width) });
    } else {
      rows.push(rec.fields);
    }
  }
  return { columns, rows, errors };
}

export function run(input) {
  const text = input.text;
  const header = input.header === true;
  const n = text.length;
  let start = 0;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) start = 1;
  if (text.indexOf('"', start) === -1 && text.indexOf('\r', start) === -1) {
    return runPlain(text, n, start, header);
  }
  const spans = splitSpans(text, n, start);
  const recs = [];
  let keptCount = 0;
  for (let si = 0; si < spans.length; si += 3) {
    const s = spans[si];
    const e = spans[si + 1];
    const recLine = spans[si + 2];
    const parsed = parseSpan(text, s, e, recLine);
    const rowVal = header ? (keptCount === 0 ? null : keptCount - 1) : keptCount;
    for (let k = 0; k < parsed.errs.length; k++) parsed.errs[k].row = rowVal;
    if (!parsed.dropped) keptCount++;
    recs.push({ fields: parsed.fields, line: recLine, row: rowVal, errs: parsed.errs, dropped: parsed.dropped });
  }
  const kept = [];
  for (let k = 0; k < recs.length; k++) if (!recs[k].dropped) kept.push(recs[k]);
  const columns = header ? (kept.length > 0 ? kept[0].fields : []) : null;
  const width = kept.length > 0 ? kept[0].fields.length : 0;
  const headerRec = header && kept.length > 0 ? kept[0] : null;
  const rows = [];
  const errors = [];
  for (let k = 0; k < recs.length; k++) {
    const r = recs[k];
    for (let m = 0; m < r.errs.length; m++) errors.push(r.errs[m]);
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
