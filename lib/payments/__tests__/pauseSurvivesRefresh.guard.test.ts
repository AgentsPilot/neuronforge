/**
 * An owner's pause must outlive Stripe's opinion.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * "Disconnect" in Business Setup → Payments used to set `charges_enabled`,
 * `payouts_enabled` and `details_submitted` to false and send nothing to
 * Stripe. Those three columns record what STRIPE says. The dialog reused them
 * to mean what the OWNER chose.
 *
 * Every time the Configuration dialog opened it called
 * /api/payments/stripe-connect/refresh-status, which asks Stripe for the live
 * flags and writes them back. Stripe had never heard of the disconnect, so it
 * answered "enabled" — and the account silently reconnected with the owner
 * having done nothing. The button undid itself, and nothing in a log said why.
 *
 * `paused_at` separates the two facts. The rule is one line:
 *
 *     refresh-status must never write paused_at or paused_by.
 *
 * It is pinned here because the failure is silent. Nothing throws, no test of
 * the pause logic fails; the owner simply keeps getting paid by card after
 * asking not to be.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * What has to hold is that one route never names two columns. That is a fact
 * about the code, and exercising it would need a database and a Stripe stub.
 * The decision itself is tested behaviourally below, against the pure function.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { decideCollectionCapability } from '@/lib/payments/stripeAccountContext';

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');

/** Comments may DISCUSS the columns; only live code must not write them. */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('refresh-status never overwrites the owner decision', () => {
  it('does not mention paused_at or paused_by in live code', () => {
    const code = stripComments(
      read('app/api/payments/stripe-connect/refresh-status/route.ts')
    );

    expect(code).not.toMatch(/paused_at/);
    expect(code).not.toMatch(/paused_by/);
  });

  it('still writes the Stripe status flags, so the guard is not vacuous', () => {
    // If this route stopped updating at all, the test above would pass for the
    // wrong reason.
    const code = stripComments(
      read('app/api/payments/stripe-connect/refresh-status/route.ts')
    );

    expect(code).toMatch(/charges_enabled/);
  });
});

describe('only two places may write the pause', () => {
  it('disconnect sets it and the onboarding callback clears it', () => {
    expect(stripComments(read('app/api/payments/stripe-connect/disconnect/route.ts')))
      .toMatch(/paused_at:\s*new Date\(\)\.toISOString\(\)/);

    // Reconnecting is the owner undoing the pause. Without this an owner who
    // paused and then reconnected would stay paused for ever.
    expect(stripComments(read('app/api/payments/stripe-connect/callback/route.ts')))
      .toMatch(/paused_at:\s*null/);
  });
});

describe('decideCollectionCapability honours the pause', () => {
  const live = {
    stripe_account_id: 'acct_1234567890',
    charges_enabled: true,
    payouts_enabled: true,
    details_submitted: true,
  };

  it('refuses while paused, even though Stripe says charges are enabled', () => {
    // The whole point: Stripe is never told, so it keeps answering yes.
    expect(decideCollectionCapability({ ...live, paused_at: '2026-10-09T10:00:00Z' }))
      .toEqual({ canCollect: false, reason: 'paused_by_owner', accountId: 'acct_1234567890' });
  });

  it('collects once the pause is cleared', () => {
    expect(decideCollectionCapability({ ...live, paused_at: null }))
      .toEqual({ canCollect: true, accountId: 'acct_1234567890' });
  });

  it('a row with no pause column at all still collects', () => {
    // Rows written before the column existed carry undefined, not null.
    expect(decideCollectionCapability(live))
      .toEqual({ canCollect: true, accountId: 'acct_1234567890' });
  });

  it('reports paused_by_owner, not disconnected, so a surface can offer "resume"', () => {
    // `disconnected` cannot tell an owner's choice apart from Stripe switching
    // the account off; both land on charges_enabled = false.
    const paused = decideCollectionCapability({
      ...live,
      charges_enabled: false,
      paused_at: '2026-10-09T10:00:00Z',
    });

    expect(paused).toMatchObject({ canCollect: false, reason: 'paused_by_owner' });
  });
});
