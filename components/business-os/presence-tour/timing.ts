/**
 * The arithmetic that replaces `@keyframes`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS AT ALL
 *
 * `ShareGuide` encodes its whole 12-second pass in CSS percentages
 * (`@keyframes sgS1 { 0%,1% {opacity:0} 3%,30% {opacity:1} ... }`). That is
 * compact and completely un-seekable: the browser owns the clock, so there is
 * no way to ask "what did frame 7,300 look like" and no way to drag backwards.
 *
 * The tour is scrubbable, which forces the opposite shape — **every visual
 * property is a pure function of a number**. These helpers are that function's
 * vocabulary. A beat that was
 *
 *     @keyframes sgMenu { 0%,34% {opacity:0} 38%,100% {opacity:1} }
 *
 * becomes
 *
 *     seg(u, 0.34, 0.38)
 *
 * which reads about as well, and can be evaluated at any `u` in any order.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERYTHING HERE IS PURE AND TOTAL
 *
 * No clamping surprises, no NaN: a zero-length window returns a hard switch
 * rather than dividing by zero, and every return is in [0, 1]. These run on
 * every animated property of every mounted scene on every frame, so they are
 * also deliberately branch-light.
 *
 * @module components/business-os/presence-tour/timing
 */

/** Clamp to [0, 1]. The floor under every other helper here. */
export function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Linear interpolation. `t` is clamped, so overshoot is impossible. */
export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * clamp01(t);
}

/**
 * A ramp from 0 to 1 across [start, end].
 *
 * The workhorse: "fade this in between 12% and 30% of the chapter" is
 * `seg(u, 0.12, 0.3)`. Before `start` it is 0, after `end` it is 1, so it also
 * serves as a hold.
 *
 * A zero-width or inverted window is a step, not a division by zero.
 */
export function seg(u: number, start: number, end: number): number {
  if (end <= start) return u >= end ? 1 : 0;
  return clamp01((u - start) / (end - start));
}

/** True while `u` is inside [start, end). For mounting, not for opacity. */
export function at(u: number, start: number, end: number): boolean {
  return u >= start && u < end;
}

/**
 * In, hold, out — the shape almost every caption and overlay wants.
 *
 * `fade(u, .05, .12, .80, .90)` is invisible, fades in over 5-12%, holds, then
 * fades out over 80-90%. Returns the opacity directly.
 */
export function fade(
  u: number,
  inStart: number,
  inEnd: number,
  outStart: number,
  outEnd: number
): number {
  return seg(u, inStart, inEnd) * (1 - seg(u, outStart, outEnd));
}

/** Decelerating ease. For anything arriving: cursors, cards, badges. */
export function easeOutCubic(t: number): number {
  const x = 1 - clamp01(t);
  return 1 - x * x * x;
}

/** Symmetric ease. For anything travelling between two resting points. */
export function easeInOutCubic(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/**
 * A short, damped overshoot. For a badge landing or a button press releasing.
 *
 * Capped rather than a true spring: a spring needs state across frames, and
 * state across frames is exactly what makes a thing un-seekable.
 */
export function easeOutBack(t: number): number {
  const x = clamp01(t);
  const c = 1.70158;
  return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
}

/**
 * A press: down fast, up slower, resting at 1 either side.
 *
 * Returns a scale, so it is `transform` only and never touches layout.
 */
export function press(u: number, start: number, end: number): number {
  const mid = start + (end - start) * 0.4;
  if (u < start || u > end) return 1;
  return u < mid
    ? lerp(1, 0.95, seg(u, start, mid))
    : lerp(0.95, 1, easeOutBack(seg(u, mid, end)));
}

/**
 * `m:ss`, ASCII, for the transport. Never `toLocaleString` — time is not prose.
 *
 * Non-finite input reads as 0:00 rather than propagating. `Math.round(NaN)` is
 * NaN and `Math.max(0, NaN)` is NaN, so one bad number upstream printed the
 * transport as `NaN:NaN` — which is what a chapter losing its authored
 * duration actually did.
 */
export function clock(ms: number): string {
  if (!Number.isFinite(ms)) return '0:00';
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}
