'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Moon, Sun, Globe, Check, Settings, Calendar } from 'lucide-react';
import { V2Logo } from '@/components/v2/V2Header';
import { useV2Theme } from '@/lib/design-system-v2';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { PAGE_CONTAINER } from '@/lib/business-os/pageContainer';

import { SchedulingDialog } from '@/components/business-os/SchedulingDialog';

export function BusinessOSHeader() {
  const router = useRouter();
  const { language, setLanguage, t } = useLanguage();
  const [isLanguageOpen, setIsLanguageOpen] = useState(false);
  const languageDropdownRef = useRef<HTMLDivElement>(null);
  const { mode, toggleMode } = useV2Theme();

  // Scheduling state
  const [hasScheduling, setHasScheduling] = useState(false);
  const [isSchedulingDialogOpen, setIsSchedulingDialogOpen] = useState(false);

  /*
   * Does this business have anything bookable? One boolean, one query.
   *
   * This asked `/api/business-os/stats` from the day the header was written,
   * when that endpoint was 422 lines and 20 queries and already knew the
   * answer — a fair shortcut at the time. It is now 1,723 lines and 58
   * queries: every dashboard KPI, a ~48-query fan-out, an unbounded scan of
   * the page-view table, and a WRITE (`markOverdueInvoices`) on a read. The
   * header still uses one number out of all of it, to decide whether to draw a
   * button. The requirement never grew; the bill did.
   *
   * The header lives in the layout, so that ran on every Business OS page —
   * website, CRM, orders, settings — and twice on the dashboard and reports,
   * which fetch the same endpoint themselves.
   *
   * `status` alone, deliberately: the count this replaces was
   * `.eq('status', 'active')` and nothing else. The repository's `activeOnly`
   * flag is a STRICTER test — `SchedulingServiceRepository.BOOKABLE` requires
   * `is_active` too — so asking for it would hide the calendar button from a
   * business whose service is published but currently toggled off. Same rows
   * as before, same button.
   */
  useEffect(() => {
    async function checkSchedulingStatus() {
      try {
        const response = await fetch('/api/scheduling/services');
        if (response.ok) {
          const data = await response.json();
          if (data.success && Array.isArray(data.services)) {
            setHasScheduling(
              data.services.some((service: { status?: string }) => service.status === 'active')
            );
          }
        }
      } catch {
        // Silently fail - button just won't show
      }
    }
    checkSchedulingStatus();
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (languageDropdownRef.current && !languageDropdownRef.current.contains(event.target as Node)) {
        setIsLanguageOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="sticky top-0 z-50 border-b border-[var(--v2-border)] bg-[var(--v2-surface)]">
      <div className={`${PAGE_CONTAINER} py-3 sm:py-4 flex items-center justify-between`}>
        <V2Logo />

        {/* Calendar + Dark Mode Toggle + Language Selector + Settings */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Calendar Button - only shown if user has scheduling */}
          {hasScheduling && (
            <button
              onClick={() => setIsSchedulingDialogOpen(true)}
              className="flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 bg-[var(--v2-surface)] border border-[var(--v2-border)] hover:bg-[#14B8A6]/10 hover:border-[#14B8A6] transition-colors group"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              aria-label={t('myday.open_calendar') || 'Open calendar'}
            >
              <Calendar className="w-4 h-4 sm:w-5 sm:h-5 text-[var(--v2-text-secondary)] group-hover:text-[#14B8A6] transition-colors" />
            </button>
          )}

          {/* Dark Mode Toggle */}
          <button
            onClick={toggleMode}
            className="flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 bg-[var(--v2-surface)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-colors"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
            aria-label="Toggle dark mode"
          >
            {mode === 'dark' ? (
              <Sun className="w-4 h-4 text-[var(--v2-text-secondary)]" />
            ) : (
              <Moon className="w-4 h-4 text-[var(--v2-text-secondary)]" />
            )}
          </button>

          {/* Language Selector */}
          <div className="relative" ref={languageDropdownRef}>
            <button
              onClick={() => setIsLanguageOpen(!isLanguageOpen)}
              className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-colors"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              <Globe className="w-4 h-4 text-[var(--v2-text-muted)]" />
              <span className="text-sm font-medium text-[var(--v2-text-primary)] hidden sm:inline">
                {language === 'en' && '🇺🇸 English'}
                {language === 'es' && '🇪🇸 Español'}
                {language === 'he' && '🇮🇱 עברית'}
              </span>
              <span className="text-base sm:hidden">
                {language === 'en' && '🇺🇸'}
                {language === 'es' && '🇪🇸'}
                {language === 'he' && '🇮🇱'}
              </span>
            </button>

            {isLanguageOpen && (
              <div
                className="absolute right-0 mt-2 w-48 bg-[var(--v2-surface)] border border-[var(--v2-border)] shadow-lg z-50"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <button
                  onClick={() => { setLanguage('en'); setIsLanguageOpen(false); }}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--v2-surface-hover)] transition-colors text-left"
                >
                  <span className="text-sm text-[var(--v2-text-primary)]">🇺🇸 English</span>
                  {language === 'en' && <Check className="w-4 h-4 text-[var(--v2-primary)]" />}
                </button>
                <button
                  onClick={() => { setLanguage('es'); setIsLanguageOpen(false); }}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--v2-surface-hover)] transition-colors text-left"
                >
                  <span className="text-sm text-[var(--v2-text-primary)]">🇪🇸 Español</span>
                  {language === 'es' && <Check className="w-4 h-4 text-[var(--v2-primary)]" />}
                </button>
                <button
                  onClick={() => { setLanguage('he'); setIsLanguageOpen(false); }}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--v2-surface-hover)] transition-colors text-left"
                >
                  <span className="text-sm text-[var(--v2-text-primary)]">🇮🇱 עברית</span>
                  {language === 'he' && <Check className="w-4 h-4 text-[var(--v2-primary)]" />}
                </button>
              </div>
            )}
          </div>

          {/* Settings Icon - direct link */}
          <button
            onClick={() => router.push('/business-os/settings')}
            className="flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 bg-[var(--v2-surface)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-colors"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
            aria-label={t('settings.title')}
          >
            <Settings className="w-4 h-4 sm:w-5 sm:h-5 text-[var(--v2-text-secondary)]" />
          </button>
        </div>
      </div>

      {/* Scheduling Dialog */}
      <SchedulingDialog
        isOpen={isSchedulingDialogOpen}
        onClose={() => setIsSchedulingDialogOpen(false)}
      />
    </div>
  );
}
