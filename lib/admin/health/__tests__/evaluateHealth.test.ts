/**
 * The Health evaluator (admin reorganisation slice 4, U-1): first match wins,
 * "Normal" when none does, no green, a lower bound is never Normal (C-18),
 * comparisons need exact figures (C-2), a tile's rules see only its own metrics
 * (C-19), a bad list fails one tile and never throws (C-20), and every rule is
 * shown with a condition generated from itself (C-22).
 *
 * Tests are driven from HEALTH_RULES and from each rule's own values, so a
 * value edit in rules.ts needs no edit here (C-11).
 */

import * as fs from 'fs';
import * as path from 'path';

import { AUDIT_EVENTS } from '@/lib/audit/events';
import {
  AI_FAILED_ACTION,
  LOWER_BOUND_HEADLINE,
  NORMAL_HEADLINE,
  NOT_MEASURED_HEADLINE,
  OI_P1_NOTE,
  OTHERWISE_NORMAL,
  OTHERWISE_NORMAL_UNLESS_LOWER_BOUND,
  UNAVAILABLE_HEADLINE,
  describeCondition,
  evaluateHealth,
  firstMatchingRule,
  matchCondition,
  type HealthInputs,
  type MetricValues,
  type FlagValues,
} from '../evaluateHealth';
import {
  HEALTH_RULES,
  TILE_VOCABULARY,
  type FlagId,
  type HealthCondition,
  type HealthRule,
  type HealthRuleSet,
  type MeasuredTileId,
  type MetricId,
} from '../rules';
import { computeHealthWindows, type Measured } from '../windows';
import type { HealthTile, TileStatus } from '../healthTypes';

const W = computeHealthWindows(new Date('2026-09-26T10:30:00.000Z'));
const STATUSES: TileStatus[] = ['red', 'amber', 'neutral', 'not_measured', 'unavailable'];
const MEASURED: MeasuredTileId[] = Object.keys(HEALTH_RULES) as MeasuredTileId[];

const ex = (value: number): Measured => ({ value, exact: true });
const lb = (value: number): Measured => ({ value, exact: false });

/** Quiet, exact, all-zero inputs: every measured tile should read "Normal". */
function quietInputs(): HealthInputs {
  return {
    windows: W,
    settings: { ok: true, value: { areasOff: 0, callsOff: 0, ignored: 0, adjusted: 0, offAreas: [], ignoredAreas: [] } },
    failures: { ok: true, value: { failed24h: 0, failed7d: 0, completed24h: 0 } },
    spend: {
      ok: true,
      value: {
        sums: { spend24h: ex(0), spendPrev24h: ex(0), spend7d: ex(0), spendPrev7d: ex(0), calls24h: ex(0), calls7d: ex(0) },
        callsKnown: true,
      },
    },
    critical: { ok: true, value: { last24h: 0, last7d: 0 } },
    entitlements: { ok: true, value: { effective: 'off', refused: false } },
  };
}

/** Inputs in which one tile's metrics and flags take the given values; the rest stay quiet. */
function inputsFor(tile: MeasuredTileId, metrics: MetricValues, flags: FlagValues = {}): HealthInputs {
  const inputs = quietInputs();
  const v = (id: MetricId) => metrics[id] ?? ex(0);
  switch (tile) {
    case 'bos_ai_settings':
      inputs.settings = {
        ok: true,
        value: { areasOff: v('settingsOff').value, callsOff: 0, ignored: v('settingsIgnored').value, adjusted: 0, offAreas: [], ignoredAreas: [] },
      };
      break;
    case 'bos_ai_failures':
      inputs.failures = {
        ok: true,
        value: { failed24h: v('failed24h').value, failed7d: v('failed24h').value, completed24h: v('completed24h').value },
      };
      break;
    case 'bos_ai_spend':
      inputs.spend = {
        ok: true,
        value: {
          sums: {
            spend24h: v('spend24h'),
            spendPrev24h: v('spendPrev24h'),
            spend7d: v('spend7d'),
            spendPrev7d: v('spendPrev7d'),
            calls24h: ex(1),
            calls7d: ex(1),
          },
          callsKnown: true,
        },
      };
      break;
    case 'critical_audit':
      inputs.critical = { ok: true, value: { last24h: v('critical24h').value, last7d: v('critical24h').value } };
      break;
    case 'entitlements_mode':
      inputs.entitlements = { ok: true, value: { effective: 'shadow', refused: flags.entitlementEnforceRefused === true } };
      break;
  }
  return inputs;
}

