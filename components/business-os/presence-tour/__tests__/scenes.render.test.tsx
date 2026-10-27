/**
 * @jest-environment jsdom
 *
 * Every scene, rendered at every beat, in every language.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * A refactor replaced each scene's hand-written phase constants with the
 * shared beat clock, and left eight references to the deleted constants
 * behind. TypeScript would have caught it; the typecheck run died before
 * reporting, ESLint does not flag undefined names in TS files, and the unit
 * tests only ever touched pure functions. So the first thing that noticed was
 * the owner's browser: `ReferenceError: MAKE is not defined`.
 *
 * Pure-function tests cannot catch a scene that throws on render. This can,
 * and it costs a second.
 */

import '@testing-library/jest-dom';
import { render } from '@testing-library/react';

import { CHAPTERS } from '../chapters';
import { timeChapter, beatAtU, progressInBeat } from '../pace';
import type { TourContext } from '../storyboard';

/** Both branches of the one script that forks. */
const WITH_SITE: TourContext = {
  guidanceState: 'publish_website',
  wantsWebsite: true,
  hasWebsite: true,
  websitePublished: false,
  livePages: 1,
  draftPages: 0,
  bookingLinkExists: true,
  bookingLinkActive: false,
  bookingCode: 'abc123',
  contactCode: 'def456',
  subdomain: 'studio',
};

const NO_SITE: TourContext = {
  ...WITH_SITE,
  guidanceState: 'activate_link',
  wantsWebsite: false,
  hasWebsite: false,
  livePages: 0,
  subdomain: undefined,
};

/** Keys pass through as themselves — this test is about rendering, not copy. */
const t = (key: string) => key;

describe('every scene renders', () => {
  for (const ctx of [WITH_SITE, NO_SITE]) {
    const label = ctx.wantsWebsite ? 'with a website' : 'without a website';

    for (const chapter of CHAPTERS) {
      const keys = chapter.beats(ctx);
      const { beatAt } = timeChapter(keys.map(() => 'x'.repeat(80)), 'en');

      it(`${chapter.id}, ${label}, at every beat`, () => {
        const Scene = chapter.Scene;

        keys.forEach((_, i) => {
          /* Start, middle and end of each beat: a reference that only blows
             up in a branch guarded by `ub > 0.5` is still a crash. */
          for (const within of [0, 0.5, 0.999]) {
            const from = beatAt[i];
            const to = i + 1 < beatAt.length ? beatAt[i + 1] : 1;
            const u = from + (to - from) * within;
            const beat = beatAtU(beatAt, u);

            const { container, unmount } = render(
              <Scene
                u={u}
                beat={beat}
                ub={progressInBeat(beatAt, u, beat)}
                beatAt={beatAt}
                t={t}
                isRTL={false}
                ctx={ctx}
              />
            );

            /*
             * Every beat must SHOW something ON THE STAGE.
             *
             * A scene maps beat indices to pictures by hand, so adding a beat
             * to a chapter without adding its branch leaves the stage blank
             * while the narrator keeps talking — which is what the share
             * chapter did when its beat count went from two to three.
             *
             * Counting ALL elements does not catch it: the wrapper and the
             * caption row still render, so the total stays comfortably above
             * any floor. The assertion has to look inside the stage region,
             * which is the `flex-1` column every scene puts its beat content
             * in.
             */
            const stage = container.querySelector('[class*="flex-1"]');
            if (stage) {
              expect([
                `${chapter.id} beat ${i} @${within}`,
                stage.childElementCount,
              ]).toEqual([`${chapter.id} beat ${i} @${within}`, expect.any(Number)]);
              expect(stage.childElementCount).toBeGreaterThan(0);
            }

            unmount();
          }
        });
      });
    }
  }

  /* RTL flips the cursor's path and several logical properties. A scene that
     renders left-to-right and throws right-to-left is a Hebrew-only crash. */
  it('renders right-to-left too', () => {
    for (const chapter of CHAPTERS) {
      const keys = chapter.beats(WITH_SITE);
      const { beatAt } = timeChapter(keys.map(() => 'x'.repeat(80)), 'he');
      const Scene = chapter.Scene;

      keys.forEach((_, i) => {
        const { unmount } = render(
          <Scene
            u={beatAt[i]}
            beat={i}
            ub={0.5}
            beatAt={beatAt}
            t={t}
            isRTL
            ctx={WITH_SITE}
          />
        );
        unmount();
      });
    }
  });
});
