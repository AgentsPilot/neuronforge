'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAnimationFrame, useMotionValue, type MotionValue } from 'framer-motion';
import { clamp01 } from './timing';

/**
 * The clock the whole tour is a function of.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE TIMER, TWO CONSUMPTION CHANNELS
 *
 * The naive version keeps `t` in React state and re-renders every scene sixty
 * times a second. The stage recreates roughly a dozen screen fragments, so
 * that is a few hundred nodes reconciled per frame to move one cursor.
 *
 * So `t` lives in a `MotionValue`, which notifies subscribers **without**
 * re-rendering React. Continuous properties — cursor position, bar fill,
 * crossfades — read it through `useTransform` and never touch the render path.
 *
 * Discrete facts cannot work that way: which scene is mounted and which
 * caption is on screen are React's business. Those come out of `frame`, which
 * is set from the same rAF callback but only when it actually changes, with
 * `u` quantised so a scene re-renders on the order of a hundred times across a
 * chapter rather than per frame.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY PLAY-AFTER-END IS REPLAY
 *
 * Pressing play on a finished film can only sensibly mean "again". Making
 * `play()` rewind when `isEnded` means Replay is sugar over the same path
 * rather than a second code path that can drift from it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT PAUSES, IT NEVER AUTO-RESUMES
 *
 * A hidden tab or an offscreen stage pauses. Coming back does NOT resume:
 * somebody who left a 45-second film and returned has lost their place, and
 * silently continuing from wherever it drifted to is worse than a paused frame
 * with a visible play button.
 *
 * @module components/business-os/presence-tour/usePlayhead
 */

/** Where the playhead is, in terms a scene can use. */
export interface Frame {
  /** Index into the chapter list. */
  chapter: number;
  /** 0..1 within that chapter. The only time value a scene ever reads. */
  u: number;
}

export interface Playhead {
  /** Continuous, in ms. For `useTransform` only — never read during render. */
  timeMs: MotionValue<number>;
  /** Continuous, 0..1 across the whole tour. */
  progress: MotionValue<number>;
  frame: Frame;
  isPlaying: boolean;
  isEnded: boolean;
  isScrubbing: boolean;
  totalMs: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (ms: number) => void;
  seekChapter: (index: number) => void;
  replay: () => void;
  beginScrub: () => void;
  endScrub: () => void;
}

/**
 * `u` is rounded to this many steps before it reaches React.
 *
 * 120 steps across a ten-second chapter is a re-render every ~80ms, which is
 * finer than any discrete change a scene makes and far cheaper than 60fps.
 */
const U_STEPS = 120;

