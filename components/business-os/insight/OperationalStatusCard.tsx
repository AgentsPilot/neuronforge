'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  CreditCard,
  Calendar,
  Settings,
  Users,
  Clock,
  Globe,
  Link2,
  ChevronRight,
  X,
  Activity,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';

// ===========================
// Types
// ===========================

interface SetupStep {
  id: string;
  complete: boolean;
  dismissed?: boolean;
}

interface SetupStatus {
  steps: SetupStep[];
  completedCount: number;
  totalCount: number;
  allComplete: boolean;
  dismissed: boolean;
  dismissedSteps?: string[];
}

interface BusinessMetrics {
  sessionsToday: number;
  sessionsThisWeek: number;
  pendingPayments: number;
  pendingPaymentsAmount: number;
  activeClients: number;
}

interface OperationalStatusCardProps {
  onConfigureClick?: (stepId: string) => void;
}

// ===========================
// Step Config
// ===========================

const STEP_CONFIG: Record<string, {
  icon: LucideIcon;
  label: string;
  color: string;
  route: string;
}> = {
  services: {
    icon: Settings,
    label: 'Services',
    color: '#F97316',
    route: '/business-os/settings?tab=services',
  },
  availability: {
    icon: Clock,
    label: 'Hours',
    color: '#22C58B',
    route: '/business-os/settings?tab=availability',
  },
  payments: {
    icon: CreditCard,
    label: 'Payments',
    color: '#8B5CF6',
    route: '/business-os/settings?tab=payments',
  },
  calendar: {
    icon: Link2,
    label: 'Calendar',
    color: '#4F6EF7',
    route: '/business-os/settings?tab=integrations',
  },
  website: {
    icon: Globe,
    label: 'Website',
    color: '#EC4899',
    route: '/business-os/website',
  },
};

// ===========================
// Component
// ===========================

