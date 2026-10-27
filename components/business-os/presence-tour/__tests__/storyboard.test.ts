import fs from 'fs';
import path from 'path';
import { CHAPTERS } from '../chapters';
import { entryChapter, type TourContext } from '../storyboard';
import { timeChapter, CPS, MAX_MS } from '../pace';

/** A business that asked for a website, and one that did not. */
const WEB = { wantsWebsite: true } as TourContext;
const NO_WEB = { wantsWebsite: false } as TourContext;

const LANGS = ['en', 'es', 'he'] as const;
const SRC = Object.fromEntries(
  LANGS.map(l => [
    l,
    fs.readFileSync(
      path.join(__dirname, `../../../../lib/business-os/translations/${l}.ts`),
      'utf8'
    ),
  ])
) as Record<(typeof LANGS)[number], string>;

/** The literal a translation file holds for a key, or null. */
function value(lang: (typeof LANGS)[number], key: string): string | null {
  const m = SRC[lang].match(new RegExp(`"${key.replace(/\./g, '\\.')}":\\s*("(?:[^"\\\\]|\\\\.)*")`));
  return m ? (JSON.parse(m[1]) as string) : null;
}

describe('storyboard', () => {
  it('covers every route the owner asked about', () => {
    const ids = CHAPTERS.map(c => c.id);
    expect(ids).toContain('website');
    expect(ids).toContain('links');
    expect(ids).toContain('landing');
  });

  /*
   * The links are the route every business has; a landing page is a marketing
   * choice made later, if ever. Chapter 0 mentions landing pages in one
   * sentence and the landing chapter expands it, so the two must not be
   * adjacent.
   */
  it('explains the links before landing pages', () => {
    const ids = CHAPTERS.map(c => c.id);
    expect(ids.indexOf('links')).toBeLessThan(ids.indexOf('landing'));
    expect(ids.indexOf('website')).toBeLessThan(ids.indexOf('links'));
  });

  it('gives every chapter something to say', () => {
    for (const c of CHAPTERS) {
      expect(c.beats(WEB).length).toBeGreaterThan(0);
    }
  });

  it('keeps posterBeat inside the chapter, in both branches', () => {
    for (const c of CHAPTERS) {
      for (const ctx of [WEB, NO_WEB]) {
        expect(c.posterBeat).toBeGreaterThanOrEqual(0);
        expect(c.posterBeat).toBeLessThan(c.beats(ctx).length);
      }
    }
  });

  /*
   * `app/business-os/website/page.tsx` imports types from storyboard.ts, so
   * it must stay weightless. One value import — or a scene — would drag the
   * whole tour into the page's first download and silently undo the
   * lazy-loading slice, with nothing visibly wrong.
   */
  describe('storyboard.ts stays importable from the page', () => {
    const src = fs.readFileSync(path.join(__dirname, '../storyboard.ts'), 'utf8');

    it('imports types only', () => {
      const imports = src.match(/^import .*/gm) ?? [];
      expect(imports.length).toBeGreaterThan(0);
      for (const line of imports) {
        expect([line, line.startsWith('import type ')]).toEqual([line, true]);
      }
    });

    it('never reaches for a scene', () => {
      expect(src).not.toContain('scenes/');
      expect(src).not.toContain('./chapters');
    });
  });

  /*
   * The playhead PARKS at the end of a beat while the narrator finishes, and
   * it parks for however long the voice needs. So anything animating towards
   * zero over the closing few percent is held at nearly-invisible for
   * seconds — which is what produced a blank stage with the voice still
   * talking. Scenes fade IN and hold; the next beat replaces them.
   */
  describe('no scene fades its content out as a beat closes', () => {
    const scenes = fs
      .readdirSync(path.join(__dirname, '../scenes'))
      .filter(f => f.endsWith('.tsx'));

    it.each(scenes)('%s', file => {
      const src = fs.readFileSync(path.join(__dirname, '../scenes', file), 'utf8');
      /* `fade(u, in, in, out, out)` where the out-window sits in the tail. */
      const offenders = [...src.matchAll(/fade\(\s*u\s*,[^)]*\)/g)]
        .map(m => m[0])
        .filter(call => {
          /* Every numeric argument, integers included — an earlier version
             matched only decimals, missed the leading `0`, and silently
             indexed the wrong argument, so the guard never fired. */
          const nums = (call.match(/\d*\.?\d+/g) ?? []).map(Number);
          // the third argument is where the fade-out begins
          return nums.length >= 4 && nums[2] >= 0.9;
        });
      expect(offenders).toEqual([]);
    });
  });

  describe('the script', () => {
    const everyKey = [
      ...new Set(CHAPTERS.flatMap(c => [...c.beats(WEB), ...c.beats(NO_WEB)])),
    ];

    it('exists in all three languages', () => {
      for (const key of everyKey) {
        for (const lang of LANGS) {
          expect([`${lang}:${key}`, value(lang, key) !== null]).toEqual([
            `${lang}:${key}`,
            true,
          ]);
        }
      }
    });

    /* A chapter narrating another chapter's caption is a copy-paste slip
       that nothing else would catch. */
    it('stays inside its own chapter namespace', () => {
      const ns: Record<string, string> = {
        doors: 'presence.tour.doors.',
        website: 'presence.tour.website.',
        landing: 'presence.tour.landing.',
        links: 'presence.tour.links.',
        share: 'presence.tour.share.',
        youAreHere: 'presence.tour.here.',
      };
      for (const c of CHAPTERS) {
        for (const key of [...c.beats(WEB), ...c.beats(NO_WEB)]) {
          expect([key, key.startsWith(ns[c.id])]).toEqual([key, true]);
        }
      }
    });

    /*
     * The bug this whole pacing module exists for: chapter 0 once carried 59
     * seconds of narration in an 18-second slot, so captions flicked past
     * unread and the voice was cut off at every boundary. Timing is now
     * derived from the text, and this proves it in every language.
     */
    it('gives every beat time to actually be said', () => {
      for (const lang of LANGS) {
        for (const c of CHAPTERS) {
          const texts = c.beats(WEB).map(k => value(lang, k) ?? '');
          const { beatMs } = timeChapter(texts, lang);
          texts.forEach((text, i) => {
            const needed = (text.length / CPS[lang]) * 1000;
            expect([`${lang}:${c.id}:${i}`, beatMs[i] >= Math.min(needed, MAX_MS)]).toEqual([
              `${lang}:${c.id}:${i}`,
              true,
            ]);
          });
        }
      }
    });

    /* A caption longer than the hard ceiling would be cut off mid-sentence
       no matter what the pacing says. Split it instead. */
    it('has no caption too long to fit the ceiling', () => {
      for (const lang of LANGS) {
        for (const c of CHAPTERS) {
          for (const key of c.beats(WEB)) {
            const text = value(lang, key) ?? '';
            const seconds = text.length / CPS[lang];
            /* Longer than the ceiling means the voice is cut off mid-sentence
               no matter what the pacing says. Split the caption instead. */
            expect([`${lang}:${key}:${Math.round(seconds)}s`, seconds <= MAX_MS / 1000]).toEqual([
              `${lang}:${key}:${Math.round(seconds)}s`,
              true,
            ]);
          }
        }
      }
    });

    it('never counts the routes, because there are more than we list', () => {
      for (const lang of LANGS) {
        for (const c of CHAPTERS) {
          for (const key of [...c.beats(WEB), ...c.beats(NO_WEB)]) {
            const text = (value(lang, key) ?? '').toLowerCase();
            expect([key, /\bthree\b|\btres\b|שלוש/.test(text)]).toEqual([key, false]);
          }
        }
      }
    });
  });

  describe('entryChapter', () => {
    it('opens on the route the page is currently asking for', () => {
      expect(entryChapter('publish_website')).toBe('website');
      expect(entryChapter('create_website')).toBe('website');
      expect(entryChapter('publish_landing')).toBe('landing');
      expect(entryChapter('activate_link')).toBe('links');
      expect(entryChapter('no_route')).toBe('links');
      expect(entryChapter('reachable')).toBe('doors');
    });

    it('names a chapter that exists', () => {
      const ids = CHAPTERS.map(c => c.id);
      for (const state of [
        'reachable', 'publish_website', 'create_website',
        'publish_landing', 'activate_link', 'no_route',
      ] as const) {
        expect(ids).toContain(entryChapter(state));
      }
    });
  });
});
