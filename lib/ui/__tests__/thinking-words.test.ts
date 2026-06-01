/**
 * Tests for the thinking-words `excludeFromGeneric` safeguard (E3, 2026-05-29).
 *
 * The Phase 2 `clarification_hints` category holds full sentences that must NOT
 * leak into the generic rotating-status word pool (used by random/cycler
 * helpers and the exported THINKING_WORDS constant). They must still be
 * reachable EXPLICITLY for the agent-creation page.
 */

import {
  getThinkingWordsLoader,
  resetThinkingWordsLoader,
} from '@/lib/ui/thinking-words-loader';
import {
  getWordsForCategories,
  getRandomThinkingWord,
  THINKING_WORDS,
} from '@/lib/ui/thinking-words';

const CLARIFICATION_CATEGORY = 'clarification_hints' as const;

beforeEach(() => {
  resetThinkingWordsLoader();
});

describe('thinking-words — clarification_hints (excludeFromGeneric)', () => {
  it('exposes exactly 10 clarification hints via explicit category access', () => {
    const hints = getWordsForCategories([CLARIFICATION_CATEGORY]);
    expect(hints).toHaveLength(10);
    expect(hints.every((h) => typeof h === 'string' && h.length > 0)).toBe(true);
  });

  it('keeps clarification hints OUT of the generic pool (getAllWords / THINKING_WORDS)', () => {
    const loader = getThinkingWordsLoader();
    const allWords = loader.getAllWords();
    const hints = getWordsForCategories([CLARIFICATION_CATEGORY]);

    for (const hint of hints) {
      expect(allWords).not.toContain(hint);
      expect(THINKING_WORDS).not.toContain(hint);
    }
  });

  it('keeps clarification hints out of every role word list', () => {
    const loader = getThinkingWordsLoader();
    const hints = new Set(getWordsForCategories([CLARIFICATION_CATEGORY]));
    const roles = Object.keys(loader.getRoleMapping()) as Array<
      keyof ReturnType<typeof loader.getRoleMapping>
    >;

    for (const role of roles) {
      const roleWords = loader.getWordsForRole(role as any);
      for (const w of roleWords) {
        expect(hints.has(w)).toBe(false);
      }
    }
  });

  it('clarification hints are qualitative — no numbers / cap-related copy (FR7)', () => {
    const hints = getWordsForCategories([CLARIFICATION_CATEGORY]);
    for (const hint of hints) {
      expect(hint).not.toMatch(/\b\d+\b/);
      expect(hint.toLowerCase()).not.toContain('cap');
      expect(hint.toLowerCase()).not.toContain('limit');
    }
  });

  it('generic random word never returns a clarification hint over many draws', () => {
    const hints = new Set(getWordsForCategories([CLARIFICATION_CATEGORY]));
    for (let i = 0; i < 500; i++) {
      expect(hints.has(getRandomThinkingWord())).toBe(false);
    }
  });
});
