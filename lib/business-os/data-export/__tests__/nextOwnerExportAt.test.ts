/**
 * Module export MX-4b (workplan §5.2 N-1, §12.2 T-14; SA C-5): the arithmetic
 * of "you can export again at {time}" on open. The SQL side (the start
 * function's predicate and OFFSET) is pinned against these helpers in
 * supabase/migrations/__tests__/business-os-export-requests.migration.test.ts.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { MODULE_EXPORT_POLICY } from '@/lib/business-os/data-export/moduleExportPolicy';
import {
  adminLimitAnchorOffset,
  nextOwnerExportAt,
  ownerLimitAnchorOffset,
  ownerLimitWindowStart,
} from '@/lib/business-os/data-export/nextOwnerExportAt';

describe('adminLimitAnchorOffset (MX-5 T-R5)', () => {
  it('is ADMIN_DAILY_LIMIT_PER_OWNER - 1 = 1, and follows the policy', () => {
    expect(adminLimitAnchorOffset()).toBe(MODULE_EXPORT_POLICY.ADMIN_DAILY_LIMIT_PER_OWNER - 1);
    expect(adminLimitAnchorOffset()).toBe(1);
    expect(adminLimitAnchorOffset({ ADMIN_DAILY_LIMIT_PER_OWNER: 3 })).toBe(2);
  });
});

describe('ownerLimitAnchorOffset (T-14: the OFFSET pin)', () => {
  it('is OWNER_DAILY_LIMIT - 1: the limit-th newest counted request is the anchor', () => {
    expect(ownerLimitAnchorOffset()).toBe(MODULE_EXPORT_POLICY.OWNER_DAILY_LIMIT - 1);
    expect(ownerLimitAnchorOffset()).toBe(1);
  });

  it('follows the policy, so a changed limit moves the offset with it', () => {
    expect(ownerLimitAnchorOffset({ OWNER_DAILY_LIMIT: 5, DAILY_WINDOW_HOURS: 24 })).toBe(4);
    expect(ownerLimitAnchorOffset({ OWNER_DAILY_LIMIT: 1, DAILY_WINDOW_HOURS: 24 })).toBe(0);
  });
});

describe('ownerLimitWindowStart', () => {
  it('is now minus DAILY_WINDOW_HOURS, in ISO', () => {
    const now = Date.parse('2026-11-02T12:00:00.000Z');
    expect(ownerLimitWindowStart(now)).toBe('2026-11-01T12:00:00.000Z');
    expect(ownerLimitWindowStart(now, { OWNER_DAILY_LIMIT: 2, DAILY_WINDOW_HOURS: 6 })).toBe('2026-11-02T06:00:00.000Z');
  });
});

describe('nextOwnerExportAt (T-14)', () => {
  it('no anchor (under the limit) is null', () => {
    expect(nextOwnerExportAt(null)).toBeNull();
  });

  it('an anchor is its requested_at plus the window', () => {
    expect(nextOwnerExportAt('2026-11-01T17:35:52.018+00:00')).toBe('2026-11-02T17:35:52.018Z');
    expect(nextOwnerExportAt('2026-11-01T17:35:52Z')).toBe('2026-11-02T17:35:52.000Z');
    expect(nextOwnerExportAt('2026-11-01 19:35:52.5+02:00')).toBe('2026-11-02T17:35:52.500Z');
  });

  it('a fraction finer than a millisecond rounds up, never early; zero microseconds do not', () => {
    expect(nextOwnerExportAt('2026-11-01T17:35:52.018123+00:00')).toBe('2026-11-02T17:35:52.019Z');
    expect(nextOwnerExportAt('2026-11-01T17:35:52.018000+00:00')).toBe('2026-11-02T17:35:52.018Z');
  });

  it('uses the policy window', () => {
    expect(nextOwnerExportAt('2026-11-01T00:00:00.000Z', { OWNER_DAILY_LIMIT: 2, DAILY_WINDOW_HOURS: 1 })).toBe('2026-11-01T01:00:00.000Z');
  });

  it('an anchor that does not parse is null, never a wrong time', () => {
    expect(nextOwnerExportAt('not a time')).toBeNull();
    expect(nextOwnerExportAt('')).toBeNull();
  });

  it('the file is pure: no I/O, no clock of its own', () => {
    const source = readFileSync(join(process.cwd(), 'lib', 'business-os', 'data-export', 'nextOwnerExportAt.ts'), 'utf8');
    const imports = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
    expect(imports).toEqual(['@/lib/business-os/data-export/moduleExportPolicy']);
    expect(source).not.toMatch(/Date[.]now|new Date[(][)]|console[.]/);
  });
});
