'use client';

/**
 * DownloadMyDataButton: the ONE "Download my data" control (data export DE-9,
 * workplan §3.4 / §3.7; SA DE-9 Q1, C-8, C-9; DX-5).
 *
 * Every entry point renders this and nothing else for the export:
 *
 *   - app/business-os/settings/page.tsx        variant="row"    (Security list)
 *   - components/business-os/purge/DangerZonePanel.tsx  variant="button" (Danger zone)
 *   - components/settings/SecurityTab.tsx      variant="button" (/settings)
 *   - components/v2/settings/SecurityTabV2.tsx variant="button" (/v2/settings)
 *
 * It calls the zip routes through `lib/client/businessOsDataExport.ts` (the
 * one browser seam) and shows every outcome in the one notice style (UI-1,
 * option A), always in the same order under the action: the status line
 * ("Last export … Download again"), then the notice.
 *
 * Copy is `downloadMyDataCopy.ts`, never the server's `error` string. It works
 * outside a LanguageProvider (/v2, /settings) because the locale defaults to
 * `en` and the clock to UTC, which the C-1 formatter labels.
 */

import React from 'react';
import { ChevronRight, Download, Loader2 } from 'lucide-react';
import { useBusinessTimezone, useOptionalLanguage } from '@/lib/business-os/LanguageContext';
import { EXPORT_JOB_POLICY } from '@/lib/business-os/data-export/jobPolicy';
import { cn } from '@/lib/utils';
import { PLACEHOLDER_ERASURE_CONTACT } from '@/lib/business-os/supportContact';
import { DataExportNotice } from '@/components/business-os/data-export/DataExportNotice';
import { downloadMyDataCopy, fillCopy, type DownloadMyDataCopy } from '@/components/business-os/data-export/downloadMyDataCopy';
import { formatExportTime } from '@/components/business-os/data-export/formatExportTime';
import { useDownloadMyData, type DownloadMyDataNotice } from '@/components/business-os/data-export/useDownloadMyData';

export interface DownloadMyDataButtonProps {
  /** `row`: a settings-list row (Business OS Security list). `button`: a bordered button. */
  variant: 'row' | 'button';
  className?: string;
}

/** The `tooLarge` sentence with `{email}` as a mailto link; `<bdi>` keeps the address whole in Hebrew. */
function TooLargeText({ template }: { template: string }) {
  const [before, after = ''] = template.split('{email}');
  return (
    <p>
      {before}
      <a href={`mailto:${PLACEHOLDER_ERASURE_CONTACT}`} className="underline">
        <bdi dir="ltr">{PLACEHOLDER_ERASURE_CONTACT}</bdi>
      </a>
      {after}
    </p>
  );
}

function NoticeText({ notice, copy, format }: { notice: DownloadMyDataNotice; copy: DownloadMyDataCopy; format: (iso: string) => string }) {
  if (notice.key === 'tooLarge') return <TooLargeText template={copy.tooLarge} />;
  if (notice.key === 'started') {
    return (
      <>
        <p>{fillCopy(copy.started, { until: notice.at ? format(notice.at) : '' })}</p>
        {notice.partial && <p>{copy.partial}</p>}
      </>
    );
  }
  if (notice.key === 'dailyLimit') {
    return <p>{fillCopy(copy.dailyLimit, { limit: EXPORT_JOB_POLICY.DAILY_LIMIT, time: notice.at ? format(notice.at) : '' })}</p>;
  }
  return <p>{copy[notice.key]}</p>;
}

