import 'server-only';

/**
 * Production wiring of the plan-ends reminder run (account deletion lifecycle
 * D4b / SX-3 part 2; workplan docs/workplans/BUSINESS_OS_D4_PLAN_CANCEL_EMAILS_WORKPLAN.md
 * §3.4, §3.5 and the D4b addendum R-A, R-B). Used only by the cron route
 * `/api/cron/bos-plan-cancel-reminders`.
 *
 * Service role by design (durable-queue-drain, tenant-isolation-guard): a cron
 * has no user session. The run takes no account id from any input. Its rows
 * come from the claim (`claimCancelReminders`, ⟨unscoped-by-design⟩), its only
 * writes are that row's three reminder columns (`completeCancelReminder`,
 * `releaseCancelReminder`, a compare-and-set on the row, the runner and the
 * row's own `user_id` and `livemode`), and the email goes to that row's own
 * account (`buildPlanCancelReminderEmailDeps`).
 *
 * Stripe is read only (`retrieveBusinessOsSubscription`): this file never
 * names a Stripe write (`oneDontRenewPath.guard`).
 *
 * @module lib/business-os/billing/planCancelReminderPassDeps
 */

import { randomUUID } from 'crypto';

import { businessOsBillingAccountRepository } from '@/lib/repositories/BusinessOsBillingAccountRepository';
import { getStripeService } from '@/lib/stripe/StripeService';

import { sendPlanCancelEmail } from './planCancelEmail';
import { buildPlanCancelReminderEmailDeps, flushPlanCancelReminderAudit } from './planCancelEmailDeps';
import { isPlanCancelEmailsEnabled } from './planCancelEmailsFlag';
import type { PlanCancelReminderDeps, PlanCancelReminderLogger } from './planCancelReminderPass';
import { currentStripeMode, isLiveMode } from './stripeMode';

export function buildPlanCancelReminderDeps(logger: PlanCancelReminderLogger): PlanCancelReminderDeps {
  return {
    isEnabled: isPlanCancelEmailsEnabled,
    keyLivemode: () => {
      try {
        return isLiveMode(currentStripeMode());
      } catch {
        return null;
      }
    },
    newRunnerId: () => randomUUID(),
    claim: (input) => businessOsBillingAccountRepository.claimCancelReminders(input),
    complete: (input) => businessOsBillingAccountRepository.completeCancelReminder(input),
    release: (input) => businessOsBillingAccountRepository.releaseCancelReminder(input),
    stripe: () => {
      let service: ReturnType<typeof getStripeService>;
      try {
        service = getStripeService();
      } catch {
        return null;
      }
      return { retrieveSubscription: (subscriptionId) => service.retrieveBusinessOsSubscription(subscriptionId) };
    },
    // The claimed row's own account, never input (tenant-isolation-guard Step 6).
    sendReminder: (input) => sendPlanCancelEmail(input, buildPlanCancelReminderEmailDeps({ accountId: input.userId, logger })),
    flushAudit: () => flushPlanCancelReminderAudit(logger),
    logger,
    now: () => Date.now(),
  };
}