const tileOf = (tiles: HealthTile[], id: string) => tiles.find((t) => t.id === id)!;

/** Metrics that make exactly this condition true ("at"), and just false ("below"). */
function scenario(condition: HealthCondition<MetricId, FlagId>): {
  at: { metrics: MetricValues; flags: FlagValues };
  above: { metrics: MetricValues; flags: FlagValues };
  below: { metrics: MetricValues; flags: FlagValues };
} {
  switch (condition.kind) {
    case 'atLeast':
      return {
        at: { metrics: { [condition.metric]: ex(condition.value) }, flags: {} },
        above: { metrics: { [condition.metric]: ex(condition.value * 2 + 1) }, flags: {} },
        below: { metrics: { [condition.metric]: ex(condition.value - 0.001) }, flags: {} },
      };
    case 'ratioAtLeast': {
      const base = condition.floor / condition.factor;
      return {
        at: { metrics: { [condition.metric]: ex(condition.floor), [condition.baseline]: ex(base) }, flags: {} },
        above: { metrics: { [condition.metric]: ex(condition.floor * 3), [condition.baseline]: ex(base) }, flags: {} },
        // Below the ratio (the floor is met): baseline just too high.
        below: {
          metrics: { [condition.metric]: ex(condition.floor), [condition.baseline]: ex(base * 1.01) },
          flags: {},
        },
      };
    }
    case 'shareAtLeast': {
      const total = Math.max(condition.minTotal, 1) * 100;
      const n = Math.ceil(condition.rate * total);
      return {
        at: { metrics: { [condition.numerator]: ex(n), [condition.other]: ex(total - n) }, flags: {} },
        above: { metrics: { [condition.numerator]: ex(total), [condition.other]: ex(0) }, flags: {} },
        below: { metrics: { [condition.numerator]: ex(n - 1), [condition.other]: ex(total - n + 1) }, flags: {} },
      };
    }
    case 'anyLowerBound':
      return {
        at: { metrics: { [condition.metrics[0]]: lb(0) }, flags: {} },
        above: { metrics: Object.fromEntries(condition.metrics.map((m) => [m, lb(0)])), flags: {} },
        below: { metrics: Object.fromEntries(condition.metrics.map((m) => [m, ex(0)])), flags: {} },
      };
    case 'flag':
      return {
        at: { metrics: {}, flags: { [condition.flag]: true } },
        above: { metrics: {}, flags: { [condition.flag]: true } },
        below: { metrics: {}, flags: { [condition.flag]: false } },
      };
  }
}

const allRules = MEASURED.flatMap((tile) =>
  (HEALTH_RULES[tile] as readonly HealthRule<MetricId, FlagId>[]).map((rule) => [tile, rule] as const)
);

// ── First match ──────────────────────────────────────────────────────────────

