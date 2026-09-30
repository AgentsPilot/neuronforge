/**
 * `POST /api/business-os/friend-invites/[inviteId]/revoke` (Slice 5a; F5a-8,
 * F5a-14, tenant-isolation-guard step 7; SA Q-2).
 *
 * The fake repository models the real UPDATE: a row changes only when its id
 * AND its issuer match the account passed in. Pinned: 401 without a session;
 * a non-uuid id or any body key is a 400 with no write; the account passed to
 * the UPDATE is the SESSION's; another account's invite id is a 404 identical
 * to "not found", and that row is unchanged; the switch being off does not
 * block a revoke; the audit is written only on success.
 */

import { NextRequest } from 'next/server';

import { INVITE_ISSUANCE_POLICY } from '@/lib/business-os/entitlements/config/invites';

const CHAMPION = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const OTHER_CHAMPION = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const OWN_INVITE = '11111111-1111-4111-8111-111111111111';
const OTHERS_INVITE = '22222222-2222-4222-8222-222222222222';
const MISSING = '00000000-0000-4000-8000-000000000000';

const state = {
  user: null as { id: string } | null,
  rows: new Map<string, { issuer: string; revoked: boolean }>(),
  updates: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  fail: false,
};

jest.mock('@/lib/auth', () => ({ getUser: async () => state.user }));

jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: {
    getInstance: () => ({
      log: async (entry: Record<string, unknown>) => {
        state.audits.push(entry);
      },
      flush: async () => undefined,
    }),
  },
}));

jest.mock('@/lib/business-os/invites/friendInviteDeps', () => ({
  friendInviteRepositories: {
    repository: {
      revokeForIssuerAccount: async (input: { id: string; issuerAccountId: string }) => {
        state.updates.push(input);
        if (state.fail) return { data: null, error: new Error('db down') };
        const row = state.rows.get(input.id);
        if (!row || row.issuer !== input.issuerAccountId || row.revoked) return { data: false, error: null };
        row.revoked = true;
        return { data: true, error: null };
      },
    },
  },
}));

import { POST } from '@/app/api/business-os/friend-invites/[inviteId]/revoke/route';

function request(body?: string) {
  return new NextRequest('https://example.test/api/business-os/friend-invites/x/revoke', {
    method: 'POST',
    ...(body === undefined ? {} : { body, headers: { 'content-type': 'application/json' } }),
  });
}

const revoke = (inviteId: string, body?: string) => POST(request(body), { params: { inviteId } });

beforeEach(() => {
  state.user = { id: CHAMPION };
  state.rows = new Map([
    [OWN_INVITE, { issuer: CHAMPION, revoked: false }],
    [OTHERS_INVITE, { issuer: OTHER_CHAMPION, revoked: false }],
  ]);
  state.updates = [];
  state.audits = [];
  state.fail = false;
});

it('401 without a session, and no write', async () => {
  state.user = null;
  const response = await revoke(OWN_INVITE);
  expect(response.status).toBe(401);
  expect(state.updates).toEqual([]);
});

it('revokes the champion\'s own pending invite: 200, no-store, audited with the champion as actor', async () => {
  const response = await revoke(OWN_INVITE);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({ success: true, data: { revoked: true } });
  expect(state.updates).toEqual([expect.objectContaining({ id: OWN_INVITE, issuerAccountId: CHAMPION })]);
  expect(state.audits.map((entry) => [entry.action, entry.entityId, entry.actorId])).toEqual([
    ['BOS_FRIEND_INVITE_REVOKED', OWN_INVITE, CHAMPION],
  ]);
});

it('an empty JSON body is accepted', async () => {
  expect((await revoke(OWN_INVITE, '{}')).status).toBe(200);
});

it('tenant isolation: ANOTHER account\'s invite id → 404, identical to "not found", and that row is unchanged', async () => {
  const theirs = await revoke(OTHERS_INVITE);
  const missing = await revoke(MISSING);
  expect(theirs.status).toBe(404);
  expect(missing.status).toBe(404);
  expect(await theirs.json()).toEqual(await missing.json());
  expect(state.rows.get(OTHERS_INVITE)?.revoked).toBe(false);
  // The UPDATE was scoped to the SESSION account, never the row's owner.
  for (const update of state.updates) expect(update.issuerAccountId).toBe(CHAMPION);
  expect(state.audits).toEqual([]);
});

it('an already revoked invite → the same 404', async () => {
  await revoke(OWN_INVITE);
  state.audits = [];
  expect((await revoke(OWN_INVITE)).status).toBe(404);
  expect(state.audits).toEqual([]);
});

it.each([
  ['a non-uuid id', 'not-a-uuid', undefined],
  ['an injected issuerAccountId', OWN_INVITE, JSON.stringify({ issuerAccountId: OTHER_CHAMPION })],
  ['an injected reason', OWN_INVITE, JSON.stringify({ reason: 'mine now' })],
  ['a body that is not JSON', OWN_INVITE, 'not json'],
])('400 for %s, and no write', async (_label, id, body) => {
  const response = await revoke(id, body);
  expect(response.status).toBe(400);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(state.updates).toEqual([]);
});

it('SA Q-2: the friend-invite switch being off does not block a revoke', async () => {
  expect(INVITE_ISSUANCE_POLICY.accountInvitesAvailable).toBe(false);
  expect((await revoke(OWN_INVITE)).status).toBe(200);
});

it('a database error → 500, not 404, and no audit', async () => {
  state.fail = true;
  expect((await revoke(OWN_INVITE)).status).toBe(500);
  expect(state.audits).toEqual([]);
});
