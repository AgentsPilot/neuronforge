/**
 * Every key a public page asks for exists, in all three languages.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS EXISTS FOR
 *
 * The public pages have their OWN dictionary (`createPublicT`, this file's
 * `publicT`), separate from the app's `LanguageContext`. A key added to the app
 * side and used on a public page does not fall back and does not fail: it
 * renders its own NAME. A client opening a quote was shown the literal
 * `proposal.sessions_title` above the list of their six meetings.
 *
 * Nothing caught it, because nothing could: the page compiles, the test suite
 * passes, and the only reader who sees it is the client.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT READS THE SOURCE
 *
 * The pages are React components that need a token, a brand and a fetch before
 * they render a word. What went wrong is a missing dictionary entry for a
 * literal key, and a literal key is exactly what a reader can find.
 *
 * Only plain string literals are checked. `t(\`proposal.state.${code}.body\`)`
 * is a computed key whose parts live in the code that produces `code`, and
 * guessing at its expansions would make this file lie in both directions.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');

import { publicMessages } from '../public-pages';

/*
 * The dictionaries are IMPORTED, not parsed: `publicMessages` is exported and
 * is the same object `publicT` looks keys up in, so this cannot drift from what
 * the pages actually resolve against. Only the pages are read as source, below,
 * because what they ask for is a literal in a component that needs a token, a
 * brand and a fetch before it renders a word.
 */
const blocks: Record<string, Set<string>> = Object.fromEntries(
  Object.entries(publicMessages).map(([locale, entries]) => [locale, new Set(Object.keys(entries))])
);

/**
 * Everything that takes its words from the public dictionary.
 *
 * The shared COMPONENTS are here too, and belong here: the client reads what
 * they render exactly as they read the page around it, and the page's own list
 * of keys says nothing about the card inside it.
 */
const PAGES = [
  ['app', 'proposal', '[token]', 'page.tsx'],
  ['app', 'book', 'manage', '[token]', 'page.tsx'],
  ['app', 'book', 'manage', '[token]', 'cancel', 'page.tsx'],
  ['app', 'book', 'manage', '[token]', 'reschedule', 'page.tsx'],
  ['app', 'book', 'manage', '[token]', 'intake', 'page.tsx'],
  ['components', 'public', 'AppointmentCard.tsx'],
];

/** Every `t('literal')` a page asks for. */
function keysAskedBy(parts: string[]): string[] {
  const source = read(...parts);
  return [...new Set([...source.matchAll(/\bt\('([^']+)'/g)].map(match => match[1]))];
}

describe('the public dictionary', () => {
  it('has all three languages', () => {
    expect(Object.keys(blocks).sort()).toEqual(['en', 'es', 'he']);
  });

  it('says the same things in each of them', () => {
    // A key in English and missing in Hebrew is the same bug seen by half the
    // clients: the page renders the key's own name for them alone.
    const missingInEs = [...blocks.en].filter(key => !blocks.es.has(key));
    const missingInHe = [...blocks.en].filter(key => !blocks.he.has(key));

    expect(missingInEs).toEqual([]);
    expect(missingInHe).toEqual([]);
  });
});

// Named by path, so a failure says WHICH page asked for a key nobody has.
describe.each(PAGES.map(parts => [parts.join('/'), parts] as const))('%s', (_path, parts) => {
  it('asks for nothing the dictionary does not have', () => {
    const asked = keysAskedBy([...parts]);

    // Sanity: a page that asks for nothing means the reader above is broken,
    // not that the page is clean.
    expect(asked.length).toBeGreaterThan(0);

    const missing = asked.filter(key => !blocks.en.has(key));
    expect(missing).toEqual([]);
  });
});

/**
 * The keys a page looks up through a TABLE rather than a literal call.
 *
 * `t(stamp.key)` is computed, so the reader above cannot see it — but its
 * possible values are themselves literals, sitting in one object a few lines
 * away. Checking them here is the difference between a client reading "PAID"
 * and a client reading the word `paid` in English on a Hebrew page.
 */
describe('the payment stamp on an appointment', () => {
  it('names only words the dictionary has', () => {
    const source = read('components', 'public', 'AppointmentCard.tsx');
    const table = source.slice(source.indexOf('const PAYMENT_STAMP'));
    const keys = [...table.slice(0, table.indexOf('};')).matchAll(/key: '([^']+)'/g)].map(m => m[1]);

    expect(keys).toEqual(expect.arrayContaining(['paid', 'refunded']));
    expect(keys.filter(key => !blocks.en.has(key))).toEqual([]);
  });
});
