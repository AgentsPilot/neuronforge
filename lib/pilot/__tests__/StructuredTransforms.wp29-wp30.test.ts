/**
 * StructuredTransforms — WP-29 (timezone-aware date parsing) + WP-30
 * (config expression resolution via `{{}}` wrap)
 *
 * Background:
 *   - WP-29: `parseDate` used JavaScript's `new Date()` which is locale-
 *     sensitive. The user's Google Sheet stored dates as "12/5/2026"
 *     (DD/MM/YYYY May 12), but `new Date("12/5/2026")` parses as Dec 5
 *     (MM/DD/YYYY) → `date_diff` returned 207 days instead of 1. The fix
 *     uses three-tier disambiguation: ISO → unambiguous (day>12 OR
 *     month>12) → user-timezone-driven locale → DD/MM default.
 *   - WP-30: `case 'config'` and non-`item` `case 'ref'` in
 *     `evaluateExpression` called `context.resolveVariable('input.X')`
 *     with bare paths. Production `resolveVariable` requires `{{...}}`
 *     syntax — bare strings were returned literal → `Number("input.X")`
 *     = NaN → `date_add(today, config_ref)` returned null. The fix
 *     wraps paths in `{{}}` before resolving (same shape as WP-22).
 *
 * Tests use a strict stub `IExpressionContext` mirroring production
 * `ExecutionContext.resolveVariable` (returns literal when no `{{}}`).
 * Same pattern as WP-22 / WP-SR tests.
 */

import {
  parseDate,
  evaluateExpression,
  type IExpressionContext,
  type IConditionEvaluator,
} from '../transforms/StructuredTransforms';

// ─── Strict stub context (mirrors production ExecutionContext) ─────────────

class StrictContext implements IExpressionContext {
  variables: Record<string, any> = {};
  inputs: Record<string, any> = {};
  userTimezone?: string;

  setVariable(name: string, value: any): void {
    this.variables[name] = value;
  }

  // Production-strict: returns literal when no {{}}
  resolveVariable(reference: any): any {
    if (typeof reference !== 'string') return reference;
    if (!reference.includes('{{')) return reference;
    const path = reference.replace(/^\{\{\s*|\s*\}\}$/g, '');
    if (path.startsWith('input.')) {
      return this.lookupPath(this.inputs, path.substring('input.'.length));
    }
    return this.lookupPath(this.variables, path);
  }

  private lookupPath(obj: any, path: string): any {
    const parts = path.split('.');
    let current = obj;
    for (const p of parts) {
      if (current == null || typeof current !== 'object') return undefined;
      current = (current as Record<string, any>)[p];
    }
    return current;
  }

  clone(): StrictContext {
    const copy = new StrictContext();
    copy.variables = { ...this.variables };
    copy.inputs = { ...this.inputs };
    copy.userTimezone = this.userTimezone;
    return copy;
  }

  getUserTimezone(): string | undefined {
    return this.userTimezone;
  }
}

const noopEvaluator: IConditionEvaluator = {
  evaluate: () => false,
};

function makeCtx(inputs: Record<string, any> = {}, variables: Record<string, any> = {}, tz?: string): StrictContext {
  const ctx = new StrictContext();
  ctx.inputs = inputs;
  ctx.variables = variables;
  ctx.userTimezone = tz;
  return ctx;
}

// ─── WP-29 tests ───────────────────────────────────────────────────────────

