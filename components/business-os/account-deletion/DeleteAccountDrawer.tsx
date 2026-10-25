'use client';

/**
 * The self-delete steps (data export DE-10b.2; requirement §3.1; workplan
 * §2.7; SA workplan review V-4, V-8).
 *
 * Rendered INSIDE the Danger Zone surface that is already open: the settings
 * dialog on `/business-os/settings`, the expanded panel on `/v2/settings` and
 * `/settings`. It never opens a second dialog on top (V-8), so focus and
 * Escape stay with the one dialog that owns them.
 *
 * In order: the warning (it NAMES Settings → Download my data; there is no
 * download button and no export control here), what happens next, then either
 * the blockers with no statement box, or the statement and its box with the
 * Delete button disabled until the typed text matches a statement in any
 * supported language. Pasting is allowed.
 *
 * On success: a local sign-out (the sessions are already gone on the server,
 * which also expired the cookies), then `location.replace` to the redirect
 * the server sent, accepted only when it is the account-deleted page (V-4).
 *
 * The support address appears only in the blocker, not-available and failure
 * lines (§F: "mailto removed except for blockers").
 *
 * @module components/business-os/account-deletion/DeleteAccountDrawer
 */

import React, { useId, useState } from 'react';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
// TEMP-ERASURE-CONTACT: the one definition is in lib/business-os/supportContact.ts.
import { PLACEHOLDER_ERASURE_CONTACT } from '@/lib/business-os/supportContact';
import { DELETION_STATEMENTS, isStatementLanguage, matchStatement } from '@/lib/business-os/account-deletion/acknowledgement';
import { BLOCKER_CODES, type BlockerCode, type BlockerView } from '@/lib/business-os/account-deletion/blockerCopy';
import { ACCOUNT_DELETED_PATH, isAccountDeletedRedirect } from '@/lib/business-os/account-deletion/schemas';
import type { EnabledDeletionCheck } from '@/hooks/useAccountDeletionCheck';
import { signOutUser } from '@/lib/client/auth-actions';

export const ACCOUNT_DELETE_URL = '/api/business-os/account/delete';

export type CopyFn = (key: string, vars?: Record<string, string | number>) => string;

export interface DeleteAccountDrawerProps {
  check: EnabledDeletionCheck;
  tr: CopyFn;
  /** The UI language. The statement shown follows it; any language's statement is accepted. */
  language: string;
  isRTL: boolean;
  /** Where the browser goes after a delete. `location.replace` (no Back into the app); injectable for tests. */
  navigate?: (url: string) => void;
}

const replaceLocation = (url: string): void => window.location.replace(url);

type Failure = 'mismatch' | 'too_many' | 'failed' | 'files_removed_kept' | 'not_available' | null;

/** Render a copy line, turning `{support}` into the one support mailto. */
function WithSupport({ text }: { text: string }) {
  const parts = text.split('{support}');
  return (
    <>
      {parts.map((part, index) => (
        <React.Fragment key={index}>
          {part}
          {index < parts.length - 1 && (
            <a href={`mailto:${PLACEHOLDER_ERASURE_CONTACT}`} className="underline font-medium" dir="ltr">
              {PLACEHOLDER_ERASURE_CONTACT}
            </a>
          )}
        </React.Fragment>
      ))}
    </>
  );
}

/** `tr` with `{support}` left in place for `WithSupport`. */
const line = (tr: CopyFn, key: string, vars?: Record<string, string | number>) => tr(key, { support: '{support}', ...vars });

const isBlockerCode = (value: unknown): value is BlockerCode =>
  typeof value === 'string' && (BLOCKER_CODES as readonly string[]).includes(value);

/**
 * The server's blockers. An unknown code reads "contact us", and an empty or
 * unreadable list falls back to the same (SA N-1): a refusal always says something.
 */
export function parseBlockers(value: unknown): BlockerView[] {
  const out: BlockerView[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const { code, count } = item as { code?: unknown; count?: unknown };
      const known = isBlockerCode(code) ? code : 'contact_support';
      if (out.some((blocker) => blocker.code === known)) continue;
      out.push(typeof count === 'number' && Number.isFinite(count) && count > 0 ? { code: known, count } : { code: known });
    }
  }
  return out.length > 0 ? out : [{ code: 'contact_support' }];
}

/** SA N-3: a counted blocker without a number uses its uncounted copy, never an empty "{n}". */
const COUNTED_CODES: ReadonlySet<BlockerCode> = new Set(['client_plans_running', 'client_payments_pending']);
export function blockerCopyKey(blocker: BlockerView): string {
  const base = `settings.account_delete.blocker.${blocker.code}`;
  return COUNTED_CODES.has(blocker.code) && blocker.count === undefined ? `${base}_uncounted` : base;
}

