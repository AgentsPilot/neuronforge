/**
 * PATCH and DELETE /api/admin/messages/[id] (contact inbox standard).
 * Happy paths with the bodies the page sends, the admin gate (nothing read or
 * written when refused), invalid id and body, not found, failures, and the
 * audit entry's shape. `logAndFlush` is mocked directly (SA C-5), so no audit
 * sink is involved; nothing here reaches the network.
 */

import { NextRequest, NextResponse } from 'next/server';

const mockGate = jest.fn();
jest.mock('@/lib/admin/requireAdminRoute', () => ({ requireAdmin: () => mockGate() }));

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

const mockUpdate = jest.fn();
const mockDelete = jest.fn();
jest.mock('@/lib/repositories/ContactMessagesRepository', () => ({
  contactMessagesRepository: {
    updateForAdmin: (...args: unknown[]) => mockUpdate(...args),
    deleteForAdmin: (...args: unknown[]) => mockDelete(...args),
  },
}));

const mockLogAndFlush = jest.fn();
jest.mock('@/lib/audit/boundedAuditFlush', () => ({
  logAndFlush: (...args: unknown[]) => mockLogAndFlush(...args),
}));

import { DELETE, PATCH } from '../route';

const ADMIN = { id: 'aaaaaaaa-1111-4111-8111-111111111111' };
const ID = '99999999-9999-4999-8999-999999999999';
const ctx = (id = ID) => ({ params: { id } });

function patchRequest(body: unknown, raw?: string) {
  return new NextRequest(`http://localhost/api/admin/messages/${ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-correlation-id': 'corr-1' },
    body: raw ?? JSON.stringify(body),
  });
}

const deleteRequest = () =>
  new NextRequest(`http://localhost/api/admin/messages/${ID}`, {
    method: 'DELETE',
    headers: { 'x-correlation-id': 'corr-1' },
  });

const ROW = { id: ID, name: 'Dana Example', email: 'dana@example.com', message: 'Hello', status: 'read', admin_notes: 'private note' };

beforeEach(() => {
  mockGate.mockResolvedValue({ user: ADMIN });
  mockUpdate.mockResolvedValue({ data: ROW, error: null });
  mockDelete.mockResolvedValue({ data: { deleted: true }, error: null });
  mockLogAndFlush.mockResolvedValue(undefined);
});

afterEach(() => jest.clearAllMocks());

