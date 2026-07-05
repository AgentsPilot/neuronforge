/**
 * Unit tests for CalibrationHistoryRepository metadata composition (C1, FR-17/FR-23).
 *
 * Proves that mergeMetadata re-reads the row's CURRENT metadata inside the method
 * so multiple metadata writes in one run compose instead of clobbering — the
 * whole point of C1. markAdminAlerted routes through the same fresh-read merge.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { CalibrationHistoryRepository } from '@/lib/repositories/CalibrationHistoryRepository';

/**
 * Stateful supabase mock. Holds a single row's metadata in a closure so that a
 * `select('metadata').eq().single()` reflects the latest `update({metadata}).eq()`.
 * This is what lets the test prove sequential merges accumulate (no clobber).
 */
function makeStatefulClient(initialMetadata: Record<string, any>) {
  const state = { metadata: { ...initialMetadata } };
  const writes: Array<Record<string, any>> = [];
  let readError: Error | null = null;

  const builder: any = {
    _mode: null as null | 'select' | 'update',
    _pending: null as null | Record<string, any>,
    select() { this._mode = 'select'; return this; },
    update(payload: { metadata: Record<string, any> }) { this._mode = 'update'; this._pending = payload; return this; },
    eq() { return this; },
    single() {
      return Promise.resolve(
        readError ? { data: null, error: readError } : { data: { metadata: state.metadata }, error: null }
      );
    },
    then(resolve: (v: any) => any, reject: (e: any) => any) {
      if (this._mode === 'update' && this._pending) {
        state.metadata = this._pending.metadata;
        writes.push(this._pending.metadata);
        this._mode = null;
        this._pending = null;
      }
      return Promise.resolve({ data: null, error: null }).then(resolve, reject);
    },
  };

  const client = { from: jest.fn(() => builder) } as unknown as SupabaseClient;
  return { client, state, writes, setReadError: (e: Error | null) => { readError = e; } };
}

describe('CalibrationHistoryRepository.mergeMetadata (C1)', () => {
  it('merges a patch on top of the row\'s current metadata (fresh read)', async () => {
    const { client, state } = makeStatefulClient({ existing: 'x' });
    const repo = new CalibrationHistoryRepository(client);

    const res = await repo.mergeMetadata('hist-1', { correlation_id: 'c1' });

    expect(res.error).toBeNull();
    expect(state.metadata).toEqual({ existing: 'x', correlation_id: 'c1' });
  });

  it('sequential writes COMPOSE — correlation_id, auto_rca and admin_alerted all coexist (no clobber)', async () => {
    const { client, state } = makeStatefulClient({ existing: 'x' });
    const repo = new CalibrationHistoryRepository(client);

    // Mirrors the route tail order: correlationId → auto_rca → markAdminAlerted.
    await repo.mergeMetadata('hist-1', { correlation_id: 'c1' });
    await repo.mergeMetadata('hist-1', {
      auto_rca: { rootCauseLayer: 'V6 generation' },
      auto_rca_generated_at: '2026-07-05T00:00:00.000Z',
      auto_rca_model: 'claude-sonnet-4-6',
      auto_rca_provider: 'anthropic',
    });
    await repo.markAdminAlerted('hist-1');

    // The critical C1 assertion: nothing was clobbered.
    expect(state.metadata.existing).toBe('x');
    expect(state.metadata.correlation_id).toBe('c1');
    expect(state.metadata.auto_rca).toEqual({ rootCauseLayer: 'V6 generation' });
    expect(state.metadata.auto_rca_model).toBe('claude-sonnet-4-6');
    expect(state.metadata.auto_rca_provider).toBe('anthropic');
    expect(state.metadata.admin_alerted).toBe(true);
    expect(typeof state.metadata.admin_alerted_at).toBe('string');
  });

  it('returns an error result (does not throw) when the fresh read fails', async () => {
    const { client, setReadError } = makeStatefulClient({});
    setReadError(new Error('db down'));
    const repo = new CalibrationHistoryRepository(client);

    const res = await repo.mergeMetadata('hist-1', { correlation_id: 'c1' });
    expect(res.data).toBeNull();
    expect(res.error).toBeInstanceOf(Error);
  });
});
