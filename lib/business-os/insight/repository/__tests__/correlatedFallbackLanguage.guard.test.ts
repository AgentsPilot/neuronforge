/**
 * A correlated card must never put English prose in front of a Hebrew or
 * Spanish owner.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A GUARD AND NOT A CODE REVIEW
 *
 * `patterns.ts` holds `storyTemplate`, `patternName` and `actionTemplate` as
 * hardcoded English, and `generateCorrelatedContentFallback` is the only thing
 * standing between those strings and the card. Three separate leaks had opened
 * in it, each invisible to a reader of either file alone:
 *
 *   1. the Hebrew `funnel_breakdown` story interpolated
 *      `${correlatedInsight.story}` — a Hebrew sentence with an English one
 *      welded onto the end;
 *   2. the Hebrew default was `patternStories[id] || correlatedInsight.story`,
 *      so every pattern added to `patterns.ts` without a matching Hebrew line
 *      leaked — and the two files are always edited separately;
 *   3. there was no Spanish branch at all.
 *
 * And on the LLM path, `parsed.story || correlatedInsight.story` leaked
 * whenever the model returned well-formed JSON with a field missing, which a
 * `JSON.parse` cannot catch.
 *
 * This asserts on SOURCE rather than behaviour because the leak is a shape in
 * the code, not a value: any reappearance of `|| correlatedInsight.story` is
 * the bug, whatever it computes to.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const SOURCE = readFileSync(join(__dirname, '..', 'InsightRepository.ts'), 'utf8');
const PATTERNS = readFileSync(
  join(__dirname, '..', '..', 'correlation', 'patterns.ts'),
  'utf8'
);

/** The fallback function's body, which is the only place that matters here. */
function fallbackBody(): string {
  const start = SOURCE.indexOf('private generateCorrelatedContentFallback');
  expect(start).toBeGreaterThan(-1);
  const end = SOURCE.indexOf('\n  }', SOURCE.indexOf('// English fallback', start));
  return SOURCE.slice(start, end);
}

describe('the English template never becomes a localised story', () => {
  it('no language branch falls back to `correlatedInsight.story`', () => {
    /*
     * The English branch legitimately returns it — it IS the English text.
     * Every other use inside the fallback is a leak, so this counts the uses
     * before the English branch begins.
     */
    const body = fallbackBody();
    const englishStarts = body.indexOf('// English fallback');
    const beforeEnglish = body.slice(0, englishStarts);

    const leaks = beforeEnglish
      .split('\n')
      // Comments explain the rule and must not be mistaken for a breach.
      .filter(line => !line.trim().startsWith('*') && !line.trim().startsWith('//'))
      .filter(line => line.includes('correlatedInsight.story'));

    expect(leaks).toEqual([]);
  });

  it('the LLM path fills a missing field from the localised fallback', () => {
    // `parsed.story || correlatedInsight.story` was the leak; the replacement
    // reuses the per-language fallback.
    expect(SOURCE).toContain('story: parsed.story || localised.story');
    expect(SOURCE).not.toContain('story: parsed.story || correlatedInsight.story');
  });
});

describe('every language the platform narrates in has a branch', () => {
  /*
   * `he` and `es` need their own; English is the final return. If a fourth
   * language is added to the narration prompt's `languageNames`, this fails —
   * which is the point, because the fallback is the path nobody tests by hand.
   */
  it.each(['he', 'es'])('has a `%s` branch in the fallback', lang => {
    expect(fallbackBody()).toContain(`language === '${lang}'`);
  });

  it('covers every language the LLM prompt claims to write', () => {
    // Deduped: the language map appears in more than one narration call.
    const declared = new Set(
      [...SOURCE.matchAll(/^\s+(en|he|es): '(?:English|Hebrew|Spanish)',$/gm)].map(m => m[1])
    );

    expect([...declared].sort()).toEqual(['en', 'es', 'he']);
  });
});

describe('every pattern has copy in every language', () => {
  /** Pattern ids as `patterns.ts` declares them. */
  const patternIds = [...PATTERNS.matchAll(/^\s{4}id: '([a-z_]+)',$/gm)].map(m => m[1]);

  it('found the patterns to check against', () => {
    expect(patternIds.length).toBeGreaterThanOrEqual(10);
  });

  /*
   * A pattern missing a line in a language map no longer leaks English — the
   * defaults are localised now — but it does fall to a generic sentence, which
   * is a quiet loss of specificity. Named here so adding a pattern means
   * adding its copy, deliberately.
   */
  it.each(patternIds)('%s has Hebrew and Spanish copy', id => {
    const body = fallbackBody();
    const occurrences = body.split(`${id}:`).length - 1;

    // Two titles and two stories per pattern: he + es (English is separate).
    expect(occurrences).toBeGreaterThanOrEqual(4);
  });
});
