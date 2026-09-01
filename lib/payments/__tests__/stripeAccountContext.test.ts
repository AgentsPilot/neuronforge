/**
 * The account rules, asserted.
 *
 * These decide whether a refund reaches the right Stripe balance. The dangerous
 * failure is not an exception — it is a plausible-looking guess that refunds
 * from the wrong account, so the tests that matter most are the ones proving we
 * REFUSE.
 */

import {
  decideCollectionCapability,
  describeChargeAccount,
  locatePaymentIntentAccount,
  resolveRefundAccount,
  resolveAccountOwner,
  resolvePaymentCollectionCapability,
  resolveUserConnectAccounts,
  toPublicCollectionState,
  stripeRequestOptions,
} from '../stripeAccountContext';

/**
 * A Stripe stand-in where a payment intent exists on exactly one account.
 * `where` is null for the platform, or an account id.
 */
function fakeStripe(where: string | null | 'nowhere') {
  return {
    paymentIntents: {
      retrieve: async (_id: string, options?: { stripeAccount: string }) => {
        const asked = options?.stripeAccount ?? null;
        if (where !== 'nowhere' && asked === where) return {};
        throw new Error('No such payment_intent');
      },
    },
  };
}

/** Minimal stand-in for the two tables this consults. */
function fakeDb(opts: { express?: string | null; plugin?: string | null }) {
  return {
    from(table: string) {
      const row =
        table === 'stripe_connect_accounts'
          ? opts.express
            ? { stripe_account_id: opts.express }
            : null
          : opts.plugin
            ? { profile_data: { stripe_account_id: opts.plugin }, status: 'active' }
            : null;

      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({ data: row, error: null }),
      };
      return builder;
    },
  } as never;
}

describe('describeChargeAccount', () => {
  it('records a connected account as connect', () => {
    expect(describeChargeAccount('acct_123')).toEqual({
      stripe_connect_account_id: 'acct_123',
      charge_account_kind: 'connect',
      account_resolution: 'recorded',
    });
  });

  it('records absence as the PLATFORM, not as unknown', () => {
    // The whole point of charge_account_kind. A null id alone cannot tell
    // "the platform took this" from "nobody wrote it down", and conflating
    // those is what lets a refund guess.
    for (const empty of [null, undefined]) {
      expect(describeChargeAccount(empty)).toEqual({
        stripe_connect_account_id: null,
        charge_account_kind: 'platform',
        account_resolution: 'recorded',
      });
    }
  });
});

describe('resolveRefundAccount', () => {
  it('uses a recorded connected account', () => {
    expect(
      resolveRefundAccount({ stripe_connect_account_id: 'acct_123', account_resolution: 'recorded' })
    ).toEqual({ ok: true, stripeAccount: 'acct_123' });
  });

  it('treats a recorded null as the platform, and allows it', () => {
    expect(
      resolveRefundAccount({ stripe_connect_account_id: null, account_resolution: 'recorded' })
    ).toEqual({ ok: true, stripeAccount: null });
  });

  it('trusts a reconciled account', () => {
    expect(
      resolveRefundAccount({ stripe_connect_account_id: 'acct_9', account_resolution: 'reconciled' })
    ).toEqual({ ok: true, stripeAccount: 'acct_9' });
  });

  it('REFUSES when the account was never recorded', () => {
    // Every legacy row. Refusing costs a support ticket; guessing can return
    // money from the wrong balance.
    const decision = resolveRefundAccount({ account_resolution: 'unknown' });
    expect(decision.ok).toBe(false);
    expect(decision).toMatchObject({ reason: 'ACCOUNT_UNRESOLVED' });
  });

  it('REFUSES when the charge was found on more than one account', () => {
    const decision = resolveRefundAccount({
      stripe_connect_account_id: 'acct_1',
      account_resolution: 'ambiguous',
    });
    expect(decision.ok).toBe(false);
  });

  it('REFUSES on a missing resolution rather than defaulting to allow', () => {
    // A row written by code that predates these columns must not be refundable
    // just because the field is absent.
    expect(resolveRefundAccount({}).ok).toBe(false);
    expect(resolveRefundAccount({ account_resolution: null }).ok).toBe(false);
    // Not even when an account id happens to be sitting there.
    expect(resolveRefundAccount({ stripe_connect_account_id: 'acct_1' }).ok).toBe(false);
  });
});

describe('stripeRequestOptions', () => {
  it('omits the options object entirely for the platform', () => {
    // `{ stripeAccount: undefined }` is not the same as no options object —
    // the SDK distinguishes them.
    expect(stripeRequestOptions(null)).toBeUndefined();
  });

  it('passes the account through for a connected charge', () => {
    expect(stripeRequestOptions('acct_123')).toEqual({ stripeAccount: 'acct_123' });
  });
});

