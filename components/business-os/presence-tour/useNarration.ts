'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { pickFemaleVoice } from './voices';

/**
 * The guided voice, in every language we support.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT SPEAKS THE CAPTIONS, NOT A SECOND SCRIPT
 *
 * Each chapter narrates the exact translation keys it already shows on screen.
 * Writing a separate spoken script would double the copy and then drift from
 * it the first time somebody edited one and not the other — and a voice saying
 * something different from the words under it is worse than no voice.
 *
 * It follows the owner's language because the strings are already translated.
 * There is no audio to record, re-record, host or keep in sync.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OFF BY DEFAULT, AND THAT IS NOT NEGOTIABLE
 *
 * A dialog that starts talking the moment it opens is hostile — people work in
 * shared rooms, and the owner clicked a button on a settings page, not a video
 * site. WCAG 1.4.2 also requires a stop mechanism for any audio over three
 * seconds. So the voice is opt-in, the preference is remembered, and the
 * toggle is a real control rather than a setting buried somewhere.
 *
 * It is also the user gesture iOS Safari requires before it will speak at all.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO VOICE INSTALLED MEANS NO TOGGLE
 *
 * Hebrew and Spanish voices ship with macOS, iOS, Windows and Android, but not
 * with every Linux or kiosk build. `isSupported` is false when the platform
 * has no voice for THIS language, and the caller hides the control — a toggle
 * that silently does nothing reads as a broken feature.
 *
 * @module components/business-os/presence-tour/useNarration
 */

const STORAGE_KEY = 'business-os:presence-tour-voice';

/** Our three languages, as BCP-47 prefixes to match against `voice.lang`. */
const LANG_PREFIX: Record<string, string> = {
  en: 'en',
  es: 'es',
  he: 'he',
};

export interface Narration {
  /** The platform can speak this language. */
  isSupported: boolean;
  /** The owner has asked for it. */
  isOn: boolean;
  /**
   * A sentence is in the air right now.
   *
   * The player uses this to WAIT at the end of a beat rather than cutting
   * away mid-sentence. Beat lengths are estimated from character counts, and
   * no estimate matches every voice on every machine — so when the estimate
   * runs short, the picture must yield to the voice, not the other way round.
   */
  isSpeaking: boolean;
  toggle: () => void;
}

