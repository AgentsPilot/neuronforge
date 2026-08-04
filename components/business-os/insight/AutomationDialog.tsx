'use client';

import { useState } from 'react';
import { X, Zap, Clock, Bell, Settings, Play, Pause, Trash2 } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';

// ===========================
// Types
// ===========================

export interface AutomationData {
  id: string;
  detector_id: string;
  kernel_process_id: string;
  process_parameters: Record<string, unknown>;
  trigger_condition: Record<string, unknown>;
  check_interval_minutes: number;
  max_items_per_run: number;
  quiet_hours_start: number;
  quiet_hours_end: number;
  is_active: boolean;
  run_count: number;
  last_run_at: string | null;
  total_items_processed: number;
  total_value_impact: number;
  created_at: string;
}

export interface AutomationProcessInfo {
  id: string;
  name: string;
  description: string;
  parameters: Array<{
    id: string;
    label: string;
    type: string;
    default: unknown;
    options?: Array<{ value: string; label: string }>;
    min?: number;
    max?: number;
  }>;
}

interface AutomationDialogProps {
  mode: 'create' | 'edit' | 'view';
  automation?: AutomationData;
  process: AutomationProcessInfo;
  insightTitle?: string;
  isOpen: boolean;
  onClose: () => void;
  onCreate?: (params: {
    processParameters: Record<string, unknown>;
    checkIntervalMinutes: number;
    maxItemsPerRun: number;
    quietHoursStart: number;
    quietHoursEnd: number;
  }) => Promise<void>;
  onUpdate?: (params: Partial<{
    processParameters: Record<string, unknown>;
    checkIntervalMinutes: number;
    maxItemsPerRun: number;
    quietHoursStart: number;
    quietHoursEnd: number;
  }>) => Promise<void>;
  onPause?: () => Promise<void>;
  onResume?: () => Promise<void>;
  onDelete?: () => Promise<void>;
  loading?: boolean;
}

// ===========================
// Component
// ===========================

