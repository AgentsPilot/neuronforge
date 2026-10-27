'use client';

import { useMemo, useRef } from 'react';
import { useReducedMotion } from 'framer-motion';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { CHAPTERS } from './chapters';
import { timeChapter, beatAtU, progressInBeat } from './pace';
import { CaptionsVisible } from './stageKit';
import { usePlayhead } from './usePlayhead';
import { useNarration } from './useNarration';
import { Transport } from './Transport';
import { entryChapter, type TourContext } from './storyboard';

/**
 * "Show me how it works" — the Online presence tour.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT IS FOR
 *
 * `onlinePresenceGuidance.ts` already answers *which of the three routes to do
 * next*. It never answers *what the three routes are*, and the page it sits on
 * does not either. An owner can read "switch on your booking link", do it, and
 * still not know why they have two links, or what a landing page would have
 * been for. This is the forty-five seconds that answers that.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO RENDERINGS OF ONE STORYBOARD
 *
 * With motion, it is a film: one playhead, a scrubber, chapter jumps.
 *
 * With `prefers-reduced-motion`, it is a DOCUMENT — every chapter mounted once
 * at its `posterU`, stacked, under its own heading. Same components, same
 * words, no clock at all. That is better than a disabled player: it is also
 * the version somebody can scroll back through while actually doing the thing,
 * which a film is bad at.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SCREEN READER NEVER SCRUBS
 *
 * The stage is `aria-hidden`. The accessible content is the chapter list below
 * it, complete and in order, present in both renderings. A 45-second animation
 * that announces each caption as it passes is unusable, and there is no reason
 * to make anyone drag a slider to reach text we can simply render.
 */
export interface PresenceTourProps {
  isOpen: boolean;
  onClose: () => void;
  ctx: TourContext;
}