export function usePlayhead({
  durations,
  autoplay = true,
  enabled = true,
  startAtChapter = 0,
  blocked,
}: {
  /** Chapter lengths in ms, in order. */
  durations: readonly number[];
  /** Reduced motion passes `false`: the tour renders as a static document. */
  autoplay?: boolean;
  /** False while the dialog is closed, so nothing runs in the background. */
  enabled?: boolean;
  startAtChapter?: number;
  /**
   * Hold the playhead where it is, without pausing.
   *
   * Used to wait for the narrator to finish a sentence. The clock is an
   * ESTIMATE of how long a line takes to say; the voice is the truth. When
   * they disagree the picture waits, because a highlight that has already
   * moved on to the next card while the voice is still describing this one
   * is the thing that reads as broken.
   *
   * A REF rather than a value, because the dependency is circular: narration
   * needs the current beat, which comes from this playhead, which needs to
   * know whether narration is still talking. A ref reads the latest value
   * inside the frame callback without either hook having to be created first.
   */
  blocked?: { readonly current: boolean };
}): Playhead {
  const totalMs = useMemo(() => durations.reduce((a, b) => a + b, 0), [durations]);

  /** Cumulative start offset per chapter. Derived, never authored. */
  const starts = useMemo(() => {
    const out: number[] = [];
    let acc = 0;
    for (const d of durations) {
      out.push(acc);
      acc += d;
    }
    return out;
  }, [durations]);

  const timeMs = useMotionValue(0);
  const progress = useMotionValue(0);

  const toFrame = useCallback(
    (ms: number): Frame => {
      let i = starts.length - 1;
      // Walk back to the chapter containing `ms`. Chapter counts are single
      // digits, so a scan is cheaper and clearer than a binary search.
      while (i > 0 && ms < starts[i]) i -= 1;
      const dur = durations[i] || 1;
      return { chapter: i, u: clamp01((ms - starts[i]) / dur) };
    },
    [starts, durations]
  );

  const initial = starts[startAtChapter] ?? 0;
  const [frame, setFrame] = useState<Frame>(() => toFrame(initial));
  const [isPlaying, setIsPlaying] = useState(false);
  const [isEnded, setIsEnded] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);

  /** Play state to restore when a drag ends. */
  const wasPlaying = useRef(false);
  /** Tracks open/closed so only a real OPEN rewinds. */
  const wasEnabled = useRef(false);
  const lastPushed = useRef<Frame>(frame);

  /** Push `ms` everywhere, quantising what React sees. */
  const apply = useCallback(
    (ms: number) => {
      const clamped = Math.max(0, Math.min(totalMs, ms));
      timeMs.set(clamped);
      progress.set(totalMs > 0 ? clamped / totalMs : 0);

      const next = toFrame(clamped);
      const qu = Math.round(next.u * U_STEPS) / U_STEPS;
      const prev = lastPushed.current;
      if (prev.chapter !== next.chapter || prev.u !== qu) {
        const pushed = { chapter: next.chapter, u: qu };
        lastPushed.current = pushed;
        setFrame(pushed);
      }
    },
    [timeMs, progress, totalMs, toFrame]
  );

  /*
   * No seeding effect here, deliberately.
   *
   * `useState(() => toFrame(initial))` above already seeds the frame on mount,
   * and the open effect below rewinds on every open. An effect that also
   * re-applied `initial` whenever it CHANGED would fight that: the entry
   * chapter is derived from the guidance state, the guidance state is derived
   * from data this page refetches, and so a refetch landing mid-watch would
   * yank the playhead to another chapter under somebody who was reading.
   */

  const pause = useCallback(() => setIsPlaying(false), []);

  const play = useCallback(() => {
    // Play on a finished film means again. One path, so Replay cannot drift.
    if (isEnded) {
      apply(0);
      setIsEnded(false);
    }
    setIsPlaying(true);
  }, [isEnded, apply]);

  const toggle = useCallback(() => {
    if (isPlaying) pause();
    else play();
  }, [isPlaying, pause, play]);

  const seek = useCallback(
    (ms: number) => {
      apply(ms);
      if (ms < totalMs) setIsEnded(false);
    },
    [apply, totalMs]
  );

  const seekChapter = useCallback(
    (index: number) => {
      const i = Math.max(0, Math.min(starts.length - 1, index));
      seek(starts[i]);
    },
    [seek, starts]
  );

  const replay = useCallback(() => {
    apply(0);
    setIsEnded(false);
    setIsPlaying(true);
  }, [apply]);

  const beginScrub = useCallback(() => {
    wasPlaying.current = isPlaying;
    setIsScrubbing(true);
    setIsPlaying(false);
  }, [isPlaying]);

  const endScrub = useCallback(() => {
    setIsScrubbing(false);
    if (wasPlaying.current) setIsPlaying(true);
  }, []);

  /*
   * Rewind and play on each OPEN, not on mount.
   *
   * The dialog stays mounted while closed (the lazy loader renders it closed
   * so its chunk is warm), so the playhead survives a close. Without this,
   * shutting the tour at 0:30 and opening it again dropped the owner back at
   * 0:30, mid-sentence, with no idea they had missed the start.
   *
   * `wasEnabled` rather than a bare `[enabled]` effect so a re-render caused
   * by anything else cannot rewind a film somebody is watching.
   */
  useEffect(() => {
    const opening = enabled && !wasEnabled.current;
    wasEnabled.current = enabled;

    if (!enabled) {
      setIsPlaying(false);
      return;
    }
    if (opening) {
      apply(initial);
      setIsEnded(false);
      setIsPlaying(autoplay);
    }
  }, [enabled, autoplay, initial, apply]);

  /*
   * The only timer in the component.
   *
   * `delta` rather than a wall clock, so a frame the browser skipped does not
   * teleport the playhead, and so pausing needs no bookkeeping.
   */
  useAnimationFrame((_, delta) => {
    if (!enabled || !isPlaying || isScrubbing) return;
    // Waiting on the voice. Still "playing" — the transport should not flip
    // to a paused state for a pause the viewer did not ask for.
    if (blocked?.current) return;

    const next = timeMs.get() + delta;
    if (next >= totalMs) {
      apply(totalMs);
      setIsPlaying(false);
      // It HOLDS on the last frame. A loop wipes the closing panel exactly as
      // somebody turns to read it, which is ShareGuide's own hard lesson.
      setIsEnded(true);
      return;
    }
    apply(next);
  });

  /* A hidden tab gets no film. Coming back is the viewer's decision. */
  useEffect(() => {
    if (!enabled) return;
    const onVisibility = () => {
      if (document.hidden) setIsPlaying(false);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [enabled]);

  return {
    timeMs,
    progress,
    frame,
    isPlaying,
    isEnded,
    isScrubbing,
    totalMs,
    play,
    pause,
    toggle,
    seek,
    seekChapter,
    replay,
    beginScrub,
    endScrub,
  };
}
