'use client';

/**
 * The shared admin confirmation dialog (Admin Layout Follow-ups LF-7; SA ruling
 * LF3B-F1). It owns only the asking; the page or the screen file owns the
 * request, its words and what a refusal says.
 *
 * The discipline it carries (first written in LF-3b Messages and LF-3a Revoke):
 *
 * - Initial focus is set by hand: the cancel button by default, so Enter on
 *   open never sends anything, or `initialFocusRef` (Revoke's reason field).
 * - One send per confirmation: the submit handler checks a ref that is set
 *   before any await, so a double click or two same-tick submits send once.
 *   `preventDefault` runs first and unconditionally (SA C-1), so no guard can
 *   let the browser submit the form.
 * - While the request is in flight it cannot be dismissed: Escape, an outside
 *   click and the corner close are refused, and the cancel button is disabled.
 * - It opens from a page button, not a Radix trigger, so focus goes back by
 *   hand through `onReturnFocus`; the page picks the opener or a fallback,
 *   never body.
 *
 * Always a `<form>`: the confirm is `type="submit"`, so Enter in a field of
 * `children` confirms, and `canConfirm` gates both the button and the submit.
 * An optional `description` (added by LF-9, its first adopter: Reconcile
 * top-ups) is the content's accessible description; without one the content
 * has no `aria-describedby` at all. LF-9 also added `busyLabel` (the confirm's
 * words in flight, default `confirmLabel`) and the two button test ids. None
 * of the four changes anything for a consumer that does not pass it.
 */

import { useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import { Loader2 } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ADMIN_DIALOG_CLASS, ADMIN_DIALOG_DESCRIPTION_CLASS, ADMIN_DIALOG_TITLE_CLASS } from './adminDialog';
import { ADMIN_BUTTON } from './adminTable';

export type AdminConfirmTone = 'danger' | 'primary';

/** One look for every admin confirmation (SA SQ-1). Literals here so Tailwind generates them. */
export const ADMIN_CONFIRM_TONE_CLASS: Record<AdminConfirmTone, string> = {
  danger:
    'inline-flex items-center gap-2 rounded-lg bg-rose-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500',
  primary:
    'inline-flex items-center gap-2 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500',
};

export interface AdminConfirmDialogProps {
  open: boolean;
  /** The question. */
  title: ReactNode;
  /** A sentence of context under the title; becomes the accessible description. */
  description?: ReactNode;
  /** The cancel button's words. Default "Cancel". */
  cancelLabel?: string;
  /** The confirm button's words. */
  confirmLabel: string;
  /** The confirm button's words while the request is in flight. Default `confirmLabel`. */
  busyLabel?: string;
  /** On the confirm button. */
  confirmTestId?: string;
  /** On the cancel button. */
  cancelTestId?: string;
  /** Default `primary`. */
  tone?: AdminConfirmTone;
  /** On the dialog content. */
  testId: string;
  /** Extra content between the title and the buttons, inside the form. */
  children?: ReactNode;
  /** Focused on open. Default: the cancel button. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Default true. False disables the confirm button and makes a submit do nothing. */
  canConfirm?: boolean;
  /**
   * The request. Resolve `false`: the dialog does not call `onClose`; the
   * consumer decides whether it closes (SA SQ-4). Anything else closes through
   * `onClose`. Must not reject (both consumers catch): a rejection still resets
   * and closes, then surfaces as an unhandled rejection, as in the LF-3b dialog.
   */
  onConfirm: () => Promise<boolean | void>;
  /** Cancel, Escape, an outside click, the corner close, or a settled confirm. Never in flight. */
  onClose: () => void;
  /** Called after the dialog has closed: the page focuses the opener or its fallback. */
  onReturnFocus: () => void;
}

export function AdminConfirmDialog({
  open,
  title,
  description,
  cancelLabel = 'Cancel',
  confirmLabel,
  busyLabel,
  confirmTestId,
  cancelTestId,
  tone = 'primary',
  testId,
  children,
  initialFocusRef,
  canConfirm = true,
  onConfirm,
  onClose,
  onReturnFocus,
}: AdminConfirmDialogProps) {
  const [isBusy, setIsBusy] = useState(false);
  /** Set synchronously on the first submit: the guard a same-tick second submit cannot pass. */
  const isSending = useRef(false);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  const onOpenChange = (next: boolean) => {
    if (next || isSending.current) return;
    onClose();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (isSending.current) return;
    if (!canConfirm) return;
    isSending.current = true;
    setIsBusy(true);
    let result: boolean | void = undefined;
    try {
      result = await onConfirm();
    } finally {
      isSending.current = false;
      setIsBusy(false);
      if (result !== false) onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid={testId}
        className={ADMIN_DIALOG_CLASS}
        // With a description the key is left out, so Radix links its own
        // description id; an explicit undefined would remove that link (SA C-1).
        {...(description === undefined ? { 'aria-describedby': undefined } : {})}
        aria-busy={isBusy}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (initialFocusRef?.current ?? cancelRef.current)?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onReturnFocus();
        }}
        onEscapeKeyDown={(event) => {
          if (isSending.current) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (isSending.current) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className={ADMIN_DIALOG_TITLE_CLASS}>{title}</DialogTitle>
          {description !== undefined && (
            <DialogDescription className={ADMIN_DIALOG_DESCRIPTION_CLASS}>{description}</DialogDescription>
          )}
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="space-y-3">
          {children}
          <DialogFooter className="gap-2">
            <button
              ref={cancelRef}
              type="button"
              data-testid={cancelTestId}
              onClick={() => onOpenChange(false)}
              disabled={isBusy}
              className={ADMIN_BUTTON}
            >
              {cancelLabel}
            </button>
            <button
              type="submit"
              data-testid={confirmTestId}
              disabled={isBusy || !canConfirm}
              aria-busy={isBusy}
              className={ADMIN_CONFIRM_TONE_CLASS[tone]}
            >
              {isBusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {isBusy ? (busyLabel ?? confirmLabel) : confirmLabel}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
