/**
 * Archiving Zod schemas (FR-2, the schema half of AC-3): U-V1 to U-V5.
 */

import { RETENTION_DAYS_OPTIONS } from '@/lib/archiving/config';
import { archiveSourceKeySchema, retentionDaysSchema } from '../archiving';

describe('retentionDaysSchema', () => {
  it.each([365, 180, 90])('U-V1: accepts %p and returns the same number', (value) => {
    const result = retentionDaysSchema.safeParse(value);
    expect(result.success).toBe(true);
    expect(result.success && result.data).toBe(value);
  });

  it.each([30, 366, 0, -90, 90.5, NaN, Infinity])('U-V2: rejects the number %p', (value) => {
    expect(retentionDaysSchema.safeParse(value).success).toBe(false);
  });

  it.each(['365', null, undefined, {}, []])('U-V3: rejects the non-number %p (no coercion)', (value) => {
    expect(retentionDaysSchema.safeParse(value).success).toBe(false);
  });

  it('U-V3: says which values are allowed', () => {
    const result = retentionDaysSchema.safeParse(30);
    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0].message).toBe(
      'retentionDays must be one of 365, 180, 90'
    );
  });

  it('U-V4: accepts every option and nothing else between 1 and 400 (drift check)', () => {
    const accepted: number[] = [];
    for (let days = 1; days <= 400; days += 1) {
      if (retentionDaysSchema.safeParse(days).success) accepted.push(days);
    }
    expect(accepted.sort((a, b) => b - a)).toEqual([...RETENTION_DAYS_OPTIONS]);
  });
});

describe('archiveSourceKeySchema', () => {
  it('U-V5: accepts audit_trail', () => {
    expect(archiveSourceKeySchema.parse('audit_trail')).toBe('audit_trail');
  });

  it.each(['token_usage', '', 'AUDIT_TRAIL', null, 1])('U-V5: rejects %p', (value) => {
    expect(archiveSourceKeySchema.safeParse(value).success).toBe(false);
  });
});