describe('locatePaymentIntentAccount', () => {
  const candidates = [
    { accountId: 'acct_a', source: 'stripe_connect_accounts' as const },
    { accountId: 'acct_b', source: 'plugin_connections' as const },
  ];

  it('finds a charge on a connected account and marks it recorded', async () => {
    const result = await locatePaymentIntentAccount(fakeStripe('acct_b'), 'pi_1', candidates);
    expect(result).toEqual({
      stripe_connect_account_id: 'acct_b',
      charge_account_kind: 'connect',
      account_resolution: 'recorded',
    });
  });

  it('finds a genuine platform charge', async () => {
    const result = await locatePaymentIntentAccount(fakeStripe(null), 'pi_1', candidates);
    expect(result).toEqual({
      stripe_connect_account_id: null,
      charge_account_kind: 'platform',
      account_resolution: 'recorded',
    });
  });

  it('marks it ambiguous when Stripe has it nowhere', async () => {
    // The id was wrong or invented — which is the reason a client-supplied
    // payment intent is never taken on trust. The payment still gets recorded;
    // it is just not refundable until reconciled.
    const result = await locatePaymentIntentAccount(fakeStripe('nowhere'), 'pi_1', candidates);
    expect(result.account_resolution).toBe('ambiguous');
  });

  it('does not treat a 404 on the platform as failure', async () => {
    // Stripe namespaces ids per account, so a connected charge is genuinely
    // absent from the platform. That absence is an answer, not an error.
    const result = await locatePaymentIntentAccount(fakeStripe('acct_a'), 'pi_1', candidates);
    expect(result.account_resolution).toBe('recorded');
    expect(result.stripe_connect_account_id).toBe('acct_a');
  });

  it('is ambiguous, never a guess, when the business has no accounts', async () => {
    const result = await locatePaymentIntentAccount(fakeStripe('nowhere'), 'pi_1', []);
    expect(result.account_resolution).toBe('ambiguous');
    // And that value makes the refund path refuse.
    expect(resolveRefundAccount(result).ok).toBe(false);
  });
});

describe('resolveUserConnectAccounts', () => {
  it('puts the Express table first, then the OAuth plugin', () => {
    // One order for every caller. The routes previously disagreed, so a business
    // with two records could be charged on one account and refunded on another.
    const result = resolveUserConnectAccounts(fakeDb({ express: 'acct_a', plugin: 'acct_b' }), 'u1');
    return result.then(accounts => {
      expect(accounts.map(a => a.accountId)).toEqual(['acct_a', 'acct_b']);
      expect(accounts.map(a => a.source)).toEqual(['stripe_connect_accounts', 'plugin_connections']);
    });
  });

  it('deduplicates the same account held in both tables', async () => {
    // The healthy case. Listing it twice would make a probe report a false
    // "found on more than one account".
    const accounts = await resolveUserConnectAccounts(
      fakeDb({ express: 'acct_same', plugin: 'acct_same' }),
      'u1'
    );
    expect(accounts).toHaveLength(1);
  });

  it('finds an account held only by the plugin', async () => {
    const accounts = await resolveUserConnectAccounts(fakeDb({ plugin: 'acct_oauth' }), 'u1');
    expect(accounts).toEqual([{ accountId: 'acct_oauth', source: 'plugin_connections' }]);
  });

  it('returns nothing when the business has connected no account', async () => {
    expect(await resolveUserConnectAccounts(fakeDb({}), 'u1')).toEqual([]);
  });
});

/**
 * The reverse lookup: which business owns an account.
 *
 * This is a security control, not a convenience. Without it every Connect
 * webhook handler is addressable by id alone, and a connected business can have
 * another tenant's invoice marked paid with money that landed in its own
 * balance. The tests that matter are the ones proving it says NO.
 */
describe('resolveAccountOwner', () => {
  /** Stand-in for the two tables the lookup consults. */
  function ownerDb(opts: {
    express?: Array<{ user_id: string; stripe_account_id: string }>;
    plugin?: Array<{ user_id: string; profile_data: Record<string, string> }>;
  }) {
    return {
      from(table: string) {
        if (table === 'stripe_connect_accounts') {
          return {
            select: () => ({
              eq: (_col: string, value: string) => ({
                maybeSingle: async () => ({
                  data: (opts.express ?? []).find(r => r.stripe_account_id === value) ?? null,
                }),
              }),
            }),
          };
        }
        return {
          select: () => ({
            eq: async () => ({ data: opts.plugin ?? [] }),
          }),
        };
      },
    };
  }

  it('finds the owner on the express table', async () => {
    const db = ownerDb({ express: [{ user_id: 'u1', stripe_account_id: 'acct_a' }] });
    expect(await resolveAccountOwner(db, 'acct_a')).toBe('u1');
  });

  it('finds the owner on the OAuth connection, where the id is inside profile_data', async () => {
    const db = ownerDb({ plugin: [{ user_id: 'u2', profile_data: { stripe_account_id: 'acct_b' } }] });
    expect(await resolveAccountOwner(db, 'acct_b')).toBe('u2');
  });

  it('accepts the alternate profile_data shape', async () => {
    const db = ownerDb({ plugin: [{ user_id: 'u3', profile_data: { id: 'acct_c' } }] });
    expect(await resolveAccountOwner(db, 'acct_c')).toBe('u3');
  });

  it('returns null for an account belonging to nobody', async () => {
    // The caller must treat this as "not proven", never as "allowed".
    const db = ownerDb({ express: [{ user_id: 'u1', stripe_account_id: 'acct_a' }] });
    expect(await resolveAccountOwner(db, 'acct_unknown')).toBeNull();
  });

  it('does not hand one business the account of another', async () => {
    // The attack this exists to stop: acct_attacker naming u_victim's record.
    const db = ownerDb({
      express: [
        { user_id: 'u_victim', stripe_account_id: 'acct_victim' },
        { user_id: 'u_attacker', stripe_account_id: 'acct_attacker' },
      ],
    });
    expect(await resolveAccountOwner(db, 'acct_attacker')).toBe('u_attacker');
    expect(await resolveAccountOwner(db, 'acct_attacker')).not.toBe('u_victim');
  });
});

