/**
 * The lead-response queue checks consent before it does the work.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Nothing was ever at risk of going out: `sendEmail` refuses an unconsented
 * marketing send whatever reaches it, and an automated booking invite is
 * marketing (`sendBookingLink` sends `trigger: 'automated'`).
 *
 * What the late refusal cost was honesty and work. The row settled as
 * `send_failed`, detail "not sent: no_consent", logged at error — and by then
 * the queue had resolved the business, its branding and a service, signed a
 * booking token and rendered a template, all to throw it away. Somebody
 * unsubscribing between the enquiry and the two-day chase is ordinary, not a
 * fault, and an error column that fills with ordinary outcomes is one nobody
 * reads.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const gateCheck = jest.fn();
const sendBookingLink = jest.fn();

jest.mock('@/lib/logger', () => {
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: () => log };
  return { createLogger: () => log };
});

jest.mock('@/lib/consent/marketingGate', () => ({
  marketingGate: { check: (...a: unknown[]) => gateCheck(...(a as [])) },
}));

jest.mock('@/lib/services/LeadBookingLinkService', () => ({
  sendBookingLink: (...a: unknown[]) => sendBookingLink(...(a as [])),
}));

import { readFileSync } from 'fs';
import { join } from 'path';

const source = readFileSync(
  join(process.cwd(), 'lib', 'services', 'LeadResponseDispatchService.ts'),
  'utf-8'
);

describe('the consent check', () => {
  it('runs BEFORE the booking link is built', () => {
    /*
     * Order is the whole point. After the send there is no saving: the work is
     * already done and the refusal already recorded as a failure.
     */
    const ask = source.indexOf('marketingGate.check(row.user_id');
    const send = source.indexOf('await sendBookingLink(row.contact_id');

    expect(ask).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(ask);
  });

  it('settles the row with its own reason, not as a failure', () => {
    /* `markSkipped` writes this straight onto the row, so the word chosen here
       is what somebody reads months later asking why nothing was sent. */
    expect(source).toContain("reason: 'no_consent', detail: consent.reason");
    expect(source).not.toContain("reason: 'send_failed', detail: 'no_consent'");
  });

  it('asks about the address consent is actually held against', () => {
    /* Consent is keyed on (business, email) — not on the contact row, because
       one person can exist on several contacts and on none. */
    expect(source.replace(/\s+/g, ' ')).toContain('marketingGate.check(row.user_id, contact.email)');
  });

  it('and stops when the contact has no address at all', () => {
    expect(source).toContain("if (!contact?.email) return { sent: false, reason: 'no_contact_email' };");
  });
});
