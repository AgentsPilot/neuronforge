'use client';

/**
 * The inline notice of the "Download my data" control: UI-1, option A (data
 * export DE-9, workplan §3.5; SA DE-9 Q1, C-9).
 *
 * PRESENTATION ONLY, with generic props (tone, children, optional action,
 * onDismiss). It holds no export logic, so promoting it to `components/ui`
 * later is a file move; that needs a second consumer and SA review (rule 7).
 *
 * - It renders INSIDE a live region the control mounts empty from the first
 *   paint (`role="status"` or `role="alert"`), so it has no role of its own and
 *   nothing is announced twice.
 * - Not colour-only: each tone has its icon (aria-hidden) and the text says
 *   what happened.
 * - Logical classes only (`ms-` / `me-`, `text-start`); the icon sits at the
 *   inline start and direction comes from the surrounding `dir`.
 * - It never dismisses itself.
 * - The `--v2-success-*` / `--v2-error-*` tokens are defined for light and dark
 *   on Business OS and /v2; the hex fallbacks cover /settings, which does not
 *   load them.
 */

import React from 'react';
import { AlertCircle, CheckCircle, Info, X } from 'lucide-react';
import type { DataExportNoticeTone } from '@/components/business-os/data-export/useDownloadMyData';

const TONE_STYLE: Record<DataExportNoticeTone, { bg: string; border: string; text: string; icon: string }> = {
  success: {
    bg: 'var(--v2-success-bg, #ECFDF5)',
    border: 'var(--v2-success-border, #BBF7D0)',
    text: 'var(--v2-success-text, #065F46)',
    icon: 'var(--v2-success-icon, #059669)',
  },
  error: {
    bg: 'var(--v2-error-bg, #FEF2F2)',
    border: 'var(--v2-error-border, #FECACA)',
    text: 'var(--v2-error-text, #991B1B)',
    icon: 'var(--v2-error-icon, #DC2626)',
  },
  info: {
    bg: 'var(--v2-surface, #FFFFFF)',
    border: 'var(--v2-border, #E2E8F0)',
    text: 'var(--v2-text-primary, #0F172A)',
    icon: 'var(--v2-primary, #6366F1)',
  },
};

const TONE_ICON: Record<DataExportNoticeTone, typeof Info> = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
};

export interface DataExportNoticeProps {
  tone: DataExportNoticeTone;
  children: React.ReactNode;
  /** An optional follow-up, e.g. "Download again". */
  action?: { label: string; onClick: () => void; disabled?: boolean };
  /** Omit to render without a dismiss button (e.g. the "preparing" line). */
  onDismiss?: () => void;
  dismissLabel?: string;
}

export function DataExportNotice({ tone, children, action, onDismiss, dismissLabel }: DataExportNoticeProps) {
  const style = TONE_STYLE[tone];
  const Icon = TONE_ICON[tone];
  return (
    <div
      data-tone={tone}
      className="flex items-start gap-2 border p-3 text-start"
      style={{ backgroundColor: style.bg, borderColor: style.border, borderRadius: 'var(--v2-radius-button, 8px)' }}
    >
      <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: style.icon }} aria-hidden="true" />
      <div className="flex-1 min-w-0 space-y-1 text-xs font-medium" style={{ color: style.text }}>
        {children}
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            disabled={action.disabled}
            className="underline font-semibold disabled:opacity-60"
          >
            {action.label}
          </button>
        )}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          className="flex-shrink-0 ms-1 rounded p-0.5 hover:opacity-70"
          style={{ color: style.text }}
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export default DataExportNotice;
