'use client';

import { Check, ArrowRight, Sparkles } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import type { AutonomousWorkEntry } from '@/hooks/useInsights';

// ===========================
// Types
// ===========================

interface ReportCardProps {
  autonomousWork: AutonomousWorkEntry[];
  totalTimeSaved?: number; // minutes
  onSeeAll?: () => void;
}

// ===========================
// Component
// ===========================

export function ReportCard({
  autonomousWork,
  totalTimeSaved,
  onSeeAll,
}: ReportCardProps) {
  const { t, isRTL, language } = useLanguage();

  // Get today's date formatted
  const today = new Date();
  const dateFormatter = new Intl.DateTimeFormat(language === 'he' ? 'he-IL' : language === 'es' ? 'es-ES' : 'en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const formattedDate = dateFormatter.format(today);

  // No autonomous work to show
  if (autonomousWork.length === 0) {
    return null;
  }

  // Format time saved for display
  const formatTimeSaved = (minutes: number) => {
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      return t('myday.report.hours_saved').replace('{hours}', `${hours}`);
    }
    return t('myday.report.minutes_saved').replace('{minutes}', `${minutes}`);
  };

  // Get translated summary based on processId
  const getTranslatedSummary = (work: AutonomousWorkEntry) => {
    const { processId, outcome } = work;
    const { itemsSucceeded, itemsProcessed, valueImpact } = outcome;

    // Try to get translated summary based on processId
    if (processId === 'chase_overdue_invoices') {
      return t('insight.report.chased_invoices').replace('{count}', String(itemsProcessed));
    }
    if (processId === 'send_followup_nudge') {
      return t('insight.report.followed_up').replace('{count}', String(itemsProcessed));
    }
    if (processId === 'send_reminder_sequence') {
      return t('insight.report.sent_reminders').replace('{count}', String(itemsProcessed));
    }
    if (processId === 'reply_to_enquiries') {
      return t('insight.report.replied_enquiries').replace('{count}', String(itemsProcessed));
    }

    // Fallback to original summary
    return work.summary;
  };

  // Get translated outcome based on processId
  const getTranslatedOutcome = (work: AutonomousWorkEntry) => {
    const { processId, outcome } = work;
    const { itemsSucceeded, itemsProcessed, valueImpact } = outcome;

    if (processId === 'chase_overdue_invoices' && valueImpact && valueImpact > 0) {
      return t('insight.report.invoices_paid')
        .replace('{count}', String(itemsSucceeded))
        .replace('{amount}', `$${valueImpact.toLocaleString()}`);
    }
    if (processId === 'send_followup_nudge' && itemsSucceeded > 0) {
      return t('insight.report.rebooked').replace('{count}', String(itemsSucceeded));
    }
    if (processId === 'send_reminder_sequence') {
      return t('insight.report.no_shows_down');
    }
    if (processId === 'reply_to_enquiries') {
      return t('insight.report.reply_time').replace('{minutes}', '2');
    }

    // Fallback to generic outcome
    if (valueImpact && valueImpact > 0) {
      return t('myday.report.value_outcome')
        .replace('{succeeded}', String(itemsSucceeded))
        .replace('{value}', `$${valueImpact.toLocaleString()}`);
    }
    return t('myday.report.partial_outcome')
      .replace('{succeeded}', String(itemsSucceeded))
      .replace('{total}', String(itemsProcessed));
  };

  return (
    <div
      className="overflow-hidden"
      style={{
        borderRadius: '16px',
        borderLeft: '4px solid #22C58B',
        background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.08) 0%, rgba(255,255,255,0.5) 100%)',
        direction: isRTL ? 'rtl' : 'ltr',
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-[22px] pt-[18px] pb-[6px]">
        {/* Orb */}
        <div
          className="w-[30px] h-[30px] rounded-[9px] flex items-center justify-center flex-none"
          style={{
            background: 'linear-gradient(120deg, #FFB454 0%, #F97316 55%, #EA580C 100%)',
            boxShadow: '0 6px 14px -5px rgba(249,115,22,.6)',
          }}
        >
          <Sparkles className="w-4 h-4 text-white" strokeWidth={2.2} />
        </div>

        <div className="flex-1">
          <h3
            className="font-semibold"
            style={{
              fontFamily: '"Space Grotesk", system-ui, sans-serif',
              fontSize: '16.5px',
              letterSpacing: '-0.01em',
              color: '#131A2B',
            }}
          >
            {t('myday.report.title')}
          </h3>
          <p className="text-xs text-[#697187]">
            {t('myday.report.subtitle').replace('{date}', formattedDate)}
          </p>
        </div>

        {/* Live indicator */}
        <div
          className="inline-flex items-center gap-[7px] text-[11.5px] font-semibold px-[11px] py-[6px] rounded-full"
          style={{
            color: '#128a5e',
            background: 'rgba(34,197,139,.12)',
          }}
        >
          <span className="relative w-[7px] h-[7px]">
            <span className="absolute inset-0 rounded-full bg-[#22C58B]" />
            <span
              className="absolute inset-0 rounded-full bg-[#22C58B] animate-ping"
              style={{ animationDuration: '1.8s' }}
            />
          </span>
          {t('myday.report.working')}
        </div>
      </div>

      {/* Work Items Grid - 2 columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-[2px] px-[14px] pt-[8px] pb-[6px]">
        {autonomousWork.slice(0, 4).map((work) => (
          <div
            key={work.executionId}
            className="flex items-start gap-[11px] p-3 rounded-xl transition-colors hover:bg-[#FAFAFC]"
          >
            {/* Tick */}
            <div
              className="w-[22px] h-[22px] rounded-full flex items-center justify-center flex-none mt-[1px]"
              style={{ background: 'rgba(34,197,139,.15)' }}
            >
              <Check className="w-3 h-3 text-[#22C58B]" strokeWidth={3} />
            </div>

            <div className="min-w-0 flex-1">
              <p
                className="font-semibold"
                style={{ fontSize: '13.5px', lineHeight: 1.35, color: '#131A2B' }}
              >
                {getTranslatedSummary(work)}
              </p>
              <p
                className="font-semibold"
                style={{ fontSize: '12.5px', color: '#128a5e' }}
              >
                {getTranslatedOutcome(work)}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div
        className="flex items-center gap-3 px-[22px] py-[14px] mt-[6px]"
        style={{ borderTop: '1px solid #F1F2F7' }}
      >
        {/* Time saved */}
        {totalTimeSaved && totalTimeSaved > 0 && (
          <p className="text-[13.5px] text-[#131A2B]">
            {formatTimeSaved(totalTimeSaved)}
          </p>
        )}

        {/* See everything link */}
        <button
          onClick={onSeeAll}
          className={`inline-flex items-center gap-[6px] text-[13.5px] font-semibold text-[#F97316] hover:opacity-80 transition-opacity ${isRTL ? 'mr-auto' : 'ml-auto'}`}
        >
          {t('myday.report.see_all')}
          <ArrowRight className="w-[15px] h-[15px]" strokeWidth={2.2} />
        </button>
      </div>
    </div>
  );
}

