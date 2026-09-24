'use client';

/**
 * Why something cannot happen yet, and the one button that fixes it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This markup existed three times before it existed once: the smart-link notice
 * and the publish notice in `app/business-os/website/page.tsx`, and the service
 * gate in `LandingPageWizard.tsx`. All three were byte-identical apart from what
 * they did when the configuration dialog closed, and all three carried their own
 * copy of the button labels in a per-file translation map.
 *
 * WHAT A GAP IS
 *
 * `journeyGaps` decides, per service, what stands between a business and taking
 * a client: no working hours behind a service that asks for a time, or no
 * invoice details behind one that will be billed. It is a fact about a service,
 * not about the business — which is why a free consultation and a paid programme
 * can sit in the same catalogue and only one of them is blocked.
 *
 * ON `onResolved`
 *
 * Callers must re-check, not just dismiss. The owner has been sent to fix the
 * very thing this names, so leaving the notice up asserts an answer that may no
 * longer be true — and clearing it blindly asserts the opposite. Ask again.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Clock, FileText, ArrowRight } from 'lucide-react';
import { gapFixAction } from '@/lib/business-os/journeyGapFix';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { useConfigurationDialog } from '@/components/business-os/ConfigurationDialogProvider';

/** The shape every consumer of `/api/business-os/journey-readiness` receives. */
export interface JourneyGapView {
  kind: string;
  message: string;
  /** Names of the services this gap applies to, where the caller has them. */
  services?: string[];
}

interface Props {
  gaps: JourneyGapView[];
  /**
   * Fallback when the caller has a sentence but no structured gaps — the API
   * fails open and older responses can carry only `error`.
   */
  fallbackMessage?: string | null;
  /** Re-check here. See the note above: do not simply clear. */
  onResolved?: () => void | Promise<void>;
  /**
   * Fired the moment the configuration dialog is opened, before it appears.
   *
   * A caller that is itself a MODAL dialog needs this. Radix traps focus and
   * treats a click anywhere outside its own content as a dismissal, so the
   * settings dialog opened from inside one has its clicks eaten — the first
   * press on its close button goes to the trap and only the second reaches the
   * button. The caller uses this to drop its own modality for the duration.
   */
  onFixOpened?: () => void;
}

export function JourneyGapNotice({ gaps, fallbackMessage, onResolved, onFixOpened }: Props) {
  const { t, language } = useLanguage();
  const { openConfiguration } = useConfigurationDialog();

  const tr = (key: string, fallback: string): string => {
    const value = t(key);
    return value === key ? fallback : value;
  };

  if (gaps.length === 0) {
    if (!fallbackMessage) return null;
    return (
      <div
        role="status"
        className="flex items-start gap-3 p-3 bg-amber-500/10 border border-amber-500/30"
        style={{ borderRadius: 'var(--v2-radius-card)' }}
      >
        <p className="text-sm text-[var(--v2-text-primary)]">{fallbackMessage}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {gaps.map(gap => {
        const isInvoicing = gap.kind === 'invoicing';
        // Tab and label together, so they cannot point at different things.
        const fix = gapFixAction(gap.kind);
        const GapIcon = isInvoicing ? FileText : Clock;

        return (
          <div
            key={gap.kind}
            className="flex items-start gap-3 p-3 bg-[var(--v2-surface)] border border-[var(--v2-border)]"
            style={{ borderRadius: 'var(--v2-radius-card)' }}
          >
            <div
              className="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-amber-500/15 text-amber-600 dark:text-amber-400"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              <GapIcon className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              {/* `describeJourneyGap` deliberately keeps its sentence generic,
                  so the service it concerns is named here or not at all. */}
              {gap.services && gap.services.length > 0 && (
                <p className="text-xs font-medium text-[var(--v2-text-muted)]">
                  {gap.services.join(' · ')}
                </p>
              )}
              <p className="text-sm text-[var(--v2-text-primary)]">{gap.message}</p>
              <button
                type="button"
                onClick={() => {
                  onFixOpened?.();
                  openConfiguration(fix.tab, {
                    onClose: () => {
                      void onResolved?.();
                    },
                  });
                }}
                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#4F6EF7] hover:bg-[#3B5AE5] transition-colors"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                {tr(fix.key, fix.fallback)}
                <ArrowRight className={`w-3.5 h-3.5 ${language === 'he' ? 'rotate-180' : ''}`} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
