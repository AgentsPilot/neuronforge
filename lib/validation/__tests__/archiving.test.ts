/**
 * Archiving Zod schemas (FR-2, the schema half of AC-3): U-V1 to U-V5; the
 * Slice 2b run request: V-1, V-2.
 */

import { RETENTION_DAYS_OPTIONS } from '@/lib/archiving/config';
import { archiveRunRequestSchema, archiveSourceKeySchema, retentionDaysSchema } from '../archiving';

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

describe('archiveRunRequestSchema (Slice 2b)', () => {
  const RUN_ID = '33333333-3333-4333-8333-333333333333';
  const START = { action: 'start', source: 'audit_trail', retentionDays: 365 };

  it.each(RETENTION_DAYS_OPTIONS)('V-1: accepts a start at %p days', (retentionDays) => {
    expect(archiveRunRequestSchema.safeParse({ ...START, retentionDays }).success).toBe(true);
  });

  it('V-1: accepts a continue naming a run id', () => {
    const result = archiveRunRequestSchema.safeParse({ action: 'continue', runId: RUN_ID });
    expect(result.success && result.data).toEqual({ action: 'continue', runId: RUN_ID });
  });

  it.each([
    ['retentionDays 30', { ...START, retentionDays: 30 }],
    ['retentionDays as a string', { ...START, retentionDays: '365' }],
    ['retentionDays missing', { action: 'start', source: 'audit_trail' }],
    ['an unknown source', { ...START, source: 'agent_logs' }],
    ['action missing', { source: 'audit_trail', retentionDays: 365 }],
    ['an unknown action', { ...START, action: 'purge' }],
    ['a runId that is not a uuid', { action: 'continue', runId: 'run-1' }],
    ['a start carrying a runId', { ...START, runId: RUN_ID }],
    ['an injected cutoff', { ...START, cutoff: '2020-01-01T00:00:00.000Z' }],
    ['an injected startedBy', { ...START, startedBy: RUN_ID }],
    ['an injected status', { ...START, status: 'succeeded' }],
    ['an injected batchSize', { ...START, batchSize: 5000 }],
    ['a continue carrying a cutoff', { action: 'continue', runId: RUN_ID, cutoff: '2020-01-01T00:00:00.000Z' }],
    ['null', null],
  ])('V-2: rejects %s', (_label, body) => {
    expect(archiveRunRequestSchema.safeParse(body).success).toBe(false);
  });
});
