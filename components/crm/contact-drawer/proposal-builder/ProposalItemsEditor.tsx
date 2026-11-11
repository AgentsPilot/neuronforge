'use client';

/**
 * The line items of a quote's optional breakdown.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ITS OWN FILE, DELIBERATELY
 *
 * `ProposalBuilderModal.tsx` is 3,000 lines, and it got there by having every
 * new surface added inline. This one does not go in there.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE AMOUNT IS THE ONLY CELL NOBODY TYPES
 *
 * Quantity × unit price, rounded at the cell. Everything else on a row is the
 * owner's; this one is arithmetic, and letting it be typed is how a document
 * ends up disagreeing with itself.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY REMOVAL IS UNDOABLE RATHER THAN CONFIRMED
 *
 * A row carries a description the owner may have spent real time writing, and
 * a confirm dialog is a thing people learn to dismiss without reading. So the
 * removal happens, and says so, with the way back next to it.
 */

import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2, Undo2 } from 'lucide-react';
import { MailReplyEditor, serializeEditor } from '@/components/business-os/insight/MailReplyEditor';
import { renderText, isEmpty } from '@/lib/business-os/mail/replyBody';
import type { ReplyBlock } from '@/lib/business-os/mail/replyBody';
import {
  itemAmount,
  moveItem,
  newItem,
  removeItem,
  restoreItem,
  subtotalOf,
  taxOf,
  totalOf,
  updateItem,
  type ProposalItem,
  type ProposalTax,
} from '@/lib/business-os/proposals/proposalContent';

interface Props {
  items: ProposalItem[];
  onChange: (items: ProposalItem[]) => void;
  tax: ProposalTax;
  /** The quote's own currency formatter, so the document and the dialog agree. */
  formatMoney: (amount: number) => string;
  /** A sent quote is read back, never edited — the modal is both surfaces. */
  readOnly?: boolean;
  t: (key: string) => string;
  isRTL: boolean;
}

/** Local to one document, which is all the uniqueness an id needs here. */
let seq = 0;
function nextId(): string {
  seq += 1;
  return `it_${Date.now().toString(36)}_${seq}`;
}

/**
 * One item's description.
 *
 * Its own component because `MailReplyEditor` is UNCONTROLLED — it seeds itself
 * once and hands its content back through `serializeEditor`. That needs a ref
 * per row, and a ref per row needs a component per row.
 *
 * Keyed on the item's id by the parent, so a reorder moves the editor with its
 * item instead of re-seeding a different row's text into it.
 */