/**
 * Whether a business can be paid at all.
 *
 * The failure this guards against is not an exception. It is an invoice sent
 * with a live Pay button by a business that cannot receive a penny — recorded
 * as a success, and discovered only by the client. So, as everywhere else in
 * this file, the tests that matter are the ones proving we REFUSE.
 */
describe('decideCollectionCapability', () => {
  const ready = {
    stripe_account_id: 'acct_live',
    charges_enabled: true,
    payouts_enabled: true,
    details_submitted: true,
  };

  it('collects when Stripe says charges are enabled', () => {
    expect(decideCollectionCapability(ready)).toEqual({ canCollect: true, accountId: 'acct_live' });
  });

  it('COLLECTS when charges work but payouts are held', () => {
    // The money is real and arrives once verification clears. Refusing here
    // would turn away a sale over the owner's paperwork.
    expect(
      decideCollectionCapability({ ...ready, payouts_enabled: false })
    ).toEqual({ canCollect: true, accountId: 'acct_live' });
  });

  it('refuses when onboarding says complete but charges are off', () => {
    // The case the setup checklist gets wrong: `onboarding_completed` is stored
    // as charges AND payouts, so it is not the question being asked.
    expect(
      decideCollectionCapability({ ...ready, charges_enabled: false })
    ).toEqual({ canCollect: false, reason: 'disconnected', accountId: 'acct_live' });
  });

  it('distinguishes never-onboarded from disabled', () => {
    expect(
      decideCollectionCapability({ ...ready, charges_enabled: false, details_submitted: false })
    ).toEqual({ canCollect: false, reason: 'never_onboarded', accountId: 'acct_live' });
  });

  it('reports verification_pending when charges are neither true nor false', () => {
    expect(
      decideCollectionCapability({ stripe_account_id: 'acct_live', details_submitted: true })
    ).toEqual({ canCollect: false, reason: 'verification_pending', accountId: 'acct_live' });
  });

  it('refuses with no account at all', () => {
    expect(decideCollectionCapability(null)).toEqual({
      canCollect: false,
      reason: 'no_account',
      accountId: null,
    });
  });

  it('refuses a placeholder account id even when every flag says yes', () => {
    // A fixture account charging real clients is the failure this prevents.
    for (const id of ['acct_mock_blocked_aa61fec8', 'acct_test_placeholder_1']) {
      expect(decideCollectionCapability({ ...ready, stripe_account_id: id })).toEqual({
        canCollect: false,
        reason: 'no_account',
        accountId: null,
      });
    }
  });

  it('never says yes on absent evidence', () => {
    // The same rule resolveRefundAccount enforces above: unknown is not
    // permission. An empty row must not read as a working account.
    expect(decideCollectionCapability({}).canCollect).toBe(false);
    expect(decideCollectionCapability(undefined).canCollect).toBe(false);
  });
});

describe('resolvePaymentCollectionCapability', () => {
  /** Stand-in for the one table this reads. */
  function readinessDb(result: { data?: unknown; error?: unknown }) {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: result.data ?? null, error: result.error ?? null }) }),
        }),
      }),
    };
  }

  it('reads the account and decides', async () => {
    const db = readinessDb({
      data: { stripe_account_id: 'acct_live', charges_enabled: true, details_submitted: true },
    });
    expect(await resolvePaymentCollectionCapability(db, 'u1')).toEqual({
      canCollect: true,
      accountId: 'acct_live',
    });
  });

  it('refuses when the read itself fails', async () => {
    // A failed read is not a "no", but it is certainly not a "yes" — and yes is
    // the only answer that moves money.
    const db = readinessDb({ error: new Error('connection reset') });
    expect((await resolvePaymentCollectionCapability(db, 'u1')).canCollect).toBe(false);
  });
});

describe('toPublicCollectionState', () => {
  it('never leaks the account id to a browser', () => {
    const state = toPublicCollectionState({ canCollect: true, accountId: 'acct_live' });
    expect(state).toEqual({ canCollect: true });
    expect(JSON.stringify(state)).not.toContain('acct_live');
  });

  it('carries the reason through so each surface can word it itself', () => {
    expect(
      toPublicCollectionState({ canCollect: false, reason: 'never_onboarded', accountId: 'acct_x' })
    ).toEqual({ canCollect: false, reason: 'never_onboarded' });
  });
});
