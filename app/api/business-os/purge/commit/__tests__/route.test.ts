/**
 * POST /api/business-os/purge/commit — the Reset commit route.
 *
 * B-2. Required by CLAUDE.md for every new API route (happy path, auth failure,
 * invalid input). This route is the one that DELETES, so the suite is built
 * around a single question asked in every case: **did Reset run?** The answer
 * must be "exactly once, for the session user" on the happy path, and "never"
 * everywhere else.
 *
 * `runReset` is mocked. This suite proves the route's gatekeeping — auth,
 * authorisation, validation, typed confirmation — and nothing about the delete
 * itself, which is covered by `ResetService.order.test.ts`. (supabase-js has no
 * working fetch under this repo's Jest environment, so a real run is not
 * possible here regardless.)
 */

import { NextRequest } from 'next/server';

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

const authorizePurge = jest.fn();
jest.mock('@/lib/business-os/purge/purgeAuthz', () => ({
  authorizePurge: (...a: unknown[]) => authorizePurge(...a),
}));

const runReset = jest.fn();
jest.mock('@/lib/business-os/purge/ResetService', () => ({
  runReset: (...a: unknown[]) => runReset(...a),
}));

const findByUserId = jest.fn();
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: { findByUserId: (...a: unknown[]) => findByUserId(...a) },
}));

import { POST } from '../route';

const SESSION_USER = { id: 'session-user-id', email: 'owner@example.com' };
const BUSINESS_NAME = 'Acme Test Co';

/** A request with a JSON body, or a raw string body for malformed-input cases. */
function req(body: unknown, raw = false): NextRequest {
  return new NextRequest('http://localhost/api/business-os/purge/commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue(SESSION_USER);
  authorizePurge.mockResolvedValue({ allowed: true });
  findByUserId.mockResolvedValue({ data: { company_name: BUSINESS_NAME }, error: null });
  runReset.mockResolvedValue({ status: 'refused', reason: 'rpc_not_applied', rowsDeleted: 0 });
});

describe('POST /api/business-os/purge/commit', () => {
  describe('happy path', () => {
    it('runs Reset exactly once, for the SESSION user, when the confirmation matches', async () => {
      const res = await POST(req({ level: 'reset', confirmText: BUSINESS_NAME }));

      expect(res.status).toBe(200);
      expect(runReset).toHaveBeenCalledTimes(1);
      expect(runReset).toHaveBeenCalledWith(
        expect.objectContaining({ userId: SESSION_USER.id, actorEmail: SESSION_USER.email })
      );
    });

    it('matches case- and whitespace-insensitively', async () => {
      const res = await POST(req({ level: 'reset', confirmText: '  acme   TEST  co ' }));

      expect(res.status).toBe(200);
      expect(runReset).toHaveBeenCalledTimes(1);
    });

    it('falls back to the account email when the business has no name', async () => {
      findByUserId.mockResolvedValue({ data: { company_name: null }, error: null });

      const res = await POST(req({ level: 'reset', confirmText: SESSION_USER.email }));

      expect(res.status).toBe(200);
      expect(runReset).toHaveBeenCalledTimes(1);
    });
  });

  describe('auth failure', () => {
    it('401 when signed out — Reset never runs', async () => {
      getUser.mockResolvedValue(null);

      const res = await POST(req({ level: 'reset', confirmText: BUSINESS_NAME }));

      expect(res.status).toBe(401);
      expect(runReset).not.toHaveBeenCalled();
    });

    it('403 for a non-admin EVEN WITH the correct confirmation — Reset never runs', async () => {
      authorizePurge.mockResolvedValue({
        allowed: false,
        status: 403,
        reason: 'The internal purge surface is restricted to platform administrators.',
      });

      const res = await POST(req({ level: 'reset', confirmText: BUSINESS_NAME }));

      expect(res.status).toBe(403);
      expect(runReset).not.toHaveBeenCalled();
    });

    it('a non-admin is not told whether their confirmation was correct', async () => {
      // Authorisation runs before the confirmation check, so a refused caller
      // cannot use this route as an oracle for a business's name.
      authorizePurge.mockResolvedValue({ allowed: false, status: 403, reason: 'no' });

      const res = await POST(req({ level: 'reset', confirmText: 'wrong guess' }));
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(JSON.stringify(body)).not.toMatch(/did not match|business name|account email/i);
      expect(findByUserId).not.toHaveBeenCalled();
    });
  });

  describe('invalid input — every case is a 400, and Reset never runs', () => {
    it.each([
      ['wrong confirmation', { level: 'reset', confirmText: 'Not The Name' }],
      ['empty confirmation', { level: 'reset', confirmText: '' }],
      ['whitespace-only confirmation', { level: 'reset', confirmText: '     ' }],
      ['missing confirmation', { level: 'reset' }],
      ['level: purge (slice 2 is Reset only)', { level: 'purge', confirmText: BUSINESS_NAME }],
      ['missing level', { confirmText: BUSINESS_NAME }],
      // FR-2 / AC-28: the target is always the session user. `.strict()` makes
      // an injected id a rejection, not a silently ignored field.
      ['injected userId', { level: 'reset', confirmText: BUSINESS_NAME, userId: 'someone-else' }],
      ['injected user_id', { level: 'reset', confirmText: BUSINESS_NAME, user_id: 'someone-else' }],
    ])('%s', async (_label, body) => {
      const res = await POST(req(body));

      expect(res.status).toBe(400);
      expect(runReset).not.toHaveBeenCalled();
    });

    it('E-2: malformed JSON is a 400, not a 500', async () => {
      const res = await POST(req('{ "level": "reset", confirmText: oops', true));

      expect(res.status).toBe(400);
      expect(runReset).not.toHaveBeenCalled();
    });

    it('an injected userId never reaches Reset even alongside a correct confirmation', async () => {
      // The belt to the braces above: assert on the argument, not just the
      // status code, so a future change that accepted the field could not pass.
      await POST(req({ level: 'reset', confirmText: BUSINESS_NAME, userId: 'someone-else' }));

      for (const call of runReset.mock.calls) {
        expect(call[0].userId).toBe(SESSION_USER.id);
      }
      expect(runReset).not.toHaveBeenCalled();
    });
  });

  describe('confirmation target', () => {
    it('refuses (409) when there is nothing to confirm against', async () => {
      getUser.mockResolvedValue({ id: SESSION_USER.id, email: null });
      findByUserId.mockResolvedValue({ data: { company_name: null }, error: null });

      const res = await POST(req({ level: 'reset', confirmText: 'anything' }));

      expect(res.status).toBe(409);
      expect(runReset).not.toHaveBeenCalled();
    });
  });
});
