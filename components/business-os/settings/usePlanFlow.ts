'use client';

/**
 * The checkout / upgrade flow of the "Your plan" section, in one hook.
 *
 * Moved verbatim out of `PlanSection.tsx` (upgrade modal UM-1a, C-2): the
 * state, the success / processing predicates, the island callbacks and the
 * bounded re-read now live here and only here, so the drawer today and the
 * plan comparison modal in UM-1b read one flow instance. `PlanSection` keeps
 * the plan state and its first read (pinned there by `planPrefetch.guard`
 * P-G8) and passes them in. The rules themselves are documented on
 * `PlanSection.tsx` (BUYING, UPGRADING).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { PROCESSING_REFRESH_INTERVAL_MS, PROCESSING_REFRESH_LIMIT } from '@/components/business-os/billing/checkoutProcessing';
// Display only, and a pure file with no import (P-5a.2): a well-formed
// checkout session id on the URL means "show Payment processing".
import { isCheckoutReturnMarker } from '@/lib/business-os/billing/checkoutReturnMarker';
import { createLogger } from '@/lib/logger';

import { readMyPlan } from './planDrawerReads';
import type { PlanPayload } from './planPayloadTypes';

// The section's module name, kept so the log lines are unchanged by the move.
const logger = createLogger({ module: 'BusinessOsPlanSection' });

/**
 * The section's judgement of a `my-plan` body: the plan when the server
 * answered with one, otherwise `null`. A narrow check that never throws.
 */
export function planFrom(body: unknown): PlanPayload | null {
  if (typeof body !== 'object' || body === null) return null;
  const { success, data } = body as { success?: unknown; data?: unknown };
  return success && data ? (data as PlanPayload) : null;
}

/**
 * The plan re-read (after checkout or an upgrade, and "Check again"). Resolves
 * `null` when the server did not answer with a plan, and throws the read's own
 * error when it failed, as it always has, so each caller logs its own `warn`.
 * The request itself lives in `planDrawerReads` (one copy, SA Q-8).
 */
async function fetchPlan(): Promise<PlanPayload | null> {
  const read = await readMyPlan();
  if (read.kind === 'threw') throw read.err;
  return planFrom(read.body);
}

export interface PlanFlow {
  marker: string | null;
  succeeded: boolean;
  checkoutProcessing: boolean;
  upgradeSucceeded: boolean;
  upgradeWatching: boolean;
  upgradeProcessing: boolean;
  processing: boolean;
  exhausted: boolean;
  onCheckoutComplete: (sessionId: string) => void;
  onUpgrading: (tier: string) => void;
  onUpgradeCheckAgain: (tier: string) => Promise<void>;
}

export function usePlanFlow({
  plan,
  setPlan,
  setFailed,
  loading,
  checkoutMarker,
}: {
  plan: PlanPayload | null;
  /** A React state setter (stable identity), so the callbacks' empty dependency lists stay correct. */
  setPlan: (plan: PlanPayload) => void;
  setFailed: (failed: boolean) => void;
  loading: boolean;
  checkoutMarker: string | null;
}): PlanFlow {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setPlan / setFailed are React state setters (stable), as before the move
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setPlan / setFailed are React state setters (stable), as before the move
  }, [processing, exhausted, loading, refreshes]);

  return {
    marker,
    succeeded,
    checkoutProcessing,
    upgradeSucceeded,
    upgradeWatching,
    upgradeProcessing,
    processing,
    exhausted,
    onCheckoutComplete,
    onUpgrading,
    onUpgradeCheckAgain,
  };
}