export function PresenceTour({ isOpen, onClose, ctx }: PresenceTourProps) {
  const { language, t } = useLanguage();
  const isRTL = language === 'he';

  /*
   * `=== true` on purpose: `useReducedMotion()` answers `null` until the
   * browser has replied, and `null` is falsy, so a bare check would start the
   * film for a reduced-motion user on the first frame and then stop it.
   */
  const reduced = useReducedMotion() === true;

  /** Open at the chapter the page is currently asking them about. */
  const startAtChapter = useMemo(() => {
    const id = entryChapter(ctx.guidanceState);
    const i = CHAPTERS.findIndex(c => c.id === id);
    return i < 0 ? 0 : i;
  }, [ctx.guidanceState]);

  /*
   * Time the film from what it says.
   *
   * Every chapter's length is the sum of its beats, and a beat is as long as
   * it takes to speak — so editing a caption re-times the film and nothing
   * can fall out of step. This has to happen here rather than in a constant
   * because it needs `t`: the Hebrew script is a different length from the
   * English one, and timing it with English numbers truncates the voice.
   */
  const timing = useMemo(
    () =>
      CHAPTERS.map(c => {
        const keys = c.beats(ctx);
        const texts = keys.map(k => t(k));
        return { keys, texts, ...timeChapter(texts, language) };
      }),
    [ctx, t, language]
  );

  const durations = useMemo(() => timing.map(x => x.durMs), [timing]);

  /*
   * Set below, read inside the playhead's frame callback.
   *
   * The dependency is circular — narration needs the current beat, which
   * comes from the playhead, which needs to know whether narration is still
   * talking — and a ref is what lets both exist without one being created
   * first.
   */
  const holdForVoice = useRef(false);

  const head = usePlayhead({
    durations,
    autoplay: !reduced,
    enabled: isOpen && !reduced,
    startAtChapter,
    blocked: holdForVoice,
  });

  const chapter = CHAPTERS[head.frame.chapter];
  const Scene = chapter.Scene;
  const here = timing[head.frame.chapter];
  const beat = beatAtU(here.beatAt, head.frame.u);
  const ub = progressInBeat(here.beatAt, head.frame.u, beat);

  /*
   * The guided voice, off until the owner asks for it.
   *
   * It speaks this chapter's own caption keys, already translated, so it
   * follows the owner's language with nothing recorded and nothing to keep in
   * sync. `enabled` is false under reduced motion: that rendering is a
   * document with no playhead, so there is no "current chapter" to narrate.
   */
  /*
   * One beat at a time, not the whole chapter in a single breath.
   *
   * Joining a chapter's sentences into one utterance made the voice read four
   * paragraphs as an unbroken run, with no pause where the picture changed.
   * Speaking per beat puts the breaths where the edits are, and keeps the
   * voice locked to what is on screen.
   */
  const narration = useNarration({
    language,
    text: here.texts[beat] ?? '',
    // The key is the beat, so a new sentence starts exactly when it appears.
    chapterIndex: head.frame.chapter * 1000 + beat,
    isPlaying: head.isPlaying,
    enabled: isOpen && !reduced,
  });

  /*
   * The script is spoken, not printed — unless it cannot be spoken here.
   *
   * With a voice, writing the same sentence across the bottom of the screen
   * splits attention between two copies of one thing. Without one, the
   * captions are the only explanation there is.
   */
  const showCaptions = !narration.isSupported;

  /*
   * Wait at the end of a beat while the narrator is still talking.
   *
   * Beat lengths are ESTIMATED from character counts, and no estimate matches
   * every voice on every machine. When the estimate runs short the highlight
   * moved on to the next card while the voice was still describing the last
   * one, which is the desync that reads as broken.
   *
   * Only at the very end of the beat: holding earlier would stall a picture
   * that is meant to keep moving under the words.
   *
   * ⚠️ Scenes must therefore NOT fade their content out as a beat closes. The
   * playhead parks here for as long as the voice needs, so anything animating
   * towards zero over the last few percent is held at nearly-invisible for
   * seconds — which showed up as a blank stage with the narrator still
   * talking. Scenes fade IN and hold; the next beat replaces them.
   */
  holdForVoice.current = narration.isSpeaking && ub > 0.985;

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent
        dir={isRTL ? 'rtl' : 'ltr'}
        closeLabel={t('presence.tour.close')}
        className="max-h-[92vh] overflow-y-auto sm:max-w-[760px]"
      >
        <DialogHeader>
          <DialogTitle>{t('presence.tour.title')}</DialogTitle>
          <DialogDescription>{t('presence.tour.subtitle')}</DialogDescription>
        </DialogHeader>

        {reduced ? (
          /* ── The document ────────────────────────────────────────────── */
          <CaptionsVisible.Provider value={true}>
          <div className="flex flex-col gap-5">
            {CHAPTERS.map((c, i) => {
              const S = c.Scene;
              return (
                <section key={c.id}>
                  <h3 className="mb-2 text-sm font-semibold text-[var(--v2-text-primary)]">
                    {i + 1}. {t(c.titleKey)}
                  </h3>
                  <div
                    className="relative min-h-[240px] overflow-hidden"
                    style={{
                      background: 'var(--v2-bg)',
                      borderRadius: 'var(--v2-radius-card, 16px)',
                    }}
                  >
                    <S
                      u={timing[i].beatAt[Math.min(c.posterBeat, timing[i].beatAt.length - 1)] ?? 0}
                      beat={Math.min(c.posterBeat, timing[i].texts.length - 1)}
                      ub={0.75}
                      beatAt={timing[i].beatAt}
                      t={t}
                      isRTL={isRTL}
                      ctx={ctx}
                    />
                  </div>
                </section>
              );
            })}
          </div>
          </CaptionsVisible.Provider>
        ) : (
          /* ── The film ────────────────────────────────────────────────── */
          <CaptionsVisible.Provider value={showCaptions}>
          <div className="flex flex-col gap-3">
            {/*
              * Fixed height, so a scene swap can never resize the dialog
              * mid-play. Every scene fills it; none of them push it.
              */}
            <div
              aria-hidden="true"
              className="relative h-[340px] overflow-hidden sm:h-[360px]"
              style={{
                background: 'var(--v2-bg)',
                borderRadius: 'var(--v2-radius-card, 16px)',
              }}
            >
              <Scene
                u={head.frame.u}
                beat={beat}
                ub={ub}
                beatAt={here.beatAt}
                t={t}
                isRTL={isRTL}
                ctx={ctx}
              />
            </div>

            <Transport
              head={head}
              chapters={CHAPTERS}
              durations={durations}
              t={t}
              narration={narration}
            />

            {/*
              * The same content, for anyone not watching. Visually hidden
              * rather than absent — a screen-reader user gets the whole tour
              * as a list and never touches the slider.
              */}
            <ol className="sr-only">
              {CHAPTERS.map((c, i) => (
                <li key={c.id}>
                  {i + 1}. {t(c.titleKey)}
                </li>
              ))}
            </ol>
          </div>
          </CaptionsVisible.Provider>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default PresenceTour;
