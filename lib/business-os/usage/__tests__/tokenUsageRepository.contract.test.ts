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

import * as fs from 'fs';
import * as path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { TokenUsageRepository, type TokenUsageWindow } from '@/lib/repositories/TokenUsageRepository';
import { createFakeSupabase } from '@/tests/helpers/fakePostgrest';

const WINDOW: TokenUsageWindow = { start: new Date('2026-09-17T10:00:00Z'), end: new Date('2026-09-17T12:00:00Z') };
const FILTER = { featurePrefix: 'business-os', features: ['lead-reply'] };
const MATCH = { kind: 'row_filter', filter: FILTER } as const;
const CHAT_OPTS = { pageSize: 1000, ceiling: 10_000 };

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
  // Layer 1.5 (WC-5): the per-account chat read REQUIRES its account…
  // @ts-expect-error the account id is required
  void repo.listChatCallsForAccountInWindow(WINDOW, 'business-os-chat', CHAT_OPTS);
  // …and the all-accounts read takes NO account parameter at all: "all
  // accounts" is a different method name, never an omitted argument.
  // @ts-expect-error there is no account parameter to pass
  void repo.listChatCallsAllAccountsInWindow('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', WINDOW, 'business-os-chat', CHAT_OPTS);
}

/*
 * Arity pins (Layer 1.5 RC-12a): no existing method may gain an optional
 * account filter — or any other trailing parameter — without this failing.
 * TypeScript keeps optional parameters in `Function.length`.
 */
const EXPECTED_ARITY: Record<string, number> = {
  usageSummaryByFeatureAndDay: 2,
  listSummaryRowsPage: 4,
  listCallsInWindow: 4,
  countInWindow: 3,
  listLabelsInWindow: 4,
  listChatCallsForAccountInWindow: 4,
  listChatCallsAllAccountsInWindow: 3,
};

describe('TokenUsageRepository account contract', () => {
  it('declares the compile-time contract (enforced by the typecheck gate)', () => {
    expect(typeof compileTimeContract).toBe('function');
  });

  it('pins every public method and its arity; no account filter became optional', () => {
    const proto = TokenUsageRepository.prototype as unknown as Record<string, unknown>;
    const publicMethods = Object.getOwnPropertyNames(TokenUsageRepository.prototype).filter(
      (name) =>
        name !== 'constructor' &&
        typeof proto[name] === 'function' &&
        !['assertAccount', 'assertAccounts', 'assertWindow', 'assertFilter', 'assertFeatures', 'assertMatch', 'assertIntRange', 'assertChatRead', 'fail', 'pageChatCalls'].includes(name)
    );
    expect(publicMethods.sort()).toEqual(Object.keys(EXPECTED_ARITY).sort());
    for (const [name, arity] of Object.entries(EXPECTED_ARITY)) {
      expect({ name, arity: (proto[name] as (...a: unknown[]) => unknown).length }).toEqual({ name, arity });
    }
  });

  it('still imports nothing from lib/business-os (Layer 1.1 RC-7)', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib', 'repositories', 'TokenUsageRepository.ts'), 'utf8');
    expect(source).not.toMatch(/from\s+['"]@\/lib\/business-os/);
    expect(source).not.toMatch(/callCatalog/);
  });

  it('the only unscoped read is the one named AllAccounts', async () => {
    const fake = createFakeSupabase({ tables: { token_usage: [] } });
    const repo = new TokenUsageRepository(fake.client as unknown as SupabaseClient);
    await repo.listChatCallsAllAccountsInWindow(WINDOW, 'business-os-chat', CHAT_OPTS);
    await repo.listChatCallsForAccountInWindow('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', WINDOW, 'business-os-chat', CHAT_OPTS);
    const scoped = fake.queries.map((q) => q.filters.some((f) => f.column === 'user_id'));
    expect(scoped).toEqual([false, true]);
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
