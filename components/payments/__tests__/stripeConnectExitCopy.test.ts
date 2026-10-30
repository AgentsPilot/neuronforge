/**
 * The Remove / Disconnect refusal words (self-service exit SX-5 / D5; SA W-13,
 * W-16): every code the routes send has a line in en, he and es, an unknown
 * code reads as the generic line, and the support address is the one constant.
 */

import { en } from '@/lib/business-os/translations/en';
import { he } from '@/lib/business-os/translations/he';
import { es } from '@/lib/business-os/translations/es';
import { PLACEHOLDER_ERASURE_CONTACT } from '@/lib/business-os/supportContact';
import {
  STRIPE_REMOVE_BUTTON_KEY,
  refusalLines,
  removeMessageKey,
  stripeExitLabel,
} from '@/components/payments/stripeConnectExitCopy';

type Dict = Record<string, string>;
const DICTS: Record<string, Dict> = { en: en as unknown as Dict, he: he as unknown as Dict, es: es as unknown as Dict };
const tOf = (dict: Dict) => (key: string) => dict[key];

const D5_KEYS = [
  'config.stripe.remove_connection',
  'config.stripe.remove_title',
  'config.stripe.remove_message_express',
  'config.stripe.remove_message_standard',
  'config.stripe.refused.client_plans_running',
  'config.stripe.refused.client_plans_running_uncounted',
  'config.stripe.refused.client_payments_pending',
  'config.stripe.refused.client_payments_pending_uncounted',
  'config.stripe.refused.stripe_refused',
  'config.stripe.refused.stripe_unreachable',
  'config.stripe.refused.check_failed',
  'config.stripe.refused.not_available',
  'config.stripe.refused.generic',
  'config.stripe.refused.record_not_removed',
  'settings.account_delete.blocker.stripe_linked',
];

describe('D5 translation keys', () => {
  it.each(Object.keys(DICTS))('%s has every D5 key, non-empty', (lang) => {
    for (const key of D5_KEYS) {
      expect([lang, key, typeof DICTS[lang][key] === 'string' && DICTS[lang][key].trim().length > 0]).toEqual([lang, key, true]);
    }
  });

  it('the counted lines carry {n}; their uncounted twins do not', () => {
    for (const dict of Object.values(DICTS)) {
      expect(dict['config.stripe.refused.client_plans_running']).toContain('{n}');
      expect(dict['config.stripe.refused.client_plans_running_uncounted']).not.toContain('{n}');
    }
  });

  it('the G-8 line names the label the Remove button shows (U-1), in every language', () => {
    for (const dict of Object.values(DICTS)) {
      expect(dict['settings.account_delete.blocker.stripe_linked']).toContain(dict[STRIPE_REMOVE_BUTTON_KEY]);
    }
  });
});

describe('refusalLines', () => {
  const t = tOf(DICTS.en);

  it('client money in flight lists each blocker with its count', () => {
    expect(
      refusalLines(t, { error: 'client_money_in_flight', blockers: [{ code: 'client_plans_running', count: 2 }, { code: 'client_payments_pending' }] })
    ).toEqual([
      DICTS.en['config.stripe.refused.client_plans_running'].replace('{n}', '2'),
      DICTS.en['config.stripe.refused.client_payments_pending_uncounted'],
    ]);
  });

  it('the disconnect refusal reads its count', () => {
    expect(refusalLines(t, { error: 'client_plans_running', blockers: [{ code: 'client_plans_running', count: 3 }] })[0]).toContain('3 client payment plans');
  });

  it('stripe_refused is the honest balance answer; not_available carries the support address', () => {
    expect(refusalLines(t, { error: 'stripe_refused' })).toEqual([DICTS.en['config.stripe.refused.stripe_refused']]);
    const [line] = refusalLines(t, { error: 'not_available' });
    expect(line).toContain(PLACEHOLDER_ERASURE_CONTACT);
    expect(line).not.toContain('{support}');
  });

  it('F-1: record_not_removed says Stripe let go and names support; never "nothing was changed", in any language', () => {
    const nothing: Record<string, string> = { en: 'Nothing was changed', he: 'לא שינינו דבר', es: 'No hemos cambiado nada' };
    for (const [lang, dict] of Object.entries(DICTS)) {
      const [line] = refusalLines(tOf(dict), { success: false, error: 'record_not_removed' });
      expect(line).toBe(dict['config.stripe.refused.record_not_removed'].replace('{support}', PLACEHOLDER_ERASURE_CONTACT));
      expect(line).toContain(PLACEHOLDER_ERASURE_CONTACT);
      expect(line).not.toContain(nothing[lang]);
    }
    expect(refusalLines(() => undefined, { error: 'record_not_removed' })[0]).toContain('Stripe has released the account');
  });

  it('QA B-1: a contact_support-only blocker list reads as contact-us with the support address, never "try again"', () => {
    const contact = DICTS.en['config.stripe.refused.not_available'].replace('{support}', PLACEHOLDER_ERASURE_CONTACT);
    expect(refusalLines(t, { error: 'client_money_in_flight', blockers: [{ code: 'contact_support' }] })).toEqual([contact]);
    expect(refusalLines(t, { error: 'client_money_in_flight', blockers: [] })).toEqual([contact]);
    expect(refusalLines(t, { error: 'client_money_in_flight', blockers: [{ code: 'contact_support' }] })[0]).not.toContain('Please try again');
  });

  it('QA B-1: a mixed list keeps the named lines and adds the contact line once', () => {
    const contact = DICTS.en['config.stripe.refused.not_available'].replace('{support}', PLACEHOLDER_ERASURE_CONTACT);
    expect(
      refusalLines(t, {
        error: 'client_money_in_flight',
        blockers: [{ code: 'client_plans_running', count: 2 }, { code: 'contact_support' }, { code: 'something_new' }],
      })
    ).toEqual([DICTS.en['config.stripe.refused.client_plans_running'].replace('{n}', '2'), contact]);
  });

  it.each([[{ error: 'Some raw server text' }], [{ error: 'toString' }], [null], ['oops'], [{}]])('an unknown body %p reads as the generic line', (body) => {
    expect(refusalLines(t, body)).toEqual([DICTS.en['config.stripe.refused.generic']]);
  });

  it('a missing translation falls back to English, never to the key', () => {
    const empty = () => undefined;
    expect(refusalLines(empty, { error: 'stripe_unreachable' })[0]).toContain('could not reach Stripe');
    expect(stripeExitLabel((key) => key, STRIPE_REMOVE_BUTTON_KEY)).toBe('Remove connection');
  });
});

describe('removeMessageKey (C-9)', () => {
  it('Express and Custom close the account; anything else is the owner’s own', () => {
    expect(removeMessageKey('express')).toBe('config.stripe.remove_message_express');
    expect(removeMessageKey('custom')).toBe('config.stripe.remove_message_express');
    expect(removeMessageKey('standard')).toBe('config.stripe.remove_message_standard');
    expect(removeMessageKey(undefined)).toBe('config.stripe.remove_message_standard');
  });
});
