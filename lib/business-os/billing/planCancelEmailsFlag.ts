/**
 * The server switch for the plan-cancel emails (account deletion lifecycle
 * D4a / SX-3; workplan docs/workplans/BUSINESS_OS_D4_PLAN_CANCEL_EMAILS_WORKPLAN.md
 * §3.1; SA S-15).
 *
 * WHY IT EXISTS. The "Plan cancelled", "Your plan has ended" and "Plan kept"
 * emails go out from the platform sender (`RESEND_FROM_EMAIL`). Until the user
 * confirms that the sending domain is verified in Resend and the variable is
 * set in production, the code merges with this switch OFF and is turned on
 * later as an ops step.
 *
 * **Default: off** (unset, blank or anything unrecognised). While off the
 * cancel and reactivate routes behave exactly as before: nothing is looked up,
 * composed, sent or audited for the email.
 *
 * On is not enough by itself: the composer also fails closed when
 * `platformSenderAddress()` is unset. That case is audited
 * (`sender_not_configured`) and logged `error` with `alert: true`, because an
 * operator turned the switch on without a sender.
 *
 * Server-only: no `NEXT_PUBLIC_` prefix, so it is never compiled into a client
 * bundle. Reads the variable on every call, so a test or a redeploy changes it
 * without a module reload. Imports only the zero-import flag parser.
 *
 * @module lib/business-os/billing/planCancelEmailsFlag
 */

import { parseBooleanFlag } from '@/lib/utils/parseBooleanFlag';

/** True when the plan-cancel emails may be sent. Off by default. */
export function isPlanCancelEmailsEnabled(): boolean {
  return parseBooleanFlag(process.env.BUSINESS_OS_PLAN_CANCEL_EMAILS_ENABLED, false);
}
