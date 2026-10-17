// lib/business-os/data-export/ceiling.ts
//
// DE-8b (BUSINESS_OS_DATA_EXPORT_DE8B_WORKPLAN.md §10; requirement §0.4.1 C):
// how much of the Phase 1 ceilings one export uses. PURE: no I/O, no clock.
//
// Five measures, five ceilings (limits.ts). `pct` is the highest of the five
// ratios as a whole percent, so one number says how close the account is.
// Exactly at a ceiling is inside it; one over is over.

import { EXPORT_LIMITS } from '@/lib/business-os/data-export/limits';

export interface CeilingMeasure {
  /** Bytes of the owner's files (listing sizes before download, real bytes after). */
  fileBytes: number;
  fileCount: number;
  /** Rows across every section. */
  rows: number;
  /** Bytes of the finished zip. */
  zipBytes: number;
  /** Milliseconds since the request started. */
  buildMs: number;
}

export type CeilingKey = keyof CeilingMeasure;

export const CEILING_KEYS: readonly CeilingKey[] = ['fileBytes', 'fileCount', 'rows', 'zipBytes', 'buildMs'];

export interface CeilingUse {
  /** The highest ratio, as an integer percent (0 when nothing is measured). */
  pct: number;
  /** The measures over their ceiling, in CEILING_KEYS order. */
  over: CeilingKey[];
}

function ceilingOf(key: CeilingKey): number {
  // Read at call time so a test can lower one (limits.ts).
  switch (key) {
    case 'fileBytes':
      return EXPORT_LIMITS.FILE_BYTES_CEILING;
    case 'fileCount':
      return EXPORT_LIMITS.FILE_COUNT_CEILING;
    case 'rows':
      return EXPORT_LIMITS.ROW_CEILING;
    case 'zipBytes':
      return EXPORT_LIMITS.ZIP_BYTES_CEILING;
    case 'buildMs':
      return EXPORT_LIMITS.BUILD_MS_CEILING;
  }
}

/** A missing or non-finite measure is not measured (0). */
export function ceilingUse(measure: Partial<CeilingMeasure>): CeilingUse {
  let highest = 0;
  const over: CeilingKey[] = [];
  for (const key of CEILING_KEYS) {
    const value = measure[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
    const ceiling = ceilingOf(key);
    const ratio = value / ceiling;
    if (ratio > highest) highest = ratio;
    if (value > ceiling) over.push(key);
  }
  return { pct: Math.round(highest * 100), over };
}

/** At or over NEAR_CEILING_RATIO (60%), on the unrounded ratio's percent. */
export function isNearCeiling(use: CeilingUse): boolean {
  return use.pct >= Math.round(EXPORT_LIMITS.NEAR_CEILING_RATIO * 100);
}

/** The files part of a measure only: the cron's size watch (records are not watched, §0.4.1 C). */
export function filesCeilingUse(fileBytes: number, fileCount: number): CeilingUse {
  return ceilingUse({ fileBytes, fileCount });
}
