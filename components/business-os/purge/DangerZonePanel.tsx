'use client';

/**
 * DangerZonePanel — the single Danger Zone affordance for account/business deletion.
 *
 * WHY ONE SHARED COMPONENT (N7)
 * -----------------------------
 * Four separate Danger Zones were each wired to `POST /api/user/delete-account`,
 * a route that deleted `auth.users` and — for every onboarded user — failed
 * partway through, leaving a half-destroyed account. That route is now a 410
 * tombstone (see `app/api/user/delete-account/route.ts`).
 *
 * Retiring the route made the duplication the problem: four copies meant four
 * places to forget, and the copy that mattered most (the erasure contact) would
 * have been duplicated four times. So all live surfaces render THIS component:
 *
 *   - app/business-os/settings/page.tsx   (inside LanguageProvider → localised)
 *   - components/v2/settings/SecurityTabV2.tsx (no provider → English fallback)
 *
 * C-21: after this wiring, no live surface POSTs to the tombstoned endpoint, so
 * the error-toast outcome C-21 exists to prevent cannot occur at any flag state.
 *
 * INTERIM BEHAVIOUR
 * -----------------
 * Until the Business OS purge flow is un-gated (D9,
 * `NEXT_PUBLIC_ENABLE_BUSINESS_DELETE`), this panel is non-destructive: it
 * offers the data export that already works and a request channel. The
 * affordance stays where customers look for it; only the copy changes. When the
 * flag goes on, the full flow (dry-run → pre-flight gate → typed confirmation →
 * commit) replaces the panel body — this component is where that lands, once.
 *
 * SELF-DELETE (data export DE-10b.2)
 * ----------------------------------
 * While `BUSINESS_OS_ACCOUNT_SELF_DELETE_ENABLED` is on (server-only), the
 * pre-check answers `enabled: true` and `ErasureRequestContent` renders the
 * self-delete steps (`DeleteAccountDrawer`) in place of today's body, inside
 * the same dialog or panel (SA V-8: no second dialog). Off, loading or a
 * failed check: today's body, unchanged.
 */

import React, { useEffect, useState } from 'react';
import { Trash2, Mail } from 'lucide-react';
import { useOptionalLanguage } from '@/lib/business-os/LanguageContext';
// TEMP-ERASURE-CONTACT: the one definition is in lib/business-os/supportContact.ts.
import { PLACEHOLDER_ERASURE_CONTACT } from '@/lib/business-os/supportContact';
import { DownloadMyDataButton } from '@/components/business-os/data-export/DownloadMyDataButton';
import { DeleteAccountDrawer } from '@/components/business-os/account-deletion/DeleteAccountDrawer';
import { useAccountDeletionCheck, type AccountDeletionCheckState } from '@/hooks/useAccountDeletionCheck';
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/**
 * English fallbacks for surfaces outside a `LanguageProvider` (i.e. `/v2/**`).
 *
 * Kept byte-identical to the `en` entries in LanguageContext so the two
 * surfaces cannot drift in wording. If you change one, change both.
 */
