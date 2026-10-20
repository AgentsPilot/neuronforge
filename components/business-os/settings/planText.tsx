'use client';

/**
 * How the "Your plan" surfaces word a sentence, a price and a category row.
 *
 * Moved verbatim out of `PlanSection.tsx` (upgrade modal UM-1a) so the drawer
 * and the plan comparison modal share one copy: the two cannot word a row, a
 * date or a price differently. `PlanSection.tsx` re-exports
 * `ACCOUNT_CLOCK_SENTENCE_KEYS` for its existing importers.
 */

import { Info } from 'lucide-react';

import { planCategoryLine } from '@/lib/business-os/planCategoryLine';

import type { PlanCategory, PlanPayload, PlanSentence } from './planPayloadTypes';

/**
 * A sentence the server named but did not write.
 *
 * The server sends a dictionary key and, where the sentence names a day, an ISO
 * date — so the wording comes from the platform's own translations and the DATE
 * is formatted in the reader's locale rather than in English.
 *
 * Module-level because two components render these: the section and the
 * plan-above card below it. `t` and the language are passed in, since the
 * dictionary lives on the hook.
 */
/**
 * The sentences whose date is a billing INSTANT, read on the account's clock.
 *
 * "Renews on" / "Ends on … It will not renew." carry Stripe's period end: the
 * purchase instant one month on, not a midnight. Formatted in UTC, an owner in
 * Israel who bought between local midnight and 02:00/03:00 read the day before
 * (QA P-4.2 note 3). These two keys come from `billingEndsWhen` only; a test
 * pins that the two agree. Every other dated sentence names a cohort or admin
 * end date stored as midnight UTC, and stays in UTC (see below).
 *
 * Plan payments P-6a.2 adds the three failed-payment sentences: their dates are
 * billing instants too (a failure, a due date, an end), from the same
 * `billingEndsWhen`.
 */
export const ACCOUNT_CLOCK_SENTENCE_KEYS: ReadonlySet<string> = new Set([
  'plan.renews_on',
  'plan.ends_on_paid',
  'plan.payment_failed_on',
  'plan.payment_action_required_on',
  'plan.ended_on',
]);

export function renderSentence(
  value: PlanSentence | null | undefined,
  t: (key: string) => string,
  language: string,
  /** `user_preferences.timezone` via `useLanguage()`; the provider holds 'UTC' while unknown or unset. */
  accountTimezone: string | undefined
): string | null {
  if (!value?.key) return null;

  // P-6a.2: `{count}` (attempts so far) is a plain number in every language.
  const text = typeof value.count === 'number' ? t(value.key).replace('{count}', String(value.count)) : t(value.key);
  if (!value.date) return text;

  const day = new Date(value.date);
  // An unusable date is not a sentence — the same rule the server applies before
  // it names one at all.
  if (Number.isNaN(day.getTime())) return null;

  /*
   * The same map the dashboard and the scheduling dialog use — a bare `en` is a
   * language, not a locale, and the three the platform speaks each want their
   * own region for the month name and the day order.
   */
  const locale = language === 'he' ? 'he-IL' : language === 'es' ? 'es-ES' : 'en-US';

  return text.replace(
    '{date}',
    day.toLocaleDateString(locale, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      /*
       * In UTC, because the instant is one.
       *
       * A cohort expiry is stored as midnight UTC, and the sentence this fills
       * used to be built server-side from `getUTCDate()`. Formatting it in the
       * browser's zone instead moves it a day for every reader west of UTC — an
       * end date a day early, on the one line of this page that is a promise.
       *
       * EXCEPT a billing instant (`ACCOUNT_CLOCK_SENTENCE_KEYS`), read on the
       * account's own clock, the one every other Business OS date uses
       * (`useLanguage().timezone`, from `user_preferences.timezone`; UTC when
       * not set, the provider's own fallback).
       */
      timeZone: ACCOUNT_CLOCK_SENTENCE_KEYS.has(value.key) ? accountTimezone || 'UTC' : 'UTC',
    })
  );
}

/**
 * A dictionary template with its `{name}` slots filled.
 *
 * A function replacer, not a replacement string: the values are plan names,
 * prices and formatted amounts, and a `$` in one ("$79") must be printed, never
 * read as a `$&`-style pattern.
 */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (slot, name: string) => (Object.prototype.hasOwnProperty.call(values, name) ? values[name] : slot));
}

/**
 * One category row: its heading, its line, and its note.
 *
 * The line goes through `planCategoryLine`, so a category whose only feature is
 * named like its heading prints the value alone — "Credits" over "19,750 per
 * month", not over "Credits (19,750 per month)" (user decision, 2026-10-02).
 * Shared by what the plan includes and what the next plan would add, so the two
 * lists cannot word the same row differently.
 */
export function CategoryRowText({
  row,
  t,
  noteTestId,
}: {
  row: PlanCategory;
  t: (key: string) => string;
  noteTestId?: string;
}) {
  const heading = t(row.labelKey);
  const line = planCategoryLine(heading, row);

  return (
    <span className="text-sm min-w-0">
      <span className="text-[var(--v2-text-primary)]">{heading}</span>
      {line !== null && <span className="block text-[var(--v2-text-muted)]">{line}</span>}
      {row.noteKey && (
        <span className="block mt-0.5 text-xs text-[var(--v2-text-muted)]" data-testid={noteTestId}>
          {t(row.noteKey)}
        </span>
      )}
    </span>
  );
}

export function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 p-3 bg-[var(--v2-bg)]" style={{ borderRadius: 'var(--v2-radius-card)' }}>
      <Info className="w-4 h-4 shrink-0 mt-0.5 text-[var(--v2-text-muted)]" />
      <p className="text-xs text-[var(--v2-text-muted)] min-w-0">{children}</p>
    </div>
  );
}

/** "Free, no end date" or "$79 a month". Reads the flag, never the number alone. */
/**
 * `t` is passed in rather than reached for: this is a module-level helper, and
 * the dictionary lives on the hook inside the component.
 */
export function priceLine(plan: PlanPayload, t: (key: string) => string): string {
  if (plan.free) {
    return plan.accessEndsAt === null ? t('plan.price.free_no_end') : t('plan.price.free');
  }
  /*
   * The price stays in dollars and in digits, which every language reads. What
   * needed translating was "a month", so the whole line is one key with the
   * figure substituted — a translator cannot reorder `$79` and `a month` if the
   * words are glued to the number here.
   */
  return plan.monthlyPriceUsd
    ? t('plan.price.per_month').replace('{amount}', `$${plan.monthlyPriceUsd}`)
    : '';
}