describe('first match wins, top to bottom', () => {
  const amber: HealthRule<MetricId> = {
    id: 'a', priority: 1, colour: 'amber', description: 'Amber first',
    condition: { kind: 'atLeast', metric: 'failed24h', value: 1 },
  };
  const red: HealthRule<MetricId> = {
    id: 'r', priority: 2, colour: 'red', description: 'Red second',
    condition: { kind: 'atLeast', metric: 'failed24h', value: 1 },
  };
  const metrics: MetricValues = { failed24h: ex(3) };

  it('when two rules match, the earlier one wins, even if it is the milder colour', () => {
    expect(firstMatchingRule([amber, red], metrics, {})?.id).toBe('a');
  });

  it('the same two rules in the other order: the other one wins', () => {
    expect(firstMatchingRule([{ ...red, priority: 1 }, { ...amber, priority: 2 }], metrics, {})?.id).toBe('r');
  });

  it('the tile shows the matching rule\'s colour and description', () => {
    const rules: HealthRuleSet = { ...HEALTH_RULES, bos_ai_failures: [amber, red] as HealthRuleSet['bos_ai_failures'] };
    const tile = tileOf(evaluateHealth(inputsFor('bos_ai_failures', metrics), { rules }), 'bos_ai_failures');
    expect(tile.status).toBe('amber');
    expect(tile.headline).toBe('Amber first');
    expect(tile.matchedRuleId).toBe('a');
  });
});

describe.each(allRules)('%s / %s', (tile, rule) => {
  const s = scenario(rule.condition);

  it('matches at its own threshold and above, not below', () => {
    expect(matchCondition(rule.condition, s.at.metrics, s.at.flags)).toBe(true);
    expect(matchCondition(rule.condition, s.above.metrics, s.above.flags)).toBe(true);
    expect(matchCondition(rule.condition, s.below.metrics, s.below.flags)).toBe(false);
  });

  it('as the only rule, it colours the tile and its description is the headline', () => {
    const rules = { ...HEALTH_RULES, [tile]: [rule] } as HealthRuleSet;
    const shown = tileOf(evaluateHealth(inputsFor(tile, s.at.metrics, s.at.flags), { rules }), tile);
    expect(shown.status).toBe(rule.colour);
    expect(shown.headline).toBe(rule.description);
    expect(shown.matchedRuleId).toBe(rule.id);
  });

  it('is rendered with a generated condition that is not empty and never says "OK" (C-22)', () => {
    const view = tileOf(evaluateHealth(quietInputs()), tile).rules.find((r) => r.description === rule.description);
    expect(view?.condition).toBe(describeCondition(rule.condition));
    expect(view?.condition.length).toBeGreaterThan(0);
    expect(view?.condition).not.toMatch(/\bOK\b/);
  });
});

describe('no match', () => {
  it.each(MEASURED)('%s: quiet exact inputs → neutral "Normal"', (tile) => {
    const shown = tileOf(evaluateHealth(quietInputs()), tile);
    expect(shown.status).toBe('neutral');
    expect(shown.headline).toBe(NORMAL_HEADLINE);
    expect(shown.matchedRuleId).toBeNull();
  });

  it('an empty rule list with exact inputs is Normal', () => {
    const rules = { ...HEALTH_RULES, critical_audit: [] } as HealthRuleSet;
    const shown = tileOf(evaluateHealth(inputsFor('critical_audit', { critical24h: ex(9) }), { rules }), 'critical_audit');
    expect(shown.status).toBe('neutral');
  });
});

// ── C-18: a lower bound is never Normal ────────────────────────────────────

describe('C-18: a lower bound is never Normal, whatever the rules say', () => {
  it('an EMPTY spend rule list plus a lower-bound figure → amber, fixed headline', () => {
    const rules = { ...HEALTH_RULES, bos_ai_spend: [] } as HealthRuleSet;
    const shown = tileOf(evaluateHealth(inputsFor('bos_ai_spend', { spend7d: lb(1) }), { rules }), 'bos_ai_spend');
    expect(shown.status).toBe('amber');
    expect(shown.headline).toBe(LOWER_BOUND_HEADLINE);
  });

  it('with the starting rules, a lower bound below every absolute floor is still amber', () => {
    const shown = tileOf(evaluateHealth(inputsFor('bos_ai_spend', { spendPrev7d: lb(0.5) })), 'bos_ai_spend');
    expect(shown.status).toBe('amber');
    expect(shown.status).not.toBe('neutral');
  });

  it('the figure keeps its "at least"', () => {
    const shown = tileOf(evaluateHealth(inputsFor('bos_ai_spend', { spend7d: lb(1.25) })), 'bos_ai_spend');
    const week = shown.figures.find((f) => f.label === 'Last 7 days')!;
    expect(week.value).toContain('at least $1.25');
    expect(week.exact).toBe(false);
  });
});

