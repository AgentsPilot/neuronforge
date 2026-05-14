/**
 * transformMap Mode 0 — WP-23 numeric-key field_mapping (objects-to-2D-array)
 *
 * Background: in Phase E of `complaint-email-logger`, step10 (the final
 * transform before append_rows) emitted:
 *
 *   field_mapping: {"0": "sender_email", "1": "subject", "2": "date",
 *                   "3": "full_email_text", "4": "gmail_message_link_id"}
 *
 * The LLM intent: "for each object, build an array indexed by column position".
 * The runtime contract for Sheets `append_rows` is a 2D array of cell values.
 *
 * Pre-WP-23 the runtime built objects (`mapped[targetKey] = item[sourceField]`)
 * → step10 produced `[{"0": "...", "1": "...", "4": "..."}, ...]`. Sheets append
 * received that, returned null, runtime classified as a non-retryable error,
 * Phase E stopped at step11. WP-23 detects the all-numeric-target-keys pattern
 * and emits arrays instead.
 *
 * These tests mirror the relevant slice of `StepExecutor.transformMap` Mode 0
 * as a pure function so we don't need to import StepExecutor (which pulls a
 * heavy dependency chain — same pattern as W2 / WP-SR tests).
 */

interface FieldMapping {
  [target: string]: string;
}

/**
 * WP-25: Excel-style column letter to 0-indexed position.
 * A=0, B=1, ..., Z=25, AA=26, AB=27, ...
 */
function letterToIndex(letters: string): number {
  let idx = 0;
  for (const c of letters) {
    idx = idx * 26 + (c.charCodeAt(0) - 'A'.charCodeAt(0) + 1);
  }
  return idx - 1;
}

/**
 * WP-23 / WP-25: parse a `field_mapping` target key as a positional column
 * identifier. Returns the 0-indexed column position, or null if not positional.
 */
function parsePositionalKey(key: string): number | null {
  if (/^\d+$/.test(key)) return parseInt(key, 10);
  let m = key.match(/^column_(\d+)$/);
  if (m) return parseInt(m[1], 10);
  if (/^[A-Z]+$/.test(key)) return letterToIndex(key);
  m = key.match(/^column_([A-Z]+)$/);
  if (m) return letterToIndex(m[1]);
  return null;
}

/**
 * Pure-function mirror of `transformMap` Mode 0 (WP-4 + WP-SR + WP-23 + WP-25).
 * Returns array-of-arrays (2D) when all target keys are positional (any of
 * the 4 patterns), else array-of-objects.
 */
function applyFieldMapping(data: any[], mapping: FieldMapping): any[] {
  const targetKeys = Object.keys(mapping);
  const positions: Array<[string, number]> = [];
  let allPositional = targetKeys.length > 0;
  for (const k of targetKeys) {
    const idx = parsePositionalKey(k);
    if (idx === null) { allPositional = false; break; }
    positions.push([k, idx]);
  }

  if (allPositional) {
    const len = Math.max(...positions.map(([, i]) => i)) + 1;
    return data.map((item: any) => {
      const row = new Array(len).fill(null);
      for (const [target, idx] of positions) {
        const src = mapping[target];
        const value = item ? item[src] : undefined;
        row[idx] = value !== undefined ? value : null;
      }
      return row;
    });
  }

  // Object-building path. Source side uses WP-28 broadened positional
  // detection via parsePositionalKey (mirrors WP-25 target-side). Literal
  // key lookup wins when it succeeds; positional fallback fires only when
  // the literal is undefined.
  return data.map((item: any) => {
    const mapped: Record<string, any> = {};
    for (const [targetField, sourceField] of Object.entries(mapping)) {
      let value: any = item && typeof item === 'object' && sourceField in (item as Record<string, any>)
        ? (item as Record<string, any>)[sourceField]
        : undefined;
      if (value === undefined && typeof sourceField === 'string') {
        const posIdx = parsePositionalKey(sourceField);
        if (posIdx !== null) {
          if (Array.isArray(item)) {
            value = item[posIdx];
          } else if (item && typeof item === 'object') {
            value = Object.values(item)[posIdx];
          }
        }
      }
      mapped[targetField] = value;
    }
    return mapped;
  });
}

