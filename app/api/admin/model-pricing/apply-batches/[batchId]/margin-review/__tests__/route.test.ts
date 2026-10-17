/**
 * POST /api/admin/model-pricing/apply-batches/[batchId]/margin-review (AI model
 * price review slice 8; MP-FR-14, B-4). Gate first; the path id and the note
 * validated; database refusals mapped; one audit entry before the response.
 */

import { NextRequest } from 'next/server';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));
const mockIsAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (...args: unknown[]) => mockIsAdmin(...args) }) },
}));
jest.mock('@/lib/audit/recordRefusedAccess', () => ({ recordRefusedAccess: jest.fn(async () => undefined) }));
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});
const mockLogAndFlush = jest.fn();
jest.mock('@/lib/audit/boundedAuditFlush', () => ({ logAndFlush: (...args: unknown[]) => mockLogAndFlush(...args) }));
const mockMark = jest.fn();
jest.mock('@/lib/repositories/AiPriceApplyRepository', () => ({
  aiPriceApplyRepository: { markMarginReviewDone: (...args: unknown[]) => mockMark(...args) },
}));

import { POST } from '../route';

const BATCH = '33333333-3333-4333-8333-333333333333';

function post(body: unknown, batchId = BATCH): [NextRequest, { params: { batchId: string } }] {
  return [
    new NextRequest(`http://localhost/api/admin/model-pricing/apply-batches/${batchId}/margin-review`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
    { params: { batchId } },
  ];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ id: 'admin-1', email: 'admin@example.com' });
  mockIsAdmin.mockResolvedValue(true);
  mockMark.mockResolvedValue({ data: { batchId: BATCH, doneAt: '2026-10-17T11:00:00.000Z' }, error: null });
  mockLogAndFlush.mockResolvedValue(undefined);
});

it('R01c: 401 and 403 before anything is read; the body is never read', async () => {
  mockGetUser.mockResolvedValueOnce(null);
  const signedOut = post({ note: 'Margins fine' });
  const signedOutJson = jest.spyOn(signedOut[0], 'json');
  expect((await POST(...signedOut)).status).toBe(401);
  expect(signedOutJson).not.toHaveBeenCalled();
  mockIsAdmin.mockResolvedValueOnce(false);
  const notAdmin = post({ note: 'Margins fine' });
  const notAdminJson = jest.spyOn(notAdmin[0], 'json');
  expect((await POST(...notAdmin)).status).toBe(403);
  expect(notAdminJson).not.toHaveBeenCalled();
  expect(mockMark).not.toHaveBeenCalled();
});

it.each([
  ['a path id that is not a uuid', { note: 'Margins fine' }, 'batch-1'],
  ['a note too short', { note: 'ok' }, BATCH],
  ['an extra key', { note: 'Margins fine', done: true }, BATCH],
])('400 for %s', async (_label, body, batchId) => {
  const response = await POST(...post(body, batchId));
  expect(response.status).toBe(400);
  expect(mockMark).not.toHaveBeenCalled();
});

it.each([
  ['already_done', 409],
  ['not_needed', 409],
])('P8005 %s → %s', async (details, status) => {
  mockMark.mockResolvedValue({ data: null, error: Object.assign(new Error('refused'), { code: 'P8005', details }) });
  const response = await POST(...post({ note: 'Margins fine' }));
  expect(response.status).toBe(status);
  expect((await response.json()).code).toBe(details);
  expect(mockLogAndFlush).not.toHaveBeenCalled();
});

it('404 for an unknown Apply', async () => {
  mockMark.mockResolvedValue({ data: null, error: Object.assign(new Error('refused'), { code: 'P8004' }) });
  expect((await POST(...post({ note: 'Margins fine' }))).status).toBe(404);
});

it('marks done with the session admin id and the trimmed note, and audits it (B-4: any admin)', async () => {
  const response = await POST(...post({ note: '  Margins fine at the new price  ' }));
  expect(response.status).toBe(200);
  expect(mockMark).toHaveBeenCalledWith({ adminUserId: 'admin-1', batchId: BATCH, note: 'Margins fine at the new price' });
  expect(mockLogAndFlush.mock.calls[0][0]).toMatchObject({
    action: 'AI_PRICE_MARGIN_REVIEW_DONE',
    entityId: BATCH,
    severity: 'info',
    details: expect.objectContaining({ entity_kind: 'apply_batch', note: 'Margins fine at the new price' }),
  });
});
