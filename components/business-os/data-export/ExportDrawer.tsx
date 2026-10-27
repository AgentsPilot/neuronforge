'use client';

/**
 * The export drawer (export redesign MX-1b, workplan §10; requirement §3;
 * BQ-35, BQ-E5-1, BQ-E5-3 answered by the user; SA MX1B-2, C-6, C-8, C-11).
 *
 * ── SHELL (SA MX1B-2) ────────────────────────────────────────────────────────
 * `SettingsDrawer`, by the SA ruling "SettingsDrawer may be used by
 * ExportDrawer only" (a named exception, not a general opening of the settings
 * folder). Props only; no `isDirty` / `discardCopy` (nothing to discard). Its
 * file is not edited (C-11). While a request is in flight it is `isBusy`, so
 * Escape, an outside press and the X are refused (C-6).
 *
 * ── STACKING (SR-9) ──────────────────────────────────────────────────────────
 * Rendered inside the entry button's React tree. Inside the Danger Zone dialog
 * (and DL-2's deletion drawer) that makes it a nested Radix layer: Escape and
 * outside presses go to this drawer only, and a press inside it does not
 * dismiss the outer dialog. Focus returns to the trigger on close.
 *
 * ── WHAT IT SHOWS ────────────────────────────────────────────────────────────
 * The intro, the files sentence (final, BQ-35), "Select all" and one tick box
 * per offered module (nothing ticked on open, BQ-E5-3), Export, the inline
 * refusals, and the export history. After a started request the confirmation
 * is the app's pop-up (sonner, BQ-E5-3) and the history shows the new request.
 *
 * The history list follows the invites and boost purchases lists (BQ-E5-1):
 * divided rows, a status chip on the right, a muted line of dates under it, a
 * plain empty line, and a failed read as a line with Try again. A request an
 * admin sent carries the "Sent by AgentPilot support" tag (none before MX-5).
 *
 * Every date is the owner's clock (`formatExportTime` with
 * `useBusinessTimezone`, UTC labelled outside a provider; C-8), wrapped in
 * `<bdi>` with the email address, so Hebrew keeps them whole.
 */

import React, { useCallback, useId, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { SettingsDrawer } from '@/components/business-os/settings/SettingsDrawer';
import { Checkbox } from '@/components/ui/checkbox';
import { useBusinessTimezone, useOptionalLanguage } from '@/lib/business-os/LanguageContext';
import { enabledModules, type ExportModuleLanguage } from '@/lib/business-os/data-export/exportModules';
import type { ExportHistoryRequest } from '@/lib/client/businessOsDataExport';
import { formatExportTime } from '@/components/business-os/data-export/formatExportTime';
import { exportDrawerCopy, fillDrawerCopy, type ExportDrawerCopy } from '@/components/business-os/data-export/exportDrawerCopy';
import { useExportDrawer, type ExportDrawerRefusal } from '@/components/business-os/data-export/useExportDrawer';
import { cn } from '@/lib/utils';

export interface ExportDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The first history page from the switch probe; `null` when it could not be read. */
  initialHistory: ExportHistoryRequest[] | null;
  /** The trigger: focus goes back to it on close. */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}

// The shared checkbox hard-codes blue / gray; V2 tokens through className (SA suggestion), no edit to the primitive.
const CHECKBOX_CLASS =
  'border-[var(--v2-border)] data-[state=checked]:bg-[var(--v2-primary)] data-[state=checked]:border-[var(--v2-primary)] focus-visible:ring-[var(--v2-primary)]';

function refusalText(refusal: ExportDrawerRefusal, copy: ExportDrawerCopy, format: (iso: string) => string): React.ReactNode {
  switch (refusal.code) {
    case 'daily_limit': {
      const [before, after = ''] = copy.dailyLimit.split('{time}');
      return (
        <>
          {before}
          <bdi>{refusal.retryAt ? format(refusal.retryAt) : ''}</bdi>
          {after}
        </>
      );
    }
    case 'in_progress':
      return copy.inProgress;
    case 'no_login_email':
      return copy.noLoginEmail;
    case 'throttled':
      return copy.throttled;
    case 'unauthorized':
      return copy.unauthorized;
    case 'network':
      return copy.network;
    case 'invalid':
      return copy.invalid;
    case 'off':
      return copy.off;
    case 'failed':
    default:
      return copy.failed;
  }
}

