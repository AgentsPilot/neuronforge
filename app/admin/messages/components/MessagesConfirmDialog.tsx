'use client';

/**
 * The Messages confirmations (Admin Layout Follow-ups LF-3b, OR-3, SA-C11):
 * Delete and Mark All Read ask here instead of the browser's native confirm box, with
 * the same words. The page owns the request; this dialog owns only the asking.
 *
 * - Initial focus is Cancel, so Enter on open never sends anything.
 * - One send per confirmation: a ref is set on the first click, before React
 *   re-renders, so the second event of a double click returns at once.
 * - While the request is in flight the dialog cannot be dismissed (Escape, an
 *   outside click, the corner close or Cancel): the admin sees it finish.
 * - It opens from a page button, not a Radix trigger, so focus goes back by
 *   hand through `onReturnFocus` (the `AdminDrawer` way); the page picks the
 *   opener or a fallback, never body.
 *
 * The page's handlers never throw (each fetch sits in a try), so the dialog
 * closes once the request settles; a failure is shown by the page's own D-19
 * line, as before.
 */

import { useRef, useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  ADMIN_DIALOG_CLASS,
  ADMIN_DIALOG_TITLE_CLASS,
} from '@/app/admin/components/layout/adminDialog';
import { ADMIN_BUTTON } from '@/app/admin/components/layout/adminTable';

const DANGER_BUTTON =
  'rounded-lg bg-rose-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500';

const PRIMARY_BUTTON =
  'rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500';

export interface MessagesConfirmDialogProps {
  open: boolean;
  /** The question, word for word what the native confirm box asked. */
  title: string;
  /** The action button's words. */
  confirmLabel: string;
  /** A destructive action (Delete) gets the rose fill. */
  isDanger?: boolean;
  testId: string;
  /** The request. Resolves when it has settled; never rejects. */
  onConfirm: () => Promise<void>;
  /** The dialog is done: the page clears what it was asking about. */
  onClose: () => void;
  /** Where focus goes after the dialog has closed. */
  onReturnFocus: () => void;
}

export function MessagesConfirmDialog({
  open,
  title,
  confirmLabel,
  isDanger = false,
  testId,
  onConfirm,
  onClose,
  onReturnFocus,
}: MessagesConfirmDialogProps) {
  const [isBusy, setIsBusy] = useState(false);
  /** Set synchronously on the first click: the guard a double click cannot pass. */
  const isSending = useRef(false);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  const onOpenChange = (next: boolean) => {
    if (next || isSending.current) return;
    onClose();
  };

  const send = async () => {
    if (isSending.current) return;
    isSending.current = true;
    setIsBusy(true);
    try {
      await onConfirm();
    } finally {
      isSending.current = false;
      setIsBusy(false);
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid={testId}
        className={ADMIN_DIALOG_CLASS}
        aria-describedby={undefined}
        aria-busy={isBusy}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelRef.current?.focus();
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
        </DialogHeader>
        <DialogFooter className="gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={isBusy}
            className={ADMIN_BUTTON}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void send()}
            disabled={isBusy}
            aria-busy={isBusy}
            className={isDanger ? DANGER_BUTTON : PRIMARY_BUTTON}
          >
            {confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
