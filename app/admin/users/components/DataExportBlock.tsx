'use client';

/**
 * The "Data export" section of the Businesses drawer (data export DE-10a,
 * workplan §7; user request 2026-10-16: in the business area, just above the
 * Danger Zone; TL defaults BC-1, BC-4, BC-5, BC-6; SA SA-9, W10-10).
 *
 * Reads `GET /api/admin/users/<id>/data-exports` once when the drawer opens
 * (the drawer mounts this only while open) and again after a prepare. Shows:
 *
 *   - the account's last exports, newest first, three and then a fold: when,
 *     by whom (the owner, "you", or "admin ab12cd34"), the state in words,
 *     the sizes, and for an owner export whether the owner downloaded it;
 *   - BC-4: a warning when the owner has not downloaded their newest export
 *     (or never exported). Informational only: nothing in the Danger area is
 *     disabled or hidden by it (§0.4.1 H);
 *   - "Prepare export" and, on each downloadable export, "Download
 *     (audited)…". Each opens the reason dialog. The download is recorded with
 *     the admin's name and reason BEFORE the server makes the link; the owner
 *     is not notified (BQ-SA-2). Hidden on the admin's own account (BC-6; the
 *     server refuses it regardless).
 *
 * The link is followed only when it is https (DE-9's `isSafeDownloadUrl`,
 * SA DE-9 C-6), through DE-9's one navigation seam. Neither the link nor the
 * file name is logged or kept in state.
 *
 * Admin dark tone only (§7.3): no decorative green, colour never the only
 * signal (the words say the state).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

import { ADMIN_BUTTON } from '@/app/admin/components/layout/adminTable';
import { formatUtc } from '@/app/admin/components/layout/adminFormat';
import { readAdminResponse } from '@/app/admin/components/layout/readAdminResponse';
import { readJsonBody } from '@/app/admin/components/layout/readJsonBody';
import { StatusChip, type StatusTone } from '@/app/admin/components/layout/StatusChip';
import { browserNavigation, isSafeDownloadUrl } from '@/lib/client/businessOsDataExport';
import { clientLogger } from '@/lib/logger/client';
import { ageLine } from '@/app/admin/users/usersFormat';
import {
  DATA_EXPORT_COPY,
  PREPARE_TIMEOUT_MS,
  dataExportRefusal,
  exportSizeLine,
  failureWord,
} from '../dataExportCopy';
import type { AdminDataExportRow, AdminDataExportStatus } from '../types';
import { DataExportReasonDialog, type DataExportDialogMode } from './DataExportReasonDialog';
import { DrawerBox } from './DrawerBox';
import { ShowMoreList } from './drawerFolds';
import { MONEY_ACTION_BAR, useReturnFocus } from './moneyBlockUi';

const logger = clientLogger.child({ module: 'AdminDataExportBlock' });

type Load = { state: 'loading' } | { state: 'ok'; data: AdminDataExportStatus } | { state: 'error' };

type DialogState = { mode: 'prepare' } | { mode: 'download'; jobId: string };

/** A status line under the action bar: the last result in words. */
interface Notice {
  text: string;
  tone: 'done' | 'problem';
}

/** One POST and its body; never throws. `aborted` is our own timer. */
async function postReason(
  url: string,
  reason: string,
  signal?: AbortSignal
): Promise<
  | { kind: 'ok'; data: Record<string, unknown> }
  | { kind: 'refused'; code: string | null; status: number; retryAt: string | null }
  | { kind: 'network' }
  | { kind: 'aborted' }
> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
      cache: 'no-store',
      signal,
    });
    const body = (await readJsonBody(response)) as (Record<string, unknown> & { data?: unknown }) | null;
    if (response.ok && body?.success === true && body.data && typeof body.data === 'object') {
      return { kind: 'ok', data: body.data as Record<string, unknown> };
    }
    return {
      kind: 'refused',
      code: typeof body?.code === 'string' ? body.code : null,
      status: response.status,
      retryAt: typeof body?.retryAt === 'string' ? body.retryAt : null,
    };
  } catch (err) {
    if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) return { kind: 'aborted' };
    return { kind: 'network' };
  }
}

function whoLine(row: AdminDataExportRow): string {
  if (row.requestedByKind === 'owner') return 'by the owner';
  if (row.isRequestedByYou) return 'by you';
  return row.requestedByShort ? `by admin ${row.requestedByShort}` : 'by an admin';
}

/** The state in words, and its chip tone (never the only signal). */
function stateOf(row: AdminDataExportRow): { word: string; tone: StatusTone } {
  if (row.status === 'ready' && row.isDownloadable) return { word: `Ready until ${formatUtc(row.expiresAt)}`, tone: 'info' };
  if (row.status === 'ready' || row.status === 'expired') return { word: 'Expired', tone: 'neutral' };
  if (row.status === 'failed') return { word: failureWord(row.failureReason), tone: 'danger' };
  return { word: 'Being prepared', tone: 'warn' };
}

