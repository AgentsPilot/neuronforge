'use client';

/**
 * Export the ledger.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * One dialog, reachable from anywhere money is shown, so there is a single
 * answer to "how do I get this to my accountant" rather than a different
 * half-export on each screen.
 *
 * The choices are what an accountant's request actually varies on: which period,
 * cash movements or documents issued, and how much reconciliation detail. Not
 * "which columns" — a column picker asks the business to know what a ledger
 * needs, which is exactly what they employ an accountant for.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { SwitchRow } from './SwitchRow';
import { Input } from '@/components/ui/input';
import { createLogger } from '@/lib/logger';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Coins,
  FileSpreadsheet,
  FileText,
  Hash,
  Loader2,
  Percent,
} from 'lucide-react';

const logger = createLogger({ module: 'LedgerExportModal' });

const REPORTS_COLOR = '#22C58B';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /**
   * The period the screen is already showing, so the dialog opens on what the
   * user was looking at rather than making them retype it.
   */
  defaultFrom?: string | null;
  defaultTo?: string | null;
}

type Format = 'xlsx' | 'csv';

/** Whole calendar periods, because that is what a return is filed for. */
const RANGE_PRESETS = [
  { id: 'this_month', key: 'ledger.range_this_month' },
  { id: 'last_month', key: 'ledger.range_last_month' },
  { id: 'this_quarter', key: 'ledger.range_this_quarter' },
  { id: 'this_year', key: 'ledger.range_this_year' },
  { id: 'custom', key: 'ledger.range_custom' },
] as const;

type RangeId = (typeof RANGE_PRESETS)[number]['id'];

const iso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * The bounds of a named period, in the viewer's own calendar.
 *
 * Built from local date parts rather than `toISOString`, which converts to UTC
 * first — east of Greenwich that turns "1 March" into "28 February", and a
 * period that starts a day early is a period that double-counts one payment.
 */
function presetRange(id: RangeId): { from: string; to: string } | null {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  switch (id) {
    case 'this_month':
      return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
    case 'last_month':
      return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case 'this_quarter': {
      const q = Math.floor(m / 3) * 3;
      return { from: iso(new Date(y, q, 1)), to: iso(new Date(y, q + 3, 0)) };
    }
    case 'this_year':
      return { from: iso(new Date(y, 0, 1)), to: iso(new Date(y, 11, 31)) };
    default:
      return null;
  }
}

