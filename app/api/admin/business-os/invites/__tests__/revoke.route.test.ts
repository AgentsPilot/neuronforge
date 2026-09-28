/**
 * POST /api/admin/business-os/invites/[inviteId]/revoke — the gate, the shapes,
 * 404 vs 409, and the audit flushed before the response (R-1).
 */

import { NextRequest } from 'next/server';

import type { BusinessOsInvite, RevokeBusinessOsInviteInput } from '@/lib/repositories/types';

const ADMIN = '22222222-2222-4222-8222-222222222222';
const INVITE_ID = '11111111-1111-4111-8111-111111111111';

const state = {
  user: null as { id: string } | null,
  isAdmin: false,
  /** The stored invite, or null for "no such invite". */
  row: null as BusinessOsInvite | null,
  revokeError: false,
  revokes: [] as RevokeBusinessOsInviteInput[],
  audit: [] as Array<Record<string, unknown>>,
  flushRejects: false,
  events: [] as string[],
};

jest.mock('@/lib/auth', () => ({ getUser: async () => state.user }));

jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: async () => state.isAdmin }) },
}));

jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: {
    getInstance: () => ({
      log: async (entry: Record<string, unknown>) => {
        state.audit.push(entry);
        state.events.push('log');
      },
      flush: async () => {
        state.events.push('flush');
        if (state.flushRejects) throw new Error('flush failed');
      },
    }),
  },
}));

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

// The repository, emulating the conditional UPDATE: it matches only a row that
// is neither accepted nor already revoked.
jest.mock('@/lib/repositories/BusinessOsInviteRepository', () => ({
  businessOsInviteRepository: {
    revokeForAdmin: async (input: RevokeBusinessOsInviteInput) => {
      state.events.push('revoke');
      state.revokes.push(input);
      if (state.revokeError) return { data: null, error: new Error('update failed') };
      const row = state.row;
      if (!row || row.id !== input.id || row.redeemed_at || row.revoked_at) return { data: null, error: null };
      state.row = {
        ...row,
        revoked_at: input.now.toISOString(),
        revoked_by_admin_id: input.adminId,
        revoke_reason: input.reason,
      };
      return { data: state.row, error: null };
    },
    findByIdForAdmin: async (id: string) => ({ data: state.row && state.row.id === id ? state.row : null, error: null }),
  },
}));

import { CHAMPION_INVITE_TYPE, INVITE_TYPES } from '@/lib/business-os/entitlements/config/invites';

import { POST } from '../[inviteId]/revoke/route';

function row(overrides: Partial<BusinessOsInvite> = {}): BusinessOsInvite {
  return {
    id: INVITE_ID,
    email: 'x@example.com',
    email_locked: true,
    invite_type: CHAMPION_INVITE_TYPE,
    grant_kind: 'cohort',
    grant_id: INVITE_TYPES[CHAMPION_INVITE_TYPE].defaultGrantId,
    access_open_ended: true,
    access_months: null,
    issuer_kind: 'admin',
    issuer_admin_id: ADMIN,
    issuer_account_id: null,
    inviter_display_name: 'Dana',
    language: 'en',
    personal_note: null,
    internal_reason: 'Reason',
    link_expiry_days: 30,
    link_expires_at: '2099-01-01T00:00:00.000Z',
    first_viewed_at: null,
    revoked_at: null,
    revoked_by_admin_id: null,
    revoke_reason: null,
    redeemed_at: null,
    redeemed_account_id: null,
    opened_by_existing_account_at: null,
    created_at: '2026-10-01T12:00:00.000Z',
    updated_at: '2026-10-01T12:00:00.000Z',
    ...overrides,
  };
}

function revoke(id: string, body: unknown) {
  const request = new NextRequest(`http://localhost:3000/api/admin/business-os/invites/${id}/revoke`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-correlation-id': 'corr-2' },
  });
  return { request, call: () => POST(request, { params: { inviteId: id } }) };
}

