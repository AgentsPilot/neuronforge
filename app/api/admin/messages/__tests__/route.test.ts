/**
 * GET /api/admin/messages (contact inbox standard): the admin inbox list.
 * Happy path, the admin gate (nothing read when refused), invalid query, and
 * the error format. The repository and the gate are mocked; nothing here
 * reaches the network.
 */

import { NextRequest, NextResponse } from 'next/server';

const mockGate = jest.fn();
jest.mock('@/lib/admin/requireAdminRoute', () => ({ requireAdmin: () => mockGate() }));

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

const mockList = jest.fn();
jest.mock('@/lib/repositories/ContactMessagesRepository', () => ({
  contactMessagesRepository: { listForAdmin: (...args: unknown[]) => mockList(...args) },
}));

import { GET } from '../route';

const ADMIN = { id: 'aaaaaaaa-1111-4111-8111-111111111111' };

const get = (query: string, headers: Record<string, string> = {}) =>
  GET(new NextRequest(`http://localhost/api/admin/messages${query}`, { headers }));

beforeEach(() => {
  mockGate.mockResolvedValue({ user: ADMIN });
  mockList.mockResolvedValue({ data: [{ id: 'm1', replies: [] }], error: null });
});

afterEach(() => jest.clearAllMocks());

describe('GET /api/admin/messages', () => {
  it('answers 200 with the messages at the top level, as the page reads them', async () => {
    const response = await get('?filter=all&search=', { 'x-correlation-id': 'corr-1' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, messages: [{ id: 'm1', replies: [] }] });
    expect(mockList).toHaveBeenCalledWith({ correlationId: 'corr-1', adminId: ADMIN.id }, { status: 'all', search: '' });
  });

  it('passes the status filter and the trimmed search', async () => {
    await get('?filter=unread&search=%20dana%20');
    expect(mockList).toHaveBeenCalledWith(expect.anything(), { status: 'unread', search: 'dana' });
  });

  it('defaults a missing filter and search', async () => {
    await get('');
    expect(mockList).toHaveBeenCalledWith(expect.anything(), { status: 'all', search: '' });
  });

  it.each([401, 403])('returns the gate refusal (%i) and reads nothing', async (status) => {
    mockGate.mockResolvedValue(NextResponse.json({ success: false, error: 'refused' }, { status }));
    const response = await get('?filter=all&search=');
    expect(response.status).toBe(status);
    expect(mockList).not.toHaveBeenCalled();
  });

  it('answers 400 for an unknown filter and reads nothing', async () => {
    const response = await get('?filter=bogus&search=');
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('Invalid input');
    expect(mockList).not.toHaveBeenCalled();
  });

  it('answers 400 for an over-long search', async () => {
    const response = await get(`?filter=all&search=${'a'.repeat(101)}`);
    expect(response.status).toBe(400);
  });

  it('answers 500 with the page-facing error and no details outside development', async () => {
    mockList.mockResolvedValue({ data: null, error: new Error('db down') });
    const response = await get('?filter=all&search=');
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ success: false, error: 'Failed to fetch messages' });
  });
});