export function LedgerExportModal({ isOpen, onClose, defaultFrom, defaultTo }: Props) {
  const { t, isRTL } = useLanguage();

  const [range, setRange] = useState<RangeId>('this_month');
  const [from, setFrom] = useState(defaultFrom || presetRange('this_month')!.from);
  const [to, setTo] = useState(defaultTo || presetRange('this_month')!.to);
  const [format, setFormat] = useState<Format>('xlsx');
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [include, setInclude] = useState({
    payments: true,
    refunds: true,
    invoices: false,
    fees: true,
    tax: true,
    refs: true,
  });

  const selectRange = (id: RangeId) => {
    setRange(id);
    const bounds = presetRange(id);
    if (bounds) {
      setFrom(bounds.from);
      setTo(bounds.to);
    }
  };

  // Nothing selected produces an empty file, which looks like a broken export
  // rather than an empty request — so the button says so before it is pressed.
  const hasContent = include.payments || include.refunds || include.invoices;

  const handleExport = async () => {
    try {
      setDownloading(true);
      setError(null);

      const params = new URLSearchParams({
        from,
        to,
        format,
        payments: include.payments ? '1' : '0',
        refunds: include.refunds ? '1' : '0',
        invoices: include.invoices ? '1' : '0',
        fees: include.fees ? '1' : '0',
        tax: include.tax ? '1' : '0',
        refs: include.refs ? '1' : '0',
      });

      const response = await fetch(`/api/payments/ledger/export?${params}`);

      if (!response.ok) {
        setError(t('ledger.export_failed'));
        return;
      }

      const blob = await response.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `ledger_${from}_${to}.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);

      onClose();
    } catch (err) {
      logger.error({ err }, 'Ledger export failed');
      setError(t('ledger.export_failed'));
    } finally {
      setDownloading(false);
    }
  };

  const segment = (active: boolean) =>
    `flex-1 px-3 py-1.5 text-[12.5px] transition-colors ${
      active
        ? 'bg-[var(--v2-bg)] font-medium text-[var(--v2-text-primary)] shadow-sm'
        : 'text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]'
    }`;

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent
        className="flex w-full sm:max-w-md h-[100vh] sm:h-auto max-h-[100vh] sm:max-h-[90vh] flex-col rounded-none sm:rounded-lg p-0 overflow-hidden"
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        <div className="flex-shrink-0 border-b border-[var(--v2-border)] px-5 py-5">
          <div className="flex items-center gap-2.5">
            <span
              className="flex h-8 w-8 items-center justify-center"
              style={{ backgroundColor: `${REPORTS_COLOR}15`, borderRadius: 'var(--v2-radius-button)' }}
            >
              <FileSpreadsheet className="h-4 w-4" style={{ color: REPORTS_COLOR }} />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-[15px] font-semibold text-[var(--v2-text-primary)]">
                {t('ledger.export_title')}
              </DialogTitle>
              <p className="truncate text-[12px] text-[var(--v2-text-muted)]">
                {t('ledger.export_subtitle')}
              </p>
            </div>
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {/* ── Period ──────────────────────────────────────────────────── */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-[var(--v2-text-muted)]">
              {t('ledger.period')}
            </label>
            <div className="flex flex-wrap gap-1.5">
              {RANGE_PRESETS.map(preset => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => selectRange(preset.id)}
                  className={`px-2.5 py-1 text-[12px] border transition-colors ${
                    range === preset.id
                      ? 'border-[#22C58B] bg-[#22C58B]/10 text-[#22C58B] font-medium'
                      : 'border-[var(--v2-border)] text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]'
                  }`}
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  {t(preset.key)}
                </button>
              ))}
            </div>

            {/* Always visible, not only under "custom": the dates ARE the
                period, and a preset that silently sets invisible bounds is a
                period nobody can check before filing on it. */}
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <Input
                type="date"
                value={from}
                onChange={e => {
                  setFrom(e.target.value);
                  setRange('custom');
                }}
              />
              <Input
                type="date"
                value={to}
                onChange={e => {
                  setTo(e.target.value);
                  setRange('custom');
                }}
              />
            </div>
          </div>

          {/* ── What goes in ────────────────────────────────────────────── */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-[var(--v2-text-muted)]">
              {t('ledger.include')}
            </label>
            <div
              className="divide-y divide-[var(--v2-border)] border border-[var(--v2-border)] overflow-hidden"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              <SwitchRow
                checked={include.payments}
                onChange={next => setInclude(p => ({ ...p, payments: next }))}
                label={t('ledger.include_payments')}
                description={t('ledger.include_payments_desc')}
                icon={<ArrowDownToLine className="h-4 w-4 flex-shrink-0 text-[#22C58B]" />}
                isRTL={isRTL}
              />
              <SwitchRow
                checked={include.refunds}
                onChange={next => setInclude(p => ({ ...p, refunds: next }))}
                label={t('ledger.include_refunds')}
                description={t('ledger.include_refunds_desc')}
                icon={<ArrowUpFromLine className="h-4 w-4 flex-shrink-0 text-orange-500" />}
                isRTL={isRTL}
              />
              {/* The accrual view. Off by default because most small businesses
                  file on a cash basis, and an extra sheet nobody asked for is
                  a question the accountant has to come back about. */}
              <SwitchRow
                checked={include.invoices}
                onChange={next => setInclude(p => ({ ...p, invoices: next }))}
                label={t('ledger.include_invoices')}
                description={t('ledger.include_invoices_desc')}
                icon={<FileText className="h-4 w-4 flex-shrink-0 text-[var(--v2-text-muted)]" />}
                isRTL={isRTL}
              />
            </div>
          </div>

          {/* ── Detail ──────────────────────────────────────────────────── */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-[var(--v2-text-muted)]">
              {t('ledger.detail')}
            </label>
            <div
              className="divide-y divide-[var(--v2-border)] border border-[var(--v2-border)] overflow-hidden"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              <SwitchRow
                checked={include.fees}
                onChange={next => setInclude(p => ({ ...p, fees: next }))}
                label={t('ledger.include_fees')}
                description={t('ledger.include_fees_desc')}
                icon={<Coins className="h-4 w-4 flex-shrink-0 text-amber-500" />}
                isRTL={isRTL}
              />
              <SwitchRow
                checked={include.tax}
                onChange={next => setInclude(p => ({ ...p, tax: next }))}
                label={t('ledger.include_tax')}
                description={t('ledger.include_tax_desc')}
                icon={<Percent className="h-4 w-4 flex-shrink-0 text-purple-500" />}
                isRTL={isRTL}
              />
              <SwitchRow
                checked={include.refs}
                onChange={next => setInclude(p => ({ ...p, refs: next }))}
                label={t('ledger.include_refs')}
                description={t('ledger.include_refs_desc')}
                icon={<Hash className="h-4 w-4 flex-shrink-0 text-[var(--v2-text-muted)]" />}
                isRTL={isRTL}
              />
            </div>
          </div>

          {/* ── Format ──────────────────────────────────────────────────── */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-[var(--v2-text-muted)]">
              {t('ledger.format')}
            </label>
            <div
              className="flex gap-1 bg-[var(--v2-surface-hover)] p-1"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              role="radiogroup"
            >
              {(['xlsx', 'csv'] as Format[]).map(option => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={format === option}
                  onClick={() => setFormat(option)}
                  className={segment(format === option)}
                  style={{ borderRadius: 'calc(var(--v2-radius-button) - 2px)' }}
                >
                  {option === 'xlsx' ? t('ledger.format_excel') : t('ledger.format_csv')}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11.5px] text-[var(--v2-text-muted)]">
              {format === 'xlsx' ? t('ledger.format_excel_hint') : t('ledger.format_csv_hint')}
            </p>
          </div>

          {error && (
            <p className="text-[12.5px] text-red-500" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-[var(--v2-border)] px-5 py-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={downloading}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            onClick={handleExport}
            disabled={downloading || !hasContent || !from || !to}
            variant="outline"
            className="border-[#22C58B] bg-[#22C58B]/10 text-[#22C58B] hover:bg-[#22C58B]/20 hover:text-[#22C58B] disabled:opacity-50"
          >
            {downloading ? (
              <Loader2 className="me-2 h-4 w-4 animate-spin" />
            ) : (
              <FileSpreadsheet className="me-2 h-4 w-4" />
            )}
            {t('ledger.export_action')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default LedgerExportModal;
