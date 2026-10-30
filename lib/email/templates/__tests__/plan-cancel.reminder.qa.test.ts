/**
 * QA gap tests for the plan-cancel template's REMINDER variant (account
 * deletion lifecycle D4b / SX-3 part 2; workplan
 * docs/workplans/BUSINESS_OS_D4_PLAN_CANCEL_EMAILS_WORKPLAN.md §4, SA DR-9,
 * DR-10, DR-11; §13 QA report).
 *
 * What plan-cancel.reminder.test.ts did not already pin:
 *   - each null "after that" field drops ITS clause (credits, read-only days,
 *     open-ended back-to-plan) in every language, and no stray separator is left;
 *   - the subject is exactly the reminder subject, the date only, in every language,
 *     carries no plan name, address or owner name, and has no HTML;
 *   - the `{button}` in the keep sentence is the label of the button the HTML
 *     actually shows, in every language;
 *   - Hebrew: `<html lang="he" dir="rtl">`, the content right-aligned, the
 *     support address isolated LTR; English and Spanish are LTR;
 *   - DR-9 in he and es as well (no "as you asked" / "changed your mind");
 *   - never "free tier" in any language, any view;
 *   - the reminder never says "today" or "in N days".
 */

import type { Locale } from '@/lib/i18n/config';

import { PLAN_CANCEL_EMAIL_COPY, generatePlanCancelEmail, type PlanCancelAfter, type PlanCancelEmailData } from '../plan-cancel';

const LOCALES: Locale[] = ['en', 'he', 'es'];
const SUPPORT = 'notifications@agentspilot.ai';
const DATE = '1 December 2026';
const URL = 'https://app.example.test/business-os/settings?section=plan';
const FREE: PlanCancelAfter = { kind: 'free_plan', date: DATE, plan: 'Test Flight', until: '15 December 2026', credits: '1,000', readOnlyDays: '7' };

function render(overrides: Partial<PlanCancelEmailData> = {}) {
  return generatePlanCancelEmail({
    event: 'reminder',
    locale: 'en',
    date: DATE,
    after: FREE,
    unpaidInvoicesCancelled: false,
    actionUrl: URL,
    supportAddress: SUPPORT,
    ...overrides,
  });
}

describe('QA: the subject', () => {
  it.each(LOCALES)('%s: the subject is the date only', (locale) => {
    const t = PLAN_CANCEL_EMAIL_COPY[locale];
    const { subject } = render({ locale });
    expect(subject).toBe(t.reminder.subject.replace('{date}', DATE));
    expect(subject).not.toMatch(/@|<|>|Test Flight/);
  });

  it('English subject is exactly "Your plan ends on {date}"', () => {
    expect(PLAN_CANCEL_EMAIL_COPY.en.reminder.subject).toBe('Your plan ends on {date}');
  });

  it.each(LOCALES)('%s: the owner\'s name never appears (the template has no name field at all)', (locale) => {
    const t = PLAN_CANCEL_EMAIL_COPY[locale];
    for (const sentence of Object.values(t.reminder)) expect(sentence).not.toMatch(/\{(name|owner|firstName|email|address)\}/);
  });
});

describe('QA: DR-11 — a null field drops its clause', () => {
  it.each(LOCALES)('%s: credits null → the no-credits sentence, no credits number anywhere', (locale) => {
    const t = PLAN_CANCEL_EMAIL_COPY[locale];
    const { text, html } = render({ locale, after: { ...FREE, credits: null } });
    expect(text).toContain(t.changes.freePlanNoCredits.replace('{date}', DATE).replace('{plan}', 'Test Flight').replace('{until}', FREE.until));
    for (const body of [text, html]) {
      expect(body).not.toContain('1,000');
      expect(body).not.toMatch(/null|undefined|NaN/);
    }
  });

  it.each(LOCALES)('%s: readOnlyDays null → the read-only sentence is left out', (locale) => {
    const t = PLAN_CANCEL_EMAIL_COPY[locale];
    const { text } = render({ locale, after: { ...FREE, readOnlyDays: null } });
    const thenStart = t.changes.freePlanThen.split('{until}')[0];
    expect(text).not.toContain(thenStart.length > 0 ? thenStart : t.changes.freePlanThen.split('{days}')[1]);
    expect(text).not.toMatch(/null|undefined|NaN/);
  });

  it.each(LOCALES)('%s: back_to_plan with until null → the open-ended sentence, no "until"', (locale) => {
    const t = PLAN_CANCEL_EMAIL_COPY[locale];
    const { text } = render({ locale, after: { kind: 'back_to_plan', date: DATE, plan: 'Founders', until: null } });
    expect(text).toContain(t.changes.backToPlanOpen.replace('{date}', DATE).replace('{plan}', 'Founders'));
    expect(text).not.toMatch(/null|undefined|NaN/);
  });

  it.each(LOCALES)('%s: every null at once still renders, with no empty paragraph', (locale) => {
    const { html, text } = render({ locale, after: { ...FREE, credits: null, readOnlyDays: null } });
    expect(html).not.toMatch(/<p[^>]*>\s*<\/p>/);
    expect(text).not.toMatch(/\n\n\n/);
  });
});

