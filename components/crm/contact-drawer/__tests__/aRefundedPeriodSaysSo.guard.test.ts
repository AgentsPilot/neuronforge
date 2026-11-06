/**
 * A PERIOD'S REFUND IS READ FROM WHICHEVER RECORD HOLDS ITS MONEY.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS GUARDS, AND WHY IT IS A SOURCE TEST
 *
 * A payment plan's period is settled one of two ways, and the refund is
 * flattened onto whichever record took the money:
 *
 *   billed by INVOICE      → `invoice_id` set, refund on `payment_invoices`
 *   charged to a CARD      → `transaction_id` set, refund on `payment_transactions`
 *
 * Two builders assemble these periods, and each of them read exactly ONE of
 * those records — opposite ones. So between them every plan was broken on one
 * surface or the other, which is why it read as an intermittent bug:
 *
 *   `buildSessionPlan` (this file's subject)        read the CHARGE only
 *   `app/api/business-os/proposals/route.ts`        read the INVOICE only
 *
 * Both failures are silent and both are about money. A period whose refund
 * reads as nothing still looks collectable, so `StageRowActions` keeps offering
 * Refund — the dialog then opens on 0, because the SERVER knows the money went
 * back — and never withholds the receipt, so the owner can send a client a
 * receipt for a payment that was returned.
 *
 * Live cases: booking f8df6318, $30 charged and refunded, read from the card
 * (fixed 2026-10-26); booking d37068e6, $32.50 invoiced on dcd4146f and
 * refunded in full, read from the invoice (fixed 2026-11-04). The second was
 * reported from the client's side, which is how the mirror was found.
 *
 * Rendering the drawer to assert this would mean standing up a component whose
 * load path spans several endpoints. The rule is a few lines of source, so the
 * source is what is checked — and the thing most likely to reintroduce the bug
 * is someone "simplifying" the lookup back to a single record.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const DRAWER = join(__dirname, '..', 'CRMContactDrawerV2.tsx');
const PROPOSALS = join(__dirname, '..', '..', '..', '..', 'app', 'api', 'business-os', 'proposals', 'route.ts');

describe('a refunded period says so, however it was paid', () => {
  const drawer = readFileSync(DRAWER, 'utf8');

  /** The `refundedAmount:` the period mapping assigns, whitespace and all. */
  const assignment = drawer.match(/refundedAmount:\s*p\.transaction_id([\s\S]*?),\n\s*dueDate:/);

  it('builds a lookup for each record a period can be settled through', () => {
    expect(drawer).toContain('const refundedByTransaction = new Map<string, number>()');
    expect(drawer).toContain('const refundedByInvoice = new Map<string, number>()');
  });

  it('reads the charge AND the invoice when deciding what came back', () => {
    expect(assignment).not.toBeNull();
    const source = assignment![1];

    /*
     * Both branches must be present. A period has one key or the other, never
     * both, so dropping either branch silently zeroes a whole billing shape.
     */
    expect(source).toContain('refundedByTransaction.get');
    expect(source).toContain('refundedByInvoice.get');
    expect(source).toContain('p.invoice_id');
  });

  it('is given the invoices at every call site, not just one', () => {
    /*
     * The file's own comment records that these two builders drifted once
     * before: `payments` was added to one and not the other, so a booking
     * showed its refund only after an action refreshed the drawer. A call site
     * that omits `invoices` reintroduces exactly that, for the invoiced half.
     */
    const calls = drawer.match(/buildSessionPlan\(\{/g) ?? [];
    const passes = drawer.match(/invoices:\s*\w+\.invoices/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    expect(passes).toHaveLength(calls.length);
  });

  it('keeps every invoice on the booking, not only the first', () => {
    /*
     * `SchedulingRepository` collapses the one-to-many invoice join with `[0]`
     * to describe the booking. A plan bills each period through its OWN
     * invoice, so that collapse must not be the only thing the drawer gets.
     */
    const repo = readFileSync(
      join(__dirname, '..', '..', '..', '..', 'lib', 'repositories', 'SchedulingRepository.ts'),
      'utf8'
    );
    expect(repo).toContain('const invoices = (Array.isArray(booking.invoice)');
  });

  it('is mirrored in the proposals route, which had the opposite half', () => {
    const proposals = readFileSync(PROPOSALS, 'utf8');

    /* The stage must carry its charge, or the refund on it cannot be found. */
    expect(proposals).toContain('transaction_id');
    expect(proposals).toContain('refundByTransaction');
    /* And the flattening must consider both records, not the invoice alone. */
    expect(proposals).toMatch(/const refundRecord = stageInvoice \?\? stageCharge;/);
  });
});