describe('transformMap Mode 0 — WP-23 objects-to-2D-array detection', () => {
  // The exact mapping the LLM emitted in complaint-email-logger Phase E
  const COMPLAINT_LOGGER_MAPPING: FieldMapping = {
    '0': 'sender_email',
    '1': 'subject',
    '2': 'date',
    '3': 'full_email_text',
    '4': 'gmail_message_link_id',
  };

  const COMPLAINT_INPUT = [
    {
      sender_email: 'a@x.com',
      subject: 'I have a complaint',
      date: 'Sun, 10 May 2026',
      full_email_text: 'The product broke after 2 weeks.',
      gmail_message_link_id: 'msg-001',
    },
    {
      sender_email: 'b@y.com',
      subject: 'Refund request',
      date: 'Mon, 11 May 2026',
      full_email_text: 'I want a refund please.',
      gmail_message_link_id: 'msg-002',
    },
  ];

  it('canonical complaint-logger pattern: produces 2D array', () => {
    const out = applyFieldMapping(COMPLAINT_INPUT, COMPLAINT_LOGGER_MAPPING);
    expect(out).toHaveLength(2);

    // Each row is an array, NOT an object with numeric keys
    expect(Array.isArray(out[0])).toBe(true);
    expect(Array.isArray(out[1])).toBe(true);

    // Index 0 = sender_email, 1 = subject, 2 = date, 3 = body, 4 = id
    expect(out[0]).toEqual([
      'a@x.com',
      'I have a complaint',
      'Sun, 10 May 2026',
      'The product broke after 2 weeks.',
      'msg-001',
    ]);
    expect(out[1]).toEqual([
      'b@y.com',
      'Refund request',
      'Mon, 11 May 2026',
      'I want a refund please.',
      'msg-002',
    ]);
  });

  it('Sheets append_rows compatibility: each row is a JSON-array shape', () => {
    const out = applyFieldMapping(COMPLAINT_INPUT, COMPLAINT_LOGGER_MAPPING);
    // Sheets API contract: values must be a 2D array. JSON.stringify should
    // produce `[[...], [...]]` shape, not `[{...}, {...}]`.
    const json = JSON.stringify(out);
    expect(json.startsWith('[[')).toBe(true);
    expect(json.endsWith(']]')).toBe(true);
  });

  it('missing source field → null in row (not undefined)', () => {
    // Phase E observed: `full_email_text` was undefined on some rows
    // (Gmail body wasn't fetched without `content_level: full`). With
    // WP-23, missing fields produce null cells — Sheets accepts null.
    const input = [{ sender_email: 'a@x.com', subject: 'hi' }]; // no date/body/id
    const out = applyFieldMapping(input, COMPLAINT_LOGGER_MAPPING);
    expect(out[0]).toEqual(['a@x.com', 'hi', null, null, null]);
  });

  it('non-contiguous indices: gaps fill with null', () => {
    // Edge case: LLM might emit non-contiguous numeric keys
    const mapping = { '0': 'a', '2': 'c', '5': 'f' };
    const input = [{ a: 'A', c: 'C', f: 'F' }];
    const out = applyFieldMapping(input, mapping);
    expect(out[0]).toEqual(['A', null, 'C', null, null, 'F']);
  });

  it('single-object input (scatter-gather context) — currently NOT triggered by isObjectsToArray', () => {
    // This test documents that the array-input path is what fires;
    // single-object → array-of-arrays would need a separate code path
    // if needed. Today, scatter-gather context iterates per-item.
    const input = [{ sender_email: 'a@x.com', subject: 's' }];
    const out = applyFieldMapping(input, { '0': 'sender_email', '1': 'subject' });
    expect(out[0]).toEqual(['a@x.com', 's']);
  });

  it('zero-only mapping (single-column projection)', () => {
    const input = [{ sender_email: 'a@x.com' }, { sender_email: 'b@y.com' }];
    const out = applyFieldMapping(input, { '0': 'sender_email' });
    expect(out).toEqual([['a@x.com'], ['b@y.com']]);
  });

  // ─── Regression guards: non-numeric mappings still produce objects ────────

  it('regression: string-keyed mapping still produces objects (WP-4 behavior)', () => {
    // The canonical leads-per-salesperson pattern: {date: "Date", lead_name: "Lead Name"}
    const input = [{ Date: '14/12/2025', 'Lead Name': 'Lead 1', Stage: '4' }];
    const out = applyFieldMapping(input, {
      date: 'Date',
      lead_name: 'Lead Name',
      stage: 'Stage',
    });
    expect(out[0]).toEqual({
      date: '14/12/2025',
      lead_name: 'Lead 1',
      stage: '4',
    });
    // Crucially: NOT an array
    expect(Array.isArray(out[0])).toBe(false);
  });

  it('regression: mixed numeric + string keys still produce objects (defensive)', () => {
    // If the LLM mixes numeric and string keys, the all-numeric check fails
    // and we fall through to object-building. Caller intent is ambiguous;
    // building an object is safer than building an array with sparse holes.
    const input = [{ a: 1, b: 2 }];
    const out = applyFieldMapping(input, { '0': 'a', name: 'b' });
    expect(out[0]).toEqual({ '0': 1, name: 2 });
    expect(Array.isArray(out[0])).toBe(false);
  });

  it('regression: WP-SR `column_N` source keys still work (object output)', () => {
    // Different LLM emission pattern: numeric-string SOURCE keys. Output
    // must still be an object, mapped via Object.values positional access.
    // Today the source-side check happens INSIDE the object-building branch,
    // so the all-numeric-TARGET-keys check above doesn't accidentally hijack.
    const input = [{ Date: '14/12/2025', 'Lead Name': 'Lead 1', Stage: '4' }];
    const out = applyFieldMapping(input, {
      date: 'column_0',
      lead_name: 'column_1',
      stage: 'column_2',
    });
    expect(out[0]).toEqual({
      date: '14/12/2025',
      lead_name: 'Lead 1',
      stage: '4',
    });
  });

  it('regression: empty mapping produces empty objects (no-op)', () => {
    const input = [{ a: 1 }];
    const out = applyFieldMapping(input, {});
    expect(out[0]).toEqual({});
  });
});