// ── C-2: comparisons need exact figures ────────────────────────────────────

describe('C-2: comparisons only on exact figures', () => {
  const ratio: HealthCondition<MetricId, FlagId> = { kind: 'ratioAtLeast', metric: 'spend24h', baseline: 'spendPrev24h', factor: 2, floor: 1 };
  const share: HealthCondition<MetricId, FlagId> = { kind: 'shareAtLeast', numerator: 'failed24h', other: 'completed24h', rate: 0.2, minTotal: 10 };

  it('a ratio with either side a lower bound never matches', () => {
    expect(matchCondition(ratio, { spend24h: lb(100), spendPrev24h: ex(1) }, {})).toBe(false);
    expect(matchCondition(ratio, { spend24h: ex(100), spendPrev24h: lb(1) }, {})).toBe(false);
  });

  it('"at least" may fire on a lower bound at or above the value, and not below it', () => {
    const c: HealthCondition<MetricId, FlagId> = { kind: 'atLeast', metric: 'spend24h', value: 20 };
    expect(matchCondition(c, { spend24h: lb(25) }, {})).toBe(true);
    expect(matchCondition(c, { spend24h: lb(19) }, {})).toBe(false);
  });

  it('with the ratios blocked, the spend tile falls to the lower-bound rule', () => {
    const shown = tileOf(
      evaluateHealth(inputsFor('bos_ai_spend', { spend24h: lb(10), spendPrev24h: ex(1) })),
      'bos_ai_spend'
    );
    expect(shown.matchedRuleId).toBe('spend.lowerBound');
    expect(shown.status).toBe('amber');
  });

  it('an absolute floor still fires first on a large enough lower bound', () => {
    const shown = tileOf(evaluateHealth(inputsFor('bos_ai_spend', { spend24h: lb(1000) })), 'bos_ai_spend');
    expect(shown.matchedRuleId).toBe('spend.ceiling24h');
    expect(shown.status).toBe('red');
  });

  it('a previous period of 0 is "new spend": only the floor decides', () => {
    expect(matchCondition(ratio, { spend24h: ex(1), spendPrev24h: ex(0) }, {})).toBe(true);
    expect(matchCondition(ratio, { spend24h: ex(0.5), spendPrev24h: ex(0) }, {})).toBe(false);
    expect(matchCondition(ratio, { spend24h: ex(0), spendPrev24h: ex(0) }, {})).toBe(false);
  });

  it('a share below its minimum total never matches', () => {
    expect(matchCondition(share, { failed24h: ex(5), completed24h: ex(4) }, {})).toBe(false);
    expect(matchCondition(share, { failed24h: ex(5), completed24h: ex(5) }, {})).toBe(true);
    expect(matchCondition(share, { failed24h: lb(5), completed24h: ex(5) }, {})).toBe(false);
  });

  it('E-1: an exact multiple of a float-summed baseline matches ($2.39 + $2.75 → $15.42 is tripled)', () => {
    const previous = 2.39 + 2.75; // 5.140000000000001 in floating point
    expect(previous).not.toBe(5.14);
    const tripled: HealthCondition<MetricId, FlagId> = { kind: 'ratioAtLeast', metric: 'spend24h', baseline: 'spendPrev24h', factor: 3, floor: 5 };
    expect(matchCondition(tripled, { spend24h: ex(15.42), spendPrev24h: ex(previous) }, {})).toBe(true);
    // And one micro-dollar below the threshold still does not match.
    expect(matchCondition(tripled, { spend24h: ex(15.419999), spendPrev24h: ex(previous) }, {})).toBe(false);
  });

  it('E-1 end to end: the spend tile reads red "tripled", not amber "doubled"', () => {
    const shown = tileOf(
      evaluateHealth(inputsFor('bos_ai_spend', { spend24h: ex(15.42), spendPrev24h: ex(2.39 + 2.75) })),
      'bos_ai_spend'
    );
    expect(shown.matchedRuleId).toBe('spend.tripled24h');
    expect(shown.status).toBe('red');
  });

  it('E-1: an absolute floor reached by a float that lands just under it still matches', () => {
    const c: HealthCondition<MetricId, FlagId> = { kind: 'atLeast', metric: 'spend24h', value: 0.3 };
    expect(0.7 - 0.4).toBeLessThan(0.3); // 0.29999999999999993 in floating point
    expect(matchCondition(c, { spend24h: ex(0.7 - 0.4) }, {})).toBe(true);
  });

  it('a share exactly at the rate matches with integer arithmetic (1 of 5, 3 of 15)', () => {
    const share: HealthCondition<MetricId, FlagId> = { kind: 'shareAtLeast', numerator: 'failed24h', other: 'completed24h', rate: 0.2, minTotal: 5 };
    expect(matchCondition(share, { failed24h: ex(1), completed24h: ex(4) }, {})).toBe(true);
    expect(matchCondition(share, { failed24h: ex(3), completed24h: ex(12) }, {})).toBe(true);
    expect(matchCondition(share, { failed24h: ex(2), completed24h: ex(9) }, {})).toBe(false);
  });

  it('a missing metric never matches', () => {
    expect(matchCondition({ kind: 'atLeast', metric: 'spend24h', value: 0 }, {}, {})).toBe(false);
  });
});

