/**
 * @jest-environment jsdom
 *
 * Plan payments P-9.2 (SA code review P-9.1, D-1: REQUIRED): an ADMIN Paid
 * invitee in the admin Signup Invites list, end to end from the server's own
 * list operation to the rendered row:
 *   - accepted, unpaid (held)            → "Signed up, not paid";
 *   - first payment stamped + money row  → "Paid · <date> · $<amount> USD", with
 *                                          "Test payment" for a test-mode one;
 *   - an admin CHAMPION (cohort) invitee → no payment line (never held).
 * The real `listInvitesForAdmin` (P-5b.2's derivation, unchanged) feeds the
 * real `InviteList`; only the repositories are fakes. Invented ids and amounts.
 */

jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';

import { CHAMPION_INVITE_TYPE, INVITE_TYPES, PAID_INVITE_TYPE } from '@/lib/business-os/entitlements/config/invites';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import { listInvitesForAdmin } from '@/lib/business-os/invites/adminInviteOps';
import type { BusinessOsInvite } from '@/lib/repositories/types';

import { InviteList } from '../components/InviteList';
import type { InviteRow } from '../types';

const NOW = new Date('2026-10-14T12:00:00.000Z');
const config = getEntitlementConfig();
const ADMIN = '22222222-2222-4222-8222-222222222222';
const INVITEE_ACCOUNT = '33333333-3333-4333-8333-333333333333';
const INVOICE = 'in_fixture_admin_paid';
const TOP_TIER = TIER_ORDER[TIER_ORDER.length - 1];

function invite(overrides: Partial<BusinessOsInvite> = {}): BusinessOsInvite {
  return {
    id: 'invite-admin-paid',
    email: 'buyer@example.com',
    email_locked: true,
    invite_type: PAID_INVITE_TYPE,
    grant_kind: 'tier',
    grant_id: TOP_TIER,
    access_open_ended: null,
    access_months: null,
    issuer_kind: 'admin',
    issuer_admin_id: ADMIN,
    issuer_account_id: null,
    inviter_display_name: 'Dana Admin',
    language: 'he',
    personal_note: null,
    internal_reason: 'P-9.2 fixture',
    link_expiry_days: 30,
    link_expires_at: '2026-11-13T12:00:00.000Z',
    first_viewed_at: '2026-10-14T09:00:00.000Z',
    revoked_at: null,
    revoked_by_admin_id: null,
    revoke_reason: null,
    redeemed_at: '2026-10-14T10:00:00.000Z',
    redeemed_account_id: INVITEE_ACCOUNT,
    opened_by_existing_account_at: null,
    claimed_at: '2026-10-14T09:59:00.000Z',
    claimed_account_id: INVITEE_ACCOUNT,
    redemption_failed_at: null,
    redemption_failed_step: null,
    redemption_error_code: null,
    redemption_error_message: null,
    redemption_failed_account_id: null,
    email_attempted_at: null,
    email_sent_at: null,
    email_provider_message_id: null,
    email_problem: null,
    email_problem_at: null,
    created_at: '2026-10-14T08:00:00.000Z',
    updated_at: '2026-10-14T10:00:00.000Z',
    ...overrides,
  } as BusinessOsInvite;
}

async function listAndRender(
  row: BusinessOsInvite,
  stamp: { first_paid_at: string | null; first_payment_ref: string | null },
  money: Array<{ accountId: string; invoiceId: string; amountMinor: number; amountTaxMinor: number | null; currency: 'usd'; paidAt: string; livemode: boolean }> = []
) {
  const outcome = await listInvitesForAdmin({
    repository: { listRecentForAdmin: async () => ({ data: [row], error: null }) },
    lineage: {
      findByInviteIdsForAdmin: async (ids: string[]) => ({
        data: ids.includes(row.id)
          ? [{ account_id: INVITEE_ACCOUNT, invite_id: row.id, level: 1, parent_account_id: null, source: 'admin_invite' as const, ...stamp }]
          : [],
        error: null,
      }),
    } as never,
    billingEvents: { findPaidInvoicesForAccounts: async () => ({ data: money, error: null }) } as never,
    config,
    now: NOW,
    logger: { warn: () => undefined },
  });
  if (!outcome.ok) throw new Error('expected the list');
  render(<InviteList invites={outcome.invites as unknown as InviteRow[]} onRevoke={() => undefined} />);
  return { tr: screen.getByTestId(`invite-row-${row.id}`), view: outcome.invites[0] };
}

describe('D-1 (required): an admin Paid invitee in the admin list', () => {
  it('accepted and unpaid (held): L1, "Signed up, not paid"', async () => {
    const { tr, view } = await listAndRender(invite(), { first_paid_at: null, first_payment_ref: null });
    expect(view.payment).toEqual({ state: 'awaiting_payment' });
    expect(view.level).toBe(1);
    expect(within(tr).getByTestId('invite-payment-state')).toHaveTextContent('Signed up, not paid');
    expect(within(tr).queryByTestId('invite-payment-detail')).not.toBeInTheDocument();
  });

  it('after the first payment: "Paid", the UTC date and the amount from the money history, and "Test payment"', async () => {
    const { tr, view } = await listAndRender(invite(), { first_paid_at: '2026-10-14T11:00:00.000Z', first_payment_ref: INVOICE }, [
      { accountId: INVITEE_ACCOUNT, invoiceId: INVOICE, amountMinor: 12900, amountTaxMinor: 0, currency: 'usd', paidAt: '2026-10-14T11:00:00.000Z', livemode: false },
    ]);
    expect(view.payment).toMatchObject({ state: 'paid_recorded', amountMinor: 12900 });
    expect(within(tr).getByTestId('invite-payment-state')).toHaveTextContent('Paid');
    expect(within(tr).getByTestId('invite-payment-detail')).toHaveTextContent('2026-10-14 · $129.00 USD');
    expect(within(tr).getByTestId('invite-payment-test')).toBeInTheDocument();
  });

  it('an admin CHAMPION (cohort) invitee is never held: no payment line', async () => {
    const champion = invite({
      invite_type: CHAMPION_INVITE_TYPE,
      grant_kind: 'cohort',
      grant_id: INVITE_TYPES[CHAMPION_INVITE_TYPE].defaultGrantId,
      access_open_ended: true,
    });
    const { tr, view } = await listAndRender(champion, { first_paid_at: null, first_payment_ref: null });
    expect(view.payment).toBeNull();
    expect(within(tr).queryByTestId('invite-payment-state')).not.toBeInTheDocument();
  });
});