const FALLBACK_COPY: Record<string, string> = {
  'settings.security.delete_account': 'Delete Account',
  'settings.security.delete_account_desc': 'Permanently delete your account',
  'settings.security.delete_button': 'Delete',
  'settings.security.delete_warning':
    'This will delete all your data and cannot be undone.',
  'settings.security.erasure_request_title': 'Request account erasure',
  'settings.security.erasure_request_body':
    'Self-service deletion is being rolled out. In the meantime, contact us and we will erase your account and business data for you.',
  'settings.security.erasure_request_export_hint':
    'We recommend downloading a copy of your data first — erasure cannot be undone.',
  'settings.security.erasure_request_contact': 'Contact us',
  'settings.security.delete_dialog_title': 'Delete Your Account?',
  // QA E-1: the host heading while the self-delete steps are shown.
  'settings.account_delete.title': 'Delete my account',
  // Data export DE-10b.2: the self-delete steps (shown only while the server switch is on).
  'settings.account_delete.warning': 'Before you delete, download your data from Settings → Download my data. Deleting erases your account, your business, your client records, your invoices to clients, your website, your booking pages and your files. It cannot be undone and we cannot recover anything.',
  'settings.account_delete.what_next': 'Your account will be deleted now.',
  'settings.account_delete.billing_kept': 'We keep your payment history with us, with your personal details removed.',
  'settings.account_delete.what_we_keep': 'What we keep: our billing records without your personal details, a short deletion receipt, and the marketing consent records of your clients.',
  'settings.account_delete.not_available': 'Deleting your account is not available right now. Contact us at {support}.',
  'settings.account_delete.blockers_title': 'Before you can delete your account:',
  // Plan payments P-7a.3 (C-10): the same words as the en dictionary.
  'settings.account_delete.blocker.plan_running': 'Your plan is still running. Cancel it in Settings → Plan. You can delete your account once it has ended.',
  'settings.account_delete.blocker.stripe_connected': 'Your Stripe account is still connected for client payments. Disconnect it in Settings → Payments.',
  // D5 / SX-5: the G-8 text the drawer reads now (the key above is no longer read).
  'settings.account_delete.blocker.stripe_linked': 'Your Stripe account is still linked for client payments. Remove it in Business Setup → Payments → Remove connection. Disconnect on its own does not remove it.',
  'settings.account_delete.blocker.client_plans_running': '{n} client payment plans are still running. End them first.',
  'settings.account_delete.blocker.client_payments_pending': '{n} client payments or refunds are still pending. Wait for them to finish.',
  'settings.account_delete.blocker.client_plans_running_uncounted': 'Client payment plans are still running. End them first.',
  'settings.account_delete.blocker.client_payments_pending_uncounted': 'Client payments or refunds are still pending. Wait for them to finish.',
  'settings.account_delete.blocker.admin_account': 'Admin accounts cannot be deleted here.',
  'settings.account_delete.blocker.contact_support': 'We need to finish something on our side first. Contact us at {support}.',
  'settings.account_delete.statement_intro': 'To confirm, type this statement:',
  'settings.account_delete.statement_label': 'Type the statement to confirm',
  'settings.account_delete.delete_button': 'Delete my account forever',
  'settings.account_delete.deleting': 'Deleting your account…',
  'settings.account_delete.mismatch': 'The statement does not match. Type it exactly as shown.',
  'settings.account_delete.too_many': 'Too many attempts. Wait a few minutes and try again.',
  'settings.account_delete.delete_failed': 'Your account was not deleted. Try again, or contact us at {support}.',
  'settings.account_delete.files_removed_kept': 'Your files were removed but your account was kept. Contact us at {support}.',
};

/**
 * Resolve a copy key, preferring the provider, falling back to English.
 *
 * `t()` returns the key itself when a translation is missing, so a bare
 * `language.t(key)` would render `settings.security.erasure_request_title` to
 * the user on any locale lacking the key. Treating that as a miss keeps the
 * worst outcome "English" rather than "a dotted identifier".
 */
function useCopy() {
  // Non-throwing: `/v2/**` has no LanguageProvider. See useOptionalLanguage.
  const language = useOptionalLanguage();

  const tr = (key: string, vars?: Record<string, string | number>): string => {
    const translated = language?.t(key, vars);
    if (translated && translated !== key) return translated;
    let text = FALLBACK_COPY[key] ?? key;
    // Same `{name}` interpolation as LanguageContext's `t`, for the English fallback.
    for (const [name, value] of Object.entries(vars ?? {})) text = text.split(`{${name}}`).join(String(value));
    return text;
  };

  return { tr, isRTL: language?.isRTL ?? false, language: language?.language ?? 'en' };
}

/**
 * The erasure-request body — the part that must exist exactly once.
 *
 * Presentation is deliberately NOT included: `/business-os/settings` shows this
 * inside a settings-list dialog, `/v2/settings` inside a boxed Danger Zone.
 * Forcing one chrome onto both would make one of them look broken, and the
 * thing that actually needs to be shared is the copy and the contact address —
 * not the border radius.
 */
export function ErasureRequestContent({ state }: { state?: AccountDeletionCheckState } = {}) {
  const { tr, isRTL, language } = useCopy();
  // DE-10b.2: the server decides, through the pre-check the HOST surface owns
  // (QA E-1: one check per open, so the host can follow it too). No state, or
  // off, loading, error: this body is exactly today's (export + request channel).
  if (state?.status === 'ready') {
    return <DeleteAccountDrawer check={state.data} tr={tr} language={language} isRTL={isRTL} />;
  }

  // The export is the one shared control (data export DE-9, BC-1): the same
  // zip, copy, status line and notice as every other entry point. No own
  // fetch, no own message here. SA C-8: it sits on its own line as one stacked
  // block, with the "Contact us" link as a sibling and no flex-row-reverse
  // wrapper, so its logical classes are not reversed twice in Hebrew.
  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--v2-text-secondary)]">
        {tr('settings.security.erasure_request_body')}
      </p>
      <p className="text-xs text-[var(--v2-text-secondary)]">
        {tr('settings.security.erasure_request_export_hint')}
      </p>

      <DownloadMyDataButton variant="button" />

      <div>
        <a
          href={`mailto:${PLACEHOLDER_ERASURE_CONTACT}`}
          className="inline-flex items-center gap-2 px-3 py-2 border border-[var(--v2-border)] text-xs font-medium hover:bg-[var(--v2-surface-hover)]"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          <Mail className="w-3.5 h-3.5" aria-hidden="true" />
          {tr('settings.security.erasure_request_contact')}
        </a>
      </div>
    </div>
  );
}

