/**
 * One level-one heading per public page, and it is the business's name.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG
 *
 * `PublicHeader` renders the business's name as the page's `<h1>`. Three of the
 * booking-management pages then rendered an `<h1>` of their own underneath it,
 * at `text-xl` — exactly the size the compact header gives the business name.
 *
 * So the cancel page showed "בית הספר הבינלאומי להורות" centred and "ביטול
 * הפגישה" hard against the start edge, the same weight, with nothing to say
 * which was the page and which was the business. For a screen reader it was
 * worse than untidy: two level-one headings is two documents.
 *
 * The page's purpose is either the header's `subtitle` (the hub and cancel) or
 * an `<h2>` beneath it with a line of support (reschedule, intake). Either way
 * the business's name is the only `<h1>`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');

/** Prose about a heading is not a heading. */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const PAGES = [
  ['app', 'proposal', '[token]', 'page.tsx'],
  ['app', 'book', 'manage', '[token]', 'page.tsx'],
  ['app', 'book', 'manage', '[token]', 'cancel', 'page.tsx'],
  ['app', 'book', 'manage', '[token]', 'reschedule', 'page.tsx'],
  ['app', 'book', 'manage', '[token]', 'intake', 'page.tsx'],
];

describe('the public header', () => {
  it('is the one that owns the h1', () => {
    expect(withoutComments(read('components', 'public', 'PublicHeader.tsx'))).toContain('<h1');
  });
});

describe.each(PAGES.map(parts => [parts.join('/'), parts] as const))('%s', (_path, parts) => {
  it('declares no h1 of its own', () => {
    expect(withoutComments(read(...parts))).not.toContain('<h1');
  });
});
