/**
 * QA probes for admin reorganisation slice 5, PR-1 (part E, C-10R / RC-5.2).
 *
 * Adversarial edge cases over the real evaluator: green only when proven clear,
 * entitlements never green in any mode, a lower bound is amber never green,
 * tiles 6/7 stay "Not measured yet", failed reads and invalid rule lists are
 * "Could not check", and every figure label describes itself.
 */

import {
  colourTile,
  evaluateHealth,
  GREEN_ELIGIBLE,
  GREEN_HEADLINE,
  LOWER_BOUND_HEADLINE,
  NOT_MEASURED_HEADLINE,
  UNAVAILABLE_HEADLINE,
  type HealthInputs,
  type TileMeasurement,
} from '../evaluateHealth';
import { HEALTH_RULES, type HealthRuleSet } from '../rules';
import { computeHealthWindows } from '../windows';
import type { HealthTile } from '../healthTypes';

const W = computeHealthWindows(new Date('2026-09-27T10:30:00Z'));
const m = (value: number, exact = true) => ({ value, exact });

function inputs(over: Partial<HealthInputs> = {}): HealthInputs {
  return {
    windows: W,
    settings: { ok: true, value: { areasOff: 0, callsOff: 0, ignored: 0, adjusted: 0, offAreas: [], ignoredAreas: [] } },
    failures: { ok: true, value: { failed24h: 0, failed7d: 0, completed24h: 0 } },
    spend: {
      ok: true,
      value: {
        sums: { spend24h: m(0), spendPrev24h: m(0), spend7d: m(0), spendPrev7d: m(0), calls24h: m(0), calls7d: m(0) },
        callsKnown: true,
      },
    },
    critical: { ok: true, value: { last24h: 0, last7d: 0 } },
    entitlements: { ok: true, value: { effective: 'shadow', refused: false } },
    ...over,
  };
}

const byId = (tiles: HealthTile[], id: string) => tiles.find((t) => t.id === id)!;
const ELIGIBLE_MEASURED = ['bos_ai_settings', 'bos_ai_failures', 'bos_ai_spend', 'critical_audit'] as const;

describe('QA S5: green only when measured, exact, eligible and no rule matched', () => {
  it('a quiet day: the four measured eligible tiles are green "All clear"; entitlements is not', () => {
    const tiles = evaluateHealth(inputs());
    for (const id of ELIGIBLE_MEASURED) {
      expect(byId(tiles, id)).toMatchObject({ status: 'green', headline: GREEN_HEADLINE, matchedRuleId: null });
    }
    expect(byId(tiles, 'entitlements_mode').status).toBe('neutral');
  });

  it('the settings tile with zero areas off is green (the user report)', () => {
    const t = byId(evaluateHealth(inputs()), 'bos_ai_settings');
    expect(t.status).toBe('green');
    expect(t.figures.find((f) => f.label === 'Areas configured off')?.value).toBe('0');
  });

  it('an informational "adjusted" count alone does not stop green (no rule on it)', () => {
    const t = byId(
      evaluateHealth(
        inputs({ settings: { ok: true, value: { areasOff: 0, callsOff: 0, ignored: 0, adjusted: 4, offAreas: [], ignoredAreas: [] } } })
      ),
      'bos_ai_settings'
    );
    expect(t.status).toBe('green');
  });

  it.each([
    ['settings off', { settings: { ok: true as const, value: { areasOff: 1, callsOff: 0, ignored: 0, adjusted: 0, offAreas: ['Chat'], ignoredAreas: [] } } }, 'bos_ai_settings'],
    ['critical event', { critical: { ok: true as const, value: { last24h: 1, last7d: 1 } } }, 'critical_audit'],
  ])('a matching rule wins over green (%s)', (_n, over, id) => {
    const t = byId(evaluateHealth(inputs(over as Partial<HealthInputs>)), id);
    expect(t.status).not.toBe('green');
    expect(t.matchedRuleId).not.toBeNull();
  });

  it.each(['settings', 'failures', 'spend', 'critical', 'entitlements'] as const)(
    'a failed %s read is "Could not check", never green',
    (key) => {
      const tiles = evaluateHealth(inputs({ [key]: { ok: false } } as Partial<HealthInputs>));
      const id = {
        settings: 'bos_ai_settings',
        failures: 'bos_ai_failures',
        spend: 'bos_ai_spend',
        critical: 'critical_audit',
        entitlements: 'entitlements_mode',
      }[key];
      expect(byId(tiles, id)).toMatchObject({ status: 'unavailable', headline: UNAVAILABLE_HEADLINE });
    }
  );

  it.each(['bos_ai_settings', 'bos_ai_failures', 'bos_ai_spend', 'critical_audit', 'entitlements_mode'] as const)(
    'an invalid rule list on %s is "Could not check" (not a list, a green rule, an OK description)',
    (id) => {
      const bads: unknown[] = [
        'nope',
        [{ id: 'x', priority: 1, colour: 'green', description: 'fine', condition: { kind: 'flag', flag: 'entitlementEnforceRefused' } }],
        [{ id: 'x', priority: 1, colour: 'amber', description: 'All OK', condition: { kind: 'flag', flag: 'entitlementEnforceRefused' } }],
      ];
      for (const bad of bads) {
        const rules = { ...HEALTH_RULES, [id]: bad } as unknown as HealthRuleSet;
        const t = byId(evaluateHealth(inputs(), { rules, onRuleError: () => undefined }), id);
        expect(t.status).toBe('unavailable');
        expect(t.status).not.toBe('green');
      }
    }
  );

  it('an empty (valid) rule list on an eligible tile with exact figures is green, never neutral', () => {
    const rules = { ...HEALTH_RULES, critical_audit: [] } as HealthRuleSet;
    expect(byId(evaluateHealth(inputs(), { rules }), 'critical_audit').status).toBe('green');
  });
});

