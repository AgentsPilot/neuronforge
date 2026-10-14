/**
 * @jest-environment jsdom
 *
 * `OwnerDirScript`: the owner's `lang`/`dir` on `<html>` before first paint
 * (performance business round BR-1a, SA P-2; workplan §8.2 S-1..S-3).
 *
 * The script is a sibling of `PublicDirScript`, which also switches on the
 * public theme. These tests hold the difference: owner pages get `lang` and
 * `dir`, and nothing else.
 */

import React from 'react';
import { TextEncoder } from 'util';

// jsdom has no TextEncoder, which the browser build of react-dom/server needs;
// use Node's, then load the renderer (a static import would run first).
Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder, configurable: true });
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { renderToStaticMarkup } = require('react-dom/server') as typeof import('react-dom/server');

import { OwnerDirScript } from '@/components/business-os/OwnerDirScript';
import type { OwnerLanguage } from '@/lib/business-os/ownerLanguage';

/** The script body, as the browser would receive it. */
function scriptOf(language: OwnerLanguage): string {
  const markup = renderToStaticMarkup(<OwnerDirScript language={language} />);
  const match = markup.match(/^<script>([\s\S]*)<\/script>$/);
  if (!match) throw new Error(`unexpected markup: ${markup}`);
  return match[1];
}

function run(language: OwnerLanguage): void {
  // The same evaluation the HTML parser performs on an inline script.
  new Function(scriptOf(language))();
}

beforeEach(() => {
  const html = document.documentElement;
  html.setAttribute('lang', 'en');
  html.setAttribute('dir', 'ltr');
  delete html.dataset.publicSurface;
  html.style.colorScheme = '';
});

describe('sets the document language and direction (S-1)', () => {
  it.each([
    ['he', 'rtl'],
    ['es', 'ltr'],
    ['en', 'ltr'],
  ] as const)('%s → %s', (language, dir) => {
    run(language);
    expect(document.documentElement.lang).toBe(language);
    expect(document.documentElement.dir).toBe(dir);
  });
});

describe('sets nothing else (S-2)', () => {
  it('no public-surface flag and no colour scheme', () => {
    run('he');
    expect(document.documentElement.dataset.publicSurface).toBeUndefined();
    expect(document.documentElement.style.colorScheme).toBe('');
    expect(scriptOf('he')).not.toMatch(/publicSurface|colorScheme|style/);
  });
});

describe('an unexpected value never reaches the page (S-3)', () => {
  it('falls back to English, and cannot close the script tag', () => {
    const hostile = '</script><script>window.__pwned=1</script>' as unknown as OwnerLanguage;
    const markup = renderToStaticMarkup(<OwnerDirScript language={hostile} />);
    expect(markup.match(/<\/script>/g)).toHaveLength(1);
    expect(markup).not.toMatch(/pwned/);

    new Function(markup.replace(/^<script>|<\/script>$/g, ''))();
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
  });
});