describe('the rule list\'s closing line never contradicts C-18 (SA code review 2)', () => {
  it('the spend tile, which can carry a lower bound, says a minimum is amber', () => {
    const spend = tileOf(evaluateHealth(quietInputs()), 'bos_ai_spend');
    expect(spend.otherwise).toBe(OTHERWISE_NORMAL_UNLESS_LOWER_BOUND);
    expect(spend.otherwise).toContain(LOWER_BOUND_HEADLINE);
  });

  it('even with the redundant lower-bound rule deleted (a permitted data edit)', () => {
    const rules = {
      ...HEALTH_RULES,
      bos_ai_spend: HEALTH_RULES.bos_ai_spend.filter((r) => r.condition.kind !== 'anyLowerBound'),
    } as HealthRuleSet;
    const spend = tileOf(evaluateHealth(inputsFor('bos_ai_spend', { spend7d: lb(1) }), { rules }), 'bos_ai_spend');
    expect(spend.status).toBe('amber');
    expect(spend.otherwise).toBe(OTHERWISE_NORMAL_UNLESS_LOWER_BOUND);
  });

  it.each(['bos_ai_settings', 'bos_ai_failures', 'critical_audit', 'entitlements_mode'])(
    '%s (always exact) says plainly "Otherwise: Normal."',
    (id) => {
      expect(tileOf(evaluateHealth(quietInputs()), id).otherwise).toBe(OTHERWISE_NORMAL);
    }
  );

  it('tiles without rules have no closing line', () => {
    for (const id of ['scheduled_jobs', 'queues']) expect(tileOf(evaluateHealth(quietInputs()), id).otherwise).toBeNull();
  });
});

// ── C-19 / C-20: a bad list fails one tile, never the page ────────────────

