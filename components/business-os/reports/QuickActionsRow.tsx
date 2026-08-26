'use client';

import { Plus, Download, Globe } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';

interface QuickActionsRowProps {
  onCreateInvoice: () => void;
  onExportTransactions: () => void;
  onViewWebsite: () => void;
}

export function QuickActionsRow({
  onCreateInvoice,
  onExportTransactions,
  onViewWebsite
}: QuickActionsRowProps) {
  const { t, language } = useLanguage();
  const isRTL = language === 'he';

  return (
    <div
      className="flex items-center gap-2 overflow-x-auto pb-1"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      {/* Create Invoice */}
      <button
        onClick={onCreateInvoice}
        className="flex items-center gap-2 px-4 py-2.5 bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm font-medium hover:bg-[var(--v2-border)] transition-colors whitespace-nowrap"
        style={{ borderRadius: 'var(--v2-radius-button)' }}
      >
        <Plus className="w-4 h-4" />
        {t('reports.create_invoice') || 'Create Invoice'}
      </button>

      {/* Export */}
      <button
        onClick={onExportTransactions}
        className="flex items-center gap-2 px-4 py-2.5 bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-secondary)] text-sm font-medium hover:bg-[var(--v2-border)] hover:text-[var(--v2-text-primary)] transition-colors whitespace-nowrap"
        style={{ borderRadius: 'var(--v2-radius-button)' }}
      >
        <Download className="w-4 h-4" />
        {t('reports.export') || 'Export'}
      </button>

      {/* View Website */}
      <button
        onClick={onViewWebsite}
        className="flex items-center gap-2 px-4 py-2.5 bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-secondary)] text-sm font-medium hover:bg-[var(--v2-border)] hover:text-[var(--v2-text-primary)] transition-colors whitespace-nowrap"
        style={{ borderRadius: 'var(--v2-radius-button)' }}
      >
        <Globe className="w-4 h-4" />
        {t('reports.view_site') || 'View Site'}
      </button>
    </div>
  );
}
