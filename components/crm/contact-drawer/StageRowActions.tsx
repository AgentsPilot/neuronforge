'use client';

/**
 * What you can do to one stage of a plan or quote.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS REPLACES
 *
 * The row carried seven things at one size — dot, label, amount, date, a
 * document button, a refund button and a status word — and the two buttons were
 * the loudest marks on a line that was only reporting that money had arrived.
 *
 * The figures are what a payment row is FOR. They go back to being the thing you
 * read, and the actions go a click away rather than a column away.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EXCEPT THE ONE THAT IS NOT A DETAIL
 *
 * "Mark done" stays in front. On a milestone plan it is the act that BILLS the
 * stage — the owner's whole job on this card — and burying the thing somebody
 * came here to press would cost a click on every milestone of every job.
 *
 * Receipt and refund are different: both are occasional, and both are about a
 * stage that has already settled.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useRef, useState } from 'react';
import { Mail, MoreHorizontal, RotateCcw } from 'lucide-react';

import { shouldOpenUpward } from './menuPlacement';

interface StageRowActionsProps {
  /** The stage's own invoice, which both actions address. */
  invoiceId: string | null;
  /**
   * The processor charge this stage's money arrived as, where there is no
   * invoice. An instalment period has one of these and no `invoiceId`; a quoted
   * milestone has the reverse. Refund needs either.
   */
  transactionId?: string | null;
  paid: boolean;
  /** What is left on this stage after anything already returned. */
  remaining: number;
  /**
   * How much of this stage went back to the client.
   *
   * Distinct from `remaining`, which a PARTIAL refund leaves above zero: the
   * document send is refused for a partial refund too, so the amount returned
   * has to be asked about directly.
   */
  refunded?: number;
  /**
   * This period was called off with the job.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * A stopped stage with an unpaid invoice was still offering "send the invoice
   * again". The card above it says דרישת התשלום בוטלה — the demand is
   * withdrawn — and the row's own menu offered to send it to the client once
   * more. Pressing it would have chased somebody for money the business had
   * just decided not to collect.
   *
   * A stage that was PAID before the job stopped keeps its receipt: the payment
   * happened, and a receipt for it stays true whatever became of the work.
   * ───────────────────────────────────────────────────────────────────────────
   */
  stopped?: boolean;
  /** Sends the invoice while owed, the receipt once paid — the route decides. */
  onSendDocument?: () => void;
  /** Disabled while a send for this booking is in flight. */
  sending?: boolean;
  onRefund?: () => void;
  /**
   * Send the refund confirmation again.
   *
   * Takes the place of the receipt once money has gone back: the receipt is
   * refused by the send route, and this is the email that is actually honest
   * about what happened.
   */
  onResendRefundEmail?: () => void;
  t: (key: string) => string;
}