describe('C-19 / C-20: invalid rule lists', () => {
  const bad: Array<[string, unknown]> = [
    ['another tile\'s metric', [{ id: 'x', priority: 1, colour: 'amber', description: 'Spend on settings', condition: { kind: 'atLeast', metric: 'spend24h', value: 1 } }]],
    ['priorities out of order', [
      { id: 'a', priority: 2, colour: 'amber', description: 'A', condition: { kind: 'atLeast', metric: 'settingsOff', value: 1 } },
      { id: 'b', priority: 1, colour: 'amber', description: 'B', condition: { kind: 'atLeast', metric: 'settingsOff', value: 1 } },
    ]],
    ['a duplicate priority', [
      { id: 'a', priority: 1, colour: 'amber', description: 'A', condition: { kind: 'atLeast', metric: 'settingsOff', value: 1 } },
      { id: 'b', priority: 1, colour: 'amber', description: 'B', condition: { kind: 'atLeast', metric: 'settingsOff', value: 1 } },
    ]],
    ['an unknown kind', [{ id: 'a', priority: 1, colour: 'amber', description: 'A', condition: { kind: 'atMost', metric: 'settingsOff', value: 1 } }]],
    ['a green colour', [{ id: 'a', priority: 1, colour: 'green', description: 'A', condition: { kind: 'atLeast', metric: 'settingsOff', value: 1 } }]],
    ['a description saying OK', [{ id: 'a', priority: 1, colour: 'amber', description: 'All OK', condition: { kind: 'atLeast', metric: 'settingsOff', value: 1 } }]],
    ['an empty description', [{ id: 'a', priority: 1, colour: 'amber', description: '  ', condition: { kind: 'atLeast', metric: 'settingsOff', value: 1 } }]],
    ['a non-number value', [{ id: 'a', priority: 1, colour: 'amber', description: 'A', condition: { kind: 'atLeast', metric: 'settingsOff', value: '1' } }]],
    ['not a list', { id: 'a' }],
    ['null', null],
  ];

  it.each(bad)('%s → that tile is unavailable, reported with its rule id, and the others are untouched', (_, list) => {
    const reports: Array<{ tile: string; ruleId: string | null }> = [];
    const rules = { ...HEALTH_RULES, bos_ai_settings: list } as unknown as HealthRuleSet;
    let tiles: HealthTile[] = [];
    expect(() => {
      tiles = evaluateHealth(quietInputs(), { rules, onRuleError: (r) => reports.push(r) });
    }).not.toThrow();

    const settings = tileOf(tiles, 'bos_ai_settings');
    expect(settings.status).toBe('unavailable');
    expect(settings.status).not.toBe('neutral');
    expect(reports).toHaveLength(1);
    expect(reports[0].tile).toBe('bos_ai_settings');
    for (const other of tiles.filter((t) => t.id !== 'bos_ai_settings' && t.id !== 'scheduled_jobs' && t.id !== 'queues')) {
      expect(other.status).toBe('neutral');
    }
  });
});

// ── Unavailable and not measured ────────────────────────────────────────────

describe('failed reads and the not-measured tiles', () => {
  it.each(['settings', 'failures', 'spend', 'critical', 'entitlements'] as const)(
    'a failed %s read → its tile is unavailable, never Normal',
    (key) => {
      const inputs = quietInputs();
      (inputs as unknown as Record<string, unknown>)[key] = { ok: false };
      const tiles = evaluateHealth(inputs);
      const unavailable = tiles.filter((t) => t.status === 'unavailable');
      expect(unavailable).toHaveLength(1);
      expect(unavailable[0].headline).toBe(UNAVAILABLE_HEADLINE);
    }
  );

  it('scheduled jobs and queues are always not measured, with no link and no rules', () => {
    for (const inputs of [quietInputs(), inputsFor('bos_ai_spend', { spend24h: lb(999) })]) {
      for (const id of ['scheduled_jobs', 'queues']) {
        const tile = tileOf(evaluateHealth(inputs), id);
        expect(tile.status).toBe('not_measured');
        expect(tile.headline).toBe(NOT_MEASURED_HEADLINE);
        expect(tile.rules).toEqual([]);
        expect(tile.figures.every((f) => f.href === null)).toBe(true);
      }
    }
  });
});

// ── Figures and links ──────────────────────────────────────────────────────

