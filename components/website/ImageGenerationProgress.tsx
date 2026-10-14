'use client';

/**
 * What the owner sees while a website picture is being generated.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS (BR-3)
 *
 * A picture takes about a minute (measured: p50 53.4 s, p95 58.1 s). For that
 * whole minute the picker used to show a spinner on the button and nothing
 * else, which reads as "broken" and invites a second, separately charged
 * press. This says what is happening, how long it usually takes and how long
 * it has been, from the first frame after Generate.
 *
 * HONEST PROGRESS ONLY. The provider reports nothing while it works, so there
 * is no percentage and no bar that fills: anything of the kind would be
 * invented. The placeholder pulses, which says "working", not "nearly done".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE LIVE REGION IS ALWAYS MOUNTED
 *
 * A `role="status"` element inserted together with its text is often not
 * announced by screen readers, so the start message, the one that matters
 * most, would be silent. The region therefore exists while idle (empty), and
 * only its text changes. The timer sits OUTSIDE it, so it is readable but not
 * announced every second.
 *
 * WHY THE TIMER LIVES HERE
 *
 * It ticks every second. Kept in this small component, only the panel
 * re-renders, not the picker's grid of pictures. Elapsed time is worked out
 * from the start time rather than counted, so a throttled background tab still
 * shows the true time when it wakes.
 *
 * @module components/website/ImageGenerationProgress
 */

import { useEffect, useState } from 'react';
import { useLanguage } from '@/lib/business-os/LanguageContext';

/**
 * When the message turns to "taking longer than usual". Above the measured p95
 * (58.1 s) with some room, so it only shows when a run really is slow.
 */
export const SLOW_AFTER_SECONDS = 75;

/** The same three crops the service generates at (3:2, 2:3, 1:1 by default). */
const PLACEHOLDER_RATIO: Record<'wide' | 'portrait' | 'square', string> = {
  wide: 'aspect-[3/2]',
  portrait: 'aspect-[2/3]',
  square: 'aspect-square',
};

interface ImageGenerationProgressProps {
  /** The crop being generated, so the placeholder has the picture's shape. */
  aspect: 'wide' | 'portrait' | 'square';
  /** When Generate was pressed (ms since epoch), or `null` while idle. */
  startedAt: number | null;
}

/** `m:ss`, the same in every language. */
function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function ImageGenerationProgress({ aspect, startedAt }: ImageGenerationProgressProps) {
  const { t } = useLanguage();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  const isActive = startedAt !== null;
  const elapsed = isActive ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
  const isSlow = elapsed >= SLOW_AFTER_SECONDS;

  return (
    // `contents` while idle: no box, so the footer's spacing is unchanged, but
    // the live region below stays in the accessibility tree.
    <div
      className={isActive ? 'flex items-start gap-3 rounded-lg border border-[var(--v2-border)] bg-[var(--v2-surface-2)] p-3' : 'contents'}
      data-testid="image-generation-progress"
    >
      {isActive && (
        <div
          aria-hidden="true"
          data-testid="image-generation-placeholder"
          data-aspect={aspect}
          className={`h-28 shrink-0 rounded-lg bg-[var(--v2-border)] animate-pulse motion-reduce:animate-none ${PLACEHOLDER_RATIO[aspect]}`}
        />
      )}
      <div className="min-w-0 flex-1 space-y-1">
        <div role="status" aria-live="polite" className="space-y-1">
          {isActive && (
            <>
              <p className="text-sm font-medium text-[var(--v2-text-primary)]">
                {t(isSlow ? 'media.generate.progress_slow' : 'media.generate.progress_title')}
              </p>
              <p className="text-xs text-[var(--v2-text-muted)]">{t('media.generate.progress_can_close')}</p>
              <p className="text-xs text-[var(--v2-text-muted)]">{t('media.generate.progress_no_repeat')}</p>
            </>
          )}
        </div>
        {isActive && (
          <p className="text-xs text-[var(--v2-text-muted)]" data-testid="image-generation-elapsed">
            {t('media.generate.progress_elapsed')}{' '}
            <span dir="ltr" className="tabular-nums">{formatElapsed(elapsed)}</span>
          </p>
        )}
      </div>
    </div>
  );
}

export default ImageGenerationProgress;