describe('PATCH /api/admin/messages/[id]', () => {
  it('saves a status change from the page body, ignoring its updated_at', async () => {
    const response = await PATCH(patchRequest({ status: 'read', updated_at: '2026-11-27T10:00:00Z' }), ctx());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, message: ROW });
    expect(mockUpdate).toHaveBeenCalledWith({ correlationId: 'corr-1', adminId: ADMIN.id }, ID, {
      status: 'read',
      admin_notes: undefined,
    });
  });

  it('records one audit entry with field names only, never content', async () => {
    await PATCH(patchRequest({ status: 'read', admin_notes: 'private note' }), ctx());
    expect(mockLogAndFlush).toHaveBeenCalledTimes(1);
    const [entry] = mockLogAndFlush.mock.calls[0];
    expect(entry).toMatchObject({
      action: 'CONTACT_MESSAGE_UPDATED',
      entityType: 'contact_message',
      entityId: ID,
      userId: ADMIN.id,
      actorId: ADMIN.id,
      severity: 'info',
      changes: { after: { status: 'read' } },
      details: { fields: ['status', 'admin_notes'], correlationId: 'corr-1' },
    });
    const rest: Record<string, unknown> = { ...(entry as Record<string, unknown>) };
    delete rest.request;
    const serialised = JSON.stringify(rest);
    expect(serialised).not.toContain('private note');
    expect(serialised).not.toContain('dana@example.com');
  });

  it('a notes-only save records no status change', async () => {
    await PATCH(patchRequest({ admin_notes: '', updated_at: 'x' }), ctx());
    const [entry] = mockLogAndFlush.mock.calls[0];
    expect((entry as Record<string, unknown>).changes).toBeUndefined();
    expect((entry as { details: { fields: string[] } }).details.fields).toEqual(['admin_notes']);
  });

  it('an audit that rejects does not change the status', async () => {
    mockLogAndFlush.mockRejectedValue(new Error('audit down'));
    const response = await PATCH(patchRequest({ status: 'read' }), ctx());
    expect(response.status).toBe(200);
  });

  it.each([401, 403])('returns the gate refusal (%i), reads nothing and writes nothing', async (status) => {
    mockGate.mockResolvedValue(NextResponse.json({ success: false, error: 'refused' }, { status }));
    const response = await PATCH(patchRequest({ status: 'read' }), ctx());
    expect(response.status).toBe(status);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockLogAndFlush).not.toHaveBeenCalled();
  });

  it.each([
    ['a non-uuid id', ctx('x'), { status: 'read' }],
    ['an unknown key', ctx(), { email: 'x@y.z' }],
    ['an unknown status', ctx(), { status: 'archived' }],
    ['nothing to update', ctx(), { updated_at: 'x' }],
  ])('answers 400 for %s and writes nothing', async (_label, context, body) => {
    const response = await PATCH(patchRequest(body), context);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json).toMatchObject({ success: false, error: 'Invalid input' });
    expect(json.details).toBeUndefined();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('answers 400 for a body that is not JSON', async () => {
    const response = await PATCH(patchRequest(null, '{not json'), ctx());
    expect(response.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('answers 404 when no message has that id, with no audit', async () => {
    mockUpdate.mockResolvedValue({ data: null, error: null });
    const response = await PATCH(patchRequest({ status: 'read' }), ctx());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ success: false, error: 'Message not found' });
    expect(mockLogAndFlush).not.toHaveBeenCalled();
  });

  it('answers 500 on a repository error, with no audit', async () => {
    mockUpdate.mockResolvedValue({ data: null, error: new Error('db down') });
    const response = await PATCH(patchRequest({ status: 'read' }), ctx());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, error: 'Failed to update message' });
    expect(mockLogAndFlush).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/admin/messages/[id]', () => {
  it('deletes, answers 200 and records one audit entry', async () => {
    const response = await DELETE(deleteRequest(), ctx());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mockDelete).toHaveBeenCalledWith({ correlationId: 'corr-1', adminId: ADMIN.id }, ID);
    expect(mockLogAndFlush).toHaveBeenCalledTimes(1);
    expect(mockLogAndFlush.mock.calls[0][0]).toMatchObject({
      action: 'CONTACT_MESSAGE_DELETED',
      entityType: 'contact_message',
      entityId: ID,
      userId: ADMIN.id,
      actorId: ADMIN.id,
      severity: 'warning',
      details: { correlationId: 'corr-1' },
    });
  });

  it('an audit that rejects does not change the status', async () => {
    mockLogAndFlush.mockRejectedValue(new Error('audit down'));
    const response = await DELETE(deleteRequest(), ctx());
    expect(response.status).toBe(200);
  });

  it('answers 200 with no audit when the message is already gone', async () => {
    mockDelete.mockResolvedValue({ data: { deleted: false }, error: null });
    const response = await DELETE(deleteRequest(), ctx());
    expect(response.status).toBe(200);
    expect(mockLogAndFlush).not.toHaveBeenCalled();
  });

  it('an audit that never settles quickly does not change the status', async () => {
    // The real logAndFlush is bounded and resolves either way; a slow resolve stands in for it.
    mockLogAndFlush.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 20)));
    const response = await DELETE(deleteRequest(), ctx());
    expect(response.status).toBe(200);
  });

  it.each([401, 403])('returns the gate refusal (%i) and deletes nothing', async (status) => {
    mockGate.mockResolvedValue(NextResponse.json({ success: false, error: 'refused' }, { status }));
    const response = await DELETE(deleteRequest(), ctx());
    expect(response.status).toBe(status);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('answers 400 for a non-uuid id and deletes nothing', async () => {
    const response = await DELETE(deleteRequest(), ctx('1,2'));
    expect(response.status).toBe(400);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('answers 500 on a repository error', async () => {
    mockDelete.mockResolvedValue({ data: null, error: new Error('db down') });
    const response = await DELETE(deleteRequest(), ctx());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, error: 'Failed to delete message' });
  });
});
