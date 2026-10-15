/**
 * The language chips exist TWICE, and the two copies must agree.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG
 *
 * Asked to remove the flag emoji from the language chips, I removed it from
 * `getNextResponse` in `OnboardingConversationManager` and reported it done.
 * The flags were still on screen, because the FIRST message is not built by the
 * manager at all: `app/onboarding-chat/page.tsx` composes its own welcome and
 * its own chip list, and that is the one an owner sees.
 *
 * Two hardcoded copies of one list, and a change to either looks complete.
 *
 * They also have to match CHARACTER FOR CHARACTER, not just in spirit:
 * `updateStateFromMessage` resolves the choice by matching words inside the
 * reply, so a chip whose wording drifts in one copy picks the wrong language or
 * falls through to English. English is the fallback, which means a Hebrew
 * speaker's drift is silent.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

const page = read('app/onboarding-chat/page.tsx');
const manager = read('lib/services/OnboardingConversationManager.ts');

/** Every `suggestions: [...]` list that offers a language, from either file. */
function chipLists(source: string): string[][] {
  return [...source.matchAll(/suggestions: \[([^\]]*)\]/g)]
    .map(match =>
      match[1]
        .split(',')
        .map(entry => entry.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean)
    )
    .filter(list => list.some(entry => /English/.test(entry)));
}

describe('both copies of the language chips', () => {
  const fromPage = chipLists(page);
  const fromManager = chipLists(manager);

  it('are found, one in each file', () => {
    // If either drops to zero, every assertion below is passing vacuously.
    expect(fromPage).toHaveLength(1);
    expect(fromManager).toHaveLength(1);
  });

  it('are character-for-character identical', () => {
    // The chip text IS the input the language detector reads.
    expect(fromPage[0]).toEqual(fromManager[0]);
  });

  it('carry no flag emoji', () => {
    /*
     * A flag names a country and these are languages: Spanish is not Spain to
     * most of the people who speak it, and English is not the United States.
     */
    for (const chip of [...fromPage[0], ...fromManager[0]]) {
      expect(chip).not.toMatch(/\p{Regional_Indicator}/u);
    }
  });

  it('still name each language in its own script', () => {
    // What replaces the flag as the pre-language signal.
    expect(fromPage[0].join(' ')).toContain('עברית');
    expect(fromPage[0].join(' ')).toContain('Español');
  });

  it('each resolve to the language they offer', () => {
    /*
     * The detector restated: `updateStateFromMessage`'s `language_selection`
     * branch, which matches words inside the reply and falls back to English.
     * A Hebrew chip that stops matching is therefore silent.
     */
    const resolve = (message: string) => {
      const text = message.toLowerCase();
      if (text.includes('עברית') || text.includes('hebrew')) return 'he';
      if (text.includes('español') || text.includes('spanish')) return 'es';
      return 'en';
    };

    const resolved = fromPage[0].map(resolve).sort();
    expect(resolved).toEqual(['en', 'es', 'he']);
  });
});
