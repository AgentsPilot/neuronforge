/**
 * The credit history's cursor (credit deduction slice 7a, workplan §4.4; SA
 * SQ-29, Q-2): exact strings round-trip byte for byte, and anything that is
 * not exactly a well-formed cursor is refused.
 */

import {
  MAX_HISTORY_CURSOR_LENGTH,
  decodeHistoryCursor,
  encodeHistoryCursor,
  historyWindowTag,
} from '../creditHistoryCursor';

const KEY = '2026-09-14T09:31:07.123456+00:00';
const T = '2026-09-30T07:00:00.123456+00:00';
const I = '00000000-0000-4000-8000-0000000000ff';

const b64 = (value: unknown) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value), 'utf8').toString('base64url');

describe('round trip', () => {
  it('keeps the window key and created_at as the exact strings (microseconds included)', () => {
    const cursor = { w: historyWindowTag('monthly', KEY), t: T, i: I };
    const decoded = decodeHistoryCursor(encodeHistoryCursor(cursor));
    expect(decoded).toEqual(cursor);
    expect(decoded!.t).toBe(T);
    expect(decoded!.w).toBe(`m:${KEY}`);
  });

  it('accepts the calendar-month key and a trial anchor', () => {
    for (const w of [historyWindowTag('calendar_month', '2026-10-01T00:00:00.000Z'), historyWindowTag('trial_total', KEY)]) {
      expect(decodeHistoryCursor(encodeHistoryCursor({ w, t: T, i: I }))).not.toBeNull();
    }
  });

  it('is URL-safe and opaque', () => {
    expect(encodeHistoryCursor({ w: `m:${KEY}`, t: T, i: I })).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('refusals', () => {
  it.each([
    ['empty', ''],
    ['not a string', 42],
    ['too long', 'a'.repeat(MAX_HISTORY_CURSOR_LENGTH + 1)],
    ['not base64url', 'abc+/='],
    ['not JSON', b64('not json')],
    ['JSON but not an object', b64('[1,2,3]')],
    ['an extra key', b64({ w: `m:${KEY}`, t: T, i: I, accountId: I })],
    ['a missing key', b64({ w: `m:${KEY}`, t: T })],
    ['no window kind', b64({ w: KEY, t: T, i: I })],
    ['an unknown window kind', b64({ w: `x:${KEY}`, t: T, i: I })],
    ['a non-uuid id', b64({ w: `m:${KEY}`, t: T, i: 'abc' })],
    ['an or-expression in t', b64({ w: `m:${KEY}`, t: `${T}",id.gt.0`, i: I })],
    ['parentheses in t', b64({ w: `m:${KEY}`, t: `${T})`, i: I })],
    ['or= in w', b64({ w: `m:${KEY},or=(id.gt.0)`, t: T, i: I })],
    ['a date-only t', b64({ w: `m:${KEY}`, t: '2026-09-30', i: I })],
    ['numbers instead of strings', b64({ w: 1, t: 2, i: 3 })],
  ])('%s', (_name, raw) => {
    expect(decodeHistoryCursor(raw)).toBeNull();
  });
});
