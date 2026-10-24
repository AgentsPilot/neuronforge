'use client';

/**
 * Which "Your plan" surface opens: the comparison pop-up or the drawer (upgrade
 * modal UM-D3; SA R-1, R-3, R-4, R-8; conditions D3-1, D3-3, D3-4, D3-8).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE OPEN STATE, ONE DECISION PER OPEN
 *
 * The page keeps `useLinkOpenedDrawer()` as the single "the plan surface is
 * open" state (link flag, address clean-up, focus return). This hook adds only
 * WHICH surface that open shows, decided once, when it opens:
 *
 *   - a checkout return marker on the URL: the pop-up, at once, with no warm
 *     read (B-2); it reads for itself, with the marker (R-7);
 *   - otherwise the first read's answer, through `planSurfaceFor` (the pure
 *     rule beside `upgradeModalView`, D3-1): the pop-up when the server offers
 *     something, the drawer otherwise;
 *   - no answer within `PLAN_SURFACE_DECISION_BUDGET_MS`, or a read that threw:
 *     the drawer (R-4). A late answer is dropped; it never swaps surfaces.
 *
 * A `?section=plan` link that arrives while a surface is open keeps it (the
 * decision is not taken again until the surface closes), so a checkout
 * completed inside the pop-up, which writes that link, keeps the pop-up.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE REQUEST PER OPEN (R-8)
 *
 * The page's warm set is taken here, once per open, in a ref-guarded effect
 * (never in render, never in the deep-link effect, never in `loadData`;
 * StrictMode's second run takes nothing). Used only when it was started in the
 * current language (B-3) and there is no marker (B-2); otherwise a cold read is
 * started instead. Whichever read decided is then HANDED ON: to the pop-up's
 * session as its first read, or to `PlanSection` through `takeForDrawer`, which
 * returns it once. `PlanSection` still re-reads an answer that is not an `ok`
 * plan, as it does for any unusable warm read.
 *
 * Imports `upgradeModalView` and `planDrawerReads` only (R-14; C-6: nothing from
 * the entitlements module). Logs the reason only, never a body (SA-CB-4).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useLanguage } from '@/lib/business-os/LanguageContext';
// Display only, and a pure file with no import (P-5a.2).
import { isCheckoutReturnMarker } from '@/lib/business-os/billing/checkoutReturnMarker';
import { createLogger } from '@/lib/logger';

import { startPlanDrawerRead, type PlanDrawerRead, type PlanRead } from './planDrawerReads';
import { planSurfaceFor } from './upgradeModalView';
import { planFrom } from './usePlanFlow';

const logger = createLogger({ module: 'BusinessOsPlanSurface' });

/** How long the row waits for the first read before the drawer opens instead (R-4). */
export const PLAN_SURFACE_DECISION_BUDGET_MS = 2_000;

/** `null`: no surface is open. `pending`: the row's spinner, nothing else rendered. */
export type PlanSurfaceState = 'pending' | 'modal' | 'drawer' | null;

export interface PlanSurfaceDecision {
  surface: PlanSurfaceState;
  /** The read the pop-up's session takes as its first read; `null` reads fresh (a checkout return). */
  modalFirstRead: Promise<PlanRead> | null;
  /** For `PlanSection`'s `takePrefetched`: the decider's read, once. Stable identity. */
  takeForDrawer: () => PlanDrawerRead | null;
}

/** Why the drawer opened, for a `debug` line: never the body, never a plan name (SA-CB-4). */
function drawerReason(answer: PlanRead): string {
  if (answer.kind === 'threw') return 'threw';
  const data = planFrom(answer.body);
  if (data === null) return 'no_plan';
  return data.status === 'ok' ? 'nothing_offered' : `plan_${data.status}`;
}

export function usePlanSurface({
  open,
  checkoutMarker,
  takePrefetched,
}: {
  /** The page's one open state (`planDrawer.open`). */
  open: boolean;
  /** The URL's `checkout` value, unchecked; the marker test is `isCheckoutReturnMarker`. */
  checkoutMarker: string | null;
  /** The page's warm set (`planPrefetch.take`), taken once per open. */
  takePrefetched: () => PlanDrawerRead | null;
}): PlanSurfaceDecision {
  const { language } = useLanguage();
  const [surface, setSurface] = useState<PlanSurfaceState>(null);
  const [modalFirstRead, setModalFirstRead] = useState<Promise<PlanRead> | null>(null);
  /** Which open the pending answer belongs to: a close (or a new open) makes it stale. */
  const openCount = useRef(0);
  const decided = useRef(false);
  const handed = useRef<PlanDrawerRead | null>(null);

  // Inputs read through a ref, so the effect runs on `open` alone.
  const latest = useRef({ checkoutMarker, takePrefetched, language });
  latest.current = { checkoutMarker, takePrefetched, language };

  useEffect(() => {
    if (!open) {
      // Closing either surface clears the decision (R-3).
      openCount.current += 1;
      decided.current = false;
      handed.current = null;
      setSurface(null);
      setModalFirstRead(null);
      return undefined;
    }
    // Once per open (StrictMode's second run decides nothing).
    if (decided.current) return undefined;
    decided.current = true;
    const thisOpen = openCount.current;
    const current = () => openCount.current === thisOpen;

    const { checkoutMarker: marker, takePrefetched: take, language: lang } = latest.current;
    // Always taken, even when it will not be used: a set never outlives the open it was offered to (rule 1).
    const offered = take();
    if (isCheckoutReturnMarker(marker)) {
      setSurface('modal');
      return undefined;
    }
    const set = offered !== null && offered.language === lang ? offered : startPlanDrawerRead(lang);
    setSurface('pending');

    let settled = false;
    const timer = setTimeout(() => {
      if (settled || !current()) return;
      settled = true;
      logger.debug({ reason: 'timeout' }, 'Plan surface: opening the drawer');
      // The read in flight is the drawer's: still one request, and it re-reads an unusable answer itself.
      handed.current = set;
      setSurface('drawer');
    }, PLAN_SURFACE_DECISION_BUDGET_MS);

    void set.plan.then((answer) => {
      // A late answer (after the budget, or after a close) is dropped (R-4).
      if (settled || !current()) return;
      settled = true;
      clearTimeout(timer);
      const plan = answer.kind === 'answered' ? planFrom(answer.body) : null;
      if (planSurfaceFor(plan, false) === 'modal') {
        setModalFirstRead(set.plan);
        setSurface('modal');
        return;
      }
      logger.debug({ reason: drawerReason(answer) }, 'Plan surface: opening the drawer');
      handed.current = set;
      setSurface('drawer');
    });
    // Not cleared on cleanup: StrictMode's re-run would lose the only decision; `current()` drops a stale one.
    return undefined;
  }, [open]);

  // A page that has gone drops a pending answer (its timer then finds the open stale).
  useEffect(
    () => () => {
      openCount.current += 1;
    },
    []
  );

  const takeForDrawer = useCallback((): PlanDrawerRead | null => {
    const set = handed.current;
    handed.current = null;
    return set;
  }, []);

  return { surface, modalFirstRead, takeForDrawer };
}
