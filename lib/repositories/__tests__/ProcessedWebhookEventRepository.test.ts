/**
 * Unit tests for ProcessedWebhookEventRepository (CF-5 PR 1).
 *
 * Workplan: docs/workplans/BUSINESS_OS_WEBHOOK_CONNECT_REPOSITORIES_WORKPLAN.md
 * §7.3.2 and §7.5. Each method must issue EXACTLY the query the Stripe webhook
 * issued inline before PR 1 (table, operation, columns, payload, filters in
 * order, terminal), pass supabase-js's error object through unchanged (same
 * identity, so `code === '23505'` still works), never add a `user_id` filter
 * (⟨unscoped-by-design⟩, SA C-3), and never catch a throw (the route's release
 * try/catch must still see one).
 *
 * A recording fake client: no database, no network (SA C-7).
 */

import fs from 'fs';
import path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

// The default client is the shared service-role singleton; a marker proves it.
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { marker: 'service-role-default' } }));

import {
  CLAIM_COLUMNS,
  ProcessedWebhookEventRepository,
  processedWebhookEventRepository,
  type NewWebhookClaimRow,
} from '@/lib/repositories/ProcessedWebhookEventRepository';

type Call = [method: string, ...args: unknown[]];

/** Records every builder call in order; the terminal (or `await`) answers `result`. */
function recordingClient(result: { data: unknown; error: unknown }) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'neq', 'in', 'is', 'not', 'or', 'order', 'limit']) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  for (const terminal of ['single', 'maybeSingle']) {
    builder[terminal] = (...args: unknown[]) => {
      calls.push([terminal, ...args]);
      return Promise.resolve(result);
    };
  }
  builder.then = (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) => {
    calls.push(['await']);
    return Promise.resolve(result).then(onF, onR);
  };
  const client = {
    from: (table: string) => {
      calls.push(['from', table]);
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const EVENT_ID = 'evt_test_1';
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const pgError = () => Object.assign(new Error('boom'), { code: 'XX000', details: '', hint: '' });

/** No call anywhere in the chain names `user_id` (⟨unscoped-by-design⟩). */
function expectNoOwnerFilter(calls: Call[]) {
  for (const [method, ...args] of calls) {
    if (['eq', 'neq', 'in', 'is', 'not', 'or'].includes(method)) {
      expect(args[0]).not.toBe('user_id');
    }
  }
  expect(JSON.stringify(calls)).not.toContain('user_id');
}

describe('ProcessedWebhookEventRepository', () => {
  describe('findClaim', () => {
    it('reads event_id and status by event id, maybeSingle, and returns the row', async () => {
      const row = { event_id: EVENT_ID, status: 'failed' };
      const { client, calls } = recordingClient({ data: row, error: null });
      const result = await new ProcessedWebhookEventRepository(client).findClaim(EVENT_ID);

      expect(calls).toEqual([
        ['from', 'processed_webhook_events'],
        ['select', 'event_id, status'],
        ['eq', 'event_id', EVENT_ID],
        ['maybeSingle'],
      ]);
      expect(result).toEqual({ data: row, error: null });
      expectNoOwnerFilter(calls);
    });

    it('a miss is data null, error null', async () => {
      const { client } = recordingClient({ data: null, error: null });
      expect(await new ProcessedWebhookEventRepository(client).findClaim(EVENT_ID)).toEqual({ data: null, error: null });
    });

    it('passes the same error object through, never throws', async () => {
      const error = pgError();
      const { client } = recordingClient({ data: null, error });
      const result = await new ProcessedWebhookEventRepository(client).findClaim(EVENT_ID);
      expect(result.data).toBeNull();
      expect(result.error).toBe(error);
    });
  });

  describe('insertClaim', () => {
    const row: NewWebhookClaimRow = {
      event_id: EVENT_ID,
      event_type: 'invoice.paid',
      status: 'processing',
      processed_at: '2026-10-07T10:00:00.000Z',
      metadata: { created: 1759831200, livemode: false },
    };

    it('inserts the row exactly as given, then is awaited: no select, no upsert', async () => {
      const { client, calls } = recordingClient({ data: null, error: null });
      const result = await new ProcessedWebhookEventRepository(client).insertClaim(row);

      expect(calls).toEqual([['from', 'processed_webhook_events'], ['insert', row], ['await']]);
      // The payload is the caller's object, untouched (no key added).
      expect(calls[1][1]).toBe(row);
      expect(result).toEqual({ data: null, error: null });
      expectNoOwnerFilter(calls);
    });

    it('a unique violation comes back as the same error object, so the caller can read code 23505', async () => {
      const error = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
      const { client } = recordingClient({ data: null, error });
      const result = await new ProcessedWebhookEventRepository(client).insertClaim(row);
      expect(result.error).toBe(error);
      expect(result.error?.code).toBe('23505');
    });

    it('rejects an extra key at compile time (object literal)', () => {
      const repo = new ProcessedWebhookEventRepository(recordingClient({ data: null, error: null }).client);
      // The call below is never run; it exists for `tsc`.
      const typeOnly = () =>
        repo.insertClaim({
          ...row,
          // @ts-expect-error -- the row type is the allow-list: user_id is not a claim column the webhook writes
          user_id: 'someone',
        });
      expect(typeof typeOnly).toBe('function');
    });
  });

  describe('reclaimFailed', () => {
    it('sets processing, clears the failure message, stamps processed_at, filtered by event id only', async () => {
      const { client, calls } = recordingClient({ data: null, error: null });
      const result = await new ProcessedWebhookEventRepository(client).reclaimFailed(EVENT_ID);

      expect(calls).toEqual([
        ['from', 'processed_webhook_events'],
        ['update', { status: 'processing', failure_message: null, processed_at: expect.stringMatching(ISO) }],
        ['eq', 'event_id', EVENT_ID],
        ['await'],
      ]);
      expect(Object.keys(calls[1][1] as object)).toEqual(['status', 'failure_message', 'processed_at']);
      expect(result).toEqual({ data: null, error: null });
      expectNoOwnerFilter(calls);
    });

    it('passes the error through', async () => {
      const error = pgError();
      const { client } = recordingClient({ data: null, error });
      expect((await new ProcessedWebhookEventRepository(client).reclaimFailed(EVENT_ID)).error).toBe(error);
    });
  });

  describe('complete', () => {
    it('sets completed with completed_at, filtered by event id only', async () => {
      const { client, calls } = recordingClient({ data: null, error: null });
      const result = await new ProcessedWebhookEventRepository(client).complete(EVENT_ID);

      expect(calls).toEqual([
        ['from', 'processed_webhook_events'],
        ['update', { status: 'completed', completed_at: expect.stringMatching(ISO) }],
        ['eq', 'event_id', EVENT_ID],
        ['await'],
      ]);
      expect(Object.keys(calls[1][1] as object)).toEqual(['status', 'completed_at']);
      expect(result).toEqual({ data: null, error: null });
      expectNoOwnerFilter(calls);
    });

    it('passes the error through', async () => {
      const error = pgError();
      const { client } = recordingClient({ data: null, error });
      expect((await new ProcessedWebhookEventRepository(client).complete(EVENT_ID)).error).toBe(error);
    });
  });

  describe('markFailed', () => {
    it('sets failed with the given message, filtered by event id only; the message is not altered', async () => {
      const message = 'x'.repeat(500);
      const { client, calls } = recordingClient({ data: null, error: null });
      const result = await new ProcessedWebhookEventRepository(client).markFailed(EVENT_ID, message);

      expect(calls).toEqual([
        ['from', 'processed_webhook_events'],
        ['update', { status: 'failed', failure_message: message }],
        ['eq', 'event_id', EVENT_ID],
        ['await'],
      ]);
      expect(Object.keys(calls[1][1] as object)).toEqual(['status', 'failure_message']);
      expect(result).toEqual({ data: null, error: null });
      expectNoOwnerFilter(calls);
    });

    it('passes the error through (the database-down case the route ignores)', async () => {
      const error = pgError();
      const { client } = recordingClient({ data: null, error });
      expect((await new ProcessedWebhookEventRepository(client).markFailed(EVENT_ID, 'm')).error).toBe(error);
    });

    it('does not catch a throw: the route\'s release try/catch must still see it', async () => {
      const client = {
        from: () => {
          throw new Error('client exploded');
        },
      } as unknown as SupabaseClient;
      await expect(new ProcessedWebhookEventRepository(client).markFailed(EVENT_ID, 'm')).rejects.toThrow('client exploded');
    });
  });

  describe('construction and exports (new-repository)', () => {
    it('defaults to the shared service-role client', () => {
      const repo = new ProcessedWebhookEventRepository();
      expect((repo as unknown as { supabase: unknown }).supabase).toEqual({ marker: 'service-role-default' });
      expect((processedWebhookEventRepository as unknown as { supabase: unknown }).supabase).toEqual({
        marker: 'service-role-default',
      });
    });

    it('is exported from the barrel, class and singleton', () => {
      // Read as text: importing the barrel would load every repository for one assertion.
      const index = fs.readFileSync(path.join(process.cwd(), 'lib/repositories/index.ts'), 'utf8');
      expect(index).toContain(
        "export { ProcessedWebhookEventRepository, processedWebhookEventRepository } from './ProcessedWebhookEventRepository';"
      );
    });

    it('selects only the fixed column list', () => {
      expect(CLAIM_COLUMNS).toBe('event_id, status');
    });
  });

  // SA C-3 bloat controls, read from the source so they cannot drift silently.
  describe('source shape (SA C-3)', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/repositories/ProcessedWebhookEventRepository.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    it('has the unscoped-by-design section header, and every method doc carries the marker', () => {
      expect(source).toContain(
        "// Stripe webhook: keyed by Stripe ids or rows the route has already proved owned (⟨unscoped-by-design⟩)"
      );
      for (const method of ['findClaim', 'insertClaim', 'reclaimFailed', 'complete', 'markFailed']) {
        const doc = new RegExp(`/\\*\\*[^/]*⟨unscoped-by-design⟩[\\s\\S]*?\\*/\\s*async ${method}\\(`);
        expect(source).toMatch(doc);
      }
    });

    it('has no generic update, no spread payload, no select(*), no user_id, no try/catch', () => {
      expect(code).not.toMatch(/\.update\(\s*\{\s*\.\.\./);
      expect(code).not.toMatch(/\.update\(\s*(patch|input|changes|fields)\b/);
      expect(code).not.toMatch(/\.insert\(\s*\{\s*\.\.\./);
      expect(code).not.toMatch(/select\(\s*['"]\*['"]/);
      expect(code).not.toMatch(/\.(delete|upsert|rpc)\(/);
      expect(code).not.toContain('user_id');
      expect(code).not.toMatch(/\btry\s*\{/);
    });
  });
});
