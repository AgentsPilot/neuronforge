/**
 * The Health rule config's invariants (admin reorganisation slice 4, U-1,
 * SA C-10, C-11, C-19, C-20, C-22). Reads HEALTH_RULES; repeats no literal from
 * it, so editing a value or a description (a data edit) needs no test edit.
 */

import * as fs from 'fs';
import * as path from 'path';

import { HEALTH_RULES, METRIC_LABELS, FLAG_LABELS, TILE_VOCABULARY, type MeasuredTileId } from '../rules';
import { validateRuleList } from '../evaluateHealth';

const TILES = Object.keys(HEALTH_RULES) as MeasuredTileId[];

describe('HEALTH_RULES', () => {
  it('has a rule list for every measured tile, and none for the not-measured ones', () => {
    expect([...TILES].sort()).toEqual(
      ['bos_ai_failures', 'bos_ai_settings', 'bos_ai_spend', 'critical_audit', 'entitlements_mode'].sort()
    );
    expect(Object.keys(HEALTH_RULES)).not.toContain('scheduled_jobs');
    expect(Object.keys(HEALTH_RULES)).not.toContain('queues');
  });

  it.each(TILES)('%s: the list is non-empty', (tile) => {
    expect(HEALTH_RULES[tile].length).toBeGreaterThan(0);
  });

  it.each(TILES)('%s: passes the same checks the evaluator runs at runtime (C-20)', (tile) => {
    expect(validateRuleList(tile, HEALTH_RULES[tile])).toBeNull();
  });

  it.each(TILES)('%s: every rule has a non-empty description that never says "OK" (C-22)', (tile) => {
    for (const rule of HEALTH_RULES[tile]) {
      expect(rule.description.trim().length).toBeGreaterThan(0);
      expect(rule.description).not.toMatch(/\bOK\b/);
    }
  });

  it.each(TILES)('%s: priorities are unique and the list is in ascending priority order', (tile) => {
    const priorities = HEALTH_RULES[tile].map((rule) => rule.priority);
    expect(new Set(priorities).size).toBe(priorities.length);
    expect([...priorities].sort((a, b) => a - b)).toEqual(priorities);
  });

  it('rule ids are unique across all tiles', () => {
    const ids = TILES.flatMap((tile) => HEALTH_RULES[tile].map((rule) => rule.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(TILES)('%s: every colour is red or amber, never green (C-10, runtime half)', (tile) => {
    for (const rule of HEALTH_RULES[tile]) {
      expect(['red', 'amber']).toContain(rule.colour);
    }
  });

  it.each(TILES)("%s: rules name only this tile's own metrics and flags (C-19)", (tile) => {
    const vocab = TILE_VOCABULARY[tile];
    for (const rule of HEALTH_RULES[tile]) {
      const c = rule.condition as unknown as Record<string, unknown>;
      const named = [c.metric, c.baseline, c.numerator, c.other, ...(Array.isArray(c.metrics) ? c.metrics : [])].filter(
        (v): v is string => typeof v === 'string'
      );
      for (const metric of named) expect(vocab.metrics as readonly string[]).toContain(metric);
      if (c.kind === 'flag') expect(vocab.flags as readonly string[]).toContain(c.flag);
    }
  });

  it('every metric and flag a tile may use has a label for the generated summary (C-22)', () => {
    for (const tile of TILES) {
      for (const metric of TILE_VOCABULARY[tile].metrics) expect(METRIC_LABELS[metric].label.length).toBeGreaterThan(0);
      for (const flag of TILE_VOCABULARY[tile].flags) expect(FLAG_LABELS[flag].length).toBeGreaterThan(0);
    }
  });

  it('no two tiles share a metric, so one failed read cannot feed another tile (C-19)', () => {
    const all = TILES.flatMap((tile) => [...TILE_VOCABULARY[tile].metrics]);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('rules.ts header (C-11, C-22)', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'lib/admin/health/rules.ts'), 'utf8');

  it('tells an editor to re-read the description when a value changes', () => {
    expect(source).toMatch(/EDITING A VALUE MEANS RE-READING ITS DESCRIPTION/);
  });

  it('records that a non-monotone condition kind is a new kind and goes back to SA', () => {
    expect(source).toMatch(/non-monotone kind/);
  });

  it('imports nothing (it is data and types)', () => {
    expect(source).not.toMatch(/^import /m);
  });
});
