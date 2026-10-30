/**
 * The plan-cancel template's REMINDER variant (account deletion lifecycle D4b /
 * SX-3 part 2; workplan §3.4, §4; SA DR-9, DR-10, DR-11).
 *
 * DR-9: subject "Your plan ends on {date}"; no "as you asked" and no "Changed
 * your mind?" (the cron also reminds a plan set to end from the dashboard);
 * "Want to keep it? … before {date}." The "after that" paragraph is the
 * cancelled email's, from the view. The subject carries the date only: no
 * address, no name, no plan name. en / he / es, Hebrew right to left.
 */

import type { Locale } from '@/lib/i18n/config';

import { PLAN_CANCEL_EMAIL_COPY, generatePlanCancelEmail, type PlanCancelAfter, type PlanCancelEmailData } from '../plan-cancel';

const LOCALES: Locale[] = ['en', 'he', 'es'];
const SUPPORT = 'notifications@agentspilot.ai';
const DATE = '30 November 2026';
const FREE: PlanCancelAfter = { kind: 'free_plan', date: DATE, plan: 'Test Flight', until: '14 December 2026', credits: '1,000', readOnlyDays: '7' };

function render(overrides: Partial<PlanCancelEmailData> = {}) {
  return generatePlanCancelEmail({
    event: 'reminder',
    locale: 'en',
    date: DATE,
    after: FREE,
    unpaidInvoicesCancelled: false,
    actionUrl: 'https://app.example.test/business-os/settings?section=plan',
    supportAddress: SUPPORT,
    ...overrides,
  });
}

describe('reminder × every language', () => {
  it.each(LOCALES)('%s: renders the date, the button link and the support line; the subject is the date and nothing else', (locale) => {
    const t = PLAN_CANCEL_EMAIL_COPY[locale];
    const email = render({ locale });
    expect(email.subject).toBe(t.reminder.subject.replace('{date}', DATE));
    expect(email.subject).not.toContain('@');
    expect(email.subject).not.toContain('Test Flight');
    // The heading is the subject; the body opens straight on the "after that" paragraph, never repeating the date line.
    expect(email.text.split('\n').slice(0, 3)).toEqual([email.subject, '', t.changes.freePlan.replace('{date}', FREE.date).replace('{plan}', FREE.plan).replace('{credits}', FREE.credits as string).replace('{until}', FREE.until)]);
    expect(email.html).toContain('https://app.example.test/business-os/settings?section=plan');
    expect(email.html).toContain(SUPPORT);
    expect(email.text).toContain(`${t.cancelled.button}: https://app.example.test/business-os/settings?section=plan`);
  });

  it.each(LOCALES)('%s: the keep sentence names the very button the email shows, and the date', (locale) => {
    const t = PLAN_CANCEL_EMAIL_COPY[locale];
    const { text } = render({ locale });
    expect(text).toContain(t.reminder.keepBefore.replace('{button}', t.cancelled.button).replace('{date}', DATE));
  });

  it.each(LOCALES)('%s: the "after that" paragraph is the cancelled email\'s, from the view', (locale) => {
    const t = PLAN_CANCEL_EMAIL_COPY[locale];
    const reminder = render({ locale }).text;
    const cancelled = render({ locale, event: 'cancelled' }).text;
    const main = t.changes.freePlan
      .replace('{date}', FREE.date)
      .replace('{plan}', FREE.plan)
      .replace('{credits}', FREE.credits as string)
      .replace('{until}', FREE.until);
    const then = t.changes.freePlanThen.replace('{until}', FREE.until).replace('{days}', FREE.readOnlyDays as string);
    for (const sentence of [main, then, t.changes.dataKept]) {
      expect(reminder).toContain(sentence);
      expect(cancelled).toContain(sentence);
    }
  });

  it.each(LOCALES)('%s: no view → no "after that" sentence; the certain facts stay', (locale) => {
    const t = PLAN_CANCEL_EMAIL_COPY[locale];
    const { text } = render({ locale, after: null });
    expect(text).not.toContain('Test Flight');
    expect(text.split('\n').slice(0, 3)).toEqual([t.reminder.subject.replace('{date}', DATE), '', t.changes.dataKept]);
    expect(text).toContain(t.changes.dataKept);
  });

  it.each(LOCALES)('%s: no placeholder survives, whatever the view', (locale) => {
    for (const after of [FREE, { ...FREE, credits: null, readOnlyDays: null }, { kind: 'back_to_plan' as const, date: 'd', plan: 'p', until: null }, null]) {
      const email = render({ locale, after });
      for (const body of [email.subject, email.text, email.html]) expect(body).not.toMatch(/\{\w+\}/);
    }
  });

  it.each(LOCALES)('%s: never "free tier"', (locale) => {
    const email = render({ locale });
    for (const body of [email.subject, email.text, email.html]) expect(body).not.toMatch(/free tier|nivel gratuito|שכבה חינמית/i);
  });

  it('Hebrew is right to left; English and Spanish are not', () => {
    expect(render({ locale: 'he' }).html).toContain('dir="rtl"');
    expect(render({ locale: 'en' }).html).not.toContain('dir="rtl"');
    expect(render({ locale: 'es' }).html).not.toContain('dir="rtl"');
  });
});

describe('DR-9: what the reminder may not say', () => {
  it('English: "Your plan ends on {date}" and "Want to keep it?", never "as you asked", "Changed your mind?" or "in 3 days"', () => {
    const { text, subject } = render();
    expect(subject).toBe(`Your plan ends on ${DATE}`);
    // The heading says it once; the body never says it again (user, G-5).
    expect(text.split('\n')[0]).toBe(`Your plan ends on ${DATE}`);
    expect(text).not.toContain(`Your plan ends on ${DATE}.`);
    expect(text).toContain(`Want to keep it? Choose "Keep my plan" before ${DATE}.`);
    for (const body of [text, subject]) {
      expect(body).not.toMatch(/as you asked/i);
      expect(body).not.toMatch(/changed your mind/i);
      expect(body).not.toMatch(/in 3 days|in three days/i);
    }
  });

  it.each(LOCALES)('%s: no "charged again" promise and no refund line (the reminder states the end, nothing more)', (locale) => {
    const t = PLAN_CANCEL_EMAIL_COPY[locale];
    const { text } = render({ locale });
    expect(text).not.toContain(t.cancelled.noRefund);
    expect(text).not.toContain(t.endedNow.invoicesCancelled);
  });

  it('the date and the plan name are HTML-escaped', () => {
    const { html, subject } = render({ date: '<b>30</b> Nov', after: { ...FREE, plan: '<script>x</script>' } });
    expect(html).not.toContain('<b>30</b>');
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    // The subject is plain text for the transport, and its HTML heading is escaped.
    expect(subject).toBe('Your plan ends on <b>30</b> Nov');
    expect(html).toContain('Your plan ends on &lt;b&gt;30&lt;/b&gt; Nov');
  });
});
