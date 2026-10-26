/**
 * TRIPWIRE (upgrade modal C-27, UM-D1-M; amended by live-test fix LF-2,
 * 2026-10-20): at most two plans are shown to customers, and the comparison
 * table never has more than THREE columns.
 *
 * The upgrade modal's comparison table puts one column per shown plan, plus,
 * since LF-2, the account's own plan as a first column when it is not a tier (a
 * trial or a Founding Partner). Its phone layout (UM-D1-M, option M-A: sticky
 * plan header row, compact cells, no horizontal scroll at 360 px) was decided for
 * two plan columns and extended to three (`PHONE_ROW` in `UpgradeModal.tsx`:
 * `max-sm:grid-cols-2` / `max-sm:grid-cols-3`, a compact header for three). A
 * third shown plan would not fail anywhere else: the server would simply send
 * another column and the phone layout would overflow in front of a customer.
 *
 * The rule, now:
 *   - at most two shown plans (`MAX_PLAN_COLUMNS`), and
 *   - for EVERY account shape the server can answer (each shown tier, each
 *     cohort), own column + shown plans ≤ three (`MAX_TABLE_COLUMNS`).
 *
 * If this fails, you are about to show a third plan (or a fourth column). Before
 * you do, re-decide UM-D1-M with the user (M-A vs M-B,
 * BUSINESS_OS_UPGRADE_MODAL_REQUIREMENT.md §4.5 / C-24), then raise the limits
 * here and the grid classes in `UpgradeModal.tsx` in the same change.
 *
 * Reads server config only (no tier or cohort name is written here), so it lands
 * with the data it guards (SA Q-7).
 */

import { buildCustomerPlanView, shownPlanChoices } from '@/lib/business-os/entitlements/customerPlanView';
import { previewAccountFor } from '@/lib/business-os/entitlements/planPresentation';
import { resolveEntitlements } from '@/lib/business-os/entitlements/resolver';
import { readCodeConfig } from '@/lib/business-os/entitlements/source';

const MAX_PLAN_COLUMNS = 2;
const MAX_TABLE_COLUMNS = 3;

const config = readCodeConfig();
const NOW = new Date('2026-10-20T00:00:00.000Z');

describe('UM-D1-M tripwire: the comparison table assumes at most two plans and three columns', () => {
  it('at most two plans are shown to customers', () => {
    const shown = shownPlanChoices(config).map((choice) => choice.planId);

    if (shown.length > MAX_PLAN_COLUMNS) {
      throw new Error(
        `${shown.length} plans are shown to customers (${shown.join(', ')}). The upgrade modal's phone layout ` +
          '(UM-D1-M) assumes two plan columns plus one own-plan column: re-decide M-A / M-B with the user before ' +
          'showing a third, then raise MAX_PLAN_COLUMNS in this file.'
      );
    }
    // Non-vacuity: there is a comparison to make at all.
    expect(shown.length).toBeGreaterThan(1);
  });

  it('no account shape gets more than three table columns (own plan + shown plans)', () => {
    const shapes = [...shownPlanChoices(config).map((choice) => choice.planId), ...Object.keys(config.cohorts)];
    let sawOwnColumn = false;
    for (const planId of shapes) {
      const resolution = resolveEntitlements({ config, account: previewAccountFor(config, planId, NOW), overrides: [], addons: [], now: NOW });
      const comparison = buildCustomerPlanView({ resolution, unavailable: false, now: NOW, config }).comparison;
      expect(comparison).not.toBeNull();
      const columns = comparison!.planIds.length + (comparison!.current ? 1 : 0);
      if (comparison!.current) sawOwnColumn = true;
      if (columns > MAX_TABLE_COLUMNS) {
        throw new Error(
          `An account on ${planId} would see ${columns} comparison columns. The phone layout handles at most ` +
            `${MAX_TABLE_COLUMNS} (PHONE_ROW in UpgradeModal.tsx): re-decide UM-D1-M with the user first.`
        );
      }
    }
    // Non-vacuity: some account shape really has the own-plan column (a cohort).
    expect(sawOwnColumn).toBe(true);
  });
});
