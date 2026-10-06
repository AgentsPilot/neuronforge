/**
 * Purge slice 3a (T3a-5, SA C-5) — the preview carries the delete-graph
 * verdict, and a failed read is a VISIBLE blocking state, never "clean".
 *
 * Runs without network: the repository is mocked. The graph payloads are
 * synthetic (OQ-6): edges are built from the resolved run, not from a dump.
 */

import fs from 'fs';
import path from 'path';

const repo = {
  hasStripeConnectRow: jest.fn(),
  countAll: jest.fn(),
  countStorageObjects: jest.fn(),
  purgeFunctionExists: jest.fn(),
  introspectSchema: jest.fn(),
};

jest.mock('@/lib/repositories/BusinessPurgeRepository', () => ({
  businessPurgeRepository: {
    hasStripeConnectRow: (...a: unknown[]) => repo.hasStripeConnectRow(...a),
    countAll: (...a: unknown[]) => repo.countAll(...a),
    countStorageObjects: (...a: unknown[]) => repo.countStorageObjects(...a),
    purgeFunctionExists: (...a: unknown[]) => repo.purgeFunctionExists(...a),
    introspectSchema: (...a: unknown[]) => repo.introspectSchema(...a),
  },
}));

jest.mock('../PreflightGate', () => ({
  evaluatePreflightGate: jest.fn().mockResolvedValue({ outcome: 'skipped', blocks: [] }),
  describeGateCoverage: jest.fn().mockReturnValue({ headline: 'skipped', unchecked: [] }),
}));

import { buildPurgePreview } from '../PreviewService';
import { descriptorsForRun } from '../descriptors';
import type { PurgeOptions } from '../types';

const DEFAULTS: PurgeOptions = { integrations: false, agents: false, activityHistory: false };

/** A clean synthetic graph for a run: one CASCADE edge, child before parent. */
function cleanSchemaFor(level: 'reset' | 'purge', options: PurgeOptions) {
  const run = descriptorsForRun(level, options);
  return {
    columns: [],
    foreign_keys: [
      { constraint_name: 'k', table_name: run[0].table, references: run[run.length - 1].table, on_delete: 'c' },
    ],
    triggers: [],
  };
}

beforeEach(() => {
  Object.values(repo).forEach((m) => m.mockReset());
  repo.hasStripeConnectRow.mockResolvedValue(false);
  repo.countAll.mockImplementation(async (ds: Array<{ table: string }>) => ds.map((d) => ({ table: d.table, count: 0 })));
  repo.countStorageObjects.mockImplementation(async (bucket: string) => ({ table: bucket, count: 0 }));
  repo.purgeFunctionExists.mockResolvedValue(false);
});

const build = (level: 'reset' | 'purge', options: PurgeOptions = DEFAULTS) =>
  buildPurgePreview({ userId: 'u-1', level, options, correlationId: 'c-1' });

describe('buildPurgePreview — delete-graph verdict', () => {
  it('carries a clean verdict and adds no delete-graph limitation when the graph is clean', async () => {
    repo.introspectSchema.mockResolvedValue({ data: cleanSchemaFor('purge', DEFAULTS), error: null });

    const preview = await build('purge');

    expect(repo.introspectSchema).toHaveBeenCalledTimes(1);
    expect(preview.deleteGraph.status).toBe('ok');
    expect(preview.limitations.join('\n')).not.toMatch(/DELETE GRAPH/);
  });

  it('C-5: an unreadable schema is a visible blocking state, never clean', async () => {
    repo.introspectSchema.mockResolvedValue({ data: null, error: new Error('permission denied') });

    const preview = await build('reset');

    expect(preview.deleteGraph.status).toBe('unreadable');
    expect(preview.limitations.join('\n')).toMatch(/DELETE GRAPH NOT VERIFIED/);
    expect(preview.limitations.join('\n')).toMatch(/REFUSED/);
    // A preview still never proceeds.
    expect(preview.canProceed).toBe(false);
  });

  it('C-5: a rejected read is also a visible blocking state, and the preview still renders', async () => {
    repo.introspectSchema.mockRejectedValue(new Error('socket hang up'));

    const preview = await build('purge');

    expect(preview.deleteGraph.status).toBe('unreadable');
    expect(preview.limitations.join('\n')).toMatch(/DELETE GRAPH NOT VERIFIED/);
    expect(preview.tables.length).toBeGreaterThan(0);
  });

  it('SA F-1: raw PostgREST / Zod error text never reaches the preview payload outside development', async () => {
    const RAW = 'permission denied for function purge_schema_introspect (42501) columns.0.table_name Required';
    repo.introspectSchema.mockResolvedValue({ data: null, error: new Error(RAW) });

    const preview = await build('purge');

    expect(preview.deleteGraph.status).toBe('unreadable');
    const payload = JSON.stringify(preview);
    expect(payload).not.toContain('permission denied');
    expect(payload).not.toContain('42501');
    expect(payload).not.toContain('Required');
    expect(preview.deleteGraph.error).toBe('The live schema could not be read');
  });

  it('a cascade into a table outside the run (the M-5 shape) is shown as a refusal', async () => {
    const options = { ...DEFAULTS, agents: true };
    const schema = cleanSchemaFor('purge', options);
    schema.foreign_keys.push({
      constraint_name: 'outside_fkey',
      table_name: 'zz_outside_table',
      references: descriptorsForRun('purge', options)[0].table,
      on_delete: 'c',
    });
    repo.introspectSchema.mockResolvedValue({ data: schema, error: null });

    const preview = await build('purge', options);

    expect(preview.deleteGraph.status).toBe('refused');
    expect(preview.deleteGraph.unlistedCascadeChildren.map((e) => e.child)).toEqual(['zz_outside_table']);
    expect(preview.limitations.join('\n')).toMatch(/DELETE GRAPH REFUSES THIS RUN/);
  });
});

describe('PurgeDangerZone — the panel never renders a missing verdict as clean (C-5)', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', '..', 'components', 'business-os', 'purge', 'PurgeDangerZone.tsx'),
    'utf-8'
  );

  it('defaults an absent verdict to unreadable, and labels it as refused', () => {
    expect(src).toMatch(/graph\?\.status \?\? 'unreadable'/);
    expect(src).toContain('NOT VERIFIED (treated as refused)');
    expect(src).toMatch(/<DeleteGraphPanel graph=\{result\.deleteGraph\}/);
  });
});
