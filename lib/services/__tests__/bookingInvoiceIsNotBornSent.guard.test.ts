/**
 * A BOOKING'S INVOICE IS NOT MARKED SENT BEFORE ANYTHING IS SENT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS GUARDS
 *
 * `createBookingInvoice` wrote `status: 'sent'` and `sent_at: now` at the moment
 * the row was created, before any mail existed. `InvoiceDeliveryService` states
 * the rule that breaks, right above its own update:
 *
 *   "Only after the mail is away — an invoice marked sent that nobody received
 *    is the exact bug this module exists to prevent."
 *
 * And it had a second, visible consequence. `alreadyWithTheClient` decides the
 * COPY watermark from exactly that status, deliberately deriving it from the
 * invoice so that "no call site has to remember". With the row born `sent`, the
 * client's FIRST copy of a brand-new invoice arrived stamped as a duplicate —
 * INV-00013, on a booking made minutes earlier.
 *
 * So the two halves are pinned together: the row starts as a draft, and the
 * confirmation marks it sent once the mail is actually away. Breaking either
 * half alone brings the watermark back.
 *
 * Source-level because the alternative is standing up the whole booking
 * lifecycle and an email transport to observe two field values.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..', '..');
const lifecycle = readFileSync(join(ROOT, 'lib/services/BookingLifecycleService.ts'), 'utf8');
const email = readFileSync(join(ROOT, 'lib/services/BookingEmailService.ts'), 'utf8');
const delivery = readFileSync(join(ROOT, 'lib/services/InvoiceDeliveryService.ts'), 'utf8');

describe('the invoice a booking raises', () => {
  /** The object literal handed to `paymentInvoiceRepository.create`. */
  const created = lifecycle.match(/paymentInvoiceRepository\.create\(\{([\s\S]*?)\n  \} as/);

  it('is created as a draft', () => {
    expect(created).not.toBeNull();
    expect(created![1]).toContain("status: 'draft'");
    expect(created![1]).not.toContain("status: 'sent'");
  });

  it('carries no sent_at', () => {
    expect(created![1]).toContain('sent_at: null');
    expect(created![1]).not.toMatch(/sent_at:\s*new Date\(\)/);
  });
});

describe('the confirmation that delivers it', () => {
  it('marks the invoice sent only inside the branch where the mail went', () => {
    // `if (result.sent) { … }` — the update must live inside it, not beside it.
    const sentBranch = email.match(/if \(result\.sent\) \{([\s\S]*?)\n      \} else \{/);
    expect(sentBranch).not.toBeNull();
    expect(sentBranch![1]).toContain("status: 'sent'");
    expect(sentBranch![1]).toContain('sent_at');
  });

  it('only when a copy was actually attached', () => {
    expect(email).toContain('attachments.length > 0');
  });
});

describe('the watermark rule it feeds', () => {
  it('still derives the COPY mark from the invoice status, not from the caller', () => {
    /*
     * The fix must not be "pass isCopy: false from the booking path". The module
     * explains why: "A caller that has to remember to say 'this is a resend' is
     * a caller that will forget, and the mark exists so a duplicate tax invoice
     * cannot be entered in the books twice."
     */
    expect(delivery).toContain('alreadyWithTheClient(invoice.status)');
    expect(delivery).toMatch(/status === 'sent' \|\| status === 'overdue'/);
  });
});
