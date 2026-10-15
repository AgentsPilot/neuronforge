import 'server-only';

/**
 * The owner's plan payment banner, read for the Business OS layout (plan
 * payments P-6a.2; workplan §5.6; SA C-13). The `readPlanBadge` guarantees,
 * each pinned in `readPaymentNotice.test.ts`:
 *
 *   1. **Off with the price switch.** While `BUSINESS_OS_PLAN_PRICES_ENABLED`
 *      is off (production today) nothing is read at all: no session, no
 *      billing row, no snapshot. Production makes no new query (§16, R-6).
 *   2. **No session → no banner.** The account id is never invented.
 *   3. **The id goes through the account seam** (`resolveAccountId`), and the
 *      billing row is read by THAT account and the server key's mode only,
 *      never by anything from the request (tenant-isolation-guard).
 *   4. **Any failure → no banner**, and a `warn`. The chrome of every page is
 *      the wrong place to surface an error, and a wrong banner is a claim
 *      about somebody's money.
 *
 * What is decided is `planPaymentNotice`'s answer (the one predicate Settings
 * uses too). What leaves the server is only what the banner renders: the
 * kind, the plan's label, the pause date, and, for `action_required` only,
 * Stripe's hosted invoice URL, which reaches only this owner's own page and is
 * never logged (it is a bearer link).
 *
 * Reads the snapshot for display: it refuses nothing and grants nothing
 * (registered as a non-gate importer in `enforcementPoints.test.ts`).
 *
 * @module lib/business-os/billing/readPaymentNotice
 */

import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { resolveAccountId } from '@/lib/business-os/entitlements/account';
import { getEntitlementService } from '@/lib/business-os/entitlements/EntitlementService';
import { getEntitlementMode } from '@/lib/business-os/entitlements/mode';
import { planLabel } from '@/lib/business-os/entitlements/planPresentation';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import {
  businessOsBillingAccountRepository,
  type BusinessOsBillingAccountRepository,
} from '@/lib/repositories/BusinessOsBillingAccountRepository';
import { isPlanPriceRecognitionEnabled } from '@/lib/business-os/billing/planPricesFlag';
import { currentStripeMode, isLiveMode, type StripeMode } from '@/lib/business-os/billing/stripeMode';
import {
  planPaymentNotice,
  type PaymentNoticeLifecycleFacts,
  type PaymentNoticeWire,
} from '@/lib/business-os/billing/planPaymentNotice';

const defaultLogger = createLogger({ module: 'BusinessOsPaymentNoticeRead' });

interface SnapshotPort {
  getSnapshot(accountId: string): Promise<{ resolution: { lifecycle: PaymentNoticeLifecycleFacts } | null }>;
}

export interface ReadPaymentNoticeDeps {
  pricesEnabled?: () => boolean;
  getUser?: () => Promise<{ id: string } | null>;
  billing?: Pick<BusinessOsBillingAccountRepository, 'findByUser'>;
  entitlements?: () => SnapshotPort;
  stripeMode?: () => StripeMode;
  enforcing?: () => boolean;
  label?: (tier: string) => string;
  logger?: { warn: (context: Record<string, unknown>, message: string) => void };
}

/** The banner for the current session, or `null`, which renders nothing. */
export async function readPaymentNotice(deps: ReadPaymentNoticeDeps = {}): Promise<PaymentNoticeWire | null> {
  const log = deps.logger ?? defaultLogger;
  try {
    // 1. Inert while the price switch is off: nothing below runs.
    if (!(deps.pricesEnabled ?? isPlanPriceRecognitionEnabled)()) return null;

    // 2. No session, no banner.
    const user = await (deps.getUser ?? getUser)();
    if (!user) return null;

    // 3. The account seam, the server key's mode, our own record.
    const accountId = resolveAccountId(user.id);
    const livemode = isLiveMode((deps.stripeMode ?? currentStripeMode)());
    const read = await (deps.billing ?? businessOsBillingAccountRepository).findByUser(accountId, livemode);
    if (read.error) throw read.error;
    const row = read.data;
    if (!row) return null;

    const snapshot = await (deps.entitlements ?? getEntitlementService)().getSnapshot(accountId);
    const lifecycle: PaymentNoticeLifecycleFacts = snapshot.resolution
      ? { state: snapshot.resolution.lifecycle.state, graceEndsAt: snapshot.resolution.lifecycle.graceEndsAt }
      : { state: 'unknown', graceEndsAt: null };

    const notice = planPaymentNotice(row, lifecycle, {
      serverLivemode: livemode,
      enforcing: (deps.enforcing ?? (() => getEntitlementMode() === 'enforce'))(),
    });
    if (!notice) return null;

    const label = deps.label ?? ((tier: string) => planLabel(getEntitlementConfig(), tier));
    const planName = notice.tier ? label(notice.tier) : null;
    switch (notice.kind) {
      case 'payment_failed':
        return { kind: 'payment_failed', planLabel: planName, pauseBy: notice.pauseBy };
      case 'paused':
        return { kind: 'paused', planLabel: planName };
      case 'action_required':
        return { kind: 'action_required', planLabel: planName, confirmUrl: notice.confirmUrl };
      case 'ended':
        return { kind: 'ended', planLabel: planName };
      default: {
        const unreachable: never = notice;
        throw new Error(`unknown_notice:${String(unreachable)}`);
      }
    }
  } catch (err) {
    // 4. Never a banner from a failed read. The error carries no URL: the
    // billing read's errors are database errors, and the URL is never thrown.
    log.warn({ err, event: 'bos_billing_payment_notice_unavailable' }, 'Plan payment banner unavailable; rendering the chrome without it');
    return null;
  }
}
