'use client';

/**
 * The chrome every band on the reports page wears.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS AT ALL
 *
 * The first version of this page reused four components that each brought their
 * own look: horizontal bar charts for services, five colour-coded tiles for
 * financial health, a five-column table with its own header style for channels.
 * Every one was correct in isolation and the page read as three products stacked
 * on top of each other — which defeats the thing it was rebuilt for.
 *
 * So the bands share one shell, and the only thing a band supplies is its name,
 * the question it answers, and its rows. A new band cannot drift.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { ReactNode } from 'react';

interface BandProps {
  /** The uppercase micro-label, e.g. "Where clients came from". */
  name: string;
  /**
   * The question this band answers, in the owner's words, e.g. "Who sent them?".
   *
   * Not decoration: it is the band's reason for being on the page, and writing
   * it down is what stops a band accumulating figures that answer nothing.
   */
  question?: string;
  /** A note under the rows, for what the figures do not cover. */
  caption?: string;
  children: ReactNode;
}

export function Band({ name, question, caption, children }: BandProps) {
  return (
    <section
      className="bg-[var(--v2-surface)] border border-[var(--v2-border)] overflow-hidden"
      style={{ borderRadius: 'var(--v2-radius-card, 16px)' }}
      aria-label={name}
    >
      <header className="flex items-baseline justify-between gap-3 px-[18px] py-3 border-b border-[var(--v2-border)]">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.085em] text-[var(--v2-text-muted)]">
          {name}
        </h2>
        {question && (
          <p className="text-xs text-[var(--v2-text-muted)] text-end">{question}</p>
        )}
      </header>

      {children}

      {caption && (
        <p className="px-[18px] py-3 text-xs text-[var(--v2-text-muted)] border-t border-[var(--v2-border)] bg-[var(--v2-bg)]">
          {caption}
        </p>
      )}
    </section>
  );
}
