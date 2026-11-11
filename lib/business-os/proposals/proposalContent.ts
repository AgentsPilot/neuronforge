/**
 * The optional breakdown that explains a quote's total.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TOTAL IS STILL ONE NUMBER
 *
 * `proposals.total` remains the single authoritative figure and the only thing
 * the platform acts on — the expiry sweep, the reminder cooldown, quote
 * chasing, the acceptance-rate detector, `splitTotal`, the invoice, the money
 * page. This module does not change that. It computes the number the owner
 * would otherwise have typed, from items they wrote instead.
 *
 * So the integration point downstream is one line: `setTotal(...)`. Every
 * calculation that reads the total — stage previews, the per-session split,
 * the send gate, the POST payload — flows through `totalNumber` and never
 * learns where the figure came from.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ROUNDING, AND WHY IT IS DONE HERE
 *
 * Money is held as a decimal number, matching `numeric(12,2)` on the column and
 * the arithmetic the modal already does. Every boundary is rounded to the cent
 * at the point it is computed, never at the end: an amount is rounded before it
 * is summed, and the sum is rounded before tax is taken from it.
 *
 * That ordering is what makes `sum(items) + tax === total` true as integers of
 * cents, which the route asserts and the client is asked to approve. Deferring
 * the rounding leaves a document whose visible lines do not add up to its
 * visible total — off by a cent, and impossible to explain to a client.
 *
 * @module lib/business-os/proposals
 */

import { z } from 'zod';
import type { ReplyBlock } from '@/lib/business-os/mail/replyBody';

/** The cent. Everything here rounds to it, at every boundary. */
export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  /* `+ Number.EPSILON` so 1.005 rounds up rather than down, which is what a
     person reading the column expects and what a half-up currency rounds to. */
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export interface ProposalItem {
  /** Stable across edits, so React keys and undo survive a reorder. */
  id: string;
  /**
   * When this item is DELIVERED. Never a payment date — the stages own those,
   * and conflating them would have an owner believe they had scheduled money.
   * Null is allowed: plenty of items are "whenever the previous one ends".
   */
  date: string | null;
  label: string;
  qty: number;
  unitPrice: number;
  /** The per-item description. Empty array renders as no description at all. */
  body: ReplyBlock[];
}

export interface ProposalTax {
  /** Percent, e.g. 10 for 10%. */
  rate: number;
  label: string;
  /** True when `unitPrice` already contains the tax. */
  inclusive: boolean;
}

export interface ProposalContent {
  /** Bumped only if a stored shape ever has to be read two ways. */
  v: 1;
  /** Mirrors `description` — written once, shown as the document's overview. */
  overview: ReplyBlock[];
  items: ProposalItem[];
  tax: ProposalTax;
}

/* ───────────────────────────────────────────────────────────────────────────
 * ARITHMETIC
 * ─────────────────────────────────────────────────────────────────────────── */

/** One line's money. The only derived cell in the editor — never typed. */
export function itemAmount(item: Pick<ProposalItem, 'qty' | 'unitPrice'>): number {
  const qty = Number.isFinite(item.qty) ? item.qty : 0;
  const unit = Number.isFinite(item.unitPrice) ? item.unitPrice : 0;
  return round2(qty * unit);
}

/** The lines added up, each already rounded. */
export function subtotalOf(items: ProposalItem[]): number {
  return round2(items.reduce((sum, item) => sum + itemAmount(item), 0));
}

/**
 * What the tax line says.
 *
 * Two shapes, because a business's prices either include tax or do not, and
 * `prices_include_tax` on the proposal already records which. Inclusive prices
 * do not ADD anything to the total — the tax is the portion already inside it,
 * and saying so is the whole point of showing the line.
 */
export function taxOf(subtotal: number, tax: ProposalTax): number {
  const rate = Number.isFinite(tax.rate) ? tax.rate : 0;
  if (rate <= 0) return 0;
  if (tax.inclusive) {
    return round2(subtotal - subtotal / (1 + rate / 100));
  }
  return round2((subtotal * rate) / 100);
}

/**
 * The figure the client is asked to approve, and the one written to `total`.
 *
 * Inclusive tax is already inside the subtotal, so it is NOT added again —
 * adding it would charge the tax twice, on exactly the accounts whose prices
 * are quoted gross.
 */
export function totalOf(content: Pick<ProposalContent, 'items' | 'tax'>): number {
  const subtotal = subtotalOf(content.items);
  if (content.tax.inclusive) return subtotal;
  return round2(subtotal + taxOf(subtotal, content.tax));
}

/**
 * Does this document add up to that total?
 *
 * Compared in whole cents rather than with a tolerance: both sides have already
 * been rounded to the cent, so anything other than equality is a real
 * disagreement rather than float noise.
 */
export function totalMatches(content: Pick<ProposalContent, 'items' | 'tax'>, total: number): boolean {
  return Math.round(totalOf(content) * 100) === Math.round(round2(total) * 100);
}

/* ───────────────────────────────────────────────────────────────────────────
 * EDITING
 *
 * Pure, and returning new arrays, so the editor's state is a value rather than
 * a mutable structure — which is what makes "undo the row I just deleted"
 * three lines instead of a feature.
 * ─────────────────────────────────────────────────────────────────────────── */