beforeEach(() => {
  state.user = { id: ADMIN };
  state.isAdmin = true;
  state.row = row();
  state.revokeError = false;
  state.revokes = [];
  state.audit = [];
  state.flushRejects = false;
  state.events = [];
});

describe('the gate', () => {
  it('401 signed out, and the body is never read', async () => {
    state.user = null;
    const { request, call } = revoke(INVITE_ID, { reason: 'Wrong person' });
    const json = jest.spyOn(request, 'json');
    expect((await call()).status).toBe(401);
    expect(json).not.toHaveBeenCalled();
    expect(state.revokes).toHaveLength(0);
  });

  it('403 not an admin, and nothing is revoked', async () => {
    state.isAdmin = false;
    const { request, call } = revoke(INVITE_ID, { reason: 'Wrong person' });
    const json = jest.spyOn(request, 'json');
    expect((await call()).status).toBe(403);
    expect(json).not.toHaveBeenCalled();
    expect(state.revokes).toHaveLength(0);
  });
});

describe('400', () => {
  it.each([
    ['a non-uuid id', 'not-a-uuid', { reason: 'Wrong person' }],
    ['a short reason', INVITE_ID, { reason: 'no' }],
    ['an extra key', INVITE_ID, { reason: 'Wrong person', revokedBy: ADMIN }],
    ['no body', INVITE_ID, null],
  ])('%s', async (_label, id, body) => {
    const response = await revoke(id, body).call();
    expect(response.status).toBe(400);
    expect(state.revokes).toHaveLength(0);
  });
});

describe('outcomes', () => {
  it('200 for a pending invite: the row reads Revoked, with the audit logged then flushed', async () => {
    const response = await revoke(INVITE_ID, { reason: 'QA revoke test' }).call();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.invite.state).toBe('revoked');
    expect(body.data.invite.revokeReason).toBe('QA revoke test');
    expect(body.data.invite).not.toHaveProperty('internal_reason');
    expect(state.revokes[0]).toMatchObject({ id: INVITE_ID, adminId: ADMIN, reason: 'QA revoke test' });

    expect(state.audit).toHaveLength(1);
    expect(state.audit[0].action).toBe('BOS_INVITE_REVOKED');
    expect(state.audit[0].entityId).toBe(INVITE_ID);
    expect((state.audit[0].details as Record<string, unknown>).correlationId).toBe('corr-2');
    expect(state.events).toEqual(['revoke', 'log', 'flush']);
  });

  it('200 for an expired invite (revoking an expired link is allowed)', async () => {
    state.row = row({ link_expires_at: '2026-01-01T00:00:00.000Z' });
    expect((await revoke(INVITE_ID, { reason: 'Tidy up' }).call()).status).toBe(200);
  });

  it('404 for an unknown invite', async () => {
    state.row = null;
    const response = await revoke(INVITE_ID, { reason: 'Wrong person' }).call();
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe('invite_not_found');
    expect(state.audit).toHaveLength(0);
  });

  it('409 for an invite already revoked', async () => {
    state.row = row({ revoked_at: '2026-10-02T00:00:00.000Z', revoked_by_admin_id: ADMIN, revoke_reason: 'Earlier' });
    const response = await revoke(INVITE_ID, { reason: 'Again' }).call();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('invite_not_revocable');
    expect(state.audit).toHaveLength(0);
  });

  it('409 for an accepted invite', async () => {
    state.row = row({ redeemed_at: '2026-10-02T00:00:00.000Z', redeemed_account_id: '33333333-3333-4333-8333-333333333333' });
    expect((await revoke(INVITE_ID, { reason: 'Too late' }).call()).status).toBe(409);
  });

  it('500 on a repository error', async () => {
    state.revokeError = true;
    expect((await revoke(INVITE_ID, { reason: 'Wrong person' }).call()).status).toBe(500);
  });

  it('R-1: a rejected flush still returns 200', async () => {
    state.flushRejects = true;
    expect((await revoke(INVITE_ID, { reason: 'Wrong person' }).call()).status).toBe(200);
    expect(state.events).toContain('flush');
  });
});
