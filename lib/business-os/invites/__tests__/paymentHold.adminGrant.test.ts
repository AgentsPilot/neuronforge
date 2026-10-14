/**
 * The payment hold carries the admin Paid invite's tier (plan payments P-9.2;
 * workplan §3.4, §7 "Hold"; SA C-5, Q-4, R-3).
 *
 *   - `admin_invite` + tier → held, with `grantId` = the invite's `grant_id`;
 *   - `account_invite` → held with NO `grantId`, and the invite is still never
 *     read (R-3);
 *   - an empty `grant_id` (impossible by schema) → `{ ok: false }`, never a
 *     held result with no tier;
 *   - an invite read error → `{ ok: false }` (unchanged).
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { readPaymentHold, type PaymentHoldReaders } from '../paymentHold';
import type { BusinessOsAccountHoldFacts, BusinessOsInviteHoldFacts } from '@/lib/repositories/types';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const INVITE = '66666666-6666-4666-8666-666666666666';

function readers(lineage: BusinessOsAccountHoldFacts, invite: BusinessOsInviteHoldFacts | null | 'error') {
  const inviteReads: string[] = [];
  const r: PaymentHoldReaders = {
    lineage: { findHoldFactsForAccount: async () => ({ data: lineage, error: null }) },
    invites: {
      findHoldFactsById: async (id: string) => {
        inviteReads.push(id);
        return invite === 'error' ? { data: null, error: new Error('down') } : { data: invite, error: null };
      },
    },
  };
  return { r, inviteReads };
}

const adminLineage: BusinessOsAccountHoldFacts = { invite_id: INVITE, source: 'admin_invite', first_paid_at: null };
const friendLineage: BusinessOsAccountHoldFacts = { invite_id: INVITE, source: 'account_invite', first_paid_at: null };

describe('readPaymentHold: the admin variant carries the invited tier (C-5)', () => {
  it('admin_invite + tier: held, grantId from the invite row', async () => {
    const { r, inviteReads } = readers(adminLineage, { grant_kind: 'tier', grant_id: 'invited_plan', language: 'he' });
    expect(await readPaymentHold(ACCOUNT, r)).toEqual({ ok: true, held: true, inviteId: INVITE, source: 'admin_invite', grantId: 'invited_plan' });
    expect(inviteReads).toEqual([INVITE]);
  });

  it('account_invite: held with NO grantId, and the invite is never read (R-3)', async () => {
    const { r, inviteReads } = readers(friendLineage, 'error');
    const hold = await readPaymentHold(ACCOUNT, r);
    expect(hold).toEqual({ ok: true, held: true, inviteId: INVITE, source: 'account_invite' });
    expect(hold).not.toHaveProperty('grantId');
    expect(inviteReads).toEqual([]);
  });

  it.each([[''], [null], [undefined]])('an empty grant_id (%j) is { ok: false }, never "held, no tier"', async (grantId) => {
    const { r } = readers(adminLineage, { grant_kind: 'tier', grant_id: grantId as unknown as string, language: 'en' });
    expect(await readPaymentHold(ACCOUNT, r)).toEqual({ ok: false });
  });

  it('an admin COHORT invite (a champion) is not held, whatever its grant_id', async () => {
    const { r } = readers(adminLineage, { grant_kind: 'cohort', grant_id: '', language: 'en' });
    expect(await readPaymentHold(ACCOUNT, r)).toEqual({ ok: true, held: false });
  });

  it('an invite read error is still { ok: false }', async () => {
    const { r } = readers(adminLineage, 'error');
    expect(await readPaymentHold(ACCOUNT, r)).toEqual({ ok: false });
  });

  it('C-3: paymentHold.ts still imports nothing from billing or the entitlements module', () => {
    const text = readFileSync(join(process.cwd(), 'lib', 'business-os', 'invites', 'paymentHold.ts'), 'utf8');
    const imports = text.split('\n').filter((line) => /^\s*import\b/.test(line)).join('\n');
    expect(imports).not.toMatch(/business-os\/billing/);
    expect(imports).not.toMatch(/business-os\/entitlements/);
  });
});
