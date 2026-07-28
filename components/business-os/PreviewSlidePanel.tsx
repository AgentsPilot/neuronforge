'use client';

import { useEffect, useCallback } from 'react';
import { X, Check, Trash2 } from 'lucide-react';
import { useDraftManager } from '@/lib/business-os/DraftManager';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { ServicesPreview } from './ServicesPreview';
import { PreviewContext } from '@/lib/business-os/DraftManagerTypes';

interface PreviewSlidePanelProps {
  className?: string;
}

export function PreviewSlidePanel({ className = '' }: PreviewSlidePanelProps) {
  const { t, isRTL } = useLanguage();
  const {
    state,
    closePanel,
    publishAll,
    discardAll,
    draftCount,
    setPreviewContext,
  } = useDraftManager();

  const { isPanelOpen, previewContext, isPublishing, publishError } = state;

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isPanelOpen) {
        closePanel();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isPanelOpen, closePanel]);

  // Handle backdrop click
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      closePanel();
    }
  }, [closePanel]);

  // Handle publish
  const handlePublish = async () => {
    try {
      await publishAll();
    } catch {
      // Error is already set in state
    }
  };

  // Get context title
  const getContextTitle = (ctx: PreviewContext) => {
    switch (ctx) {
      case 'services':
        return t('preview.services_title') || 'Services Preview';
      case 'crm':
        return t('preview.crm_title') || 'Contacts Preview';
      case 'reports':
        return t('preview.reports_title') || 'Reports Preview';
      case 'payments':
        return t('preview.payments_title') || 'Payments Preview';
      default:
        return 'Preview';
    }
  };

  // Get context description
  const getContextDescription = (ctx: PreviewContext) => {
    switch (ctx) {
      case 'services':
        return t('preview.services_desc') || 'This is what your clients see when they book you';
      case 'crm':
        return t('preview.crm_desc') || 'Your contacts and pipeline';
      case 'reports':
        return t('preview.reports_desc') || 'Your business metrics';
      case 'payments':
        return t('preview.payments_desc') || 'Your invoices and transactions';
      default:
        return '';
    }
  };

  if (!isPanelOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 backdrop-blur-[2px] z-40 transition-opacity duration-300"
        onClick={handleBackdropClick}
        aria-hidden="true"
      />

      {/* Panel - positioned at right edge in LTR, left edge in RTL */}
      <div
        className={`
          fixed top-0 bottom-0 z-50
          w-[420px] max-w-[90vw]
          bg-[var(--v2-surface)]
          flex flex-col
          ${isRTL ? 'left-0 border-r' : 'right-0 border-l'}
          border-[var(--v2-border)]
          preview-panel-animate
          ${isRTL ? 'preview-panel-rtl' : 'preview-panel-ltr'}
          ${className}
        `}
        style={{
          boxShadow: isRTL
            ? '8px 0 30px -10px rgba(0,0,0,0.15)'
            : '-8px 0 30px -10px rgba(0,0,0,0.15)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--v2-border)]">
          <div className="flex items-center gap-3">
            <button
              onClick={closePanel}
              className="p-2 text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-border)] transition-colors"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              title={t('preview.close') || 'Close'}
            >
              <X className="h-4 w-4" />
            </button>
            <div>
              <h2 className="font-semibold text-[var(--v2-text-primary)]">
                {getContextTitle(previewContext)}
              </h2>
              <p className="text-xs text-[var(--v2-text-muted)]">
                {getContextDescription(previewContext)}
              </p>
            </div>
          </div>

          {/* Context Switcher Tabs */}
          <div
            className="flex gap-1 p-1 bg-[var(--v2-bg)] border border-[var(--v2-border)]"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            {(['services', 'crm', 'payments'] as PreviewContext[]).map((ctx) => (
              <button
                key={ctx}
                onClick={() => setPreviewContext(ctx)}
                className={`px-2 py-1 text-xs font-medium transition-colors ${
                  previewContext === ctx
                    ? 'bg-[var(--v2-surface)] text-[var(--v2-text-primary)] shadow-sm'
                    : 'text-[var(--v2-text-muted)] hover:text-[var(--v2-text-secondary)]'
                }`}
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                {ctx === 'services' && (t('preview.tab_services') || 'Services')}
                {ctx === 'crm' && (t('preview.tab_crm') || 'CRM')}
                {ctx === 'payments' && (t('preview.tab_payments') || 'Payments')}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {previewContext === 'services' && <ServicesPreview />}
          {previewContext === 'crm' && (
            <div className="text-center py-12 text-[var(--v2-text-muted)]">
              {t('preview.crm_coming_soon') || 'CRM preview coming soon'}
            </div>
          )}
          {previewContext === 'payments' && (
            <div className="text-center py-12 text-[var(--v2-text-muted)]">
              {t('preview.payments_coming_soon') || 'Payments preview coming soon'}
            </div>
          )}
        </div>

        {/* Footer - Publish/Discard */}
        {draftCount > 0 && (
          <div className="p-4 border-t border-[var(--v2-border)] bg-[var(--v2-bg)]">
            {publishError && (
              <div className="mb-3 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm rounded-lg">
                {publishError}
              </div>
            )}

            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-[var(--v2-text-secondary)]">
                {draftCount} {draftCount === 1
                  ? (t('preview.change_singular') || 'change')
                  : (t('preview.change_plural') || 'changes')
                } {t('preview.not_published') || 'not published'}
              </span>

              <div className="flex items-center gap-2">
                <button
                  onClick={discardAll}
                  disabled={isPublishing}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-border)] transition-colors disabled:opacity-50"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t('preview.discard') || 'Discard'}
                </button>

                <button
                  onClick={handlePublish}
                  disabled={isPublishing}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50"
                  style={{
                    borderRadius: 'var(--v2-radius-button)',
                    background: 'linear-gradient(135deg, #F97316 0%, #EA580C 100%)',
                  }}
                >
                  {isPublishing ? (
                    <>
                      <div className="h-3.5 w-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      {t('preview.publishing') || 'Publishing...'}
                    </>
                  ) : (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      {t('preview.publish') || 'Publish'}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Animation styles */}
      <style jsx global>{`
        @keyframes slide-in-from-right {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }

        @keyframes slide-in-from-left {
          from {
            transform: translateX(-100%);
          }
          to {
            transform: translateX(0);
          }
        }

        .preview-panel-animate {
          animation-duration: 300ms;
          animation-timing-function: cubic-bezier(0.2, 0.9, 0.3, 1);
          animation-fill-mode: both;
        }

        .preview-panel-ltr {
          animation-name: slide-in-from-right;
        }

        .preview-panel-rtl {
          animation-name: slide-in-from-left;
        }
      `}</style>
    </>
  );
}
