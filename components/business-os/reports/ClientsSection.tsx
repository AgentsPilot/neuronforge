'use client';

import { Users, UserPlus, ArrowRight } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';

interface ClientsSectionProps {
  totalContacts: number;
  newThisWeek: number;
  activeClients?: number;
  clientGoal?: number;
  onOpenCRM: () => void;
}

// Simple circular gauge component
function ClientsGauge({ value, max, color }: { value: number; max: number; color: string }) {
  const percentage = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const circumference = 2 * Math.PI * 40;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <div className="relative w-24 h-24 sm:w-28 sm:h-28">
      <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke="var(--v2-border)"
          strokeWidth="8"
        />
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg sm:text-xl font-bold text-[var(--v2-text-primary)]">
          {Math.round(percentage)}%
        </span>
        <span className="text-[10px] text-[var(--v2-text-muted)]">of goal</span>
      </div>
    </div>
  );
}

export function ClientsSection({
  totalContacts,
  newThisWeek,
  activeClients,
  clientGoal = 100,
  onOpenCRM
}: ClientsSectionProps) {
  const { t, language } = useLanguage();
  const isRTL = language === 'he';

  return (
    <div
      className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-5"
      style={{ borderRadius: 'var(--v2-radius-card)' }}
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: 'rgba(139, 92, 246, 0.15)' }}
        >
          <Users className="w-5 h-5 text-[#8B5CF6]" />
        </div>
        <span className="text-sm font-semibold text-[var(--v2-text-secondary)]">
          {t('reports.your_clients') || 'Your Clients'}
        </span>
      </div>

      {/* Content: Number + Gauge */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-3xl sm:text-4xl font-bold text-[var(--v2-text-primary)] tracking-tight">
            {totalContacts}
          </p>
          <p className="text-sm text-[var(--v2-text-muted)] mt-1">
            {t('reports.people_network') || 'people in your network'}
          </p>
        </div>
        <ClientsGauge value={totalContacts} max={clientGoal} color="#8B5CF6" />
      </div>

      {/* Footer: New + Action */}
      <div className="flex items-center justify-between pt-4 border-t border-[var(--v2-border)]">
        {/* New This Week */}
        {newThisWeek > 0 ? (
          <div className="flex items-center gap-1.5 text-[#8B5CF6]">
            <UserPlus className="w-4 h-4" />
            <span className="text-sm font-medium">+{newThisWeek}</span>
            <span className="text-xs text-[var(--v2-text-muted)]">
              {t('reports.new_this_week') || 'new this week'}
            </span>
          </div>
        ) : (
          <span className="text-sm text-[var(--v2-text-muted)]">
            {t('reports.no_new_this_week') || 'No new contacts this week'}
          </span>
        )}

        {/* Action Link */}
        <button
          onClick={onOpenCRM}
          className="flex items-center gap-1 text-sm font-medium text-[#8B5CF6] hover:underline"
        >
          {t('reports.open_crm') || 'Open CRM'}
          <ArrowRight className="w-4 h-4 rtl:rotate-180" />
        </button>
      </div>
    </div>
  );
}
