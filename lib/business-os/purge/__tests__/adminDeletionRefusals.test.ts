/**
 * Admin delete AD-1b (T9, SA SC-4, SC-5, D-4, SA-7): the pure refusal
 * evaluator. One applies-case and one clear-case per R, every refusal
 * returned together, every failed read is `unverified` (never a pass), R-4
 * always not applicable, R-7 deferred, and R-1 / R-2 stop the rest.
 */

import fs from 'fs';
import path from 'path';

import {
  BLOCKING_REFUSAL_STATUSES,
  R3_LIVE_STATUSES,
  blockingRefusals,
  evaluateAdminDeletionRefusals,
  isPlanSubscriptionLive,
  r7AlreadyRunning,
  type AdminDeletionFacts,
  type AdminDeletionLaterFacts,
  type AdminDeletionRefusal,
  type AdminDeletionRefusalId,
} from '../adminDeletionRefusals';
import type { BusinessOsSubscriptionStatus } from '@/lib/repositories/BusinessOsBillingAccountRepository';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';

const clearLater = (): AdminDeletionLaterFacts => ({
  billing: { test: { row: null }, live: { row: null } },
  connectAccounts: 0,
  localBlocking: { outcome: 'clear' },
  schema: { status: 'ok', unclassified: [], missingDeletable: [] },
  deleteGraph: { status: 'ok' },
});

const facts = (overrides: Partial<AdminDeletionFacts> = {}, later: Partial<AdminDeletionLaterFacts> = {}): AdminDeletionFacts => ({
  adminId: ADMIN,
  targetId: TARGET,
  targetIsAdmin: false,
  later: { ...clearLater(), ...later },
  ...overrides,
});

