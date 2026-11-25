/**
 * The one spinner every CRM tab waits behind.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * There were three, and the owner noticed: "why does the envelope page have a
 * different spinner?"
 *
 *   the page (kanban, list)   a 64px ring, #8B5CF6, label underneath
 *   the tasks list            a 48px ring, #8B5CF6, label underneath
 *   the subscribers list      a 20px lucide `Loader2`, muted, label beside it
 *
 * Nobody chose that. Each view was built at a different time and brought its
 * own, and it stayed invisible while the page covered three of the four tabs
 * with its own spinner. Naming each wait (`eachTabSaysWhatItIsLoading`) is what
 * uncovered the other two.
 *
 * So the appearance lives HERE, once, and the views pass only the one thing
 * that differs between them: what is being loaded. The ring's colour is kept at
 * the value the two bigger spinners already used, so this reconciles the three
 * without quietly restyling the CRM as well — but it is now a single
 * declaration rather than three, which is the point.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use client';

import React from 'react';

/** The CRM's spinner colour. One definition; it was three. */
const RING = '#8B5CF6';

export function CRMLoadingState({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center min-h-[300px]">
      <div className="text-center space-y-4">
        <div
          className="w-12 h-12 border-4 border-t-transparent rounded-full animate-spin mx-auto"
          style={{ borderColor: RING, borderTopColor: 'transparent' }}
          /* The ring carries no text, so it is announced by the label beside
             it rather than by a second live region. */
          aria-hidden="true"
        />
        <p className="text-[var(--v2-text-secondary)] font-medium" role="status">
          {label}
        </p>
      </div>
    </div>
  );
}
