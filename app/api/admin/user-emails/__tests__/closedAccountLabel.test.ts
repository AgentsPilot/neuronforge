/**
 * POST /api/admin/user-emails names a closed account "Deleted account {ref}"
 * (data export DE-10b.2, SA TQ-21). Other accounts keep their email.
 */

import { NextRequest, NextResponse } from 'next/server';

const mockGate = jest.fn();
jest.mock('@/lib/admin/requireAdminRoute', () => ({ requireAdmin: () => mockGate() }));
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      admin: {
        listUsers: async () => ({
          data: {
            users: [
              { id: 'a', email: 'deleted-0123456789ab@deleted.invalid' },
              { id: 'b', email: 'jane@example.com' },
              { id: 'c', email: null },
              { id: 'd', email: 'not@asked.com' },
            ],
          },
          error: null,
        }),
      },
    },
  }),
}));

import { POST } from '../route';

const post = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/admin/user-emails', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }));

beforeEach(() => mockGate.mockReset().mockResolvedValue({ user: { id: 'admin-1' } }));

it('labels the closed account, keeps the others, and returns only the ids asked for', async () => {
  const response = await post({ userIds: ['a', 'b', 'c'] });
  expect(response.status).toBe(200);
  expect((await response.json()).data).toEqual({ a: 'Deleted account 0123456789ab', b: 'jane@example.com', c: 'N/A' });
});

it('the admin gate still runs first', async () => {
  mockGate.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  expect((await post({ userIds: ['a'] })).status).toBe(401);
});
