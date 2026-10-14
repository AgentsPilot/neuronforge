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
 * BUYING (plan payments P-4.2)
 *
 * The Choose list lives in `PlanPurchase`, and it too renders only what the
 * server sent: `purchase.offer` is the same predicate the checkout refuses on,
 * so a button appears exactly where the server would sell (M-5). After Stripe
 * completes, the URL carries the return marker (`?checkout=`), this section
 * shows "Payment processing" and re-reads `my-plan` every 4 s, at most 15
 * times (`checkoutProcessing.ts`, shared with the holding screen). "You're on
 * <plan>" is shown ONLY when that server re-read says the plan is a tier and
 * our billing record reads `renewing` (M-6); a failed re-read never claims
 * success, and after the last one "This is taking longer than usual" links to
 * the section without the marker, which shows Choose again if nothing is live.
 *
 * The plan above is information (what it would add).
 *
 * UPGRADING (plan payments P-7b.1b)
 *
 * An owner who already pays sees "Upgrade to <plan>" (`PlanUpgrade`) exactly
 * for the tiers in `purchase.upgrade`, the predicate both upgrade routes refuse
 * on. When the upgrade went through or is landing, this section says
 * "Upgrading…" and re-reads `my-plan` on the same bounded schedule as the
 * checkout return. "You're on <plan>" is shown ONLY when the re-read says the
 * plan in force is that tier, our billing record reads `renewing`, and the
 * record no longer offers that tier as an upgrade (it now pays for it). A
 * failed re-read never claims success (U-5).
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

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Info, Loader2, Sparkles } from 'lucide-react';

import { PROCESSING_REFRESH_INTERVAL_MS, PROCESSING_REFRESH_LIMIT } from '@/components/business-os/billing/checkoutProcessing';
import { useLanguage } from '@/lib/business-os/LanguageContext';
// Display only, and a pure file with no import (P-5a.2): a well-formed
// checkout session id on the URL means "show Payment processing".
import { isCheckoutReturnMarker } from '@/lib/business-os/billing/checkoutReturnMarker';
import type { PlanPurchaseWire } from '@/lib/business-os/billing/planPurchaseTypes';
import { planCategoryLine } from '@/lib/business-os/planCategoryLine';
import { createLogger } from '@/lib/logger';

import { PlanPurchase, type PlanChoice } from './PlanPurchase';
import { PlanUpgrade } from './PlanUpgrade';
import { SETTINGS_PLAN_PATH } from './planPurchaseCopy';

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
  /**
   * A dictionary key for the sentence under the row, or `null` (credit deduction
   * slice 6, D-h). The server chooses it — monthly or one-off by the allowance's
   * shape — and this component only renders it.
   */
  noteKey: string | null;
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
  /**
   * Every plan shown to customers (P-4.2). Optional, like `purchase`: an older
   * payload, or the builder's own output in a test, has neither and renders as
   * the read-only section did.
   */
  plans?: PlanChoice[];
  /** What may be bought, and what our billing record says (P-4.2). `null` when unknown. */
  purchase?: PlanPurchaseWire | null;
  problem: PlanSentence | null;
}

