/**
 * FR-17 — the standing fail-open warning.
 *
 * ── Undismissible BY CONSTRUCTION ────────────────────────────────────────
 * There is no `onClose`, no `dismissible`, no `useState`, no local storage
 * key. Not because someone remembered not to add one, but because there is
 * nowhere to put one without changing this component's signature — which is
 * a reviewable event.
 *
 * The warning is the reason the screen can be trusted at all: `isBosLlmAreaEnabled`
 * fails OPEN, so a card reading "Configured: off" can be describing a row that
 * no instance is honouring. A dismissed warning is the state in which this
 * page becomes actively misleading.
 */

import { AlertTriangle } from 'lucide-react';

import {
  FAIL_OPEN_ACTION,
  FAIL_OPEN_BODY,
  FAIL_OPEN_HEADLINE,
  FAIL_OPEN_INLINE,
} from '../copy';

interface Props {
  /**
   * `banner` at the top of the page, `inline` beside each area's switch.
   * Both say the same thing; the inline one says it in one sentence.
   */
  variant: 'banner' | 'inline';
}

export function FailOpenNotice({ variant }: Props) {
  if (variant === 'inline') {
    return (
      <p
        data-testid="fail-open-inline"
        className="flex items-start gap-2 text-xs text-amber-300/90"
      >
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{FAIL_OPEN_INLINE}</span>
      </p>
    );
  }

  return (
    <section
      data-testid="fail-open-banner"
      role="note"
      className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" aria-hidden="true" />
        <div className="space-y-2">
          {/*
           * Order: headline, then what to DO, then the quiet why (SA).
           *
           * At ~180 words this is long for a banner, and the ruling was to
           * REORDER rather than cut: an operator mid-incident reads the first
           * two blocks and acts, while the mechanism explains why the card in
           * front of them can be lying — which is what they come back for
           * afterwards. Hence the why sits last and is styled quieter than the
           * action, and nothing was removed.
           */}
          <h2 className="text-sm font-semibold text-amber-200">{FAIL_OPEN_HEADLINE}</h2>
          <p className="text-sm font-medium leading-relaxed text-amber-100">{FAIL_OPEN_ACTION}</p>
          <p className="text-sm leading-relaxed text-amber-100/70">{FAIL_OPEN_BODY}</p>
        </div>
      </div>
    </section>
  );
}