// ─── WP-25: broaden positional-key detection to all 4 patterns ────────────

describe('WP-25 — parsePositionalKey covers all four LLM emission styles', () => {
  it('numeric: "0", "1", "42"', () => {
    expect(parsePositionalKey('0')).toBe(0);
    expect(parsePositionalKey('1')).toBe(1);
    expect(parsePositionalKey('42')).toBe(42);
  });

  it('column_N (numeric suffix): "column_0", "column_3"', () => {
    expect(parsePositionalKey('column_0')).toBe(0);
    expect(parsePositionalKey('column_3')).toBe(3);
    expect(parsePositionalKey('column_99')).toBe(99);
  });

  it('Excel letter: A=0, B=1, ..., Z=25, AA=26, AB=27', () => {
    expect(parsePositionalKey('A')).toBe(0);
    expect(parsePositionalKey('B')).toBe(1);
    expect(parsePositionalKey('Z')).toBe(25);
    expect(parsePositionalKey('AA')).toBe(26);
    expect(parsePositionalKey('AB')).toBe(27);
  });

  it('column_<letter>: "column_A", "column_AA"', () => {
    expect(parsePositionalKey('column_A')).toBe(0);
    expect(parsePositionalKey('column_B')).toBe(1);
    expect(parsePositionalKey('column_Z')).toBe(25);
    expect(parsePositionalKey('column_AA')).toBe(26);
  });

  it('non-positional keys return null', () => {
    expect(parsePositionalKey('date')).toBeNull();
    expect(parsePositionalKey('lead_name')).toBeNull();
    expect(parsePositionalKey('a')).toBeNull(); // lowercase doesn't match
    expect(parsePositionalKey('column_a')).toBeNull(); // lowercase suffix
    expect(parsePositionalKey('column_')).toBeNull();
    expect(parsePositionalKey('A1')).toBeNull(); // mixed letter+digit
    expect(parsePositionalKey('')).toBeNull();
  });
});

