/**
 * The plan comparison's grouped rows (`config/planComparison.ts`) — the guards
 * that keep a grouped ✓ honest (user decision UM-D2, SA workplan review S-1..S-7).
 *
 * ── Why these guards exist ──────────────────────────────────────────────────
 * Grouping capabilities into short rows trades precision for readability. Each
 * guard closes one way that trade could put a false claim on screen:
 *
 *   - coverage: a capability a shown plan grants is missing from the table;
 *   - no all-✕ row: a row describes something no plan has (and so, rule 2 of
 *     `customerPlanView.noExclusions`, something that may not exist);
 *   - no partial row: ✕ hides something the plan DOES include;
 *   - no hidden difference / variant at its best: ✓ hides that two plans grant
 *     different things, or a label promises more than a plan gives;
 *   - section agreement: a row is filed under a heading its members do not
 *     belong to.
 *
 * Every guard is a function over (rows, config) and carries a planted-violation
 * self-test, so a guard that silently stopped checking would fail here rather
 * than pass for the wrong reason.
 *
 * Only tiers SHOWN to customers count (SA S-5): a hidden tier can neither satisfy
 * nor break a guard.
 */

import {
  isAmountShape,
  isHiddenFromCustomer,
  comparisonSectionForCategory,
  SECTION_PRESENTATION,
  shownPlanChoices,
} from '@/lib/business-os/entitlements/customerPlanView';
import { describePlanCapabilities, previewAccountFor } from '@/lib/business-os/entitlements/planPresentation';
import { resolveEntitlements } from '@/lib/business-os/entitlements/resolver';
import { readCodeConfig, type EntitlementConfig } from '@/lib/business-os/entitlements/source';
import {
  PLAN_COMPARISON_ROWS,
  type PlanComparisonRowConfig,
} from '@/lib/business-os/entitlements/config/planComparison';
import type { CapabilityId } from '@/lib/business-os/entitlements/config/catalog';
import type { CapabilityDef, CapabilityValue } from '@/lib/business-os/entitlements/types';

const NOW = new Date('2026-10-19T00:00:00.000Z');
const PRODUCTION = readCodeConfig();
type Rows = ReadonlyArray<PlanComparisonRowConfig>;

/** The shown tiers, each resolved as defined, with its described rows by capability. */
function shownPlans(config: EntitlementConfig) {
  const catalog = config.catalog as Record<string, CapabilityDef>;
  return shownPlanChoices(config).map(({ planId }) => {
    const resolution = resolveEntitlements({
      config,
      account: previewAccountFor(config, planId, NOW),
      overrides: [],
      addons: [],
      now: NOW,
    });
    return {
      planId,
      values: resolution.values as Record<string, { value: CapabilityValue } | undefined>,
      described: new Map(describePlanCapabilities(resolution, catalog).map((row) => [row.capability, row])),
    };
  });
}

function catalogOf(config: EntitlementConfig) {
  return config.catalog as Record<string, CapabilityDef>;
}

function isVisible(config: EntitlementConfig, capability: string): boolean {
  const definition = catalogOf(config)[capability];
  return !!definition && !isHiddenFromCustomer(capability, definition);
}

function granted(plan: ReturnType<typeof shownPlans>[number], capability: string): boolean {
  return plan.described.get(capability)?.granting === true;
}

function isAmountRow(config: EntitlementConfig, row: PlanComparisonRowConfig): boolean {
  const catalog = catalogOf(config);
  return row.capabilities.every((capability) => !!catalog[capability] && isAmountShape(catalog[capability]));
}

// ── The guards, as functions so each can be fed a planted violation ─────────

function coverageProblems(rows: Rows, config: EntitlementConfig): string[] {
  const plans = shownPlans(config);
  const counts = new Map<string, number>();
  for (const row of rows) for (const capability of row.capabilities) counts.set(capability, (counts.get(capability) ?? 0) + 1);

  return Object.keys(catalogOf(config))
    .filter((capability) => isVisible(config, capability) && plans.some((plan) => granted(plan, capability)))
    .filter((capability) => (counts.get(capability) ?? 0) !== 1)
    .map(
      (capability) =>
        `${capability} is in ${counts.get(capability) ?? 0} rows: add it to exactly one row in config/planComparison.ts`
    );
}

function memberProblems(rows: Rows, config: EntitlementConfig): string[] {
  const catalog = catalogOf(config);
  return rows.flatMap((row) =>
    row.capabilities
      .filter((capability) => !catalog[capability] || catalog[capability].lifecycle === 'not_built')
      .map((capability) => `${row.id}: ${capability} is not in the catalog or is not_built, so it may not be named`)
  );
}

