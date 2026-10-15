/**
 * What the contact search understands, and what it refuses to guess.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The vocabulary is read off the live schema: `stage`, `source`, `tags` and
 * `created_at` carry values on real accounts, `has:`/`no:` covers an email, a
 * phone, a booking or an open task, and `in-stage:` measures
 * `stage_entered_at`. `utm_source`, `utm_medium` and `utm_campaign` are absent
 * on purpose — null across every row, and a filter that can only match nothing
 * is worse than no filter.
 *
 * The dates are deliberately NOT parsed by this module. "this month" means what
 * it means on the orders page because the orders parser is what reads it, and
 * these tests pin that: a second implementation would be a second answer to
 * "which days are in this month".
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { parseContactSearch, removeContactTerm } from '../contactSearchTerms';

/** A fixed "today", so a period term is the same every run. */
const TODAY = '2026-10-13';

describe('reading the four fields', () => {
  it('reads a stage', () => {
    expect(parseContactSearch('stage:lead', TODAY)).toEqual([
      { kind: 'stage', value: 'lead', raw: 'stage:lead' },
    ]);
  });

  it('reads a source', () => {
    expect(parseContactSearch('source:instagram', TODAY)).toEqual([
      { kind: 'source', value: 'instagram', raw: 'source:instagram' },
    ]);
  });

  it('reads a quoted tag as ONE tag', () => {
    // The tags on the reporting account have spaces: "Champion client".
    expect(parseContactSearch('tag:"Champion client"', TODAY)).toEqual([
      { kind: 'tag', value: 'champion client', raw: 'tag:"Champion client"' },
    ]);
  });

  it('reads the prefixes in Hebrew and Spanish too', () => {
    // An owner reading a Hebrew interface types Hebrew.
    expect(parseContactSearch('שלב:lead', TODAY)[0]).toMatchObject({ kind: 'stage', value: 'lead' });
    expect(parseContactSearch('origen:website', TODAY)[0]).toMatchObject({
      kind: 'source',
      value: 'website',
    });
  });

  it('keeps a name as text', () => {
    expect(parseContactSearch('dana', TODAY)).toEqual([
      { kind: 'text', value: 'dana', raw: 'dana' },
    ]);
  });

  it('reads several at once', () => {
    const terms = parseContactSearch('stage:lead source:instagram dana', TODAY);
    expect(terms.map(term => term.kind).sort()).toEqual(['source', 'stage', 'text']);
  });
});

describe('what it refuses to guess', () => {
  it('leaves a bare number as text, not an amount', () => {
    /*
     * The orders parser would read ">500" as a sum. Against a contact a number
     * is a phone number or part of a name far more often, and a filter nobody
     * asked for is worse than a word that matches nothing.
     */
    const terms = parseContactSearch('0501234567', TODAY);
    expect(terms).toHaveLength(1);
    expect(terms[0].kind).toBe('text');
  });

  it('leaves a half-typed prefix alone', () => {
    // Somebody mid-keystroke, not a filter for the empty stage.
    expect(parseContactSearch('stage:', TODAY)[0].kind).toBe('text');
  });

  it('leaves an unknown prefix as text', () => {
    expect(parseContactSearch('colour:red', TODAY)[0].kind).toBe('text');
  });

  it('is empty for an empty box', () => {
    expect(parseContactSearch('', TODAY)).toEqual([]);
    expect(parseContactSearch('   ', TODAY)).toEqual([]);
  });
});

describe('the dates come from the orders parser', () => {
  it('reads a period, with both ends on the business clock', () => {
    const terms = parseContactSearch('september', TODAY);
    expect(terms).toHaveLength(1);
    expect(terms[0]).toMatchObject({ kind: 'period', from: '2026-09-01', to: '2026-09-30' });
  });

  it('reads a relative period', () => {
    const terms = parseContactSearch('this month', TODAY);
    expect(terms[0]).toMatchObject({ kind: 'period', from: '2026-10-01', to: '2026-10-31' });
  });

  it('reads a period beside a prefixed filter', () => {
    const terms = parseContactSearch('stage:lead september', TODAY);
    expect(terms.map(t => t.kind).sort()).toEqual(['period', 'stage']);
  });
});

describe('removing a chip edits the string', () => {
  it('takes out exactly what the chip came from', () => {
    const input = 'stage:lead source:instagram dana';
    const terms = parseContactSearch(input, TODAY);
    const stage = terms.find(term => term.kind === 'stage')!;

    expect(removeContactTerm(input, stage)).toBe('source:instagram dana');
  });

  it('takes out a quoted tag whole', () => {
    const input = 'tag:"Champion client" dana';
    const terms = parseContactSearch(input, TODAY);
    const tag = terms.find(term => term.kind === 'tag')!;

    expect(removeContactTerm(input, tag)).toBe('dana');
  });

  it('leaves the string alone when the chip is not in it', () => {
    expect(removeContactTerm('dana', { kind: 'stage', value: 'lead', raw: 'stage:lead' })).toBe(
      'dana'
    );
  });
});

describe('what they have, and have not', () => {
  it('reads has: and no: for each of the four', () => {
    for (const field of ['email', 'phone', 'bookings', 'tasks']) {
      expect(parseContactSearch(`has:${field}`, TODAY)[0]).toMatchObject({
        kind: 'has',
        field,
        present: true,
      });
      expect(parseContactSearch(`no:${field}`, TODAY)[0]).toMatchObject({
        kind: 'has',
        field,
        present: false,
      });
    }
  });

  it('reads them in Hebrew and Spanish', () => {
    expect(parseContactSearch('אין:אימייל', TODAY)[0]).toMatchObject({
      kind: 'has',
      field: 'email',
      present: false,
    });
    expect(parseContactSearch('sin:reservas', TODAY)[0]).toMatchObject({
      kind: 'has',
      field: 'bookings',
      present: false,
    });
  });

  it('leaves a field it does not have as TEXT', () => {
    /*
     * "has:budget" is somebody guessing at a filter that does not exist.
     * Inventing one that matches everything would be worse than searching for
     * the words — the screen would look filtered and would not be.
     */
    expect(parseContactSearch('has:budget', TODAY)[0].kind).toBe('text');
  });
});

describe('how long they have sat there', () => {
  it('reads days, with or without the d', () => {
    expect(parseContactSearch('in-stage:30d', TODAY)[0]).toMatchObject({ kind: 'in_stage', days: 30 });
    expect(parseContactSearch('in-stage:7', TODAY)[0]).toMatchObject({ kind: 'in_stage', days: 7 });
  });

  it('refuses nonsense rather than inventing a window', () => {
    expect(parseContactSearch('in-stage:soon', TODAY)[0].kind).toBe('text');
    expect(parseContactSearch('in-stage:0', TODAY)[0].kind).toBe('text');
    expect(parseContactSearch('in-stage:-5', TODAY)[0].kind).toBe('text');
  });

  it('is a different question from when they were added', () => {
    // "stuck in lead for a month" and "added a month ago" are not the same
    // people, and the box can ask both at once.
    const terms = parseContactSearch('in-stage:30d this month', TODAY);
    expect(terms.map(term => term.kind).sort()).toEqual(['in_stage', 'period']);
  });
});
