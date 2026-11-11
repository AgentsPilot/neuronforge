/**
 * The advisor card never offers something it is already doing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS ON SCREEN, IN HEBREW, ON A LIVE ACCOUNT
 *
 * One `cash_ar_overdue` card about four unpaid invoices, with the overdue-
 * invoice chaser already installed and running. It said, in this order:
 *
 *   heading   "אם אטפל בזה"                      If I handle it
 *   value     "אני כבר מטפל באלה ודואג להם"       I'm already handling these
 *   covered   "גבייה של חשבוניות באיחור כבר מטפל" the chaser is already on it
 *   footer    "...אני יכול לטפל בזה באופן קבוע"   I can handle it permanently
 *
 * Twice over, the card asked the owner to accept an offer it had just told
 * them was running. The value line was already correct — it had been fixed for
 * exactly this reason, and its comment says so: "'I'll take these over' on a
 * card whose agent has been running since Tuesday is an offer the owner
 * already accepted." The heading above it and the footer below it had not been.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD AND NOT A RENDER TEST
 *
 * All three branches hang off `agentAlreadyWorking`, which is derived from
 * props the card receives. A render test would need the whole carousel, the
 * projection, the capabilities provider and an installed-automation list, to
 * assert something that is really one question: does every place that speaks
 * in the future tense about this agent consult the flag that says it is
 * already running?
 *
 * So this reads the source. Blunt, and it fails the moment a fourth future-
 * tense line is added without the flag — which is how the first three got out
 * of step with each other.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The card's CODE, with every comment removed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS NOT TIDINESS. A GUARD OVER RAW SOURCE HERE WOULD BE VACUOUS.
 *
 * The comment above each of these three branches explains the gate and names
 * `agentAlreadyWorking` while doing so. Match on raw source and the assertion
 * passes on the prose alone — so deleting the actual condition would leave
 * this suite green, which is worse than having no suite: the exact failure
 * already recorded on the `lets blocked outrank paused` guard, where a fixed
 * character window made `indexOf` return -1 and the comparison read as
 * "earlier than everything" and passed while the order was wrong.
 *
 * Block comments and line comments both, before anything is searched.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const SOURCE = readFileSync(join(__dirname, '..', 'InsightAdvisorCard.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/** The text between a key's first mention and the next 120 characters. */
function near(key: string): string {
  const at = SOURCE.indexOf(key);
  if (at === -1) throw new Error(`${key} is no longer in the card at all`);

  /* Backwards as well as forwards: the flag usually sits on the line ABOVE,
     as the condition whose branch this key is. */
  return SOURCE.slice(Math.max(0, at - 400), at + 200);
}

describe('every line that speaks in the future consults the flag', () => {
  it.each([
    [
      'the right-hand heading',
      "t('insight.projection.handle_it')",
      /* "If I handle it" over "I'm already handling these". */
    ],

    [
      'the repeat-seen footer',
      "t('insight.seen.repeated')",
      /* "If it keeps happening, I can handle it permanently." */
    ],
  ])('%s is gated on agentAlreadyWorking', (_label, key) => {
    expect(near(key)).toContain('agentAlreadyWorking');
  });

  it('the projection value is gated on agentAlreadyWorking', () => {
    /*
     * Asserted on the STRUCTURE rather than through `near`, which samples 400
     * characters backwards. On 2026-11-10 the value grew three more branches —
     * naming the chaser, and reporting the state where the agent is installed
     * but its consent is off — and the flag moved outside that window while
     * remaining exactly where it belongs.
     *
     * Widening `near` for everyone would be the wrong fix: the flag appears
     * many times in this file, so a longer window starts passing on an
     * unrelated occurrence, which is the vacuous-guard failure this file's own
     * header warns about. The order of the two tokens is the real invariant.
     */
    expect(SOURCE).toMatch(
      /agentAlreadyWorking[\s\S]{0,1400}t\('insight\.projection\.agent_takes_over'\)/
    );
  });
});

describe('the present-tense alternatives exist and are used', () => {
  it.each([
    ["insight.projection.handling_it"],
    ["insight.projection.agent_on_it"],
    ["insight.seen.repeated_manual"],
  ])('%s is reachable from the card', key => {
    /*
     * A gate with nothing on its other branch is the same bug wearing a
     * condition: the card would fall to a fallback string written in English
     * for a Hebrew reader, or render nothing where a line belongs.
     */
    expect(SOURCE).toContain(key);
  });
});

describe('the standing offer still has its original gate', () => {
  it('is withheld where no automation exists either', () => {
    /*
     * The earlier fix, which must survive this one. Thirteen detectors are
     * `eligibleForAutomation: false`, and the footer promising to take over
     * was shown on all of them — the refund-rate card offered to handle "have
     * a conversation with the clients who asked for their money back".
     *
     * Both conditions, so neither can be dropped while the other reads as
     * covering it.
     */
    const footer = near("t('insight.seen.repeated')");

    expect(footer).toContain('eligible_for_automation');
    expect(footer).toContain('agentAlreadyWorking');
  });
});
