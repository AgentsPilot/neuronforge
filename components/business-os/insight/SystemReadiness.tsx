'use client';

import { Check } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import type { SetupItem } from './LiveDashboard';

/**
 * System readiness — everything that has to be configured for the platform to
 * run end to end, as one uniform row.
 *
 * A configured step carries a check; an unconfigured one is the same chip
 * without it, and clicking it opens the tab where that step is set up. Missing
 * work is therefore never a separate call-to-action competing for attention —
 * the row itself is the control.
 */

interface SystemReadinessProps {
  items: SetupItem[];
  onAction?: (action: string) => void;
}

export function SystemReadiness({ items, onAction }: SystemReadinessProps) {
  const { t, isRTL } = useLanguage();

  if (!items.length) return null;

  const missing = items.filter(item => !item.completed);
  const ready = missing.length === 0;
  const bodyFont = isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif';
  const displayFont = isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif';

  const shortLabel = (id: string): string => {
    const labels: Record<string, string> = {
      website: t('checklist.website') || 'Website',
      services: t('checklist.services') || 'Services',
      availability: t('checklist.availability') || 'Hours',
      payments: t('checklist.payments') || 'Payments',
      calendar: t('checklist.calendar') || 'Calendar',
      intake: t('checklist.intake') || 'Intake form',
    };
    return labels[id] || id;
  };

  return (
    <div
      style={{
        direction: isRTL ? 'rtl' : 'ltr',
        marginBottom: '16px',
        padding: '14px 16px',
        borderRadius: '18px',
        background: ready
          ? 'linear-gradient(180deg, #F2FCF8, #FFFFFF)'
          : 'linear-gradient(180deg, #FFFAF4, #FFFFFF)',
        border: `1px solid ${ready ? '#CDECDD' : '#F3D9BE'}`,
      }}
    >
      {/* Verdict + how many still need configuring */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          marginBottom: '11px',
        }}
      >
        <span
          style={{
            fontFamily: displayFont,
            fontSize: '14.5px',
            fontWeight: 600,
            letterSpacing: '-0.01em',
            color: '#131A2B',
            minWidth: 0,
          }}
        >
          {ready
            ? (t('readiness.ready') || 'Your system is ready')
            : (t('readiness.title') || "What's missing before this works")}
        </span>
        {!ready && (
          <span
            style={{
              padding: '3px 10px',
              borderRadius: '99px',
              background: '#FFF1E3',
              color: '#B45309',
              fontFamily: bodyFont,
              fontSize: '12px',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {missing.length} {t('readiness.missing') || 'missing'}
          </span>
        )}
      </div>

      {/* One row, one chip per step. Configured chips carry the check; the rest
          are the same chip without it, and open their own settings tab. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px' }}>
        {items.map(item => {
          const done = item.completed;
          return (
            <button
              key={item.id}
              onClick={() => !done && item.action && onAction?.(item.action)}
              disabled={done}
              title={done ? undefined : item.description}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '7px 12px',
                borderRadius: '99px',
                background: '#FFFFFF',
                border: `1px solid ${done ? '#CDECDD' : '#F0C9A0'}`,
                color: done ? '#1F7A55' : '#B45309',
                fontFamily: bodyFont,
                fontSize: '13px',
                fontWeight: 500,
                cursor: done ? 'default' : 'pointer',
                whiteSpace: 'nowrap',
                transition: 'border-color 0.15s, background 0.15s',
              }}
              onMouseEnter={e => {
                if (done) return;
                e.currentTarget.style.borderColor = '#F97316';
                e.currentTarget.style.background = '#FFF8F1';
              }}
              onMouseLeave={e => {
                if (done) return;
                e.currentTarget.style.borderColor = '#F0C9A0';
                e.currentTarget.style.background = '#FFFFFF';
              }}
            >
              {done && (
                <Check className="w-3 h-3" style={{ color: '#10B981', strokeWidth: 3.5, flexShrink: 0 }} />
              )}
              {shortLabel(item.id)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