function ItemDescription({
  item,
  onBody,
  readOnly,
  t,
}: {
  item: ProposalItem;
  onBody: (body: ReplyBlock[]) => void;
  readOnly: boolean;
  t: (key: string) => string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  if (readOnly) {
    const text = renderText(item.body).trim();
    if (!text) return null;
    return (
      <p className="mt-1.5 whitespace-pre-wrap text-[12.5px] text-[var(--v2-text-secondary)]">
        {text}
      </p>
    );
  }

  return (
    <div className="mt-2">
      <MailReplyEditor
        /* Seeded from the blocks already stored, so reopening a draft shows
           what was written rather than an empty box. */
        initialText={renderText(item.body) || null}
        placeholder={t('proposal.doc.desc_placeholder') || 'What does this item cover?'}
        editorRef={ref}
        onInput={() => onBody(serializeEditor(ref.current))}
        t={t}
      />
    </div>
  );
}

export function ProposalItemsEditor({
  items,
  onChange,
  tax,
  formatMoney,
  readOnly = false,
  t,
  isRTL,
}: Props) {
  /*
   * The row that was just removed, and where it sat.
   *
   * Held rather than discarded so the undo can put it back in its place rather
   * than on the end — a three-phase job reordered by an accidental delete is a
   * second thing to fix.
   */
  const [undoable, setUndoable] = useState<{ item: ProposalItem; at: number } | null>(null);

  /* Which rows have their description open. A row with text always counts. */
  const [described, setDescribed] = useState<Set<string>>(
    () => new Set(items.filter(item => !isEmpty(item.body)).map(item => item.id))
  );

  const subtotal = subtotalOf(items);
  const taxAmount = taxOf(subtotal, tax);
  const total = totalOf({ items, tax });

  const cell =
    'w-full rounded-lg border border-[var(--v2-border)] bg-[var(--v2-surface)] px-2 py-1.5 text-[13px] text-[var(--v2-text-primary)] disabled:opacity-60';

  /*
   * The currency symbol for the unit price field.
   *
   * The AMOUNT column is formatted money and wears one; the unit price was a
   * bare number, so the owner typed a price with nothing on screen saying what
   * currency it was in — on a dialog that can quote in four.
   *
   * Taken from the quote's own formatter rather than a lookup table, so it is
   * the same symbol the totals and the client's page will show. Falls back to
   * nothing rather than guessing: an absent symbol is better than a wrong one.
   */
  const currencyMark =
    formatMoney(0)
      .replace(/[\d.,\s]/g, '')
      /* `Intl` wraps the symbol in bidi marks (U+200E/U+200F) so it sits the
         right way round inside a sentence. Here it is a standalone adornment
         with its own `dir`, and the invisible characters would travel into the
         DOM for nothing. */
      .replace(/[\u200e\u200f\u061c]/g, '') || '';

  /** Shown above each field only when the grid has STACKED and the header row
      is gone. Without it a phone shows five unlabelled boxes. */
  const stackedLabel = 'mb-1 block text-[10.5px] font-medium text-[var(--v2-text-muted)] sm:hidden';

  function patch(id: string, next: Partial<Omit<ProposalItem, 'id'>>) {
    onChange(updateItem(items, id, next));
  }

  function drop(item: ProposalItem) {
    setUndoable({ item, at: items.findIndex(row => row.id === item.id) });
    onChange(removeItem(items, item.id));
  }

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'}>
      {/*
        Header. Hidden on a phone, where each row stacks and a header row would
        name columns that are no longer side by side.

        ───────────────────────────────────────────────────────────────────────
        THE LAST TRACK IS A FIXED WIDTH, NOT `auto`.

        It was `auto` in both grids, and `auto` sizes to CONTENT: the row's last
        cell holds three buttons (~70px) while the header's is an empty span
        (0px). That difference was absorbed by the `1fr` item column, so every
        track after it sat ~70px off — and the headers named the wrong fields.

        Reported as "unit price is missing": מחיר יחידה was printed above the
        AMOUNT, so the field under it was quantity. An owner entering a price of
        100 put it in the quantity column, and the quote came out at a hundred
        times the price.

        A fixed track cannot drift, because neither grid is measuring anything.

        ───────────────────────────────────────────────────────────────────────
        THE DATE TRACK IS 124px, NOT 88px.

        A native date input renders its own `dd/mm/yyyy` mask and a calendar
        button, and neither shrinks. At 88px the mask was clipped to `dd/mm/`
        and a real date to `19/11/2` — an owner could not read the year they
        had just set, on the column that tells a client when the work happens.

        The extra 36px comes out of the `1fr` item column, which has the most
        to spare: at this dialog's width it still gets ~350px.
        ───────────────────────────────────────────────────────────────────────
      */}
      {/*
        `px-[11px]` IS THE ROW CARD'S INSET, COPIED.

        Identical track definitions are not enough on their own: each item row's
        grid lives INSIDE a card with `p-2.5` and a 1px border, so its tracks
        begin 11px from the edge. This header is a sibling of those cards, not a
        child, so without the same inset it is 22px wider and every column
        drifts outward — the fixed tracks hold their widths and simply start in
        the wrong place.

        Two grids can only line up if they are the same width AND start at the
        same x. The track fix gave the first; this gives the second.
      */}
      <div className="hidden gap-2 px-[11px] pb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--v2-text-muted)] sm:grid sm:grid-cols-[124px_1fr_52px_96px_96px_76px]">
        {/* `px-2` on every heading, matching the inputs' own padding — without
            it the heading sits flush to its track while the value it names is
            inset by 8px, which reads as a second, smaller misalignment. */}
        <span className="px-[9px]">{t('proposal.doc.date') || 'Date'}</span>
        <span className="px-[9px]">{t('proposal.doc.item') || 'Item'}</span>
        <span className="px-[9px] text-end">{t('proposal.doc.qty') || 'Qty'}</span>
        <span className="px-[9px] text-end">{t('proposal.doc.unit') || 'Unit price'}</span>
        <span className="px-[9px] text-end">{t('proposal.doc.amount') || 'Amount'}</span>
        <span />
      </div>

      <div className="flex flex-col gap-2">
        {items.map((item, index) => (
          <div
            key={item.id}
            className="rounded-xl border border-[var(--v2-border)] bg-[var(--v2-bg)] p-2.5"
          >
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[124px_1fr_52px_96px_96px_76px]">
              <div>
                <span className={stackedLabel}>{t('proposal.doc.date') || 'Date'}</span>
                <input
                  type="date"
                  aria-label={t('proposal.doc.date') || 'Date'}
                  className={cell}
                  disabled={readOnly}
                  value={item.date ?? ''}
                  onChange={e => patch(item.id, { date: e.target.value || null })}
                />
              </div>
              <div>
                <span className={stackedLabel}>{t('proposal.doc.item') || 'Item'}</span>
                <input
                  type="text"
                  aria-label={t('proposal.doc.item') || 'Item'}
                  placeholder={t('proposal.doc.item_placeholder') || 'What this covers'}
                  className={cell}
                  disabled={readOnly}
                  value={item.label}
                  onChange={e => patch(item.id, { label: e.target.value })}
                />
              </div>
              <div>
                <span className={stackedLabel}>{t('proposal.doc.qty') || 'Qty'}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label={t('proposal.doc.qty') || 'Qty'}
                  className={`${cell} text-end tabular-nums`}
                  disabled={readOnly}
                  value={String(item.qty)}
                  onChange={e =>
                    patch(item.id, { qty: Number(e.target.value.replace(/,/g, '')) || 0 })
                  }
                />
              </div>
              <div>
                <span className={stackedLabel}>{t('proposal.doc.unit') || 'Unit price'}</span>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label={t('proposal.doc.unit') || 'Unit price'}
                    /* Padded on the trailing side so the number never runs
                       under the symbol sitting there. */
                    /*
                     * `ps-6`, not `pe-6`.
                     *
                     * The symbol used to sit on the TRAILING edge, which is
                     * the edge a right-aligned number ends at — so the price
                     * stopped 24px short while its heading, and every other
                     * numeric column, stopped at 8px. The column read as
                     * misaligned because it was.
                     *
                     * Leading side instead: the symbol is out of the number's
                     * way, and the figure ends where the heading does.
                     */
                    className={`${cell} text-end tabular-nums ${currencyMark ? 'ps-6' : ''}`}
                    disabled={readOnly}
                    value={String(item.unitPrice)}
                    onChange={e =>
                      patch(item.id, { unitPrice: Number(e.target.value.replace(/,/g, '')) || 0 })
                    }
                  />
                  {currencyMark && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-y-0 start-2 flex items-center text-[12px] text-[var(--v2-text-muted)]"
                    >
                      {currencyMark}
                    </span>
                  )}
                </div>
              </div>
              {/* Derived, never typed — see the header of this file. */}
              <div className="self-center">
                <span className={stackedLabel}>{t('proposal.doc.amount') || 'Amount'}</span>
                <span className="block px-[9px] text-end text-[13px] font-semibold tabular-nums text-[var(--v2-text-primary)]">
                  {formatMoney(itemAmount(item))}
                </span>
              </div>

              {!readOnly && (
                <div className="flex items-center justify-end gap-0.5">
                  <button
                    type="button"
                    aria-label={t('proposal.doc.up') || 'Move up'}
                    disabled={index === 0}
                    onClick={() => onChange(moveItem(items, item.id, -1))}
                    className="rounded-md p-1 text-[var(--v2-text-muted)] hover:bg-[var(--v2-surface)] hover:text-[var(--v2-text-primary)] disabled:opacity-30"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={t('proposal.doc.down') || 'Move down'}
                    disabled={index === items.length - 1}
                    onClick={() => onChange(moveItem(items, item.id, 1))}
                    className="rounded-md p-1 text-[var(--v2-text-muted)] hover:bg-[var(--v2-surface)] hover:text-[var(--v2-text-primary)] disabled:opacity-30"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={t('proposal.doc.remove') || 'Remove'}
                    onClick={() => drop(item)}
                    className="rounded-md p-1 text-[var(--v2-text-muted)] hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>

            {described.has(item.id) ? (
              <ItemDescription
                item={item}
                readOnly={readOnly}
                t={t}
                onBody={body => patch(item.id, { body })}
              />
            ) : (
              !readOnly && (
                <button
                  type="button"
                  onClick={() => setDescribed(prev => new Set(prev).add(item.id))}
                  className="mt-1.5 text-[12px] text-[var(--v2-primary)] hover:underline"
                >
                  + {t('proposal.doc.describe') || 'Add a description'}
                </button>
              )
            )}
          </div>
        ))}
      </div>

      {/* The way back from a deletion, where the deletion happened. */}
      {undoable && !readOnly && (
        <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-[var(--v2-border)] bg-[var(--v2-bg)] px-3 py-2 text-[12.5px]">
          <span className="text-[var(--v2-text-secondary)]">
            {t('proposal.doc.removed') || 'Item removed'}
          </span>
          <button
            type="button"
            onClick={() => {
              onChange(restoreItem(items, undoable.item, undoable.at));
              setUndoable(null);
            }}
            className="inline-flex items-center gap-1.5 font-semibold text-[var(--v2-primary)] hover:underline"
          >
            <Undo2 className="h-3.5 w-3.5" />
            {t('proposal.doc.undo') || 'Undo'}
          </button>
        </div>
      )}

      {!readOnly && (
        <button
          type="button"
          onClick={() => {
            const item = newItem(nextId());
            onChange([...items, item]);
            setUndoable(null);
          }}
          className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-[var(--v2-border)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--v2-text-secondary)] hover:border-[var(--v2-text-muted)]"
        >
          <Plus className="h-3.5 w-3.5" />
          {t('proposal.doc.add') || 'Add item'}
        </button>
      )}

      {/*
        A document with nothing in it cannot produce a total, so the dialog's
        Send is blocked. Said here, on the thing that is empty, rather than on
        the button — a disabled button with no reason is the worst of both.
      */}
      {items.length === 0 && (
        <p className="mt-2 text-[12px] text-red-600">
          {t('proposal.doc.needs_item') || 'Add at least one item, or turn the breakdown off.'}
        </p>
      )}

      {items.length > 0 && (
        <div className="mt-3 ms-auto w-full max-w-[260px] text-[12.5px]">
          <div className="flex justify-between py-1 text-[var(--v2-text-secondary)]">
            <span>{t('proposal.doc.subtotal') || 'Subtotal'}</span>
            <span className="tabular-nums">{formatMoney(subtotal)}</span>
          </div>
          {tax.rate > 0 && (
            <div className="flex justify-between py-1 text-[var(--v2-text-secondary)]">
              <span>
                {tax.label || t('proposal.doc.tax') || 'Tax'} {tax.rate}%
                {/* Said out loud, because an inclusive tax does NOT add to the
                    total and a line that looks like it should is confusing. */}
                {tax.inclusive ? ` · ${t('proposal.doc.tax_included') || 'included'}` : ''}
              </span>
              <span className="tabular-nums">{formatMoney(taxAmount)}</span>
            </div>
          )}
          <div className="mt-1 flex justify-between border-t border-[var(--v2-border)] pt-2 font-semibold text-[var(--v2-text-primary)]">
            <span>{t('proposal.doc.total') || 'Total'}</span>
            <span className="tabular-nums">{formatMoney(total)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
