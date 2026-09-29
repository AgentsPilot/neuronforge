'use client';

/**
 * "Your plan" — what this business is on, and what it includes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT RENDERS; IT DOES NOT DECIDE
 *
 * Every string here arrives formatted from `/api/business-os/entitlements/my-plan`.
 * This component does no derivation at all: it does not read the tier matrix, it
 * does not know which plan is above which, it does not decide what "includes"
 * means, and it cannot format a capability value.
 *
 * That is the boundary the admin Tiers screen set, and the reason is the same:
 * anything computed here is a second copy of a rule that already exists
 * server-side, and the copy is what goes wrong. The server modules are
 * `server-only`, so importing them into this file is a build error rather than a
 * review finding.
 *
 * WHAT IS DELIBERATELY NOT HERE (S-4a step 1)
 *
 * A buy button, an upgrade button, a price comparison the customer can act on,
 * or anything touching Stripe. Those are steps 2 to 4. A button that cannot
 * honour itself is worse than no button, and the next plan is shown here as
 * information — what it would add — not as an offer.
 *
 * Also not here: **anything about chat.** The chat capabilities are withheld from
 * Essentials in config and nothing enforces them yet, so a line saying "your plan
 * does not include chat" would be false while chat works. The server drops them;
 * this component never sees them. See `customerPlanView`.
 *
 * And no withheld list at all. A customer reading "excluded" wants to know how
 * to get it; for half of those the honest answer is "nobody can" and for the
 * other half it is "you already can, we just have not built the gate". Listing
 * only what a plan INCLUDES removes that whole class of wrong sentence.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useState } from 'react';
import { ArrowRight, Check, Info, Loader2, Sparkles } from 'lucide-react';

import { useLanguage } from '@/lib/business-os/LanguageContext';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'BusinessOsPlanSection' });

/**
 * The payload, as the route sends it.
 *
 * Mirrored rather than imported: `customerPlanView` is `server-only`. The shape
 * is held honest by `payload.contract.test.tsx`, which renders this component
 * against a recorded body and fails when the two drift.
 */
interface PlanFeature {
  capability: string;
  label: string;
  value: string;
}

/**
 * One row: a category and the features in it, already joined server-side.
 *
 * The component prints `summary`; it does not build it. Twenty-eight flat lines
 * became nine rows (2026-09-27), and AI chat's ten entries are deliberately one
 * long line rather than a "+N more" expander — an expander is a new interaction
 * on a read-only screen, and hiding most of what a plan includes is the opposite
 * of what this section is for.
 */
/**
 * A sentence the server named but did not write: a dictionary key, and an ISO
 * date where the sentence mentions a day.
 *
 * Declared here rather than imported from `customerPlanView`, for the reason
 * every other payload shape in this file is: the component describes what it
 * receives over HTTP, and importing the server's type would make a UI file
 * reach into the entitlements module — which `enforcementPoints.test.ts`
 * refuses, and was right to refuse when this first tried it.
 */
interface PlanSentence {
  key: string;
  date?: string | null;
}

interface PlanCategory {
  category: string;
  /** A dictionary key, so the heading is read in the viewer's language. */
  labelKey: string;
  features: PlanFeature[];
  summary: string;
}

interface PlanChange {
  capability: string;
  label: string;
  from: string;
  to: string;
}

interface PlanUpgrade {
  planId: string;
  name: string;
  monthlyPriceUsd: number;
  availableToBuy: boolean;
  actionUnavailableBecause: PlanSentence | null;
  adds: PlanCategory[];
  improves: PlanChange[];
  /** Different there, but not rankable — shown as a change, never as a gain. */
  changes: PlanChange[];
}

export interface PlanPayload {
  status: 'ok' | 'no_plan_record' | 'unavailable';
  planId: string | null;
  name: string | null;
  kind: 'tier' | 'cohort' | null;
  monthlyPriceUsd: number | null;
  free: boolean;
  state: string | null;
  accessEndsAt: string | null;
  endsWhen: PlanSentence | null;
  whenThisChanges: PlanSentence | null;
  included: PlanCategory[];
  nextPlanUp: PlanUpgrade | null;
  problem: PlanSentence | null;
}

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
function renderSentence(
  value: PlanSentence | null | undefined,
  t: (key: string) => string,
  language: string
): string | null {
  if (!value?.key) return null;

  const text = t(value.key);
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
       */
      timeZone: 'UTC',
    })
  );
}

