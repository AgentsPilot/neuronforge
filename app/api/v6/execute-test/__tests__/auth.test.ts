/**
 * Identity lock for POST /api/v6/execute-test (identity sweep, Slice 0).
 *
 * The route was completely unauthenticated and executed caller-authored PILOT DSL through
 * WorkflowPilot with a service-role client, as whatever `body.user_id` named. That is
 * remote execution, not just a disclosure — so a session gate alone would only have
 * narrowed "anyone on the internet" to "anyone who signed up". The gate is `requireAdmin`
 * and the workflow always runs as the calling admin.
 *
 * These tests also lock the three removals that were part of the same bug: the body
 * `user_id`, the `listUsers()` email-resolution branch, and the zero-UUID fallback that
 * executed the workflow anyway when a lookup failed.
 */

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

const isAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: {
    getInstance: () => ({ isAdmin: (...args: unknown[]) => isAdmin(...args) }),
  },
}));

/** The thing that must never run for an unauthorized caller. */
const execute = jest.fn();
jest.mock('@/lib/pilot/WorkflowPilot', () => ({
  WorkflowPilot: class {
    execute = (...args: unknown[]) => execute(...args);
  },
}));

const listUsers = jest.fn();
jest.mock('@/lib/supabaseServer', () => ({
  createServerSupabaseClient: () => ({
    auth: { admin: { listUsers: (...args: unknown[]) => listUsers(...args) } },
  }),
}));

import { NextRequest } from 'next/server';

import { POST } from '@/app/api/v6/execute-test/route';

const ADMIN_USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PLAIN_USER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const VICTIM_USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

const WORKFLOW = [{ id: 'step-1', type: 'action', action: 'send_email' }];

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/v6/execute-test', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  jest.clearAllMocks();
  execute.mockResolvedValue({
    success: true,
    stepsCompleted: 1,
    stepsFailed: 0,
    stepsSkipped: 0,
    totalTokensUsed: 0,
    output: {},
    completedStepIds: ['step-1'],
    failedStepIds: [],
    skippedStepIds: [],
  });
});

describe('POST /api/v6/execute-test — admin only, runs as the session admin', () => {
  it('401s with no session, and never executes the workflow', async () => {
    getUser.mockResolvedValue(null);

    const res = await POST(
      post({ workflow: WORKFLOW, plugins_required: [], user_id: VICTIM_USER_ID })
    );

    expect(res.status).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });

  it('403s a signed-in non-admin, and never executes the workflow', async () => {
    getUser.mockResolvedValue({ id: PLAIN_USER_ID, email: 'user@example.com' });
    isAdmin.mockResolvedValue(false);

    const res = await POST(
      post({ workflow: WORKFLOW, plugins_required: [], user_id: VICTIM_USER_ID })
    );

    expect(res.status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses before parsing the body, so a malformed workflow cannot slip past', async () => {
    getUser.mockResolvedValue(null);

    const res = await POST(
      new NextRequest('http://localhost/api/v6/execute-test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not-json',
      })
    );

    // 401, NOT a 400/500 from JSON.parse — the gate runs first.
    expect(res.status).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });

  it('runs as the session admin and ignores a body user_id', async () => {
    getUser.mockResolvedValue({ id: ADMIN_USER_ID, email: 'admin@example.com' });
    isAdmin.mockResolvedValue(true);

    const res = await POST(
      post(
        { workflow: WORKFLOW, plugins_required: [], user_id: VICTIM_USER_ID },
        { 'x-user-id': VICTIM_USER_ID }
      )
    );

    expect(res.status).toBe(200);
    expect(execute).toHaveBeenCalledTimes(1);

    const [agent, userIdArg] = execute.mock.calls[0];
    expect(userIdArg).toBe(ADMIN_USER_ID);
    expect(agent.user_id).toBe(ADMIN_USER_ID);
    // The victim id must appear nowhere in what gets executed.
    expect(JSON.stringify(execute.mock.calls[0])).not.toContain(VICTIM_USER_ID);
  });

  it('never resolves a user by email any more', async () => {
    getUser.mockResolvedValue({ id: ADMIN_USER_ID, email: 'admin@example.com' });
    isAdmin.mockResolvedValue(true);

    await POST(post({ workflow: WORKFLOW, plugins_required: [], user_id: 'victim@example.com' }));

    // The unpaginated admin listUsers() enumeration branch is gone.
    expect(listUsers).not.toHaveBeenCalled();
    expect(execute.mock.calls[0][1]).toBe(ADMIN_USER_ID);
  });

  it('never falls back to the zero UUID', async () => {
    getUser.mockResolvedValue({ id: ADMIN_USER_ID, email: 'admin@example.com' });
    isAdmin.mockResolvedValue(true);

    // Previously `user_id: 'test-user'` (and any failed lookup) executed as the zero
    // UUID rather than refusing.
    await POST(post({ workflow: WORKFLOW, plugins_required: [], user_id: 'test-user' }));

    expect(execute.mock.calls[0][1]).toBe(ADMIN_USER_ID);
    expect(execute.mock.calls[0][1]).not.toBe(ZERO_UUID);
  });
});
