/**
 * A broken agent tells its owner one of four things, in their own language.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE OWNER IS NOT A DEVELOPER, AND EVERY MESSAGE WAS WRITTEN FOR ONE
 *
 * A failure arrived as whatever the layer that broke happened to say, and all
 * four of these were shown verbatim to a business owner, in English, in the
 * middle of a Hebrew dashboard:
 *
 *   Your Gmail connection has expired. Please reconnect in Settings…
 *   Scatter-gather step step2: all 2 items failed. First error: Scatter item 0…
 *   Could not chase that invoice: already chased within 7 days
 *   Non-retryable execution error at step "Scan the mailbox…" (unknown)
 *
 * Translating them one at a time is the wrong fix twice over. The strings are
 * open-ended — every plugin and every step type invents its own — and even
 * translated, "Scatter-gather step step2" tells the person reading it nothing
 * they can act on.
 *
 * There are only four things an owner can DO about a broken agent, so there
 * are four sentences, written once per language.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { failureCategoryOf } from '../install';
import { en } from '@/lib/business-os/translations/en';
import { he } from '@/lib/business-os/translations/he';
import { es } from '@/lib/business-os/translations/es';

const CATEGORIES = ['reconnect', 'busy', 'data', 'unknown'] as const;

describe('every real failure lands in a category', () => {
  it('routes the ones that actually happened on a live account', () => {
    /*
     * These are verbatim from the dashboard, not invented for the test. The
     * first two have codes; the last two are prose, which is the common case —
     * most failures carry no usable code at all.
     */
    expect(failureCategoryOf('auth_failed', 'Your Gmail connection has expired.')).toBe('reconnect');
    expect(failureCategoryOf('api_rate_limit', 'Too many requests.')).toBe('busy');
    expect(
      failureCategoryOf(undefined, 'Your Gmail connection has expired. Please reconnect in Settings')
    ).toBe('reconnect');
    expect(failureCategoryOf(undefined, 'no email address for this invoice')).toBe('data');
  });

  it('refuses to guess, which is the point', () => {
    /*
     * A wrong guess sends an owner to reconnect an app that was never broken,
     * and teaches them the warning means nothing. Anything unrecognised is
     * `unknown` — which blames nobody and asks nothing of them.
     */
    expect(
      failureCategoryOf(undefined, 'Scatter-gather step step2: all 2 items failed')
    ).toBe('unknown');
    expect(
      failureCategoryOf('EXECUTION_ERROR', 'Non-retryable execution error at step "x" (unknown)')
    ).toBe('unknown');
    expect(failureCategoryOf(undefined, '')).toBe('unknown');
  });

  it('never returns anything a dictionary cannot answer', () => {
    const samples = [
      ['auth_failed', ''], ['quota_exceeded', ''], ['not_found', ''],
      [undefined, 'rate limit exceeded'], [undefined, 'something odd'],
      ['insufficient_permissions', ''], [undefined, 'invoice no longer exists'],
    ] as const;

    for (const [code, message] of samples) {
      expect(CATEGORIES).toContain(failureCategoryOf(code, message));
    }
  });
});

describe('each category has words in every language', () => {
  for (const [language, dictionary] of Object.entries({ en, he, es })) {
    it(`${language} answers all four, plus the title`, () => {
      const dict = dictionary as Record<string, string>;

      for (const category of CATEGORIES) {
        const key = `automation.failure.${category}`;
        const said = dict[key];

        expect(`${language}:${category} = ${said ? 'present' : 'MISSING'}`).toBe(
          `${language}:${category} = present`
        );
        /* A real sentence, not a label — this is the whole message an owner
           gets about a broken agent. */
        expect((said ?? '').length).toBeGreaterThan(30);
      }

      expect(dict['automation.failure.title']).toBeTruthy();
    });
  }

  it('says something different in each language', () => {
    /* A guard on the guard: three copies of the English would satisfy
       everything above while leaving the bug exactly where it was. */
    const reconnect = [en, he, es].map(
      d => (d as Record<string, string>)['automation.failure.reconnect']
    );

    expect(new Set(reconnect).size).toBe(3);
  });

  it('tells the owner what to do, not what broke', () => {
    /*
     * The failure of the old messages was not only language. "Scatter-gather
     * step step2" is unactionable in any language, so the sentences are
     * checked for an instruction rather than a diagnosis.
     */
    const dict = en as Record<string, string>;

    expect(dict['automation.failure.reconnect']).toMatch(/reconnect/i);
    expect(dict['automation.failure.busy']).toMatch(/nothing to do|tries again/i);
    expect(dict['automation.failure.unknown']).toMatch(/on us|our side/i);

    /* And none of them leaks our vocabulary at the owner. */
    for (const category of CATEGORIES) {
      const said = dict[`automation.failure.${category}`];
      expect(said).not.toMatch(/scatter|step\d|plugin|token|API|non-retryable/i);
    }
  });
});