export function PlanSection() {
  const { t, isRTL, language } = useLanguage();

  const sentence = (value: PlanSentence | null | undefined) => renderSentence(value, t, language);
  const [plan, setPlan] = useState<PlanPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    /*
     * No language on the request, deliberately.
     *
     * Plan and feature NAMES are config data and are resolved server-side — from
     * the reader's own stored preference, not from anything sent here. That
     * route's guard protects the property that there is nothing to read in a
     * request, so no `?accountId=` can ever be honoured; a `?lang=` would have
     * been the first crack in it.
     *
     * Re-fetched when the language changes so those names catch up once the
     * preference is saved. The SENTENCES do not wait for that — they are keys,
     * rendered below, and switch immediately.
     */
    fetch('/api/business-os/entitlements/my-plan')
      .then((response) => response.json())
      .then((body) => {
        if (cancelled) return;
        if (!body?.success || !body?.data) {
          setFailed(true);
          return;
        }
        setPlan(body.data as PlanPayload);
      })
      .catch((error) => {
        if (cancelled) return;
        logger.error({ err: error }, 'Could not load the plan section');
        setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // Re-fetched on a language change, so the names follow the interface.
  }, [language]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-[var(--v2-text-muted)]" aria-busy="true">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>{t('plan.loading')}</span>
      </div>
    );
  }

  // A failed fetch and a plan that includes nothing must not look the same.
  if (failed || !plan) {
    return (
      <Notice>{t('plan.problem.unavailable')}</Notice>
    );
  }

  if (plan.status !== 'ok') {
    return <Notice>{sentence(plan.problem) ?? t('plan.problem.unavailable')}</Notice>;
  }

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* What you are on */}
      <div>
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-base text-[var(--v2-text-primary)]">{plan.name}</span>
          <span className="text-sm text-[var(--v2-text-muted)]">{priceLine(plan, t)}</span>
          {/* No plan pill here (user decision, 2026-09-27): the plan name is
              already the first thing on this line, so a pill beside it repeats it.
              The one pill lives in the chrome, beside the logo. */}
        </div>
        {sentence(plan.endsWhen) && (
          <p className="text-xs text-[var(--v2-text-muted)] mt-1">{sentence(plan.endsWhen)}</p>
        )}
      </div>

      {/* Free plans only: what happens when free is not free. Written now so the
          change is something the customer has already read once. */}
      {sentence(plan.whenThisChanges) && <Notice>{sentence(plan.whenThisChanges)}</Notice>}

      {/* What you have */}
      <div>
        <h4 className="text-xs uppercase tracking-wide text-[var(--v2-text-muted)] mb-2">
          {t('plan.includes')}
        </h4>
        {plan.included.length === 0 ? (
          <p className="text-sm text-[var(--v2-text-muted)]">
            We could not list your features just now. Nothing has been removed from your account.
          </p>
        ) : (
          // Named so a screen reader says which list this is, and so a test can
          // scope to it: an unnamed second list two elements down carries similar
          // numbers, and a positional query silently followed it.
          <ul className="space-y-2" aria-label={t('plan.includes')}>
            {plan.included.map((row) => (
              <li key={row.category} className="flex items-start gap-2">
                <Check className="w-4 h-4 shrink-0 mt-0.5 text-[var(--v2-primary)]" />
                <span className="text-sm min-w-0">
                  <span className="text-[var(--v2-text-primary)]">{t(row.labelKey)}</span>
                  <span className="block text-[var(--v2-text-muted)]">{row.summary}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* The plan above, as information. No button: step 1 is read-only. */}
      {plan.nextPlanUp && <NextPlanUp upgrade={plan.nextPlanUp} />}
    </div>
  );
}

function NextPlanUp({ upgrade }: { upgrade: PlanUpgrade }) {
  const { t, language } = useLanguage();
  const sentence = (value: PlanSentence | null | undefined) => renderSentence(value, t, language);

  return (
    <div className="pt-4 border-t border-[var(--v2-border)]">
      <h4 className="text-xs uppercase tracking-wide text-[var(--v2-text-muted)] mb-2 flex items-center gap-1.5">
        <Sparkles className="w-3.5 h-3.5" />
        <span>
          {upgrade.name}
          {upgrade.monthlyPriceUsd > 0 && ` — $${upgrade.monthlyPriceUsd} a month`}
        </span>
      </h4>

      {/* No empty-state branch: the server sends `nextPlanUp` only when there is
          something in one of these lists, so a "nothing to show" paragraph here
          was unreachable (QA-2). When there is nothing above this plan the whole
          section is absent. */}
      <h5 className="text-xs uppercase tracking-wide text-[var(--v2-text-muted)]">
        What {upgrade.name} would add
      </h5>
      <ul className="mt-1.5 space-y-1.5" aria-label={`What ${upgrade.name} would add`}>
          {upgrade.adds.map((row) => (
            <li key={row.category} className="flex items-start gap-2">
              <Check className="w-4 h-4 shrink-0 mt-0.5 text-[var(--v2-text-muted)]" />
              <span className="text-sm min-w-0">
                <span className="text-[var(--v2-text-primary)]">{t(row.labelKey)}</span>
                <span className="block text-[var(--v2-text-muted)]">{row.summary}</span>
              </span>
            </li>
          ))}
          {upgrade.improves.map((entry) => (
            <li key={entry.capability} className="flex items-start gap-2">
              <Check className="w-4 h-4 shrink-0 mt-0.5 text-[var(--v2-text-muted)]" />
              <span className="text-sm text-[var(--v2-text-primary)] min-w-0">
                {entry.label}
                <span className="text-[var(--v2-text-muted)]">
                  {' '}
                  — {entry.from} becomes {entry.to}
                </span>
              </span>
            </li>
          ))}
      </ul>

      {/* Changes get their own list, their own heading and their own sentence
          (SA R2-1, QA-9).

          The first version put all three arrays in one `<ul>` labelled "What
          {plan} would add" and gave `changes` the same "— {from} becomes {to}"
          sentence as `improves`, distinguished only by a muted arrow instead of a
          muted tick. So the one channel a screen-reader user receives — the list
          label and the text — announced "what Autopilot would add" over an item
          the server had explicitly declined to call a gain. That is the round-1
          downgrade-as-upgrade defect, moved into the channel nobody was looking
          at, and it is the same principle as CLAUDE.md's rule against carrying a
          warning in colour alone.

          Three things differ now, not one: the heading, the accessible name, and
          the wording — which says outright that the number is different rather
          than larger, because that is precisely what `comparableAmount` refused
          to decide. */}
      {upgrade.changes.length > 0 && (
        <>
          <h5 className="mt-3 text-xs uppercase tracking-wide text-[var(--v2-text-muted)]">
            What changes on {upgrade.name}
          </h5>
          <ul className="mt-1.5 space-y-1.5" aria-label={`What changes on ${upgrade.name}`}>
            {upgrade.changes.map((entry) => (
              <li key={entry.capability} className="flex items-start gap-2">
                <ArrowRight className="w-4 h-4 shrink-0 mt-0.5 text-[var(--v2-text-muted)]" />
                <span className="text-sm text-[var(--v2-text-primary)] min-w-0">
                  {entry.label}
                  <span className="text-[var(--v2-text-muted)]">
                    {' '}
                    — from {entry.from} to {entry.to}, which is different rather than larger
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* The action, or the reason there is not one.
          A plan with a price beside it reads as an offer, so when it cannot be
          bought that has to be SAID — never a dead button, and never silence.
          Driven by `availableToBuy`, so WS-2 step 3 flips a config flag and this
          becomes a real action without the component being touched. */}
      {upgrade.availableToBuy ? (
        <p className="text-xs text-[var(--v2-text-muted)] mt-3">
          Available to choose. (The buy flow arrives with this flag — see WS-2 step 3.)
        </p>
      ) : (
        <p className="text-xs text-[var(--v2-text-muted)] mt-3">
          <span className="inline-block px-1.5 py-0.5 me-1.5 bg-[var(--v2-bg)] text-[var(--v2-text-muted)] rounded">
            Coming soon
          </span>
          {sentence(upgrade.actionUnavailableBecause)}
        </p>
      )}
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
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
function priceLine(plan: PlanPayload, t: (key: string) => string): string {
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

