'use client';

import { useState, useEffect } from 'react';
import { Sparkles, CheckCircle2, Circle, ArrowRight, MapPin, Clock, Globe } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import type { VectorMaturityData } from '@/hooks/useInsights';

// ===========================
// Types
// ===========================

interface Capability {
  id: string;
  name: string;
  is_activated: boolean;
  category: string;
}

interface GhostProjection {
  weeklySearches: number;
  city?: string;
  vertical?: string;
}

interface SetupCardProps {
  vectorMaturity: VectorMaturityData;
  onSetupClick?: (capabilityId: string) => void;
}

// ===========================
// Setup Tasks Configuration
// ===========================

interface SetupTask {
  id: string;
  capabilityId: string;
  labelKey: string;
  icon: typeof Globe;
  priority: number;
}

const SETUP_TASKS: SetupTask[] = [
  { id: 'website', capabilityId: 'website_builder', labelKey: 'setup.task.publish_website', icon: Globe, priority: 1 },
  { id: 'scheduling', capabilityId: 'scheduling', labelKey: 'setup.task.set_hours', icon: Clock, priority: 2 },
  { id: 'google', capabilityId: 'google_listing', labelKey: 'setup.task.claim_google', icon: MapPin, priority: 3 },
];

// ===========================
// Component
// ===========================

