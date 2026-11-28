/**
 * Issue reporting slice 1.1a: the fixed values of a report
 * (BUSINESS_OS_ISSUE_REPORTING_SLICE_1_1_WORKPLAN.md §8; requirement §5.1, §7).
 *
 * The migration text test pins these same values to the CHECK constraints of
 * 20261137_issue_reports.sql. This file pins them to the requirement. Slice
 * 1.1b adds the reference generator tests (workplan §3, SA RC-7).
 *
 * Pure: no database, no network. The one file read is the model's own source.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  defaultIssueReportRandomBytes,
  generateIssueReportReference,
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

describe('generateIssueReportReference (slice 1.1b, workplan §3, SA RC-7)', () => {
  const fixed = (values: number[]) => (count: number) => {
    expect(count).toBe(ISSUE_REPORT_REFERENCE_LENGTH);
    return Uint8Array.from(values);
  };

  it('gives R- plus 8 characters of the alphabet, matching the DB CHECK pattern', () => {
    for (let i = 0; i < 200; i += 1) {
      const ref = generateIssueReportReference();
      expect(ref).toHaveLength(ISSUE_REPORT_REFERENCE_PREFIX.length + ISSUE_REPORT_REFERENCE_LENGTH);
      expect(ref.startsWith(ISSUE_REPORT_REFERENCE_PREFIX)).toBe(true);
      for (const ch of ref.slice(ISSUE_REPORT_REFERENCE_PREFIX.length)) expect(ISSUE_REPORT_REFERENCE_ALPHABET).toContain(ch);
      expect(ISSUE_REPORT_REFERENCE_PATTERN.test(ref)).toBe(true);
    }
  });

  it('is deterministic with an injected byte source: bytes map through their low 5 bits', () => {
    // 0 -> '0', 31 -> 'Z', 32 -> '0' (wraps), 255 -> 'Z', 10 -> 'A', 18 -> 'J' (I skipped), 27 -> 'V' (U skipped), 1 -> '1'
    expect(generateIssueReportReference(fixed([0, 31, 32, 255, 10, 18, 27, 1]))).toBe('R-0Z0ZAJV1');
    expect(generateIssueReportReference(fixed([0, 0, 0, 0, 0, 0, 0, 0]))).toBe('R-00000000');
    expect(generateIssueReportReference(fixed([31, 63, 95, 127, 159, 191, 223, 255]))).toBe('R-ZZZZZZZZ');
  });

  it('every byte value 0..255 maps to the alphabet with no bias (each character exactly 8 times)', () => {
    const counts = new Map<string, number>();
    for (let start = 0; start < 256; start += ISSUE_REPORT_REFERENCE_LENGTH) {
      const values = Array.from({ length: ISSUE_REPORT_REFERENCE_LENGTH }, (_v, k) => start + k);
      const body = generateIssueReportReference(fixed(values)).slice(ISSUE_REPORT_REFERENCE_PREFIX.length);
      for (const ch of body) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    expect(counts.size).toBe(32);
    for (const ch of ISSUE_REPORT_REFERENCE_ALPHABET) expect(counts.get(ch)).toBe(8);
  });

  it('throws when the byte source returns too few bytes', () => {
    expect(() => generateIssueReportReference(() => new Uint8Array(7))).toThrow(/too few bytes/);
  });

  it('the default byte source is Web Crypto getRandomValues, asked for 8 bytes', () => {
    const spy = jest.spyOn(globalThis.crypto, 'getRandomValues');
    try {
      const ref = generateIssueReportReference();
      expect(ISSUE_REPORT_REFERENCE_PATTERN.test(ref)).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);
      const arg = spy.mock.calls[0][0] as Uint8Array;
      expect(arg).toBeInstanceOf(Uint8Array);
      expect(arg).toHaveLength(ISSUE_REPORT_REFERENCE_LENGTH);
      expect(defaultIssueReportRandomBytes(ISSUE_REPORT_REFERENCE_LENGTH)).toHaveLength(ISSUE_REPORT_REFERENCE_LENGTH);
    } finally {
      spy.mockRestore();
    }
  });

  it('the model module imports nothing (no Node crypto; client-safe for 1.5)', () => {
    const source = readFileSync(join(__dirname, '..', 'issueReportModel.ts'), 'utf8');
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/require\(/);
    expect(source).toContain('globalThis.crypto.getRandomValues');
  });
});