function ExportRow({
  row,
  canDownload,
  onDownload,
}: {
  row: AdminDataExportRow;
  canDownload: boolean;
  onDownload: (row: AdminDataExportRow, opener: HTMLElement) => void;
}) {
  const state = stateOf(row);
  const sizes = exportSizeLine(row.fileCount, row.bytes);
  return (
    <li data-testid="data-export-row" data-job-id={row.jobId} className="rounded border border-slate-700/60 bg-slate-900/40 p-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-300">
        <span data-testid="data-export-row-time">
          <span className="block text-white">{formatUtc(row.createdAt)}</span>
          <span className="block text-xs text-slate-400">{ageLine(row.createdAt)}</span>
        </span>
        <span data-testid="data-export-row-who" className="text-slate-400">
          {whoLine(row)}
        </span>
        <StatusChip tone={state.tone} testId="data-export-row-state">
          {state.word}
        </StatusChip>
        {sizes && (
          <span data-testid="data-export-row-size" className="text-xs text-slate-400 tabular-nums">
            {sizes}
          </span>
        )}
        {canDownload && row.isDownloadable && (
          <button
            type="button"
            data-testid="data-export-download"
            onClick={(event) => onDownload(row, event.currentTarget)}
            className={`ml-auto ${ADMIN_BUTTON}`}
          >
            {DATA_EXPORT_COPY.downloadButton}
          </button>
        )}
      </div>
      {row.requestedByKind === 'owner' && (row.status === 'ready' || row.status === 'expired') && (
        <p data-testid="data-export-row-owner-download" className="mt-1 text-xs text-slate-400">
          {row.ownerDownloadedAt ? `Downloaded by the owner ${formatUtc(row.ownerDownloadedAt)}` : 'Not downloaded by the owner'}
        </p>
      )}
    </li>
  );
}

interface Props {
  /** The account the drawer is open on. */
  accountId: string;
}

