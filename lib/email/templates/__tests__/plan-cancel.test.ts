/**
 * The plan-cancel email template (account deletion lifecycle D4a / SX-3;
 * workplan §4, §8 row 2; SA DR-7, DR-9, DR-10, DR-11).
 *
 * Each variant renders in each language; Hebrew is right to left; every value
 * is escaped; the subject carries no address and no date for these three;
 * a null field drops its clause; the "after that" sentences are the drawer's
 * own `settings.plan_cancel.changes.*` strings, so the two cannot drift; and
 * no language ever says "free tier".
 */

import { en } from '@/lib/business-os/translations/en';
import { es } from '@/lib/business-os/translations/es';
import { he } from '@/lib/business-os/translations/he';
import type { Locale } from '@/lib/i18n/config';

import {
  PLAN_CANCEL_EMAIL_COPY,
  generatePlanCancelEmail,
  type PlanCancelAfter,
  type PlanCancelEmailData,
  type PlanCancelEmailEvent,
} from '../plan-cancel';

const LOCALES: Locale[] = ['en', 'he', 'es'];
const EVENTS: PlanCancelEmailEvent[] = ['cancelled', 'ended_now', 'kept'];
const SUPPORT = 'notifications@agentspilot.ai';
const OWNER = 'owner@example.com';

const FREE: PlanCancelAfter = { kind: 'free_plan', date: '30 November 2026', plan: 'Test Flight', until: '14 December 2026', credits: '1,000', readOnlyDays: '7' };

function render(overrides: Partial<PlanCancelEmailData> = {}) {
  return generatePlanCancelEmail({
    event: 'cancelled',
    locale: 'en',
    date: '30 November 2026',
    after: FREE,
    unpaidInvoicesCancelled: false,
    actionUrl: 'https://app.example.test/business-os/settings?section=plan',
    supportAddress: SUPPORT,
    ...overrides,
  });
}

describe('every variant × every language', () => {
  it.each(EVENTS.flatMap((event) => LOCALES.map((locale) => [event, locale] as const)))('%s / %s renders', (event, locale) => {
    const email = render({ event, locale });
    expect(email.subject.length).toBeGreaterThan(0);
    expect(email.html).toContain('30 November 2026');
    expect(email.text).toContain('30 November 2026');
    expect(email.html).toContain('https://app.example.test/business-os/settings?section=plan');
    // DR-10: the support line is the platform sender, in every language.
    expect(email.html).toContain(SUPPORT);
    expect(email.text).toContain(SUPPORT);
    // The subject carries no address, no date and no plan name.
    expect(email.subject).not.toContain('@');
    expect(email.subject).not.toContain('2026');
    expect(email.subject).not.toContain('Test Flight');
    expect(email.subject).not.toContain(OWNER);
  });

  it('Hebrew is right to left; English and Spanish are not', () => {
    expect(render({ locale: 'he' }).html).toContain('dir="rtl"');
    expect(render({ locale: 'en' }).html).not.toContain('dir="rtl"');
    expect(render({ locale: 'es' }).html).not.toContain('dir="rtl"');
  });

  it('an unknown locale falls back to English', () => {
    expect(render({ locale: 'fr' as Locale }).subject).toBe(PLAN_CANCEL_EMAIL_COPY.en.cancelled.subject);
  });
});

describe('he / es copy has every key English has', () => {
  function shape(value: unknown, prefix = ''): string[] {
    if (typeof value !== 'object' || value === null) return [prefix];
    return Object.entries(value).flatMap(([key, inner]) => shape(inner, prefix ? `${prefix}.${key}` : key));
  }
  function placeholders(value: unknown): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    const walk = (node: unknown, path: string) => {
      if (typeof node === 'string') out[path] = (node.match(/\{\w+\}/g) ?? []).sort();
      else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
    };
    walk(value, '');
    return out;
  }

  it.each(['he', 'es'] as const)('%s: same keys and same placeholders as en', (locale) => {
    expect(shape(PLAN_CANCEL_EMAIL_COPY[locale]).sort()).toEqual(shape(PLAN_CANCEL_EMAIL_COPY.en).sort());
    expect(placeholders(PLAN_CANCEL_EMAIL_COPY[locale])).toEqual(placeholders(PLAN_CANCEL_EMAIL_COPY.en));
  });

  it.each(['he', 'es'] as const)('%s: no string is left in English', (locale) => {
    const english = new Set(collect(PLAN_CANCEL_EMAIL_COPY.en));
    for (const text of collect(PLAN_CANCEL_EMAIL_COPY[locale])) expect({ text, english: english.has(text) }).toEqual({ text, english: false });
  });

  function collect(value: unknown): string[] {
    if (typeof value === 'string') return [value];
    if (value && typeof value === 'object') return Object.values(value).flatMap(collect);
    return [];
  }
});

