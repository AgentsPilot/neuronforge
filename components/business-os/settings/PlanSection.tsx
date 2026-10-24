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
 * BUYING (plan payments P-4.2; since upgrade modal UM-1b, inside the modal)
 *
 * Choose and Upgrade no longer render here: the plan comparison window
 * (`UpgradeModal`, opened by "See plans") mounts the `PlanPurchase` /
 * `PlanUpgrade` islands, never this section (C-12: one Stripe Embedded Checkout
 * per page). It shares THIS section's `usePlanFlow` instance and closes when a
 * checkout completes or an upgrade goes through, so the lines below ("Payment
 * processing", "Upgrading…", "You're on …") still appear here (C-3).
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
 * OPENING FAST (settings drawer review C-2, slice C-b)
 *
 * The settings page may start the first `my-plan` read before the click
 * (`planDrawerReads`, `useDrawerPrefetch`) and hand it over through
 * `takePrefetched`. It is taken ONCE per mount, in a ref-guarded effect
 * outside the cancellable one, so StrictMode cannot spend it (B-1). It serves
 * the FIRST read only, and only with no valid checkout marker on the URL and
 * in the same language (B-2, B-3); a warm answer that is not an `ok` plan is
 * read again, fresh. Every other read fetches, as before: the bounded
 * re-reads, "Check again" and the language re-read. Success never comes from
 * a warmed read: "You're on" needs a marker or an upgrade made in this mount,
 * and neither exists when the first read is taken.
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

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Loader2, Sparkles } from 'lucide-react';

import { useLanguage } from '@/lib/business-os/LanguageContext';
// Display only, and a pure file with no import (P-5a.2): a well-formed
// checkout session id on the URL means "show Payment processing".
import { isCheckoutReturnMarker } from '@/lib/business-os/billing/checkoutReturnMarker';
import { createLogger } from '@/lib/logger';

import { readMyPlan, type PlanDrawerRead, type PlanRead } from './planDrawerReads';
import type { PlanPayload, PlanSentence, PlanUpgradeView } from './planPayloadTypes';
import { CategoryRowText, Notice, PlanBillingNotices, PlanIncludedList, fill, priceLine, renderSentence } from './planText';
import { PlanFlowStatus } from './PlanFlowStatus';
import { UpgradeModal } from './UpgradeModal';
import { useUpgradeModalInlineHost } from './UpgradeModalProvider';
import { upgradeModalView } from './upgradeModalView';
import { planFrom, usePlanFlow } from './usePlanFlow';

/*
 * Moved, not changed (upgrade modal UM-1a, C-2): the payload types live in
 * `planPayloadTypes.ts`, the sentence / price / row helpers in `planText.tsx`
 * (shared with the plan comparison modal), and the checkout / upgrade flow in
 * `usePlanFlow.ts`. Re-exported so every existing importer resolves unchanged.
 */
export type { PlanPayload } from './planPayloadTypes';
export { ACCOUNT_CLOCK_SENTENCE_KEYS } from './planText';

const logger = createLogger({ module: 'BusinessOsPlanSection' });

/**
 * A warm read is used only when it answered with a plan that is `ok` (SA Q-3).
 * Anything else (`unavailable`, `no_plan_record`, `success: false`, a throw)
 * is read once more, fresh.
 */
function isUsableWarm(answer: PlanRead): boolean {
  return answer.kind === 'answered' && planFrom(answer.body)?.status === 'ok';
}

/** Why a warm read was not used, for a `debug` line: never the body, never a plan name (SA-CB-4). */
function discardContext(answer: PlanRead): { reason: string; status?: number; err?: unknown } {
  if (answer.kind === 'threw') return { reason: 'threw', err: answer.err };
  const data = planFrom(answer.body);
  return { reason: data ? `plan_${data.status}` : 'no_plan', status: answer.status };
}

interface FirstRead {
  /** The language the read was started for. */
  language: string;
  read: Promise<PlanRead>;
  /** Started by the page before the click, rather than by this mount. */
  preloaded: boolean;
}

