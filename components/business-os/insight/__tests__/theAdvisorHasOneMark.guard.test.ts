/**
 * The advisor looks like the advisor before it has anything to say.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS ON SCREEN
 *
 * `AdvisorIdleCard` is what the dashboard shows while there is nothing to
 * advise — which includes the seconds before the insights have loaded, so it
 * is the first advisor most readers see on any visit. It carried a saturated
 * orange gradient circle with a white filled TICK inside it and a coloured
 * glow beneath.
 *
 * Three faults in one 32px square:
 *
 *   · a tick means DONE, on a card whose own words are "watching, nothing to
 *     advise yet". It had concluded nothing and its only glyph claimed a
 *     result;
 *   · a bright filled circle at that size reads as an eyeball or an avatar
 *     placeholder, which is what it was reported as;
 *   · the gradient and the glow made it the loudest thing on a dashboard
 *     whose message there is that there is nothing to look at.
 *
 * `InsightAdvisorCard` had already settled all three for the LOADED card and
 * recorded why — the gradient circle "read as a decoration or an avatar
 * placeholder", and "a 30px block of saturated orange beside orange text is
 * two loud things in one line". The idle card never got that fix, so the
 * product had two marks for one advisor and showed the worse one first.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * `AdvisorIdleCard` is a private function inside a 3,000-line component and is
 * not exported, so there is nothing to render in isolation. What matters is
 * cheap to read off the source and expensive to notice by eye: that both
 * advisor marks are the same glyph with the same treatment.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

/** A file's code, with comments removed — see the note below. */
function codeOf(file: string): string {
  return readFileSync(join(__dirname, '..', file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/*
 * Comments stripped before anything is searched.
 *
 * Both marks carry a comment explaining the tint and naming the gradient it
 * replaced. Matching raw source would find "linear-gradient" in the prose and
 * fail on a correct file, and would find `Bot` in the prose and pass on a
 * broken one. Either way the suite would be measuring the explanation instead
 * of the code.
 */
const DASHBOARD = codeOf('LiveDashboard.tsx');
const ADVISOR_CARD = codeOf('InsightAdvisorCard.tsx');

/** The body of the idle card, which is where the mark lives. */
function idleCard(): string {
  const at = DASHBOARD.indexOf('function AdvisorIdleCard');
  if (at === -1) throw new Error('AdvisorIdleCard has been renamed or removed');

  /* To the next top-level function. The component is short; this is its whole
     body plus a little slack. */
  const next = DASHBOARD.indexOf('\nfunction ', at + 10);
  return DASHBOARD.slice(at, next === -1 ? at + 4000 : next);
}

describe('the idle advisor wears the advisor mark', () => {
  it('is the robot, the same glyph as the loaded card', () => {
    /*
     * THE FIX, as one assertion. The loaded card uses `Bot`, which the agents
     * card and the bookings tab also use to mean "a machine did this without a
     * person". The advisor before it acts is the same machine.
     */
    expect(idleCard()).toContain('<Bot');
    expect(ADVISOR_CARD).toContain('<Bot');
  });

  it('is not a hand-rolled glyph', () => {
    /*
     * It was an inline `<path d="M12 2C6.48...">` — a filled tick-in-circle,
     * copied in rather than named. An icon nobody can name by reading the code
     * is an icon nobody checked against the words beside it.
     */
    expect(idleCard()).not.toMatch(/<path\s/);
    expect(idleCard()).not.toMatch(/<svg\s/);
  });
});

/**
 * The MARK's own styles: the element that wraps the glyph, and nothing else.
 *
 * Scoped this tightly on purpose. The first version of this suite tested
 * "everything before the Publish button", which caught the CARD's neutral drop
 * shadow — `0 6px 20px -10px rgba(16,22,42,0.25)`, which is correct and has
 * nothing to do with the mark — and failed on a good file. A guard that cannot
 * tell the thing it is about from its container reports the wrong defect.
 */
function markStyles(): string {
  const card = idleCard();
  const glyph = card.indexOf('<Bot');
  if (glyph === -1) throw new Error('the idle card no longer draws the robot');

  const wrapper = card.lastIndexOf('<span', glyph);
  return card.slice(wrapper === -1 ? 0 : wrapper, glyph);
}

describe('it is quiet, because the card is saying nothing is wrong', () => {
  it.each([
    ['a gradient fill', /linear-gradient/],
    ['a coloured glow', /boxShadow/],
  ])('has no %s on the mark', (_label, pattern) => {
    /*
     * The mark only. The setup state's "Publish it" BUTTON keeps its gradient
     * and its lift, and that is the line the loaded card's own comment draws:
     * "The orange stays. The accent is the advisor's identity and this is not a
     * control." A button may be loud; a status mark may not.
     */
    expect(markStyles()).not.toMatch(pattern);
  });

  it('uses the same tint the loaded card settled on', () => {
    /* One value, so the two advisors are the same weight of orange. A second
       opinion about the tint is how they drifted apart the first time. */
    const TINT = 'rgba(249,115,22,0.14)';

    expect(idleCard()).toContain(TINT);
    expect(ADVISOR_CARD).toContain(TINT);
  });

  it('is a rounded square, not a circle', () => {
    /* The circle is what made it read as an eye. */
    expect(idleCard()).not.toContain("borderRadius: '50%'");
  });
});
