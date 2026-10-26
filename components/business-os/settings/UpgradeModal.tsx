'use client';

/**
 * The plan comparison window, where an owner buys or upgrades (upgrade modal
 * UM-1a view, UM-1b money; workplans §5 / §4–§8).
 *
 * Opened by "See plans" / "Compare plans" in Settings → "Your plan". A band, a
 * status strip, and the server's comparison table: one column per shown plan
 * (name, price, the server's action), short grouped rows, ✓ / ✕ / value. A
 * trial or Founding Partner also gets its own plan as the first column, marked
 * "Your plan" (live-test fix LF-2), when the server sends it.
 *
 * ── PALETTE (live-test fix LF-1, 2026-10-20) ────────────────────────────────
 * The app's real theme is admin-configurable (ui-config custom tokens): the
 * theme provider rewrites --v2-primary and --v2-secondary, not the darker
 * shade. So nothing here uses that shade or a gradient, and no words sit on a
 * colour the admin may change except the app's own primary button
 * (`bg-[var(--v2-primary)] text-white`, the Business OS convention). The band is
 * a soft primary tint over the surface with --v2-text-primary words; badges and
 * the recommended column are on the --v2-primary family. Contrast is pinned on
 * the default AND the live custom tokens (`upgradeModal.contrast`).
 *
 * ── IT RENDERS; IT DOES NOT DECIDE ──────────────────────────────────────────
 * Every row, label, ✓ / ✕, value, highlight and order is `plan.comparison`, as
 * the server sent it (C-21); each column's button is the server's offer, read by
 * `upgradeModalView` (UM-FR3). Nothing here names a plan or compares an id to a
 * literal (C-7).
 *
 * ── MONEY (UM-1b) ───────────────────────────────────────────────────────────
 * A column's header and footer buttons are two buttons for ONE flow (C-25):
 * pressing either replaces the table area with that plan's island,
 * `PlanPurchase` (embedded checkout) or `PlanUpgrade` (preview → confirm), with
 * its start prop, so the press starts it (SA Q-2). Requests and payloads are the
 * islands' own, unchanged (UM-FR4). One flow at a time, and the islands live
 * only here, never in the drawer (C-12: one Stripe Embedded Checkout per page).
 *
 * ── HAND-OFF (C-3, SA W-2) ──────────────────────────────────────────────────
 * When Stripe completes a checkout or an upgrade goes through, the modal tells
 * `PlanSection`'s one `usePlanFlow` instance (passed in as `flow`) and closes
 * through `handOff`, which bypasses the busy gate: the island reports "busy" from
 * an effect, so it is still set when its success callback arrives. The drawer
 * then shows "Payment processing" / "Upgrading…" (B5 / B6). No read here.
 *
 * ── BUSY LOCK (UM-FR11, SA Q-5 / Q-8) ───────────────────────────────────────
 * While the upgrade's Confirm or 3-D Secure runs, nothing the owner does closes
 * the window: `onOpenChange(false)` (the X included) is refused, Escape and
 * outside presses are prevented. While a checkout frame is open an outside press
 * is refused, but the X and Escape still close.
 *
 * ── OPENED FROM ANYWHERE (UM-2, workplan §5.2) ──────────────────────────────
 * Three optional props, whose defaults are the Settings behaviour above, so
 * Settings passes none of them:
 *   - `context`: why it was opened; changes the headline, subheading and
 *     highlighted column only (UM-FR8, `upgradeModalView`);
 *   - `afterUpgrade: 'stay'`: an upgrade that goes through keeps the window open
 *     and shows "Upgrading…" / "You're on {plan}" in its body, from the caller's
 *     own flow values (`flowStatus`). A checkout still hands off and closes: it
 *     returns to Settings → Plan (UM-SA10);
 *   - `readState`: the standalone window's own read, loading or failed, shown in
 *     the body so the window is never blank (X-3: `ready` always has a plan).
 *
 * ── THE SETTINGS POP-UP (UM-D3, SA R-2 / R-5 / R-7; UM-3 §5.5) ──────────────
 * Since UM-D3 "Your plan" opens this window directly when the server offers
 * something. That instance (`SettingsPlanModal`) passes four more optional
 * props, whose defaults are again the behaviour above:
 *   - `strip: 'your_plan'`: the strip starts with the "Your plan" badge and the
 *     plan's name for EVERY account (R-6), carries the drawer's failed-renewal
 *     lines (B3 / B4) and a collapsed "What your plan includes" (B8), so nothing
 *     the drawer said is lost;
 *   - `afterCheckout: 'stay'`: a completed checkout keeps the window open with
 *     "Payment processing" / "You're on {plan}" in its body, as does a checkout
 *     return marker (R-7);
 *   - `footerClose: 'close'`: no drawer behind it, so the footer reads "Close";
 *   - `returnFocusRef`: focus goes back to the "Your plan" row, which may not
 *     be the active element when a link opened the window.
 * The X's screen-reader name is translated in every instance (UM-3 SA Q-1).
 */

import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { Check, ChevronLeft, Loader2, Lock, Sparkles, Star, X } from 'lucide-react';

import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useLanguage } from '@/lib/business-os/LanguageContext';

import { PlanFlowStatus, type PlanFlowStatusValues } from './PlanFlowStatus';
import { PlanManage } from './PlanManage';
import { PlanPurchase } from './PlanPurchase';
import type { PlanComparisonCell, PlanComparisonSection, PlanPayload, PlanSentence } from './planPayloadTypes';
import { ENDS_FREE_ACCESS_KEYS } from './planPurchaseCopy';
import { PlanBillingNotices, PlanIncludedList, fill, priceLine, renderSentence } from './planText';
import { PlanUpgrade, type PlanUpgradeLock } from './PlanUpgrade';
import { SETTINGS_CONTEXT, type UpgradeModalContext } from './upgradeModalContext';
import { upgradeModalView, type OwnPlanColumnView, type PlanColumnView, type UpgradeModalView } from './upgradeModalView';
import type { PlanFlow } from './usePlanFlow';

