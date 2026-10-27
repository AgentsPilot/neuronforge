'use client';

import { useCallback, useRef } from 'react';
import { motion, useTransform } from 'framer-motion';
import { Play, Pause, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { clock } from './timing';
import { TONE } from './stageKit';
import type { Playhead } from './usePlayhead';
import type { Chapter } from './storyboard';
import type { Narration } from './useNarration';

/**
 * Play, pause, scrub, jump.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE WHOLE BAR IS `dir="ltr"`, IN EVERY LANGUAGE
 *
 * Time is not prose. Every player a Hebrew-speaking owner already uses —
 * YouTube, WhatsApp voice notes, the phone's own lock screen — runs its
 * transport left to right, with elapsed on the left. Mirroring it under RTL
 * makes the bar correct by one rule and wrong by every habit.
 *
 * It also keeps the pointer maths unconditional: `clientX - rect.left` is the
 * elapsed fraction in both directions, so there is no second code path to get
 * subtly wrong, and Left always means earlier.
 *
 * ⚠️ A later blanket "fix the RTL" pass will want to remove this. Do not.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PLAY/PAUSE IS FIRST IN THE DOM
 *
 * Autoplay is only acceptable under WCAG 2.2.2 because a visible pause exists;
 * putting it first means Tab reaches it before anything else, so the control
 * that stops the motion is the first one a keyboard user finds.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TICKS ARE NOT BUTTONS
 *
 * Interactive children inside a `role="slider"` is invalid ARIA and leaves a
 * screen reader describing a slider that contains six buttons. The ticks are
 * `aria-hidden` marks; chapter navigation is the labelled row underneath,
 * which doubles as the index that "show all the options" implies.
 */
export function Transport({
  head,
  chapters,
  durations,
  t,
  narration,
}: {
  head: Playhead;
  chapters: readonly Chapter[];
  /**
   * Chapter lengths, in order.
   *
   * Passed in rather than read off the chapters: a chapter has no authored
   * duration any more — its length is computed from how long its script takes
   * to speak, which depends on the owner's language. Reading `chapter.durMs`
   * here summed `undefined` and printed the clock as `NaN:NaN`.
   */
  durations: readonly number[];
  t: (key: string, vars?: Record<string, string | number>) => string;
  narration: Narration;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const fill = useTransform(head.progress, p => `${p * 100}%`);

  const msFromPointer = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return 0;
      const r = el.getBoundingClientRect();
      const ratio = r.width > 0 ? (clientX - r.left) / r.width : 0;
      return Math.max(0, Math.min(1, ratio)) * head.totalMs;
    },
    [head.totalMs]
  );

  /* Pointer capture is what keeps a drag alive once it leaves an 8px track. */
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      head.beginScrub();
      head.seek(msFromPointer(e.clientX));
    },
    [head, msFromPointer]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!head.isScrubbing) return;
      head.seek(msFromPointer(e.clientX));
    },
    [head, msFromPointer]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      head.endScrub();
    },
    [head]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const now = head.timeMs.get();
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          head.seek(now - 1000);
          break;
        case 'ArrowRight':
          e.preventDefault();
          head.seek(now + 1000);
          break;
        case 'ArrowDown':
          e.preventDefault();
          head.seek(now - 5000);
          break;
        case 'ArrowUp':
          e.preventDefault();
          head.seek(now + 5000);
          break;
        case 'Home':
          e.preventDefault();
          head.seek(0);
          break;
        case 'End':
          e.preventDefault();
          head.seek(head.totalMs);
          break;
        case ',':
          e.preventDefault();
          head.seekChapter(head.frame.chapter - 1);
          break;
        case '.':
          e.preventDefault();
          head.seekChapter(head.frame.chapter + 1);
          break;
        case ' ':
        case 'Spacebar':
          // Without preventDefault the dialog scrolls under the film.
          e.preventDefault();
          head.toggle();
          break;
        default:
          break;
      }
    },
    [head]
  );

  const starts: number[] = [];
  let acc = 0;
  for (const ms of durations) {
    starts.push(acc);
    acc += ms;
  }

  const here = durations[head.frame.chapter] ?? 0;
  const elapsed = (starts[head.frame.chapter] ?? 0) + here * head.frame.u;

  return (
    <div dir="ltr" className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        {/* First in the DOM, deliberately. */}
        <button
          type="button"
          onClick={head.isEnded ? head.replay : head.toggle}
          aria-label={
            head.isEnded
              ? t('presence.tour.transport.replay')
              : head.isPlaying
                ? t('presence.tour.transport.pause')
                : t('presence.tour.transport.play')
          }
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition-opacity hover:opacity-90"
          style={{ background: TONE.primary }}
        >
          {head.isEnded ? (
            <RotateCcw className="h-4 w-4" />
          ) : head.isPlaying ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="ms-0.5 h-4 w-4" />
          )}
        </button>

        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label={t('presence.tour.transport.scrubber')}
          aria-valuemin={0}
          aria-valuemax={Math.round(head.totalMs)}
          aria-valuenow={Math.round(elapsed)}
          /* In words. A raw millisecond count read aloud is noise. */
          aria-valuetext={t('presence.tour.transport.position', {
            n: head.frame.chapter + 1,
            total: chapters.length,
            time: clock(elapsed),
          })}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
          className="relative h-2 flex-1 cursor-pointer rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          style={
            {
              background: 'var(--v2-border)',
              ['--tw-ring-color' as string]: TONE.primary,
            } as React.CSSProperties
          }
        >
          <motion.div
            className="absolute inset-y-0 start-0 rounded-full"
            style={{ width: fill, background: TONE.primary }}
          />

          {/* Marks, not controls. */}
          {starts.slice(1).map((s, i) => (
            <span
              key={i}
              aria-hidden="true"
              className="absolute top-0 h-2 w-px"
              style={{ left: `${(s / head.totalMs) * 100}%`, background: 'var(--v2-surface)' }}
            />
          ))}
        </div>

        <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--v2-text-muted)]">
          {clock(elapsed)} / {clock(head.totalMs)}
        </span>

        {/*
          * The voice, and ONLY where there is a voice to turn on.
          *
          * `isSupported` is false when the platform has no speech voice for
          * this owner's language — Hebrew and Spanish ship with macOS, iOS,
          * Windows and Android, but not with every Linux or kiosk build. A
          * toggle that silently does nothing reads as a broken feature, so it
          * is absent rather than disabled.
          *
          * `aria-pressed` because this is a toggle, not an action, and the
          * label names what the NEXT press does.
          */}
        {narration.isSupported && (
          <button
            type="button"
            onClick={narration.toggle}
            aria-pressed={narration.isOn}
            aria-label={
              narration.isOn
                ? t('presence.tour.transport.voiceOff')
                : t('presence.tour.transport.voiceOn')
            }
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors"
            style={{
              color: narration.isOn ? TONE.primary : 'var(--v2-text-muted)',
              background: narration.isOn ? `${TONE.primary}1A` : 'transparent',
            }}
          >
            {narration.isOn ? (
              <Volume2 className="h-4 w-4" />
            ) : (
              <VolumeX className="h-4 w-4" />
            )}
          </button>
        )}
      </div>

      {/* The index. Labelled buttons, outside the slider. */}
      <div className="flex flex-wrap gap-1.5">
        {chapters.map((c, i) => {
          const active = i === head.frame.chapter;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => head.seekChapter(i)}
              aria-current={active ? 'true' : undefined}
              className="rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors"
              style={{
                background: active ? `${TONE.primary}1A` : 'transparent',
                color: active ? TONE.primary : 'var(--v2-text-muted)',
                border: `1px solid ${active ? TONE.primary : 'var(--v2-border)'}`,
              }}
            >
              {i + 1}. {t(c.titleKey)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
