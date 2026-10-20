'use client';

/**
 * The plan comparison window — VIEW ONLY (upgrade modal UM-1a, workplan §5).
 *
 * Opened by "Compare plans" in Settings → "Your plan". A gradient band, a status
 * strip, and the server's comparison table: one column per shown plan (name,
 * price, action slot), short grouped rows, ✓ / ✕ / value per cell.
 *
 * ── IT RENDERS; IT DOES NOT DECIDE ──────────────────────────────────────────
 * Every row, label, ✓ / ✕, value, highlight and order is `plan.comparison`, as
 * the server sent it (C-21); the column markers come from `upgradeModalView`.
 * Nothing here names a plan or compares an id to a literal (C-7).
 *
 * ── NO MONEY HERE (C-1, C-12) ───────────────────────────────────────────────
 * Choose, Pay for and Upgrade stay in the drawer in UM-1a: an offered column's
 * action slot is EMPTY (SA Q-11) and the footer says where to act. UM-1b mounts
 * the triggers in that slot. The only buttons are the dialog's X and "Back to
 * your plan" (pinned by `UpgradeModal.render`).
 *
 * ── NO READ HERE (C-3) ──────────────────────────────────────────────────────
 * `plan` is `PlanSection`'s own state, passed in: the modal shares the drawer's
 * flow instance and never fetches.
 */

import { useRef } from 'react';
import { Check, Sparkles, Star, X } from 'lucide-react';

import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useLanguage } from '@/lib/business-os/LanguageContext';

import type { PlanComparisonCell, PlanComparisonSection, PlanPayload, PlanSentence } from './planPayloadTypes';
import { fill, priceLine, renderSentence } from './planText';
import { upgradeModalView, type PlanColumnView } from './upgradeModalView';

/**
 * Two plan columns on a phone (UM-D1-M, option M-A, C-24): every row becomes a
 * two-column grid, the feature label spanning the row above its two cells.
 * ASSUMES AT MOST TWO SHOWN PLANS — the assumption
 * `components/business-os/settings/__tests__/planComparison.twoPlans.tripwire.test.ts`
 * (C-27) protects. Raise both together, after re-deciding UM-D1-M with the user.
 */
const PHONE_ROW = 'max-sm:grid max-sm:grid-cols-2';

/**
 * The server's free-access sentence beside an offer (plan payments W-7), by the
 * same keys `PlanPurchase` uses. Not imported from it: the modal must not pull
 * the islands' module graph (C-1, C-12; `upgradeModal.guard` (a)).
 */
const ENDS_FREE_ACCESS_KEYS: Record<'trial' | 'free_access', string> = {
  trial: 'plan.choose.trial_ends_today',
  free_access: 'plan.choose.free_access_ends_today',
};

/** The tint a marked column carries on every cell of the table, so it reads as one column. */
function columnTint(column: PlanColumnView): string {
  if (column.isRecommended) return 'bg-[var(--v2-primary)]/5';
  if (column.isCurrent) return 'bg-[var(--v2-surface-hover)]';
  return '';
}

