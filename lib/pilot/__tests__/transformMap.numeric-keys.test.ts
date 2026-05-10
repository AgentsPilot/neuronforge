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

const COLUMN_N = /^column_(\d+)$/;
const NUMERIC_KEY = /^\d+$/;

interface FieldMapping {
  [target: string]: string;
}

/**
 * Pure-function mirror of `transformMap` Mode 0 (WP-4 + WP-SR + WP-23).
 * Returns array-of-arrays (2D) when all target keys are numeric, else
 * array-of-objects.
 */
function applyFieldMapping(data: any[], mapping: FieldMapping): any[] {
  const targetKeys = Object.keys(mapping);
  const isObjectsToArray = targetKeys.length > 0 && targetKeys.every(k => NUMERIC_KEY.test(k));

  if (isObjectsToArray) {
    const indices = targetKeys.map(k => parseInt(k, 10));
    const len = Math.max(...indices) + 1;
    return data.map((item: any) => {
      const row = new Array(len).fill(null);
      for (const [target, src] of Object.entries(mapping)) {
        const idx = parseInt(target, 10);
        const value = item ? item[src] : undefined;
        row[idx] = value !== undefined ? value : null;
      }
      return row;
    });
  }

  // Object-building path (existing WP-4 + WP-SR `column_N` tolerance).
  return data.map((item: any) => {
    const mapped: Record<string, any> = {};
    for (const [targetField, sourceField] of Object.entries(mapping)) {
      let value: any;
      const colMatch = typeof sourceField === 'string' ? sourceField.match(COLUMN_N) : null;
      if (colMatch) {
        const idx = parseInt(colMatch[1], 10);
        if (Array.isArray(item)) {
          value = item[idx];
        } else if (item && typeof item === 'object') {
          value = Object.values(item)[idx];
        }
      } else {
        value = item ? item[sourceField] : undefined;
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
