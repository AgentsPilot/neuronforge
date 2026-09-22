/**
 * S1-T16 — the shared switch-off predicate (RC-4).
 *
 * The rule it implements is NOT in `validateAreaRow`: it lives, today, inline
 * in `scripts/bos-llm-settings.ts`. That is why this module exists — a second
 * copy in the admin route would be free to drift on the one refusal an
 * emergency switch-off depends on.
 *
 * Slice 1 ships it with no caller. Slice 3 uses it in the route, slice 4
 * replaces the script's inline block with it, and S4-T8 pins that the script's
 * answers do not change across that swap.
 */

import {
  callsBlockingSwitchOff,
  isAreaSwitchOff,
  withCallsSwitchedOff,
} from '@/lib/business-os/llm/switchOffPredicate';

describe('isAreaSwitchOff', () => {
  it('is true only for an explicit false', () => {
    expect(isAreaSwitchOff({ enabled: false })).toBe(true);
  });

  it('is false for absent, true, and the string "false"', () => {
    // Absent INHERITS (the area stays on) and a non-boolean is refused by the
    // guardrails — neither is a switch-off, and treating them as one would
    // refuse rows that are not emergencies.
    expect(isAreaSwitchOff({})).toBe(false);
    expect(isAreaSwitchOff({ enabled: true })).toBe(false);
    expect(isAreaSwitchOff({ enabled: 'false' })).toBe(false);
    expect(isAreaSwitchOff(null)).toBe(false);
    expect(isAreaSwitchOff('not a row')).toBe(false);
  });
});

describe('callsBlockingSwitchOff', () => {
  it('names the switchable calls whose own enabled:true would survive', () => {
    const row = {
      enabled: false,
      calls: {
        reply_recommendation: { enabled: true },
        lead_scoring: { enabled: false },
      },
    };

    expect(callsBlockingSwitchOff('leads', row)).toEqual(['reply_recommendation']);
  });

  it('returns nothing when the row does not switch the area off', () => {
    const row = { enabled: true, calls: { reply_recommendation: { enabled: true } } };
    expect(callsBlockingSwitchOff('leads', row)).toEqual([]);
  });

  it('returns nothing when no call overrides the switch', () => {
    expect(callsBlockingSwitchOff('leads', { enabled: false })).toEqual([]);
    expect(callsBlockingSwitchOff('leads', { enabled: false, calls: {} })).toEqual([]);
  });

  it('ignores an unknown call name — `validateAreaRow` already refuses it', () => {
    const row = { enabled: false, calls: { not_a_real_call: { enabled: true } } };

    // Naming it here as well would give one mistake two different refusals.
    expect(callsBlockingSwitchOff('leads', row)).toEqual([]);
  });

  it('ignores a NON-switchable call, which cannot keep spending anyway', () => {
    // `chat/planner` has no switch of its own because the chat AREA switch
    // stops it at route entry. Naming it would tell an operator their kill
    // switch is partial when it is complete — and writing `enabled: false`
    // into it would produce a row `validateAreaRow` then refuses as locked.
    const row = { enabled: false, calls: { planner: { enabled: true } } };

    expect(callsBlockingSwitchOff('chat', row)).toEqual([]);
  });

  it('is pure: the same row twice gives the same answer and mutates nothing', () => {
    const row = { enabled: false, calls: { reply_recommendation: { enabled: true } } };
    const snapshot = JSON.stringify(row);

    callsBlockingSwitchOff('leads', row);
    callsBlockingSwitchOff('leads', row);

    expect(JSON.stringify(row)).toBe(snapshot);
  });
});

describe('withCallsSwitchedOff', () => {
  it('switches exactly the blocking calls off and leaves the rest alone', () => {
    const row = {
      enabled: false,
      model: 'gpt-4o',
      calls: {
        reply_recommendation: { enabled: true, temperature: 0.2 },
        lead_scoring: { enabled: false },
      },
    };

    const next = withCallsSwitchedOff('leads', row) as typeof row;

    expect(next.calls.reply_recommendation.enabled).toBe(false);
    // Other fields of the same call entry survive — this is a switch, not a reset.
    expect(next.calls.reply_recommendation.temperature).toBe(0.2);
    expect(next.calls.lead_scoring.enabled).toBe(false);
    expect(next.model).toBe('gpt-4o');
  });

  it('returns the row unchanged when nothing blocks', () => {
    const row = { enabled: false, calls: { lead_scoring: { enabled: false } } };
    expect(withCallsSwitchedOff('leads', row)).toBe(row);
  });

  it('never mutates its input — the caller still needs the original for a diff', () => {
    const row = { enabled: false, calls: { reply_recommendation: { enabled: true } } };
    const snapshot = JSON.stringify(row);

    withCallsSwitchedOff('leads', row);

    expect(JSON.stringify(row)).toBe(snapshot);
  });

  it('produces a row that no longer blocks', () => {
    const row = { enabled: false, calls: { reply_recommendation: { enabled: true } } };
    const next = withCallsSwitchedOff('leads', row);

    expect(callsBlockingSwitchOff('leads', next)).toEqual([]);
  });
});
