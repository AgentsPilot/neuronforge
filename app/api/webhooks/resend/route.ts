/**
 * What happened to the mail after we handed it over.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `email_sends` has carried `delivered_at`, `opened_at`, `clicked_at`,
 * `open_count` and `click_count` since it was created, and every one of them
 * was null on all 63 rows — because nothing ever told the platform. Sixty
 * emails sent, zero known to have been read.
 *
 * That made the most useful thing we could say about an owner's automations
 * unanswerable: "the chase you switched on is going out and nobody is opening
 * it" is worth more than any detector in the catalogue, and it needs exactly
 * this.
 *
 * Two halves had to be built. The transport now keeps Resend's message id
 * (it was discarding the whole response body), and this route matches events
 * back to it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE SIGNATURE CHECK IS NOT OPTIONAL
 *
 * This is a public URL that writes to a table. Without verification anyone who
 * finds it can mark any message opened, and the engagement figures an owner
 * would act on become whatever a stranger last posted.
 *
 * Resend signs with Svix headers. `RESEND_WEBHOOK_SECRET` missing in production
 * means the request cannot be authenticated, so it is refused — the same
 * fail-closed rule the four insight crons were moved to, for the same reason.
 *
 * ALWAYS 200 FOR AN EVENT WE CANNOT PLACE
 *
 * Events arrive for mail this platform did not record: sends from before ids
 * were captured, or from another system on the same Resend account. A 404
 * would make the provider retry forever something that will never match.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { createLogger } from '@/lib/logger';
import { emailSendRepository } from '@/lib/repositories/EmailAutomationRepository';

export const runtime = 'nodejs';

const logger = createLogger({ module: 'ResendWebhook' });

/**
 * Reject anything older than this, even correctly signed.
 *
 * A valid request captured once can otherwise be replayed indefinitely. Five
 * minutes is Svix's own tolerance.
 */
const MAX_AGE_SECONDS = 300;

/**
 * Resend event types this platform acts on. Anything else is acknowledged.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DELIBERATELY NOT SUBSCRIBED, so nobody has to re-derive this:
 *
 *   `email.opened` / `email.clicked` — handled below, but never sent to us.
 *     Both require open/click tracking, which needs a CNAME for a tracking
 *     subdomain, a 1x1 pixel in every email and every link rewritten to
 *     redirect through Resend. That was weighed and declined for mail sent on
 *     behalf of small businesses to their own clients. The cases stay because
 *     they are correct, and because re-enabling tracking should be a dashboard
 *     change rather than a code change.
 *
 *   `email.sent` — the row is written `'sent'` at send time, so the event is
 *     pure duplication.
 *
 *   `email.suppressed` — fires when Resend DECLINES to send, because the
 *     address is already on the account suppression list. That is a consequence
 *     of a bounce or complaint already recorded here, and mapping it to
 *     `failed` would conflate "we tried and it broke" with "we did not try".
 *     The useful response is a CRM-level flag on the address, not a per-send
 *     status.
 *
 *   `email.received`, `email.scheduled`, `domain.*`, `contact.*`,
 *   `suppression.*` — not about the delivery of mail this platform sent.
 *
 * An accidentally-ticked box is harmless: an unhandled type is acknowledged 200.
 * ─────────────────────────────────────────────────────────────────────────────
 */
type ResendEventType =
  | 'email.delivered'
  | 'email.opened'
  | 'email.clicked'
  | 'email.bounced'
  | 'email.complained'
  | 'email.failed'
  | 'email.delivery_delayed';

interface ResendEvent {
  type?: string;
  created_at?: string;
  data?: { email_id?: string };
}

/**
 * Verify the Svix signature Resend sends.
 *
 * The signed payload is `id.timestamp.body`, and the secret is base64 after a
 * `whsec_` prefix. `v1,` prefixes each signature and several may be present
 * during a secret rotation — any one matching is enough.
 */
