'use client';

import { useEffect, useRef, useState } from 'react';
import {
  MoreHorizontal,
  Send,
  Link2,
  Download,
  ExternalLink,
  X,
  RotateCcw,
  RefreshCw,
  Check,
  Loader2,
  AlertCircle,
  Banknote,
} from 'lucide-react';
import { createLogger } from '@/lib/logger';
import type { MoneyEntry } from '@/lib/payments/moneyItems';

const logger = createLogger({ module: 'MoneyEntryActions' });

/**
 * What can be done to one piece of money.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Actions belong to the ENTRY, not to the booking above it. "Send the booking"
 * is not a thing; sending an invoice is. A booking with two invoices has two
 * sets of actions, and putting them on the container would make it ambiguous
 * which invoice a click applied to.
 *
 * Only what is possible right now is offered. A draft cannot be refunded, a paid
 * invoice cannot be voided, and an invoice with no payment link has nothing to
 * copy — showing those greyed out teaches the reader to ignore the row, and
 * showing them live invites an error message instead of an outcome.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface EntryActionHandlers {
  onSend?: (entry: MoneyEntry) => Promise<void> | void;
  onResend?: (entry: MoneyEntry) => Promise<void> | void;
  onCopyLink?: (entry: MoneyEntry) => Promise<void> | void;
  onDownloadPdf?: (entry: MoneyEntry) => Promise<void> | void;
  onViewInStripe?: (entry: MoneyEntry) => void;
  onVoid?: (entry: MoneyEntry) => Promise<void> | void;
  onMarkPaid?: (entry: MoneyEntry) => Promise<void> | void;
  onRefund?: (entry: MoneyEntry) => void;
}

interface MoneyEntryActionsProps extends EntryActionHandlers {
  entry: MoneyEntry;
  t: (key: string) => string;
  isRTL?: boolean;
  /**
   * Lay the actions out as visible buttons instead of behind a ⋯ menu.
   *
   * A list has no room, so there the menu is the only honest option. A drawer
   * has room, and hiding the actions there costs a click to answer a question
   * the screen should already be answering: what can I do with this?
   */
  inline?: boolean;
}