/** Ids are opaque and local to one document; uniqueness within it is enough. */
export function newItem(id: string): ProposalItem {
  return { id, date: null, label: '', qty: 1, unitPrice: 0, body: [] };
}

export function addItem(items: ProposalItem[], item: ProposalItem): ProposalItem[] {
  return [...items, item];
}

export function removeItem(items: ProposalItem[], id: string): ProposalItem[] {
  return items.filter(item => item.id !== id);
}

export function updateItem(
  items: ProposalItem[],
  id: string,
  patch: Partial<Omit<ProposalItem, 'id'>>
): ProposalItem[] {
  return items.map(item => (item.id === id ? { ...item, ...patch } : item));
}

/**
 * Move one row by one place.
 *
 * Order carries meaning the dates cannot: two items can share a date, and a
 * document reads as a sequence of work. Out-of-range moves are a no-op rather
 * than an error — the first row's "up" is a button the owner may well press.
 */
export function moveItem(items: ProposalItem[], id: string, direction: -1 | 1): ProposalItem[] {
  const from = items.findIndex(item => item.id === id);
  if (from < 0) return items;
  const to = from + direction;
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/**
 * Put a removed row back where it was.
 *
 * The undo for a deletion, and the reason `removeItem` is not the end of the
 * story: an item carries a description the owner may have spent real time on,
 * and a confirm dialog is something people learn to dismiss without reading.
 */
export function restoreItem(items: ProposalItem[], item: ProposalItem, at: number): ProposalItem[] {
  const index = Math.max(0, Math.min(at, items.length));
  return [...items.slice(0, index), item, ...items.slice(index)];
}

/* ───────────────────────────────────────────────────────────────────────────
 * REUSE
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * The same items, moved to start on a new day.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY OFFSETS ARE DERIVED RATHER THAN STORED
 *
 * Reusing a document written in October means every date in it has passed. A
 * contractor's three phases run a fortnight apart whenever the job starts, so
 * what carries over is the SPACING, not the days.
 *
 * The source's own dates already encode that spacing — the gap from its first
 * dated item to each of the others — so nothing has to be stored alongside
 * them. A template with explicit `dayOffset` fields was considered and is
 * simply this arithmetic, written down twice and able to disagree.
 *
 * Items with no date keep none: "whenever the previous one ends" is a real
 * answer and inventing a day for it would be worse than leaving it open.
 */
export function rebaseItemDates(items: ProposalItem[], startISO: string): ProposalItem[] {
  const dated = items.filter(item => item.date);
  if (dated.length === 0) return items;

  const origin = Date.parse(`${dated[0].date}T00:00:00Z`);
  const start = Date.parse(`${startISO}T00:00:00Z`);
  if (!Number.isFinite(origin) || !Number.isFinite(start)) return items;

  const DAY = 24 * 60 * 60 * 1000;

  return items.map(item => {
    if (!item.date) return item;
    const at = Date.parse(`${item.date}T00:00:00Z`);
    if (!Number.isFinite(at)) return item;
    /* Rounded, not floored: a source whose dates straddle a DST boundary is
       still a whole number of days apart to the person who wrote them. */
    const offset = Math.round((at - origin) / DAY);
    return { ...item, date: new Date(start + offset * DAY).toISOString().slice(0, 10) };
  });
}

/**
 * Fresh ids for a reused document.
 *
 * The source's ids belong to the source. Carrying them into a new proposal
 * would make two documents claim the same item identity — harmless today, and
 * exactly the sort of thing that stops being harmless once anything joins on
 * them.
 */
export function reuseItems(items: ProposalItem[], mintId: () => string): ProposalItem[] {
  return items.map(item => ({ ...item, id: mintId() }));
}

/* ───────────────────────────────────────────────────────────────────────────
 * VALIDATION
 * ─────────────────────────────────────────────────────────────────────────── */

const replyRunSchema = z.object({
  text: z.string().max(4000),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  href: z.string().max(2048).optional(),
});

const replyBlockSchema = z.object({
  type: z.enum(['p', 'li']),
  list: z.enum(['ul', 'ol']).optional(),
  runs: z.array(replyRunSchema).max(200),
});

/**
 * The bounds are business rules, not defensive noise — the same stance
 * `proposalShape.ts` takes.
 *
 * 60 items is a long renovation and well past any document a person reads on a
 * phone; a quantity of zero is a line that bills nothing and is almost always
 * a half-finished row; and `unitPrice` is allowed to be 0 because an included
 * item worth naming is a real thing an owner writes.
 */
export const proposalContentSchema = z.object({
  v: z.literal(1),
  overview: z.array(replyBlockSchema).max(100),
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'A delivery date is YYYY-MM-DD')
          .nullable(),
        label: z.string().min(1).max(200),
        qty: z.number().min(0.01).max(100000),
        unitPrice: z.number().min(0).max(100000000),
        body: z.array(replyBlockSchema).max(100),
      })
    )
    .min(1, 'A document needs at least one item')
    .max(60),
  tax: z.object({
    rate: z.number().min(0).max(100),
    label: z.string().max(60),
    inclusive: z.boolean(),
  }),
});

export type ProposalContentInput = z.infer<typeof proposalContentSchema>;
