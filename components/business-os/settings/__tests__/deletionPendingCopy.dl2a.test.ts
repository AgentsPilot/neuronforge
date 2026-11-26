/**
 * `deletion_pending` in the PLAN PAYMENTS copy maps (account deletion
 * lifecycle DL-2a; DL-2 workplan §5.6, §12 T-7; SA W-2; user Q-1,
 * 2026-11-06). DELETE's claimed lines: the plan page's reactivate refusal and
 * the checkout refusal each read their own line now, never the placeholder,
 * and each line names the button the owner presses: "Keep my account".
 */

import { planManageRefusalKey, PLAN_MANAGE_REFUSAL_KEYS } from '@/components/business-os/settings/planManageCopy';
import { planPurchaseRefusalKey, PLAN_PURCHASE_REFUSAL_KEYS } from '@/components/business-os/settings/planPurchaseCopy';
import { en } from '@/lib/business-os/translations/en';
import { he } from '@/lib/business-os/translations/he';
import { es } from '@/lib/business-os/translations/es';

const DICTS = { en, he, es } as unknown as Record<'en' | 'he' | 'es', Record<string, string>>;
const KEEP_BUTTON = { en: 'Keep my account', he: 'להשאיר את החשבון', es: 'Mantener mi cuenta' };

describe('planManageCopy (the plan page reactivate)', () => {
  it('deletion_pending → its own line, not the "not available" placeholder', () => {
    expect(PLAN_MANAGE_REFUSAL_KEYS.deletion_pending).toBe('plan.manage.refusal.deletion_pending');
    expect(planManageRefusalKey({ httpStatus: 409, code: 'deletion_pending', outcomeUnknown: false })).toBe('plan.manage.refusal.deletion_pending');
  });

  it('the approved English line with Q-1 applied', () => {
    expect(en['plan.manage.refusal.deletion_pending' as keyof typeof en]).toBe(
      "You asked us to delete your account, so this plan can't be reactivated. Choose Keep my account first, then you can reactivate your plan."
    );
  });
});

describe('planPurchaseCopy (the checkout, W-2)', () => {
  it('deletion_pending → its own line, not "not open"', () => {
    expect(PLAN_PURCHASE_REFUSAL_KEYS.deletion_pending).toBe('plan.refusal.deletion_pending');
    expect(planPurchaseRefusalKey({ httpStatus: 409, code: 'deletion_pending' })).toBe('plan.refusal.deletion_pending');
  });
});

describe.each(['en', 'he', 'es'] as const)('%s', (lang) => {
  it.each(['plan.manage.refusal.deletion_pending', 'plan.refusal.deletion_pending', 'usage.boost.error.deletion_pending'])('%s exists and names Keep my account', (key) => {
    expect(DICTS[lang][key]).toContain(KEEP_BUTTON[lang]);
    expect(DICTS[lang]['account_closure.keep_button']).toBe(KEEP_BUTTON[lang]);
  });
});