export function DataExportBlock({ accountId }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const { remember, onCloseAutoFocus } = useReturnFocus(rootRef);
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  // BC-1: the reason of the prepare made in this drawer, for that export's download.
  const [lastPrepare, setLastPrepare] = useState<{ jobId: string | null; reason: string } | null>(null);
  // One request at a time, also across a re-render (a ref, not only state).
  const inFlight = useRef(false);

  const baseUrl = `/api/admin/users/${encodeURIComponent(accountId)}/data-exports`;

  useEffect(() => {
    let cancelled = false;
    setLoad({ state: 'loading' });
    (async () => {
      try {
        const response = await fetch(baseUrl, { cache: 'no-store' });
        const result = await readAdminResponse<AdminDataExportStatus>(response, { what: 'the exports' });
        if (cancelled) return;
        if (result.ok && result.data && Array.isArray(result.data.exports)) setLoad({ state: 'ok', data: result.data });
        else setLoad({ state: 'error' });
      } catch (err) {
        if (cancelled) return;
        logger.warn({ err: err instanceof Error ? err.name : 'unknown' }, 'Admin data export status could not be read');
        setLoad({ state: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [baseUrl, reloadToken]);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  function open(next: DialogState, opener: HTMLElement) {
    remember(opener);
    setDialogError(null);
    setNotice(null);
    setDialog(next);
  }

  function close() {
    if (inFlight.current) return;
    setDialog(null);
    setDialogError(null);
  }

  async function prepare(reason: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setIsBusy(true);
    setDialogError(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PREPARE_TIMEOUT_MS);
    try {
      const result = await postReason(baseUrl, reason, controller.signal);
      if (result.kind === 'ok') {
        const jobId = typeof result.data.jobId === 'string' ? result.data.jobId : null;
        const expiresAt = typeof result.data.expiresAt === 'string' ? result.data.expiresAt : null;
        setLastPrepare({ jobId, reason });
        setDialog(null);
        setNotice({ text: DATA_EXPORT_COPY.prepared(expiresAt), tone: 'done' });
        reload();
      } else if (result.kind === 'aborted') {
        setDialog(null);
        setNotice({ text: DATA_EXPORT_COPY.clientTimeout, tone: 'problem' });
      } else if (result.kind === 'network') {
        setDialogError(DATA_EXPORT_COPY.network);
      } else {
        setDialogError(dataExportRefusal(result.code, result.status, result.retryAt));
      }
    } finally {
      clearTimeout(timer);
      inFlight.current = false;
      setIsBusy(false);
    }
  }

  async function download(jobId: string, reason: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setIsBusy(true);
    setDialogError(null);
    try {
      const result = await postReason(`${baseUrl}/${encodeURIComponent(jobId)}/parts/1/download`, reason);
      if (result.kind === 'ok') {
        const url = typeof result.data.downloadUrl === 'string' ? result.data.downloadUrl : '';
        if (!isSafeDownloadUrl(url)) {
          // Never logged: the link carries a token (W10-5).
          logger.error({}, 'Admin data export: refused to open a download link that is not https');
          setDialogError(DATA_EXPORT_COPY.unsafeLink);
          return;
        }
        setDialog(null);
        setNotice({ text: DATA_EXPORT_COPY.downloadStarted, tone: 'done' });
        browserNavigation.assign(url);
      } else if (result.kind === 'network' || result.kind === 'aborted') {
        setDialogError(DATA_EXPORT_COPY.network);
      } else {
        setDialogError(dataExportRefusal(result.code, result.status, result.retryAt));
      }
    } finally {
      inFlight.current = false;
      setIsBusy(false);
    }
  }

  const data = load.state === 'ok' ? load.data : null;
  const canAct = data !== null && !data.isOwnAccount;
  const dialogMode: DataExportDialogMode | null = dialog?.mode ?? null;
  const initialReason =
    dialog?.mode === 'download' && lastPrepare && lastPrepare.jobId === dialog.jobId ? lastPrepare.reason : '';

  return (
    <DrawerBox section="export" title="Data export" testId="drawer-section-export">
      <div data-testid="data-export-block" ref={rootRef} className="space-y-2">
        {canAct && (
          <div data-testid="data-export-actions" className={MONEY_ACTION_BAR}>
            <button
              type="button"
              data-testid="data-export-prepare"
              onClick={(event) => open({ mode: 'prepare' }, event.currentTarget)}
              className={ADMIN_BUTTON}
            >
              {DATA_EXPORT_COPY.prepareButton}
            </button>
            <span className="text-xs text-slate-400">{DATA_EXPORT_COPY.limitNote(data.dailyLimit)}</span>
          </div>
        )}

        {notice && (
          <div
            data-testid="data-export-notice"
            data-tone={notice.tone}
            role="status"
            className={`flex items-start gap-2 rounded border p-2 text-sm ${
              notice.tone === 'done' ? 'border-slate-600 bg-slate-800/60 text-slate-200' : 'border-amber-500/40 bg-amber-500/10 text-amber-200'
            }`}
          >
            <p className="flex-1">{notice.text}</p>
            <button
              type="button"
              data-testid="data-export-notice-dismiss"
              aria-label={DATA_EXPORT_COPY.dismiss}
              onClick={() => setNotice(null)}
              className="rounded px-1 text-slate-300 hover:bg-slate-700/50"
            >
              ×
            </button>
          </div>
        )}

        {load.state === 'loading' && <p className="text-sm text-slate-400">{DATA_EXPORT_COPY.loading}</p>}

        {load.state === 'error' && (
          <div className="flex flex-wrap items-center gap-2">
            <p data-testid="data-export-error" className="text-sm text-rose-300">
              {DATA_EXPORT_COPY.readError}
            </p>
            <button type="button" data-testid="data-export-retry" onClick={reload} className={ADMIN_BUTTON}>
              {DATA_EXPORT_COPY.retry}
            </button>
          </div>
        )}

        {data && (
          <>
            {canAct && !data.ownerDownloadedLatest && (
              <p data-testid="data-export-owner-warning" className="flex items-start gap-2 text-sm text-rose-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
                <span>{DATA_EXPORT_COPY.ownerNotDownloaded}</span>
              </p>
            )}
            {data.isOwnAccount && (
              <p data-testid="data-export-own-account" className="text-sm text-slate-400">
                {DATA_EXPORT_COPY.ownAccount}
              </p>
            )}
            {data.exports.length === 0 ? (
              <p data-testid="data-export-empty" className="text-sm text-slate-400">
                {DATA_EXPORT_COPY.empty}
              </p>
            ) : (
              <ShowMoreList
                testId="data-export-more"
                listClassName="space-y-2"
                items={data.exports.map((row) => (
                  <ExportRow
                    key={row.jobId}
                    row={row}
                    canDownload={canAct}
                    onDownload={(chosen, opener) => open({ mode: 'download', jobId: chosen.jobId }, opener)}
                  />
                ))}
              />
            )}
          </>
        )}

        {dialog && dialogMode && (
          <DataExportReasonDialog
            mode={dialogMode}
            initialReason={initialReason}
            isBusy={isBusy}
            error={dialogError}
            onClose={close}
            onCloseAutoFocus={onCloseAutoFocus}
            onSend={(reason) => {
              if (dialog.mode === 'prepare') void prepare(reason);
              else void download(dialog.jobId, reason);
            }}
          />
        )}
      </div>
    </DrawerBox>
  );
}