describe('figures and links', () => {
  it('the failures tile counts the audit event the audit page is linked to', () => {
    expect(AI_FAILED_ACTION).toBe(AUDIT_EVENTS.BUSINESS_AI_ACTION_FAILED);
    const tile = tileOf(evaluateHealth(inputsFor('bos_ai_failures', { failed24h: ex(3), completed24h: ex(7) })), 'bos_ai_failures');
    const day = tile.figures[0];
    expect(day.value).toBe('3 of 10 actions');
    expect(day.href).toBe(
      '/admin/audit-trail?action=BUSINESS_AI_ACTION_FAILED&date_from=2026-09-25T10%3A30&date_to=2026-09-26T10%3A30'
    );
    expect(day.linkLabel).toBe('Failed AI actions, last 24 hours: 3, open in audit trail');
  });

  it('the spend tile links to AI cost & usage with the exact ISO window', () => {
    const tile = tileOf(evaluateHealth(quietInputs()), 'bos_ai_spend');
    const url = new URL(tile.figures[0].href!, 'http://x');
    expect(url.pathname).toBe('/admin/analytics');
    expect(url.searchParams.get('scope')).toBe('bos');
    expect(url.searchParams.get('dateFrom')).toBe('2026-09-25T10:30:00.000Z');
    expect(url.searchParams.get('dateTo')).toBe('2026-09-26T10:30:00.000Z');
  });

  it('the OI-P1 note appears only above 1,000 calls, and never when the count failed', () => {
    const inputs = quietInputs();
    if (!inputs.spend.ok) throw new Error('fixture');
    inputs.spend.value.sums.calls7d = ex(1500);
    let tile = tileOf(evaluateHealth(inputs), 'bos_ai_spend');
    expect(tile.figures[1].note).toBe(OI_P1_NOTE);
    expect(tile.figures[0].note).toBeNull();

    inputs.spend.value.callsKnown = false;
    tile = tileOf(evaluateHealth(inputs), 'bos_ai_spend');
    expect(tile.figures[1].note).toBeNull();
    expect(tile.figures[1].value).not.toContain('calls');
  });

  it('the entitlements tile shows the mode, and the refused reason says where the requested value lives', () => {
    let tile = tileOf(evaluateHealth(quietInputs()), 'entitlements_mode');
    expect(tile.figures[0].value).toBe('Off');
    expect(tile.headline).toBe(NORMAL_HEADLINE);
    tile = tileOf(evaluateHealth(inputsFor('entitlements_mode', {}, { entitlementEnforceRefused: true })), 'entitlements_mode');
    expect(tile.status).toBe('amber');
    expect(tile.figures[0].note).toMatch(/BOS_ENTITLEMENTS_MODE/);
  });

  it('the settings tile carries area labels only', () => {
    const inputs = quietInputs();
    inputs.settings = { ok: true, value: { areasOff: 1, callsOff: 2, ignored: 0, adjusted: 1, offAreas: ['insights'], ignoredAreas: [] } };
    const tile = tileOf(evaluateHealth(inputs), 'bos_ai_settings');
    expect(tile.headline).toBe(HEALTH_RULES.bos_ai_settings.find((r) => r.id === 'settings.off')!.description);
    expect(tile.figures[0].note).toBe('insights');
  });
});

// ── C-10 no green: fuzz over inputs AND rule lists (C-20) ─────────────────

function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function randomCondition(tile: MeasuredTileId, r: () => number): HealthCondition<MetricId, FlagId> {
  const { metrics, flags } = TILE_VOCABULARY[tile];
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  if (metrics.length === 0) return { kind: 'flag', flag: pick(flags) };
  const kinds = ['atLeast', 'ratioAtLeast', 'shareAtLeast', 'anyLowerBound', ...(flags.length ? ['flag'] : [])];
  switch (pick(kinds)) {
    case 'ratioAtLeast':
      return { kind: 'ratioAtLeast', metric: pick(metrics), baseline: pick(metrics), factor: 0.5 + r() * 4, floor: r() * 30 };
    case 'shareAtLeast':
      return { kind: 'shareAtLeast', numerator: pick(metrics), other: pick(metrics), rate: r(), minTotal: Math.floor(r() * 20) };
    case 'anyLowerBound':
      return { kind: 'anyLowerBound', metrics: metrics.filter(() => r() > 0.3).concat(pick(metrics)) };
    case 'flag':
      return { kind: 'flag', flag: pick(flags) };
    default:
      return { kind: 'atLeast', metric: pick(metrics), value: r() * 30 };
  }
}

