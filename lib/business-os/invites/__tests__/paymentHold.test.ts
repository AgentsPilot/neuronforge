/**
 * The payment hold (Slice 5b; T-13 layer 2, F5b-4; workplan D-7, SA R-3,
 * Q-2) and its gate (D-8, SA R-1, R-2, R-4).
 *
 *   - keyed on LINEAGE, never on `origin`, and mode-independent;
 *   - an unpaid friend is held on the lineage read ALONE (R-3);
 *   - fail open only when a DECIDING read fails (Q-2), logged;
 *   - the gate is the first statement of all four layouts (R-1, R-2);
 *   - the holding screen's read never turns an error into "not held" (R-4).
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import type { BusinessOsAccountHoldFacts, BusinessOsInviteHoldFacts } from '@/lib/repositories/types';

jest.mock('server-only', () => ({}));

const redirects: string[] = [];
jest.mock('next/navigation', () => ({
  redirect: (path: string) => {
    redirects.push(path);
    throw Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;${path}` });
  },
}));

const session: { user: { id: string } | null; throws: boolean } = { user: null, throws: false };
jest.mock('@/lib/auth', () => ({
  getUser: async () => {
    if (session.throws) throw new Error('cookie store unavailable');
    return session.user;
  },
}));

const logs: Array<{ level: string; context: unknown; message: string }> = [];
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {};
  for (const level of ['info', 'warn', 'error', 'debug']) {
    logger[level] = (context: unknown, message: string) => logs.push({ level, context, message });
  }
  logger.child = () => logger;
  return { createLogger: () => logger };
});

const store: {
  lineage: BusinessOsAccountHoldFacts | null | 'error';
  invite: BusinessOsInviteHoldFacts | null | 'error';
  lineageReads: string[];
  inviteReads: string[];
} = { lineage: null, invite: null, lineageReads: [], inviteReads: [] };

jest.mock('@/lib/repositories/BusinessOsAccountLineageRepository', () => ({
  businessOsAccountLineageRepository: {
    findHoldFactsForAccount: async (accountId: string) => {
      store.lineageReads.push(accountId);
      return store.lineage === 'error' ? { data: null, error: new Error('down') } : { data: store.lineage, error: null };
    },
  },
}));
jest.mock('@/lib/repositories/BusinessOsInviteRepository', () => ({
  businessOsInviteRepository: {
    findHoldFactsById: async (id: string) => {
      store.inviteReads.push(id);
      return store.invite === 'error' ? { data: null, error: new Error('down') } : { data: store.invite, error: null };
    },
  },
}));

import { AWAITING_PAYMENT_PATH, isAwaitingPayment, readPaymentHold, type PaymentHoldReaders } from '../paymentHold';
import { readHoldForSession, redirectIfAwaitingPayment } from '../paymentHoldGate';

const ACCOUNT = '55555555-5555-4555-8555-555555555555';
const INVITE = '66666666-6666-4666-8666-666666666666';

const friendLineage = (overrides: Partial<BusinessOsAccountHoldFacts> = {}): BusinessOsAccountHoldFacts => ({
  invite_id: INVITE,
  source: 'account_invite',
  first_paid_at: null,
  ...overrides,
});

beforeEach(() => {
  redirects.length = 0;
  logs.length = 0;
  session.user = null;
  session.throws = false;
  store.lineage = null;
  store.invite = null;
  store.lineageReads = [];
  store.inviteReads = [];
});

describe('isAwaitingPayment (the predicate, T-13 / F5b-4)', () => {
  it.each([
    ['no lineage (pre-invite or organic account)', null, undefined, false],
    ['an unpaid friend', friendLineage(), undefined, true],
    ['a friend who paid (5c)', friendLineage({ first_paid_at: '2026-11-01T00:00:00.000Z' }), undefined, false],
    ['an admin Paid invite, unpaid (5c)', friendLineage({ source: 'admin_invite' }), 'tier', true],
    ['an admin champion invite', friendLineage({ source: 'admin_invite' }), 'cohort', false],
    ['an admin invite whose grant was not read', friendLineage({ source: 'admin_invite' }), undefined, false],
    ['an organic row', friendLineage({ source: 'organic', invite_id: null }), undefined, false],
  ] as const)('%s → %s', (_label, lineage, grant, expected) => {
    expect(isAwaitingPayment(lineage, grant)).toBe(expected);
  });
});

describe('readPaymentHold (D-7, SA R-3, Q-2)', () => {
  const readers = (): PaymentHoldReaders => ({
    lineage: {
      findHoldFactsForAccount: jest.fn(async (accountId: string) => {
        store.lineageReads.push(accountId);
        return store.lineage === 'error' ? { data: null, error: new Error('down') } : { data: store.lineage, error: null };
      }),
    },
    invites: {
      findHoldFactsById: jest.fn(async (id: string) => {
        store.inviteReads.push(id);
        return store.invite === 'error' ? { data: null, error: new Error('down') } : { data: store.invite, error: null };
      }),
    },
  });

  it('no lineage row: not held, with ONE read (most accounts)', async () => {
    expect(await readPaymentHold(ACCOUNT, readers())).toEqual({ ok: true, held: false });
    expect(store.lineageReads).toEqual([ACCOUNT]);
    expect(store.inviteReads).toEqual([]);
  });

  it('R-3: an unpaid friend is held on the lineage alone; the invite is never read, so its failure cannot release them', async () => {
    store.lineage = friendLineage();
    store.invite = 'error';
    expect(await readPaymentHold(ACCOUNT, readers())).toEqual({ ok: true, held: true, inviteId: INVITE, source: 'account_invite' });
    expect(store.inviteReads).toEqual([]);
  });

  it('a paid friend is not held', async () => {
    store.lineage = friendLineage({ first_paid_at: '2026-11-01T00:00:00.000Z' });
    expect(await readPaymentHold(ACCOUNT, readers())).toEqual({ ok: true, held: false });
  });

  it('5c case: an unpaid admin Paid invite is held; an admin champion is not', async () => {
    store.lineage = friendLineage({ source: 'admin_invite' });
    store.invite = { grant_kind: 'tier', language: 'en' };
    expect(await readPaymentHold(ACCOUNT, readers())).toEqual({ ok: true, held: true, inviteId: INVITE, source: 'admin_invite' });
    store.invite = { grant_kind: 'cohort', language: 'en' };
    expect(await readPaymentHold(ACCOUNT, readers())).toEqual({ ok: true, held: false });
  });

  it('Q-2: a failed lineage read is { ok: false }, never a verdict', async () => {
    store.lineage = 'error';
    expect(await readPaymentHold(ACCOUNT, readers())).toEqual({ ok: false });
  });

  it('Q-2: for an admin invite row, a failed invite read is { ok: false } (5c revisits)', async () => {
    store.lineage = friendLineage({ source: 'admin_invite' });
    store.invite = 'error';
    expect(await readPaymentHold(ACCOUNT, readers())).toEqual({ ok: false });
  });
});

describe('redirectIfAwaitingPayment (the layouts gate, D-8)', () => {
  const run = async () => {
    try {
      await redirectIfAwaitingPayment();
      return 'rendered';
    } catch (error) {
      return (error as Error).message;
    }
  };

  it('a held friend is redirected to the holding screen, keyed by the SESSION account', async () => {
    session.user = { id: ACCOUNT };
    store.lineage = friendLineage();
    expect(await run()).toBe('NEXT_REDIRECT');
    expect(redirects).toEqual([AWAITING_PAYMENT_PATH]);
    expect(AWAITING_PAYMENT_PATH).toBe('/invite/awaiting-payment');
    expect(store.lineageReads).toEqual([ACCOUNT]);
  });

  it('an account that is not held renders', async () => {
    session.user = { id: ACCOUNT };
    expect(await run()).toBe('rendered');
    expect(redirects).toEqual([]);
  });

  it('signed out: renders, and reads nothing', async () => {
    expect(await run()).toBe('rendered');
    expect(store.lineageReads).toEqual([]);
  });

  it('a session read that throws falls through open, logged (Q-2)', async () => {
    session.throws = true;
    expect(await run()).toBe('rendered');
    expect(logs.some((entry) => entry.level === 'warn')).toBe(true);
  });

  it('Q-2: an unreadable hold fails OPEN, logged at error', async () => {
    session.user = { id: ACCOUNT };
    store.lineage = 'error';
    expect(await run()).toBe('rendered');
    expect(logs.filter((entry) => entry.level === 'error').map((entry) => entry.message)).toContain(
      'Payment hold unreadable; failing open (SA Q-2)'
    );
  });
});

describe('readHoldForSession (the holding screen, SA R-4)', () => {
  it('signed out', async () => {
    expect(await readHoldForSession()).toEqual({ state: 'signed_out' });
  });

  it('not held', async () => {
    session.user = { id: ACCOUNT };
    expect(await readHoldForSession()).toEqual({ state: 'not_held' });
  });

  it('held: in the invite language', async () => {
    session.user = { id: ACCOUNT };
    store.lineage = friendLineage();
    store.invite = { grant_kind: 'tier', language: 'he' };
    expect(await readHoldForSession()).toEqual({ state: 'held', language: 'he' });
    expect(store.inviteReads).toEqual([INVITE]);
  });

  it('held: a failed or unknown language read falls back to English and STAYS held', async () => {
    session.user = { id: ACCOUNT };
    store.lineage = friendLineage();
    store.invite = 'error';
    expect(await readHoldForSession()).toEqual({ state: 'held', language: 'en' });
    store.invite = { grant_kind: 'tier', language: 'fr' };
    expect(await readHoldForSession()).toEqual({ state: 'held', language: 'en' });
  });

  it('R-4: an unreadable hold is the error state, never "not held"', async () => {
    session.user = { id: ACCOUNT };
    store.lineage = 'error';
    expect(await readHoldForSession()).toEqual({ state: 'error' });
  });
});

describe('where the gate runs (SA R-1, R-2) and what it never reads', () => {
  const ROOT = process.cwd();
  const read = (relative: string) => readFileSync(join(ROOT, relative), 'utf8');
  const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it.each([
    'app/onboarding-chat/layout.tsx',
    'app/onboarding-build/layout.tsx',
    'app/business-os/layout.tsx',
    'app/test-business-os/layout.tsx',
  ])('%s awaits the gate as the first statement of its default export', (file) => {
    const text = code(read(file));
    expect(text).toContain("import { redirectIfAwaitingPayment } from '@/lib/business-os/invites/paymentHoldGate';");
    const body = text.slice(text.indexOf('export default async function'));
    const firstStatement = body.slice(body.indexOf('{', body.indexOf(')')) + 1).trim().split(';')[0];
    expect(firstStatement).toBe('await redirectIfAwaitingPayment()');
  });

  it.each([
    'app/onboarding-chat/layout.tsx',
    'app/onboarding-build/layout.tsx',
    'app/business-os/layout.tsx',
    'app/test-business-os/layout.tsx',
    'app/invite/awaiting-payment/page.tsx',
  ])('%s is force-dynamic, so the gate is never skipped by a static render (SA N-2)', (file) => {
    expect(code(read(file))).toContain("export const dynamic = 'force-dynamic';");
  });

  it.each(['lib/business-os/invites/paymentHold.ts', 'app/invite/awaiting-payment/page.tsx', 'app/invite/awaitingPaymentCopy.ts'])(
    '%s imports nothing from the entitlements module (mode-independent, F5b-4)',
    (file) => {
      expect(code(read(file))).not.toMatch(/business-os\/entitlements/);
    }
  );

  it('the gate reads no mode, snapshot, decision or plan row, and takes only the account seam', () => {
    const text = code(read('lib/business-os/invites/paymentHoldGate.ts'));
    expect(text.match(/from '@\/lib\/business-os\/entitlements\/[^']+'/g)).toEqual(["from '@/lib/business-os/entitlements/account'"]);
    // Only the lineage and invite repositories: never the plan repository.
    expect(text.match(/from '@\/lib\/repositories\/[^']+'/g)?.sort()).toEqual([
      "from '@/lib/repositories/BusinessOsAccountLineageRepository'",
      "from '@/lib/repositories/BusinessOsInviteRepository'",
    ]);
    expect(text).not.toMatch(/EntitlementService|getSnapshot|\bcheck\(|BOS_ENTITLEMENTS_MODE|\borigin\b/);
  });

  it('the redirect is never inside a try block', () => {
    const text = code(read('lib/business-os/invites/paymentHoldGate.ts'));
    for (const block of text.split('try {').slice(1)) {
      expect(block.slice(0, block.indexOf('}'))).not.toContain('redirect(');
    }
  });
});
