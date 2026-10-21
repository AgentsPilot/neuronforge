'use client';

/**
 * The margin-check prompt (AI model price review slice 8; MP-FR-14, Q7, user
 * decisions B-1, B-2, B-4). One card per Apply that touched a model Business OS
 * uses, until an admin marks it done with a note. It links to the credit
 * pricing view and changes nothing itself: plans, allowances, markup and credit
 * value never change automatically.
 *
 * The items are the server's own record (stored on the apply batch); they are
 * shown as text, never parsed into numbers.
 */

import { useState, type FormEvent } from 'react';

import type { OpenMarginReviewView } from '@/lib/ai/pricing-research/comparisonModel';
import { formatUtc } from '@/app/admin/components/layout/adminFormat';
import { ADMIN_BUTTON } from '@/app/admin/components/layout/adminTable';
import { CREDIT_PRICING_VIEW_URL, markMarginReviewDone } from '@/app/admin/system-config/priceApply';
import { APPLY_WORDS, MARGIN_WORDS } from '@/app/admin/system-config/priceReviewCopy';

interface Props {
  reviews: readonly OpenMarginReviewView[];
  /** More reviews are open than the read returned (SA optimisation: never hide them silently). */
  more?: boolean;
  onDone: () => void;
}

interface ItemChange {
  unit: string;
  old: string | null;
  new: string;
  change: string | null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** One stored margin item in words: "gpt-4o (Chat): input per 1M $2.5 → $3 (+20.00%)". */
function itemWords(item: Record<string, unknown>): { title: string; changes: string[]; fallbackDiffers: boolean } {
  const areas = Array.isArray(item.areas) ? item.areas.filter((area): area is string => typeof area === 'string') : [];
  const changes = Array.isArray(item.changes) ? (item.changes as ItemChange[]) : [];
  return {
    title: `${text(item.model)}${areas.length > 0 ? ` (${areas.join(', ')})` : ''}`,
    changes: changes.map((entry) => {
      const before = entry.old === null ? MARGIN_WORDS.noChange : `$${text(entry.old)}`;
      return `${text(entry.unit)}: ${before} → $${text(entry.new)}${entry.change ? ` (${entry.change})` : ''}`;
    }),
    fallbackDiffers: item.fallbackDiffers === true,
  };
}

function ReviewCard({ review, onDone }: { review: OpenMarginReviewView; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (note.trim().length < 3) {
      setError(APPLY_WORDS.reasonTooShort);
      return;
    }
    setError(null);
    setSaving(true);
    const result = await markMarginReviewDone(review.batchId, note.trim());
    setSaving(false);
    if (result.ok) {
      onDone();
      return;
    }
    setError(result.message);
  };

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      data-testid={`margin-review-${review.batchId}`}
      className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3"
    >
      <p className="text-xs text-slate-300">{`${formatUtc(review.appliedAt)} · ${MARGIN_WORDS.appliedBy} ${review.appliedBy}`}</p>
      <ul className="space-y-1 text-xs text-slate-200">
        {review.items.map((item, index) => {
          const words = itemWords(item);
          return (
            <li key={`${words.title}-${index}`}>
              <span className="font-mono">{words.title}</span>
              {words.changes.length > 0 && <span className="ml-1">{words.changes.join('; ')}</span>}
              {words.fallbackDiffers && <span className="ml-1 text-amber-200">{`(${MARGIN_WORDS.fallbackDiffers})`}</span>}
            </li>
          );
        })}
      </ul>
      <a href={CREDIT_PRICING_VIEW_URL} className="text-xs text-purple-300 underline" data-testid="margin-review-link">
        {MARGIN_WORDS.link}
      </a>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-300" htmlFor={`margin-note-${review.batchId}`}>
          {MARGIN_WORDS.note}
        </label>
        <input
          id={`margin-note-${review.batchId}`}
          type="text"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-required="true"
          aria-describedby={error ? `margin-note-error-${review.batchId}` : undefined}
          data-testid={`margin-note-${review.batchId}`}
          className="min-w-[16rem] flex-1 rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-white"
        />
        <button type="submit" disabled={saving} className={ADMIN_BUTTON} data-testid={`margin-done-${review.batchId}`}>
          {saving ? MARGIN_WORDS.saving : MARGIN_WORDS.markDone}
        </button>
      </div>
      {error && (
        <p role="alert" id={`margin-note-error-${review.batchId}`} className="text-xs text-red-300">
          {error}
        </p>
      )}
    </form>
  );
}

export function MarginReviewNotice({ reviews, more = false, onDone }: Props) {
  if (reviews.length === 0) return null;
  return (
    <section aria-label={MARGIN_WORDS.title} data-testid="margin-review-notice" className="space-y-2">
      <h3 className="text-sm font-semibold text-amber-200">{MARGIN_WORDS.title}</h3>
      <p className="text-xs text-slate-300">{MARGIN_WORDS.intro}</p>
      {reviews.map((review) => (
        <ReviewCard key={review.batchId} review={review} onDone={onDone} />
      ))}
      {more && (
        <p data-testid="margin-review-more" className="text-xs text-amber-200">
          {MARGIN_WORDS.more}
        </p>
      )}
    </section>
  );
}