function randomRuleSet(r: () => number): HealthRuleSet {
  const set: Record<string, HealthRule<MetricId, FlagId>[]> = {};
  for (const tile of MEASURED) {
    const n = Math.floor(r() * 5);
    set[tile] = Array.from({ length: n }, (_, i) => ({
      id: `${tile}.${i}`,
      priority: i * 10 + Math.floor(r() * 9),
      colour: r() > 0.5 ? 'red' : 'amber',
      description: `Rule ${i}`,
      condition: randomCondition(tile, r),
    }));
  }
  return set as unknown as HealthRuleSet;
}

function randomMeasured(r: () => number): Measured {
  return { value: Math.floor(r() * 40) * (r() > 0.5 ? 1 : 0.37), exact: r() > 0.3 };
}

function randomInputs(r: () => number): HealthInputs {
  const maybe = <T,>(value: T) => (r() > 0.1 ? { ok: true as const, value } : { ok: false as const });
  const n = () => Math.floor(r() * 12);
  return {
    windows: W,
    settings: maybe({ areasOff: n(), callsOff: n(), ignored: n(), adjusted: n(), offAreas: [], ignoredAreas: [] }),
    failures: maybe({ failed24h: n(), failed7d: n(), completed24h: n() }),
    spend: maybe({
      sums: {
        spend24h: randomMeasured(r), spendPrev24h: randomMeasured(r), spend7d: randomMeasured(r),
        spendPrev7d: randomMeasured(r), calls24h: randomMeasured(r), calls7d: randomMeasured(r),
      },
      callsKnown: r() > 0.3,
    }),
    critical: maybe({ last24h: n(), last7d: n() }),
    entitlements: maybe({ effective: (['off', 'shadow', 'enforce'] as const)[Math.floor(r() * 3)], refused: r() > 0.7 }),
  };
}

describe('C-10 / C-20 fuzz: random valid rule lists × random inputs', () => {
  it('never throws, never leaves the status union, never reads a lower bound as Normal', () => {
    const r = prng(20260926);
    for (let i = 0; i < 2000; i += 1) {
      const rules = r() > 0.2 ? randomRuleSet(r) : HEALTH_RULES;
      const inputs = randomInputs(r);
      const errors: unknown[] = [];
      const tiles = evaluateHealth(inputs, { rules, onRuleError: (e) => errors.push(e) });

      expect(errors).toEqual([]); // every generated list is valid
      expect(tiles).toHaveLength(7);
      for (const tile of tiles) {
        expect(STATUSES).toContain(tile.status);
        expect(tile.status as string).not.toBe('green');
      }
      const spend = tileOf(tiles, 'bos_ai_spend');
      if (inputs.spend.ok) {
        const s = inputs.spend.value.sums;
        if ([s.spend24h, s.spendPrev24h, s.spend7d, s.spendPrev7d].some((m) => !m.exact)) {
          expect(spend.status).not.toBe('neutral');
        }
      }
    }
  });
});

describe('purity (C-6)', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'lib/admin/health/evaluateHealth.ts'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('reads no clock, imports nothing from app/ or a repository, and never names the admin ledger repository', () => {
    expect(code).not.toMatch(/Date\.now\(|new Date\(\)/);
    expect(code).not.toMatch(/from ['"]@\/app\//);
    expect(code).not.toMatch(/from ['"]@\/lib\/repositories/);
    expect(code).not.toMatch(/AdminTokenUsageAnalyticsRepository|server-only/);
  });
});