function uniquenessProblems(rows: Rows): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const members = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id)) problems.push(`row id ${row.id} is used twice`);
    ids.add(row.id);
    for (const capability of row.capabilities) {
      if (members.has(capability)) problems.push(`${capability} is listed twice`);
      members.add(capability);
    }
  }
  return problems;
}

function allCrossProblems(rows: Rows, config: EntitlementConfig): string[] {
  const plans = shownPlans(config);
  return rows
    .filter((row) => !plans.some((plan) => row.capabilities.every((capability) => granted(plan, capability))))
    .map((row) => `${row.id}: no plan shown to customers includes the whole row`);
}

function partialProblems(rows: Rows, config: EntitlementConfig): string[] {
  const plans = shownPlans(config);
  return rows.flatMap((row) =>
    plans
      .filter((plan) => {
        const states = new Set(row.capabilities.map((capability) => granted(plan, capability)));
        return states.size > 1;
      })
      .map((plan) => `${row.id}: ${plan.planId} grants some members and not others, so split the row`)
  );
}

function hiddenDifferenceProblems(rows: Rows, config: EntitlementConfig): string[] {
  const plans = shownPlans(config);
  return rows
    .filter((row) => !isAmountRow(config, row))
    .flatMap((row) =>
      row.capabilities.flatMap((capability) => {
        const displays = new Set(
          plans.filter((plan) => granted(plan, capability)).map((plan) => plan.described.get(capability)?.display)
        );
        return displays.size > 1 ? [`${row.id}: ${capability} reads differently across plans (${[...displays].join(' / ')})`] : [];
      })
    );
}

/** "Highest" = the LAST entry of the shape's `variants` (catalog orders them low to high, SA S-3). */
function variantProblems(rows: Rows, config: EntitlementConfig): string[] {
  const catalog = catalogOf(config);
  const plans = shownPlans(config);
  return rows
    .filter((row) => !isAmountRow(config, row))
    .flatMap((row) =>
      row.capabilities.flatMap((capability) => {
        const shape = catalog[capability]?.shape;
        if (shape?.kind !== 'variant') return [];
        const highest = shape.variants[shape.variants.length - 1];
        return plans
          .filter((plan) => granted(plan, capability) && plan.values[capability]?.value !== highest)
          .map((plan) => `${row.id}: ${plan.planId} grants ${capability} below its highest variant (${highest})`);
      })
    );
}

function sectionProblems(rows: Rows, config: EntitlementConfig): string[] {
  const catalog = catalogOf(config);
  return rows.flatMap((row) => {
    const amount = row.capabilities.map((capability) => isAmountShape(catalog[capability]));
    if (new Set(amount).size > 1) return [`${row.id}: mixes amount and feature capabilities`];
    if (amount[0]) return [];
    const sections = new Set(row.capabilities.map((capability) => comparisonSectionForCategory(catalog[capability].category)));
    return sections.size > 1 ? [`${row.id}: members fall under different sections (${[...sections].join(', ')})`] : [];
  });
}

function categoryProblems(categories: readonly string[]): string[] {
  const known = new Set(SECTION_PRESENTATION.map((entry) => entry.section));
  return categories
    .filter((category) => {
      const section = comparisonSectionForCategory(category);
      return section === undefined || !known.has(section);
    })
    .map((category) => `catalog category ${category} has no comparison section`);
}

/** The same pattern `customerPlanView.noExclusions.test.ts` and `planCopy.i18n.test.ts` apply. */
const exclusionPhrasing = new RegExp(
  [
    String.raw`your plan (does not|doesn't|will not|won't) (include|cover|have)`,
    String.raw`your plan excludes`,
    String.raw`\byou (do not|don't) (have|get)\b`,
    String.raw`\byou lack\b`,
    String.raw`not (included|available) (in|on) your`,
    String.raw`missing from your (plan|account)`,
  ].join('|'),
  'i'
);

function labelProblems(rows: Rows): string[] {
  return rows.flatMap((row) =>
    (['en', 'he', 'es'] as const).flatMap((locale) => {
      const label = row.labels[locale];
      if (!label || label.trim() === '') return [`${row.id}: no ${locale} label`];
      if (/\d/.test(label)) return [`${row.id}: the ${locale} label carries a figure (figures live in config values)`];
      if (exclusionPhrasing.test(label)) return [`${row.id}: the ${locale} label reads as an exclusion`];
      return [];
    })
  );
}