describe('QA S5: a lower-bound spend is amber, never green', () => {
  const lb = (over: Partial<Record<string, ReturnType<typeof m>>>) =>
    inputs({
      spend: {
        ok: true,
        value: {
          sums: { spend24h: m(0), spendPrev24h: m(0), spend7d: m(0), spendPrev7d: m(0), calls24h: m(0), calls7d: m(0), ...over },
          callsKnown: true,
        },
      },
    });

  it.each(['spend24h', 'spendPrev24h', 'spend7d', 'spendPrev7d'])('%s inexact → amber', (key) => {
    const t = byId(evaluateHealth(lb({ [key]: m(0.5, false) })), 'bos_ai_spend');
    expect(t.status).toBe('amber');
  });

  it('with every spend rule deleted, a lower bound is still amber LOWER_BOUND_HEADLINE', () => {
    const rules = { ...HEALTH_RULES, bos_ai_spend: [] } as HealthRuleSet;
    const t = byId(evaluateHealth(lb({ spend7d: m(1, false) }), { rules }), 'bos_ai_spend');
    expect(t).toMatchObject({ status: 'amber', headline: LOWER_BOUND_HEADLINE });
  });

  it('an inexact FIGURE over exact metrics on spend is amber (C-18 strengthened)', () => {
    const measurement: TileMeasurement = {
      metrics: { spend24h: m(0) },
      flags: {},
      figures: [{ label: 'AI spend', value: 'at least $1', exact: false, href: null, linkLabel: null, note: null }],
      footnote: null,
      completeness: 'complete',
    };
    expect(colourTile('bos_ai_spend', [], measurement).status).toBe('amber');
  });

  it('the spend "otherwise" line never promises green unconditionally', () => {
    const t = byId(evaluateHealth(inputs()), 'bos_ai_spend');
    expect(t.otherwise).toMatch(/unless a figure is only a minimum/);
  });
});

