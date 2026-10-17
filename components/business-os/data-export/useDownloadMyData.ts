'use client';

/**
 * The state machine of the one "Download my data" control (data export DE-9,
 * workplan §3.3 / §4; SA DE-9 Q4, C-5, C-9).
 *
 *   idle → preparing → (saved, notice `started`) | (refused, notice per code)
 *
 * In parallel it holds `lastExport` from GET /api/business-os/data-exports,
 * loaded on mount and reloaded after every outcome, so "Download again"
 * appears or disappears as the server now says.
 *
 * - Double click: a ref, checked synchronously, guards both actions. React
 *   state alone is not enough: two clicks inside one render both see `idle`.
 * - Unmount while preparing (the Danger zone dialog closed): the request is
 *   NOT aborted (SA Q4). The server keeps building and records the export as
 *   handed over, so on 200 the file is still saved; only setState is skipped.
 * - Notices never auto-dismiss (C-9): one stays until dismissed or replaced by
 *   the next action, so a retry time or the support address stays readable.
 * - The job id for "Download again" comes only from our own status route (or
 *   the sign-failed refusal), never from the URL or user input.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  downloadDataExportAgain,
  fetchLastDataExport,
  saveSignedDownload,
  startDataExport,
  type DataExportVerdict,
  type LastDataExport,
} from '@/lib/client/businessOsDataExport';
import type { DownloadMyDataCopyKey } from '@/components/business-os/data-export/downloadMyDataCopy';

/** After a client timeout, look once more for the export the server may have finished. */
export const CLIENT_TIMEOUT_STATUS_RELOAD_MS = 30_000;

export type DataExportNoticeTone = 'success' | 'error' | 'info';

export interface DownloadMyDataNotice {
  tone: DataExportNoticeTone;
  key: DownloadMyDataCopyKey;
  /** ISO time for `{until}` (started) or `{time}` (dailyLimit); formatted at render. */
  at?: string;
  /** `started` with missing sections or files: the `partial` sentence follows. */
  partial?: boolean;
}

export interface DownloadMyDataState {
  isPreparing: boolean;
  notice: DownloadMyDataNotice | null;
  /** undefined = not known (loading or unavailable): no status line. null = never exported. */
  lastExport: LastDataExport | null | undefined;
  /**
   * A "Download again" the status line does not already show: the export whose
   * link could not be made (C-1 of DE-8b), when the status read is unavailable.
   */
  hasSignFailedFallback: boolean;
  prepare: () => void;
  downloadAgain: () => void;
  dismiss: () => void;
}

/** One verdict → the notice the owner reads (workplan §4). */
function noticeFor(verdict: DataExportVerdict, action: 'start' | 'again'): DownloadMyDataNotice {
  if (verdict.kind === 'ready') return { tone: 'success', key: 'started', at: verdict.expiresAt, partial: verdict.partial };
  switch (verdict.code) {
    case 'in_progress':
      return { tone: 'info', key: 'inProgress' };
    case 'daily_limit':
      return verdict.retryAt ? { tone: 'info', key: 'dailyLimit', at: verdict.retryAt } : { tone: 'info', key: 'inProgress' };
    case 'too_large':
      return { tone: 'error', key: 'tooLarge' };
    case 'timeout':
      return { tone: 'error', key: 'timeout' };
    case 'client_timeout':
      return { tone: 'info', key: 'clientTimeout' };
    case 'ready_sign_failed':
      return { tone: 'error', key: 'signFailed' };
    case 'expired':
    case 'not_found':
      return action === 'again' ? { tone: 'info', key: 'expired' } : { tone: 'error', key: 'failed' };
    case 'throttled':
      return { tone: 'error', key: 'throttled' };
    case 'unauthorized':
      return { tone: 'error', key: 'unauthorized' };
    case 'network':
      return { tone: 'error', key: 'network' };
    case 'failed':
    default:
      return { tone: 'error', key: 'failed' };
  }
}

/** Outcomes after which the status line may have changed. */
function reloadsStatus(verdict: DataExportVerdict): boolean {
  if (verdict.kind === 'ready') return true;
  return ['in_progress', 'daily_limit', 'ready_sign_failed', 'client_timeout', 'expired', 'not_found'].includes(verdict.code);
}

export function useDownloadMyData(): DownloadMyDataState {
  const [isPreparing, setIsPreparing] = useState(false);
  const [notice, setNotice] = useState<DownloadMyDataNotice | null>(null);
  const [lastExport, setLastExport] = useState<LastDataExport | null | undefined>(undefined);
  const [signFailedJobId, setSignFailedJobId] = useState<string | null>(null);

  const isInFlight = useRef(false);
  const isMounted = useRef(false);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadStatus = useCallback(async () => {
    const verdict = await fetchLastDataExport();
    if (!isMounted.current) return;
    // Unavailable shows no line at all (the helper already logged a warn).
    setLastExport(verdict.kind === 'ok' ? verdict.lastExport : undefined);
    if (verdict.kind === 'ok') setSignFailedJobId(null);
  }, []);

  useEffect(() => {
    isMounted.current = true;
    void loadStatus();
    return () => {
      isMounted.current = false;
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
      reloadTimer.current = null;
    };
  }, [loadStatus]);

  const settle = useCallback(
    (verdict: DataExportVerdict, action: 'start' | 'again') => {
      // SA Q4: the owner asked for the file, so it is saved even after unmount.
      let final = verdict;
      if (verdict.kind === 'ready' && !saveSignedDownload(verdict)) final = { kind: 'refused', code: 'failed' };

      if (!isMounted.current) return;
      setIsPreparing(false);
      setNotice(noticeFor(final, action));
      if (final.kind === 'refused' && final.code === 'ready_sign_failed' && final.jobId) setSignFailedJobId(final.jobId);
      if (reloadsStatus(final)) void loadStatus();
      if (final.kind === 'refused' && final.code === 'client_timeout') {
        if (reloadTimer.current) clearTimeout(reloadTimer.current);
        reloadTimer.current = setTimeout(() => {
          reloadTimer.current = null;
          void loadStatus();
        }, CLIENT_TIMEOUT_STATUS_RELOAD_MS);
      }
    },
    [loadStatus]
  );

  const run = useCallback(
    (action: 'start' | 'again', call: () => Promise<DataExportVerdict>) => {
      if (isInFlight.current) return;
      isInFlight.current = true;
      setIsPreparing(true);
      setNotice(null);
      call()
        .then((verdict) => settle(verdict, action))
        // The helpers never reject; if one ever does, the owner still reads a failure, never a success.
        .catch(() => settle({ kind: 'refused', code: 'failed' }, action))
        .finally(() => {
          isInFlight.current = false;
        });
    },
    [settle]
  );

  const prepare = useCallback(() => run('start', startDataExport), [run]);

  const downloadAgainJobId = lastExport?.downloadable?.jobId ?? signFailedJobId;
  const downloadAgain = useCallback(() => {
    if (!downloadAgainJobId) return;
    run('again', () => downloadDataExportAgain(downloadAgainJobId));
  }, [downloadAgainJobId, run]);

  const dismiss = useCallback(() => setNotice(null), []);

  const hasSignFailedFallback = !lastExport?.downloadable && signFailedJobId !== null;

  return { isPreparing, notice, lastExport, hasSignFailedFallback, prepare, downloadAgain, dismiss };
}
