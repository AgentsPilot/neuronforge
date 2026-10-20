'use client';

/**
 * The plan comparison window opened from anywhere in Business OS (upgrade modal
 * UM-2, workplan §5.1; UM-SA1, UM-SA5, UM-SA8, UM-SA10).
 *
 * Rendered by `UpgradeModalProvider` through `LazyUpgradeModal` (PERF-1: the
 * third `createLazyDialog`), so its chunk loads after the page paints. The
 * props are the loader's contract (`isOpen`, `onClose`) plus the caller's
 * context, and nothing else.
 *
 * ── ONE SESSION PER OPEN ────────────────────────────────────────────────────
 * Closed, it renders nothing, so the layout's closed instance reads nothing and
 * costs nothing (the `ConfigurationDialog` precedent). Open, it mounts a fresh
 * `UpgradeSession`: ONE `readMyPlan()` started in a ref-guarded mount effect
 * (StrictMode's second run starts nothing; no prefetch, nothing at page load,
 * UM-SA8), its OWN `usePlanFlow` instance (UM-SA1), and the same
 * `UpgradeModal` Settings uses. Closing unmounts the session, so no read, no
 * "Upgrading…" and no flow state carries over to the next open.
 *
 * ── AFTER A PURCHASE ────────────────────────────────────────────────────────
 * An upgrade stays in the window (`afterUpgrade="stay"`): "Upgrading…", then
 * "You're on {plan}" once the bounded re-read says so. A checkout always hands
 * off: `PlanPurchase` closes the window and returns to Settings → Plan with the
 * marker (UM-SA10), where the drawer reads fresh. No URL marker is read here
 * (`checkoutMarker: null`, C-4).
 */

import { useEffect, useRef, useState } from 'react';

import { createLogger } from '@/lib/logger';

import { readMyPlan } from './planDrawerReads';
import type { PlanPayload } from './planPayloadTypes';
import { UpgradeModal, type UpgradeModalRead } from './UpgradeModal';
import type { UpgradeModalContext } from './upgradeModalContext';
import { planFrom, usePlanFlow } from './usePlanFlow';

const logger = createLogger({ module: 'BusinessOsUpgradeModal' });

export interface StandaloneUpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  context: UpgradeModalContext;
}

export function StandaloneUpgradeModal({ isOpen, onClose, context }: StandaloneUpgradeModalProps) {
  if (!isOpen) return null;
  return <UpgradeSession onClose={onClose} context={context} />;
}

function UpgradeSession({ onClose, context }: { onClose: () => void; context: UpgradeModalContext }) {
  const [plan, setPlan] = useState<PlanPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const flow = usePlanFlow({ plan, setPlan, setFailed, loading, checkoutMarker: null });

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
   */
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const answer = await readMyPlan();
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
  }, []);

  // X-3: `ready` only with a plan. A plan is set only from a server answer, so a failure has none to show.
  const read: UpgradeModalRead = loading ? { readState: 'loading' } : plan !== null && !failed ? { readState: 'ready', plan } : { readState: 'failed' };

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
      {...read}
    />
  );
}
