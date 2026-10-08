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
  paid: boolean;
  /** What is left on this stage after anything already returned. */
  remaining: number;
  /** Sends the invoice while owed, the receipt once paid — the route decides. */
  onSendDocument?: () => void;
  /** Disabled while a send for this booking is in flight. */
  sending?: boolean;
  onRefund?: () => void;
  t: (key: string) => string;
}

export function StageRowActions({
  invoiceId,
  paid,
  remaining,
  onSendDocument,
  sending = false,
  onRefund,
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
  if (invoiceId && onSendDocument) {
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
   */
  if (paid && invoiceId && onRefund && remaining > 0) {
    items.push({
      key: 'refund',
      label: t('payments.refund') || 'Refund',
      icon: RotateCcw,
      run: onRefund,
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
