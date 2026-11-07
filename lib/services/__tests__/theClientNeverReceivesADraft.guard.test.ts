/**
 * The invoice a client receives is never stamped DRAFT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE CLIENT WAS SENT
 *
 * A booking confirmation with an invoice attached, and the invoice badged
 * טיוטה — DRAFT — in the corner. Observed on INV-00049, which was created at
 * 21:00:40 as `draft` and stamped `sent` at 21:00:47. The row was right within
 * seven seconds; the PDF was rendered inside them, and it is the PDF the client
 * keeps.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE ROW IS NOT SIMPLY MARKED SENT EARLIER
 *
 * Because that is the failure the draft state exists to prevent, and this
 * codebase has been bitten by it twice: an invoice marked sent that nobody
 * received. `InvoiceDeliveryService` stamps `sent_at` only once the mail is
 * actually away, and that ordering must not be reversed to fix a badge.
 *
 * So the document is rendered as delivered while the ROW stays `draft` until
 * the send succeeds. Attaching an invoice to an email IS the act of delivery;
 * the badge should say so, and the database should still refuse to claim it
 * until the transport agrees.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

/*
 * The PDF generator is React-PDF, which ships ESM that this transform does not
 * take — importing the service for one pure function would drag it in. Mocked
 * at the seam, so the module under test loads and nothing renders.
 */
jest.mock('@/lib/pdf/InvoicePDFGenerator', () => ({ generateInvoicePDFAsync: jest.fn() }));

import { statusOnDelivery } from '@/lib/services/InvoiceDeliveryService';

const source = fs
  .readFileSync(path.join(process.cwd(), 'lib/services/InvoiceDeliveryService.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('the badge on a delivered document', () => {
  it('never says draft', () => {
    /* THE BUG, AS ONE ASSERTION. */
    expect(statusOnDelivery('draft')).toBe('sent');
  });

  it.each(['paid', 'cancelled', 'refunded', 'partially_refunded', 'overdue', 'sent'])(
    'leaves %s exactly as it is',
    status => {
      /*
       * These are facts about the money or the date, and a document that
       * misreports them is worse than one badged draft. Only `draft` — a
       * statement about our own send pipeline, not about the client — is
       * rewritten.
       */
      expect(statusOnDelivery(status)).toBe(status);
    }
  );
});

describe('the row is still protected', () => {
  it('both delivery paths render as delivered', () => {
    /* The attachment builder and the email path. A client can receive either,
       and an unmarked difference between them is how one regresses alone. */
    expect(source.match(/statusOnDelivery\(invoice\.status\)/g)).toHaveLength(2);
  });

  it('the copy mark is still derived from the REAL status', () => {
    /*
     * The subtle trap. `alreadyWithTheClient` decides the COPY watermark, which
     * exists so a duplicate tax invoice cannot be entered in the books twice.
     * Feeding it the delivery status would make every first send look like a
     * resend.
     */
    expect(source).toContain('alreadyWithTheClient(invoice.status)');
    expect(source).not.toContain('alreadyWithTheClient(statusOnDelivery');
  });

  it('nothing marks the invoice sent before the mail is away', () => {
    /*
     * The ordering this whole module exists to hold. `statusOnDelivery` changes
     * what is PRINTED; if it ever changes what is STORED, the guarantee is gone.
     */
    expect(source).not.toMatch(/update\([^)]*status:\s*'sent'[^)]*\)[\s\S]{0,200}sendEmail/);
  });
});

describe("the owner's own preview is untouched", () => {
  it('the download route still shows a draft as a draft', () => {
    /*
     * An owner looking at an invoice they have not sent is looking at a draft,
     * and should be told so. Only the two DELIVERY paths rewrite the badge.
     */
    const route = fs.readFileSync(
      path.join(process.cwd(), 'app/api/payments/invoices/[id]/pdf/route.ts'),
      'utf8'
    );

    expect(route).not.toContain('statusOnDelivery');
  });
});
