/**
 * `{= ... }` in a rendered sentence.
 *
 * The evaluator is tested on its own; this is about the seam — that a formula
 * resolves against real step results, formats as the sentence needs it, and
 * that an uncertain one takes the whole answer to the fallback rather than
 * leaving a gap where a number should be.
 */

import { renderAnswer } from '../render/AnswerRenderer';
import type { QueryResult } from '../types';

const compute = (value: number | null): QueryResult =>
  ({ op: 'compute', entity: 'transactions', agg: { fn: 'sum', field: 'amount' }, value, approximate: false }) as QueryResult;

const steps = [{ id: 's1' }, { id: 's2' }];
const ctx = { language: 'en', currency: 'USD' };

// The live figures this was designed against: refunds 523.00, net revenue 408.33.
const results = [compute(523), compute(408.33)];

const render = (text: string, rs: QueryResult[] = results) =>
  renderAnswer(text, steps, rs, ctx).text;

describe('a formula in a sentence', () => {
  it('computes a ratio as a percentage', () => {
    expect(render('Refunds are {=% s1.value / s2.value } of revenue')).toBe(
      'Refunds are 128% of revenue'
    );
  });

  it('computes the percentage CHANGE that percent_of cannot express', () => {
    // (s2 - s1) / s2 — the "how much did revenue drop" shape.
    expect(render('Revenue moved {=% (s2.value - s1.value) / s2.value }')).toContain('-28');
  });

  it('computes a money difference', () => {
    expect(render('Down {=$ s1.value - s2.value }')).toBe('Down $114.67');
  });

  it('computes a plain number', () => {
    expect(render('{= s1.value / s2.value }')).toBe('1.28');
  });
});

describe('agreeing with the path it replaces', () => {
  it('matches percent_of for the same inputs', () => {
    /*
     * Ties the new path to the one already trusted. If these ever diverge, one
     * of them is wrong and this says so before a user sees it.
     */
    const viaNamedPath = render('{s1.percent_of.s2}');
    const viaExpression = render('{=% s1.value / s2.value }');

    expect(viaExpression).toBe(viaNamedPath);
  });
});

describe('when it cannot be sure', () => {
  it('falls back rather than printing a gap', () => {
    // A step with no value: the sentence must not render "Refunds are  of revenue".
    const output = render('Refunds are {=% s1.value / s2.value } of revenue', [
      compute(523),
      compute(null),
    ]);

    expect(output).not.toContain('Refunds are  of');
    expect(output).not.toMatch(/NaN|Infinity|null/);
  });

  it('falls back on division by zero', () => {
    const output = render('Refunds are {=% s1.value / s2.value } of revenue', [
      compute(523),
      compute(0),
    ]);

    expect(output).not.toMatch(/NaN|Infinity|%/);
  });

  it('never renders the formula itself to the user', () => {
    const output = render('Nonsense {= s1.value ** 2 } here', results);
    expect(output).not.toContain('s1.value');
    expect(output).not.toContain('**');
  });
});
