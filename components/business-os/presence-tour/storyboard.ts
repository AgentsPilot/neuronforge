import type { ComponentType } from 'react';
import type { GuidanceState } from '@/lib/business-os/onlinePresenceGuidance';

/**
 * The film, as data.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONLY PLACE A DURATION IS WRITTEN
 *
 * Chapter START offsets are derived by a reduce, never authored. Authoring
 * both a start and a length is how a timing edit leaves a 200ms hole that
 * renders as a black frame — and on a scrubbable timeline a hole is reachable,
 * so somebody will land on it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE RUNNING ORDER IS ARGUING
 *
 * `onlinePresenceGuidance`'s own header says the page "shows a website card, a
 * list of landing pages and a list of smart links, and leaves the owner to
 * work out which of the three the dashboard meant". The guidance card fixed
 * WHICH ONE IS NEXT. It never said what the three things ARE.
 *
 * So: name the three doors, walk each one, then land the owner back in their
 * own situation. The two-link question gets the most time because it is the
 * one nothing on the page answers at all.
 *
 * @module components/business-os/presence-tour/storyboard
 */

/** The owner's real situation, so the stage is theirs rather than a demo. */
export interface TourContext {
  guidanceState: GuidanceState;
  wantsWebsite: boolean;
  hasWebsite: boolean;
  websitePublished: boolean;
  livePages: number;
  draftPages: number;
  bookingLinkExists: boolean;
  bookingLinkActive: boolean;
  /** Real `/go/` codes where we have them; `FAKE` fills in otherwise. */
  bookingCode: string;
  contactCode: string;
  /** The business's own address, when a site exists. */
  subdomain?: string;
}

/**
 * Set dressing.
 *
 * Deliberately NOT in the translation files. A business with no services yet
 * would otherwise watch a film of empty rows, and these strings are props for
 * a set, not product copy — putting them in three 4,600-line translation files
 * would swell them for nothing. This is the split `ShareGuide` already makes:
 * the real `code` and domain are real, "Dana Levi" is invented.
 */
export const FAKE = {
  bookingCode: '1el7ye',
  contactCode: '9kd2mv',
  domain: 'yourbusiness',
  clientName: 'Dana Levi',
  serviceA: 'Intro session',
  serviceB: 'Monthly package',
  priceA: '₪200',
  clicks: '34',
  conversions: '9',
  messages: '6',
  unique: '28',
  rate: '26%',
} as const;

export type ChapterId =
  | 'doors'
  | 'website'
  | 'landing'
  | 'links'
  | 'share'
  | 'youAreHere';

/**
 * What every scene receives.
 *
 * `beat` and `beatAt` exist so a scene never hardcodes "the second caption
 * starts at 0.44". Those fractions are derived from how long the caption
 * takes to SAY, so they move whenever the copy is edited — and a scene that
 * guessed them would drift out of step with its own narration.
 */
export interface SceneProps {
  /** 0..1 within this chapter. */
  u: number;
  /** Index of the beat currently showing. */
  beat: number;
  /**
   * 0..1 WITHIN the current beat.
   *
   * What a scene should animate against. `u` spans the whole chapter, and
   * chapter length now moves with the script, so anything keyed to `u`
   * drifts away from the sentence being spoken the moment a caption is
   * edited. `ub` restarts at every beat, which is exactly where the picture
   * should change too.
   */
  ub: number;
  /** Fraction of the chapter at which each beat begins. */
  beatAt: readonly number[];
  t: (key: string, vars?: Record<string, string | number>) => string;
  isRTL: boolean;
  ctx: TourContext;
}

export interface Chapter {
  id: ChapterId;
  /**
   * Which beat the static (reduced-motion) render freezes at.
   *
   * An index, not a fraction: the fractions move whenever the copy changes,
   * and "show the third thing it says" stays true where "show u = 0.8" does
   * not.
   */
  posterBeat: number;
  titleKey: string;
  /**
   * What this chapter says, in order, as translation keys.
   *
   * These are the SAME keys the scene renders as captions, not a second
   * script. A separate spoken script would drift from the text under it the
   * first time somebody edited one and not the other, and a voice saying
   * something different from the words on screen is worse than silence.
   *
   * They also DECIDE THE CHAPTER'S LENGTH: each beat lasts as long as it
   * takes to say (see `pace.ts`). There is no hand-written duration to fall
   * out of step with the script, which is what produced a chapter carrying 59
   * seconds of narration in an 18-second slot.
   *
   * It takes the owner's context because the script branches: a business that
   * told us it does not want a website is not narrated a chapter about
   * building one.
   */
  beats: (ctx: TourContext) => readonly string[];
  Scene: ComponentType<SceneProps>;
}

/**
 * Which chapter answers this owner's current guidance state.
 *
 * Every chapter plays regardless — the ask was "show all options", and an
 * owner who declined a website still benefits from knowing the door exists.
 * But when the page is actively asking them to do something, opening at the
 * matching chapter respects why they clicked.
 */
export function entryChapter(state: GuidanceState): ChapterId {
  switch (state) {
    case 'publish_website':
    case 'create_website':
      return 'website';
    case 'publish_landing':
      return 'landing';
    case 'activate_link':
    case 'no_route':
      return 'links';
    case 'reachable':
    default:
      return 'doors';
  }
}
