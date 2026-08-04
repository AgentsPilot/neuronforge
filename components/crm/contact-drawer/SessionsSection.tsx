'use client';

import { useState } from 'react';
import { Calendar, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SessionCard } from '../SessionCard';
import { CollapsibleSection } from '../CollapsibleSection';
import type { SessionCardData, Appointment, SessionPayment, IntakeTemplate } from './types';

interface SessionsSectionProps {
  sessions: SessionCardData[];
  t: (key: string) => string;
  isRTL: boolean;
  language: string;
  onNewSession?: () => void;
  onEditSession?: (bookingId: string) => void;
  onViewIntake?: (bookingId: string) => void;
  isLoading?: boolean;
  intakeTemplates?: Record<string, IntakeTemplate>;
}

export function SessionsSection({
  sessions,
  t,
  isRTL,
  language,
  onNewSession,
  onEditSession,
  onViewIntake,
  isLoading = false,
  intakeTemplates = {}
}: SessionsSectionProps) {
  const [showAll, setShowAll] = useState(false);

  // Sort sessions: upcoming first, then by date descending
  const sortedSessions = [...sessions].sort((a, b) => {
    const now = new Date();
    const aDate = new Date(a.booking.start_time);
    const bDate = new Date(b.booking.start_time);
    const aUpcoming = a.booking.status === 'confirmed' && aDate > now;
    const bUpcoming = b.booking.status === 'confirmed' && bDate > now;

    // Upcoming sessions first
    if (aUpcoming && !bUpcoming) return -1;
    if (!aUpcoming && bUpcoming) return 1;

    // Then sort by date (newest first for past, nearest first for upcoming)
    if (aUpcoming && bUpcoming) {
      return aDate.getTime() - bDate.getTime(); // Nearest upcoming first
    }
    return bDate.getTime() - aDate.getTime(); // Most recent past first
  });

  // Show limited sessions unless showAll
  const displayedSessions = showAll ? sortedSessions : sortedSessions.slice(0, 3);
  const hasMore = sortedSessions.length > 3;

  // Count upcoming and completed
  const now = new Date();
  const upcomingCount = sessions.filter(s =>
    s.booking.status === 'confirmed' && new Date(s.booking.start_time) > now
  ).length;
  const completedCount = sessions.filter(s => s.booking.status === 'completed').length;

  return (
    <CollapsibleSection
      title={t('crm.drawer.section_sessions') || 'Sessions'}
      icon={<Calendar className="h-4 w-4 text-[var(--v2-text-muted)]" />}
      defaultOpen={true}
      isRTL={isRTL}
      badge={
        sessions.length > 0 && (
          <span className="text-xs text-[var(--v2-text-muted)]">
            {upcomingCount > 0 && (
              <span className="text-amber-500">{upcomingCount} {t('crm.drawer.upcoming')}</span>
            )}
            {upcomingCount > 0 && completedCount > 0 && ' • '}
            {completedCount > 0 && (
              <span className="text-green-500">{completedCount} {t('crm.drawer.completed')}</span>
            )}
          </span>
        )
      }
      actionButton={
        onNewSession && (
          <Button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNewSession();
            }}
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[#8B5CF6] hover:bg-[#8B5CF6]/10"
          >
            <Plus className="h-4 w-4 me-1" />
            {t('crm.drawer.new_session') || 'New'}
          </Button>
        )
      }
    >
      <div className="space-y-3" dir={isRTL ? 'rtl' : 'ltr'}>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="border border-[var(--v2-border)] rounded-lg p-4 animate-pulse">
                <div className="h-4 bg-[var(--v2-border)] rounded w-3/4 mb-2" />
                <div className="h-3 bg-[var(--v2-border)] rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-6">
            <Calendar className="h-10 w-10 text-[var(--v2-text-muted)] mx-auto mb-2" />
            <p className="text-sm text-[var(--v2-text-muted)]">
              {t('crm.drawer.no_sessions') || 'No sessions yet'}
            </p>
            {onNewSession && (
              <Button
                type="button"
                onClick={onNewSession}
                size="sm"
                className="mt-3 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white"
              >
                <Plus className="h-4 w-4 me-1" />
                {t('crm.drawer.schedule_first') || 'Schedule first session'}
              </Button>
            )}
          </div>
        ) : (
          <>
            {displayedSessions.map((session) => {
              // Get intake template for this session if it has intake responses
              const templateId = session.booking.intake_responses?.template_id;
              const template = templateId ? intakeTemplates[templateId] : undefined;

              return (
                <SessionCard
                  key={session.booking.id}
                  session={session}
                  locale={language}
                  isRTL={isRTL}
                  t={t}
                  onEdit={onEditSession}
                  onViewIntake={onViewIntake}
                  intakeTemplate={template}
                />
              );
            })}

            {hasMore && (
              <button
                type="button"
                onClick={() => setShowAll(!showAll)}
                className="w-full py-2 text-sm text-[#8B5CF6] hover:text-[#7C3AED] transition-colors"
              >
                {showAll
                  ? t('crm.drawer.show_less') || 'Show less'
                  : t('crm.drawer.show_all', { count: sortedSessions.length }) || `Show all ${sortedSessions.length} sessions`
                }
              </button>
            )}
          </>
        )}
      </div>
    </CollapsibleSection>
  );
}