export function AutomationDialog({
  mode,
  automation,
  process,
  insightTitle,
  isOpen,
  onClose,
  onCreate,
  onUpdate,
  onPause,
  onResume,
  onDelete,
  loading = false,
}: AutomationDialogProps) {
  const { t, isRTL } = useLanguage();

  // Form state
  const [processParameters, setProcessParameters] = useState<Record<string, unknown>>(
    automation?.process_parameters || {}
  );
  const [checkIntervalMinutes, setCheckIntervalMinutes] = useState(
    automation?.check_interval_minutes || 60
  );
  const [maxItemsPerRun, setMaxItemsPerRun] = useState(
    automation?.max_items_per_run || 20
  );
  const [quietHoursStart, setQuietHoursStart] = useState(
    automation?.quiet_hours_start || 22
  );
  const [quietHoursEnd, setQuietHoursEnd] = useState(
    automation?.quiet_hours_end || 8
  );

  const [actionLoading, setActionLoading] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleCreate = async () => {
    if (!onCreate) return;
    setActionLoading('create');
    try {
      await onCreate({
        processParameters,
        checkIntervalMinutes,
        maxItemsPerRun,
        quietHoursStart,
        quietHoursEnd,
      });
      onClose();
    } finally {
      setActionLoading(null);
    }
  };

  const handleUpdate = async () => {
    if (!onUpdate) return;
    setActionLoading('update');
    try {
      await onUpdate({
        processParameters,
        checkIntervalMinutes,
        maxItemsPerRun,
        quietHoursStart,
        quietHoursEnd,
      });
      onClose();
    } finally {
      setActionLoading(null);
    }
  };

  const handlePause = async () => {
    if (!onPause) return;
    setActionLoading('pause');
    try {
      await onPause();
    } finally {
      setActionLoading(null);
    }
  };

  const handleResume = async () => {
    if (!onResume) return;
    setActionLoading('resume');
    try {
      await onResume();
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    if (!confirm('Are you sure you want to delete this automation?')) return;
    setActionLoading('delete');
    try {
      await onDelete();
      onClose();
    } finally {
      setActionLoading(null);
    }
  };

  const formatHour = (hour: number) => {
    const suffix = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    return `${displayHour}:00 ${suffix}`;
  };

  const intervalOptions = [
    { value: 15, label: 'Every 15 minutes' },
    { value: 30, label: 'Every 30 minutes' },
    { value: 60, label: 'Every hour' },
    { value: 120, label: 'Every 2 hours' },
    { value: 360, label: 'Every 6 hours' },
    { value: 720, label: 'Every 12 hours' },
    { value: 1440, label: 'Once a day' },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0, 0, 0, 0.5)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="bg-[var(--v2-surface)] border border-[var(--v2-border)] w-full max-w-md max-h-[90vh] overflow-y-auto"
        style={{ borderRadius: '20px', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)' }}
        onClick={(e) => e.stopPropagation()}
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        {/* Header */}
        <div className="sticky top-0 bg-[var(--v2-surface)] border-b border-[var(--v2-border)] p-4 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 flex items-center justify-center"
              style={{ borderRadius: '12px', background: 'rgba(34, 197, 139, 0.1)' }}
            >
              <Zap className="w-5 h-5 text-[#22C58B]" />
            </div>
            <div>
              <h2
                className="text-lg font-semibold text-[var(--v2-text-primary)]"
                style={{ fontFamily: '"Space Grotesk", system-ui, sans-serif' }}
              >
                {mode === 'create' ? 'Create Automation' : mode === 'edit' ? 'Edit Automation' : 'Automation Details'}
              </h2>
              <p className="text-xs text-[var(--v2-text-muted)]">
                {process.name}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-[var(--v2-bg)] text-[var(--v2-text-muted)] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-5">
          {/* Insight context */}
          {insightTitle && mode === 'create' && (
            <div
              className="bg-[var(--v2-bg)] border border-[var(--v2-border)] p-3"
              style={{ borderRadius: '12px' }}
            >
              <p className="text-xs text-[var(--v2-text-muted)] mb-1">Based on insight:</p>
              <p className="text-sm text-[var(--v2-text-primary)] font-medium">{insightTitle}</p>
            </div>
          )}

          {/* Stats (view/edit mode) */}
          {automation && mode !== 'create' && (
            <div className="grid grid-cols-2 gap-3">
              <div
                className="bg-[var(--v2-bg)] border border-[var(--v2-border)] p-3"
                style={{ borderRadius: '12px' }}
              >
                <p className="text-xs text-[var(--v2-text-muted)] mb-1">Total Runs</p>
                <p className="text-lg font-semibold text-[var(--v2-text-primary)]">
                  {automation.run_count}
                </p>
              </div>
              <div
                className="bg-[var(--v2-bg)] border border-[var(--v2-border)] p-3"
                style={{ borderRadius: '12px' }}
              >
                <p className="text-xs text-[var(--v2-text-muted)] mb-1">Items Processed</p>
                <p className="text-lg font-semibold text-[var(--v2-text-primary)]">
                  {automation.total_items_processed}
                </p>
              </div>
              {automation.total_value_impact > 0 && (
                <div
                  className="col-span-2 bg-[rgba(34,197,139,0.05)] border border-[rgba(34,197,139,0.2)] p-3"
                  style={{ borderRadius: '12px' }}
                >
                  <p className="text-xs text-[#22C58B] mb-1">Total Value Impact</p>
                  <p className="text-lg font-semibold text-[#22C58B]">
                    ${automation.total_value_impact.toLocaleString()}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Process Parameters */}
          {process.parameters.length > 0 && (mode === 'create' || mode === 'edit') && (
            <div>
              <h3 className="text-sm font-semibold text-[var(--v2-text-primary)] mb-3 flex items-center gap-2">
                <Settings className="w-4 h-4" />
                Parameters
              </h3>
              <div className="space-y-3">
                {process.parameters.map((param) => (
                  <div key={param.id}>
                    <label className="text-xs text-[var(--v2-text-muted)] mb-1 block">
                      {param.label}
                    </label>
                    {param.type === 'select' && param.options ? (
                      <select
                        value={String(processParameters[param.id] || param.default)}
                        onChange={(e) => setProcessParameters({ ...processParameters, [param.id]: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-[var(--v2-border)] bg-[var(--v2-bg)] text-[var(--v2-text-primary)] text-sm"
                      >
                        {param.options.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    ) : param.type === 'number' ? (
                      <input
                        type="number"
                        value={Number(processParameters[param.id] || param.default)}
                        onChange={(e) => setProcessParameters({ ...processParameters, [param.id]: Number(e.target.value) })}
                        min={param.min}
                        max={param.max}
                        className="w-full px-3 py-2 rounded-lg border border-[var(--v2-border)] bg-[var(--v2-bg)] text-[var(--v2-text-primary)] text-sm"
                      />
                    ) : param.type === 'boolean' ? (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(processParameters[param.id] ?? param.default)}
                          onChange={(e) => setProcessParameters({ ...processParameters, [param.id]: e.target.checked })}
                          className="w-4 h-4"
                        />
                        <span className="text-sm text-[var(--v2-text-secondary)]">Enabled</span>
                      </label>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Schedule Settings */}
          {(mode === 'create' || mode === 'edit') && (
            <div>
              <h3 className="text-sm font-semibold text-[var(--v2-text-primary)] mb-3 flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Schedule
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-[var(--v2-text-muted)] mb-1 block">
                    Check Frequency
                  </label>
                  <select
                    value={checkIntervalMinutes}
                    onChange={(e) => setCheckIntervalMinutes(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--v2-border)] bg-[var(--v2-bg)] text-[var(--v2-text-primary)] text-sm"
                  >
                    {intervalOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs text-[var(--v2-text-muted)] mb-1 block">
                    Max Items Per Run
                  </label>
                  <input
                    type="number"
                    value={maxItemsPerRun}
                    onChange={(e) => setMaxItemsPerRun(Number(e.target.value))}
                    min={1}
                    max={100}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--v2-border)] bg-[var(--v2-bg)] text-[var(--v2-text-primary)] text-sm"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-[var(--v2-text-muted)] mb-1 block">
                      Quiet Hours Start
                    </label>
                    <select
                      value={quietHoursStart}
                      onChange={(e) => setQuietHoursStart(Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--v2-border)] bg-[var(--v2-bg)] text-[var(--v2-text-primary)] text-sm"
                    >
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={i} value={i}>
                          {formatHour(i)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-[var(--v2-text-muted)] mb-1 block">
                      Quiet Hours End
                    </label>
                    <select
                      value={quietHoursEnd}
                      onChange={(e) => setQuietHoursEnd(Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--v2-border)] bg-[var(--v2-bg)] text-[var(--v2-text-primary)] text-sm"
                    >
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={i} value={i}>
                          {formatHour(i)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <p className="text-xs text-[var(--v2-text-muted)]">
                  <Bell className="w-3 h-3 inline mr-1" />
                  No actions will run during quiet hours
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="sticky bottom-0 bg-[var(--v2-surface)] border-t border-[var(--v2-border)] p-4">
          <div className="flex flex-col gap-2">
            {/* Create */}
            {mode === 'create' && (
              <button
                onClick={handleCreate}
                disabled={loading || actionLoading !== null}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #22C58B 0%, #1BA97A 100%)' }}
              >
                {actionLoading === 'create' ? (
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <Zap className="w-4 h-4" />
                    <span>Create Automation</span>
                  </>
                )}
              </button>
            )}

            {/* Edit */}
            {mode === 'edit' && (
              <>
                <button
                  onClick={handleUpdate}
                  disabled={loading || actionLoading !== null}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #22C58B 0%, #1BA97A 100%)' }}
                >
                  {actionLoading === 'update' ? (
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <span>Save Changes</span>
                  )}
                </button>

                <div className="flex gap-2">
                  {automation?.is_active ? (
                    <button
                      onClick={handlePause}
                      disabled={loading || actionLoading !== null}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-medium border border-[var(--v2-border)] text-[#F59E0B] hover:bg-[rgba(245,158,11,0.05)] transition-colors disabled:opacity-50"
                    >
                      <Pause className="w-4 h-4" />
                      <span>Pause</span>
                    </button>
                  ) : (
                    <button
                      onClick={handleResume}
                      disabled={loading || actionLoading !== null}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-medium border border-[var(--v2-border)] text-[#22C58B] hover:bg-[rgba(34,197,139,0.05)] transition-colors disabled:opacity-50"
                    >
                      <Play className="w-4 h-4" />
                      <span>Resume</span>
                    </button>
                  )}
                  <button
                    onClick={handleDelete}
                    disabled={loading || actionLoading !== null}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-medium border border-[var(--v2-border)] text-[#EF4444] hover:bg-[rgba(239,68,68,0.05)] transition-colors disabled:opacity-50"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Delete</span>
                  </button>
                </div>
              </>
            )}

            {/* View */}
            {mode === 'view' && (
              <button
                onClick={onClose}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:bg-[var(--v2-bg)] transition-colors"
              >
                Close
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