describe('WP-25 — column_<letter> field_mapping produces 2D array', () => {
  // The exact failing emission from complaint-email-logger Phase E #2:
  const COLUMN_LETTER_MAPPING: FieldMapping = {
    column_A: 'sender_email',
    column_B: 'subject',
    column_C: 'date',
    column_D: 'full_email_text',
    column_E: 'gmail_message_link_id',
  };

  const ROWS = [
    {
      sender_email: 'a@x.com',
      subject: 'I have a complaint',
      date: 'Sun, 10 May',
      full_email_text: 'The product broke.',
      gmail_message_link_id: 'msg-001',
    },
    {
      sender_email: 'b@y.com',
      subject: 'Refund pls',
      date: 'Mon, 11 May',
      full_email_text: 'Want a refund.',
      gmail_message_link_id: 'msg-002',
    },
  ];

  it('canonical complaint-logger column_A pattern → 2D array', () => {
    const out = applyFieldMapping(ROWS, COLUMN_LETTER_MAPPING);
    expect(Array.isArray(out[0])).toBe(true);
    expect(out[0]).toEqual([
      'a@x.com',
      'I have a complaint',
      'Sun, 10 May',
      'The product broke.',
      'msg-001',
    ]);
    expect(out[1]).toEqual([
      'b@y.com',
      'Refund pls',
      'Mon, 11 May',
      'Want a refund.',
      'msg-002',
    ]);
  });

  it('Sheets append_rows compatibility: 2D shape, not column-letter-keyed objects', () => {
    const out = applyFieldMapping(ROWS, COLUMN_LETTER_MAPPING);
    const json = JSON.stringify(out);
    expect(json.startsWith('[[')).toBe(true);
    expect(json).not.toContain('"column_A"');
    expect(json).not.toContain('"column_B"');
  });
});

describe('WP-25 — Excel letter (A/B/C) and column_N field_mapping also produce 2D', () => {
  const ROW = { sender: 'a@x.com', subject: 'hi', date: 'today' };

  it('A, B, C target keys produce 2D array', () => {
    const out = applyFieldMapping([ROW], { A: 'sender', B: 'subject', C: 'date' });
    expect(out[0]).toEqual(['a@x.com', 'hi', 'today']);
  });

  it('column_0, column_1, column_2 target keys produce 2D array', () => {
    const out = applyFieldMapping([ROW], {
      column_0: 'sender',
      column_1: 'subject',
      column_2: 'date',
    });
    expect(out[0]).toEqual(['a@x.com', 'hi', 'today']);
  });

  it('AA letter (column index 26) + Z (25) handled correctly', () => {
    const row: any = { a: 'col_25', b: 'col_26' };
    const out = applyFieldMapping([row], { Z: 'a', AA: 'b' });
    expect(out[0]).toHaveLength(27);
    expect(out[0][25]).toBe('col_25');
    expect(out[0][26]).toBe('col_26');
  });

  it('mixed positional patterns ALL count as positional → 2D array', () => {
    // Defensive: if the LLM mixes "0" and "column_A" (semantically same
    // intent), we still recognize it as positional.
    const out = applyFieldMapping([ROW], {
      '0': 'sender',
      column_B: 'subject',
      C: 'date',
    });
    expect(Array.isArray(out[0])).toBe(true);
    expect(out[0]).toEqual(['a@x.com', 'hi', 'today']);
  });

  it('regression: mixed positional + non-positional keys → falls through to objects', () => {
    // If even one key is non-positional, the whole mapping is treated as
    // string-keyed (object output). Caller intent is ambiguous; safer to
    // build an object than an array with confusing column placement.
    const out = applyFieldMapping([ROW], {
      '0': 'sender',
      subject_field: 'subject',
    });
    expect(Array.isArray(out[0])).toBe(false);
    expect(out[0]).toEqual({ '0': 'a@x.com', subject_field: 'hi' });
  });
});

// ─── WP-28: positional SOURCE keys (mirrors WP-25 target-side) ────────────