describe('DR-11: the "after that" sentences are the drawer\'s own words', () => {
  const DICTS = { en, he, es } as const;
  const KEYS = {
    freePlan: 'settings.plan_cancel.changes.free_plan',
    freePlanNoCredits: 'settings.plan_cancel.changes.free_plan_nocredits',
    freePlanThen: 'settings.plan_cancel.changes.free_plan_then',
    backToPlan: 'settings.plan_cancel.changes.back_to_plan',
    backToPlanOpen: 'settings.plan_cancel.changes.back_to_plan_open',
    dataKept: 'settings.plan_cancel.changes.data_kept',
  } as const;

  it.each(LOCALES.flatMap((locale) => Object.entries(KEYS).map(([field, key]) => [locale, field, key] as const)))(
    '%s %s === %s',
    (locale, field, key) => {
      const dict = DICTS[locale] as Record<string, string>;
      expect(PLAN_CANCEL_EMAIL_COPY[locale].changes[field as keyof typeof KEYS]).toBe(dict[key]);
    }
  );

  it.each(LOCALES)('%s: the cancelled email keeps the drawer\'s no-refund line', (locale) => {
    const dict = DICTS[locale] as Record<string, string>;
    expect(PLAN_CANCEL_EMAIL_COPY[locale].cancelled.noRefund).toBe(dict['settings.plan_cancel.review.no_refund']);
    expect(PLAN_CANCEL_EMAIL_COPY[locale].cancelled.button).toBe(dict['settings.plan_cancel.keep_button']);
  });
});

describe('DR-11: a null field drops its clause, never prints a gap', () => {
  it.each(LOCALES)('%s: credits null → the no-credits sentence', (locale) => {
    const t = PLAN_CANCEL_EMAIL_COPY[locale];
    const { text } = render({ locale, after: { ...FREE, credits: null } });
    expect(text).toContain(t.changes.freePlanNoCredits.replace('{date}', FREE.date).replace('{plan}', 'Test Flight').replace('{until}', FREE.until));
    expect(text).not.toContain('1,000');
  });

  it.each(LOCALES)('%s: read-only days null → the "then" sentence is left out', (locale) => {
    const t = PLAN_CANCEL_EMAIL_COPY[locale];
    const thenStart = t.changes.freePlanThen.split('{')[0];
    expect(render({ locale }).text).toContain(thenStart);
    expect(render({ locale, after: { ...FREE, readOnlyDays: null } }).text).not.toContain(thenStart);
  });

  it.each(LOCALES)('%s: back_to_plan with no end → the open-ended sentence', (locale) => {
    const t = PLAN_CANCEL_EMAIL_COPY[locale];
    const { text } = render({ locale, after: { kind: 'back_to_plan', date: FREE.date, plan: 'Founding Partner', until: null } });
    expect(text).toContain(t.changes.backToPlanOpen.replace('{date}', FREE.date).replace('{plan}', 'Founding Partner'));
  });

  it.each(LOCALES)('%s: no view → no "after that" sentence, the certain facts stay', (locale) => {
    const t = PLAN_CANCEL_EMAIL_COPY[locale];
    const { text } = render({ locale, after: null });
    expect(text).not.toContain('Test Flight');
    expect(text).toContain(t.cancelled.lead.replace('{date}', '30 November 2026'));
    expect(text).toContain(t.cancelled.noRefund);
    expect(text).toContain(t.changes.dataKept);
  });

  it.each(EVENTS.flatMap((event) => LOCALES.map((locale) => [event, locale] as const)))('%s / %s: no placeholder survives', (event, locale) => {
    for (const after of [FREE, { ...FREE, credits: null, readOnlyDays: null }, { kind: 'back_to_plan' as const, date: 'd', plan: 'p', until: null }, null]) {
      const email = render({ event, locale, after });
      expect(email.text).not.toMatch(/\{\w+\}/);
      expect(email.html).not.toMatch(/\{\w+\}/);
    }
  });
});