const byId = (refusals: AdminDeletionRefusal[], id: AdminDeletionRefusalId) => {
  const found = refusals.find((r) => r.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
};

const statusOf = (f: AdminDeletionFacts, id: AdminDeletionRefusalId) =>
  byId(evaluateAdminDeletionRefusals(f).refusals, id).status;

describe('shape', () => {
  it('always returns R-1 … R-8, in order', () => {
    const ids = ['R-1', 'R-2', 'R-3', 'R-4', 'R-5', 'R-6', 'R-7', 'R-8'];
    expect(evaluateAdminDeletionRefusals(facts()).refusals.map((r) => r.id)).toEqual(ids);
    expect(evaluateAdminDeletionRefusals(facts({ targetId: ADMIN })).refusals.map((r) => r.id)).toEqual(ids);
    expect(evaluateAdminDeletionRefusals(facts({ later: undefined })).refusals.map((r) => r.id)).toEqual(ids);
  });

  it('all clear: nothing blocks; R-4 not applicable, R-7 deferred', () => {
    const { refusals, identityRefused } = evaluateAdminDeletionRefusals(facts());
    expect(identityRefused).toBe(false);
    expect(blockingRefusals(refusals)).toEqual([]);
    expect(refusals.map((r) => r.status)).toEqual([
      'clear',
      'clear',
      'clear',
      'not_applicable',
      'clear',
      'clear',
      'deferred',
      'clear',
    ]);
  });

  it('only applies and unverified block', () => {
    expect([...BLOCKING_REFUSAL_STATUSES].sort()).toEqual(['applies', 'unverified']);
  });
});

describe('R-1 (self) and R-2 (admin), SC-3', () => {
  it('R-1 applies to the acting admin, case-insensitively, and the rest are not evaluated', () => {
    const result = evaluateAdminDeletionRefusals(facts({ targetId: ADMIN.toUpperCase() }));
    expect(result.identityRefused).toBe(true);
    expect(byId(result.refusals, 'R-1').status).toBe('applies');
    for (const id of ['R-3', 'R-4', 'R-5', 'R-6', 'R-7', 'R-8'] as const) {
      expect(byId(result.refusals, id).status).toBe('not_evaluated');
    }
  });

  it('R-2 applies to an admin target; clear otherwise', () => {
    expect(statusOf(facts({ targetIsAdmin: true }), 'R-2')).toBe('applies');
    expect(statusOf(facts({ targetIsAdmin: false }), 'R-2')).toBe('clear');
    expect(evaluateAdminDeletionRefusals(facts({ targetIsAdmin: true })).identityRefused).toBe(true);
  });

  it('R-2 unknown (null) is unverified, refuses, and stops counting', () => {
    const result = evaluateAdminDeletionRefusals(facts({ targetIsAdmin: null }));
    expect(byId(result.refusals, 'R-2').status).toBe('unverified');
    expect(result.identityRefused).toBe(true);
    expect(byId(result.refusals, 'R-8').status).toBe('not_evaluated');
  });

  it('R-1 and R-2 are both reported when both hold', () => {
    const result = evaluateAdminDeletionRefusals(facts({ targetId: ADMIN, targetIsAdmin: true }));
    expect(blockingRefusals(result.refusals).map((r) => r.id)).toEqual(['R-1', 'R-2']);
  });

  it('a later fact that was never read fails closed to unverified', () => {
    const result = evaluateAdminDeletionRefusals(facts({ later: undefined }));
    expect(blockingRefusals(result.refusals).map((r) => r.id)).toEqual(['R-3', 'R-5', 'R-6', 'R-8']);
  });
});

describe('R-3 (platform plan subscription), SC-5', () => {
  const row = (o: Partial<{ status: BusinessOsSubscriptionStatus | null; stripeSubscriptionId: string | null; endedAt: string | null }>) => ({
    row: { status: null, stripeSubscriptionId: null, endedAt: null, ...o },
  });

  it.each(R3_LIVE_STATUSES)('applies on status %s (live mode), with the Stripe dashboard and P-7a in its clearing action', (status) => {
    const r3 = byId(evaluateAdminDeletionRefusals(facts({}, { billing: { test: { row: null }, live: row({ status }) } })).refusals, 'R-3');
    expect(r3.status).toBe('applies');
    expect(r3.message).toContain('live mode');
    expect(r3.clearingAction).toContain('Stripe dashboard');
    expect(r3.clearingAction).toContain('P-7a');
  });

  it('applies on the test-mode row too, and names the mode', () => {
    const r3 = byId(
      evaluateAdminDeletionRefusals(facts({}, { billing: { test: row({ status: 'active' }), live: { row: null } } })).refusals,
      'R-3'
    );
    expect(r3.status).toBe('applies');
    expect(r3.message).toContain('test mode');
    expect(r3.detail).toEqual({ liveModes: ['test'], unreadableModes: [] });
  });

  it('live while a subscription id is set and ended_at is null, even if the status says canceled', () => {
    const f = facts({}, { billing: { test: { row: null }, live: row({ status: 'canceled', stripeSubscriptionId: 'sub_1', endedAt: null }) } });
    expect(statusOf(f, 'R-3')).toBe('applies');
  });

  it('not live once ended_at is set and the status is not live', () => {
    const f = facts({}, {
      billing: { test: { row: null }, live: row({ status: 'canceled', stripeSubscriptionId: 'sub_1', endedAt: '2026-09-01T00:00:00Z' }) },
    });
    expect(statusOf(f, 'R-3')).toBe('clear');
    expect(statusOf(facts({}, { billing: { test: row({ status: 'incomplete_expired' }), live: { row: null } } }), 'R-3')).toBe('clear');
  });

  it('an error on EITHER mode is unverified, never clear', () => {
    expect(statusOf(facts({}, { billing: { test: 'unreadable', live: { row: null } } }), 'R-3')).toBe('unverified');
    expect(statusOf(facts({}, { billing: { test: { row: null }, live: 'unreadable' } }), 'R-3')).toBe('unverified');
  });

  it('a live row still applies when the other mode is unreadable', () => {
    expect(statusOf(facts({}, { billing: { test: 'unreadable', live: row({ status: 'active' }) } }), 'R-3')).toBe('applies');
  });

  it('isPlanSubscriptionLive: the rule in one place', () => {
    expect(isPlanSubscriptionLive({ status: 'trialing', stripeSubscriptionId: null, endedAt: null })).toBe(true);
    expect(isPlanSubscriptionLive({ status: null, stripeSubscriptionId: null, endedAt: null })).toBe(false);
    expect(isPlanSubscriptionLive({ status: 'incomplete', stripeSubscriptionId: 'sub_1', endedAt: null })).toBe(true);
  });

  it('R3_LIVE_STATUSES are exactly the five, and every one is a status the repository admits', () => {
    expect([...R3_LIVE_STATUSES].sort()).toEqual(['active', 'past_due', 'paused', 'trialing', 'unpaid']);
    // Exhaustive at compile time (tsc in CI): a missing or extra key fails to type-check.
    const ADMITTED: Record<BusinessOsSubscriptionStatus, true> = {
      incomplete: true,
      incomplete_expired: true,
      trialing: true,
      active: true,
      past_due: true,
      canceled: true,
      unpaid: true,
      paused: true,
    };
    for (const status of R3_LIVE_STATUSES) expect(ADMITTED[status]).toBe(true);
    // And at runtime, against the repository's own status list.
    const repoSource = fs.readFileSync(
      path.join(process.cwd(), 'lib', 'repositories', 'BusinessOsBillingAccountRepository.ts'),
      'utf8'
    );
    const listed = repoSource.slice(repoSource.indexOf('const SUBSCRIPTION_STATUSES'));
    for (const status of R3_LIVE_STATUSES) expect(listed).toContain(`'${status}'`);
  });
});

describe('R-4 (cross-account payer), SA-7', () => {
  it('is always not applicable, with the fixed message', () => {
    for (const f of [facts(), facts({}, { connectAccounts: 3 })]) {
      const r4 = byId(evaluateAdminDeletionRefusals(f).refusals, 'R-4');
      expect(r4.status).toBe('not_applicable');
      expect(r4.message).toBe('No cross-account payment relationship exists.');
    }
  });

  it('carries the "wire R-4 in the same PR" comment', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'adminDeletionRefusals.ts'), 'utf8');
    expect(src).toMatch(/SA-7/);
    expect(src).toMatch(/MUST wire R-4 in the same PR/);
  });
});

