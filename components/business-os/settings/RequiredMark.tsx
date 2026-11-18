'use client';

/**
 * Which settings fields are actually mandatory, said on the form itself.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FORMS NEVER SAID. The dashboard did.
 *
 * `missingProfileFields` and `missingInvoiceFields` decide what a business is
 * incomplete for, and what they decide has teeth: the readiness card names it,
 * `journeyReadiness` blocks a publish over it, and `InvoiceDeliveryService`
 * refuses to send a document without it. But the screens where those answers
 * are actually typed showed thirty-odd boxes with no mark on any of them, so an
 * owner read "Still needs: Business name · Industry · Company size" on the
 * dashboard, opened settings, and had to guess which of the thirty those three
 * were. The tax ID was the one exception, marked when a tax invoice needs it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERY MARK IS DERIVED, NEVER HAND-WRITTEN.
 *
 * The caller computes `missing` by calling the same function the gate calls,
 * against the values currently in the form — so the asterisks and the summary
 * line move as the owner types, and a change to the rule cannot leave a stale
 * asterisk behind. Hard-coding "these six are required" in JSX is exactly the
 * second opinion this product keeps paying for.
 *
 * Mandatory here means the narrow thing the rule means: the platform BREAKS
 * without it. A logo, a website, a phone number and a description are all
 * deliberately unmarked — `profileReadiness` records why for each — and leaving
 * them unmarked is half of what this component communicates.
 *
 * @module components/business-os/settings
 */

import { AlertCircle, CheckCircle2 } from 'lucide-react';

/** The red asterisk, in the shape the invoice tax ID already used. */
export function RequiredMark({ reason }: { reason?: string }) {
  return (
    <span
      title={reason}
      aria-hidden="true"
      className="ms-0.5"
      style={{ color: '#B42318', fontWeight: 600 }}
    >
      *
    </span>
  );
}

interface StripProps {
  /**
   * What is still outstanding, straight from `missingProfileFields` or
   * `missingInvoiceFields` run against the form's current values.
   */
  missing: string[];
  /** How many fields the rule asks for in total, for the "3 of 6" count. */
  total: number;
  /** Field id to the name THIS form puts on it — `setup.field.*`. */
  labelFor: (field: string) => string;
  /** "Still needs:" */
  stillNeedsLabel: string;
  /** Said when nothing is outstanding. */
  doneLabel: string;
  /** One line above the list: what these fields are for. */
  note?: string;
}

/**
 * One line per form: what is left, or that nothing is.
 *
 * Amber rather than red while something is outstanding. Nothing here is an
 * error — an unfinished profile is the normal state of a new account — and a
 * red banner on first open would read as a failure the owner had caused.
 */
export function RequiredStrip({
  missing,
  total,
  labelFor,
  stillNeedsLabel,
  doneLabel,
  note,
}: StripProps) {
  const done = missing.length === 0;
  const filled = total - missing.length;

  return (
    <div
      className="flex items-start gap-2 p-3 border"
      style={{
        borderRadius: 'var(--v2-radius-button)',
        background: done ? 'rgba(22, 163, 74, 0.07)' : 'rgba(217, 119, 6, 0.08)',
        borderColor: done ? 'rgba(22, 163, 74, 0.25)' : 'rgba(217, 119, 6, 0.28)',
      }}
    >
      {done ? (
        <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" style={{ color: '#15803D' }} />
      ) : (
        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: '#B45309' }} />
      )}

      <div className="min-w-0 space-y-0.5">
        <p className="text-xs font-medium" style={{ color: done ? '#15803D' : '#92400E' }}>
          {done ? doneLabel : `${stillNeedsLabel} ${missing.map(labelFor).join(' · ')}`}
        </p>

        {/* The count, so "what is left" has a size. Shown only while something
            is outstanding: after that the line above says it all. */}
        {!done && (
          <p className="text-[11px]" style={{ color: '#92400E', opacity: 0.85 }}>
            {filled}/{total}
            {note ? ` · ${note}` : ''}
          </p>
        )}
      </div>
    </div>
  );
}
