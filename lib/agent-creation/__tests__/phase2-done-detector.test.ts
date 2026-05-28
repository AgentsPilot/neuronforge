/**
 * Unit tests for the Phase 2 "I want to stop" keyword detector.
 *
 * Coverage:
 *   - every keyword in `DONE_KEYWORDS` matches positively
 *   - realistic surroundings ("ok build it", "yeah let's build") still match
 *   - substantive answers do NOT match (false-positive prevention)
 *   - specifically guards "let me know once it's done processing each batch"
 *     and "i'm not sure" per SA Comment 7
 *   - empty / whitespace / null / undefined returns false
 */

import {
  DONE_KEYWORDS,
  isDoneIntent,
} from '@/lib/agent-creation/phase2-done-detector';

describe('isDoneIntent — positive cases', () => {
  it.each(DONE_KEYWORDS.map((kw) => [kw]))(
    'matches the keyword "%s" on its own',
    (kw) => {
      expect(isDoneIntent(kw)).toBe(true);
    }
  );

  it('matches keywords case-insensitively', () => {
    expect(isDoneIntent('BUILD IT')).toBe(true);
    expect(isDoneIntent('Build It')).toBe(true);
    expect(isDoneIntent("LET'S BUILD")).toBe(true);
  });

  it('matches when the keyword is surrounded by other text', () => {
    expect(isDoneIntent('ok build it now please')).toBe(true);
    expect(isDoneIntent("yeah let's build")).toBe(true);
    expect(isDoneIntent('cool, ship it')).toBe(true);
    expect(isDoneIntent('ok proceed')).toBe(true);
    expect(isDoneIntent('go ahead and build')).toBe(true);
    expect(isDoneIntent("that's enough for now")).toBe(true);
    expect(isDoneIntent("i'm ready to go")).toBe(true);
  });

  it('matches with leading / trailing whitespace', () => {
    expect(isDoneIntent('   build it   ')).toBe(true);
  });
});

describe('isDoneIntent — negative cases (false-positive prevention)', () => {
  it('does NOT match the SA Comment 7 hazard case (mid-sentence "done")', () => {
    // This is the exact string SA flagged. The detector intentionally drops
    // standalone "done" from the keyword list — a false positive here would
    // prematurely terminate Phase 2 on a substantive answer.
    expect(
      isDoneIntent("let me know once it's done processing each batch")
    ).toBe(false);
  });

  it('does NOT match common substantive answers', () => {
    expect(isDoneIntent('every morning at 8am')).toBe(false);
    expect(isDoneIntent('skip silently')).toBe(false);
    expect(isDoneIntent("the marketing team's drive folder")).toBe(false);
    expect(isDoneIntent('send a summary email to my accountant')).toBe(false);
    expect(isDoneIntent('match by vendor and amount')).toBe(false);
    expect(isDoneIntent('last 7 days')).toBe(false);
  });

  it('does NOT match "i\'m not sure" (looks adjacent to "i\'m ready" but is not)', () => {
    expect(isDoneIntent("i'm not sure")).toBe(false);
  });

  it('does NOT match the standalone single word "done"', () => {
    // SA Comment 7: 'done' is intentionally NOT in the keyword list to avoid
    // substring false-positives. A user who types just "done" gets a normal
    // next-question response. This is the accepted trade-off.
    expect(isDoneIntent('done')).toBe(false);
    expect(isDoneIntent('Done.')).toBe(false);
  });

  it('does NOT match question-shaped replies', () => {
    expect(isDoneIntent('what about the report format?')).toBe(false);
    expect(isDoneIntent('how should I handle missing data?')).toBe(false);
  });
});

describe('isDoneIntent — edge cases', () => {
  it('returns false for an empty string', () => {
    expect(isDoneIntent('')).toBe(false);
  });

  it('returns false for whitespace only', () => {
    expect(isDoneIntent('   ')).toBe(false);
    expect(isDoneIntent('\n\t')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isDoneIntent(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isDoneIntent(undefined)).toBe(false);
  });
});

describe('DONE_KEYWORDS — invariants', () => {
  it('exports a non-empty readonly list', () => {
    expect(DONE_KEYWORDS.length).toBeGreaterThan(0);
  });

  it('does NOT contain the standalone single-word "done"', () => {
    // Locking this in by test: see SA Comment 7. If a future change adds
    // "done" to the list, the hazard test above will fail too.
    expect(DONE_KEYWORDS).not.toContain('done');
  });

  it('contains every keyword in lowercase', () => {
    // The detector lowercases input before matching, so the keyword list
    // must be lowercase too — otherwise some entries would never match.
    DONE_KEYWORDS.forEach((kw) => {
      expect(kw).toBe(kw.toLowerCase());
    });
  });
});