export function StageRowActions({
  invoiceId,
  transactionId = null,
  paid,
  stopped = false,
  remaining,
  refunded = 0,
  onSendDocument,
  sending = false,
  onRefund,
  onResendRefundEmail,
  t,
}: StageRowActionsProps) {
  const [open, setOpen] = useState(false);
  /**
   * Open upward, because there is no room below.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * The last stage of a block has nothing under it: the menu ran past the card
   * into a drawer that scrolls, and the options at the bottom could not be
   * reached at all. Every row above it was fine, which is what made it look
   * like a one-row bug rather than a placement rule.
   *
   * Measured on OPEN rather than fixed by index. "Is this the last row" is the
   * wrong question — a card near the bottom of a short panel runs out of space
   * on its second row too, and a row with three items needs more than one with
   * two.
   *
   * And measured against the DRAWER, not the window. The first version asked
   * the viewport, which had room to spare while the card's own bottom edge was
   * doing the cutting — so the flip never fired and the menu kept running off
   * the card. `shouldOpenUpward` finds the box that actually clips.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const [up, setUp] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // A menu that stays open after you click elsewhere is one you dismiss twice.
  useEffect(() => {
    if (!open) return;

    const close = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  type Item = { key: string; label: string; icon: typeof Mail; run: () => void };

  const items: Item[] = [];

  /*
   * The document for THIS stage. A job billed in three parts has three invoices
   * and three receipts, and the card's single button above can only ever reach
   * the latest — so a client asking for the deposit's invoice could not be
   * served from here at all.
   */
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * NOT ONCE THE MONEY HAS GONE BACK.
   *
   * `sendInvoice` REFUSES a refunded invoice — "was paid and then refunded, so
   * it cannot be sent again" — because the document it would build carries a
   * live pay button and asks for money the client has just been given. The
   * guard is right; the menu simply did not know about it, so the item was
   * offered, pressed, and answered with an error.
   *
   * The client is not left without paperwork: the refund confirmation email
   * goes out when the refund is recorded, and that is the honest artefact
   * after a refund.
   *
   * `refunded > 0` rather than a full-refund test, because the send is refused
   * for `partially_refunded` as well.
   * ───────────────────────────────────────────────────────────────────────────
   */
  /* A cancelled demand is not re-sent. The receipt for one already paid is,
     because that money really did arrive. */
  if (invoiceId && onSendDocument && refunded <= 0 && (paid || !stopped)) {
    items.push({
      key: 'document',
      label: paid ? t('crm.invoice.send_receipt') : t('crm.invoice.resend'),
      icon: Mail,
      run: onSendDocument,
    });
  }

  /*
   * Only while something is left to return. A fully refunded stage stops
   * offering it, and the line above the row already says what came back.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * EITHER KEY, because a stage's money arrives by one of two routes.
   *
   * This read `invoiceId` alone, which is right for a quoted MILESTONE — it
   * raises an invoice and is refunded through it. An INSTALMENT period charged
   * by the processor never gets one: the money lands as a transaction and
   * `invoice_id` stays null.
   *
   * So a paid instalment showed its ₪400 collected and offered no way to give
   * it back. Not a backend limitation — `/api/payments/refunds` takes
   * `transaction_id` as an alternative to `invoice_id`, and `RefundModal` has
   * always had the prop. The row simply never carried the key.
   *
   * `onRefund` decides WHICH key to send; this only asks whether one exists.
   * ───────────────────────────────────────────────────────────────────────────
   */
  if (paid && (invoiceId || transactionId) && onRefund && remaining > 0) {
    items.push({
      key: 'refund',
      label: t('payments.refund') || 'Refund',
      icon: RotateCcw,
      run: onRefund,
    });
  }

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE DOCUMENT THAT IS HONEST AFTER A REFUND.
   *
   * It replaces the receipt rather than joining it: above, the receipt is
   * withheld once `refunded > 0`, so without this a refunded stage had an empty
   * menu and the owner had no way to tell the client anything at all.
   *
   * The confirmation itself fires once, when the refund is recorded, and only
   * if "notify the client" was ticked. A refund that arrived through a webhook,
   * an automation block or the Stripe dashboard had nobody to tick it — so for
   * those the client was never told, and until now nothing could put it right.
   * ───────────────────────────────────────────────────────────────────────────
   */
  if (refunded > 0 && onResendRefundEmail) {
    items.push({
      key: 'refund-email',
      label: t('crm.refund.resend_confirmation') || 'Resend refund confirmation',
      icon: Mail,
      run: onResendRefundEmail,
    });
  }

  if (items.length === 0) return null;

  return (
    <div className="relative shrink-0" ref={menuRef}>
      <button
        type="button"
        disabled={sending}
        ref={triggerRef}
        onClick={event => {
          event.stopPropagation();

          if (!open) setUp(shouldOpenUpward(triggerRef.current, items.length));

          setOpen(value => !value);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('common.actions') || 'Actions'}
        className="flex h-6 w-6 items-center justify-center rounded text-[var(--v2-text-muted)] transition-colors hover:bg-[var(--v2-border)] hover:text-[var(--v2-text-primary)] disabled:opacity-50"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>

      {/*
        `end-0` in both scripts. The trigger sits at the row's inline END — right
        in English, left in Hebrew — so anchoring there makes the menu grow
        INWARD either way. A conditional flip sent it off the card's edge, which
        is how the meetings menu came to be clipped to a strip of icons.
      */}
      {open && (
        <div
          role="menu"
          className={`absolute end-0 z-20 min-w-[160px] overflow-hidden rounded-lg border border-[var(--v2-border)] bg-[var(--v2-surface)] shadow-lg ${
            up ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
          {items.map(item => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              onClick={event => {
                event.stopPropagation();
                setOpen(false);
                item.run();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-[12px] text-[var(--v2-text-secondary)] transition-colors hover:bg-[var(--v2-surface-hover)]"
            >
              <item.icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