/** The plan read. Resolves `null` when the server did not answer with a plan. */
async function fetchPlan(): Promise<PlanPayload | null> {
  const response = await fetch('/api/business-os/entitlements/my-plan');
  const body = await response.json();
  return body?.success && body?.data ? (body.data as PlanPayload) : null;
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
/**
 * The sentences whose date is a billing INSTANT, read on the account's clock.
 *
 * "Renews on" / "Ends on … It will not renew." carry Stripe's period end: the
 * purchase instant one month on, not a midnight. Formatted in UTC, an owner in
 * Israel who bought between local midnight and 02:00/03:00 read the day before
 * (QA P-4.2 note 3). These two keys come from `billingEndsWhen` only; a test
 * pins that the two agree. Every other dated sentence names a cohort or admin
 * end date stored as midnight UTC, and stays in UTC (see below).
 */
export const ACCOUNT_CLOCK_SENTENCE_KEYS: ReadonlySet<string> = new Set(['plan.renews_on', 'plan.ends_on_paid']);

function renderSentence(
  value: PlanSentence | null | undefined,
  t: (key: string) => string,
  language: string,
  /** `user_preferences.timezone` via `useLanguage()`; the provider holds 'UTC' while unknown or unset. */
  accountTimezone: string | undefined
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
function fill(template: string, values: Record<string, string>): string {
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
function CategoryRowText({
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

export function PlanSection({ checkoutMarker = null }: { checkoutMarker?: string | null } = {}) {
  const { t, isRTL, language, timezone } = useLanguage();

  const sentence = (value: PlanSentence | null | undefined) => renderSentence(value, t, language, timezone);
  const [plan, setPlan] = useState<PlanPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  /** Stripe completed in THIS page, before the URL caught up (P-4.2). */
  const [completedSession, setCompletedSession] = useState<string | null>(null);
  const [refreshes, setRefreshes] = useState(0);
  /** P-7b.1b: the tier an upgrade was made to in THIS page, and whether the section is re-reading for it. */
  const [upgradeTarget, setUpgradeTarget] = useState<string | null>(null);
  const [upgradeWatching, setUpgradeWatching] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The return marker, pattern-checked; display only. Never a release, never a claim.
  const marker = isCheckoutReturnMarker(checkoutMarker) ? checkoutMarker : completedSession;
  // M-6: success comes ONLY from the server's own answer.
  const succeeded = plan?.status === 'ok' && plan.kind === 'tier' && plan.purchase?.billing?.state === 'renewing';
  const checkoutProcessing = marker !== null && !succeeded;
  // U-5: the upgrade's success, from the server only: the plan in force is the
  // target, renewing, and our record no longer offers it (it pays for it now).
  // The last term keeps an admin-assigned plan equal to the target (Q-5) from
  // reading as done before the webhook lands.
  const upgradeSucceeded =
    upgradeTarget !== null && succeeded && plan?.planId === upgradeTarget && !(plan?.purchase?.upgrade?.tiers ?? []).includes(upgradeTarget);
  const upgradeProcessing = upgradeWatching && !upgradeSucceeded;
  const processing = checkoutProcessing || upgradeProcessing;
  const exhausted = refreshes >= PROCESSING_REFRESH_LIMIT;

  const onCheckoutComplete = useCallback((sessionId: string) => {
    setRefreshes(0);
    setCompletedSession(sessionId);
  }, []);

  /** P-7b.1b: the upgrade went through or is landing. "Upgrading…" and the bounded re-read. */
  const onUpgrading = useCallback((tier: string) => {
    setRefreshes(0);
    setUpgradeTarget(tier);
    setUpgradeWatching(true);
  }, []);

  /** P-7b.1b (SA V-3 "Check again"): ONE server re-read; success still only from its answer. */
  const onUpgradeCheckAgain = useCallback(async (tier: string) => {
    setUpgradeTarget(tier);
    try {
      const data = await fetchPlan();
      if (mounted.current && data) {
        setPlan(data);
        setFailed(false);
      }
    } catch (error) {
      logger.warn({ err: error }, 'Plan re-read after an unconfirmed upgrade failed');
    }
  }, []);

  /*
   * The bounded re-read after checkout (M-6): every 4 s, at most 15 times.
   * A failed re-read keeps the plan already on screen and keeps saying
   * "processing": it never claims success.
   */
  useEffect(() => {
    if (!processing || exhausted || loading) return undefined;
    const timer = setTimeout(() => {
      fetchPlan()
        .then((data) => {
          if (mounted.current && data) {
            setPlan(data);
            // A first read that failed must not hide a later good answer (SA P-4.2 review).
            setFailed(false);
          }
        })
        .catch((error) => {
          logger.warn({ err: error }, 'Plan re-read after checkout or upgrade failed');
        })
        .finally(() => {
          if (mounted.current) setRefreshes((count) => count + 1);
        });
    }, PROCESSING_REFRESH_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [processing, exhausted, loading, refreshes]);

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
    fetchPlan()
      .then((data) => {
        if (cancelled) return;
        if (!data) {
          setFailed(true);
          return;
        }
        setPlan(data);
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

      {/* After checkout (M-6): the server's answer, or "processing" until it comes. */}
      {marker !== null && succeeded && plan.name && (
        <p role="status" className="text-sm text-[var(--v2-text-primary)]" data-testid="plan-purchase-done">
          {fill(t('plan.purchase.done'), { plan: plan.name })}
        </p>
      )}
      {upgradeSucceeded && plan.name && (
        <p role="status" className="text-sm text-[var(--v2-text-primary)]" data-testid="plan-upgrade-done">
          {fill(t('plan.upgrade.done'), { plan: plan.name })}
        </p>
      )}
      {upgradeProcessing && !checkoutProcessing && !exhausted && (
        <p role="status" className="flex items-center gap-2 text-sm text-[var(--v2-text-muted)]" data-testid="plan-upgrade-upgrading">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>{t('plan.upgrade.upgrading')}</span>
        </p>
      )}
      {checkoutProcessing && !exhausted && (
        <p role="status" className="flex items-center gap-2 text-sm text-[var(--v2-text-muted)]" data-testid="plan-purchase-processing">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>{t('plan.purchase.processing')}</span>
        </p>
      )}
      {processing && exhausted && (
        <div className="space-y-1" data-testid="plan-purchase-slow">
          <p className="text-sm text-[var(--v2-text-muted)]">{t('plan.purchase.slow')}</p>
          {/* Without the marker: Choose shows again if nothing is live, so a stale
              or bookmarked marker cannot trap the owner here. */}
          <a href={SETTINGS_PLAN_PATH} className="text-sm text-[var(--v2-primary)] underline" data-testid="plan-purchase-check-again">
            {t('plan.purchase.check_again')}
          </a>
        </div>
      )}

      {/* Free plans only: what happens when free is not free. Written now so the
          change is something the customer has already read once. */}
      {sentence(plan.whenThisChanges) && <Notice>{sentence(plan.whenThisChanges)}</Notice>}

      {/* What you have */}
      <div>
        <h4 className="text-xs uppercase tracking-wide text-[var(--v2-text-muted)] mb-2">
          {t('plan.includes')}
        </h4>
        {plan.included.length === 0 ? (
          <p className="text-sm text-[var(--v2-text-muted)]">{t('plan.features_unavailable')}</p>
        ) : (
          // Named so a screen reader says which list this is, and so a test can
          // scope to it: an unnamed second list two elements down carries similar
          // numbers, and a positional query silently followed it.
          <ul className="space-y-2" aria-label={t('plan.includes')}>
            {plan.included.map((row) => (
              <li key={row.category} className="flex items-start gap-2">
                <Check className="w-4 h-4 shrink-0 mt-0.5 text-[var(--v2-primary)]" />
                <CategoryRowText row={row} t={t} noteTestId={`plan-category-note-${row.category}`} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* The plan above, as information. Its own footer no longer says
          "Available to choose." once the server sends a purchase view: the Choose
          list below is the action, and with nothing offered (paying, switches
          off) the line would promise a choice nobody can make. */}
      {/* `!== undefined`, not truthiness (SA P-4.2 review): the route always
          sends `purchase`, and `null` (the view threw, or the key mode is
          unknown) offers nothing either, so it must not bring the line back. */}
      {plan.nextPlanUp && <NextPlanUp upgrade={plan.nextPlanUp} purchaseKnown={plan.purchase !== undefined} />}

      {/* Upgrading (P-7b.1b): only what the server offers, and not while a change is landing. */}
      {marker === null && !upgradeWatching && !upgradeSucceeded && (plan.purchase?.upgrade?.tiers.length ?? 0) > 0 && (plan.plans?.length ?? 0) > 0 && (
        <PlanUpgrade
          plans={plan.plans ?? []}
          tiers={plan.purchase?.upgrade?.tiers ?? []}
          currentPlan={{ planId: plan.planId, name: plan.name, isTier: plan.kind === 'tier' }}
          onUpgrading={onUpgrading}
          onCheckAgain={onUpgradeCheckAgain}
        />
      )}

      {/* Buying (P-4.2): only what the server offers, and not while a payment is landing. */}
      {marker === null && plan.purchase?.offer.kind === 'choose' && (plan.plans?.length ?? 0) > 0 && (
        <PlanPurchase
          plans={plan.plans ?? []}
          tiers={plan.purchase.offer.tiers}
          endsFreeAccess={plan.purchase.endsFreeAccessOnPurchase}
          onComplete={onCheckoutComplete}
          // SA Q-7: the plan in force, when it is a tier, labels its own row "Pay for".
          currentTierId={plan.kind === 'tier' ? plan.planId : null}
        />
      )}
    </div>
  );
}

function NextPlanUp({ upgrade, purchaseKnown = false }: { upgrade: PlanUpgrade; purchaseKnown?: boolean }) {
  const { t, language, timezone } = useLanguage();
  const sentence = (value: PlanSentence | null | undefined) => renderSentence(value, t, language, timezone);
  // Every word on this card comes from the dictionary (user decision,
  // 2026-10-02): the values were already in the reader's language, and English
  // words around them made one mixed line in Hebrew and Spanish (QA-6b-E1).
  const addsHeading = fill(t('plan.next.adds_heading'), { plan: upgrade.name });
  const changesHeading = fill(t('plan.next.changes_heading'), { plan: upgrade.name });

  return (
    <div className="pt-4 border-t border-[var(--v2-border)]">
      <h4 className="text-xs uppercase tracking-wide text-[var(--v2-text-muted)] mb-2 flex items-center gap-1.5">
        <Sparkles className="w-3.5 h-3.5" />
        <span>
          {upgrade.name}
          {upgrade.monthlyPriceUsd > 0 &&
            ` — ${fill(t('plan.price.per_month'), { amount: `$${upgrade.monthlyPriceUsd}` })}`}
        </span>
      </h4>

      {/* No empty-state branch: the server sends `nextPlanUp` only when there is
          something in one of these lists, so a "nothing to show" paragraph here
          was unreachable (QA-2). When there is nothing above this plan the whole
          section is absent. */}
      <h5 className="text-xs uppercase tracking-wide text-[var(--v2-text-muted)]">{addsHeading}</h5>
      <ul className="mt-1.5 space-y-1.5" aria-label={addsHeading}>
          {upgrade.adds.map((row) => (
            <li key={row.category} className="flex items-start gap-2">
              <Check className="w-4 h-4 shrink-0 mt-0.5 text-[var(--v2-text-muted)]" />
              <CategoryRowText row={row} t={t} noteTestId={`plan-next-category-note-${row.category}`} />
            </li>
          ))}
          {upgrade.improves.map((entry) => (
            <li key={entry.capability} className="flex items-start gap-2">
              <Check className="w-4 h-4 shrink-0 mt-0.5 text-[var(--v2-text-muted)]" />
              <span className="text-sm text-[var(--v2-text-primary)] min-w-0">
                {entry.label}
                <span className="text-[var(--v2-text-muted)]">
                  {' '}
                  — {fill(t('plan.next.improves_line'), { from: entry.from, to: entry.to })}
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
          <h5 className="mt-3 text-xs uppercase tracking-wide text-[var(--v2-text-muted)]">{changesHeading}</h5>
          <ul className="mt-1.5 space-y-1.5" aria-label={changesHeading}>
            {upgrade.changes.map((entry) => (
              <li key={entry.capability} className="flex items-start gap-2">
                <ArrowRight className="w-4 h-4 shrink-0 mt-0.5 text-[var(--v2-text-muted)]" />
                <span className="text-sm text-[var(--v2-text-primary)] min-w-0">
                  {entry.label}
                  <span className="text-[var(--v2-text-muted)]">
                    {' '}
                    — {fill(t('plan.next.changes_line'), { from: entry.from, to: entry.to })}
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
        // With a purchase view (P-4.2) the Choose list carries the action, so this
        // line is not repeated; without one it reads as before.
        purchaseKnown ? null : <p className="text-xs text-[var(--v2-text-muted)] mt-3">{t('plan.next.available')}</p>
      ) : (
        <p className="text-xs text-[var(--v2-text-muted)] mt-3">
          <span className="inline-block px-1.5 py-0.5 me-1.5 bg-[var(--v2-bg)] text-[var(--v2-text-muted)] rounded">
            {t('plan.next.coming_soon')}
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

