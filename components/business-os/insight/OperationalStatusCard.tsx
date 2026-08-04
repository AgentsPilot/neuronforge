'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  CreditCard,
  Calendar,
  CheckCircle2,
  Settings,
  Users,
  Clock,
  Globe,
  Link2,
  ChevronRight,
  X,
  Activity,
} from 'lucide-react';
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
  icon: typeof CreditCard;
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
  const { t, isRTL } = useLanguage();
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
      <div className="bg-[var(--v2-bg)] rounded-2xl border border-[var(--v2-border)] p-4 animate-pulse">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 bg-[var(--v2-surface)] rounded-xl" />
          <div className="flex-1">
            <div className="h-4 bg-[var(--v2-surface)] rounded w-24 mb-1" />
            <div className="h-3 bg-[var(--v2-surface)] rounded w-32" />
          </div>
        </div>
        <div className="h-2 bg-[var(--v2-surface)] rounded-full" />
      </div>
    );
  }

  return (
    <div
      className="bg-[var(--v2-bg)] rounded-2xl border border-[var(--v2-border)] overflow-hidden"
      style={{ direction: isRTL ? 'rtl' : 'ltr' }}
    >
      {/* Header Section */}
      <div className="p-4 pb-3">
        <div className="flex items-center gap-3">
          {/* Status Icon - tinted background matching platform standard */}
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              background: hasIncompleteSetup
                ? 'rgba(249, 115, 22, 0.12)'
                : 'rgba(34, 197, 139, 0.12)',
            }}
          >
            {hasIncompleteSetup ? (
              <Activity className="w-5 h-5" style={{ color: '#F97316' }} strokeWidth={2} />
            ) : (
              <Activity className="w-5 h-5" style={{ color: '#22C58B' }} strokeWidth={2} />
            )}
          </div>

          {/* Title & Progress */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-[var(--v2-text-primary)] truncate">
                {hasIncompleteSetup
                  ? (t('myday.status.quick_setup') || 'Quick Setup')
                  : (t('myday.status.all_set') || 'All Set!')}
              </h3>
              <span className="text-xs text-[var(--v2-text-muted)] flex-shrink-0">
                {completedCount}/{totalSteps}
              </span>
            </div>
            {/* Progress Bar */}
            <div className="mt-1.5 h-1.5 bg-[var(--v2-surface)] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${(completedCount / totalSteps) * 100}%`,
                  background: hasIncompleteSetup
                    ? 'linear-gradient(90deg, #F59E0B 0%, #F97316 100%)'
                    : 'linear-gradient(90deg, #10B981 0%, #059669 100%)',
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Setup Items - Compact Pills */}
      {hasIncompleteSetup && (
        <div className="px-4 pb-3">
          <div className="flex flex-wrap gap-1.5">
            {incompleteSteps.slice(0, 4).map((step) => {
              const config = STEP_CONFIG[step.id];
              if (!config) return null;
              const Icon = config.icon;

              return (
                <button
                  key={step.id}
                  onClick={() => {
                    onConfigureClick?.(step.id);
                    router.push(config.route);
                  }}
                  className="group flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--v2-surface)] hover:bg-[var(--v2-surface-hover,var(--v2-surface))] border border-transparent hover:border-[var(--v2-border)] transition-all text-xs"
                >
                  <Icon
                    className="w-3.5 h-3.5 flex-shrink-0"
                    style={{ color: config.color }}
                    strokeWidth={2}
                  />
                  <span className="text-[var(--v2-text-primary)] font-medium">
                    {t(`setup.${step.id}`) || config.label}
                  </span>
                  <ChevronRight className="w-3 h-3 text-[var(--v2-text-muted)] group-hover:text-[var(--v2-text-secondary)] transition-colors" strokeWidth={2} />
                  {/* Dismiss X on hover */}
                  <span
                    onClick={(e) => handleDismissStep(step.id, e)}
                    className="ml-0.5 p-0.5 rounded hover:bg-[var(--v2-border)] opacity-0 group-hover:opacity-100 transition-opacity"
                    title={t('setup.dismiss') || "Skip"}
                  >
                    <X className="w-3 h-3 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-secondary)]" strokeWidth={2} />
                  </span>
                </button>
              );
            })}
            {incompleteSteps.length > 4 && (
              <span className="flex items-center px-2 py-1.5 text-xs text-[var(--v2-text-muted)]">
                +{incompleteSteps.length - 4} {t('common.more') || 'more'}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Metrics Row - Always visible */}
      <div
        className="px-4 py-3 border-t border-[var(--v2-border)] bg-[var(--v2-surface)]"
      >
        <div className="flex items-center justify-between gap-4">
          {/* Sessions Today */}
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-blue-500/10">
              <Calendar className="w-3.5 h-3.5 text-blue-500" strokeWidth={2} />
            </div>
            <div>
              <span className="block text-sm font-bold text-[var(--v2-text-primary)] leading-tight">
                {metrics?.sessionsToday ?? 0}
              </span>
              <span className="block text-[10px] text-[var(--v2-text-muted)] leading-tight">
                {t('myday.metric.today') || 'Today'}
              </span>
            </div>
          </div>

          {/* Divider */}
          <div className="w-px h-8 bg-[var(--v2-border)]" />

          {/* Active Clients */}
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-emerald-500/10">
              <Users className="w-3.5 h-3.5 text-emerald-500" strokeWidth={2} />
            </div>
            <div>
              <span className="block text-sm font-bold text-[var(--v2-text-primary)] leading-tight">
                {metrics?.activeClients ?? 0}
              </span>
              <span className="block text-[10px] text-[var(--v2-text-muted)] leading-tight">
                {t('myday.metric.clients') || 'Clients'}
              </span>
            </div>
          </div>

          {/* Divider */}
          <div className="w-px h-8 bg-[var(--v2-border)]" />

          {/* Pending Payments */}
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{
                background: (metrics?.pendingPayments ?? 0) > 0 ? 'rgba(217, 119, 6, 0.15)' : 'var(--v2-surface)'
              }}
            >
              <CreditCard
                className="w-3.5 h-3.5"
                style={{ color: (metrics?.pendingPayments ?? 0) > 0 ? '#D97706' : 'var(--v2-text-muted)' }}
                strokeWidth={2}
              />
            </div>
            <div>
              <span className="block text-sm font-bold text-[var(--v2-text-primary)] leading-tight">
                {(metrics?.pendingPayments ?? 0) > 0
                  ? `$${(metrics?.pendingPaymentsAmount ?? 0).toLocaleString()}`
                  : '$0'}
              </span>
              <span className="block text-[10px] text-[var(--v2-text-muted)] leading-tight">
                {t('myday.metric.pending') || 'Pending'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