/**
 * The `/business-os/settings` delete dialog's body (QA E-1, SA addendum):
 * rendered inside its `DialogContent`, so it mounts, and checks once, per open.
 * Off, loading or a failed check: today's header and warning, byte for byte.
 * Ready: the description reads "Delete my account" and the host warning is not
 * rendered, so the drawer's warning is the only one. Title and description
 * stay for Radix's accessible name and description. No second dialog (V-8).
 */
export function ErasureDialogBody() {
  const { tr } = useCopy();
  const { state } = useAccountDeletionCheck();
  const isReady = state.status === 'ready';

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-red-600">
          <Trash2 className="w-5 h-5" />
          {tr('settings.security.delete_dialog_title')}
        </DialogTitle>
        <DialogDescription className="pt-2">
          {tr(isReady ? 'settings.account_delete.title' : 'settings.security.erasure_request_title')}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
        {!isReady && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800" style={{ borderRadius: 'var(--v2-radius-button)' }}>
            <p className="text-sm text-red-700 dark:text-red-400 font-medium">
              {tr('settings.security.delete_warning')}
            </p>
          </div>
        )}

        <ErasureRequestContent state={state} />
      </div>
    </>
  );
}

/** The boxed panel's expanded region: owns the one pre-check per open (QA E-1). */
function ErasureRegion({ onReadyChange }: { onReadyChange: (isReady: boolean) => void }) {
  const { tr } = useCopy();
  const { state } = useAccountDeletionCheck();
  const isReady = state.status === 'ready';
  useEffect(() => onReadyChange(isReady), [isReady, onReadyChange]);
  const heading = tr(isReady ? 'settings.account_delete.title' : 'settings.security.erasure_request_title');

  return (
    <div
      id="erasure-request-panel"
      role="region"
      aria-label={heading}
      className="mt-4 p-3 border border-[var(--v2-border)] space-y-3"
      style={{ borderRadius: 'var(--v2-radius-button)' }}
    >
      <h5 className="font-semibold text-sm text-[var(--v2-text-primary)]">{heading}</h5>
      <ErasureRequestContent state={state} />
    </div>
  );
}

interface DangerZonePanelProps {
  /** Extra classes for the outer box, so each surface can match its own layout. */
  className?: string;
}

/**
 * Boxed presentation, for surfaces whose Security section is a set of cards
 * (`/v2/settings`). Surfaces built as settings lists should render
 * `ErasureRequestContent` inside their own dialog instead.
 */
export function DangerZonePanel({ className = '' }: DangerZonePanelProps) {
  const { tr, isRTL } = useCopy();
  const [isOpen, setIsOpen] = useState(false);
  // QA E-1: while the self-delete steps are open, the drawer's warning is the only one.
  const [isDeletionReady, setIsDeletionReady] = useState(false);

  return (
    <div
      className={`border-2 border-red-500/30 p-4 ${className}`}
      style={{ borderRadius: 'var(--v2-radius-card)' }}
    >
      <div
        className={`flex items-start justify-between gap-4 ${
          isRTL ? 'flex-row-reverse' : ''
        }`}
      >
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-sm text-red-600 dark:text-red-400 mb-1">
            {tr('settings.security.delete_account')}
          </h4>
          <p className="text-xs text-[var(--v2-text-secondary)] mb-2">
            {tr('settings.security.delete_account_desc')}
          </p>
          {!(isOpen && isDeletionReady) && (
            <div
              className="p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              <p className="text-xs font-medium text-red-600 dark:text-red-400">
                {tr('settings.security.delete_warning')}
              </p>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            setIsOpen((open) => !open);
            setIsDeletionReady(false);
          }}
          aria-expanded={isOpen}
          aria-controls="erasure-request-panel"
          className="flex-shrink-0 inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-red-600 to-red-700 text-white hover:scale-105 transition-transform duration-200 text-sm font-semibold shadow-md"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          <Trash2 className="w-4 h-4" />
          {tr('settings.security.delete_button')}
        </button>
      </div>

      {isOpen && <ErasureRegion onReadyChange={setIsDeletionReady} />}
    </div>
  );
}

export default DangerZonePanel;
