/**
 * DE-8b T-2 (workplan §10): the ceiling arithmetic. Exactly at a ceiling is
 * inside it, one over is over, for each of the five; `pct` is the highest
 * ratio; 60% is "near".
 */
import { ceilingUse, filesCeilingUse, isNearCeiling, CEILING_KEYS, type CeilingKey } from '../ceiling';
import { EXPORT_LIMITS } from '../limits';

const CEILING: Record<CeilingKey, number> = {
  fileBytes: EXPORT_LIMITS.FILE_BYTES_CEILING,
  fileCount: EXPORT_LIMITS.FILE_COUNT_CEILING,
  rows: EXPORT_LIMITS.ROW_CEILING,
  zipBytes: EXPORT_LIMITS.ZIP_BYTES_CEILING,
  buildMs: EXPORT_LIMITS.BUILD_MS_CEILING,
};

describe('the Phase 1 constants (§0.4.1 C)', () => {
  it('are 40 MiB, 150 files, 100,000 rows, 45 MiB, 40 s, 60%', () => {
    expect(EXPORT_LIMITS.FILE_BYTES_CEILING).toBe(40 * 1024 * 1024);
    expect(EXPORT_LIMITS.FILE_COUNT_CEILING).toBe(150);
    expect(EXPORT_LIMITS.ROW_CEILING).toBe(100_000);
    expect(EXPORT_LIMITS.ZIP_BYTES_CEILING).toBe(45 * 1024 * 1024);
    expect(EXPORT_LIMITS.BUILD_MS_CEILING).toBe(40_000);
    expect(EXPORT_LIMITS.NEAR_CEILING_RATIO).toBe(0.6);
  });

  it('the zip ceiling sits under the bucket upload limit', () => {
    expect(EXPORT_LIMITS.ZIP_BYTES_CEILING).toBeLessThan(52_428_800);
  });
});

describe.each(CEILING_KEYS.map((key) => [key] as const))('%s', (key) => {
  it('exactly at the ceiling is inside it (100%)', () => {
    expect(ceilingUse({ [key]: CEILING[key] })).toEqual({ pct: 100, over: [] });
  });

  it('one over is over', () => {
    expect(ceilingUse({ [key]: CEILING[key] + 1 }).over).toEqual([key]);
  });
});

describe('pct and near', () => {
  it('pct is the highest of the ratios', () => {
    const use = ceilingUse({ fileBytes: CEILING.fileBytes * 0.2, fileCount: 90, rows: 1_000 });
    expect(use.pct).toBe(60);
    expect(use.over).toEqual([]);
  });

  it('60% is near, 59% is not (the boundary)', () => {
    expect(isNearCeiling(filesCeilingUse(0, 90))).toBe(true);
    expect(isNearCeiling(filesCeilingUse(0, 88))).toBe(false);
  });

  it('nothing measured is 0%, and junk values are ignored', () => {
    expect(ceilingUse({})).toEqual({ pct: 0, over: [] });
    expect(ceilingUse({ fileBytes: Number.NaN, rows: -5 })).toEqual({ pct: 0, over: [] });
  });

  it('over lists every measure over its ceiling, in fixed order', () => {
    expect(ceilingUse({ buildMs: CEILING.buildMs + 1, fileCount: 151 }).over).toEqual(['fileCount', 'buildMs']);
  });
});