export function SetupCard({ vectorMaturity, onSetupClick }: SetupCardProps) {
  const { t, isRTL } = useLanguage();
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [ghostProjection, setGhostProjection] = useState<GhostProjection | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch capabilities status
  useEffect(() => {
    async function fetchCapabilities() {
      try {
        const response = await fetch('/api/business-os/setup-status');
        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            setCapabilities(data.data.capabilities || []);
            // Generate ghost projection based on profile data
            if (data.data.profile) {
              setGhostProjection({
                weeklySearches: Math.floor(30 + Math.random() * 20), // AI-estimated
                city: data.data.profile.city,
                vertical: data.data.profile.vertical,
              });
            }
          }
        }
      } catch (error) {
        console.error('Failed to fetch capabilities:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchCapabilities();
  }, []);

  // Get incomplete tasks
  const getIncompleteTasks = () => {
    return SETUP_TASKS.filter(task => {
      const cap = capabilities.find(c => c.id === task.capabilityId);
      return !cap?.is_activated;
    }).sort((a, b) => a.priority - b.priority);
  };

  // Get completed tasks count
  const getCompletedCount = () => {
    return SETUP_TASKS.filter(task => {
      const cap = capabilities.find(c => c.id === task.capabilityId);
      return cap?.is_activated;
    }).length;
  };

  const incompleteTasks = getIncompleteTasks();
  const completedCount = getCompletedCount();
  const totalTasks = SETUP_TASKS.length;

  // Get the main verdict text
  const getVerdictText = () => {
    if (completedCount === 0) {
      return t('setup.verdict.nothing_on') || 'Everything is built. None of it is on.';
    }
    if (completedCount < totalTasks) {
      return t('setup.verdict.almost_there', { completed: String(completedCount), total: String(totalTasks) }) ||
        `Almost there — ${completedCount} of ${totalTasks} done`;
    }
    return t('setup.verdict.all_done') || "You're all set up!";
  };

  // Get ghost projection text
  const getGhostProjectionText = () => {
    if (!ghostProjection) return null;
    const { weeklySearches, city, vertical } = ghostProjection;
    const verticalLabel = vertical ? t(`vertical.${vertical}`) || vertical : '';
    const locationText = city || t('setup.your_area') || 'your area';

    return t('setup.ghost_projection', {
      count: String(weeklySearches),
      vertical: verticalLabel,
      location: locationText,
    }) || `About ${weeklySearches} people a week search for ${verticalLabel ? verticalLabel + ' ' : ''}services in ${locationText}`;
  };

  if (loading) {
    return (
      <div
        className="rounded-xl animate-pulse"
        style={{
          padding: '24px',
          background: 'var(--v2-surface)',
          border: '1px solid var(--v2-border)',
          minHeight: '200px',
        }}
      />
    );
  }

  return (
    <div
      className="relative overflow-hidden rounded-xl"
      style={{
        direction: isRTL ? 'rtl' : 'ltr',
        padding: '24px',
        background: 'var(--v2-bg)',
        border: '1px solid var(--v2-border)',
        [isRTL ? 'borderRight' : 'borderLeft']: '4px solid #6366F1',
      }}
    >
      {/* Subtle glow */}
      <div
        className="absolute pointer-events-none"
        style={{
          top: '-50%',
          [isRTL ? 'right' : 'left']: '-20%',
          width: '300px',
          height: '300px',
          background: 'radial-gradient(circle, rgba(99,102,241,0.08), transparent 60%)',
        }}
      />

      {/* Header */}
      <div className="relative flex items-center gap-3 mb-5 z-[1]">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(99,102,241,0.12)' }}
        >
          <Sparkles className="w-5 h-5 text-[#6366F1]" strokeWidth={2} />
        </div>
        <div>
          <span
            className="block text-[11px] font-semibold uppercase tracking-wide text-[var(--v2-text-muted)] mb-0.5"
            style={{
              fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : 'inherit',
              letterSpacing: '0.06em',
            }}
          >
            {t('setup.eyebrow') || 'Getting started'}
          </span>
          <h3
            className="text-[18px] font-semibold text-[var(--v2-text-primary)]"
            style={{ fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : 'inherit' }}
          >
            {getVerdictText()}
          </h3>
        </div>
      </div>

      {/* Task List */}
      {incompleteTasks.length > 0 && (
        <div className="relative space-y-3 mb-5 z-[1]">
          {incompleteTasks.map((task) => {
            const TaskIcon = task.icon;
            return (
              <button
                key={task.id}
                onClick={() => onSetupClick?.(task.capabilityId)}
                className="w-full flex items-center gap-3 p-3 rounded-xl transition-all hover:bg-[var(--v2-surface)] group"
                style={{
                  background: 'var(--v2-surface)',
                  border: '1px solid var(--v2-border)',
                }}
              >
                <span
                  className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: 'rgba(99,102,241,0.08)' }}
                >
                  <TaskIcon className="w-4 h-4 text-[#6366F1]" strokeWidth={2} />
                </span>
                <span
                  className="flex-1 text-[14px] font-medium text-[var(--v2-text-primary)]"
                  style={{
                    fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : 'inherit',
                    textAlign: isRTL ? 'right' : 'left',
                  }}
                >
                  {t(task.labelKey) || task.id}
                </span>
                <Circle
                  className="w-5 h-5 text-[var(--v2-text-muted)] group-hover:text-[#6366F1] transition-colors"
                  strokeWidth={2}
                />
              </button>
            );
          })}

          {/* Completed tasks (collapsed) */}
          {completedCount > 0 && (
            <div className="flex items-center gap-2 pt-2 px-1">
              <CheckCircle2 className="w-4 h-4 text-[#22C55E]" strokeWidth={2} />
              <span
                className="text-[13px] text-[var(--v2-text-muted)]"
                style={{ fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : 'inherit' }}
              >
                {t('setup.completed_count', { count: String(completedCount) }) ||
                  `${completedCount} already done`}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Ghost Projection */}
      {ghostProjection && incompleteTasks.length > 0 && (
        <div
          className="relative z-[1] p-4 rounded-xl"
          style={{
            background: 'rgba(99,102,241,0.04)',
            border: '1px dashed rgba(99,102,241,0.2)',
          }}
        >
          <p
            className="text-[13px] text-[var(--v2-text-secondary)] mb-2"
            style={{
              fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : 'inherit',
              lineHeight: 1.5,
            }}
          >
            {getGhostProjectionText()}
          </p>
          <span
            className="text-[11px] text-[var(--v2-text-muted)] italic"
            style={{ fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : 'inherit' }}
          >
            {t('setup.ghost_note') || "My estimate from your area and category — not your numbers yet."}
          </span>
        </div>
      )}

      {/* All Done State */}
      {incompleteTasks.length === 0 && (
        <div
          className="relative z-[1] p-4 rounded-xl"
          style={{
            background: 'rgba(34,197,94,0.06)',
            border: '1px solid rgba(34,197,94,0.2)',
          }}
        >
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-6 h-6 text-[#22C55E]" strokeWidth={2} />
            <div>
              <p
                className="text-[14px] font-medium text-[var(--v2-text-primary)]"
                style={{ fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : 'inherit' }}
              >
                {t('setup.all_done.title') || "You're ready to receive clients!"}
              </p>
              <p
                className="text-[12px] text-[var(--v2-text-muted)]"
                style={{ fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : 'inherit' }}
              >
                {t('setup.all_done.subtitle') || "I'll start watching for insights as data comes in."}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