describe('QA S5: the entitlements tile is never green, in any mode', () => {
  const MODES = [
    ['off', false, 'neutral', 'Off mode: Plans are not checked.'],
    ['shadow', false, 'neutral', 'Shadow mode: Plans are checked and logged; nothing is blocked.'],
    ['enforce', false, 'neutral', 'Enforce mode: Plan limits are applied to customers.'],
    ['shadow', true, 'amber', 'Enforcement requested but not active'],
  ] as const;

  it.each(MODES)('effective=%s refused=%s → %s "%s"', (effective, refused, status, headline) => {
    const t = byId(evaluateHealth(inputs({ entitlements: { ok: true, value: { effective, refused } } })), 'entitlements_mode');
    expect(t.status).toBe(status);
    expect(t.status).not.toBe('green');
    expect(t.headline).toBe(headline);
    expect(t.figures).toHaveLength(1);
    expect(t.figures[0].label).toBe('Mode in effect');
    expect(t.pageLink).toEqual({ href: '/admin/business-os-tiers', text: 'Open Plans & entitlements (plans and account lookup)' });
    expect(t.otherwise).toMatch(/never green/);
  });

  it('the refused case carries its note on the "Mode in effect" figure', () => {
    const t = byId(evaluateHealth(inputs({ entitlements: { ok: true, value: { effective: 'shadow', refused: true } } })), 'entitlements_mode');
    expect(t.figures[0].value).toBe('Shadow');
    expect(t.figures[0].note).toMatch(/asks for enforce, but the launch gate refused it/);
  });

  it('even with an empty rule list the refused case is not green (neutral at worst)', () => {
    const rules = { ...HEALTH_RULES, entitlements_mode: [] } as HealthRuleSet;
    for (const effective of ['off', 'shadow', 'enforce'] as const) {
      for (const refused of [true, false]) {
        const t = byId(evaluateHealth(inputs({ entitlements: { ok: true, value: { effective, refused } } }), { rules }), 'entitlements_mode');
        expect(t.status).not.toBe('green');
      }
    }
  });

  it('entitlements_mode is not GREEN_ELIGIBLE, and colourTile cannot make it green directly', () => {
    expect(GREEN_ELIGIBLE.has('entitlements_mode')).toBe(false);
    const clean: TileMeasurement = { metrics: {}, flags: {}, figures: [], footnote: null, completeness: 'complete' };
    expect(colourTile('entitlements_mode', [], clean).status).toBe('neutral');
  });

  it('no digit appears in the tile text in any mode (FR-E3)', () => {
    for (const [effective, refused] of MODES) {
      const t = byId(evaluateHealth(inputs({ entitlements: { ok: true, value: { effective, refused } } })), 'entitlements_mode');
      const text = [t.headline, t.title, t.pageLink?.text, ...t.figures.flatMap((f) => [f.label, f.value, f.note ?? ''])].join(' ');
      expect(text).not.toMatch(/\d/);
    }
  });
});

describe('QA S5: tiles 6 and 7 stay "Not measured yet"', () => {
  it.each([
    ['quiet day', inputs()],
    ['everything failed', inputs({ settings: { ok: false }, failures: { ok: false }, spend: { ok: false }, critical: { ok: false }, entitlements: { ok: false } })],
  ])('%s', (_n, i) => {
    const tiles = evaluateHealth(i);
    for (const id of ['scheduled_jobs', 'queues']) {
      expect(byId(tiles, id)).toMatchObject({ status: 'not_measured', headline: NOT_MEASURED_HEADLINE, pageLink: null, rules: [] });
    }
  });
});

describe('QA S5: colourTile direct seams', () => {
  const base: TileMeasurement = { metrics: { critical24h: m(0) }, flags: {}, figures: [], footnote: null, completeness: 'complete' };
  it('partial → unavailable; not_measured → not_measured; complete → green', () => {
    expect(colourTile('critical_audit', [], { ...base, completeness: 'partial' }).status).toBe('unavailable');
    expect(colourTile('critical_audit', [], { ...base, completeness: 'not_measured' }).status).toBe('not_measured');
    expect(colourTile('critical_audit', [], base).status).toBe('green');
  });
  it('an inexact metric on a non-lower-bound tile is never green', () => {
    expect(colourTile('critical_audit', [], { ...base, metrics: { critical24h: m(0, false) } }).status).toBe('unavailable');
  });
  it('a null measurement is unavailable', () => {
    expect(colourTile('bos_ai_settings', [], null).status).toBe('unavailable');
  });
});

describe('QA S5: every Health figure label describes itself', () => {
  it('no label is a bare window ("Last 24 h", "Last 7 days", "Mode") and none is empty', () => {
    const scenarios = [
      inputs(),
      inputs({ entitlements: { ok: true, value: { effective: 'shadow', refused: true } } }),
      inputs({ critical: { ok: true, value: { last24h: 3, last7d: 9 } } }),
    ];
    for (const i of scenarios) {
      for (const t of evaluateHealth(i)) {
        for (const f of t.figures) {
          expect(f.label.trim()).not.toBe('');
          expect(f.label).not.toMatch(/^(last|previous)\b/i);
          expect(f.label).not.toBe('Mode');
          // A self-describing label names its subject in words, not only a window.
          expect(f.label.replace(/last|previous|24 h|7 days|\(.*?\)|,/gi, '').trim().length).toBeGreaterThan(3);
        }
      }
    }
  });
});