/** Unicode first-strong isolate and pop directional isolate, for plain-text strings (the toast). */
const FSI = '⁨';
const PDI = '⁩';

/** A sentence with one `{email}` hole, the address kept whole and left to right in `<bdi>`. */
function WithEmail({ template, email }: { template: string; email: string }) {
  const [before, after = ''] = template.split('{email}');
  return (
    <>
      {before}
      <bdi dir="ltr">{email}</bdi>
      {after}
    </>
  );
}

/** A sentence with one `{date}` hole, the date kept whole in `<bdi>`. */
function WithDate({ template, date }: { template: string; date: string }) {
  const [before, after = ''] = template.split('{date}');
  return (
    <>
      {before}
      <bdi>{date}</bdi>
      {after}
    </>
  );
}

export function ExportDrawer({ open, onOpenChange, initialHistory, returnFocusRef }: ExportDrawerProps) {
  const languageContext = useOptionalLanguage();
  const language = (languageContext?.language ?? 'en') as ExportModuleLanguage;
  const isRTL = languageContext?.isRTL ?? false;
  const { timeZoneOptions } = useBusinessTimezone();
  const copy = exportDrawerCopy(language);
  const format = useCallback((iso: string) => formatExportTime(iso, language, timeZoneOptions), [language, timeZoneOptions]);

  const modules = useMemo(() => enabledModules(), []);
  const moduleIds = useMemo(() => modules.map((m) => m.id), [modules]);
  const nameOf = useCallback(
    (id: string) => modules.find((m) => m.id === id)?.name[language] ?? id,
    [language, modules]
  );

  const onStarted = useCallback(
    ({ sentTo }: { sentTo: string }) => {
      // BQ-E5-3: the confirmation is the app's pop-up (sonner's Toaster lives in PlatformShell).
      // SA CR-3: the address is isolated (U+2068 FSI … U+2069 PDI) so it stays whole in Hebrew.
      // The toast is painted but not announced while this modal drawer hides the app root
      // (SA CR-1), so the same sentence also goes into the drawer's own status region below.
      toast.success(fillDrawerCopy(copy.startedToast, { email: `${FSI}${sentTo}${PDI}` }));
    },
    [copy.startedToast]
  );

  const drawer = useExportDrawer({ open, moduleIds, initialHistory, onStarted });
  const idBase = useId();
  const selectAllId = `${idBase}-all`;
  const historyTitleId = `${idBase}-history`;

  return (
    <SettingsDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={copy.title}
      isBusy={drawer.isBusy}
      isRTL={isRTL}
      closeLabel={copy.close}
      returnFocusRef={returnFocusRef}
      testId="export-drawer"
    >
      <div className="space-y-4 text-sm text-[var(--v2-text-primary)]" dir={isRTL ? 'rtl' : 'ltr'}>
        <p className="text-start">{copy.intro}</p>
        <p data-testid="export-drawer-files" className="text-start text-xs text-[var(--v2-text-muted)]">
          {copy.filesNotIncluded}
        </p>

        <fieldset className="space-y-2" disabled={drawer.isBusy}>
          <legend className="sr-only">{copy.modulesLegend}</legend>
          <div className="flex items-center gap-3 border-b border-[var(--v2-border)] pb-2">
            <Checkbox
              id={selectAllId}
              data-testid="export-select-all"
              checked={drawer.isAllSelected}
              onCheckedChange={() => drawer.toggleAll()}
              className={CHECKBOX_CLASS}
            />
            <label htmlFor={selectAllId} className="cursor-pointer font-medium">
              {copy.selectAll}
            </label>
          </div>
          <ul className="space-y-2" data-testid="export-modules">
            {modules.map((module) => {
              const id = `${idBase}-${module.id}`;
              return (
                <li key={module.id} className="flex items-center gap-3">
                  <Checkbox
                    id={id}
                    data-testid={`export-module-${module.id}`}
                    checked={drawer.selected.has(module.id)}
                    onCheckedChange={() => drawer.toggle(module.id)}
                    className={CHECKBOX_CLASS}
                  />
                  <label htmlFor={id} className="cursor-pointer">
                    {module.name[language]}
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>

        <div>
          <button
            type="button"
            data-testid="export-submit"
            onClick={drawer.submit}
            disabled={drawer.isExportDisabled}
            aria-busy={drawer.isBusy}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[var(--v2-primary)] disabled:opacity-50"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            {drawer.isBusy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
            {drawer.isBusy ? copy.exporting : copy.export}
          </button>
        </div>

        {/* Both live regions exist from the first paint; text goes into exactly one (DE-9 C-9 pattern). */}
        <div role="status" aria-live="polite" data-testid="export-status">
          {drawer.startedTo && (
            // SA CR-1: announced here, because the modal drawer hides the toast's live region.
            <p data-testid="export-started" className="text-xs text-[var(--v2-text-primary)]">
              <WithEmail template={copy.startedToast} email={drawer.startedTo} />
            </p>
          )}
          {drawer.isConfirmationMissing && <p className="text-xs text-[var(--v2-text-muted)]">{copy.confirmationNotSent}</p>}
        </div>
        <div role="alert" data-testid="export-alert">
          {drawer.refusal && <p className="text-xs text-[#F97316]">{refusalText(drawer.refusal, copy, format)}</p>}
        </div>

        <section aria-labelledby={historyTitleId} className="space-y-2 border-t border-[var(--v2-border)] pt-4" data-testid="export-history">
          <h3 id={historyTitleId} className="text-xs font-semibold uppercase text-[var(--v2-text-muted)]">
            {copy.historyTitle}
          </h3>
          {drawer.history.kind === 'error' ? (
            <div data-testid="export-history-error" className="space-y-1">
              <p className="text-xs text-[#F97316]">{copy.historyUnavailable}</p>
              <button type="button" onClick={drawer.reloadHistory} className="text-xs text-[var(--v2-primary)] hover:underline">
                {copy.tryAgain}
              </button>
            </div>
          ) : drawer.history.kind === 'loading' ? (
            <Loader2 className="w-4 h-4 animate-spin text-[var(--v2-text-muted)]" aria-hidden="true" />
          ) : drawer.history.requests.length === 0 ? (
            <p data-testid="export-history-empty" className="text-[var(--v2-text-secondary)]">
              {copy.historyEmpty}
            </p>
          ) : (
            <ul data-testid="export-history-list" className="divide-y divide-[var(--v2-border)]">
              {drawer.history.requests.map((request) => (
                <li key={request.requestId} data-testid={`export-history-request-${request.requestId}`} className="py-2 space-y-1">
                  <p className="flex flex-wrap items-center gap-2 text-xs text-[var(--v2-text-muted)]">
                    <span data-testid="export-history-requested">
                      <WithDate template={copy.requestedOn} date={format(request.requestedAt)} />
                    </span>
                    {request.origin === 'admin' && (
                      <span className="rounded border border-[var(--v2-border)] px-1.5 py-0.5 text-[10.5px] font-semibold">{copy.origin.admin}</span>
                    )}
                  </p>
                  <ul className="space-y-1">
                    {request.modules.map((line) => (
                      <li key={line.module} data-testid="export-history-line" data-status={line.status} className="space-y-0.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium">{nameOf(line.module)}</span>
                          <span
                            data-testid="export-history-status"
                            className={cn(
                              'rounded bg-[var(--v2-bg)] px-2 py-0.5 text-xs',
                              (line.status === 'failed' || line.status === 'interrupted') && 'text-[#F97316]',
                              line.status === 'sent' && 'text-[var(--v2-primary)]'
                            )}
                          >
                            {copy.status[line.status]}
                          </span>
                        </div>
                        {(line.sentAt || line.emailCount > 0) && (
                          <p className="text-xs text-[var(--v2-text-muted)]">
                            {line.sentAt && <WithDate template={copy.sentOn} date={format(line.sentAt)} />}
                            {line.sentAt && line.emailCount > 0 && ' · '}
                            {line.emailCount > 0 &&
                              fillDrawerCopy(line.emailCount === 1 ? copy.emailCountOne : copy.emailCountMany, { count: line.emailCount })}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </SettingsDrawer>
  );
}

export default ExportDrawer;
