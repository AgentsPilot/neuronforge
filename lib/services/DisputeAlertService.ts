/**
 * Telling the owner a chargeback has been opened.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT A LEAD ALERT
 *
 * `notifyOwnerOfLead` is the right shape but the wrong switch: it answers to
 * `lead_alert_email_enabled`, which an owner turns off to stop hearing about
 * enquiries. A chargeback is not news about a lead — the bank has already taken
 * the money, and Stripe's evidence window is measured in days, so a dispute
 * nobody sees is a dispute lost by default. It is not something a marketing
 * preference should be able to silence.
 *
 * Deliberately plain: no branding lookup, no template engine, no localisation
 * beyond the owner's own language. This exists to be delivered, not admired.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/services/DisputeAlertService
 */

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { sendEmail } from '@/lib/notifications/emailTransport';

const logger = createLogger({ service: 'DisputeAlertService' });

export interface DisputeAlertInput {
  ownerId: string;
  contactId?: string | null;
  /** Major units, as recorded on the transaction. */
  amount: number;
  currency: string;
  /** Stripe's own word for it: `fraudulent`, `product_not_received`, … */
  reason: string;
  /** Unix seconds, from Stripe. The deadline that makes this urgent. */
  evidenceDueBy: number | null;
}

/** Stripe's reasons, in words an owner can act on. */
const REASON_TEXT: Record<string, string> = {
  fraudulent: 'the cardholder says they did not authorise it',
  product_not_received: 'the client says they did not receive what they paid for',
  product_unacceptable: 'the client says what they received was not as described',
  duplicate: 'the client says they were charged twice',
  subscription_canceled: 'the client says the plan should have been stopped',
  credit_not_processed: 'the client says a refund you agreed was never paid',
  unrecognized: 'the client does not recognise the charge',
  general: 'no reason was given',
};

function money(amount: number, currency: string): string {
  const code = (currency || '').toUpperCase();
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: code }).format(amount);
  } catch {
    return `${amount.toLocaleString()}${code ? ` ${code}` : ''}`;
  }
}

export async function notifyOwnerOfDispute(
  input: DisputeAlertInput
): Promise<{ sent: boolean; reason?: string }> {
  const log = logger.child({ ownerId: input.ownerId });

  try {
    const { data: owner } = await supabaseServer.auth.admin.getUserById(input.ownerId);
    const ownerEmail = owner?.user?.email;

    if (!ownerEmail) {
      log.warn({}, 'No owner email for a dispute alert');
      return { sent: false, reason: 'no_owner_email' };
    }

    const amount = money(input.amount, input.currency);
    const why = REASON_TEXT[input.reason] || input.reason || 'no reason was given';
    const deadline = input.evidenceDueBy
      ? new Date(input.evidenceDueBy * 1000).toLocaleDateString('en', {
          day: 'numeric',
          month: 'long',
        })
      : null;

    /*
     * The deadline is the whole message. An owner who reads this and does
     * nothing loses the money by default, and that has to be said plainly
     * rather than implied by the word "dispute".
     */
    const html = `
      <p>A card payment of <strong>${amount}</strong> has been disputed by the client's bank.</p>
      <p>The money has already been taken back from your account. The reason given: ${why}.</p>
      ${
        deadline
          ? `<p><strong>You have until ${deadline} to respond in Stripe.</strong> If nobody responds, the dispute is lost automatically and the money stays with the client.</p>`
          : `<p><strong>Respond in Stripe as soon as you can.</strong> A dispute nobody responds to is lost automatically.</p>`
      }
      <p>The payment has been marked as disputed here, so it no longer counts towards your income.</p>
    `;

    const result = await sendEmail({
      kind: 'transactional',
      to: [ownerEmail],
      subject: `Action needed: ${amount} charged back`,
      html,
      ownerUserId: input.ownerId,
    });

    if (!result.sent) {
      log.warn({ error: result.error }, 'Dispute alert failed to send');
      return { sent: false, reason: 'send_failed' };
    }

    log.info({ provider: result.provider }, 'Owner alerted to a dispute');
    return { sent: true };
  } catch (err) {
    log.error({ err }, 'Dispute alert threw');
    return { sent: false, reason: 'threw' };
  }
}
