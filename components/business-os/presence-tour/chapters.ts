import type { Chapter, TourContext } from './storyboard';
import { Ch0Doors } from './scenes/Ch0Doors';
import { Ch1Website } from './scenes/Ch1Website';
import { Ch2Landing } from './scenes/Ch2Landing';
import { Ch3Links } from './scenes/Ch3Links';
import { Ch4Share } from './scenes/Ch4Share';
import { Ch5YouAreHere } from './scenes/Ch5YouAreHere';

/**
 * The running order.
 *
 * Separate from `storyboard.ts` only so the types there stay importable from
 * anywhere without dragging six scene components into the importing chunk.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO DURATIONS HERE
 *
 * A chapter is exactly as long as its beats take to say — see `pace.ts`.
 * Hand-written lengths are what let the script outgrow its slot.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LINKS COME BEFORE LANDING PAGES
 *
 * Not the order the page lists them in. Every business has two links and they
 * are the route that always works; a landing page is a marketing choice most
 * owners make later, if ever. Chapter 0 mentions it in a sentence and the
 * landing chapter expands it, so the brief mention and the full explanation
 * are not sitting next to each other.
 */
export const CHAPTERS: readonly Chapter[] = [
  {
    id: 'doors',
    posterBeat: 1,
    titleKey: 'presence.tour.doors.title',
    /*
     * The capability map, one card per situation an owner can be in.
     *
     * The two smart links are SEPARATE cards, not two rows of one, because
     * they answer different questions: the contact form is for somebody whose
     * own site has no form, and the services link is the only thing on this
     * page a client can actually buy from. Sharing a card made the selling
     * case share a sentence with the messaging case, and it landed softer
     * than it deserves.
     */
    beats: (ctx: TourContext) => [
      'presence.tour.doors.cap1',
      ctx.wantsWebsite
        ? 'presence.tour.doors.capSiteUs'
        : 'presence.tour.doors.capSiteNone',
      'presence.tour.doors.capOwn',
      'presence.tour.doors.capContact',
      'presence.tour.doors.capSell',
      'presence.tour.doors.capSellB',
      'presence.tour.doors.capPromo',
    ],
    Scene: Ch0Doors,
  },
  {
    id: 'website',
    posterBeat: 3,
    titleKey: 'presence.tour.website.title',
    /*
     * Both paths, four beats each, same shape.
     *
     * A business that declined a website is told it can still change its mind
     * and shown what the wizard would do — not nagged. One that asked for a
     * website is told plainly that we BUILT it, before being asked to publish
     * it; "press Publish" makes no sense until you know what exists.
     */
    beats: (ctx: TourContext) =>
      ctx.wantsWebsite
        ? [
            'presence.tour.website.capB0',
            'presence.tour.website.capB1',
            'presence.tour.website.cap2',
            'presence.tour.website.capB3',
          ]
        : [
            'presence.tour.website.capA0',
            'presence.tour.website.capA1',
            'presence.tour.website.cap2',
            'presence.tour.website.capA3',
          ],
    Scene: Ch1Website,
  },
  {
    id: 'links',
    posterBeat: 2,
    titleKey: 'presence.tour.links.title',
    /*
     * Why they exist comes FIRST.
     *
     * The chapter used to open on two rows the owner had never been told the
     * purpose of. And a business with no website sells through this link or
     * not at all, so that case gets said out loud rather than left to be
     * inferred from a feature list.
     */
    beats: (ctx: TourContext) => [
      'presence.tour.links.capWhat',
      ctx.wantsWebsite
        ? 'presence.tour.links.capSellWeb'
        : 'presence.tour.links.capSellNoWeb',
      'presence.tour.links.capRows',
      'presence.tour.links.capSplit',
      'presence.tour.links.capWhy',
      'presence.tour.links.capWhyB',
    ],
    Scene: Ch3Links,
  },
  {
    id: 'landing',
    posterBeat: 1,
    titleKey: 'presence.tour.landing.title',
    beats: () => ['presence.tour.landing.capChoose', 'presence.tour.landing.capPurpose'],
    Scene: Ch2Landing,
  },
  {
    id: 'share',
    posterBeat: 0,
    titleKey: 'presence.tour.share.title',
    /*
     * This chapter and `ShareGuide` are kept apart on purpose.
     *
     * ShareGuide, on every live link row, teaches WHERE to put a link and
     * whether each place will make it clickable — an Instagram caption will
     * not, which is the fact it exists for. This chapter teaches WHY you share
     * from the menu at all: each destination gets its own tagged link
     * (`/go/{code}?v=wa`), the redirect expands that into UTMs, and the
     * Channels card reads them. Neither answers the other's question.
     */
    beats: () => [
      'presence.tour.share.capWhy',
      'presence.tour.share.capTracked',
      'presence.tour.share.capGuide',
    ],
    Scene: Ch4Share,
  },
  {
    id: 'youAreHere',
    posterBeat: 0,
    titleKey: 'presence.tour.here.title',
    beats: () => ['presence.tour.here.caption'],
    Scene: Ch5YouAreHere,
  },
] as const;
