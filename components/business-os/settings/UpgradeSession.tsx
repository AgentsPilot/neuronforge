'use client';

/**
 * One open of the plan comparison window with its own read and its own flow
 * (upgrade modal UM-2 §5.1, UM-SA1 / UM-SA8; UM-D3 SA R-2 / D3-2).
 *
 * Moved verbatim out of `StandaloneUpgradeModal.tsx` (UM-D3) so the Settings
 * pop-up can mount the SAME session component: `StandaloneUpgradeModal` is
 * loaded lazily (PERF-1) and `lazyDialogs.guard` forbids any static import of
 * it, while Settings needs this one statically. One component, one copy of the
 * read and of the flow wiring (C-2).
 *
 * ── ONE SESSION PER OPEN ────────────────────────────────────────────────────
 * Mounted fresh on every open: ONE `readMyPlan()` started in a ref-guarded mount
 * effect (StrictMode's second run starts nothing; no prefetch, nothing at page
 * load, UM-SA8), its OWN `usePlanFlow` instance (UM-SA1), and the same
 * `UpgradeModal` the drawer uses. Unmounting ends it, so no read, no
 * "Upgrading…" and no flow state carries over to the next open.
 *
 * ── THE SETTINGS POP-UP (UM-D3) ─────────────────────────────────────────────
 * Two optional props, whose defaults are UM-2's standalone behaviour exactly:
 *   - `firstRead`: the read the settings page already made to decide that the
 *     pop-up opens (R-8). It replaces this mount's own read, so an open costs
 *     one request, warm or cold. Re-reads (after a purchase, "Check again")
 *     still fetch;
 *   - `checkoutMarker`: the URL's checkout return marker, which only the
 *     Settings page reads (C-4: never the provider). The flow pattern-checks
 *     it and shows "Payment processing" until the server re-read confirms (R-7).
 * And the Settings instance's presentation (`afterCheckout`, `strip`,
 * `returnFocusRef`), passed through to `UpgradeModal` unchanged.
 */

import { useEffect, useRef, useState, type RefObject } from 'react';

import { createLogger } from '@/lib/logger';

import { readMyPlan, type PlanRead } from './planDrawerReads';
import type { PlanPayload } from './planPayloadTypes';
import { UpgradeModal, type UpgradeModalRead } from './UpgradeModal';
import type { UpgradeModalContext } from './upgradeModalContext';
import { planFrom, usePlanFlow } from './usePlanFlow';

const logger = createLogger({ module: 'BusinessOsUpgradeModal' });

export interface UpgradeSessionProps {
  onClose: () => void;
  context: UpgradeModalContext;
  /** UM-D3 R-8: the read the page already made for this open. Default: this mount reads. */
  firstRead?: Promise<PlanRead> | null;
  /** UM-D3 R-7: the URL's checkout return marker (Settings only). Default: none (C-4). */
  checkoutMarker?: string | null;
  /** UM-D3: passed through to `UpgradeModal`. Defaults: UM-2's standalone window. */
  afterCheckout?: 'close' | 'stay';
  strip?: 'status' | 'your_plan';
  returnFocusRef?: RefObject<HTMLElement>;
}

export function UpgradeSession({
  onClose,
  context,
  firstRead = null,
  checkoutMarker = null,
  afterCheckout,
  strip,
  returnFocusRef,
}: UpgradeSessionProps) {
  const [plan, setPlan] = useState<PlanPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const flow = usePlanFlow({ plan, setPlan, setFailed, loading, checkoutMarker });

  // Declared before the read, so it is true again by the time StrictMode's re-run settles.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /*
   * ONE read per open (UM-SA8). Ref-guarded rather than cancelled: StrictMode
   * runs this effect twice on one fiber, and a cancel flag would throw away the
   * only read. The `mounted` ref drops an answer that arrives after a close.
   * UM-D3: a handed-over first read is used instead of a new one (R-8).
   */
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const answer = await (firstRead ?? readMyPlan());
      if (!mounted.current) return;
      if (answer.kind === 'threw') {
        logger.warn({ err: answer.err }, 'Could not load the plan for the upgrade modal');
        setFailed(true);
      } else {
        const data = planFrom(answer.body);
        if (data) setPlan(data);
        else setFailed(true);
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only: one read per open (UM-SA8)
  }, []);

  // X-3: `ready` only with a plan. A plan is set only from a server answer, so a failure has none to show.
  const read: UpgradeModalRead = loading ? { readState: 'loading' } : plan !== null && !failed ? { readState: 'ready', plan } : { readState: 'failed' };

  /** P-7a.1: after a Cancel / Reactivate answer in the strip, one fresh read. A failed read keeps what is shown. */
  const rereadAfterManage = () => {
    void (async () => {
      const answer = await readMyPlan();
      if (!mounted.current) return;
      if (answer.kind !== 'answered') {
        logger.warn({ err: answer.err }, 'Could not re-read the plan after a cancel / reactivate');
        return;
      }
      const data = planFrom(answer.body);
      if (data) setPlan(data);
    })();
  };

  return (
    <UpgradeModal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      flow={flow}
      flowStatus={flow}
      context={context}
      afterUpgrade="stay"
      afterCheckout={afterCheckout}
      strip={strip}
      returnFocusRef={returnFocusRef}
      // UM-3 §5.5 / SA R-11: no drawer behind either window, so the footer reads "Close".
      footerClose="close"
      onPlanManaged={rereadAfterManage}
      {...read}
    />
  );
}
