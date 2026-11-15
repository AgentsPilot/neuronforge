/**
 * The number the owner picked is the number the run uses.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO ENDS OF ONE CONTROL, DISAGREEING.
 *
 * The lookback picker offers `STOP_RANGE` — twelve hours to two years, the same
 * for every agent, because `stopAfterRangeOf` "takes the agent and ignores it,
 * deliberately" once ranges replaced per-agent choices.
 *
 * `planInputs` was still validating against `stopAfterChoices`, a list the
 * picker had stopped reading. So an owner could set "12 months", the control
 * accepted it, the row stored 365, and the run was handed the catalogue
 * default of 14 — with nothing anywhere saying so.
 *
 * Found on the live account on 2026-11-13, on the receptionist. A client who
 * was emailed 20 days ago wrote in and read as a STRANGER: step4 counts only
 * sends inside this window, the window was 14 whatever had been chosen, and
 * the message was dropped without a row, a card or a trace.
 */

import { planInputs } from '../install';
import { STOP_RANGE } from '@/lib/business-os/schedule/ranges';
import { intervalMinutes } from '@/lib/business-os/schedule/interval';
import type { AutomationAgent } from '../types';

const MAX_DAYS = Math.round(intervalMinutes(STOP_RANGE.max) / (60 * 24));

/** Enough of a catalogue entry for `planInputs`; the rest is irrelevant to it. */
const agent = (over: Partial<AutomationAgent> = {}) =>
  ({
    id: 'draft_client_replies',
    defaultCron: '0 9 * * *',
    defaultStopAfterDays: 14,
    stopAfterChoices: [7, 14, 30],
    ...over,
  }) as unknown as AutomationAgent;

const config = (stopAfterDays: number | null) => ({
  business_os_automation: { stopAfterDays },
});

/** `planInputs` emits it negative — a lookback, not a deadline. */
const lookbackOf = (stored: number | null, over?: Partial<AutomationAgent>) =>
  planInputs(agent(over), config(stored))?.stop_after_days;

describe('a value the picker allows is a value the run honours', () => {
  it('twelve months, which is not on the retired list', () => {
    expect(lookbackOf(365)).toBe(-365);
  });

  it('and any other number the owner can reach', () => {
    for (const chosen of [1, 21, 45, 90, 180, MAX_DAYS]) {
      expect(lookbackOf(chosen)).toBe(-chosen);
    }
  });

  it('the list it used to check is no longer consulted', () => {
    /* The whole bug: 365 is absent from `[7, 14, 30]`, and that was enough to
       throw it away. Narrowing the list must not narrow what an owner may
       choose, because the picker never reads it. */
    expect(lookbackOf(365, { stopAfterChoices: [7] })).toBe(-365);
  });
});

describe('and the defaults still hold where there is no choice', () => {
  it('never set', () => {
    expect(lookbackOf(null)).toBe(-14);
  });

  it('past the range the picker itself offers', () => {
    expect(lookbackOf(MAX_DAYS + 1)).toBe(-14);
  });

  it('zero or negative, which no picker produces', () => {
    expect(lookbackOf(0)).toBe(-14);
    expect(lookbackOf(-30)).toBe(-14);
  });

  it('an agent with no stop rule is still handed none', () => {
    /* The spreadsheet importer: a row has no age, so there is nothing for a
       cut-off to measure. `-Math.abs(undefined)` is NaN, which a filter would
       spend as a date offset and silently match nothing. */
    const inputs = planInputs(
      agent({ defaultStopAfterDays: undefined }),
      config(null)
    );
    expect(inputs.stop_after_days).toBeUndefined();
  });
});

describe('one bound, shared with the control that writes it', () => {
  it('the ceiling comes from STOP_RANGE, not a number typed here', () => {
    const source = require('fs').readFileSync(
      require('path').join(process.cwd(), 'lib/business-os/automations/install.ts'),
      'utf8'
    );
    expect(source).toMatch(/intervalMinutes\(STOP_RANGE\.max\)/);
  });
});
