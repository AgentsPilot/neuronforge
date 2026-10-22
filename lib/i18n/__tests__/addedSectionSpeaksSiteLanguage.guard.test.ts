/**
 * A section added from the editor arrives in the SITE's language.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS CLOSES
 *
 * Five code paths build website sections. Four write the page's own language —
 * the AI generator prompts in it, the landing builder branches on it, and the
 * template scaffold hands English literals to `translateBlockContent` on the
 * way into the database. The Add Section dialog was the fifth, and it wrote
 * English unconditionally:
 *
 *     newsletter: { title: 'Stay Updated', description: 'Subscribe to our
 *                   newsletter', button_text: 'Subscribe' },
 *
 * So a Hebrew site gained an English newsletter the moment its owner added
 * one, and the same for every other section in that dialog.
 *
 * STORED English is worse than RENDERED English, which is why no render test
 * would have caught it: both newsletter renderers carry localised fallbacks,
 * and a fallback only applies to content that is ABSENT. Writing the English
 * string into the row is precisely what defeats them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * `getDefaultBlockContent` lives inside a nine-thousand-line client component
 * and cannot be imported. What can be checked is the contract between its two
 * halves: the literal it returns, and the table that translates it. The table
 * is keyed by the English string itself, so a new section — or one new line of
 * starter copy on an existing one — is translated only if somebody also added
 * that exact string to the table. Nothing fails when they do not. The section
 * simply arrives in English, on somebody's live site.
 *
 * MACHINE VALUES MUST NOT BE IN THE TABLE, and that half is checked too: these
 * same literals carry a field's `name`, a `type`, a `layout` and a link
 * target, and translating `'email'` or `'#contact'` would break the form or
 * the link rather than the wording.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { translateTemplateContent } from '@/lib/i18n/website-block-translations';

const EDITOR = join(__dirname, '..', '..', '..', 'app', 'business-os', 'website', 'page.tsx');

const source = readFileSync(EDITOR, 'utf8').replace(/\r\n/g, '\n');

/** The fields that hold words a visitor reads. Everything else is machinery. */
const COPY_FIELDS = new Set([
  'title',
  'subtitle',
  'description',
  'headline',
  'subheadline',
  'cta_text',
  'button_text',
  'label',
  'placeholder',
  'success_message',
]);

/** The body of the `defaults` literal inside `getDefaultBlockContent`. */
function defaultsLiteral(): string {
  const at = source.indexOf('const defaults: Record<string, Record<string, unknown>> = {');
  expect(at).toBeGreaterThan(-1);

  const open = source.indexOf('{', at + 'const defaults: Record<string, Record<string, unknown>>'.length);
  let depth = 0;

  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }

  throw new Error('getDefaultBlockContent: the defaults literal never closes');
}

/** Every `copyField: 'some words'` pair in a chunk of source. */
function copyStrings(literal: string): string[] {
  const found: string[] = [];

  for (const match of literal.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*'((?:[^'\\]|\\.)*)'/g)) {
    const [, field, value] = match;
    if (!COPY_FIELDS.has(field)) continue;
    const text = value.replace(/\\'/g, "'").trim();
    if (text) found.push(text);
  }

  return [...new Set(found)];
}

describe('a section added from the editor speaks the site language', () => {
  it('is actually reading the editor', () => {
    expect(source).toContain('const getDefaultBlockContent');
    expect(source).toContain('showAddSectionModal');
  });

  it('hands its starter copy to the shared translator, not to the owner raw', () => {
    /*
     * The mechanism, not the output: without this call every assertion below
     * passes against a table nothing consults.
     */
    const fn = source.slice(source.indexOf('const getDefaultBlockContent'));
    const body = fn.slice(0, fn.indexOf('\n  };') + 5);

    expect(body).toContain('translateBlockContent(');
  });

  it('follows the SITE language, never the admin UI language', () => {
    /*
     * `language` from `useLanguage()` is the language the owner's own screen
     * is in. A Hebrew-speaking owner may run an English site, and the copy
     * going onto that site has to follow the site.
     */
    const fn = source.slice(source.indexOf('const getDefaultBlockContent'));
    const body = fn.slice(0, fn.indexOf('\n  };') + 5);

    expect(body).toContain('website_language');
  });

  it('has every piece of starter copy in the translation table', () => {
    const untranslatable = copyStrings(defaultsLiteral()).filter(
      text => translateTemplateContent(text, 'he') === text
    );

    expect(untranslatable).toEqual([]);
  });

  it('translates the same copy into Spanish, not only Hebrew', () => {
    /*
     * A separate assertion because a half-filled entry — `he` written, `es`
     * left out — resolves through the `|| translation.en` fallback and would
     * otherwise pass on the Hebrew check alone.
     */
    const untranslatable = copyStrings(defaultsLiteral()).filter(
      text => translateTemplateContent(text, 'es') === text
    );

    expect(untranslatable).toEqual([]);
  });

  it('leaves machine values alone, so a field name and a link still work', () => {
    /*
     * The table is keyed by the string itself and `translateBlockContent`
     * walks every string in the object, so a careless entry here would rename
     * a form field or repoint an anchor. These are the ones the literal
     * carries today.
     */
    const machine = [
      'name',
      'email',
      'phone',
      'message',
      'text',
      'tel',
      'textarea',
      'grid',
      'button',
      'booking',
      'confirmation',
      '#contact',
    ];

    for (const value of machine) {
      expect(translateTemplateContent(value, 'he')).toBe(value);
      expect(translateTemplateContent(value, 'es')).toBe(value);
    }
  });

  it('covers every section the Add Section dialog offers', () => {
    /*
     * The dialog and the defaults are two lists that have to agree: a tile
     * offering a type with no defaults adds an empty section, and that is a
     * different fault from this one but caught in the same place.
     */
    const picker = source.slice(source.indexOf('{ type: \'hero\', icon: Target'));
    const offered = [...picker.slice(0, 6000).matchAll(/\{ type: '([a-z_]+)', icon:/g)].map(m => m[1]);

    expect(offered.length).toBeGreaterThanOrEqual(10);

    const literal = defaultsLiteral();
    const missing = offered.filter(type => !new RegExp(`\\b${type}:\\s*\\{`).test(literal));

    expect(missing).toEqual([]);
  });
});