describe('what each email says (C-9)', () => {
  it('kept: renews on the date, no "nothing else changes", no "after that" (DR-9)', () => {
    const { text } = render({ event: 'kept', after: FREE });
    expect(text).toContain('Your plan continues and renews on 30 November 2026.');
    expect(text).not.toMatch(/nothing else changes/i);
    expect(text).not.toContain('Test Flight');
  });

  it('ended_now: "ended on {date}", never "today" (DR-7)', () => {
    const { text, subject } = render({ event: 'ended_now' });
    expect(subject).toBe('Your plan has ended');
    expect(text).toContain('Your plan ended on 30 November 2026 at your request');
    expect(text).not.toMatch(/today/i);
  });

  it.each(LOCALES)('%s ended_now: the unpaid-invoice sentence only when none was left open (DR-7)', (locale) => {
    const sentence = PLAN_CANCEL_EMAIL_COPY[locale].endedNow.invoicesCancelled;
    expect(render({ locale, event: 'ended_now', unpaidInvoicesCancelled: true }).text).toContain(sentence);
    expect(render({ locale, event: 'ended_now', unpaidInvoicesCancelled: false }).text).not.toContain(sentence);
    // An invoice left open, or not read: the email says it may still be charged, and only then.
    const mayBeOpen = PLAN_CANCEL_EMAIL_COPY[locale].endedNow.invoiceMayBeOpen;
    expect(render({ locale, event: 'ended_now', unpaidInvoicesCancelled: false }).text).toContain(mayBeOpen);
    expect(render({ locale, event: 'ended_now', unpaidInvoicesCancelled: true }).text).not.toContain(mayBeOpen);
    expect(render({ locale, event: 'cancelled', unpaidInvoicesCancelled: false }).text).not.toContain(mayBeOpen);
    // Never on the other two emails.
    expect(render({ locale, event: 'cancelled', unpaidInvoicesCancelled: true }).text).not.toContain(sentence);
  });

  // SA code review F-1 (C-9): an invoice left open (or not read) can still be paid late, so the
  // ended email makes no "not charged again" promise then, in any language, text or HTML.
  const CHARGED_AGAIN: Record<Locale, RegExp> = {
    en: /charged again/i,
    he: /תחויבו שוב/,
    es: /volverá a cobrar/i,
  };
  it.each(LOCALES)('%s ended_now F-1: no "charged again" wording unless no invoice was left open', (locale) => {
    for (const after of [FREE, null]) {
      const open = render({ locale, event: 'ended_now', unpaidInvoicesCancelled: false, after });
      expect(open.text).not.toMatch(CHARGED_AGAIN[locale]);
      expect(open.html).not.toMatch(CHARGED_AGAIN[locale]);
      expect(open.subject).not.toMatch(CHARGED_AGAIN[locale]);
      expect(render({ locale, event: 'ended_now', unpaidInvoicesCancelled: true, after }).text).toMatch(CHARGED_AGAIN[locale]);
    }
  });

  it('cancelled: the drawer facts and the keep line', () => {
    const { text } = render();
    expect(text).toContain('You cancelled your plan. It stays on until 30 November 2026, and you will not be charged again.');
    expect(text).toContain('On 30 November 2026 your plan moves to the free plan, Test Flight, with 1,000 credits, until 14 December 2026.');
    expect(text).toContain('After 14 December 2026, your account is read-only for 7 days, then paused, unless you choose a plan.');
    expect(text).toContain('You can keep it any time before 30 November 2026.');
  });

  it.each(EVENTS.flatMap((event) => LOCALES.map((locale) => [event, locale] as const)))('%s / %s: never "free tier"', (event, locale) => {
    const email = render({ event, locale });
    for (const body of [email.subject, email.text, email.html]) expect(body).not.toMatch(/free tier|nivel gratuito|שכבה חינמית/i);
  });
});

describe('escaping', () => {
  it('a plan name, a date and the support address are HTML-escaped', () => {
    const { html } = render({
      date: '<b>30</b> Nov',
      after: { ...FREE, plan: '<script>x</script>' },
      supportAddress: 'a&b@example.test',
    });
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).not.toContain('<b>30</b>');
    expect(html).toContain('a&amp;b@example.test');
  });

  it('the support address is read left to right inside Hebrew', () => {
    expect(render({ locale: 'he' }).html).toContain(`<span dir="ltr">${SUPPORT}</span>`);
  });
});
