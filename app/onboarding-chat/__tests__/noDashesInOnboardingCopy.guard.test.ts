/**
 * No dashes in anything the owner reads during onboarding.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A standing preference, asked for twice. Reported from the plan screen:
 *
 *     You invoice, they transfer. No card processor — your bank details go
 *     on the invoice.
 *
 *     They go on every invoice — it is where your client learns to send the
 *     money. Nobody can type them but you.
 *
 * A dash joins two half-thoughts without saying how they relate, which is why
 * the result reads flat. A colon says the second half explains the first, a
 * comma says it continues it, and a full stop says it is its own point. The
 * writer has to pick one, and picking is the work.
 *
 * The same rule is already given to the model that writes the interview
 * questions, in `pickFollowUp`. It had never been applied to the STATIC copy,
 * which is why twenty-four strings across these two pages carried one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A GUARD RATHER THAN A STYLE NOTE
 *
 * Because it came back. The copy was fixed once by hand, and a dash reappears
 * every time somebody writes a new card, since it is the natural way to tack
 * an aside onto a sentence. A reviewer cannot be relied on to catch a
 * punctuation mark in three languages.
 *
 * Comments are stripped before checking: this file and the pages it guards
 * necessarily contain dashes in their own prose, and the rule is about what
 * the OWNER reads.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

/**
 * Source with every comment removed, newlines preserved so a reported line
 * number still points at the right place in the real file.
 */
const copyOnly = (source: string) => {
  const blank = (match: string) => '\n'.repeat((match.match(/\n/g) || []).length);
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/^\s*\/\/.*$/gm, '');
};

const PAGES = ['app/onboarding-chat/page.tsx', 'app/onboarding-build/page.tsx'];

/**
 * An em dash, an en dash, or a spaced hyphen used as one.
 *
 * A hyphen INSIDE a word is not a dash and is left alone: "no-code",
 * "day-to-day", and every Tailwind class in these files. It is the
 * clause-joining use that reads flat, and a space on both sides is what
 * distinguishes it.
 */
const DASH = /—|–| - /;

/**
 * STRING LITERALS ONLY, because the first version of this test read whole
 * lines and reported nine findings of which eight were arithmetic:
 *
 *     const newIndex = direction === 'up' ? index - 1 : index + 1;
 *     previewData.pipelineStages![idx - 1].color
 *
 * A minus sign is not a dash, and a guard that cries wolf eight times out of
 * nine is a guard nobody reads. The ninth was real — `parts.join(' - ')`,
 * which built a line the owner sees in the thread as their own message.
 */
const literals = (source: string): string[] => {
  const found: string[] = [];
  const pattern = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    found.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  return found;
};

/**
 * Strings that are addressed to a browser rather than to a person.
 *
 * `calc(100dvh - 150px)` and a gradient's stop list both contain a spaced
 * minus and neither is prose. Matched narrowly, on constructs no sentence
 * contains, rather than by skipping anything that looks technical.
 */
const isForTheBrowser = (text: string) =>
  /calc\(|gradient|var\(--|[0-9](px|dvh|rem|%)/.test(text);

describe('onboarding copy uses punctuation that says something', () => {
  it.each(PAGES)('has no clause-joining dash anywhere an owner can read it: %s', page => {
    const offenders = literals(copyOnly(read(page)))
      .filter(text => DASH.test(text))
      .filter(text => !isForTheBrowser(text))
      /*
       * The one legitimate dash: a lone "—" as an empty-value glyph in a
       * number input's placeholder. A symbol standing in for "nothing yet",
       * not a sentence joined badly, and a colon there would be nonsense.
       */
      .filter(text => text !== '—');

    expect(offenders.map(text => text.slice(0, 120))).toEqual([]);
  });

  it('still tells the question writer the same thing, so the two agree', () => {
    /*
     * One rule, two enforcement points: this guard for the copy somebody
     * types, and the prompt rule for the questions a model writes. If the
     * prompt rule is ever dropped, the interview starts producing exactly
     * what this test forbids everywhere else.
     */
    const manager = read('lib/services/OnboardingConversationManager.ts');
    expect(manager).toMatch(/No dashes of any kind between clauses/);
  });
});
