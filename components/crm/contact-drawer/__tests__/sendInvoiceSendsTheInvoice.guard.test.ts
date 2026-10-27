/**
 * The banner's "Send invoice" sends the invoice.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * A course sold for a single payment, booked by the owner. The card's next-step
 * banner read:
 *
 *     Needs invoicing          [ Send invoice ]
 *
 * and the button opened the payment manager — a dialog about a payment plan, on
 * a service that has no plan and nothing left to arrange. The owner pressed
 * Send and nothing was sent.
 *
 * `send_invoice` had been grouped in the switch with `remind_quote` and
 * `remind_payment`, under a comment that is correct about those two: chasing a
 * document the client already holds belongs on the manager, where the reminder
 * lives. `send_invoice` is not chasing. Its badge says the client has been
 * asked for nothing yet.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PREMISE, AND WHY HALF OF THIS IS A REAL TEST
 *
 * Sending straight from the banner is only safe because of what the state
 * means, so that half is tested for real against `moneyStateFrom` rather than
 * asserted about the source: `needs_invoice` is the ONLY state offering this
 * action, and it is unreachable for anything but a single payment whose invoice
 * is still a draft. If that ever stops holding, the button could send a settled
 * document, and these cases fail before the wiring does.
 *
 * The wiring itself lives in a `switch` inside a component whose props are the
 * whole session graph, so the routing is checked at the source.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';
import { moneyStateFrom } from '@/components/crm/contact-drawer/moneyState';
import type { SessionPayment } from '@/components/crm/contact-drawer/types';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

const tab = read('components/crm/contact-drawer/BookingsTab.tsx');
const nextStep = read('lib/business-os/bookingNextStep.ts');

const single = (over: Partial<SessionPayment> = {}): SessionPayment => ({
  amount: 70,
  currency: 'USD',
  status: 'pending',
  ...over,
});

describe('the premise: what `needs_invoice` can contain', () => {
  it('a draft invoice is the state, which is the case the banner sends', () => {
    expect(moneyStateFrom(single({ invoiceId: 'inv-1', invoiceStatus: 'draft' }))).toBe(
      'needs_invoice',
    );
  });

  it('no invoice at all is also the state — and there is nothing to send', () => {
    expect(moneyStateFrom(single())).toBe('needs_invoice');
  });

  it('an invoice the client is holding is NOT the state', () => {
    // Chasing. The manager owns it, and the banner offers `remind_payment`.
    expect(moneyStateFrom(single({ invoiceId: 'inv-1', invoiceStatus: 'sent' }))).toBe(
      'with_client',
    );
    expect(moneyStateFrom(single({ invoiceId: 'inv-1', invoiceStatus: 'overdue' }))).toBe(
      'with_client',
    );
  });

  it('a settled payment is NOT the state, so the button cannot resend a receipt', () => {
    expect(moneyStateFrom(single({ status: 'paid', invoiceId: 'inv-1' }))).toBe('paid');
    expect(moneyStateFrom(single({ status: 'refunded', invoiceId: 'inv-1' }))).toBe('paid');
  });

  it('a plan never reaches it, so `send_invoice` is never offered for one', () => {
    /*
     * A plan's unbilled stage is `plan_needs_billing` and its own action is
     * `bill_next_stage`, which still belongs on the manager: that stage has no
     * document yet, and raising one is what the dialog is for.
     */
    const planned = moneyStateFrom(
      single({
        plan: {
          installmentCount: 3,
          installmentAmount: 100,
          totalAmount: 300,
          frequency: 'monthly',
        },
      }),
    );

    expect(planned).not.toBe('needs_invoice');
  });
});

describe('`needs_invoice` is the only state offering the action', () => {
  it('and it offers nothing else', () => {
    const at = nextStep.indexOf("case 'needs_invoice':");
    expect(at).toBeGreaterThan(-1);

    const branch = nextStep.slice(at, nextStep.indexOf('case ', at + 10));
    expect(branch).toMatch(/actions: \['send_invoice'\]/);
  });
});

describe('the banner routes it to the sender', () => {
  it('no longer falls through to the chasing group', () => {
    /*
     * The fault exactly: the three labels stacked onto one `onManagePayment`.
     * Written as a search for `send_invoice` sitting between two chasing cases
     * so it fails however the group is later reordered.
     */
    expect(tab).not.toMatch(/case 'remind_payment':\s*\n\s*case 'send_invoice':/);
  });

  it('sends the draft through the same call the journey step uses', () => {
    const at = tab.indexOf("case 'send_invoice': {");
    expect(at).toBeGreaterThan(-1);

    const branch = tab.slice(at, tab.indexOf('\n      }', at));

    /* Outstanding first: on a plan, `invoiceId` names the one already paid. */
    expect(branch).toMatch(
      /session\.payment\?\.outstandingInvoiceId \?\? session\.payment\?\.invoiceId/,
    );
    expect(branch).toMatch(/handleSendInvoice\(draft, bookingId\)/);
  });

  it('still opens the manager when no invoice has been raised', () => {
    const at = tab.indexOf("case 'send_invoice': {");
    const branch = tab.slice(at, tab.indexOf('\n      }', at));

    expect(branch).toMatch(/onManagePayment\?\.\(session\)/);
  });

  it('leaves chasing where it was', () => {
    expect(tab).toMatch(/case 'remind_quote':\s*\n\s*case 'remind_payment':/);
    expect(tab).toMatch(/case 'bill_next_stage':\s*\n\s*onManagePayment\?\.\(session\)/);
  });
});