describe('QA: the button', () => {
  it.each(LOCALES)('%s: the keep sentence names the very label the HTML button shows', (locale) => {
    const t = PLAN_CANCEL_EMAIL_COPY[locale];
    const { html, text } = render({ locale });
    const label = t.cancelled.button;
    expect(text).toContain(t.reminder.keepBefore.replace('{button}', label).replace('{date}', DATE));
    // The anchor that points at Settings → Plan carries that label.
    const anchor = new RegExp(`<a[^>]*href="${URL.replace(/[.?]/g, '\\$&')}"[^>]*>[\\s\\S]*?${label}[\\s\\S]*?</a>`);
    expect(html).toMatch(anchor);
    expect(text).toContain(`${label}: ${URL}`);
  });
});

describe('QA: direction', () => {
  it('Hebrew: the document and the content are RTL and right-aligned; the support address is isolated LTR', () => {
    const { html } = render({ locale: 'he' });
    expect(html).toMatch(/<html[^>]*lang="he"[^>]*dir="rtl"|<html[^>]*dir="rtl"[^>]*lang="he"/);
    expect(html).toContain('<div dir="rtl" style="text-align: right;">');
    expect(html).toContain(`<span dir="ltr">${SUPPORT}</span>`);
  });

  it.each(['en', 'es'] as const)('%s: LTR, left-aligned', (locale) => {
    const { html } = render({ locale });
    expect(html).not.toContain('dir="rtl"');
    expect(html).toContain('<div dir="ltr" style="text-align: left;">');
  });
});

describe('QA: DR-9 and C-9 in every language', () => {
  const forbidden: Record<Locale, RegExp[]> = {
    en: [/as you asked/i, /changed your mind/i, /\btoday\b/i, /in \d+ days|in three days/i, /free tier/i],
    he: [/כפי שביקשת/, /שיניתם את דעתכם|שינית את דעתך/, /היום/, /בעוד \d+ ימים|בעוד שלושה ימים/, /שכבה חינמית|רמה חינמית/],
    es: [/como pediste|como solicitaste/i, /cambiaste de opinión|has cambiado de opinión/i, /\bhoy\b/i, /en \d+ días|en tres días/i, /nivel gratuito|plan gratis de nivel/i],
  } as Record<Locale, RegExp[]>;

  it.each(LOCALES)('%s: none of the forbidden phrasings, for every view shape', (locale) => {
    for (const after of [FREE, { ...FREE, credits: null, readOnlyDays: null }, { kind: 'back_to_plan' as const, date: DATE, plan: 'P', until: null }, null]) {
      const email = render({ locale, after });
      for (const body of [email.subject, email.text]) {
        for (const pattern of forbidden[locale]) expect(body).not.toMatch(pattern);
      }
    }
  });

  it.each(LOCALES)('%s: no refund line and no "charged again" promise (the reminder states the end only)', (locale) => {
    const t = PLAN_CANCEL_EMAIL_COPY[locale];
    const { text } = render({ locale });
    expect(text).not.toContain(t.cancelled.noRefund);
    expect(text).not.toContain(t.endedNow.invoicesCancelled);
    expect(text).not.toContain(t.endedNow.invoiceMayBeOpen);
  });
});