describe('WP-28 — positional SOURCE keys in field_mapping (4 patterns)', () => {
  // post-rows_to_objects(preserve_case=true) shape — leads-email-summary's
  // step3 input
  const LEADS_ROW = {
    Date: '14/12/2025',
    'Lead Name': 'Lead 1',
    Company: 'Company 1',
    Email: 'meiribarak@gmail.com',
    Phone: '526629333',
    Stage: '4',
    Notes: 'Need to reach back',
    'Sales Person': 'barakm@orpak.com',
  };

  it('canonical leads-email-summary pattern: bare numeric source keys → object output with real values', () => {
    // The exact failure mode from Phase E: target = field names, source = "0".."7"
    const out = applyFieldMapping([LEADS_ROW], {
      date: '0',
      lead_name: '1',
      company: '2',
      email: '3',
      phone: '4',
      stage: '5',
      notes: '6',
      sales_person: '7',
    });
    expect(out[0]).toEqual({
      date: '14/12/2025',
      lead_name: 'Lead 1',
      company: 'Company 1',
      email: 'meiribarak@gmail.com',
      phone: '526629333',
      stage: '4',
      notes: 'Need to reach back',
      sales_person: 'barakm@orpak.com',
    });
    // Crucially: NOT empty objects
    expect(out[0].stage).not.toBeUndefined();
    // Downstream filter on stage === "4" would now match
    expect(out[0].stage === '4').toBe(true);
  });

  it('column_<digit> source still works (WP-SR regression guard)', () => {
    const out = applyFieldMapping([LEADS_ROW], {
      date: 'column_0',
      stage: 'column_5',
    });
    expect(out[0]).toEqual({ date: '14/12/2025', stage: '4' });
  });

  it('Excel-letter source (A=0, B=1, ...) — WP-28 new pattern', () => {
    const out = applyFieldMapping([LEADS_ROW], {
      date: 'A',
      stage: 'F', // F=5
      sales_person: 'H', // H=7
    });
    expect(out[0]).toEqual({
      date: '14/12/2025',
      stage: '4',
      sales_person: 'barakm@orpak.com',
    });
  });

  it('column_<letter> source — WP-28 new pattern', () => {
    const out = applyFieldMapping([LEADS_ROW], {
      date: 'column_A',
      stage: 'column_F',
    });
    expect(out[0]).toEqual({ date: '14/12/2025', stage: '4' });
  });

  it('mixed source patterns: named + positional in the same mapping', () => {
    // Defensive: LLM might mix conventions
    const out = applyFieldMapping([LEADS_ROW], {
      date: 'Date', // named (preferred)
      stage: '5', // bare numeric position
      sales_person: 'column_H', // column_<letter>
    });
    expect(out[0]).toEqual({
      date: '14/12/2025',
      stage: '4',
      sales_person: 'barakm@orpak.com',
    });
  });

  it('literal key wins over positional when the literal exists (backward compat)', () => {
    // If item has a real field named "0", that takes priority over
    // positional interpretation.
    const item: any = { '0': 'literal-zero', Date: '14/12/2025' };
    const out = applyFieldMapping([item], { x: '0', y: 'Date' });
    expect(out[0]).toEqual({ x: 'literal-zero', y: '14/12/2025' });
  });

  it('positional source on raw 2D array (item is array)', () => {
    // When the input wasn't run through rows_to_objects, item is an array.
    // Positional access via item[N] is the natural path.
    const row = ['14/12/2025', 'Lead 1', 'Company 1'];
    const out = applyFieldMapping([row], { date: '0', name: '1', co: '2' });
    expect(out[0]).toEqual({ date: '14/12/2025', name: 'Lead 1', co: 'Company 1' });
  });

  it('out-of-range positional source → undefined for that field', () => {
    const out = applyFieldMapping([LEADS_ROW], { date: '0', extra: '99' });
    expect(out[0]).toEqual({ date: '14/12/2025', extra: undefined });
  });

  it('all-named mapping (canonical / preferred) — produces objects, no positional fallback', () => {
    const out = applyFieldMapping([LEADS_ROW], {
      date: 'Date',
      lead_name: 'Lead Name',
      stage: 'Stage',
    });
    expect(out[0]).toEqual({
      date: '14/12/2025',
      lead_name: 'Lead 1',
      stage: '4',
    });
  });
});
