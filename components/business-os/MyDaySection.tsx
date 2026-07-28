'use client';

import { useState } from 'react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { Check, Clock, Bell, ChevronDown } from 'lucide-react';

export interface StoryBeat {
  type: 'done' | 'next' | 'run';
  titleKey: string;
  titleParams?: Record<string, string | number>;
  subtitleKey: string;
  subtitleParams?: Record<string, string | number>;
}

export interface SummaryData {
  key: string;
  params?: Record<string, string | number>;
  parts?: Array<{ key: string; params?: Record<string, string | number> }>;
}

interface MyDaySectionProps {
  userName: string;
  greeting: 'morning' | 'afternoon' | 'evening';
  summaryData: SummaryData;
  storyBeats: StoryBeat[];
  loading?: boolean;
}

const BEAT_STYLES = {
  done: {
    tagBg: 'rgba(34, 197, 139, 0.13)',
    tagColor: '#128a5e',
    iconBg: 'rgba(34, 197, 139, 0.13)',
    iconColor: '#22C58B',
    Icon: Check
  },
  next: {
    tagBg: 'rgba(79, 110, 247, 0.12)',
    tagColor: '#4F6EF7',
    iconBg: 'rgba(79, 110, 247, 0.12)',
    iconColor: '#4F6EF7',
    Icon: Clock
  },
  run: {
    tagBg: 'rgba(249, 115, 22, 0.12)',
    tagColor: '#F97316',
    iconBg: 'rgba(249, 115, 22, 0.12)',
    iconColor: '#F97316',
    Icon: Bell
  }
};