/**
 * The plan columns on a phone (UM-D1-M, option M-A, C-24): every row becomes a
 * grid with one column per plan, the feature label spanning the row above its
 * cells. LF-2: two columns, or THREE when the account's own plan (trial,
 * Founding Partner) leads; the phone header is compact then (smaller badges and
 * buttons), and nothing scrolls sideways at 360 px. ASSUMES AT MOST THREE TABLE
 * COLUMNS (two shown plans + one own plan) — the assumption
 * `components/business-os/settings/__tests__/planComparison.twoPlans.tripwire.test.ts`
 * (C-27) protects. Raise both together, after re-deciding UM-D1-M with the user.
 */
const PHONE_ROW: Record<2 | 3, string> = {
  2: 'max-sm:grid max-sm:grid-cols-2',
  3: 'max-sm:grid max-sm:grid-cols-3',
};

/**
 * SA Q-7 (iii), the contained exception: Radix sets `pointer-events: none` on
 * `body` while a modal layer is open (W-1a probe, `UpgradeModal.layers`), and
 * Stripe.js mounts its 3-D Secure challenge on `body`, outside every layer. In
 * BOTH phases where Stripe may do that, Stripe's frames get pointer events back:
 * while the upgrade is busy (Confirm / its 3-D Secure), and while a checkout
 * frame is open (the embedded checkout's own 3-D Secure, SA CR-2). Rendered only
 * then, so it is removed as soon as the step settles or the frame goes.
 * Stripe names every frame it mounts `__privateStripeFrame…`.
 */
export const STRIPE_CHALLENGE_REACHABLE_CSS = 'iframe[name^="__privateStripeFrame"]{pointer-events:auto !important;}';

/** What the modal needs from `PlanSection`'s flow instance (C-3): values and callbacks, never a second copy. */
export type UpgradeModalFlow = Pick<
  PlanFlow,
  'checkoutAllowed' | 'upgradeAllowed' | 'paymentsConfigured' | 'onCheckoutComplete' | 'onUpgrading' | 'onUpgradeCheckAgain'
>;

type Where = 'header' | 'footer';
interface OpenFlow {
  kind: 'checkout' | 'upgrade';
  planId: string;
}

/**
 * X-3 (UM-2): the plan, and whether the caller's read has produced it. `ready`
 * (the default, what Settings passes implicitly) always carries a plan, so `tsc`
 * rules out "ready with no plan"; loading and failed carry none.
 */
export type UpgradeModalRead = { readState?: 'ready'; plan: PlanPayload } | { readState: 'loading' | 'failed'; plan?: null };

/** A marked column: the Recommended one, or the plan a locked action needs (UM-2 O-1). Never both. */
const isHighlighted = (column: PlanColumnView) => column.highlightReason !== null;

/** LF-1: the recommended column, on the theme's primary (whatever the admin set it to). */
// /5, not /10: --v2-text-secondary small text in that column must stay ≥ 4.5:1 (light, default and live tokens).
const RECOMMENDED_TINT = 'bg-[var(--v2-primary)]/5';
/** The account's own column ("Your plan"): a tier's, or the LF-2 own-plan column. */
const OWN_TINT = 'bg-[var(--v2-surface-hover)]';

/** The tint a marked column carries on every cell of the table, so it reads as one column. */
function columnTint(column: PlanColumnView): string {
  if (isHighlighted(column)) return RECOMMENDED_TINT;
  if (column.isCurrent) return OWN_TINT;
  return '';
}

/** LF-1: "Recommended" / "Needed for this": primary tint and border, primary-text words (any theme). */
const MARK_BADGE =
  'inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold text-[var(--v2-text-primary)] bg-[var(--v2-primary)]/15 border border-[var(--v2-primary)] rounded-full';
/** "Your plan": the quiet badge, on the strip and on the own column alike (C-22). */
const OWN_BADGE =
  'inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold text-[var(--v2-text-primary)] bg-[var(--v2-surface-hover)] border border-[var(--v2-border)] rounded-full';
/** LF-2: with three columns a phone header cell is about 110 px wide, so badges and buttons shrink there. */
const COMPACT_BADGE = ' max-sm:px-1.5 max-sm:text-[11px] max-sm:gap-0.5';

/** The strip's separator: a no-break space then "·", so it stays at the end of the item before it. */
const STRIP_SEPARATOR = ' ·';

const actionKey = (planId: string, where: Where) => `${planId}:${where}`;
const actionTestId = (planId: string, where: Where) => `plan-compare-action-${planId}-${where}`;

/** The band's two lines for a view (UM-2 §6): the variant's copy, the plan name always from the payload. */
function bandCopy(view: UpgradeModalView | null, t: (key: string) => string): { headline: string; subheading: string } {
  if (view === null) return { headline: t('upgrade_modal.headline.compare'), subheading: t('upgrade_modal.subheading') };
  const values = { plan: view.lockedPlan?.name ?? '' };
  return {
    headline: fill(t(`upgrade_modal.headline.${view.headline}`), values),
    subheading: view.subheading === 'default' ? t('upgrade_modal.subheading') : fill(t(`upgrade_modal.subheading.${view.subheading}`), values),
  };
}

