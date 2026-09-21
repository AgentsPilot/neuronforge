/**
 * Identity lock for /api/approvals/[id]/respond (identity sweep, Slice 0).
 *
 * POST used to read `userId` from the request body and use it AS the authorization check
 * (`approvalRequest.approvers.includes(userId)`), so naming any valid approver passed it
 * — an anonymous caller could approve or reject another user's paused workflow, and the
 * `auditLog` entry recorded the spoofed id, attributing the forged decision to the
 * victim. GET returned the whole approval request to anyone at all.
 *
 * Both halves are asserted: the gate, and that the WRITE does not happen on the refusal
 * path (the lesson from PR #82's CR1, where a read hole was closed and the write one path
 * over was nearly missed).
 */

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

const getApprovalRequest = jest.fn();
const recordApprovalResponse = jest.fn();
jest.mock('@/lib/pilot', () => ({
  ApprovalTracker: class {
    getApprovalRequest = (...args: unknown[]) => getApprovalRequest(...args);
    recordApprovalResponse = (...args: unknown[]) => recordApprovalResponse(...args);
  },
}));

const auditLog = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({
  auditLog: (...args: unknown[]) => auditLog(...args),
}));

jest.mock('@supabase/ssr', () => ({ createServerClient: () => ({}) }));
jest.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));

import { POST, GET } from '@/app/api/approvals/[id]/respond/route';

const APPROVAL_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const APPROVER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OUTSIDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const params = { id: APPROVAL_ID };

const post = (body: unknown) =>
  new Request(`http://localhost/api/approvals/${APPROVAL_ID}/respond`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const getReq = () =>
  new Request(`http://localhost/api/approvals/${APPROVAL_ID}/respond`, { method: 'GET' });

const PENDING_APPROVAL = {
  id: APPROVAL_ID,
  title: 'Send the invoice',
  status: 'pending',
  approvers: [APPROVER_ID],
  executionId: 'exec-1',
  stepId: 'step-1',
  approvalType: 'single',
  responses: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  getApprovalRequest.mockResolvedValue(PENDING_APPROVAL);
  recordApprovalResponse.mockResolvedValue(undefined);
  auditLog.mockResolvedValue(undefined);
});

describe('POST /api/approvals/[id]/respond — the approver is the session user', () => {
  it('401s with no session, and records nothing', async () => {
    getUser.mockResolvedValue(null);

    const res = await POST(post({ userId: APPROVER_ID, decision: 'approve' }), { params });

    expect(res.status).toBe(401);
    expect(recordApprovalResponse).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('refuses before parsing the body', async () => {
    getUser.mockResolvedValue(null);

    const res = await POST(
      new Request(`http://localhost/api/approvals/${APPROVAL_ID}/respond`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not-json',
      }),
      { params }
    );

    expect(res.status).toBe(401);
    expect(recordApprovalResponse).not.toHaveBeenCalled();
  });

  it('403s a signed-in non-approver who names a real approver in the body', async () => {
    // The exact forgery the fix closes: a valid session, someone else's id in the body.
    getUser.mockResolvedValue({ id: OUTSIDER_ID, email: 'outsider@example.com' });

    const res = await POST(post({ userId: APPROVER_ID, decision: 'approve' }), { params });

    expect(res.status).toBe(403);
    expect(recordApprovalResponse).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('records a real approver against the SESSION id, and audits the same id', async () => {
    getUser.mockResolvedValue({ id: APPROVER_ID, email: 'approver@example.com' });

    const res = await POST(
      post({ userId: OUTSIDER_ID, decision: 'approve', comment: 'ok' }),
      { params }
    );

    expect(res.status).toBe(200);
    expect(recordApprovalResponse).toHaveBeenCalledWith(APPROVAL_ID, APPROVER_ID, 'approve', 'ok');
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ userId: APPROVER_ID }));
    // The body value must not have reached the write or the audit row.
    expect(JSON.stringify(recordApprovalResponse.mock.calls)).not.toContain(OUTSIDER_ID);
    expect(JSON.stringify(auditLog.mock.calls)).not.toContain(OUTSIDER_ID);
  });
});

describe('GET /api/approvals/[id]/respond — only a named approver may read it', () => {
  it('401s with no session, and never reads the approval', async () => {
    getUser.mockResolvedValue(null);

    const res = await GET(getReq(), { params });

    expect(res.status).toBe(401);
    expect(getApprovalRequest).not.toHaveBeenCalled();
  });

  it('404s a signed-in non-approver rather than confirming the id exists', async () => {
    getUser.mockResolvedValue({ id: OUTSIDER_ID, email: 'outsider@example.com' });

    const res = await GET(getReq(), { params });

    expect(res.status).toBe(404);
    // No approver list, title or execution id in the refusal body.
    expect(JSON.stringify(await res.json())).not.toContain(APPROVER_ID);
  });

  it('serves a named approver', async () => {
    getUser.mockResolvedValue({ id: APPROVER_ID, email: 'approver@example.com' });

    const res = await GET(getReq(), { params });

    expect(res.status).toBe(200);
    expect((await res.json()).approval.id).toBe(APPROVAL_ID);
  });
});
