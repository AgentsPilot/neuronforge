'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Moon, Sun, Globe, Check, Settings, Calendar } from 'lucide-react';
import { V2Logo } from '@/components/v2/V2Header';
import { useV2Theme } from '@/lib/design-system-v2';
import { useLanguage } from '@/lib/business-os/LanguageContext';
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

  // Fetch scheduling status on mount
  useEffect(() => {
    async function checkSchedulingStatus() {
      try {
        const response = await fetch('/api/business-os/stats');
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.stats?.scheduling) {
            setHasScheduling((data.stats.scheduling.active_services_count || 0) > 0);
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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
        <V2Logo />

        {/* Calendar + Dark Mode Toggle + Language Selector + Settings */}
        <div className="flex items-center gap-3">
          {/* Calendar Button - only shown if user has scheduling */}
          {hasScheduling && (
            <button
              onClick={() => setIsSchedulingDialogOpen(true)}
              className="flex items-center justify-center w-10 h-10 bg-[var(--v2-surface)] border border-[var(--v2-border)] hover:bg-[#14B8A6]/10 hover:border-[#14B8A6] transition-colors group"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              aria-label={t('myday.open_calendar') || 'Open calendar'}
            >
              <Calendar className="w-5 h-5 text-[var(--v2-text-secondary)] group-hover:text-[#14B8A6] transition-colors" />
            </button>
          )}

          {/* Dark Mode Toggle */}
          <button
            onClick={toggleMode}
            className="flex items-center justify-center w-10 h-10 bg-[var(--v2-surface)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-colors"
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
              className="flex items-center gap-2 px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-colors"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              <Globe className="w-4 h-4 text-[var(--v2-text-muted)]" />
              <span className="text-sm font-medium text-[var(--v2-text-primary)]">
                {language === 'en' && '🇺🇸 English'}
                {language === 'es' && '🇪🇸 Español'}
                {language === 'he' && '🇮🇱 עברית'}
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
            className="flex items-center justify-center w-10 h-10 bg-[var(--v2-surface)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-colors"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
            aria-label={t('settings.title')}
          >
            <Settings className="w-5 h-5 text-[var(--v2-text-secondary)]" />
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