export function MoneyEntryActions({
  entry,
  t,
  isRTL = false,
  inline = false,
  onSend,
  onResend,
  onCopyLink,
  onDownloadPdf,
  onViewInStripe,
  onVoid,
  onMarkPaid,
  onRefund,
}: MoneyEntryActionsProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  /** The last failure, shown until the next attempt. */
  const [failed, setFailed] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // A menu that stays open after you click elsewhere is a menu you have to
  // dismiss twice.
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const isInvoice = !!entry.invoiceId;
  const settled = ['paid', 'partially_refunded', 'refunded'].includes(entry.status);
  const remaining = entry.amount - entry.refunded;

  const run = async (key: string, action?: (entry: MoneyEntry) => Promise<void> | void) => {
    if (!action) return;
    setBusy(key);
    setFailed(null);
    try {
      await action(entry);
      // A brief tick, because "copied" and "sent" have no other visible result.
      setDone(key);
      setTimeout(() => setDone(null), 1600);
    } catch (err) {
      // There was no catch here at all. Every handler in `entryActions` throws
      // on failure, so a void refused with 409, a send that bounced, or a
      // payment link that came back empty produced an unhandled rejection, the
      // menu closed, and NOTHING appeared — no tick, no message. The absence of
      // the success tick was the only signal, which is not a signal.
      logger.warn({ err, action: key, invoiceId: entry.invoiceId }, 'Money action failed');
      setFailed(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      setOpen(false);
    }
  };

  const items: Array<{
    key: string;
    label: string;
    icon: typeof Send;
    action?: (entry: MoneyEntry) => Promise<void> | void;
    danger?: boolean;
  }> = [];

  if (isInvoice) {
    if (entry.status === 'draft' && onSend) {
      items.push({ key: 'send', label: t('payments.send') || 'Send', icon: Send, action: onSend });
    }

    // Chasing an unpaid invoice: the link, or another copy of the email.
    if (!settled && entry.status !== 'draft' && entry.status !== 'cancelled') {
      if (onCopyLink) {
        items.push({ key: 'link', label: t('payments.copy_payment_link') || 'Copy payment link', icon: Link2, action: onCopyLink });
      }
      if (onResend) {
        // A distinct icon from Send. Reduced to pictograms, "send" and "send
        // again" cannot be two identical paper planes next to each other —
        // though only one of them is ever offered at a time, since Send is for
        // drafts and Resend for what has already gone out.
        items.push({ key: 'resend', label: t('payments.resend') || 'Resend', icon: RefreshCw, action: onResend });
      }
      if (onMarkPaid) {
        items.push({ key: 'markPaid', label: t('payments.mark_paid') || 'Mark as paid', icon: Check, action: onMarkPaid });
      }
    }

    if (onDownloadPdf) {
      items.push({ key: 'pdf', label: t('payments.download_pdf') || 'Download PDF', icon: Download, action: onDownloadPdf });
    }

    // Only when there is something to open. The handler falls back to doing
    // nothing without a hosted URL, so an invoice that never went to Stripe was
    // offering a button that silently did nothing — the same failure shape as
    // the copy-link bug, one screen over.
    if (onViewInStripe && entry.stripeHostedUrl) {
      items.push({
        key: 'stripe',
        label: t('payments.view_in_stripe') || 'View in Stripe',
        icon: ExternalLink,
        action: async e => onViewInStripe(e),
      });
    }

    // Voiding is for money never collected. A settled invoice is a record of
    // something that happened, and is refunded instead.
    if (!settled && entry.status !== 'cancelled' && onVoid) {
      items.push({ key: 'void', label: t('payments.void_invoice') || 'Void invoice', icon: X, action: onVoid, danger: true });
    }
  }

  /*
   * Can this money be returned from here at all?
   *
   * TWO WAYS YES, and they used to be conflated into one.
   *
   *   A Stripe payment with a reference — the intent or the charge — can be
   *   refunded through Stripe.
   *
   *   MANUAL money can be RECORDED as refunded. The business returns it the way
   *   it arrived and tells us, which closes the invoice, nets the reports and
   *   puts the reversal in the ledger on its own date.
   *
   * The second used to be excluded: the gate was `!!entry.processorRef`, and
   * the comment here said manual money "is returned outside Stripe too, so
   * there is nothing to offer" — true of the processor call, false of the
   * record. A business collecting by transfer could take money through the
   * platform and never show it coming back.
   *
   * Still excluded, deliberately: a payment whose `processor_type` is 'stripe'
   * but which never recorded a reference. That money DID go through Stripe and
   * has to come back through it — the server refuses to record one by hand, and
   * offering the action would only lead into a dialog that cannot act.
   */
  const isManualMoney = entry.processorType === 'manual';
  const canReturn = !!entry.processorRef || isManualMoney;

  if (settled && remaining > 0 && canReturn && onRefund) {
    items.push({
      key: 'refund',
      // "Record" for manual money, because that is what pressing it does: the
      // business returns the money itself and this writes it down. Calling it
      // Refund would promise the platform was moving something.
      label: isManualMoney
        ? t('payments.refund.record_action')
        : t('payments.refund') || 'Refund',
      icon: isManualMoney ? Banknote : RotateCcw,
      action: async e => onRefund(e),
      danger: true,
    });
  }

  if (items.length === 0) return null;

  if (inline) {
    return (
      <div className="min-w-0">
        {failed && (
          <p className="mb-1.5 flex items-start gap-1.5 text-[11px] text-red-600">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{failed}</span>
          </p>
        )}

        <div className="flex items-center gap-1.5">
        {items.map(item => (
          <button
            key={item.key}
            onClick={event => {
              event.stopPropagation();
              run(item.key, item.action);
            }}
            disabled={busy !== null}
            // Icon only, with the label as its tooltip. Spelled out, seven
            // actions wrap onto three lines inside a drawer card and stop
            // reading as one set of controls.
            //
            // `title` gives the hover tooltip and `aria-label` the accessible
            // name — an icon button with neither is unusable by anyone who
            // cannot guess the pictogram. The repo has no tooltip primitive;
            // `title` is what the ⋯ button beside this already uses.
            title={item.label}
            aria-label={item.label}
            className={`flex h-8 w-8 items-center justify-center border transition-colors disabled:opacity-50 ${
              item.danger
                ? 'border-orange-500/40 text-orange-600 hover:bg-orange-500/10'
                : 'border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:bg-[var(--v2-surface-hover)] hover:text-[var(--v2-text-primary)]'
            }`}
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            {busy === item.key ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : done === item.key ? (
              <Check className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <item.icon className="h-3.5 w-3.5" />
            )}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="relative shrink-0" ref={menuRef}>
      <button
        onClick={event => {
          event.stopPropagation();
          setOpen(!open);
        }}
        className={`flex h-6 w-6 items-center justify-center rounded hover:bg-[var(--v2-border)] ${
          failed ? 'text-red-600' : 'text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]'
        }`}
        // A row has no room for a sentence, so the failure becomes the tooltip
        // and the trigger goes red. Better than the previous nothing at all.
        title={failed ?? t('common.actions') ?? 'Actions'}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : done ? (
          <Check className="h-3.5 w-3.5 text-emerald-500" />
        ) : failed ? (
          <AlertCircle className="h-3.5 w-3.5" />
        ) : (
          <MoreHorizontal className="h-3.5 w-3.5" />
        )}
      </button>

      {open && (
        <div
          className={`absolute z-20 mt-1 min-w-[180px] overflow-hidden rounded-lg border border-[var(--v2-border)] bg-[var(--v2-surface)] shadow-lg ${
            isRTL ? 'start-0' : 'end-0'
          }`}
        >
          {items.map(item => (
            <button
              key={item.key}
              onClick={event => {
                event.stopPropagation();
                run(item.key, item.action);
              }}
              disabled={busy !== null}
              className={`flex w-full items-center gap-2 px-3 py-2 text-[12px] hover:bg-[var(--v2-surface-hover)] disabled:opacity-50 ${
                item.danger ? 'text-orange-600' : 'text-[var(--v2-text-secondary)]'
              }`}
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
