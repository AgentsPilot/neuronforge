/**
 * How long a beat needs to be, measured from what it actually says.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * The first version hand-wrote a duration per chapter and then wrote the
 * script separately. The scripts grew, the numbers did not, and chapter 0
 * ended up with 59 seconds of narration in an 18-second slot: captions
 * flicked past before anyone could read them, and the voice was cut off
 * mid-sentence at every chapter boundary.
 *
 * Guessing a duration for text you have not measured is the bug. So the text
 * decides: a beat lasts as long as it takes to say, plus a breath. Edit a
 * caption and the film re-times itself — there is no second number to
 * remember to update, which is the only way this stays true.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RATES ARE PER LANGUAGE, BECAUSE SCRIPTS ARE NOT EQUALLY DENSE
 *
 * Hebrew writes the same sentence in noticeably fewer characters than English
 * — no vowels, shorter function words — so characters-per-second is not a
 * constant across our three languages. Using the English rate for Hebrew
 * would cut Carmit off every time.
 *
 * @module components/business-os/presence-tour/pace
 */

/**
 * Characters per second, speaking at `rate: 0.95`.
 *
 * Measured against what the engines actually do rather than guessed low. The
 * first pass used 12.5, which is slower than any of our three voices really
 * speak, so every beat held a second or two after the sentence had finished
 * and the film felt like it was waiting for something.
 *
 * Still slightly conservative — running a little long leaves a pause, running
 * short truncates the voice, and truncation is the failure people notice.
 */
export const CPS: Record<string, number> = {
  en: 15,
  es: 15,
  he: 12.5,
};

/**
 * A breath after each beat, so the next does not tread on its ending.
 *
 * Tuned DOWN from 900ms, which read as dead air: at six beats a chapter that
 * is five and a half seconds of nothing happening, and the viewer reads it as
 * the thing having stalled rather than as punctuation. 320ms is enough to
 * separate two sentences without opening a gap.
 */
export const TAIL_MS = 320;

/** Floor and ceiling, so one odd caption cannot distort the film. */
export const MIN_MS = 1_700;
export const MAX_MS = 14_000;

/** How long this text needs on screen, and in the ear. */
export function beatMs(text: string, language: string): number {
  const cps = CPS[language] ?? CPS.en;
  const spoken = (text.trim().length / cps) * 1000;
  return Math.round(Math.min(MAX_MS, Math.max(MIN_MS, spoken + TAIL_MS)));
}

export interface ChapterTiming {
  /** Total length of the chapter. */
  durMs: number;
  /** Fraction of the chapter at which each beat starts. */
  beatAt: readonly number[];
  /** Length of each beat, in ms. */
  beatMs: readonly number[];
}

/**
 * Time one chapter from its beats.
 *
 * Returns fractions as well as milliseconds because the scenes animate
 * against `u` (0..1 within the chapter) and must line up exactly with the
 * narration — a caption that appears at 0.44 while the voice starts that
 * sentence at 0.39 reads as a glitch.
 */
export function timeChapter(texts: readonly string[], language: string): ChapterTiming {
  const each = texts.map(x => beatMs(x, language));
  const durMs = each.reduce((a, b) => a + b, 0) || MIN_MS;

  const beatAt: number[] = [];
  let acc = 0;
  for (const ms of each) {
    beatAt.push(acc / durMs);
    acc += ms;
  }

  return { durMs, beatAt, beatMs: each };
}

/** Which beat is showing at `u`. */
export function beatAtU(beatAt: readonly number[], u: number): number {
  let i = 0;
  while (i + 1 < beatAt.length && u >= beatAt[i + 1]) i += 1;
  return i;
}

/** Progress within the beat that `u` falls in. */
export function progressInBeat(beatAt: readonly number[], u: number, beat: number): number {
  if (beatAt.length === 0) return u;
  const from = beatAt[beat] ?? 0;
  const to = beat + 1 < beatAt.length ? beatAt[beat + 1] : 1;
  if (to <= from) return 1;
  const p = (u - from) / (to - from);
  return p < 0 ? 0 : p > 1 ? 1 : p;
}