export function MyDaySection({
  userName,
  greeting,
  summaryData,
  storyBeats,
  loading = false
}: MyDaySectionProps) {
  const { t, isRTL } = useLanguage();
  const [isCollapsed, setIsCollapsed] = useState(false);

  const now = new Date();
  const dayKeys = ['day.sunday', 'day.monday', 'day.tuesday', 'day.wednesday', 'day.thursday', 'day.friday', 'day.saturday'];
  const monthKeys = ['month.jan', 'month.feb', 'month.mar', 'month.apr', 'month.may', 'month.jun', 'month.jul', 'month.aug', 'month.sep', 'month.oct', 'month.nov', 'month.dec'];
  const dayName = t(dayKeys[now.getDay()]);
  const monthName = t(monthKeys[now.getMonth()]);
  const dateStr = `${now.getDate()} ${monthName}`;

  const greetingText = t(`myday.greeting.${greeting}`) || {
    morning: 'Good morning',
    afternoon: 'Good afternoon',
    evening: 'Good evening'
  }[greeting];

  // Build summary text from translation keys
  const buildSummary = (): string => {
    if (summaryData.key === 'myday.summary.default') {
      return t('myday.summary.default');
    }
    if (summaryData.parts && summaryData.parts.length > 0) {
      const intro = t('myday.summary.intro');
      const outro = t('myday.summary.outro');
      const partTexts = summaryData.parts.map(part => {
        let text = t(part.key);
        if (part.params) {
          Object.entries(part.params).forEach(([key, value]) => {
            text = text.replace(`{${key}}`, `<b>${value}</b>`);
          });
        }
        return text;
      });
      return `${intro} ${partTexts.join('. ')}. ${outro}`;
    }
    return t('myday.summary.default');
  };

  const summary = buildSummary();

  if (loading) {
    return (
      <div
        className="bg-[var(--v2-surface)] border border-[var(--v2-border)] overflow-hidden animate-pulse"
        style={{ borderRadius: '22px', padding: '22px 24px' }}
      >
        <div className="h-6 bg-[var(--v2-border)] rounded w-48 mb-4" />
        <div className="h-4 bg-[var(--v2-border)] rounded w-96 mb-6" />
        <div className="grid grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-24 bg-[var(--v2-border)] rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <section
      className="bg-[var(--v2-surface)] border border-[var(--v2-border)] relative overflow-hidden"
      style={{
        borderRadius: '22px',
        padding: '22px 24px',
        boxShadow: '0 20px 50px -34px rgba(20, 26, 43, 0.4)'
      }}
    >
      {/* Background glow */}
      <div
        className="absolute pointer-events-none"
        style={{
          top: '-40%',
          [isRTL ? 'left' : 'right']: '-6%',
          width: '280px',
          height: '280px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255, 180, 84, 0.16), transparent 68%)'
        }}
      />

      {/* Top row */}
      <div className="flex items-start gap-4 mb-5 relative">
        <div className="flex-1">
          {/* Eyebrow */}
          <div
            className="flex items-center gap-2 mb-2"
            style={{
              fontFamily: '"Space Grotesk", system-ui, sans-serif',
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: '#F97316'
            }}
          >
            {/* Live pulse */}
            <span className="relative">
              <span
                className="block w-2 h-2 rounded-full"
                style={{ background: '#22C58B' }}
              />
              <span
                className="absolute inset-0 rounded-full animate-ping"
                style={{ background: '#22C58B', opacity: 0.4 }}
              />
            </span>
            {t('myday.eyebrow') || 'Your day, so far'}
          </div>

          {/* Greeting */}
          <h1
            className="mb-2"
            style={{
              fontFamily: '"Space Grotesk", system-ui, sans-serif',
              fontWeight: 600,
              fontSize: '25px',
              letterSpacing: '-0.025em',
              lineHeight: 1.15,
              color: 'var(--v2-text-primary)'
            }}
          >
            {greetingText}, {userName}
          </h1>

          {/* Summary */}
          <p
            className="text-[var(--v2-text-secondary)]"
            style={{ fontSize: '14.5px', lineHeight: 1.55, maxWidth: '44rem' }}
            dangerouslySetInnerHTML={{ __html: summary }}
          />
        </div>

        {/* Date */}
        <div className="text-end flex-none">
          <b
            className="block"
            style={{
              fontFamily: '"Space Grotesk", system-ui, sans-serif',
              fontSize: '15px',
              fontWeight: 600,
              color: 'var(--v2-text-primary)'
            }}
          >
            {dayName}
          </b>
          <span className="text-xs text-[var(--v2-text-muted)]">{dateStr}</span>
        </div>
      </div>

      {/* Story beats - collapsible */}
      <div
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 relative overflow-hidden transition-all duration-300 ease-in-out"
        style={{
          maxHeight: isCollapsed ? '0px' : '500px',
          opacity: isCollapsed ? 0 : 1,
          marginTop: isCollapsed ? '-12px' : '0px'
        }}
      >
        {storyBeats.map((beat, index) => {
          const style = BEAT_STYLES[beat.type];
          const Icon = style.Icon;
          const isRunning = beat.type === 'run';

          // Resolve translation with params
          const resolveText = (key: string, params?: Record<string, string | number>): string => {
            let text = t(key);
            if (params) {
              Object.entries(params).forEach(([paramKey, value]) => {
                text = text.replace(`{${paramKey}}`, String(value));
              });
            }
            return text;
          };

          const title = resolveText(beat.titleKey, beat.titleParams);
          const subtitle = resolveText(beat.subtitleKey, beat.subtitleParams);

          return (
            <div
              key={index}
              className="relative bg-[var(--v2-bg)] border border-[var(--v2-border)] transition-all hover:border-[#D6DAE6] hover:bg-[var(--v2-surface)] cursor-default"
              style={{ borderRadius: '15px', padding: '14px 15px' }}
            >
              {/* Tag */}
              <span
                className="absolute flex items-center gap-1"
                style={{
                  top: '13px',
                  [isRTL ? 'left' : 'right']: '13px',
                  fontSize: '9px',
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  padding: '2px 6px',
                  borderRadius: '5px',
                  background: style.tagBg,
                  color: style.tagColor
                }}
              >
                {isRunning && (
                  <span
                    className="w-1.5 h-1.5 rounded-full animate-pulse"
                    style={{ background: style.iconColor }}
                  />
                )}
                {beat.type === 'done' && (t('myday.beat.done') || 'Done')}
                {beat.type === 'next' && (t('myday.beat.next') || 'Next')}
                {beat.type === 'run' && (t('myday.beat.running') || 'Running')}
              </span>

              {/* Icon */}
              <div
                className="w-8 h-8 flex items-center justify-center mb-3"
                style={{ borderRadius: '9px', background: style.iconBg }}
              >
                <Icon
                  className="w-4 h-4"
                  style={{ color: style.iconColor }}
                  strokeWidth={2}
                />
              </div>

              {/* Content */}
              <b
                className="block text-[var(--v2-text-primary)] mb-1"
                style={{ fontSize: '13.5px', fontWeight: 600, lineHeight: 1.3 }}
              >
                {title}
              </b>
              <small
                className="text-[var(--v2-text-muted)]"
                style={{ fontSize: '12px', lineHeight: 1.4 }}
              >
                {subtitle}
              </small>
            </div>
          );
        })}
      </div>

      {/* Bottom collapse toggle */}
      <div className={`flex pt-4 mt-2 ${isRTL ? 'justify-start' : 'justify-end'}`}>
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-[var(--v2-border)] bg-[var(--v2-bg)] hover:bg-[var(--v2-surface)] hover:border-[#F97316] text-[var(--v2-text-muted)] hover:text-[#F97316] transition-all group"
          style={{ fontSize: '12px', fontWeight: 500 }}
        >
          <span>{isCollapsed ? t('myday.show_details') : t('myday.hide_details')}</span>
          <ChevronDown
            className="w-3.5 h-3.5 transition-transform duration-200"
            style={{ transform: isCollapsed ? 'rotate(0deg)' : 'rotate(180deg)' }}
          />
        </button>
      </div>
    </section>
  );
}
