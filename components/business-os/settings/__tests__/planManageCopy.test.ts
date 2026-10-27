/**
 * Every refusal code the cancel / reactivate engine can answer has a line on
 * the Settings → Plan screen (D2 / SX-1, SA code review F-1).
 *
 * `PLAN_MANAGE_REFUSAL_KEYS` is typed over `PlanManageRefusalCode`, but type
 * errors never reach the build here (`next.config.js` ignores them) and Jest
 * does not type-check, so a new code could ship with no line. This makes the
 * parity a runtime failure, which CI does run.
 */

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { marker: 'service-role-default' } }));

import { PLAN_MANAGE_REFUSALS } from '@/lib/business-os/billing/planSubscriptionManage';
import { PLAN_MANAGE_REFUSAL_KEYS, planManageRefusalKey } from '@/components/business-os/settings/planManageCopy';
import { en } from '@/lib/business-os/translations/en';

const own = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);

describe('planManageCopy: refusal parity (SA F-1)', () => {
  it('every PLAN_MANAGE_REFUSALS code has its own line in PLAN_MANAGE_REFUSAL_KEYS', () => {
    const missing = Object.keys(PLAN_MANAGE_REFUSALS).filter((code) => !own(PLAN_MANAGE_REFUSAL_KEYS, code));
    expect(missing).toEqual([]);
  });

  it('change_pending reads the existing "not available" line (no new wording in D2)', () => {
    expect(PLAN_MANAGE_REFUSAL_KEYS.change_pending).toBe('plan.manage.refusal.unavailable');
    expect(planManageRefusalKey({ httpStatus: 409, code: 'change_pending', outcomeUnknown: false })).toBe('plan.manage.refusal.unavailable');
  });

  it('every dictionary key named exists in the English translations', () => {
    const dictionary = JSON.stringify(en);
    for (const key of new Set(Object.values(PLAN_MANAGE_REFUSAL_KEYS))) expect(dictionary).toContain(`"${key}"`);
  });
});