export function PlanSection({
  checkoutMarker = null,
  takePrefetched,
}: {
  checkoutMarker?: string | null;
  /**
   * C-b: hands over the read the settings page started before the click, or
   * `null`. Called once per mount, for the first read only.
   */
  takePrefetched?: () => PlanDrawerRead | null;
} = {}) {
  const { t, isRTL, language, timezone } = useLanguage();

  const sentence = (value: PlanSentence | null | undefined) => renderSentence(value, t, language, timezone);
  const [plan, setPlan] = useState<PlanPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  /** The checkout / upgrade flow (state, predicates, callbacks, bounded re-read): `usePlanFlow` (C-2). */
  const {
    marker,
    succeeded,
    checkoutProcessing,
    upgradeSucceeded,
    upgradeProcessing,
    processing,
    exhausted,
    checkoutAllowed,
    upgradeAllowed,
    paymentsConfigured,
    onCheckoutComplete,
    onUpgrading,
    onUpgradeCheckAgain,
  } = usePlanFlow({ plan, setPlan, setFailed, loading, checkoutMarker });
  /** C-b (B-1): the first read is fixed once per mount, StrictMode included. */
  const firstStarted = useRef(false);
  const firstRead = useRef<FirstRead | null>(null);
  /** Upgrade modal: the plan comparison window (UM-1a), where Choose and Upgrade live since UM-1b. */
  const [compareOpen, setCompareOpen] = useState(false);

  /*
   * The FIRST read, fixed once per mount (C-b, B-1). Declared immediately
   * before the `[language]` effect, which applies it: React runs one
   * component's effects in declaration order, so this always runs first
   * (SA-CB-3).
   *
   * In an effect guarded by a ref, not in render and not in a `useState`
   * initializer: under StrictMode the mount render runs twice and the first
   * one's hooks are thrown away, so a `take()` there would be spent by the
   * discarded render. Effects re-run on the same fiber, so the ref survives and
   * StrictMode's re-run starts and takes nothing. The cold read starts here
   * too, so the cancelled run and the kept run share ONE request (SA Q-2).
   */
  useEffect(() => {
    if (firstStarted.current) return;
    firstStarted.current = true;
    // Always taken, even when it will not be used: a set never outlives the
    // mount it was offered to (rule 1, SA Q-4).
    const offered = takePrefetched?.() ?? null;
    const usable =
      offered !== null &&
      // B-2: a checkout return always reads fresh.
      !isCheckoutReturnMarker(checkoutMarker) &&
      // B-3: a set started in another language is not this one.
      offered.language === language;
    firstRead.current = usable
      ? { language, read: offered.plan, preloaded: true }
      : { language, read: readMyPlan(), preloaded: false };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only: the set is taken once (B-1)
  }, []);

  useEffect(() => {
    let cancelled = false;

    /*
     * No language on the request: see `planDrawerReads`. Re-read when the
     * language changes so the plan and feature NAMES catch up once the
     * preference is saved. The SENTENCES do not wait for that: they are keys,
     * rendered below, and switch immediately.
     *
     * The first run applies the first read (above), when it was started in this
     * language. Any other run reads fresh (B-2), and the first read is spent
     * once it is applied, so a later switch back reads fresh too.
     */
    const pending = firstRead.current;
    const first = pending !== null && pending.language === language ? pending : null;
    if (first === null) firstRead.current = null;

    void (async () => {
      // StrictMode: the cancelled run and the kept run await the same promise.
      let answer = first !== null ? await first.read : await readMyPlan();
      if (cancelled) return;
      // An unusable warm answer is never shown: read once more, fresh, and judge
      // only that answer (SA Q-3). A cold first read is applied as it is.
      if (first !== null && first.preloaded && !isUsableWarm(answer)) {
        logger.debug(discardContext(answer), 'Prefetched plan read unusable; reading again');
        answer = await readMyPlan();
        if (cancelled) return;
      }
      if (first !== null) firstRead.current = null;

      if (answer.kind === 'threw') {
        logger.error({ err: answer.err }, 'Could not load the plan section');
        setFailed(true);
        return;
      }
      const data = planFrom(answer.body);
      if (!data) {
        setFailed(true);
        return;
      }
      setPlan(data);
    })().finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
    // Re-fetched on a language change, so the names follow the interface.
  }, [language]);

  /*
   * UM-SA2 (upgrade modal UM-2, workplan §4.3): while this section is mounted
   * (the plan drawer is open) it hosts its own window, so the layout's
   * `openUpgradeModal` refuses rather than portal a second one over the drawer.
   * Declared AFTER the `[language]` effect, so P-G8 still holds.
   */
  useUpgradeModalInlineHost();

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

  const compare = upgradeModalView(plan);

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
        {/* P-6a.2 (workplan §5.7): B3 / B4, shared with the Settings pop-up (UM-D3). */}
        <PlanBillingNotices plan={plan} t={t} />
      </div>

      {/* B5 / B6, one rendering shared with the standalone window (UM-2 §5.3). */}
      <PlanFlowStatus
        flow={{ marker, succeeded, upgradeSucceeded, upgradeProcessing, checkoutProcessing, processing, exhausted }}
        planName={plan.name}
      />

      {/* Free plans only: what happens when free is not free. Written now so the
          change is something the customer has already read once. */}
      {sentence(plan.whenThisChanges) && <Notice>{sentence(plan.whenThisChanges)}</Notice>}

      {/* What you have */}
      <div>
        <h4 className="text-xs uppercase tracking-wide text-[var(--v2-text-muted)] mb-2">
          {t('plan.includes')}
        </h4>
        <PlanIncludedList plan={plan} t={t} noteTestIdPrefix="plan-category-note-" />
      </div>

      {/* The plan above, as information. Its own footer no longer says
          "Available to choose." once the server sends a purchase view: the Choose
          list below is the action, and with nothing offered (paying, switches
          off) the line would promise a choice nobody can make. */}
      {/* `!== undefined`, not truthiness (SA P-4.2 review): the route always
          sends `purchase`, and `null` (the view threw, or the key mode is
          unknown) offers nothing either, so it must not bring the line back. */}
      {plan.nextPlanUp && <NextPlanUp upgrade={plan.nextPlanUp} purchaseKnown={plan.purchase !== undefined} />}

      {/* Upgrade modal: "See plans" when the server offers something (any
          column has a button, an admin-assigned "Pay for" included), "Compare
          plans" otherwise (§5.1, UM-1b §8.2). Last in the section, under B9.
          Not while a payment or upgrade is landing (SA Q-3: the flow's own
          `processing`), and only when the server sent a comparison (C-21): the
          UI never builds a table itself. */}
      {(plan.plans?.length ?? 0) > 0 && !processing && compare.available && (
        <>
          <button
            type="button"
            onClick={() => setCompareOpen(true)}
            aria-haspopup="dialog"
            data-testid="plan-compare-open"
            // LF-1 (live test 2026-10-20): the app's own primary button, on the admin
            // theme's --v2-primary like every other one; no gradient, no darker shade
            // (the theme provider does not set it, so it fell back to the default indigo).
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[var(--v2-primary)] hover:opacity-90 rounded-[var(--v2-radius-button)] shadow-[var(--v2-shadow-button)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--v2-primary)]"
          >
            <Sparkles aria-hidden="true" className="w-4 h-4 shrink-0" />
            <span>{t(compare.hasActions ? 'upgrade_modal.open_see_plans' : 'upgrade_modal.open_compare')}</span>
          </button>
          <UpgradeModal
            open={compareOpen}
            onOpenChange={setCompareOpen}
            plan={plan}
            flow={{ checkoutAllowed, upgradeAllowed, paymentsConfigured, onCheckoutComplete, onUpgrading, onUpgradeCheckAgain }}
          />
        </>
      )}
    </div>
  );
}

function NextPlanUp({ upgrade, purchaseKnown = false }: { upgrade: PlanUpgradeView; purchaseKnown?: boolean }) {
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
