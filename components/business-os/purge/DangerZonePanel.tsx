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
 */

import React, { useState } from 'react';
import { Trash2, Download, Mail, Loader2 } from 'lucide-react';
import { useOptionalLanguage } from '@/lib/business-os/LanguageContext';
import { downloadUserDataExport } from '@/lib/client/downloadUserDataExport';

/**
 * The address a customer writes to when they want their business erased.
 *
 * ⚠️ **TEMP-ERASURE-CONTACT — this is a personal address, used as an interim
 * unblock. It must be replaced with a real support mailbox.**
 *
 * `meiribarak@gmail.com` is the product owner's own email. It is here because
 * no support account exists yet and the alternative was shipping a Danger Zone
 * whose only action pointed nowhere. **Barak owns the swap**, before or shortly
 * after launch.
 *
 * Three things make this worth replacing rather than forgetting:
 *
 *   1. **It is rendered to every customer**, on all three settings surfaces
 *      (`/business-os/settings`, `/v2/settings`, `/settings`). This is not an
 *      internal config value — it is customer-visible copy, so swapping it is a
 *      product decision rather than a config tidy.
 *   2. **It is a personal inbox.** Erasure requests are a compliance channel;
 *      routing them to one person's Gmail means they are unmonitored whenever
 *      that person is not reading it, and there is no record that they arrived.
 *   3. **It replaced a deliberately fake address.** The previous placeholder was
 *      `TODO-ERASURE-CONTACT@example.invalid`, chosen so it could never ship
 *      unnoticed. A real, plausible address loses that property — which is
 *      exactly why the marker below exists.
 *
 * **To find it: `grep -rn "TEMP-ERASURE-CONTACT"`.** The marker lives in this
 * comment rather than inside the address, so the address stays valid while the
 * reminder stays greppable. Tracked as an open item (N2) in
 * docs/workplans/business-os-business-data-purge.md.
 *
 * Defined here and ONLY here — the reason this shared component exists at all.
 */
export const PLACEHOLDER_ERASURE_CONTACT = 'meiribarak@gmail.com';

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
  'settings.security.export_button': 'Export Data',
  'settings.security.export_success': 'Data exported successfully!',
  'settings.security.export_error': 'Failed to export data. Please try again.',
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

  const tr = (key: string): string => {
    const translated = language?.t(key);
    if (translated && translated !== key) return translated;
    return FALLBACK_COPY[key] ?? key;
  };

  return { tr, isRTL: language?.isRTL ?? false };
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
export function ErasureRequestContent() {
  const { tr, isRTL } = useCopy();
  const [isExporting, setIsExporting] = useState(false);
  const [exportOutcome, setExportOutcome] = useState<'success' | 'error' | null>(null);

  // Through the shared helper, not a plain link (SQ-E2, QA E4): a link cannot
  // tell whether the download worked, so a signed-out click saved the 401 JSON
  // as "my data". The helper never throws; it returns a verdict. No user id and
  // no audit call here: the server takes the person from the session and writes
  // DATA_EXPORTED itself.
  const handleExport = async () => {
    if (isExporting) return;
    setIsExporting(true);
    setExportOutcome(null);
    try {
      const result = await downloadUserDataExport();
      setExportOutcome(result.success ? 'success' : 'error');
    } catch {
      // The helper returns a verdict and is not expected to throw; if it ever
      // does, the person still sees the error message, never a false success.
      setExportOutcome('error');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--v2-text-secondary)]">
        {tr('settings.security.erasure_request_body')}
      </p>
      <p className="text-xs text-[var(--v2-text-secondary)]">
        {tr('settings.security.erasure_request_export_hint')}
      </p>

      <div
        className={`flex flex-wrap items-center gap-2 ${
          isRTL ? 'flex-row-reverse' : ''
        }`}
      >
        <button
          type="button"
          onClick={handleExport}
          disabled={isExporting}
          aria-busy={isExporting}
          className="inline-flex items-center gap-2 px-3 py-2 border border-[var(--v2-border)] text-xs font-medium hover:bg-[var(--v2-surface-hover)] disabled:opacity-60"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          {isExporting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
          )}
          {tr('settings.security.export_button')}
        </button>

        <a
          href={`mailto:${PLACEHOLDER_ERASURE_CONTACT}`}
          className="inline-flex items-center gap-2 px-3 py-2 border border-[var(--v2-border)] text-xs font-medium hover:bg-[var(--v2-surface-hover)]"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          <Mail className="w-3.5 h-3.5" />
          {tr('settings.security.erasure_request_contact')}
        </a>
      </div>

      <p role="status" aria-live="polite" className="text-xs text-[var(--v2-text-secondary)]">
        {exportOutcome === 'success' && tr('settings.security.export_success')}
        {exportOutcome === 'error' && tr('settings.security.export_error')}
      </p>
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
          <div
            className="p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            <p className="text-xs font-medium text-red-600 dark:text-red-400">
              {tr('settings.security.delete_warning')}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          aria-expanded={isOpen}
          aria-controls="erasure-request-panel"
          className="flex-shrink-0 inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-red-600 to-red-700 text-white hover:scale-105 transition-transform duration-200 text-sm font-semibold shadow-md"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          <Trash2 className="w-4 h-4" />
          {tr('settings.security.delete_button')}
        </button>
      </div>

      {isOpen && (
        <div
          id="erasure-request-panel"
          role="region"
          aria-label={tr('settings.security.erasure_request_title')}
          className="mt-4 p-3 border border-[var(--v2-border)] space-y-3"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          <h5 className="font-semibold text-sm text-[var(--v2-text-primary)]">
            {tr('settings.security.erasure_request_title')}
          </h5>
          <ErasureRequestContent />
        </div>
      )}
    </div>
  );
}

export default DangerZonePanel;