const ROW_COUNT = { min: 12, max: 15 };

// ── Planted violations ───────────────────────────────────────────────────────

function withoutCapability(rows: Rows, capability: string): PlanComparisonRowConfig[] {
  return rows.map((row) => ({ ...row, capabilities: row.capabilities.filter((member) => member !== capability) }));
}

function plus(rows: Rows, row: PlanComparisonRowConfig): PlanComparisonRowConfig[] {
  return [...rows, row];
}

const labels = { en: 'Planted', he: 'Planted', es: 'Planted' };

/**
 * Production with `support.level` given three variants, Essentials on the
 * middle one and Autopilot on the top one. Both grant it, they read differently,
 * and Essentials is below its highest variant — the shape the "no hidden
 * difference" and "variant at its best" guards exist for, unreachable on today's
 * two-entry variants.
 */
function threeVariantSupport(): EntitlementConfig {
  const config = readCodeConfig();
  const catalog = catalogOf(config);
  const [first, second] = config.tierOrder;
  const tiers = config.matrix.tiers as unknown as Record<string, Record<string, CapabilityValue>>;
  return {
    ...config,
    catalog: {
      ...catalog,
      'support.level': { ...catalog['support.level'], shape: { kind: 'variant', variants: ['standard', 'priority', 'premium'] } },
    } as unknown as EntitlementConfig['catalog'],
    matrix: {
      ...config.matrix,
      tiers: {
        ...tiers,
        [first]: { ...tiers[first], 'support.level': 'priority' },
        [second]: { ...tiers[second], 'support.level': 'premium' },
      },
    } as unknown as EntitlementConfig['matrix'],
  };
}