export function UpgradeModal({
  open,
  onOpenChange,
  flow: planFlow,
  context = SETTINGS_CONTEXT,
  afterUpgrade = 'close',
  flowStatus,
  afterCheckout = 'close',
  footerClose = 'back_to_plan',
  strip = 'status',
  returnFocusRef,
  onPlanManaged,
  ...read
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** PlanSection's `usePlanFlow` instance (C-2, C-3), or the standalone window's own (UM-SA1). */
  flow: UpgradeModalFlow;
  /** UM-2: why the window was opened. Default: Settings. */
  context?: UpgradeModalContext;
  /** UM-2: `stay` keeps the window open after an upgrade, with the status in its body. Default: close (Settings). */
  afterUpgrade?: 'close' | 'stay';
  /** UM-2: the flow's own status values, rendered in the body after an upgrade in `stay` (values, never predicates: C-2). */
  flowStatus?: PlanFlowStatusValues;
  /** UM-D3 (R-7): `stay` keeps the window open after a checkout, and shows a return marker's status. Default: close. */
  afterCheckout?: 'close' | 'stay';
  /** UM-3 §5.5 / Q-8: the footer button's label. Default: "Back to your plan" (the drawer is behind it). */
  footerClose?: 'back_to_plan' | 'close';
  /** UM-D3 (R-5 / R-6): `your_plan` is the Settings pop-up's strip. Default: the one-line status. */
  strip?: 'status' | 'your_plan';
  /** UM-D3: where focus goes on close, before the element that was active at open. */
  returnFocusRef?: RefObject<HTMLElement>;
  /** P-7a.1: the `your_plan` strip's Cancel / Reactivate answered; the caller re-reads my-plan. */
  onPlanManaged?: () => void;
} & UpgradeModalRead) {
  const { t, isRTL, language, timezone } = useLanguage();
  const sentence = (value: PlanSentence | null | undefined) => renderSentence(value, t, language, timezone);
  /** The caller's plan state (C-3): the modal never reads it itself. `null` only while the caller's read is not ready. */
  // `?? null`: TS cannot narrow on an optional discriminant; `ready` always carries a plan (X-3).
  const plan: PlanPayload | null = read.readState === 'loading' || read.readState === 'failed' ? null : read.plan ?? null;
  const view = plan !== null ? upgradeModalView(plan, context) : null;
  /** UM-2 `stay`: an upgrade went through here, so the body shows the flow's status instead of the table. */
  const [showStatus, setShowStatus] = useState(false);
  /*
   * Focus goes back to whatever opened the modal. Radix returns focus only to a
   * `Dialog.Trigger`, and prevents its focus scope's own return, so a
   * controlled dialog with no trigger (this one; and UM-2's, opened from
   * anywhere) would leave focus on <body>. `onOpenAutoFocus` runs before Radix
   * moves focus, so the active element there is the opener.
   */
  const opener = useRef<HTMLElement | null>(null);
  const titleRef = useRef<HTMLDivElement | null>(null);
  const statusRef = useRef<HTMLDivElement | null>(null);
  const flowHeadingRef = useRef<HTMLHeadingElement | null>(null);
  /** The button "Back to plans" returns focus to (header or footer, whichever was pressed). */
  const returnFocus = useRef<string | null>(null);
  /** The column buttons by key (SA CR-3: a ref map, not a test-id lookup). */
  const actionButtons = useRef(new Map<string, HTMLButtonElement>());
  const registerAction = (key: string, element: HTMLButtonElement | null) => {
    if (element) actionButtons.current.set(key, element);
    else actionButtons.current.delete(key);
  };
  const flowHeadingId = useId();

  const [openFlow, setOpenFlow] = useState<OpenFlow | null>(null);
  const [lock, setLock] = useState<PlanUpgradeLock>('none');
  const [frameOpen, setFrameOpen] = useState(false);
  const busy = lock === 'busy';

  const resetFlow = () => {
    setOpenFlow(null);
    setLock('none');
    setFrameOpen(false);
  };

  /** Every close the OWNER asks for (X, Escape, backdrop, "Back to your plan"): refused while busy. */
  const requestOpenChange = (next: boolean) => {
    if (!next && busy) return;
    if (!next) {
      returnFocus.current = null;
      resetFlow();
    }
    onOpenChange(next);
  };

  /** SA W-2: the hand-off close. Not the owner's request, so the busy gate does not apply. */
  const handOff = () => {
    returnFocus.current = null;
    resetFlow();
    onOpenChange(false);
  };

  const startFlow = (column: PlanColumnView, where: Where) => {
    returnFocus.current = actionKey(column.planId, where);
    setOpenFlow({ kind: column.action === 'upgrade' ? 'upgrade' : 'checkout', planId: column.planId });
  };

  /** "Back to plans", and the quote's "Not now" (W-4). */
  const backToPlans = () => resetFlow();

  // Focus follows the flow: into its heading on entry; back to the pressed button on "Back to plans".
  useEffect(() => {
    if (openFlow !== null) {
      flowHeadingRef.current?.focus();
      return;
    }
    const target = returnFocus.current;
    returnFocus.current = null;
    if (target) actionButtons.current.get(target)?.focus();
  }, [openFlow]);

  /*
   * SA Q-12: "Check again" re-read the plan and the upgrade has landed (its tier
   * left `upgrade.tiers`): the island can no longer render, so hand off to the
   * drawer, which says "You're on {plan}". Once per flow; the hand-off path (W-2).
   */
  /*
   * UM-2 `stay` (§5.2): the upgrade went through. The caller's flow has been
   * told; the window stays open and its body shows the flow's status. Not the
   * hand-off: nothing would be left to say "Upgrading…" outside Settings.
   */
  const stayAfterUpgrade = () => {
    returnFocus.current = null;
    resetFlow();
    setShowStatus(true);
  };

  const upgradeTiers = plan?.purchase?.upgrade?.tiers ?? [];
  const landed = openFlow?.kind === 'upgrade' && !upgradeTiers.includes(openFlow.planId);
  const handedOff = useRef<OpenFlow | null>(null);
  useEffect(() => {
    if (!landed || openFlow === null || handedOff.current === openFlow) return;
    handedOff.current = openFlow;
    if (afterUpgrade === 'stay') stayAfterUpgrade();
    else handOff();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires on the landing only (SA Q-12)
  }, [landed, openFlow]);

  const { headline, subheading } = bandCopy(view, t);
  const BandIcon = view?.variant === 'locked_feature' ? Lock : Sparkles;
  const [statusBefore, statusAfter = ''] = t('upgrade_modal.status_on').split('{plan}');
  const statusPrice = plan ? priceLine(plan, t) : null;
  const statusEnds = sentence(plan?.endsWhen);
  const freeAccessKey =
    view?.somethingOffered && plan?.purchase?.endsFreeAccessOnPurchase ? ENDS_FREE_ACCESS_KEYS[plan.purchase.endsFreeAccessOnPurchase] : null;
  const whenThisChanges = sentence(plan?.whenThisChanges);
  const ownPlanColumn = view?.columns.find((column) => column.ownPlanNote !== null) ?? null;
  // M-2 (SA W-3): ONE line for the whole table, as the Choose list had, not one per slot.
  const checkoutsWithoutKey =
    !planFlow.paymentsConfigured && planFlow.checkoutAllowed && (view?.columns ?? []).some((column) => column.action === 'choose' || column.action === 'pay_for');
  const flowColumn = openFlow && view ? view.columns.find((column) => column.planId === openFlow.planId) ?? null : null;
  /** UM-2: the window's own read is done and the server sent a table to show (Settings never opens it otherwise). */
  const tableReady = plan !== null && plan.status === 'ok' && view !== null && view.available;
  /** UM-D3 (R-7): a checkout completed here, or a return marker, in `stay`: the body shows its status. */
  const checkoutStatus = afterCheckout === 'stay' && flowStatus !== undefined && flowStatus.marker !== null;
  const statusBody = (showStatus && flowStatus !== undefined) || checkoutStatus;
  /** UM-2 §6.2 / X-8: the client's statement of the server's offer, never a reason. */
  const lockedNotOffered = view?.lockedPlan && !view.lockedPlan.offered ? view.lockedPlan : null;
  // §4.5 / C-25: no way back during Confirm, 3-D Secure or "Could not confirm".
  const canGoBack = lock === 'none';

  // UM-D3: once the status replaces the island, focus moves to the status, never to <body>.
  useEffect(() => {
    if (statusBody && open) statusRef.current?.focus();
  }, [statusBody, open]);

  const actionFor = (column: PlanColumnView, where: Where) => (
    <ActionSlot column={column} where={where} flow={planFlow} onStart={startFlow} register={registerAction} />
  );

  return (
    <Dialog open={open} onOpenChange={requestOpenChange}>
      <DialogContent
        dir={isRTL ? 'rtl' : 'ltr'}
        // UM-3 SA Q-1 / Y-1: the built-in X, named in the reader's language (one X, C-8).
        closeLabel={t('upgrade_modal.close')}
        data-testid="plan-compare-modal"
        onOpenAutoFocus={(event) => {
          opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          // SA Q-6: never a money button first; an Enter right after opening starts nothing.
          event.preventDefault();
          titleRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          const target = returnFocusRef?.current?.isConnected ? returnFocusRef.current : opener.current?.isConnected ? opener.current : null;
          if (target) {
            event.preventDefault();
            target.focus();
          }
          opener.current = null;
        }}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          // Busy: nothing outside closes it (Stripe's 3-D Secure challenge is "outside").
          // A checkout frame open: a stray backdrop press must not lose a half-typed card (SA Q-8).
          if (busy || frameOpen) event.preventDefault();
        }}
        // C-8: the flex variant (no grid, no gutter, no scroll from dialog.tsx), one
        // `sm:` width, and the built-in X recoloured for the band by a child
        // selector (SA Q-4) rather than a second X; dimmed and unpressable while busy.
        // LF-1: the band is a light tint now, so the X takes the primary text colour.
        className={`flex flex-col p-0 overflow-hidden w-full h-[100dvh] max-sm:rounded-none sm:h-auto sm:max-h-[90dvh] sm:max-w-4xl sm:rounded-[var(--v2-radius-panel)] border-[var(--v2-border)] [&>button]:text-[var(--v2-text-primary)] [&>button]:opacity-90 [&>button:focus]:ring-[var(--v2-primary)]${
          busy ? ' [&>button]:pointer-events-none [&>button]:opacity-40' : ''
        }`}
      >
        {(busy || frameOpen) && <style data-testid="plan-compare-stripe-reachable">{STRIPE_CHALLENGE_REACHABLE_CSS}</style>}

        {/* LF-1 (live test 2026-10-20): the band is the theme's primary as a SOFT
            tint over the surface (an aria-hidden layer), with a solid primary top
            rule and icon tile as the accent. Both lines are --v2-text-primary (the
            secondary grey is under 4.5:1 on the tint), which reads on any primary the admin picks, light
            and dark: no words on a solid admin colour, no gradient. `pe-12` keeps
            them clear of the X (UM-3 §8.1). §8.3: tighter while a flow is open on
            a phone, to give the card form room. */}
        <div
          data-testid="plan-compare-band"
          className={`relative flex-shrink-0 overflow-hidden bg-[var(--v2-surface)] border-t-4 border-t-[var(--v2-primary)] border-b border-b-[var(--v2-border)] px-5 py-5 pe-12 sm:px-7 sm:py-6${openFlow !== null ? ' max-sm:py-3' : ''}`}
        >
          <div aria-hidden="true" data-testid="plan-compare-band-tint" className="pointer-events-none absolute inset-0 bg-[var(--v2-primary)]/10" />
          <div className="relative flex items-start gap-3">
            <span
              aria-hidden="true"
              data-testid="plan-compare-band-icon"
              className="inline-flex w-9 h-9 shrink-0 items-center justify-center rounded-full bg-[var(--v2-primary)] text-white"
            >
              <BandIcon data-testid={view?.variant === 'locked_feature' ? 'plan-compare-lock-icon' : undefined} className="w-5 h-5" />
            </span>
            <div ref={titleRef} tabIndex={-1} data-testid="plan-compare-title" className="min-w-0 outline-none">
              {/* Typography on an inner span: `cn` concatenates, so a class on the
                  title itself would race dialog.tsx's own colour and size. */}
              <DialogTitle>
                <span className="block text-xl sm:text-2xl font-semibold leading-tight text-[var(--v2-text-primary)]">{headline}</span>
              </DialogTitle>
              <DialogDescription>
                {/* §8.3: hidden on a phone during a flow, but still the dialog's description. */}
                <span className={`block mt-1.5 text-sm text-[var(--v2-text-primary)]${openFlow !== null ? ' max-sm:sr-only' : ''}`}>{subheading}</span>
              </DialogDescription>
            </div>
          </div>
        </div>

        {/* No top padding on the scroll container (QA): the sticky plan header sticks at
            the scrollport top, so a padding gap there let rows show through above it.
            The top spacing is the status strip's own margin, which scrolls away. */}
        <div className="flex-1 overflow-y-auto bg-[var(--v2-surface)] px-3 pb-3 sm:px-6 sm:pb-6">
          {tableReady && strip === 'status' && (
            <p
              data-testid="plan-compare-status"
              className="mt-3 mb-4 sm:mt-6 sm:mb-5 px-3 py-2 text-sm text-[var(--v2-text-secondary)] border border-[var(--v2-border)] rounded-[var(--v2-radius-card)]"
            >
              {statusBefore}
              {/* F-2: the primary text colour, which every theme sets, light and dark. */}
              <span className="font-semibold text-[var(--v2-text-primary)]">{plan.name ?? ''}</span>
              {statusAfter}
              {statusPrice && <> · {statusPrice}</>}
              {statusEnds && <> · {statusEnds}</>}
            </p>
          )}

          {tableReady && strip === 'your_plan' && (
            // UM-D3 R-5 / R-6: the current plan is marked for every account, trial and
            // Founding Partner included; the drawer's B3 / B4 and B8 live here too.
            <div
              role="group"
              aria-label={t('upgrade_modal.your_plan')}
              data-testid="plan-compare-status"
              className="mt-3 mb-4 sm:mt-6 sm:mb-5 px-3 py-2 space-y-1 text-sm text-[var(--v2-text-secondary)] border border-[var(--v2-border)] rounded-[var(--v2-radius-card)]"
            >
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {/* The column badge's look (C-22), so the two marks read as one. */}
                <span data-testid="plan-compare-status-badge" className={OWN_BADGE}>
                  <Check aria-hidden="true" className="w-3 h-3" />
                  {t('upgrade_modal.your_plan')}
                </span>
                {/* SA Low (360 px): each "·" ends the item before it, joined by a no-break
                    space, so a wrapped line never starts with a separator. */}
                <span>
                  <span data-testid="plan-compare-status-name" className="font-semibold text-[var(--v2-text-primary)]">
                    {plan.name ?? ''}
                  </span>
                  {(statusPrice || statusEnds) && STRIP_SEPARATOR}
                </span>
                {statusPrice && (
                  <span>
                    {statusPrice}
                    {statusEnds && STRIP_SEPARATOR}
                  </span>
                )}
                {statusEnds && <span>{statusEnds}</span>}
              </p>
              {/* B3 / B4: payment-critical, so shown in a flow too (R-12). */}
              <PlanBillingNotices plan={plan} t={t} />
              {/* P-7a.1: Cancel / Reactivate, as in the drawer; hidden while a flow is open. */}
              {openFlow === null && <PlanManage plan={plan} onChanged={onPlanManaged} />}
              {/* B8, collapsed by default; hidden while a flow is open (R-12). */}
              {openFlow === null && (
                <details data-testid="plan-compare-includes" className="pt-1">
                  <summary className="cursor-pointer text-sm font-medium text-[var(--v2-text-primary)] underline underline-offset-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--v2-primary)]">
                    {t('plan.includes')}
                  </summary>
                  <div className="mt-2">
                    <PlanIncludedList plan={plan} t={t} noteTestIdPrefix="plan-compare-category-note-" />
                  </div>
                </details>
              )}
            </div>
          )}

          {/* The one element the checkout / upgrade flows replace (C-25). */}
          <div data-testid="plan-compare-table-area">
            {read.readState === 'loading' ? (
              // UM-2: the standalone window's own read; never a blank modal.
              <div role="status" aria-busy="true" data-testid="plan-compare-loading" className="mt-6 flex items-center gap-2 text-sm text-[var(--v2-text-secondary)]">
                <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" />
                <span>{t('plan.loading')}</span>
              </div>
            ) : !tableReady ? (
              <p role="alert" data-testid="plan-compare-problem" className="mt-6 text-sm text-[var(--v2-text-secondary)]">
                {(plan !== null && plan.status !== 'ok' ? sentence(plan.problem) : null) ?? t('plan.problem.unavailable')}
              </p>
            ) : statusBody ? (
              // UM-2 `stay`: the flow's own lines (B5 / B6), the one rendering shared with the drawer.
              <div ref={statusRef} tabIndex={-1} data-testid="plan-compare-flow-status" className="mx-auto w-full sm:w-[36rem] space-y-3 outline-none">
                <PlanFlowStatus flow={flowStatus} planName={plan.name} />
              </div>
            ) : openFlow === null || flowColumn === null ? (
              <>
                {/* UM-2 N-1 (SA comment 2): above the table, so it is seen without scrolling. */}
                {lockedNotOffered && (
                  <p data-testid="plan-compare-locked-not-offered" className="mt-3 mb-3 text-sm text-[var(--v2-text-secondary)]">
                    {fill(t('upgrade_modal.locked.not_offered'), { plan: lockedNotOffered.name })}
                  </p>
                )}
                <ComparisonTable columns={view.columns} ownColumn={view.ownColumn} sections={view.sections} action={actionFor} />
              </>
            ) : (
              <section
                data-testid="plan-compare-flow"
                aria-labelledby={flowHeadingId}
                aria-busy={busy || undefined}
                className="mx-auto w-full sm:w-[36rem] space-y-4"
              >
                {canGoBack && (
                  <button
                    type="button"
                    data-testid="plan-compare-back"
                    onClick={backToPlans}
                    // UM-3 A-5: --v2-primary is 4.47:1 light and about 3.2:1 dark; the link takes the
                    // primary text colour and reads as a link by its underline and chevron.
                    className="inline-flex items-center gap-1 text-sm font-medium text-[var(--v2-text-primary)] underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--v2-primary)] rounded"
                  >
                    <ChevronLeft aria-hidden="true" className={`w-4 h-4 ${isRTL ? 'scale-x-[-1]' : ''}`} />
                    {t('upgrade_modal.back_to_plans')}
                  </button>
                )}
                <h3 id={flowHeadingId} ref={flowHeadingRef} tabIndex={-1} className="outline-none" data-testid="plan-compare-flow-heading">
                  <span className="block text-lg font-semibold text-[var(--v2-text-primary)]">{flowColumn.name}</span>
                  <span className="block text-sm text-[var(--v2-text-secondary)]">
                    {fill(t('plan.choose.price_ex_tax'), { amount: `$${flowColumn.monthlyPriceUsd}` })}
                  </span>
                </h3>
                {openFlow.kind === 'checkout' ? (
                  <PlanPurchase
                    plans={plan.plans ?? []}
                    tiers={plan.purchase?.offer.kind === 'choose' ? plan.purchase.offer.tiers : []}
                    endsFreeAccess={plan.purchase?.endsFreeAccessOnPurchase ?? null}
                    currentTierId={plan.kind === 'tier' ? plan.planId : null}
                    startTier={openFlow.planId}
                    onFrameOpenChange={setFrameOpen}
                    onComplete={(sessionId) => {
                      planFlow.onCheckoutComplete(sessionId);
                      // UM-D3 R-7: the Settings pop-up stays and shows "Payment processing".
                      if (afterCheckout === 'stay') {
                        returnFocus.current = null;
                        resetFlow();
                      } else handOff();
                    }}
                  />
                ) : (
                  <PlanUpgrade
                    plans={plan.plans ?? []}
                    tiers={upgradeTiers}
                    currentPlan={{ planId: plan.planId, name: plan.name, isTier: plan.kind === 'tier' }}
                    startTier={openFlow.planId}
                    onLockChange={setLock}
                    onCancel={backToPlans}
                    onCheckAgain={planFlow.onUpgradeCheckAgain}
                    onUpgrading={(tier) => {
                      planFlow.onUpgrading(tier);
                      if (afterUpgrade === 'stay') stayAfterUpgrade();
                      else handOff();
                    }}
                  />
                )}
              </section>
            )}
          </div>
        </div>

        <div
          data-testid="plan-compare-footer"
          className="flex-shrink-0 border-t border-[var(--v2-border)] bg-[var(--v2-surface)] px-4 py-3 sm:px-6 sm:py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0 space-y-1 text-xs text-[var(--v2-text-secondary)]">
            <p>{t('upgrade_modal.footer_prices')}</p>
            {/* In a flow the island says these itself, beside its own button. */}
            {openFlow === null && !statusBody && freeAccessKey && <p data-testid="plan-compare-ends-free-access">{t(freeAccessKey)}</p>}
            {openFlow === null && !statusBody && ownPlanColumn && (
              <p data-testid="plan-compare-own-plan-note">
                {fill(t(ownPlanColumn.ownPlanNote === 'upgrade' ? 'plan.upgrade.own_plan_note' : 'plan.choose.own_plan_note'), {
                  plan: ownPlanColumn.name,
                })}
              </p>
            )}
            {/* UM-3 §8.2 (D-4, D-6): B7 says nothing is charged; under an open card form the island says otherwise,
                and under "Payment processing" / "Upgrading…" it is no longer true (SA code review). */}
            {openFlow === null && !statusBody && whenThisChanges &&<p data-testid="plan-compare-when-this-changes">{whenThisChanges}</p>}
            {openFlow === null && !statusBody && checkoutsWithoutKey && (
              <p role="alert" data-testid="plan-compare-not-configured">
                {t('plan.choose.not_configured')}
              </p>
            )}
          </div>
          {!busy && (
            <DialogClose asChild>
              <button
                type="button"
                className="shrink-0 px-4 py-2 text-sm font-medium text-[var(--v2-text-primary)] bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-[var(--v2-radius-button)] hover:bg-[var(--v2-surface-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--v2-primary)]"
              >
                {t(footerClose === 'close' ? 'upgrade_modal.close' : 'upgrade_modal.back_to_plan')}
              </button>
            </DialogClose>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One semantic table at every width (C-24). Below 640 px the table parts become
 * blocks and each row a grid, one column per plan (W-8: a grid row inside
 * table-display parents gets wrapped in anonymous table boxes), so every element
 * carries its explicit ARIA role — `display` changes drop native table semantics
 * in some browsers (SA (f), R-12). Sticky: the whole `thead` on a phone (a sticky
 * cell cannot leave a grid row), the header cells from `sm` up (W-8, Q-14).
 *
 * LF-2: `ownColumn` (the server's own-plan column for a trial or Founding
 * Partner) is rendered FIRST, marked "Your plan", priced "Free", with no action;
 * its cells are each row's `current`, as the server sent them.
 */
function ComparisonTable({
  columns,
  ownColumn,
  sections,
  action,
}: {
  columns: PlanColumnView[];
  ownColumn: OwnPlanColumnView | null;
  sections: PlanComparisonSection[];
  action: (column: PlanColumnView, where: Where) => JSX.Element;
}) {
  const { t, language, timezone } = useLanguage();
  const captionId = useId();
  // C-27: at most three table columns (two shown plans + the own plan); the tripwire pins it.
  const count = (columns.length + (ownColumn ? 1 : 0) >= 3 ? 3 : 2) as 2 | 3;
  const phoneRow = PHONE_ROW[count];
  const compact = count === 3;
  const badgeClass = (base: string) => (compact ? `${base}${COMPACT_BADGE}` : base);
  // LF-2: about 100 px per button with three columns on a phone; the label may wrap, the padding shrinks.
  // `sm:h-px` on the header cells: a table cell with a definite height lets its tinted inner box use
  // `h-full`, so a marked column's tint reaches the bottom of the header row (no white seam, LF-2).
  const actionWrap = compact ? 'mt-2.5 max-sm:[&_button]:px-1.5 max-sm:[&_button]:text-xs max-sm:[&>span]:px-1.5 max-sm:[&>span]:text-xs' : 'mt-2.5';

  return (
    <table
      role="table"
      aria-labelledby={captionId}
      data-testid="plan-compare-table"
      data-columns={count}
      className="w-full table-fixed border-separate border-spacing-0 text-sm max-sm:block"
    >
      <caption id={captionId} className="sr-only">
        {t('upgrade_modal.plans_label')}
      </caption>
      <thead
        role="rowgroup"
        data-testid="plan-compare-thead"
        className="max-sm:block max-sm:sticky max-sm:top-0 max-sm:z-10 max-sm:bg-[var(--v2-surface)]"
      >
        <tr role="row" className={phoneRow}>
          <td aria-hidden="true" className={`max-sm:hidden ${compact ? 'sm:w-1/3' : 'sm:w-2/5'} sm:sticky sm:top-0 sm:z-10 bg-[var(--v2-surface)]`} />
          {ownColumn && (
            <th
              role="columnheader"
              scope="col"
              data-testid={`plan-compare-col-${ownColumn.planId}`}
              data-own-plan="true"
              className="p-0 sm:h-px align-top font-normal sm:sticky sm:top-0 sm:z-10 bg-[var(--v2-surface)]"
            >
              <div className={`h-full px-1.5 pt-3 pb-3 sm:px-3 text-center rounded-t-[var(--v2-radius-card)] border-t-2 border-[var(--v2-border)] ${OWN_TINT}`}>
                <div className="flex h-6 items-center justify-center">
                  <span data-testid="plan-compare-own-badge" className={badgeClass(OWN_BADGE)}>
                    <Check aria-hidden="true" className="w-3 h-3" />
                    {t('upgrade_modal.your_plan')}
                  </span>
                </div>
                <div className="mt-1.5 text-sm sm:text-lg font-semibold text-[var(--v2-text-primary)] break-words">{ownColumn.name}</div>
                <div className="mt-1 text-xl sm:text-2xl font-semibold leading-none text-[var(--v2-text-primary)]">
                  {ownColumn.free ? t('plan.price.free') : ''}
                </div>
                <div className="mt-2.5">
                  {/* Not for sale: no button, the slot keeps the row heights even. */}
                  <span aria-hidden="true" className="block h-9" data-testid="plan-compare-slot-empty" />
                </div>
              </div>
            </th>
          )}
          {columns.map((column) => (
            <th
              key={column.planId}
              role="columnheader"
              scope="col"
              data-testid={`plan-compare-col-${column.planId}`}
              className="p-0 sm:h-px align-top font-normal sm:sticky sm:top-0 sm:z-10 bg-[var(--v2-surface)]"
            >
              <div
                className={`h-full ${compact ? 'px-1.5' : 'px-2'} pt-3 pb-3 sm:px-3 text-center rounded-t-[var(--v2-radius-card)] border-t-2 ${
                  isHighlighted(column) ? 'border-[var(--v2-primary)]' : column.isCurrent ? 'border-[var(--v2-border)]' : 'border-transparent'
                } ${columnTint(column)}`}
              >
                <div className="flex h-6 items-center justify-center">
                  {isHighlighted(column) && (
                    // UM-2 SA Q-2: "Needed for this" on the locked plan, never "Recommended" on a plan the owner may not be able to buy.
                    <span data-testid={`plan-compare-badge-${column.highlightReason}`} className={badgeClass(MARK_BADGE)}>
                      {column.highlightReason === 'locked_feature' ? (
                        <Lock aria-hidden="true" className={`w-3 h-3${compact ? ' max-sm:hidden' : ''}`} />
                      ) : (
                        <Star aria-hidden="true" className={`w-3 h-3${compact ? ' max-sm:hidden' : ''}`} />
                      )}
                      {t(column.highlightReason === 'locked_feature' ? 'upgrade_modal.badge.needed' : 'upgrade_modal.recommended')}
                    </span>
                  )}
                  {column.isCurrent && (
                    <span className={badgeClass(OWN_BADGE)}>
                      <Check aria-hidden="true" className="w-3 h-3" />
                      {t('upgrade_modal.your_plan')}
                    </span>
                  )}
                </div>
                <div className={`mt-1.5 ${compact ? 'text-sm' : 'text-base'} sm:text-lg font-semibold text-[var(--v2-text-primary)] break-words`}>{column.name}</div>
                <div className={`mt-1 ${compact ? 'text-xl' : 'text-2xl'} sm:text-2xl font-semibold leading-none text-[var(--v2-text-primary)]`}>
                  <span dir="ltr">${column.monthlyPriceUsd}</span>
                </div>
                <div className="mt-1 text-xs text-[var(--v2-text-secondary)]">{t('upgrade_modal.price_suffix')}</div>
                <div className={actionWrap}>
                  {action(column, 'header')}
                  {column.unavailableBecause && (
                    <p className="mt-1 text-xs text-[var(--v2-text-secondary)]">
                      {renderSentence(column.unavailableBecause, t, language, timezone)}
                    </p>
                  )}
                </div>
              </div>
            </th>
          ))}
        </tr>
      </thead>

      {sections.map((section) => (
        <tbody key={section.section} role="rowgroup" className="max-sm:block">
          <tr role="row" className={phoneRow}>
            {/* A heading for the rows of this group: scope "rowgroup". */}
            <th
              role="rowheader"
              scope="rowgroup"
              data-testid="plan-compare-section"
              className="max-sm:col-span-full px-2 sm:px-3 pt-5 pb-2 text-start text-xs font-semibold uppercase tracking-wide text-[var(--v2-text-secondary)]"
            >
              {t(section.labelKey)}
            </th>
            {ownColumn && <td aria-hidden="true" className={`max-sm:hidden ${OWN_TINT}`} />}
            {columns.map((column) => (
              <td key={column.planId} aria-hidden="true" className={`max-sm:hidden ${columnTint(column)}`} />
            ))}
          </tr>
          {section.rows.map((row) => (
            <tr key={row.row} role="row" className={phoneRow}>
              <th
                role="rowheader"
                scope="row"
                className="max-sm:col-span-full px-2 sm:px-3 pt-2.5 pb-1 sm:py-2.5 text-start font-normal text-[var(--v2-text-primary)] break-words sm:border-b sm:border-[var(--v2-border)]"
              >
                {row.label}
              </th>
              {ownColumn && (
                <td
                  role="cell"
                  data-testid="plan-compare-cell"
                  data-own-plan="true"
                  className={`px-1.5 sm:px-2 pt-1 pb-2.5 sm:py-2.5 text-center align-middle break-words border-b border-[var(--v2-border)] ${OWN_TINT}`}
                >
                  {/* The server's own-plan cell; absent only on an older payload. */}
                  {row.current ? <CellContent cell={row.current} planName={ownColumn.name} /> : null}
                </td>
              )}
              {row.cells.map((cell, index) => {
                // Cells are in `planIds` order (UM-0), so position i is column i.
                const column = columns[index];
                return (
                  <td
                    key={cell.planId}
                    role="cell"
                    data-testid="plan-compare-cell"
                    className={`${compact ? 'px-1.5' : 'px-2'} pt-1 pb-2.5 sm:py-2.5 text-center align-middle break-words border-b border-[var(--v2-border)] ${column ? columnTint(column) : ''}`}
                  >
                    <CellContent cell={cell} planName={column?.name ?? ''} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      ))}

      <tfoot role="rowgroup" className="max-sm:block">
        <tr role="row" className={phoneRow}>
          <td aria-hidden="true" className="max-sm:hidden" />
          {ownColumn && (
            <td role="cell" className="p-0 align-top">
              <div className={`px-2 pt-3 pb-3 text-center rounded-b-[var(--v2-radius-card)] ${OWN_TINT}`}>
                <span aria-hidden="true" className="block h-9" data-testid="plan-compare-slot-empty" />
              </div>
            </td>
          )}
          {columns.map((column) => (
            <td key={column.planId} role="cell" className="p-0 align-top">
              <div className={`${compact ? 'px-1.5 max-sm:[&_button]:px-1.5 max-sm:[&_button]:text-xs max-sm:[&>span]:px-1.5 max-sm:[&>span]:text-xs' : 'px-2'} pt-3 pb-3 text-center rounded-b-[var(--v2-radius-card)] ${columnTint(column)}`}>
                {action(column, 'footer')}
              </div>
            </td>
          ))}
        </tr>
      </tfoot>
    </table>
  );
}

/**
 * The recommended column carries the one primary button. LF-1: the Business OS
 * primary button as the rest of the app draws it (`bg-[var(--v2-primary)]
 * text-white`), so it follows the admin's theme like every other one.
 */
const PRIMARY_ACTION =
  'inline-block w-full max-w-[12rem] px-3 py-2 text-sm font-semibold text-white bg-[var(--v2-primary)] hover:opacity-90 rounded-[var(--v2-radius-button)] shadow-[var(--v2-shadow-button)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--v2-primary)]';
const SECONDARY_ACTION =
  'inline-block w-full max-w-[12rem] px-3 py-2 text-sm font-medium text-[var(--v2-text-primary)] bg-[var(--v2-surface)] border border-[var(--v2-primary)] rounded-[var(--v2-radius-button)] hover:bg-[var(--v2-surface-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--v2-primary)]';

/**
 * Under the price and in the footer row (C-22, UM-1b §4): the server's action
 * for this plan, or nothing. "Current plan" is a label styled like a quiet
 * button, never a `<button>`, no role, no tabIndex, no aria-disabled (no dead
 * control). A button appears only when the flow may start now (SA Q-4) and, for
 * a checkout, only with a usable publishable key (SA W-3, M-2; the footer then
 * says "Payments are not set up", once).
 */
function ActionSlot({
  column,
  where,
  flow,
  onStart,
  register,
}: {
  column: PlanColumnView;
  where: Where;
  flow: UpgradeModalFlow;
  onStart: (column: PlanColumnView, where: Where) => void;
  register: (key: string, element: HTMLButtonElement | null) => void;
}) {
  const { t } = useLanguage();

  if (column.action === 'current_label') {
    return (
      <span
        data-testid="plan-compare-current-label"
        className="inline-block w-full max-w-[12rem] px-3 py-2 text-sm font-medium text-[var(--v2-text-secondary)] bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-[var(--v2-radius-button)]"
      >
        {t('upgrade_modal.current_plan')}
      </span>
    );
  }

  const isCheckout = column.action === 'choose' || column.action === 'pay_for';
  if (column.action === 'upgrade' || isCheckout) {
    // M-2 / SA W-3: no usable key, no checkout button (the footer says why, once).
    const allowed = isCheckout ? flow.checkoutAllowed && flow.paymentsConfigured : flow.upgradeAllowed;
    if (allowed) {
      const key = column.action === 'upgrade' ? 'plan.upgrade.button' : column.action === 'pay_for' ? 'plan.choose.button_own' : 'plan.choose.button';
      return (
        <button
          type="button"
          ref={(element) => register(actionKey(column.planId, where), element)}
          data-testid={actionTestId(column.planId, where)}
          className={isHighlighted(column) ? PRIMARY_ACTION : SECONDARY_ACTION}
          onClick={() => onStart(column, where)}
        >
          {fill(t(key), { plan: column.name })}
        </button>
      );
    }
  }

  if (column.comingSoon) {
    return (
      <span className="inline-block px-2 py-1 text-xs text-[var(--v2-text-primary)] bg-[var(--v2-bg)] rounded">
        {t('plan.next.coming_soon')}
      </span>
    );
  }
  // Keeps the header and footer rows the same height whether or not a slot is filled.
  return <span aria-hidden="true" className="block h-9" data-testid="plan-compare-slot-empty" />;
}

/** ✓ / ✕ / value, exactly as the server sent it, with the plan named for a screen reader (C-23). */
function CellContent({ cell, planName }: { cell: PlanComparisonCell; planName: string }) {
  const { t } = useLanguage();
  const state = cell.value !== null ? cell.value : t(cell.included ? 'upgrade_modal.included' : 'upgrade_modal.not_included');

  return (
    <>
      {cell.value !== null ? (
        <span
          aria-hidden="true"
          data-highlight={cell.highlight ? 'true' : undefined}
          // F-2: the server's highlight is carried by weight, which reads in both themes.
          className={cell.highlight ? 'font-semibold text-[var(--v2-text-primary)]' : 'font-normal text-[var(--v2-text-secondary)]'}
        >
          {cell.value}
        </span>
      ) : cell.included ? (
        // ✓ and ✕ differ in shape, not only colour (WCAG 1.4.1).
        <span
          aria-hidden="true"
          data-mark="included"
          className="inline-flex w-6 h-6 items-center justify-center rounded-full bg-[var(--v2-success)]/15 text-[var(--v2-success-icon)]"
        >
          <Check className="w-3.5 h-3.5" strokeWidth={3} />
        </span>
      ) : (
        <span
          aria-hidden="true"
          data-mark="not_included"
          className="inline-flex w-6 h-6 items-center justify-center rounded-full bg-[var(--v2-border)] text-[var(--v2-text-secondary)]"
        >
          <X className="w-3 h-3" strokeWidth={3} />
        </span>
      )}
      <span className="sr-only">{fill(t('upgrade_modal.cell_label'), { plan: planName, state })}</span>
    </>
  );
}
