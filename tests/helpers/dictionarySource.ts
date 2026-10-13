/**
 * The Business OS dictionaries, as source text, for tests that assert on copy.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY TESTS READ COPY AS TEXT RATHER THAN IMPORTING IT
 *
 * `translations` lives in `LanguageContext.tsx`, a `'use client'` React module.
 * Importing it to check whether a string exists pulls React and a context
 * provider into a unit test that wanted to grep for a key. Nineteen suites
 * independently decided to read the file instead, each with its own spelling of
 * `readFileSync`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS HELPER EXISTS
 *
 * Those nineteen all hardcoded the path. When the dictionaries moved out of
 * `LanguageContext.tsx` into one module per language — twelve thousand lines of
 * strings had been sitting inside a client component that every Business OS
 * page imports — every one of them went on reading a file that no longer held
 * any copy.
 *
 * And they did not fail loudly. A regex over an empty haystack matches nothing,
 * so a suite asserting "this key is translated" passes vacuously and a suite
 * asserting "it exists in all three languages" reports zero. Several did the
 * first and said nothing at all.
 *
 * One definition, so the next move is one edit rather than nineteen.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * NOT under `__tests__`: jest's `testMatch` collects every file in those
 * directories as a suite, and a helper with no tests in it fails the run.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

export const DICTIONARY_LANGUAGES = ['en', 'es', 'he'] as const;

/** Where each language's dictionary lives, relative to the repo root. */
export function dictionaryPath(lang: (typeof DICTIONARY_LANGUAGES)[number]): string {
  return `lib/business-os/translations/${lang}.ts`;
}

/**
 * All three dictionaries concatenated, which is what a key-existence or
 * "translated in every language" assertion is really asking about.
 *
 * Joined with a newline so a regex anchored to a line start cannot match across
 * the seam between two files.
 */
export function dictionarySource(root: string = process.cwd()): string {
  return DICTIONARY_LANGUAGES.map(lang => readFileSync(join(root, dictionaryPath(lang)), 'utf8')).join(
    '\n'
  );
}

/** One language on its own, for a test that is about that language's copy. */
export function dictionarySourceFor(
  lang: (typeof DICTIONARY_LANGUAGES)[number],
  root: string = process.cwd()
): string {
  return readFileSync(join(root, dictionaryPath(lang)), 'utf8');
}
