/**
 * Choosing a female voice, when the platform will not tell you which are.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE API HAS NO GENDER FIELD
 *
 * `SpeechSynthesisVoice` exposes `name`, `lang`, `localService` and `default`
 * — and nothing else. There is no gender, and there has never been one. So
 * "use a female voice" can only be done by NAME, against a list per platform.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND THE FALLBACK MATTERS MORE THAN THE LIST
 *
 * macOS exposes its novelty voices to the browser: `Bubbles`, `Boing`,
 * `Jester`, `Bad News`, `Organ`, `Cellos`. They are real `en_US` voices, so a
 * naive "first voice for this language" fallback can and does pick one, and
 * the owner gets their setup instructions sung by a church organ. Excluding
 * them is not a nicety.
 *
 * @module components/business-os/presence-tour/voices
 */

/**
 * Known female voices, best first, across macOS, iOS, Windows and Chrome.
 *
 * Matched case-insensitively against `voice.name`, so "Microsoft Zira
 * Desktop - English (United States)" matches on "zira".
 */
const FEMALE: Record<string, readonly string[]> = {
  en: [
    'samantha',      // macOS / iOS en-US default
    'karen',         // macOS en-AU
    'moira',         // macOS en-IE
    'tessa',         // macOS en-ZA
    'fiona',
    'victoria',
    'allison',
    'ava',
    'susan',
    'zoe',
    'serena',
    'zira',          // Windows
    'hazel',
    'google uk english female',
    'google us english',
  ],
  es: [
    'mónica',        // macOS es-ES
    'monica',
    'paulina',       // macOS es-MX
    'marisol',
    'angelica',
    'esperanza',
    'helena',        // Windows
    'sabina',
    'laura',
    'google español',
  ],
  he: [
    'carmit',        // macOS / iOS — the only Hebrew voice Apple ships
    'hila',          // Windows
  ],
};

/**
 * macOS joke voices. Real, selectable, and catastrophic as a fallback.
 */
const NOVELTY = [
  'albert', 'bad news', 'bahh', 'bells', 'boing', 'bubbles', 'cellos',
  'good news', 'jester', 'organ', 'superstar', 'trinoids', 'whisper',
  'wobble', 'zarvox', 'grandma', 'grandpa', 'junior', 'ralph', 'fred',
  'deranged', 'hysterical', 'bogus', 'eddy', 'flo', 'reed', 'rocko',
  'sandy', 'shelley',
];

function isNovelty(name: string): boolean {
  const n = name.toLowerCase();
  return NOVELTY.some(bad => n.includes(bad));
}

/**
 * The voice to narrate with, or `null` if this language cannot be spoken.
 *
 * Order:
 *   1. a known female voice for the language, in preference order;
 *   2. any voice whose name says "female";
 *   3. any non-novelty voice for the language.
 *
 * Step 3 exists because some platforms ship no female voice for a language at
 * all — Windows Hebrew is male-only. Reading Hebrew in a male Hebrew voice is
 * the right trade against reading it in an English female one, or in silence.
 */
export function pickFemaleVoice(
  voices: readonly SpeechSynthesisVoice[],
  language: string
): SpeechSynthesisVoice | null {
  const prefix = (language in FEMALE ? language : 'en');
  const forLang = voices.filter(v => v.lang.toLowerCase().startsWith(prefix));
  if (forLang.length === 0) return null;

  for (const wanted of FEMALE[prefix]) {
    const hit = forLang.find(v => v.name.toLowerCase().includes(wanted));
    if (hit) return hit;
  }

  const selfDescribed = forLang.find(v => /female/i.test(v.name));
  if (selfDescribed) return selfDescribed;

  return forLang.find(v => !isNovelty(v.name)) ?? null;
}