export function OperationalStatusCard({ onConfigureClick }: OperationalStatusCardProps) {
  const { t, isRTL, formatCurrency } = useLanguage();
  const router = useRouter();
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [metrics, setMetrics] = useState<BusinessMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [localDismissedSteps, setLocalDismissedSteps] = useState<Set<string>>(new Set());

  // Fetch setup status and metrics
  useEffect(() => {
    let isMounted = true;

    async function fetchSetupStatus() {
      try {
        const statusRes = await fetch('/api/business-os/setup-status');
        if (statusRes.ok && isMounted) {
          const statusData = await statusRes.json();
          if (statusData.success) {
            setSetupStatus(statusData.status);
            if (statusData.status.dismissedSteps) {
              setLocalDismissedSteps(new Set(statusData.status.dismissedSteps));
            }
          }
        }
      } catch {
        // Silently fail
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    async function fetchMetrics() {
      try {
        const metricsRes = await fetch('/api/business-os/metrics/summary');
        if (metricsRes.ok && isMounted) {
          const metricsData = await metricsRes.json();
          if (metricsData.success) {
            setMetrics(metricsData.data);
          }
        }
      } catch {
        // Silently fail
      }
    }

    fetchSetupStatus();
    fetchMetrics();

    return () => { isMounted = false; };
  }, []);

  // Dismiss a step
  const handleDismissStep = async (stepId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setLocalDismissedSteps(prev => new Set([...prev, stepId]));

    try {
      const res = await fetch('/api/business-os/setup-status/dismiss-step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ stepId }),
      });

      if (!res.ok) {
        setLocalDismissedSteps(prev => {
          const next = new Set(prev);
          next.delete(stepId);
          return next;
        });
      }
    } catch {
      setLocalDismissedSteps(prev => {
        const next = new Set(prev);
        next.delete(stepId);
        return next;
      });
    }
  };

  // Get incomplete steps
  const incompleteSteps = setupStatus?.steps.filter(
    s => !s.complete && !localDismissedSteps.has(s.id)
  ) || [];
  const completedSteps = setupStatus?.steps.filter(s => s.complete) || [];
  const hasIncompleteSetup = incompleteSteps.length > 0;
  const totalSteps = setupStatus?.totalCount || 5;
  const completedCount = completedSteps.length;

  // Loading state
  if (loading) {
    return (
      <div
        className="animate-pulse"
        style={{
          background: 'var(--v2-bg)',
          border: '1px solid var(--v2-border)',
          borderRadius: '20px',
          padding: '20px',
        }}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-[var(--v2-surface)] rounded-xl" />
          <div className="flex-1">
            <div className="h-4 bg-[var(--v2-surface)] rounded w-24 mb-2" />
            <div className="h-3 bg-[var(--v2-surface)] rounded w-16" />
          </div>
        </div>
        <div className="h-1.5 bg-[var(--v2-surface)] rounded-full mb-4" />
        <div className="flex gap-2 mb-4">
          <div className="h-9 bg-[var(--v2-surface)] rounded-lg w-24" />
          <div className="h-9 bg-[var(--v2-surface)] rounded-lg w-24" />
        </div>
        <div className="h-16 bg-[var(--v2-surface)] rounded-xl" />
      </div>
    );
  }

  return (
    <div
      className="relative overflow-hidden"
      style={{
        direction: isRTL ? 'rtl' : 'ltr',
        background: 'var(--v2-bg)',
        border: '1px solid var(--v2-border)',
        borderRadius: '20px',
        padding: '20px',
      }}
    >
      {/* Header */}
      <div className="mb-4">
        <div className="flex items-center gap-3">
          {/* Status Icon */}
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              background: hasIncompleteSetup
                ? 'rgba(249, 115, 22, 0.12)'
                : 'rgba(34, 197, 139, 0.12)',
            }}
          >
            <Activity
              className="w-[18px] h-[18px]"
              style={{ color: hasIncompleteSetup ? '#F97316' : '#22C58B' }}
              strokeWidth={2}
            />
          </div>

          {/* Title & Progress Text */}
          <div className="flex-1 min-w-0">
            <h3
              className="text-[var(--v2-text-primary)] mb-0.5"
              style={{
                fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif',
                fontSize: '15px',
                fontWeight: 600,
              }}
            >
              {hasIncompleteSetup
                ? (t('myday.status.quick_setup') || 'Quick Setup')
                : (t('myday.status.all_set') || 'All Set!')}
            </h3>
            <span className="text-xs text-[var(--v2-text-muted)]">
              {completedCount}/{totalSteps} {t('myday.status.completed') || 'completed'}
            </span>
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div
        className="mb-4 overflow-hidden"
        style={{
          height: '6px',
          background: 'var(--v2-surface)',
          borderRadius: '3px',
        }}
      >
        <div
          className="h-full transition-all duration-500"
          style={{
            width: `${(completedCount / totalSteps) * 100}%`,
            background: hasIncompleteSetup
              ? 'linear-gradient(90deg, #F59E0B, #F97316)'
              : 'var(--v2-success, #22C55E)',
            borderRadius: '3px',
          }}
        />
      </div>

      {/* Setup Pills */}
      {hasIncompleteSetup && (
        <div className="flex flex-wrap gap-2 mb-4">
          {incompleteSteps.slice(0, 4).map((step) => {
            const config = STEP_CONFIG[step.id];
            if (!config) return null;
            const Icon = config.icon;

            return (
              <button
                key={step.id}
                onClick={() => {
                  // Use callback if provided, otherwise fallback to router
                  if (onConfigureClick) {
                    onConfigureClick(step.id);
                  } else {
                    router.push(config.route);
                  }
                }}
                className="group flex items-center gap-1.5 px-3 py-2 rounded-lg transition-all hover:border-[var(--v2-border-hover)]"
                style={{
                  background: 'var(--v2-surface)',
                  border: '1px solid transparent',
                  fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : 'inherit',
                  fontSize: '12px',
                  fontWeight: 500,
                }}
              >
                <Icon
                  className="w-3.5 h-3.5 flex-shrink-0"
                  style={{ color: config.color }}
                  strokeWidth={2}
                />
                <span className="text-[var(--v2-text-primary)]">
                  {t(`setup.${step.id}`) || config.label}
                </span>
                <ChevronRight
                  className="w-3 h-3 text-[var(--v2-text-muted)] transition-transform group-hover:-translate-x-0.5"
                  style={{ transform: isRTL ? 'rotate(180deg)' : undefined }}
                  strokeWidth={2}
                />
                {/* Dismiss X on hover */}
                <span
                  onClick={(e) => handleDismissStep(step.id, e)}
                  className="p-0.5 rounded hover:bg-[var(--v2-border)] opacity-0 group-hover:opacity-100 transition-opacity"
                  title={t('setup.dismiss') || 'Skip'}
                >
                  <X className="w-3 h-3 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-secondary)]" strokeWidth={2} />
                </span>
              </button>
            );
          })}
          {incompleteSteps.length > 4 && (
            <span className="flex items-center px-2 py-2 text-xs text-[var(--v2-text-muted)]">
              +{incompleteSteps.length - 4} {t('common.more') || 'more'}
            </span>
          )}
        </div>
      )}

      {/* Metrics Row */}
      <div
        className="flex items-center justify-between"
        style={{
          background: 'var(--v2-surface)',
          borderRadius: '14px',
          padding: '14px 16px',
        }}
      >
        {/* Sessions Today */}
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-[10px] flex items-center justify-center"
            style={{ background: 'rgba(59, 130, 246, 0.12)' }}
          >
            <Calendar className="w-3.5 h-3.5" style={{ color: '#3B82F6' }} strokeWidth={2} />
          </div>
          <div className="flex flex-col">
            <span
              className="text-[var(--v2-text-primary)] leading-tight"
              style={{
                fontFamily: '"Space Grotesk", system-ui, sans-serif',
                fontSize: '16px',
                fontWeight: 700,
              }}
            >
              {metrics?.sessionsToday ?? 0}
            </span>
            <span className="text-[10px] text-[var(--v2-text-muted)] leading-tight">
              {t('myday.metric.today') || 'Today'}
            </span>
          </div>
        </div>

        {/* Divider */}
        <div className="w-px h-8 bg-[var(--v2-border)]" />

        {/* Active Clients */}
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-[10px] flex items-center justify-center"
            style={{ background: 'rgba(34, 197, 94, 0.12)' }}
          >
            <Users className="w-3.5 h-3.5" style={{ color: '#22C55E' }} strokeWidth={2} />
          </div>
          <div className="flex flex-col">
            <span
              className="text-[var(--v2-text-primary)] leading-tight"
              style={{
                fontFamily: '"Space Grotesk", system-ui, sans-serif',
                fontSize: '16px',
                fontWeight: 700,
              }}
            >
              {metrics?.activeClients ?? 0}
            </span>
            <span className="text-[10px] text-[var(--v2-text-muted)] leading-tight">
              {t('myday.metric.clients') || 'Clients'}
            </span>
          </div>
        </div>

        {/* Divider */}
        <div className="w-px h-8 bg-[var(--v2-border)]" />

        {/* Pending Payments */}
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-[10px] flex items-center justify-center"
            style={{
              background: (metrics?.pendingPayments ?? 0) > 0
                ? 'rgba(245, 158, 11, 0.12)'
                : 'var(--v2-surface)'
            }}
          >
            <CreditCard
              className="w-3.5 h-3.5"
              style={{
                color: (metrics?.pendingPayments ?? 0) > 0 ? '#F59E0B' : 'var(--v2-text-muted)'
              }}
              strokeWidth={2}
            />
          </div>
          <div className="flex flex-col">
            <span
              className="text-[var(--v2-text-primary)] leading-tight"
              style={{
                fontFamily: '"Space Grotesk", system-ui, sans-serif',
                fontSize: '16px',
                fontWeight: 700,
              }}
            >
              {formatCurrency(metrics?.pendingPaymentsAmount ?? 0, { showFree: false })}
            </span>
            <span className="text-[10px] text-[var(--v2-text-muted)] leading-tight">
              {t('myday.metric.pending') || 'Pending'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