export function DownloadMyDataButton({ variant, className = '' }: DownloadMyDataButtonProps) {
  const languageContext = useOptionalLanguage();
  const language = languageContext?.language ?? 'en';
  const isRTL = languageContext?.isRTL ?? false;
  const { timeZoneOptions } = useBusinessTimezone();
  const copy = downloadMyDataCopy(language);
  const format = (iso: string) => formatExportTime(iso, language, timeZoneOptions);
  const { isPreparing, notice, lastExport, hasSignFailedFallback, prepare, downloadAgain, dismiss } = useDownloadMyData();

  const isError = notice?.tone === 'error';
  const noticeAction =
    notice?.key === 'signFailed' && hasSignFailedFallback
      ? { label: copy.downloadAgain, onClick: downloadAgain, disabled: isPreparing }
      : undefined;

  const renderedNotice = notice ? (
    <DataExportNotice tone={notice.tone} action={noticeAction} onDismiss={dismiss} dismissLabel={copy.dismiss}>
      <NoticeText notice={notice} copy={copy} format={format} />
    </DataExportNotice>
  ) : null;

  const icon = isPreparing ? (
    <Loader2 className={variant === 'row' ? 'w-4 h-4 animate-spin' : 'w-3.5 h-3.5 animate-spin'} aria-hidden="true" />
  ) : null;

  const action =
    variant === 'row' ? (
      <button
        type="button"
        onClick={prepare}
        disabled={isPreparing}
        aria-busy={isPreparing}
        className="w-full flex items-center justify-between p-4 hover:bg-[var(--v2-bg)] transition-colors disabled:opacity-50"
      >
        <span className="flex items-center gap-3">
          <Download className="w-5 h-5 text-[var(--v2-text-muted)]" aria-hidden="true" />
          <span className="text-sm text-[var(--v2-text-primary)]">{copy.label}</span>
        </span>
        {icon ?? <ChevronRight className={cn('w-4 h-4 text-[var(--v2-text-muted)]', isRTL && 'scale-x-[-1]')} aria-hidden="true" />}
      </button>
    ) : (
      <button
        type="button"
        onClick={prepare}
        disabled={isPreparing}
        aria-busy={isPreparing}
        className="inline-flex items-center gap-2 px-3 py-2 border border-[var(--v2-border)] text-xs font-medium text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface-hover)] disabled:opacity-60"
        style={{ borderRadius: 'var(--v2-radius-button)' }}
      >
        {icon ?? <Download className="w-3.5 h-3.5" aria-hidden="true" />}
        {copy.label}
      </button>
    );

  const statusLine = lastExport ? (
    <p className="text-xs text-[var(--v2-text-muted)]" data-testid="download-my-data-status">
      {lastExport.downloadable
        ? fillCopy(copy.lastExport, { date: format(lastExport.createdAt), until: format(lastExport.downloadable.expiresAt) })
        : fillCopy(copy.lastExportExpired, { date: format(lastExport.createdAt) })}
      {lastExport.downloadable && (
        <>
          {' '}
          <button
            type="button"
            onClick={downloadAgain}
            disabled={isPreparing}
            className="underline font-medium text-[var(--v2-primary)] disabled:opacity-60"
          >
            {copy.downloadAgain}
          </button>
        </>
      )}
    </p>
  ) : null;

  // C-8: one block, stacked: the action, then the status line, then the notice.
  const hasContentBelow = Boolean(statusLine) || isPreparing || notice !== null;
  const below = variant === 'row' ? `px-4 space-y-2${hasContentBelow ? ' pb-3' : ''}` : 'space-y-2';
  return (
    <div className={`${variant === 'row' ? '' : 'space-y-2'} ${className}`.trim()} data-download-my-data={variant}>
      {action}
      <div className={below}>
        {statusLine}
        {/* C-9: both live regions exist from the first paint; text goes into exactly one. */}
        <div role="status" aria-live="polite">
          {isPreparing ? (
            <DataExportNotice tone="info">
              <p>{copy.preparing}</p>
            </DataExportNotice>
          ) : (
            !isError && renderedNotice
          )}
        </div>
        <div role="alert">{!isPreparing && isError ? renderedNotice : null}</div>
      </div>
    </div>
  );
}

export default DownloadMyDataButton;
