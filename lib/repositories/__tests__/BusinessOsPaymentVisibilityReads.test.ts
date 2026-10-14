/**
 * Plan payments P-5b.2 "Who sees the payment" (workplan
 * BUSINESS_OS_PLAN_PAYMENTS_P5B_WORKPLAN.md §3.3 to §3.6; SA C-7, C-11,
 * P5-C9, P5-C10, S5-8): the four new repository reads and who may call them.
 *
 *   - `BusinessOsBillingEventRepository.findPaidInvoicesForAccounts`: account
 *     AND invoice matched together, in the repository (the S5-8 mutation test:
 *     swap two accounts' refs and neither shows a payment).
 *   - `BusinessOsAccountLineageRepository.findSubscribedInviteIdsForIssuer`:
 *     scoped by the issuer as the lineage parent, invite ids only.
 *   - `BusinessOsAccountLineageRepository.findHoldFactsForAccountsForAdmin` and
 *     `BusinessOsInviteRepository.findGrantKindsByIdsForAdmin`: batched, admin.
 *
 * Every client here is a recording fake: nothing reaches a database.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PostgrestError } from '@supabase/postgrest-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

const logged: unknown[] = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = (...args: unknown[]) => logged.push(args);
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import { BusinessOsAccountLineageRepository, LINEAGE_LOOKUP_LIMIT } from '../BusinessOsAccountLineageRepository';
import {
  BusinessOsBillingEventRepository,
  PAID_INVOICE_COLUMNS,
  PAID_INVOICE_LOOKUP_LIMIT,
} from '../BusinessOsBillingEventRepository';
import {
  BUSINESS_OS_FRIEND_INVITE_LIST_LIMIT,
  BUSINESS_OS_GRANT_KIND_LOOKUP_LIMIT,
  BusinessOsInviteRepository,
} from '../BusinessOsInviteRepository';

type Call = { method: string; args: unknown[] };

/** A thenable query builder that records every call and answers `result`. */
function recordingClient(result: { data: unknown; error: unknown } | (() => never)) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'not', 'is', 'maybeSingle']) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => {
    try {
      resolve(typeof result === 'function' ? result() : result);
    } catch (error) {
      reject(error);
    }
  };
  const client = {
    from: (table: string) => {
      calls.push({ method: 'from', args: [table] });
      return builder;
    },
    rpc: () => {
      throw new Error('no RPC is expected here');
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ISSUER = '33333333-3333-4333-8333-333333333333';
const FRIEND_A = '44444444-4444-4444-8444-444444444444';
const FRIEND_B = '55555555-5555-4555-8555-555555555555';
const INVOICE_A = 'in_1AAAAAAAAAAAAAAAAAAAAAAA';
const INVOICE_B = 'in_1BBBBBBBBBBBBBBBBBBBBBBB';

function moneyRow(accountId: string, invoiceId: string, overrides: Record<string, unknown> = {}) {
  return {
    user_id: accountId,
    stripe_invoice_id: invoiceId,
    amount_minor: 7900,
    amount_tax_minor: 0,
    currency: 'usd',
    paid_at: '2026-10-12T10:00:00.000Z',
    livemode: false,
    ...overrides,
  };
}

beforeEach(() => {
  logged.length = 0;
});

// ── The money-history read (S5-8, SA C-11) ──────────────────────────────────

describe('findPaidInvoicesForAccounts (P-5b.2, S5-8)', () => {
  it('reads the paid-invoice columns, invoice_paid only, narrowed by both id lists', async () => {
    const { client, calls } = recordingClient({ data: [moneyRow(FRIEND_A, INVOICE_A)], error: null });
    const result = await new BusinessOsBillingEventRepository(client).findPaidInvoicesForAccounts([{ accountId: FRIEND_A, invoiceId: INVOICE_A }]);
    expect(result).toEqual({
      data: [
        {
          accountId: FRIEND_A,
          invoiceId: INVOICE_A,
          amountMinor: 7900,
          amountTaxMinor: 0,
          currency: 'usd',
          paidAt: '2026-10-12T10:00:00.000Z',
          livemode: false,
        },
      ],
      error: null,
    });
    expect(calls).toEqual([
      { method: 'from', args: ['business_os_billing_events'] },
      { method: 'select', args: [PAID_INVOICE_COLUMNS] },
      { method: 'eq', args: ['kind', 'invoice_paid'] },
      { method: 'in', args: ['stripe_invoice_id', [INVOICE_A]] },
      { method: 'in', args: ['user_id', [FRIEND_A]] },
    ]);
    expect(PAID_INVOICE_COLUMNS).not.toMatch(/customer|subscription|refusal|event_id/);
  });

  it('S5-8 mutation: two accounts with their refs swapped see NEITHER payment (both ids must match one pair)', async () => {
    // The database holds A's invoice under A and B's under B. The pairs ask for
    // A with B's invoice and B with A's: both id lists cover every row, so only
    // the per-pair filter in the repository keeps them out.
    const { client } = recordingClient({ data: [moneyRow(FRIEND_A, INVOICE_A), moneyRow(FRIEND_B, INVOICE_B)], error: null });
    const result = await new BusinessOsBillingEventRepository(client).findPaidInvoicesForAccounts([
      { accountId: FRIEND_A, invoiceId: INVOICE_B },
      { accountId: FRIEND_B, invoiceId: INVOICE_A },
    ]);
    expect(result).toEqual({ data: [], error: null });
  });

  it('keeps exactly the matching pair when one matches and one is crossed', async () => {
    const { client } = recordingClient({ data: [moneyRow(FRIEND_A, INVOICE_A), moneyRow(FRIEND_B, INVOICE_A)], error: null });
    const result = await new BusinessOsBillingEventRepository(client).findPaidInvoicesForAccounts([{ accountId: FRIEND_A, invoiceId: INVOICE_A }]);
    expect(result.data?.map((row) => row.accountId)).toEqual([FRIEND_A]);
  });

  it(`refuses more than ${PAID_INVOICE_LOOKUP_LIMIT} pairs before any query`, async () => {
    const { client, calls } = recordingClient({ data: [], error: null });
    const pairs = Array.from({ length: PAID_INVOICE_LOOKUP_LIMIT + 1 }, (_value, index) => ({ accountId: uuid(index), invoiceId: INVOICE_A }));
    const result = await new BusinessOsBillingEventRepository(client).findPaidInvoicesForAccounts(pairs);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('invalid_input');
    expect(calls).toEqual([]);
  });

  it('a malformed account or invoice id never reaches the query (counted in a warn, no value logged)', async () => {
    const { client, calls } = recordingClient({ data: [], error: null });
    const result = await new BusinessOsBillingEventRepository(client).findPaidInvoicesForAccounts([
      { accountId: 'not-a-uuid', invoiceId: INVOICE_A },
      { accountId: FRIEND_A, invoiceId: "in_x' or 1=1" },
      { accountId: FRIEND_B, invoiceId: INVOICE_B },
    ]);
    expect(result).toEqual({ data: [], error: null });
    expect(calls).toContainEqual({ method: 'in', args: ['stripe_invoice_id', [INVOICE_B]] });
    expect(calls).toContainEqual({ method: 'in', args: ['user_id', [FRIEND_B]] });
    expect(JSON.stringify(logged)).toContain('"dropped":2');
    expect(JSON.stringify(logged)).not.toContain('not-a-uuid');
  });

  it('no valid pair: no query at all', async () => {
    const { client, calls } = recordingClient({ data: [], error: null });
    expect(await new BusinessOsBillingEventRepository(client).findPaidInvoicesForAccounts([])).toEqual({ data: [], error: null });
    expect(await new BusinessOsBillingEventRepository(client).findPaidInvoicesForAccounts([{ accountId: 'x', invoiceId: 'y' }])).toEqual({ data: [], error: null });
    expect(calls).toEqual([]);
  });

  it.each([
    ['a non-usd currency', { currency: 'eur' }],
    ['a negative amount', { amount_minor: -1 }],
    ['an unreadable date', { paid_at: 'yesterday' }],
    ['a missing livemode', { livemode: null }],
  ])('an answered row with %s is an error, never a guess', async (_label, overrides) => {
    const { client } = recordingClient({ data: [moneyRow(FRIEND_A, INVOICE_A, overrides)], error: null });
    const result = await new BusinessOsBillingEventRepository(client).findPaidInvoicesForAccounts([{ accountId: FRIEND_A, invoiceId: INVOICE_A }]);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });

  it('a database error is returned, never thrown', async () => {
    const { client } = recordingClient({ data: null, error: { code: '57014', message: 'statement timeout' } });
    const result = await new BusinessOsBillingEventRepository(client).findPaidInvoicesForAccounts([{ accountId: FRIEND_A, invoiceId: INVOICE_A }]);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('statement timeout');
  });
});

// ── The champion's "Subscribed" read (P5-C9) ────────────────────────────────

describe('findSubscribedInviteIdsForIssuer (P-5b.2, FR-31, P5-C9)', () => {
  it('scoped twice: the issuer as the lineage parent, friend rows only, the given invites, stamped only; returns invite ids only', async () => {
    const { client, calls } = recordingClient({ data: [{ invite_id: uuid(1) }], error: null });
    const result = await new BusinessOsAccountLineageRepository(client).findSubscribedInviteIdsForIssuer(ISSUER, [uuid(1), uuid(2)]);
    expect(result).toEqual({ data: [uuid(1)], error: null });
    expect(calls).toEqual([
      { method: 'from', args: ['business_os_account_lineage'] },
      { method: 'select', args: ['invite_id'] },
      { method: 'eq', args: ['parent_account_id', ISSUER] },
      { method: 'eq', args: ['source', 'account_invite'] },
      { method: 'in', args: ['invite_id', [uuid(1), uuid(2)]] },
      { method: 'not', args: ['first_paid_at', 'is', null] },
    ]);
  });

  it('never hands back a date, an amount or an account, whatever the row carries', async () => {
    const { client } = recordingClient({ data: [{ invite_id: uuid(1), account_id: FRIEND_A, first_paid_at: '2026-10-12T00:00:00Z' }], error: null });
    const result = await new BusinessOsAccountLineageRepository(client).findSubscribedInviteIdsForIssuer(ISSUER, [uuid(1)]);
    expect(result.data).toEqual([uuid(1)]);
  });

  it.each([
    ['an issuer that is not a UUID', 'session-account', [uuid(1)]],
    ['an invite id that is not a UUID', ISSUER, [uuid(1), 'x']],
    [`more than ${LINEAGE_LOOKUP_LIMIT} invites`, ISSUER, Array.from({ length: LINEAGE_LOOKUP_LIMIT + 1 }, (_v, i) => uuid(i))],
  ])('refuses %s before any query', async (_label, issuer, ids) => {
    const { client, calls } = recordingClient({ data: [], error: null });
    const result = await new BusinessOsAccountLineageRepository(client).findSubscribedInviteIdsForIssuer(issuer, ids);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(calls).toEqual([]);
  });

  it('no invite ids: no query', async () => {
    const { client, calls } = recordingClient({ data: [], error: null });
    expect(await new BusinessOsAccountLineageRepository(client).findSubscribedInviteIdsForIssuer(ISSUER, [])).toEqual({ data: [], error: null });
    expect(calls).toEqual([]);
  });

  it('SA F-1: the champion list cap never exceeds the read cap (else a long list silently reads all "joined")', () => {
    expect(BUSINESS_OS_FRIEND_INVITE_LIST_LIMIT).toBeLessThanOrEqual(LINEAGE_LOOKUP_LIMIT);
  });

  it('an error is scrubbed to { code, message } (M-1)', async () => {
    const dbError = new PostgrestError({ code: '42501', message: 'permission denied', details: 'row x@example.com', hint: '' });
    const result = await new BusinessOsAccountLineageRepository(recordingClient({ data: null, error: dbError }).client).findSubscribedInviteIdsForIssuer(ISSUER, [uuid(1)]);
    expect(result.error).not.toHaveProperty('details');
    expect((result.error as Error & { code?: string }).code).toBe('42501');
    expect(JSON.stringify(logged)).not.toContain('x@example.com');
  });
});

// ── The batched hold reads (P5-C10) ─────────────────────────────────────────

describe('findHoldFactsForAccountsForAdmin (P-5b.2, P5-C10)', () => {
  it('reads the hold facts keyed by account, for the given accounts only', async () => {
    const rows = [{ account_id: FRIEND_A, invite_id: uuid(1), source: 'account_invite', first_paid_at: null }];
    const { client, calls } = recordingClient({ data: rows, error: null });
    expect(await new BusinessOsAccountLineageRepository(client).findHoldFactsForAccountsForAdmin([FRIEND_A])).toEqual({ data: rows, error: null });
    expect(calls).toEqual([
      { method: 'from', args: ['business_os_account_lineage'] },
      { method: 'select', args: ['account_id, invite_id, source, first_paid_at'] },
      { method: 'in', args: ['account_id', [FRIEND_A]] },
    ]);
  });

  it(`refuses more than ${LINEAGE_LOOKUP_LIMIT} ids, or a non-UUID, before a query; no ids is no query`, async () => {
    const { client, calls } = recordingClient({ data: [], error: null });
    const repo = new BusinessOsAccountLineageRepository(client);
    expect((await repo.findHoldFactsForAccountsForAdmin(Array.from({ length: LINEAGE_LOOKUP_LIMIT + 1 }, (_v, i) => uuid(i)))).data).toBeNull();
    expect((await repo.findHoldFactsForAccountsForAdmin(['a1'])).data).toBeNull();
    expect(await repo.findHoldFactsForAccountsForAdmin([])).toEqual({ data: [], error: null });
    expect(calls).toEqual([]);
  });
});

describe('findGrantKindsByIdsForAdmin (P-5b.2, P5-C10)', () => {
  it('reads id and grant kind only, for the given invites', async () => {
    const rows = [{ id: uuid(1), grant_kind: 'tier' }];
    const { client, calls } = recordingClient({ data: rows, error: null });
    expect(await new BusinessOsInviteRepository(client).findGrantKindsByIdsForAdmin([uuid(1)])).toEqual({ data: rows, error: null });
    expect(calls).toEqual([
      { method: 'from', args: ['business_os_invites'] },
      { method: 'select', args: ['id, grant_kind'] },
      { method: 'in', args: ['id', [uuid(1)]] },
    ]);
  });

  it(`refuses more than ${BUSINESS_OS_GRANT_KIND_LOOKUP_LIMIT} ids, or a non-UUID, before a query`, async () => {
    const { client, calls } = recordingClient({ data: [], error: null });
    const repo = new BusinessOsInviteRepository(client);
    expect((await repo.findGrantKindsByIdsForAdmin(Array.from({ length: BUSINESS_OS_GRANT_KIND_LOOKUP_LIMIT + 1 }, (_v, i) => uuid(i)))).data).toBeNull();
    expect((await repo.findGrantKindsByIdsForAdmin(['x'])).data).toBeNull();
    expect(calls).toEqual([]);
  });

  it('a database error never carries row values (M-1)', async () => {
    const dbError = new PostgrestError({ code: '57014', message: 'timeout', details: 'row leak@example.com', hint: '' });
    const result = await new BusinessOsInviteRepository(recordingClient({ data: null, error: dbError }).client).findGrantKindsByIdsForAdmin([uuid(1)]);
    expect(result.data).toBeNull();
    expect(JSON.stringify(result.error)).not.toContain('leak@example.com');
    expect(JSON.stringify(logged)).not.toContain('leak@example.com');
  });
});

// ── C-7: service role documented, and exactly one caller each ───────────────

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (['node_modules', '.next', '.git', '.claude', 'coverage', '__tests__', '__fixtures__'].includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Product files only: tests and fixtures are not callers. */
const PRODUCT = ['lib', 'app', 'components', 'hooks', 'scripts']
  .flatMap((dir) => walk(join(ROOT, dir)))
  .map((file) => ({ file: relative(ROOT, file).replace(/\\/g, '/'), text: readFileSync(file, 'utf8') }));

const callersOf = (pattern: RegExp) => PRODUCT.filter((source) => pattern.test(source.text)).map((source) => source.file).sort();

describe('C-7: each new read documents its service-role use and has exactly its named caller', () => {
  it('scans a real tree (the guard cannot pass on an empty walk)', () => {
    expect(PRODUCT.length).toBeGreaterThan(500);
  });

  it.each([
    ['lib/repositories/BusinessOsBillingEventRepository.ts', 'findPaidInvoicesForAccounts'],
    ['lib/repositories/BusinessOsAccountLineageRepository.ts', 'findSubscribedInviteIdsForIssuer'],
    ['lib/repositories/BusinessOsAccountLineageRepository.ts', 'findHoldFactsForAccountsForAdmin'],
    ['lib/repositories/BusinessOsInviteRepository.ts', 'findGrantKindsByIdsForAdmin'],
  ])('%s → %s carries "INTENTIONAL SERVICE-ROLE" and its caller in its own doc comment', (file, method) => {
    const text = readFileSync(join(ROOT, file), 'utf8');
    const at = text.indexOf(`async ${method}(`);
    expect(at).toBeGreaterThan(0);
    const doc = text.slice(text.lastIndexOf('/**', at), at);
    expect(doc).toContain('INTENTIONAL SERVICE-ROLE');
    expect(doc).toMatch(/caller/i);
  });

  it('findPaidInvoicesForAccounts is called only by the admin list operation, and wired only by the admin invites route', () => {
    expect(callersOf(/\.findPaidInvoicesForAccounts\s*\(/)).toEqual(['lib/business-os/invites/adminInviteOps.ts']);
    // ...and that operation is reached only from the admin invites route (behind requireAdmin).
    expect(callersOf(/\blistInvitesForAdmin\s*\(/)).toEqual([
      'app/api/admin/business-os/invites/route.ts',
      'lib/business-os/invites/adminInviteOps.ts',
    ]);
    const route = PRODUCT.find((source) => source.file === 'app/api/admin/business-os/invites/route.ts')?.text ?? '';
    expect(route).toMatch(/billingEvents:\s*businessOsBillingEventRepository/);
  });

  it('findSubscribedInviteIdsForIssuer is called only by the champion list operation', () => {
    expect(callersOf(/\.findSubscribedInviteIdsForIssuer\s*\(/)).toEqual(['lib/business-os/invites/friendInviteOps.ts']);
  });

  it('the two batched hold reads are called only by the batch helper', () => {
    expect(callersOf(/\.findHoldFactsForAccountsForAdmin\s*\(/)).toEqual(['lib/business-os/invites/paymentHoldBatch.ts']);
    expect(callersOf(/\.findGrantKindsByIdsForAdmin\s*\(/)).toEqual(['lib/business-os/invites/paymentHoldBatch.ts']);
  });

  it('the batch helper is called only by the shadow report and the launch dry run (never readPaymentHold per account)', () => {
    expect(callersOf(/\breadAwaitingPaymentAccounts\s*\(/)).toEqual([
      'app/api/admin/business-os/entitlements/launch/route.ts',
      'lib/business-os/entitlements/report.ts',
      'lib/business-os/invites/paymentHoldBatch.ts',
    ]);
    for (const file of ['app/api/admin/business-os/entitlements/launch/route.ts', 'lib/business-os/entitlements/report.ts', 'lib/business-os/invites/paymentHoldBatch.ts']) {
      const text = PRODUCT.find((source) => source.file === file)?.text ?? '';
      expect({ file, perAccount: /\breadPaymentHold\s*\(/.test(text) }).toEqual({ file, perAccount: false });
    }
  });

  it('the routes that wire the hold readers gate with requireAdmin as their first statement', () => {
    for (const file of ['app/api/admin/business-os/entitlements/launch/route.ts', 'app/api/admin/business-os/entitlements/shadow-report/route.ts', 'app/api/admin/business-os/invites/route.ts']) {
      const text = PRODUCT.find((source) => source.file === file)?.text ?? '';
      const handler = text.slice(text.search(/export async function (GET|POST)\(/));
      const body = handler.slice(handler.indexOf('{') + 1).trimStart();
      expect({ file, first: body.startsWith('const gate = await requireAdmin(') }).toEqual({ file, first: true });
    }
  });
});