describe('R-5 (Stripe Connect)', () => {
  it('applies with any account, clear with none, unverified when unreadable', () => {
    expect(statusOf(facts({}, { connectAccounts: 1 }), 'R-5')).toBe('applies');
    expect(statusOf(facts({}, { connectAccounts: 0 }), 'R-5')).toBe('clear');
    expect(statusOf(facts({}, { connectAccounts: 'unreadable' }), 'R-5')).toBe('unverified');
  });
});

describe('R-6 (local money in flight)', () => {
  it('applies on blocked, clear on clear, unverified on refused (a null count)', () => {
    const blocked = byId(
      evaluateAdminDeletionRefusals(
        facts({}, {
          localBlocking: {
            outcome: 'blocked',
            hits: [{ condition: 'C3', table: 'payment_invoices', count: 2, label: 'unpaid invoice(s) owed to this business' }],
          },
        })
      ).refusals,
      'R-6'
    );
    expect(blocked.status).toBe('applies');
    expect(blocked.message).toContain('2 unpaid invoice(s)');
    expect(statusOf(facts({}, { localBlocking: { outcome: 'clear' } }), 'R-6')).toBe('clear');
    expect(statusOf(facts({}, { localBlocking: { outcome: 'refused', reason: 'x' } }), 'R-6')).toBe('unverified');
  });

  it('re-types no C1–C3 status: the evaluator holds no status literal of LOCAL_BLOCKING_CONDITIONS', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'adminDeletionRefusals.ts'), 'utf8');
    for (const status of ['pending', 'sent', 'overdue']) {
      expect(src).not.toContain(`'${status}'`);
    }
  });
});

describe('R-7 (run in progress), D-4', () => {
  it('is deferred: "Checked at the moment of deletion", never clear', () => {
    const r7 = byId(evaluateAdminDeletionRefusals(facts()).refusals, 'R-7');
    expect(r7.status).toBe('deferred');
    expect(r7.message).toBe('Checked at the moment of deletion.');
  });
});

describe('R-8 (schema classification)', () => {
  it('clear on ok, applies on drift (with the tables), unverified on unreadable and ambiguous', () => {
    expect(statusOf(facts(), 'R-8')).toBe('clear');
    const drift = byId(
      evaluateAdminDeletionRefusals(facts({}, { schema: { status: 'drift', unclassified: ['new_table'], missingDeletable: [] } })).refusals,
      'R-8'
    );
    expect(drift.status).toBe('applies');
    expect(drift.detail).toEqual({ unclassified: ['new_table'], missingDeletable: [] });
    expect(drift.clearingAction).toContain('platform problem');
    expect(statusOf(facts({}, { schema: { status: 'unreadable', unclassified: [], missingDeletable: [] } }), 'R-8')).toBe('unverified');
    expect(statusOf(facts({}, { schema: { status: 'ambiguous', unclassified: [], missingDeletable: [] } }), 'R-8')).toBe('unverified');
  });
});

describe('every refusal is returned together (SC-4)', () => {
  it('R-3, R-5, R-6 and R-8 all block at once, in order', () => {
    const result = evaluateAdminDeletionRefusals(
      facts({}, {
        billing: { test: { row: null }, live: 'unreadable' },
        connectAccounts: 2,
        localBlocking: { outcome: 'refused', reason: 'could not read blocking state for: payment_refunds' },
        schema: { status: 'drift', unclassified: ['x'], missingDeletable: [] },
      })
    );
    expect(blockingRefusals(result.refusals).map((r) => `${r.id}:${r.status}`)).toEqual([
      'R-3:unverified',
      'R-5:applies',
      'R-6:unverified',
      'R-8:applies',
    ]);
  });
});

describe('R-8 includes the delete-graph verdict (AD-2a)', () => {
  it('a refused graph: R-8 applies even with a classified schema', () => {
    expect(statusOf(facts({}, { deleteGraph: { status: 'refused' } }), 'R-8')).toBe('applies');
  });

  it('an unreadable graph: R-8 unverified (never a pass)', () => {
    expect(statusOf(facts({}, { deleteGraph: { status: 'unreadable' } }), 'R-8')).toBe('unverified');
  });

  it('a graph that was never read: R-8 unverified (fail closed)', () => {
    const f = facts();
    const later = { ...f.later } as Partial<AdminDeletionLaterFacts>;
    delete later.deleteGraph;
    expect(statusOf({ ...f, later: later as AdminDeletionLaterFacts }, 'R-8')).toBe('unverified');
  });

  it('schema drift still wins over a clean graph', () => {
    expect(
      statusOf(facts({}, { schema: { status: 'drift', unclassified: ['x'], missingDeletable: [] }, deleteGraph: { status: 'ok' } }), 'R-8')
    ).toBe('applies');
  });
});

describe('R-7 applies form (AD-2a, AC-A11)', () => {
  it('is a blocking refusal with a clearing action', () => {
    const r7 = r7AlreadyRunning();
    expect(r7).toMatchObject({ id: 'R-7', status: 'applies' });
    expect(BLOCKING_REFUSAL_STATUSES.has(r7.status)).toBe(true);
    expect(r7.clearingAction).toBeTruthy();
  });
});