export function UpgradeModal({
  open,
  onOpenChange,
  plan,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** PlanSection's own plan state (C-3): the modal never reads it itself. */
  plan: PlanPayload;
}) {
  const { t, isRTL, language, timezone } = useLanguage();
  const sentence = (value: PlanSentence | null | undefined) => renderSentence(value, t, language, timezone);
  const view = upgradeModalView(plan);
  /*
   * Focus goes back to whatever opened the modal. Radix returns focus only to a
   * `Dialog.Trigger`, and prevents its focus scope's own return, so a
   * controlled dialog with no trigger (this one; and UM-2's, opened from
   * anywhere) would leave focus on <body>. `onOpenAutoFocus` runs before Radix
   * moves focus, so the active element there is the opener.
   */
  const opener = useRef<HTMLElement | null>(null);

  const headline = t(`upgrade_modal.headline.${view.headline}`);
  const [statusBefore, statusAfter = ''] = t('upgrade_modal.status_on').split('{plan}');
  const statusPrice = priceLine(plan, t);
  const statusEnds = sentence(plan.endsWhen);
  const freeAccessKey =
    view.somethingOffered && plan.purchase?.endsFreeAccessOnPurchase ? ENDS_FREE_ACCESS_KEYS[plan.purchase.endsFreeAccessOnPurchase] : null;
  const whenThisChanges = sentence(plan.whenThisChanges);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        dir={isRTL ? 'rtl' : 'ltr'}
        data-testid="plan-compare-modal"
        onOpenAutoFocus={() => {
          opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          if (opener.current?.isConnected) {
            event.preventDefault();
            opener.current.focus();
          }
          opener.current = null;
        }}
        // C-8: the flex variant (no grid, no gutter, no scroll from dialog.tsx), one
        // `sm:` width, and the built-in X recoloured for the band by a child
        // selector (SA Q-4) rather than a second X.
        className="flex flex-col p-0 overflow-hidden w-full h-[100dvh] max-sm:rounded-none sm:h-auto sm:max-h-[90dvh] sm:max-w-4xl sm:rounded-[var(--v2-radius-panel)] border-[var(--v2-border)] [&>button]:text-white [&>button]:opacity-90 [&>button:focus]:ring-white"
      >
        {/* C-9 / SA Q-5: all band text on SOLID --v2-primary-dark; the gradient
            is a decorative layer at the end edge, kept clear of the text. */}
        <div data-testid="plan-compare-band" className="relative flex-shrink-0 overflow-hidden bg-[var(--v2-primary-dark)] px-5 py-5 pe-12 sm:px-7 sm:py-6">
          <div
            aria-hidden="true"
            data-testid="plan-compare-band-gradient"
            className={`pointer-events-none absolute inset-y-0 end-0 w-1/4 from-transparent to-[var(--v2-secondary)] ${isRTL ? 'bg-gradient-to-l' : 'bg-gradient-to-r'}`}
          />
          <div className="relative flex items-start gap-3 pe-[25%] sm:pe-[22%]">
            <Sparkles aria-hidden="true" className="w-6 h-6 shrink-0 mt-0.5 text-white" />
            <div className="min-w-0">
              {/* Typography on an inner span: `cn` concatenates, so a class on the
                  title itself would race dialog.tsx's own colour and size. */}
              <DialogTitle>
                <span className="block text-xl sm:text-2xl font-semibold leading-tight text-white">{headline}</span>
              </DialogTitle>
              <DialogDescription>
                <span className="block mt-1.5 text-sm text-white">{t('upgrade_modal.subheading')}</span>
              </DialogDescription>
            </div>
          </div>
        </div>

        {/* No top padding on the scroll container (QA): the sticky plan header sticks at
            the scrollport top, so a padding gap there let rows show through above it.
            The top spacing is the status strip's own margin, which scrolls away. */}
        <div className="flex-1 overflow-y-auto bg-[var(--v2-surface)] px-3 pb-3 sm:px-6 sm:pb-6">
          <p
            data-testid="plan-compare-status"
            className="mt-3 mb-4 sm:mt-6 sm:mb-5 px-3 py-2 text-sm text-[var(--v2-text-secondary)] border border-[var(--v2-border)] rounded-[var(--v2-radius-card)]"
          >
            {statusBefore}
            {/* F-2: not --v2-primary-dark, which has no dark override (≈ 2.3:1 on the dark surface). */}
            <span className="font-semibold text-[var(--v2-text-primary)]">{plan.name ?? ''}</span>
            {statusAfter}
            {statusPrice && <> · {statusPrice}</>}
            {statusEnds && <> · {statusEnds}</>}
          </p>

          {/* The one element UM-1b's checkout / upgrade flows replace (C-25). */}
          <div data-testid="plan-compare-table-area">
            <ComparisonTable columns={view.columns} sections={view.sections} />
          </div>
        </div>

        <div
          data-testid="plan-compare-footer"
          className="flex-shrink-0 border-t border-[var(--v2-border)] bg-[var(--v2-surface)] px-4 py-3 sm:px-6 sm:py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0 space-y-1 text-xs text-[var(--v2-text-muted)]">
            <p>{t('upgrade_modal.footer_prices')}</p>
            {freeAccessKey && <p data-testid="plan-compare-ends-free-access">{t(freeAccessKey)}</p>}
            {whenThisChanges && <p>{whenThisChanges}</p>}
            {view.somethingOffered && <p data-testid="plan-compare-view-only-note">{t('upgrade_modal.view_only_note')}</p>}
          </div>
          <DialogClose asChild>
            <button
              type="button"
              className="shrink-0 px-4 py-2 text-sm font-medium text-[var(--v2-text-primary)] bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-[var(--v2-radius-button)] hover:bg-[var(--v2-surface-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--v2-primary)]"
            >
              {t('upgrade_modal.back_to_plan')}
            </button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One semantic table at every width (C-24). Below 640 px the table parts become
 * blocks and each row a two-column grid (W-8: a grid row inside table-display
 * parents gets wrapped in anonymous table boxes), so every element carries its
 * explicit ARIA role — `display` changes drop native table semantics in some
 * browsers (SA (f), R-12). Sticky: the whole `thead` on a phone (a sticky cell
 * cannot leave a grid row), the header cells from `sm` up (W-8, Q-14).
 */
function ComparisonTable({ columns, sections }: { columns: PlanColumnView[]; sections: PlanComparisonSection[] }) {
  const { t, language, timezone } = useLanguage();
  const captionId = 'plan-compare-caption';

  return (
    <table
      role="table"
      aria-labelledby={captionId}
      data-testid="plan-compare-table"
      className="w-full table-fixed border-separate border-spacing-0 text-sm max-sm:block"
    >
      <caption id={captionId} className="sr-only">
        {t('upgrade_modal.plans_label')}
      </caption>
      <thead
        role="rowgroup"
        data-testid="plan-compare-thead"
        className="max-sm:block max-sm:sticky max-sm:top-0 max-sm:z-10 max-sm:bg-[var(--v2-surface)]"
      >
        <tr role="row" className={PHONE_ROW}>
          <td aria-hidden="true" className="max-sm:hidden sm:w-2/5 sm:sticky sm:top-0 sm:z-10 bg-[var(--v2-surface)]" />
          {columns.map((column) => (
            <th
              key={column.planId}
              role="columnheader"
              scope="col"
              data-testid={`plan-compare-col-${column.planId}`}
              className="p-0 align-top font-normal sm:sticky sm:top-0 sm:z-10 bg-[var(--v2-surface)]"
            >
              <div
                className={`h-full px-2 pt-3 pb-3 sm:px-3 text-center rounded-t-[var(--v2-radius-card)] border-t-2 ${
                  column.isRecommended ? 'border-[var(--v2-primary)]' : column.isCurrent ? 'border-[var(--v2-border)]' : 'border-transparent'
                } ${columnTint(column)}`}
              >
                <div className="flex h-6 items-center justify-center">
                  {column.isRecommended && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold text-white bg-[var(--v2-primary-dark)] rounded-full">
                      <Star aria-hidden="true" className="w-3 h-3" />
                      {t('upgrade_modal.recommended')}
                    </span>
                  )}
                  {column.isCurrent && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold text-[var(--v2-text-primary)] bg-[var(--v2-surface-hover)] border border-[var(--v2-border)] rounded-full">
                      <Check aria-hidden="true" className="w-3 h-3" />
                      {t('upgrade_modal.your_plan')}
                    </span>
                  )}
                </div>
                <div className="mt-1.5 text-base sm:text-lg font-semibold text-[var(--v2-text-primary)] break-words">{column.name}</div>
                <div className="mt-1 text-2xl font-semibold leading-none text-[var(--v2-text-primary)]">
                  <span dir="ltr">${column.monthlyPriceUsd}</span>
                </div>
                <div className="mt-1 text-xs text-[var(--v2-text-muted)]">{t('upgrade_modal.price_suffix')}</div>
                <div className="mt-2.5">
                  <ActionSlot column={column} />
                  {column.unavailableBecause && (
                    <p className="mt-1 text-xs text-[var(--v2-text-muted)]">
                      {renderSentence(column.unavailableBecause, t, language, timezone)}
                    </p>
                  )}
                </div>
              </div>
            </th>
          ))}
        </tr>
      </thead>

      {sections.map((section) => (
        <tbody key={section.section} role="rowgroup" className="max-sm:block">
          <tr role="row" className={PHONE_ROW}>
            {/* A heading for the rows of this group: scope "rowgroup". */}
            <th
              role="rowheader"
              scope="rowgroup"
              data-testid="plan-compare-section"
              className="max-sm:col-span-2 px-2 sm:px-3 pt-5 pb-2 text-start text-xs font-semibold uppercase tracking-wide text-[var(--v2-text-muted)]"
            >
              {t(section.labelKey)}
            </th>
            {columns.map((column) => (
              <td key={column.planId} aria-hidden="true" className={`max-sm:hidden ${columnTint(column)}`} />
            ))}
          </tr>
          {section.rows.map((row) => (
            <tr key={row.row} role="row" className={PHONE_ROW}>
              <th
                role="rowheader"
                scope="row"
                className="max-sm:col-span-2 px-2 sm:px-3 pt-2.5 pb-1 sm:py-2.5 text-start font-normal text-[var(--v2-text-primary)] break-words sm:border-b sm:border-[var(--v2-border)]"
              >
                {row.label}
              </th>
              {row.cells.map((cell, index) => {
                // Cells are in `planIds` order (UM-0), so position i is column i.
                const column = columns[index];
                return (
                  <td
                    key={cell.planId}
                    role="cell"
                    data-testid="plan-compare-cell"
                    className={`px-2 pt-1 pb-2.5 sm:py-2.5 text-center align-middle break-words border-b border-[var(--v2-border)] ${column ? columnTint(column) : ''}`}
                  >
                    <CellContent cell={cell} planName={column?.name ?? ''} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      ))}

      <tfoot role="rowgroup" className="max-sm:block">
        <tr role="row" className={PHONE_ROW}>
          <td aria-hidden="true" className="max-sm:hidden" />
          {columns.map((column) => (
            <td key={column.planId} role="cell" className="p-0 align-top">
              <div className={`px-2 pt-3 pb-3 text-center rounded-b-[var(--v2-radius-card)] ${columnTint(column)}`}>
                <ActionSlot column={column} />
              </div>
            </td>
          ))}
        </tr>
      </tfoot>
    </table>
  );
}

/**
 * Under the price and in the footer row (C-22). UM-1a mounts NO control here:
 * an offered plan's slot is empty (C-1, SA Q-11); the current plan with nothing
 * offered for it reads "Current plan" — a label styled like a quiet button,
 * never a `<button>`, no role, no tabIndex, no aria-disabled (no dead control).
 */
function ActionSlot({ column }: { column: PlanColumnView }) {
  const { t } = useLanguage();

  if (column.action === 'current_label') {
    return (
      <span
        data-testid="plan-compare-current-label"
        className="inline-block w-full max-w-[12rem] px-3 py-2 text-sm font-medium text-[var(--v2-text-muted)] bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-[var(--v2-radius-button)]"
      >
        {t('upgrade_modal.current_plan')}
      </span>
    );
  }
  if (column.comingSoon) {
    return (
      <span className="inline-block px-2 py-1 text-xs text-[var(--v2-text-muted)] bg-[var(--v2-bg)] rounded">
        {t('plan.next.coming_soon')}
      </span>
    );
  }
  // Keeps the header and footer rows the same height whether or not a slot is filled.
  return <span aria-hidden="true" className="block h-9" data-testid="plan-compare-slot-empty" />;
}

/** ✓ / ✕ / value, exactly as the server sent it, with the plan named for a screen reader (C-23). */
function CellContent({ cell, planName }: { cell: PlanComparisonCell; planName: string }) {
  const { t } = useLanguage();
  const state = cell.value !== null ? cell.value : t(cell.included ? 'upgrade_modal.included' : 'upgrade_modal.not_included');

  return (
    <>
      {cell.value !== null ? (
        <span
          aria-hidden="true"
          data-highlight={cell.highlight ? 'true' : undefined}
          // F-2: the server's highlight is carried by weight, which reads in both themes.
          className={cell.highlight ? 'font-semibold text-[var(--v2-text-primary)]' : 'font-normal text-[var(--v2-text-secondary)]'}
        >
          {cell.value}
        </span>
      ) : cell.included ? (
        // ✓ and ✕ differ in shape, not only colour (WCAG 1.4.1).
        <span
          aria-hidden="true"
          data-mark="included"
          className="inline-flex w-6 h-6 items-center justify-center rounded-full bg-[var(--v2-success)]/15 text-[var(--v2-success-icon)]"
        >
          <Check className="w-3.5 h-3.5" strokeWidth={3} />
        </span>
      ) : (
        <span
          aria-hidden="true"
          data-mark="not_included"
          className="inline-flex w-6 h-6 items-center justify-center rounded-full bg-[var(--v2-border)] text-[var(--v2-text-secondary)]"
        >
          <X className="w-3 h-3" strokeWidth={3} />
        </span>
      )}
      <span className="sr-only">{fill(t('upgrade_modal.cell_label'), { plan: planName, state })}</span>
    </>
  );
}
