/**
 * T3-L (Layer 2 Step 3) — the ★ "off" messages exist, in all three languages,
 * on both sides of the wire, and say the same thing (FR-14, BQ-1, AC-9).
 *
 * The user approved these sentences on 2026-09-19 and there are only three
 * places an owner can meet them: the chat routes, the website page, and the
 * image picker. Each of those reads from a DIFFERENT store — the server module
 * here, the page's own `LABELS` map, and `LanguageContext`'s dictionary — so
 * "it is translated" is three separate claims and a static test is the only
 * thing that keeps them equal. Two sentences for one state is how an owner
 * ends up unsure whether they are looking at the same problem twice.
 *
 * It also asserts what must NOT be here: images reuse the existing
 * `media.generate.unavailable` message, which already existed in all three
 * languages before this step (QA Q-6).
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  AI_UNAVAILABLE_CHAT,
  AI_UNAVAILABLE_WEBSITE_WRITING,
  aiUnavailableLanguage,
  chatUnavailableMessage,
  websiteWritingUnavailableMessage,
} from '../aiUnavailableMessages';

const ROOT = path.resolve(__dirname, '../../../..');
const LANGUAGES = ['en', 'he', 'es'] as const;

function read(relative: string): string {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

describe('the approved sentences', () => {
  it.each(LANGUAGES)('chat has a non-empty sentence in %s', (language) => {
    expect(typeof AI_UNAVAILABLE_CHAT[language]).toBe('string');
    expect(AI_UNAVAILABLE_CHAT[language].trim().length).toBeGreaterThan(0);
  });

  it.each(LANGUAGES)('website writing has a non-empty sentence in %s', (language) => {
    expect(typeof AI_UNAVAILABLE_WEBSITE_WRITING[language]).toBe('string');
    expect(AI_UNAVAILABLE_WEBSITE_WRITING[language].trim().length).toBeGreaterThan(0);
  });

  it('the English wording is the one the user approved, to the character', () => {
    expect(AI_UNAVAILABLE_CHAT.en).toBe('The assistant is unavailable right now. Please try again later.');
    expect(AI_UNAVAILABLE_WEBSITE_WRITING.en).toBe('AI writing is unavailable right now.');
  });

  it('each language really is a different string (nothing fell back to English)', () => {
    expect(new Set(Object.values(AI_UNAVAILABLE_CHAT)).size).toBe(3);
    expect(new Set(Object.values(AI_UNAVAILABLE_WEBSITE_WRITING)).size).toBe(3);
  });

  it('the Hebrew and Spanish sentences are actually in those scripts/words', () => {
    // A cheap guard against a copy-paste that leaves English in a Hebrew slot.
    expect(AI_UNAVAILABLE_CHAT.he).toMatch(/[֐-׿]/);
    expect(AI_UNAVAILABLE_WEBSITE_WRITING.he).toMatch(/[֐-׿]/);
    expect(AI_UNAVAILABLE_CHAT.es).toMatch(/disponible/i);
    expect(AI_UNAVAILABLE_WEBSITE_WRITING.es).toMatch(/disponible/i);
  });
});

describe('picking a language from whatever the caller has', () => {
  it.each([
    ['he', 'he'],
    ['he-IL', 'he'],
    ['HE_il', 'he'],
    ['es', 'es'],
    ['es-MX', 'es'],
    ['en', 'en'],
    ['en-GB', 'en'],
  ])('%s resolves to %s', (input, expected) => {
    expect(aiUnavailableLanguage(input)).toBe(expected);
  });

  it.each([[undefined], [null], [''], ['  '], ['klingon'], [42], [{}]])(
    'falls back to English for %p rather than answering nothing',
    (input) => {
      expect(aiUnavailableLanguage(input)).toBe('en');
      expect(chatUnavailableMessage(input)).toBe(AI_UNAVAILABLE_CHAT.en);
      expect(websiteWritingUnavailableMessage(input)).toBe(AI_UNAVAILABLE_WEBSITE_WRITING.en);
    }
  );
});

describe('the client copies say the same thing as the server copies', () => {
  /**
   * The website page is `'use client'` and renders from its own `LABELS` map,
   * one per language. It cannot import the server module — the page would then
   * pull `lib/business-os/llm/` into the browser bundle — so the two are kept
   * equal here instead, the same way the reserved-key prefix is kept equal
   * between the policy and the admin route.
   */
  it('the website page has `ai_unavailable` in all three LABELS maps, matching the server', () => {
    const source = read('app/business-os/website/page.tsx');
    const found = [...source.matchAll(/^\s*ai_unavailable: '(.*)',\s*$/gm)].map((match) => match[1]);

    expect(found).toHaveLength(3);
    // The maps are declared en, es, he — in that order (LABELS at the top).
    expect(found).toEqual([
      AI_UNAVAILABLE_WEBSITE_WRITING.en,
      AI_UNAVAILABLE_WEBSITE_WRITING.es,
      AI_UNAVAILABLE_WEBSITE_WRITING.he,
    ]);
  });

  /**
   * Images: NOT a new sentence (QA Q-6). The `unavailable` outcome already
   * existed for "no image provider configured", it already reaches
   * `media.generate.unavailable`, and that key already had all three
   * languages before this step. Switching the area off produces the same
   * outcome, so the owner reads the message that was already written.
   */
  it('the image message already exists in all three languages and was not duplicated here', () => {
    const source = read('lib/business-os/LanguageContext.tsx');
    const found = [...source.matchAll(/'media\.generate\.unavailable': '(.*)',/g)].map((match) => match[1]);

    expect(found).toHaveLength(3);
    for (const sentence of found) expect(sentence.trim().length).toBeGreaterThan(0);
    expect(new Set(found).size).toBe(3);

    // And this module says nothing about images, so there is one wording only.
    const module = read('lib/business-os/llm/aiUnavailableMessages.ts');
    expect(module).not.toMatch(/AI_UNAVAILABLE_IMAGE/);
  });
});
