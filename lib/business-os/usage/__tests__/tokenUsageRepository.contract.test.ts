/**
 * TokenUsageRepository type contract (Layer 1.1 AC-24, WC-3).
 *
 * Every method must REQUIRE its account argument. Jest runs transpile-only, so
 * the `@ts-expect-error` lines below are enforced by `npm run typecheck:bos-llm`
 * (this file is under `lib/business-os/usage/`, in the gate's core scope): if a
 * signature ever made the account optional, the directive would stop firing and
 * the gate would fail with TS2578.
 *
 * The runtime assertions back the same rule for callers that bypass types.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

import type { SupabaseClient } from '@supabase/supabase-js';
import { TokenUsageRepository, type TokenUsageWindow } from '@/lib/repositories/TokenUsageRepository';
import { createFakeSupabase } from '@/tests/helpers/fakePostgrest';

const WINDOW: TokenUsageWindow = { start: new Date('2026-09-17T10:00:00Z'), end: new Date('2026-09-17T12:00:00Z') };
const FILTER = { featurePrefix: 'business-os', features: ['lead-reply'] };
const MATCH = { kind: 'row_filter', filter: FILTER } as const;

function repository() {
  const fake = createFakeSupabase({ tables: { token_usage: [] } });
  return { fake, repo: new TokenUsageRepository(fake.client as unknown as SupabaseClient) };
}

/** Compile-time only: never called. Each line omits the account argument. */
function compileTimeContract(repo: TokenUsageRepository): void {
  // @ts-expect-error the account id is required
  void repo.usageSummaryByFeatureAndDay(WINDOW.start);
  // @ts-expect-error the account id is required
  void repo.listSummaryRowsPage(WINDOW.start, 0, 999);
  // @ts-expect-error the account id is required
  void repo.listCallsInWindow(WINDOW, FILTER, { pageSize: 1000, ceiling: 5000 });
  // @ts-expect-error the account id list is required
  void repo.countInWindow(WINDOW, MATCH);
  // @ts-expect-error the account id list is required
  void repo.listLabelsInWindow(WINDOW, MATCH, 50);
}

describe('TokenUsageRepository account contract', () => {
  it('declares the compile-time contract (enforced by the typecheck gate)', () => {
    expect(typeof compileTimeContract).toBe('function');
  });

  it('rejects an empty account id list at runtime, before any query', async () => {
    const { fake, repo } = repository();
    const count = await repo.countInWindow([], WINDOW, MATCH);
    const labels = await repo.listLabelsInWindow([], WINDOW, MATCH, 50);
    expect(count.error).toBeInstanceOf(Error);
    expect(labels.error).toBeInstanceOf(Error);
    expect(fake.queries).toHaveLength(0);
  });
});