function verify(request: NextRequest, rawBody: string, secret: string): boolean {
  const id = request.headers.get('svix-id');
  const timestamp = request.headers.get('svix-timestamp');
  const signatures = request.headers.get('svix-signature');

  if (!id || !timestamp || !signatures) return false;

  const sent = Number(timestamp);
  if (!Number.isFinite(sent) || Math.abs(Date.now() / 1000 - sent) > MAX_AGE_SECONDS) {
    logger.warn({ timestamp }, 'Webhook rejected: timestamp outside the replay window');
    return false;
  }

  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest('base64');

  return signatures.split(' ').some(candidate => {
    const value = candidate.startsWith('v1,') ? candidate.slice(3) : candidate;
    const a = Buffer.from(value);
    const b = Buffer.from(expected);
    // Length must match before comparing, and the comparison must not leak
    // where it diverged.
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

/** One event, as the repository wants it. */
function toDeliveryEvent(type: ResendEventType, at: string) {
  switch (type) {
    case 'email.delivered':
      return { deliveredAt: at };
    case 'email.opened':
      return { openedAt: at };
    case 'email.clicked':
      /*
       * A click implies an open, and providers do not always send both. Without
       * this a client who clicked straight through would read as never having
       * opened it, which is the opposite of the truth.
       */
      return { clickedAt: at, openedAt: at };
    case 'email.bounced':
      return { status: 'bounced' as const, errorMessage: 'Bounced at the provider' };
    case 'email.complained':
      return { status: 'complained' as const, errorMessage: 'Marked as spam by the recipient' };
    /*
     * Accepted by Resend, then failed on the way out.
     *
     * The row already reads `'sent'` with a `provider_message_id` — the send
     * was accepted, which is why this matches at all — and without this case it
     * would read `'sent'` for ever. A send that never happened, recorded as one
     * that did, is the worst of the available outcomes.
     */
    case 'email.failed':
      return { status: 'failed' as const, errorMessage: 'The provider could not send it' };
    case 'email.delivery_delayed':
      // Not terminal and not yet a failure. Recorded as nothing on purpose.
      return null;
    default:
      return null;
  }
}

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  const secret = process.env.RESEND_WEBHOOK_SECRET;

  if (!secret) {
    // Fail closed. See the header: this endpoint writes.
    requestLogger.error('RESEND_WEBHOOK_SECRET not configured — refusing the webhook');
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  // Read raw: the signature is over the exact bytes, so nothing may reserialise.
  const rawBody = await request.text();

  if (!verify(request, rawBody, secret)) {
    requestLogger.warn('Webhook signature did not verify');
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(rawBody) as ResendEvent;
  } catch {
    // Signed but unparseable. Retrying will not help, so do not ask for one.
    requestLogger.warn('Webhook body was not JSON');
    return NextResponse.json({ success: true, ignored: 'unparseable' });
  }

  const messageId = event.data?.email_id;
  const type = event.type as ResendEventType | undefined;

  if (!messageId || !type) {
    return NextResponse.json({ success: true, ignored: 'no message id or type' });
  }

  const delivery = toDeliveryEvent(type, event.created_at ?? new Date().toISOString());

  if (!delivery) {
    return NextResponse.json({ success: true, ignored: type });
  }

  const { error, outcome } = await emailSendRepository.recordDeliveryEvent(messageId, delivery);

  if (error) {
    /*
     * A write failure IS worth a retry — unlike an unmatched id — so this is
     * the one case that answers 500.
     */
    requestLogger.error({ err: error, messageId, type }, 'Could not record the delivery event');
    return NextResponse.json({ success: false, error: 'Failed to record' }, { status: 500 });
  }

  /*
   * Say which of the three happened.
   *
   * All of them answer 200, because no retry can help any of them. But this
   * used to log "Email delivery event recorded" for every one — including a
   * message id that matched no row at all, which is a claim that a write
   * occurred when none did. A misconfiguration that made every id miss would
   * have looked, from the logs and from Resend's delivery panel, exactly like
   * a system working perfectly.
   */
  if (outcome === 'unmatched') {
    requestLogger.info({ messageId, type }, 'No email_sends row carries this message id');
    return NextResponse.json({ success: true, ignored: 'unknown message id' });
  }

  if (outcome === 'duplicate') {
    requestLogger.debug({ messageId, type }, 'Delivery event added nothing new');
    return NextResponse.json({ success: true, ignored: 'already recorded' });
  }

  requestLogger.info({ messageId, type }, 'Email delivery event recorded');
  return NextResponse.json({ success: true });
}
