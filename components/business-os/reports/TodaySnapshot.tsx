'use client';

import { Calendar, Users, Banknote, Sun } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';

interface TodaySnapshotProps {
  sessionsToday: number;
  newLeadsToday: number;
  revenueToday: number;
}

export function TodaySnapshot({ sessionsToday, newLeadsToday, revenueToday }: TodaySnapshotProps) {
  const { t, formatCurrency, language } = useLanguage();
  const isRTL = language === 'he';

  return (
    <div
      className="bg-gradient-to-r from-[#14B8A6]/10 via-[#8B5CF6]/10 to-[#22C58B]/10 border border-[var(--v2-border)] p-4"
      style={{ borderRadius: 'var(--v2-radius-card)' }}
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      {/* Header with Today label */}
      <div className="flex items-center gap-2 mb-3">
        <Sun className="w-4 h-4 text-amber-500" />
        <span className="text-sm font-semibold text-[var(--v2-text-primary)]">
          {t('reports.today') || 'Today'}
        </span>
      </div>

      {/* Stats Grid - 3 columns */}
      <div className="grid grid-cols-3 gap-3">
        {/* Sessions */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <Calendar className="w-4 h-4 text-[#14B8A6]" />
            <span className="text-xl sm:text-2xl font-bold text-[var(--v2-text-primary)]">
              {sessionsToday}
            </span>
          </div>
          <span className="text-xs text-[var(--v2-text-muted)]">
            {t('reports.sessions') || 'sessions'}
          </span>
        </div>

        {/* Divider */}
        <div className="border-x border-[var(--v2-border)] text-center">
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <Users className="w-4 h-4 text-[#8B5CF6]" />
            <span className="text-xl sm:text-2xl font-bold text-[var(--v2-text-primary)]">
              {newLeadsToday}
            </span>
          </div>
          <span className="text-xs text-[var(--v2-text-muted)]">
            {t('reports.new_leads') || 'new'}
          </span>
        </div>

        {/* Revenue */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <Banknote className="w-4 h-4 text-[#22C58B]" />
            <span className="text-xl sm:text-2xl font-bold text-[var(--v2-text-primary)]">
              {formatCurrency(revenueToday, { showFree: false })}
            </span>
          </div>
          <span className="text-xs text-[var(--v2-text-muted)]">
            {t('reports.earned') || 'earned'}
          </span>
        </div>
      </div>
    </div>
  );
}
