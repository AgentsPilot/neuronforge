'use client';

/**
 * The reason dialog of the admin "Data export" box (data export DE-10a,
 * workplan §7.2; TL default BC-1; SA W10-10). One component, two modes:
 *
 *   - prepare: "Why are you preparing this account's export?"
 *   - download: "This download is recorded with your name and this reason."
 *     The reason is pre-filled with the reason of the prepare the admin just
 *     made in this drawer, and stays editable.
 *
 * The dialog only collects the reason (5 to 500 characters, as the routes'
 * Zod schemas). The box sends the request. While it is in flight Send is
 * disabled and the dialog cannot be closed (Esc, overlay, X, Close), so one
 * Send is one request (the CreditFormDialog precedent, CR11c-1). Focus goes
 * to the reason field on open; on close the box returns it to the opener
 * (BD-15, `useReturnFocus`).
 *
 * Free text is rendered as text only.
 */

import { useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

import {
  ADMIN_DIALOG_CLASS,
  ADMIN_DIALOG_DESCRIPTION_CLASS,
  ADMIN_DIALOG_TITLE_CLASS,
} from '@/app/admin/components/layout/adminDialog';
import { DATA_EXPORT_COPY, EXPORT_REASON_MAX, EXPORT_REASON_MIN } from '../dataExportCopy';

const DARK_INPUT = '!border-slate-600 !bg-slate-800 !text-white';

export type DataExportDialogMode = 'prepare' | 'download';

interface Props {
  mode: DataExportDialogMode;
  /** The reason the field opens with (BC-1: the session's prepare reason for a download). */
  initialReason: string;
  /** True while the box's request is in flight: Send is disabled and the dialog cannot close. */
  isBusy: boolean;
  /** The last refusal of this dialog's request, in admin words. */
  error: string | null;
  onSend: (reason: string) => void;
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}

export function DataExportReasonDialog({ mode, initialReason, isBusy, error, onSend, onClose, onCloseAutoFocus }: Props) {
  const ids = useId();
  const [reason, setReason] = useState(initialReason);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const isPrepare = mode === 'prepare';

  useEffect(() => {
    setReason(initialReason);
  }, [initialReason, mode]);

  const trimmed = reason.trim();
  const isReasonValid = trimmed.length >= EXPORT_REASON_MIN && trimmed.length <= EXPORT_REASON_MAX;

  function handleOpenChange(next: boolean) {
    if (!next && !isBusy) onClose();
  }

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent
        data-testid="data-export-dialog"
        data-mode={mode}
        className={ADMIN_DIALOG_CLASS}
        aria-busy={isBusy}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          fieldRef.current?.focus();
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle className={ADMIN_DIALOG_TITLE_CLASS}>
            {isPrepare ? DATA_EXPORT_COPY.prepareTitle : DATA_EXPORT_COPY.downloadTitle}
          </DialogTitle>
          <DialogDescription className={ADMIN_DIALOG_DESCRIPTION_CLASS}>
            {isPrepare ? DATA_EXPORT_COPY.prepareDescription : DATA_EXPORT_COPY.downloadDescription}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p data-testid="data-export-dialog-error" role="alert" className="text-sm text-rose-300">
            {error}
          </p>
        )}

        <div className="space-y-1 text-sm">
          <Label htmlFor={`${ids}-reason`} className="text-slate-300">
            {DATA_EXPORT_COPY.reasonLabel(EXPORT_REASON_MIN, EXPORT_REASON_MAX)}
          </Label>
          <textarea
            id={`${ids}-reason`}
            ref={fieldRef}
            data-testid="data-export-reason"
            value={reason}
            maxLength={EXPORT_REASON_MAX + 50}
            disabled={isBusy}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            className={`w-full rounded-md border px-3 py-2 text-sm ${DARK_INPUT}`}
          />
          <p data-testid="data-export-reason-count" className="text-xs text-slate-400 tabular-nums">
            {trimmed.length} / {EXPORT_REASON_MAX}
          </p>
        </div>

        {isBusy && (
          <p data-testid="data-export-dialog-busy" role="status" className="text-sm text-slate-300">
            {isPrepare ? DATA_EXPORT_COPY.preparing : DATA_EXPORT_COPY.downloading}
          </p>
        )}

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" data-testid="data-export-dialog-close" disabled={isBusy} onClick={() => handleOpenChange(false)}>
            {DATA_EXPORT_COPY.close}
          </Button>
          <Button
            type="button"
            data-testid="data-export-dialog-send"
            disabled={isBusy || !isReasonValid}
            onClick={() => {
              if (!isBusy && isReasonValid) onSend(trimmed);
            }}
          >
            {isPrepare ? DATA_EXPORT_COPY.prepareSend : DATA_EXPORT_COPY.downloadSend}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