export function useNarration({
  language,
  text,
  chapterIndex,
  isPlaying,
  enabled,
}: {
  language: string;
  /** What this chapter says, already translated. */
  text: string;
  /** Speech restarts on a chapter change or a seek, never on every frame. */
  chapterIndex: number;
  isPlaying: boolean;
  /** False while the dialog is closed. */
  enabled: boolean;
}): Narration {
  const [isOn, setIsOn] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(null);
  const [hasApi, setHasApi] = useState(false);

  /** What was last spoken, so a re-render does not restart the sentence. */
  const spokenFor = useRef<string>('');

  /** Readable from the click handler, which has no access to render scope. */
  const chapterIndexRef = useRef(chapterIndex);
  chapterIndexRef.current = chapterIndex;

  /** Mirrors `isOn` so the click handler can read it without a stale closure. */
  const isOnRef = useRef(false);

  /** Releases the playhead if an utterance never reports back. */
  const safety = useRef<number>(0);

  /* Restore the preference. */
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY) === 'on';
      isOnRef.current = saved;
      setIsOn(saved);
    } catch {
      // A browser with storage blocked simply starts with the voice off.
    }
  }, []);

  /*
   * Find a voice for this language.
   *
   * `getVoices()` is empty on the first call in Chrome and fills in later, so
   * the `voiceschanged` listener is not optional — without it the toggle would
   * be hidden on first open and appear on the second.
   */
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    setHasApi(true);

    const prefix = LANG_PREFIX[language] ?? 'en';

    const pick = () => {
      setVoice(pickFemaleVoice(window.speechSynthesis.getVoices(), prefix));
    };

    pick();
    window.speechSynthesis.addEventListener('voiceschanged', pick);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', pick);
  }, [language]);

  /** What the current chapter says, readable from a click handler. */
  const textRef = useRef(text);
  textRef.current = text;

  const voiceRef = useRef<SpeechSynthesisVoice | null>(voice);
  voiceRef.current = voice;

  const stop = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    spokenFor.current = '';
    setIsSpeaking(false);
  }, []);

  /**
   * Say something.
   *
   * ⚠️ The `setTimeout` is not padding. Chrome drops an utterance queued in
   * the same tick as `cancel()` — a long-standing bug — and the symptom is
   * exactly this feature's first version: the toggle flips, no error is
   * raised, and nothing is heard. Letting the cancel settle first is the
   * documented workaround.
   */
  const speak = useCallback((what: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (!what) return;

    window.speechSynthesis.cancel();
    // Set before the deferred speak, so the player never sees a gap between
    // "the beat ended" and "the voice started" and advances through it.
    setIsSpeaking(true);

    /*
     * A dead man's switch.
     *
     * The player now WAITS for `isSpeaking` to clear, so an utterance that
     * never reports back would stop the film dead. Chrome drops one
     * occasionally with neither `onend` nor `onerror` — so assume the worst
     * after generously longer than the line could possibly take, and let the
     * picture carry on without the voice.
     */
    window.clearTimeout(safety.current);
    safety.current = window.setTimeout(
      () => setIsSpeaking(false),
      Math.min(30_000, what.length * 140 + 4_000)
    );

    window.setTimeout(() => {
      const utter = new SpeechSynthesisUtterance(what);
      const v = voiceRef.current;
      if (v) {
        utter.voice = v;
        utter.lang = v.lang;
      }
      // Slightly under default: this is instruction, not a podcast intro.
      utter.rate = 0.95;
      utter.onend = () => {
        window.clearTimeout(safety.current);
        setIsSpeaking(false);
      };
      // A refused or interrupted utterance must also release the playhead,
      // or a failure to speak would freeze the film instead of skipping it.
      utter.onerror = () => {
        window.clearTimeout(safety.current);
        setIsSpeaking(false);
      };
      window.speechSynthesis.speak(utter);
    }, 60);
  }, []);

  const toggle = useCallback(() => {
    /*
     * The side effects live OUT here, not inside `setIsOn`.
     *
     * A state updater must be pure: React calls it twice under StrictMode, so
     * speaking from inside it narrated every toggle twice, overlapping, in
     * development only — the kind of bug that looks like a browser fault.
     */
    const next = !isOnRef.current;
    isOnRef.current = next;
    setIsOn(next);

    if (next) {
      /*
       * Speak straight from the click, not from an effect.
       *
       * This is the browser's user gesture. Chrome and Safari both treat
       * speech started outside one as suspect, and iOS Safari refuses it
       * outright until the page has spoken once from a real interaction. It
       * also means turning the voice on does something IMMEDIATELY rather
       * than waiting for the next chapter boundary, which was the other half
       * of why the first version seemed silent.
       */
      speak(textRef.current);
      spokenFor.current = `${chapterIndexRef.current}:${textRef.current}`;
    } else {
      stop();
    }

    try {
      window.localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off');
    } catch {
      // Not remembering the preference is survivable; failing is not.
    }
  }, [speak, stop]);

  /*
   * Each new chapter speaks itself, once.
   *
   * Keyed on the chapter and its text rather than the playhead, so sixty
   * frames a second do not restart the sentence sixty times. A seek into
   * another chapter changes the key and re-speaks, which is what somebody
   * dragging the bar expects.
   */
  useEffect(() => {
    if (!enabled || !isOn || !text) return;
    if (!isPlaying) return;

    const key = `${chapterIndex}:${text}`;
    if (spokenFor.current === key) return;

    speak(text);
    spokenFor.current = key;
  }, [enabled, isOn, text, chapterIndex, isPlaying, speak]);

  /* Pausing the film silences it. Resuming re-speaks the current chapter. */
  useEffect(() => {
    if (!isPlaying) stop();
  }, [isPlaying, stop]);

  /* Closing the dialog, or unmounting, must never leave a voice running. */
  useEffect(() => {
    if (!enabled) stop();
    return stop;
  }, [enabled, stop]);

  return {
    isSupported: hasApi && voice !== null,
    isOn,
    isSpeaking: isOn && isSpeaking,
    toggle,
  };
}