describe('the plan comparison rows (UM-D2)', () => {
  it('there is more than one shown plan, and at least one withheld capability, so the guards are not vacuous', () => {
    const plans = shownPlans(PRODUCTION);
    expect(plans.length).toBeGreaterThan(1);
    const withheld = PLAN_COMPARISON_ROWS.flatMap((row) => row.capabilities).filter((capability) =>
      plans.some((plan) => !granted(plan, capability))
    );
    expect(withheld.length).toBeGreaterThan(0);
  });

  describe('coverage: every visible capability a shown plan grants is in exactly one row', () => {
    it('holds on the production config', () => {
      expect(coverageProblems(PLAN_COMPARISON_ROWS, PRODUCTION)).toEqual([]);
    });

    it('fails when a capability is left out, and names where to put it', () => {
      const problems = coverageProblems(withoutCapability(PLAN_COMPARISON_ROWS, 'payments.reminders'), PRODUCTION);
      expect(problems).toEqual(['payments.reminders is in 0 rows: add it to exactly one row in config/planComparison.ts']);
    });

    it('fails when a capability is in two rows', () => {
      const rows = plus(PLAN_COMPARISON_ROWS, { id: 'again', labels, capabilities: ['crm.core'] });
      expect(coverageProblems(rows, PRODUCTION)).toEqual([
        'crm.core is in 2 rows: add it to exactly one row in config/planComparison.ts',
      ]);
    });
  });

  describe('members exist and are visible', () => {
    it('holds on the production config', () => {
      expect(memberProblems(PLAN_COMPARISON_ROWS, PRODUCTION)).toEqual([]);
    });

    it('fails on a not_built capability', () => {
      const rows = plus(PLAN_COMPARISON_ROWS, { id: 'unbuilt', labels, capabilities: ['marketing.mass_email'] });
      expect(memberProblems(rows, PRODUCTION)).toHaveLength(1);
    });
  });

  describe('row ids and members are unique', () => {
    it('holds on the production config', () => {
      expect(uniquenessProblems(PLAN_COMPARISON_ROWS)).toEqual([]);
    });

    it('fails on a repeated id and a repeated member', () => {
      const rows = plus(PLAN_COMPARISON_ROWS, { id: 'crm', labels, capabilities: ['crm.core'] });
      expect(uniquenessProblems(rows)).toEqual(['row id crm is used twice', 'crm.core is listed twice']);
    });
  });

  describe('no all-✕ row', () => {
    it('holds on the production config', () => {
      expect(allCrossProblems(PLAN_COMPARISON_ROWS, PRODUCTION)).toEqual([]);
    });

    it('fails on a row no shown plan includes', () => {
      const rows = plus(PLAN_COMPARISON_ROWS, { id: 'nobody', labels, capabilities: ['marketing.posts'] });
      expect(allCrossProblems(rows, PRODUCTION)).toEqual(['nobody: no plan shown to customers includes the whole row']);
    });
  });

  describe('no partial row (SA Q-1: strict)', () => {
    it('holds on the production config', () => {
      expect(partialProblems(PLAN_COMPARISON_ROWS, PRODUCTION)).toEqual([]);
    });

    it('fails when a plan grants some members of a row and not others', () => {
      const rows = plus(withoutCapability(withoutCapability(PLAN_COMPARISON_ROWS, 'crm.core'), 'chat.access'), {
        id: 'mixed',
        labels,
        capabilities: ['crm.core', 'chat.access'],
      });
      expect(partialProblems(rows, PRODUCTION).some((problem) => problem.startsWith('mixed:'))).toBe(true);
    });
  });

  describe('no hidden difference, and variants at their best (SA S-3)', () => {
    it('hold on the production config', () => {
      expect(hiddenDifferenceProblems(PLAN_COMPARISON_ROWS, PRODUCTION)).toEqual([]);
      expect(variantProblems(PLAN_COMPARISON_ROWS, PRODUCTION)).toEqual([]);
    });

    it('fail when two plans grant a member differently, or one grants it below its highest variant', () => {
      const planted = threeVariantSupport();
      expect(hiddenDifferenceProblems(PLAN_COMPARISON_ROWS, planted)).toEqual([
        'support: support.level reads differently across plans (priority / premium)',
      ]);
      expect(variantProblems(PLAN_COMPARISON_ROWS, planted)).toEqual([
        `support: ${planted.tierOrder[0]} grants support.level below its highest variant (premium)`,
      ]);
    });
  });

  describe('sections (C-20)', () => {
    it('every row agrees on its section, on the production config', () => {
      expect(sectionProblems(PLAN_COMPARISON_ROWS, PRODUCTION)).toEqual([]);
    });

    it('fails on a row mixing an amount with a feature, or two sections', () => {
      expect(
        sectionProblems([{ id: 'mixed_shape', labels, capabilities: ['credits.allowance', 'crm.core'] }], PRODUCTION)
      ).toEqual(['mixed_shape: mixes amount and feature capabilities']);
      expect(
        sectionProblems([{ id: 'two_sections', labels, capabilities: ['crm.core', 'chat.access'] }], PRODUCTION)
      ).toHaveLength(1);
    });

    it('every catalog category maps to a section that exists', () => {
      const categories = [...new Set(Object.values(catalogOf(PRODUCTION)).map((definition) => definition.category))];
      expect(categories.length).toBeGreaterThan(1);
      expect(categoryProblems(categories)).toEqual([]);
      // Self-test: an unknown category is caught.
      expect(categoryProblems([...categories, 'made_up'])).toEqual(['catalog category made_up has no comparison section']);
    });
  });

  describe('row count (UM-D2: 12 to 15; changing the range is a user decision)', () => {
    it('is inside the range', () => {
      expect(PLAN_COMPARISON_ROWS.length).toBeGreaterThanOrEqual(ROW_COUNT.min);
      expect(PLAN_COMPARISON_ROWS.length).toBeLessThanOrEqual(ROW_COUNT.max);
    });
  });

  describe('labels', () => {
    it('are present in three languages, carry no figure, and read as no exclusion', () => {
      expect(labelProblems(PLAN_COMPARISON_ROWS)).toEqual([]);
    });

    it('fail on a missing language, a figure, or exclusion phrasing', () => {
      const bad: PlanComparisonRowConfig[] = [
        { id: 'empty', labels: { en: 'Fine', he: '', es: 'Bien' }, capabilities: ['crm.core'] },
        { id: 'figure', labels: { en: 'Fine', he: 'Fine', es: 'Hasta 19.750' }, capabilities: ['crm.core'] },
        { id: 'excludes', labels: { en: 'Your plan does not include chat', he: 'x', es: 'x' }, capabilities: ['crm.core'] },
      ];
      expect(labelProblems(bad)).toEqual([
        'empty: no he label',
        'figure: the es label carries a figure (figures live in config values)',
        'excludes: the en label reads as an exclusion',
      ]);
    });
  });

  it('the members are typed capability ids (a typo does not compile)', () => {
    // Compile-time: `capabilities: readonly CapabilityId[]`. Pinned at runtime too,
    // so a cast that widened the type would still be caught.
    const ids = new Set<string>(Object.keys(catalogOf(PRODUCTION)));
    const members: CapabilityId[] = PLAN_COMPARISON_ROWS.flatMap((row) => [...row.capabilities]);
    expect(members.filter((capability) => !ids.has(capability))).toEqual([]);
  });
});
