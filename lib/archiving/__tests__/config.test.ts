/**
 * The shared archiving constants (Slice 1, U-C1 to U-C7).
 *
 * The list, the default and the flag are pinned exactly, so changing any of
 * them is a visible test change rather than a silent one.
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  ARCHIVE_RUNS_ENABLED,
  ARCHIVE_RUN_STATUSES,
  ARCHIVE_SOURCES,
  STALE_RUN_AFTER_MS,
  ARCHIVE_SOURCE_KEYS,
  DEFAULT_RETENTION_DAYS,
  RETENTION_DAYS_OPTIONS,
  cutoffFor,
  isRetentionDays,
} from '../config';

const DAY = 86_400_000;

describe('retention options', () => {
  it('U-C1: are exactly 365, 180, 90, in dropdown order', () => {
    expect([...RETENTION_DAYS_OPTIONS]).toEqual([365, 180, 90]);
  });

  it('U-C2: default to 365, which is one of the options', () => {
    expect(DEFAULT_RETENTION_DAYS).toBe(365);
    expect(RETENTION_DAYS_OPTIONS).toContain(DEFAULT_RETENTION_DAYS);
  });

  it.each([365, 180, 90])('U-C3: accepts %p', (value) => {
    expect(isRetentionDays(value)).toBe(true);
  });

  it.each([30, 366, 0, -90, 90.5, NaN, Infinity, '365', null, undefined, {}, []])(
    'U-C3: rejects %p',
    (value) => {
      expect(isRetentionDays(value)).toBe(false);
    }
  );
});

describe('source registry', () => {
  it('U-C4: has one entry, audit_trail, with unique keys and no exclusions field', () => {
    expect(ARCHIVE_SOURCES).toHaveLength(1);
    expect(ARCHIVE_SOURCES[0].key).toBe('audit_trail');
    expect(ARCHIVE_SOURCES[0].label).toBe('Audit trail');
    expect(new Set(ARCHIVE_SOURCE_KEYS).size).toBe(ARCHIVE_SOURCE_KEYS.length);
    expect(ARCHIVE_SOURCE_KEYS).toEqual(['audit_trail']);
    for (const source of ARCHIVE_SOURCES) {
      expect(source).not.toHaveProperty('exclusions');
    }
  });

  it('U-C5: runs stay switched off until Slice 3 (condition C-5)', () => {
    expect(ARCHIVE_RUNS_ENABLED).toBe(false);
  });

  it('Slice 2: each source carries its batch size (1,000, TQ-3) and no database function name', () => {
    expect(ARCHIVE_SOURCES[0].batchSize).toBe(1000);
    for (const source of ARCHIVE_SOURCES) {
      // The function name lives in the server-only repository (SA Q-6).
      expect(JSON.stringify(source)).not.toMatch(/archive_.*_batch/);
    }
  });
});

describe('runs (Slice 2)', () => {
  it('statuses are exactly the four the archive_runs CHECK allows, in order', () => {
    expect([...ARCHIVE_RUN_STATUSES]).toEqual(['running', 'succeeded', 'partial', 'failed']);
  });

  it('a run is stale after five minutes of silence, well past the 60 s route limit', () => {
    expect(STALE_RUN_AFTER_MS).toBe(300_000);
  });
});

describe('cutoffFor', () => {
  const now = new Date('2026-09-26T12:34:56.789Z');

  it.each([365, 180, 90] as const)('U-C6: is now minus %p days, in UTC milliseconds', (days) => {
    expect(cutoffFor(days, now).getTime()).toBe(now.getTime() - days * DAY);
  });

  it('U-C6: does not mutate now', () => {
    const before = now.getTime();
    cutoffFor(365, now);
    expect(now.getTime()).toBe(before);
  });
});

describe('client safety (U-C7)', () => {
  const read = (file: string) =>
    fs.readFileSync(path.join(process.cwd(), 'lib/archiving', file), 'utf8');
  const importsOf = (source: string) =>
    [...source.matchAll(/^\s*import\s+(type\s+)?[\s\S]*?from\s+['"]([^'"]+)['"]/gm)].map(
      (match) => ({ typeOnly: Boolean(match[1]), specifier: match[2] })
    );

  it('config.ts imports nothing, so the client page cannot drag a server module in', () => {
    const source = read('config.ts');
    expect(importsOf(source)).toEqual([]);
    expect(source).not.toMatch(/\brequire\s*\(/);
  });

  it('types.ts only imports types, and only from config.ts', () => {
    const imports = importsOf(read('types.ts'));
    expect(imports.length).toBeGreaterThan(0);
    for (const entry of imports) {
      expect(entry).toEqual({ typeOnly: true, specifier: './config' });
    }
  });
});
