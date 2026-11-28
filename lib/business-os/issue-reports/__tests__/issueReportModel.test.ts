/**
 * Issue reporting slice 1.1a: the fixed values of a report
 * (BUSINESS_OS_ISSUE_REPORTING_SLICE_1_1_WORKPLAN.md §8; requirement §5.1, §7).
 *
 * The migration text test pins these same values to the CHECK constraints of
 * 20261137_issue_reports.sql. This file pins them to the requirement. 1.1b adds
 * the reference generator tests here.
 *
 * Pure: imports constants only. No database, no network.
 */

import {
  ISSUE_REPORT_CATEGORY_HINTS,
  ISSUE_REPORT_CLOSED_REASONS,
  ISSUE_REPORT_INITIAL_STATUS,
  ISSUE_REPORT_REFERENCE_ALPHABET,
  ISSUE_REPORT_REFERENCE_LENGTH,
  ISSUE_REPORT_REFERENCE_PATTERN,
  ISSUE_REPORT_REFERENCE_PREFIX,
  ISSUE_REPORT_STATUSES,
} from '@/lib/business-os/issue-reports/issueReportModel';

describe('issue report statuses, hints and closed reasons (requirement §5.1, §7)', () => {
  it('the statuses are exactly §7, in lifecycle order, and a new report starts submitted', () => {
    expect(ISSUE_REPORT_STATUSES).toEqual(['submitted', 'in_review', 'classified', 'actioned', 'resolved', 'closed']);
    expect(ISSUE_REPORT_INITIAL_STATUS).toBe('submitted');
  });

  it('the category hints are the three §5.1 chips', () => {
    expect(ISSUE_REPORT_CATEGORY_HINTS).toEqual(['bug', 'support', 'feature']);
  });

  it('the closed reasons are the three §7 reasons (SA Q7)', () => {
    expect(ISSUE_REPORT_CLOSED_REASONS).toEqual(['duplicate', 'spam', 'no_response']);
  });
});

describe('the reference alphabet and pattern (workplan §3)', () => {
  const sample = (body: string) => `${ISSUE_REPORT_REFERENCE_PREFIX}${body}`;

  it('the alphabet is 32 distinct characters, Crockford base 32, with no I, L, O or U', () => {
    expect(ISSUE_REPORT_REFERENCE_ALPHABET).toHaveLength(32);
    expect(new Set(ISSUE_REPORT_REFERENCE_ALPHABET).size).toBe(32);
    for (const letter of ['I', 'L', 'O', 'U']) expect(ISSUE_REPORT_REFERENCE_ALPHABET).not.toContain(letter);
    expect(ISSUE_REPORT_REFERENCE_ALPHABET).toBe('0123456789ABCDEFGHJKMNPQRSTVWXYZ');
  });

  it('the pattern accepts exactly the alphabet, character by character (non-vacuous over 0-9 and A-Z)', () => {
    const candidates = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    for (const ch of candidates) {
      const ref = sample(ch.repeat(ISSUE_REPORT_REFERENCE_LENGTH));
      expect([ch, ISSUE_REPORT_REFERENCE_PATTERN.test(ref)]).toEqual([ch, ISSUE_REPORT_REFERENCE_ALPHABET.includes(ch)]);
    }
  });

  it('accepts a well-formed reference', () => {
    expect(ISSUE_REPORT_REFERENCE_PATTERN.test('R-7K3M9Q2X')).toBe(true);
    expect(ISSUE_REPORT_REFERENCE_PATTERN.test(sample('00000000'))).toBe(true);
    expect(ISSUE_REPORT_REFERENCE_PATTERN.test(sample('ZZZZZZZZ'))).toBe(true);
  });

  it.each([
    ['lower case', 'R-7k3m9q2x'],
    ['7 characters', 'R-7K3M9Q2'],
    ['9 characters', 'R-7K3M9Q2XA'],
    ['a forbidden letter (I)', 'R-7K3M9Q2I'],
    ['a forbidden letter (U)', 'R-U7K3M9Q2'],
    ['no prefix', '7K3M9Q2XAB'],
    ['a lower-case prefix', 'r-7K3M9Q2X'],
    ['a space', 'R-7K3M 9Q2'],
    ['trailing text', 'R-7K3M9Q2X '],
  ])('rejects %s', (_name, ref) => {
    expect(ISSUE_REPORT_REFERENCE_PATTERN.test(ref)).toBe(false);
  });
});
