/**
 * TRIPWIRE (upgrade modal C-27, UM-D1-M): at most two plans are shown to customers.
 *
 * The upgrade modal's comparison table puts one column per shown plan, and its
 * phone layout (UM-D1-M, option M-A: sticky plan header row, compact cells, no
 * horizontal scroll at 360 px) was decided for TWO plan columns. A third shown
 * plan would not fail anywhere else: the server would simply send a third column
 * and the phone layout would overflow in front of a customer.
 *
 * If this fails, you are about to show a third plan. Before you do, re-decide
 * UM-D1-M with the user (M-A vs M-B, BUSINESS_OS_UPGRADE_MODAL_REQUIREMENT.md
 * §4.5 / C-24), then raise the limit here in the same change.
 *
 * Reads server config only (no tier name is written here), so it lands in UM-0
 * with the data it guards (SA Q-7).
 */

import { shownPlanChoices } from '@/lib/business-os/entitlements/customerPlanView';
import { readCodeConfig } from '@/lib/business-os/entitlements/source';

const MAX_PLAN_COLUMNS = 2;

describe('UM-D1-M tripwire: the comparison table assumes at most two plan columns', () => {
  it('at most two plans are shown to customers', () => {
    const shown = shownPlanChoices(readCodeConfig()).map((choice) => choice.planId);

    if (shown.length > MAX_PLAN_COLUMNS) {
      throw new Error(
        `${shown.length} plans are shown to customers (${shown.join(', ')}). The upgrade modal's phone layout ` +
          '(UM-D1-M) assumes two plan columns: re-decide M-A / M-B with the user before showing a third, then raise ' +
          'MAX_PLAN_COLUMNS in this file.'
      );
    }
    // Non-vacuity: there is a comparison to make at all.
    expect(shown.length).toBeGreaterThan(1);
  });
});
