'use client';

import { Download } from 'lucide-react';

/**
 * The CRM page's Export button, which says how much it will export.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE NUMBER IS ON THE BUTTON
 *
 * The export writes the contacts currently loaded on screen — one page of the
 * list, or the cards loaded into each board column — not the whole CRM. The
 * button said only "Export", so an owner with 340 contacts got a file of 20 and
 * had no reason to count. The label now names the count, read from the same
 * array the file is built from, so the two cannot disagree (LX-1).
 *
 * The full filtered export is a later scope (EX-1..EX-3); this is the honest
 * label for what exists today, not a server export.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function ContactsExportButton({
  count,
  onExport,
  t,
}: {
  /** How many rows the file will hold — the contacts on screen. */
  count: number;
  onExport: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const isEmpty = count === 0;
  const label = isEmpty ? t('crm.export.button') : t('crm.export.button_shown', { count });
  const tooltip = isEmpty ? t('crm.export.tooltip') : t('crm.export.tooltip_shown', { count });

  return (
    <button
      type="button"
      onClick={onExport}
      disabled={isEmpty}
      className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 text-[var(--v2-text-secondary)] text-xs sm:text-sm font-medium bg-[var(--v2-surface)] border border-[var(--v2-border)] transition-all hover:bg-[var(--v2-surface-hover)] disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
      style={{ borderRadius: 'var(--v2-radius-button)' }}
      title={tooltip}
      // The text label is hidden on a phone; the count must still be announced.
      aria-label={label}
    >
      <Download className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