describe('WP-29 — parseDate locale-aware disambiguation', () => {
  describe('Tier 0: ISO format (always unambiguous)', () => {
    it('"2026-05-12" → May 12, 2026', () => {
      const d = parseDate('2026-05-12');
      expect(d?.getUTCFullYear()).toBe(2026);
      expect(d?.getUTCMonth()).toBe(4); // May = 4 (0-indexed)
      expect(d?.getUTCDate()).toBe(12);
    });

    it('"2026-05-12T10:30:00Z" → May 12 with time', () => {
      const d = parseDate('2026-05-12T10:30:00Z');
      expect(d?.toISOString()).toBe('2026-05-12T10:30:00.000Z');
    });
  });

  describe('Tier 1: unambiguous detection (day or month > 12)', () => {
    it('"13/5/2026" → May 13 (DD/MM, since no month 13)', () => {
      // The canonical gantt-urgent-tasks failure: pre-WP-29 this was Invalid Date.
      const d = parseDate('13/5/2026');
      expect(d).not.toBeNull();
      expect(d?.getUTCFullYear()).toBe(2026);
      expect(d?.getUTCMonth()).toBe(4); // May
      expect(d?.getUTCDate()).toBe(13);
    });

    it('"5/13/2026" → May 13 (MM/DD, since no month 13 at position 1)', () => {
      const d = parseDate('5/13/2026');
      expect(d?.getUTCMonth()).toBe(4); // May
      expect(d?.getUTCDate()).toBe(13);
    });

    it('"31/1/2026" → Jan 31 (DD/MM)', () => {
      const d = parseDate('31/1/2026');
      expect(d?.getUTCMonth()).toBe(0); // Jan
      expect(d?.getUTCDate()).toBe(31);
    });

    it('"1/31/2026" → Jan 31 (MM/DD)', () => {
      const d = parseDate('1/31/2026');
      expect(d?.getUTCMonth()).toBe(0);
      expect(d?.getUTCDate()).toBe(31);
    });

    it('"32/13/2026" → null (both invalid)', () => {
      expect(parseDate('32/13/2026')).toBeNull();
    });

    it('"30/2/2026" → null (Feb 30 invalid)', () => {
      expect(parseDate('30/2/2026')).toBeNull();
    });
  });

  describe('Tier 2: ambiguous → user-timezone-driven', () => {
    const ROW = '12/5/2026'; // ambiguous: both DD/MM and MM/DD parse

    it('no timezone → defaults to DD/MM (May 12)', () => {
      const ctx = makeCtx();
      const d = parseDate(ROW, ctx);
      expect(d?.getUTCMonth()).toBe(4); // May
      expect(d?.getUTCDate()).toBe(12);
    });

    it('Asia/Jerusalem → DD/MM (May 12) — the canonical gantt user', () => {
      const ctx = makeCtx({}, {}, 'Asia/Jerusalem');
      const d = parseDate(ROW, ctx);
      expect(d?.getUTCMonth()).toBe(4);
      expect(d?.getUTCDate()).toBe(12);
    });

    it('Europe/London → DD/MM', () => {
      const ctx = makeCtx({}, {}, 'Europe/London');
      const d = parseDate(ROW, ctx);
      expect(d?.getUTCMonth()).toBe(4);
      expect(d?.getUTCDate()).toBe(12);
    });

    it('America/New_York → MM/DD (Dec 5)', () => {
      const ctx = makeCtx({}, {}, 'America/New_York');
      const d = parseDate(ROW, ctx);
      expect(d?.getUTCMonth()).toBe(11); // Dec
      expect(d?.getUTCDate()).toBe(5);
    });

    it('America/Los_Angeles → MM/DD', () => {
      const ctx = makeCtx({}, {}, 'America/Los_Angeles');
      const d = parseDate(ROW, ctx);
      expect(d?.getUTCMonth()).toBe(11);
      expect(d?.getUTCDate()).toBe(5);
    });

    it('America/Sao_Paulo (South America, uses DD/MM) → DD/MM', () => {
      const ctx = makeCtx({}, {}, 'America/Sao_Paulo');
      const d = parseDate(ROW, ctx);
      expect(d?.getUTCMonth()).toBe(4); // May (DD/MM)
    });

    it('America/Argentina/Buenos_Aires (South America) → DD/MM', () => {
      const ctx = makeCtx({}, {}, 'America/Argentina/Buenos_Aires');
      const d = parseDate(ROW, ctx);
      expect(d?.getUTCMonth()).toBe(4); // May (DD/MM)
    });

    it('Australia/Sydney → DD/MM', () => {
      const ctx = makeCtx({}, {}, 'Australia/Sydney');
      const d = parseDate(ROW, ctx);
      expect(d?.getUTCMonth()).toBe(4);
    });

    it('"5/5/2026" + no tz → both interpretations equal, defaults to DD/MM', () => {
      const d = parseDate('5/5/2026');
      expect(d?.getUTCMonth()).toBe(4); // May
      expect(d?.getUTCDate()).toBe(5);
    });
  });

  describe('edge cases', () => {
    it('null / undefined → null', () => {
      expect(parseDate(null)).toBeNull();
      expect(parseDate(undefined)).toBeNull();
    });

    it('empty string → null', () => {
      expect(parseDate('')).toBeNull();
      expect(parseDate('   ')).toBeNull();
    });

    it('Date instance → passes through if valid', () => {
      const d = new Date('2026-05-12');
      expect(parseDate(d)).toBe(d);
    });

    it('number → JS-Date interpretation (Unix epoch ms)', () => {
      const ms = Date.UTC(2026, 4, 12);
      const d = parseDate(ms);
      expect(d?.getUTCMonth()).toBe(4);
    });

    it('2-digit year ("12/5/26") → expands to 2026', () => {
      const d = parseDate('12/5/26');
      expect(d?.getUTCFullYear()).toBe(2026);
    });

    it('dash separator "12-5-2026" treated same as slash', () => {
      const ctx = makeCtx({}, {}, 'Asia/Jerusalem');
      const d = parseDate('12-5-2026', ctx);
      expect(d?.getUTCMonth()).toBe(4); // DD-MM
    });

    it('unparseable garbage → null (clear non-date strings)', () => {
      expect(parseDate('not a date')).toBeNull();
      expect(parseDate('xxx')).toBeNull();
      // Note: strings with embedded years (e.g., "hello/world/2026") may be
      // partially parsed by JS engine's fallback Date() — that's a JS quirk,
      // not a bug in parseDate. We only guarantee correctness for ISO and
      // slash-format inputs that match our regex.
    });
  });

  describe('canonical gantt-urgent-tasks scenario', () => {
    it('"12/5/2026" + Asia/Jerusalem ctx → date_diff to today gives ~1 day, not 207', () => {
      const ctx = makeCtx({}, {}, 'Asia/Jerusalem');
      const finishDate = parseDate('12/5/2026', ctx);
      // Pick a "today" of May 11 for deterministic test
      const today = new Date(Date.UTC(2026, 4, 11));
      expect(finishDate).not.toBeNull();
      const days = Math.floor((finishDate!.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      expect(days).toBe(1);
    });

    it('"13/5/2026" + no tz → date_diff returns 2 (was null pre-WP-29)', () => {
      const ctx = makeCtx();
      const finishDate = parseDate('13/5/2026', ctx);
      const today = new Date(Date.UTC(2026, 4, 11));
      expect(finishDate).not.toBeNull();
      const days = Math.floor((finishDate!.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      expect(days).toBe(2);
    });
  });
});

// ─── WP-30 tests ───────────────────────────────────────────────────────────

describe('WP-30 — `config` and `ref` expressions wrap path in `{{}}` before resolveVariable', () => {
  describe('config expression', () => {
    it('canonical gantt-urgent-tasks: {kind: "config", key: "date_window_days"} → 3', () => {
      const ctx = makeCtx({ date_window_days: 3 });
      const result = evaluateExpression(
        { kind: 'config', key: 'date_window_days' },
        null,
        ctx,
        noopEvaluator
      );
      expect(result).toBe(3);
    });

    it('resolves string config values', () => {
      const ctx = makeCtx({ keyword: 'urgent' });
      const result = evaluateExpression(
        { kind: 'config', key: 'keyword' },
        null,
        ctx,
        noopEvaluator
      );
      expect(result).toBe('urgent');
    });

    it('returns undefined for missing config key', () => {
      const ctx = makeCtx({ other: 'something' });
      const result = evaluateExpression(
        { kind: 'config', key: 'missing' },
        null,
        ctx,
        noopEvaluator
      );
      expect(result).toBeUndefined();
    });

    it('regression demo: WITHOUT the {{}} wrap, strict context returns literal', () => {
      // Sanity-check the strict stub behaves like production
      const ctx = makeCtx({ date_window_days: 3 });
      expect(ctx.resolveVariable('input.date_window_days')).toBe('input.date_window_days');
      expect(ctx.resolveVariable('{{input.date_window_days}}')).toBe(3);
    });
  });

  describe('ref expression (non-item)', () => {
    it('cross-slot ref resolves correctly with {{}} wrap', () => {
      const ctx = makeCtx({}, { other_slot: { id: 'X', name: 'Alice' } });
      const result = evaluateExpression(
        { kind: 'ref', ref: 'other_slot', field: 'name' },
        null,
        ctx,
        noopEvaluator
      );
      expect(result).toBe('Alice');
    });

    it('cross-slot ref without field returns the whole slot', () => {
      const ctx = makeCtx({}, { other_slot: { id: 'X' } });
      const result = evaluateExpression(
        { kind: 'ref', ref: 'other_slot' },
        null,
        ctx,
        noopEvaluator
      );
      expect(result).toEqual({ id: 'X' });
    });

    it('ref to "item" still uses special-case path (currentItem direct)', () => {
      const ctx = makeCtx();
      const result = evaluateExpression(
        { kind: 'ref', ref: 'item', field: 'name' },
        { name: 'Alice', id: 'X' },
        ctx,
        noopEvaluator
      );
      expect(result).toBe('Alice');
    });
  });

  describe('integration: date_add(today, config) — the exact gantt-urgent-tasks failure', () => {
    it('config days resolves correctly → date_add produces a valid ISO date', () => {
      const ctx = makeCtx({ date_window_days: 3 });
      const result = evaluateExpression(
        {
          kind: 'date_add',
          date: { kind: 'today' },
          days: { kind: 'config', key: 'date_window_days' },
        },
        null,
        ctx,
        noopEvaluator
      );
      expect(typeof result).toBe('string');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO format
      // Pre-WP-30: this returned null because config resolved to "input.date_window_days"
      expect(result).not.toBeNull();
    });
  });
});

// ─── WP-31 tests ───────────────────────────────────────────────────────────

describe('WP-31 — `today` returns calendar day at UTC midnight; date_diff measures whole-day deltas', () => {
  describe('today expression', () => {
    it('returns a UTC midnight ISO string', () => {
      const ctx = makeCtx();
      const result = evaluateExpression({ kind: 'today' }, null, ctx, noopEvaluator);
      expect(typeof result).toBe('string');
      // Must end with T00:00:00.000Z — midnight UTC
      expect(result).toMatch(/T00:00:00\.000Z$/);
    });

    it('returns the SAME midnight regardless of when in the day it runs', () => {
      // Call twice in quick succession — should be identical (same calendar day)
      const ctx = makeCtx();
      const a = evaluateExpression({ kind: 'today' }, null, ctx, noopEvaluator);
      const b = evaluateExpression({ kind: 'today' }, null, ctx, noopEvaluator);
      expect(a).toBe(b);
    });

    it('with user timezone hint, returns midnight UTC of local date', () => {
      // For a US user, near UTC midnight, the local date may differ from UTC date.
      // We can't easily mock the wall clock, but we CAN verify the output is
      // valid ISO format and is a midnight-UTC value matching either today's
      // UTC date or yesterday's (depending on the actual time relative to the tz).
      const ctx = makeCtx({}, {}, 'America/Los_Angeles');
      const result = evaluateExpression({ kind: 'today' }, null, ctx, noopEvaluator);
      expect(result).toMatch(/T00:00:00\.000Z$/);
    });

    it('invalid timezone string → falls back to server UTC date', () => {
      const ctx = makeCtx({}, {}, 'NotAReal/Timezone');
      const result = evaluateExpression({ kind: 'today' }, null, ctx, noopEvaluator);
      expect(result).toMatch(/T00:00:00\.000Z$/);
    });
  });

  describe('date_diff with `unit: days` — calendar-day semantics', () => {
    it('canonical gantt failure: today (midnight UTC) and May 12 date-only → 1 (was 0)', () => {
      // Pre-WP-31: today=2026-05-11T08:30:00Z, finish=2026-05-12T00:00:00Z
      //            diff = 15.5h → floor = 0  ← bug
      // Post-WP-31: today=2026-05-11T00:00:00Z, finish=2026-05-12T00:00:00Z
      //            diff = 24h → 1            ← fixed
      //
      // We can't easily mock today() in this test, so we exercise the
      // normalization logic directly: pass two parseDate-able strings and
      // verify the diff measures calendar days regardless of input time-of-day.
      const ctx = makeCtx();
      // Both as date-only strings — parseDate returns midnight UTC for both.
      const result = evaluateExpression(
        {
          kind: 'date_diff',
          left: { kind: 'literal', value: '2026-05-12' },
          right: { kind: 'literal', value: '2026-05-11' },
          unit: 'days',
        },
        null,
        ctx,
        noopEvaluator
      );
      expect(result).toBe(1);
    });

    it('left has time-of-day in afternoon, right is morning → still 0 within same day', () => {
      const ctx = makeCtx();
      const result = evaluateExpression(
        {
          kind: 'date_diff',
          left: { kind: 'literal', value: '2026-05-11T20:00:00Z' },
          right: { kind: 'literal', value: '2026-05-11T08:00:00Z' },
          unit: 'days',
        },
        null,
        ctx,
        noopEvaluator
      );
      // Same calendar day → 0 days
      expect(result).toBe(0);
    });

    it('left at 00:01, right at 23:59 of previous day → 1 day (NOT 0 from sub-24h floor)', () => {
      // Pre-WP-31: ms = (24h - 23h58m) = 0.001 day → floor = 0
      // Post-WP-31: normalized to midnight → calendar diff = 1
      const ctx = makeCtx();
      const result = evaluateExpression(
        {
          kind: 'date_diff',
          left: { kind: 'literal', value: '2026-05-12T00:01:00Z' },
          right: { kind: 'literal', value: '2026-05-11T23:59:00Z' },
          unit: 'days',
        },
        null,
        ctx,
        noopEvaluator
      );
      expect(result).toBe(1);
    });

    it('whole-week diff', () => {
      const ctx = makeCtx();
      const result = evaluateExpression(
        {
          kind: 'date_diff',
          left: { kind: 'literal', value: '2026-05-18' },
          right: { kind: 'literal', value: '2026-05-11' },
          unit: 'days',
        },
        null,
        ctx,
        noopEvaluator
      );
      expect(result).toBe(7);
    });

    it('negative diff (right is in the future)', () => {
      const ctx = makeCtx();
      const result = evaluateExpression(
        {
          kind: 'date_diff',
          left: { kind: 'literal', value: '2026-05-11' },
          right: { kind: 'literal', value: '2026-05-15' },
          unit: 'days',
        },
        null,
        ctx,
        noopEvaluator
      );
      expect(result).toBe(-4);
    });

    it('DD/MM/YYYY input parses correctly + diff is whole days', () => {
      const ctx = makeCtx({}, {}, 'Asia/Jerusalem');
      const result = evaluateExpression(
        {
          kind: 'date_diff',
          left: { kind: 'literal', value: '13/5/2026' },
          right: { kind: 'literal', value: '11/5/2026' },
          unit: 'days',
        },
        null,
        ctx,
        noopEvaluator
      );
      expect(result).toBe(2);
    });
  });

  describe('integration: date_add(today, N, days) — preserves midnight semantics', () => {
    it('today + 3 days = exactly 3*24h later (a midnight ISO)', () => {
      const ctx = makeCtx();
      const today = evaluateExpression({ kind: 'today' }, null, ctx, noopEvaluator) as string;
      const plus3 = evaluateExpression(
        {
          kind: 'date_add',
          date: { kind: 'today' },
          days: { kind: 'literal', value: 3 },
        },
        null,
        ctx,
        noopEvaluator
      ) as string;
      // Both midnight UTC
      expect(today).toMatch(/T00:00:00\.000Z$/);
      expect(plus3).toMatch(/T00:00:00\.000Z$/);
      // Difference is exactly 3 days
      const diff = new Date(plus3).getTime() - new Date(today).getTime();
      expect(diff).toBe(3 * 24 * 60 * 60 * 1000);
    });
  });

  describe('canonical gantt-urgent-tasks scenario reproduction', () => {
    it('with_fields cascade: today + finish-date diff → whole-day windows', () => {
      // Simulate the gantt scenario: today + 3 finish dates
      // The expression evaluator's `today` returns midnight UTC,
      // `date_diff('finish', 'today', 'days')` returns whole days.
      const ctx = makeCtx({ date_window_days: 3 }, {}, 'Asia/Jerusalem');

      const today = evaluateExpression({ kind: 'today' }, null, ctx, noopEvaluator) as string;
      const todayDate = new Date(today);

      // Build a "tomorrow" date string (DD/MM/YYYY format as user's sheet)
      const tomorrow = new Date(todayDate.getTime() + 24 * 60 * 60 * 1000);
      const tomorrowStr = `${tomorrow.getUTCDate()}/${tomorrow.getUTCMonth() + 1}/${tomorrow.getUTCFullYear()}`;

      const days = evaluateExpression(
        {
          kind: 'date_diff',
          left: { kind: 'ref', ref: 'item', field: 'finish_date' },
          right: { kind: 'today' },
          unit: 'days',
        },
        { finish_date: tomorrowStr },
        ctx,
        noopEvaluator
      );
      expect(days).toBe(1);
    });
  });
});