export function DeleteAccountDrawer({ check, tr, language, isRTL, navigate = replaceLocation }: DeleteAccountDrawerProps) {
  const inputId = useId();
  const errorId = useId();
  const statementLanguage = isStatementLanguage(language) ? language : 'en';
  const statement = DELETION_STATEMENTS[statementLanguage];

  const [typed, setTyped] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);
  const [serverBlockers, setServerBlockers] = useState<BlockerView[] | null>(null);

  const blockers = serverBlockers ?? check.blockers;
  const isMatched = matchStatement(typed) !== null;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isMatched || isDeleting) return;
    setIsDeleting(true);
    setFailure(null);
    try {
      const response = await fetch(ACCOUNT_DELETE_URL, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statement: typed, language: statementLanguage }),
      });
      const body: unknown = await response.json().catch(() => null);
      const payload = (body && typeof body === 'object' ? body : {}) as {
        data?: { redirect?: unknown };
        error?: unknown;
        blockers?: unknown;
        filesRemoved?: unknown;
      };

      if (response.ok) {
        // The sessions are gone on the server; this clears the browser's copy (V-4).
        await signOutUser({ scope: 'local', method: 'account_deleted' });
        const redirect = payload.data?.redirect;
        navigate(isAccountDeletedRedirect(redirect) ? redirect : ACCOUNT_DELETED_PATH);
        return;
      }

      if (response.status === 409) {
        if (payload.filesRemoved === true) setFailure('files_removed_kept');
        setServerBlockers(parseBlockers(payload.blockers));
      } else if (response.status === 400 && payload.error === 'statement_mismatch') {
        setFailure('mismatch');
      } else if (response.status === 429) {
        setFailure('too_many');
      } else if (response.status === 503) {
        setFailure(payload.filesRemoved === true ? 'files_removed_kept' : 'not_available');
      } else {
        setFailure(payload.filesRemoved === true ? 'files_removed_kept' : 'failed');
      }
    } catch {
      setFailure('failed');
    }
    setIsDeleting(false);
  }

  const failureText: Record<Exclude<Failure, null>, string> = {
    mismatch: line(tr, 'settings.account_delete.mismatch'),
    too_many: line(tr, 'settings.account_delete.too_many'),
    failed: line(tr, 'settings.account_delete.delete_failed'),
    files_removed_kept: line(tr, 'settings.account_delete.files_removed_kept'),
    not_available: line(tr, 'settings.account_delete.not_available'),
  };

  return (
    <div className="space-y-3" dir={isRTL ? 'rtl' : 'ltr'} data-testid="delete-account-drawer">
      <div
        className="flex gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
        style={{ borderRadius: 'var(--v2-radius-button)' }}
      >
        <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
        <p className="text-xs text-red-700 dark:text-red-300">{tr('settings.account_delete.warning')}</p>
      </div>

      {!check.available ? (
        <p className="text-xs text-[var(--v2-text-secondary)]" role="status">
          <WithSupport text={line(tr, 'settings.account_delete.not_available')} />
        </p>
      ) : (
        <>
          <div className="space-y-1">
            <p className="text-xs font-medium text-[var(--v2-text-primary)]">{tr('settings.account_delete.what_next')}</p>
            {check.willKeepBilling && <p className="text-xs text-[var(--v2-text-secondary)]">{tr('settings.account_delete.billing_kept')}</p>}
            <p className="text-xs text-[var(--v2-text-secondary)]">{tr('settings.account_delete.what_we_keep')}</p>
          </div>

          {blockers.length > 0 ? (
            <div className="space-y-2" data-testid="delete-account-blockers">
              <p className="text-xs font-semibold text-[var(--v2-text-primary)]">{tr('settings.account_delete.blockers_title')}</p>
              <ul className="list-disc ps-5 space-y-1">
                {blockers.map((blocker) => (
                  <li key={blocker.code} className="text-xs text-[var(--v2-text-secondary)]">
                    <WithSupport text={line(tr, blockerCopyKey(blocker), blocker.count === undefined ? undefined : { n: blocker.count })} />
                  </li>
                ))}
              </ul>
              {failure === 'files_removed_kept' && (
                <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                  <WithSupport text={failureText.files_removed_kept} />
                </p>
              )}
            </div>
          ) : (
            <form className="space-y-2" onSubmit={onSubmit} noValidate>
              <p className="text-xs text-[var(--v2-text-secondary)]">{tr('settings.account_delete.statement_intro')}</p>
              <p
                className="text-sm font-medium text-[var(--v2-text-primary)] p-2 border border-[var(--v2-border)] select-all"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
                dir={statementLanguage === 'he' ? 'rtl' : 'ltr'}
                lang={statementLanguage}
                data-testid="delete-account-statement"
              >
                {statement}
              </p>
              <label htmlFor={inputId} className="block text-xs font-medium text-[var(--v2-text-primary)]">
                {tr('settings.account_delete.statement_label')}
              </label>
              <textarea
                id={inputId}
                value={typed}
                onChange={(event) => {
                  setTyped(event.target.value);
                  if (failure === 'mismatch') setFailure(null);
                }}
                onKeyDown={(event) => {
                  // Enter submits, as in a one-line field; Shift+Enter is not needed for a one-line statement.
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                rows={2}
                maxLength={500}
                dir={statementLanguage === 'he' ? 'rtl' : 'ltr'}
                lang={statementLanguage}
                autoComplete="off"
                spellCheck={false}
                disabled={isDeleting}
                aria-invalid={failure === 'mismatch'}
                aria-describedby={failure ? errorId : undefined}
                className="w-full px-3 py-2 text-sm border border-[var(--v2-border)] bg-[var(--v2-surface)] text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              />
              {failure && (
                <p id={errorId} role="alert" className="text-xs text-red-600 dark:text-red-400">
                  <WithSupport text={failureText[failure]} />
                </p>
              )}
              <button
                type="submit"
                disabled={!isMatched || isDeleting}
                aria-busy={isDeleting}
                className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Trash2 className="w-4 h-4" aria-hidden="true" />}
                {isDeleting ? tr('settings.account_delete.deleting') : tr('settings.account_delete.delete_button')}
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}

export default DeleteAccountDrawer;
