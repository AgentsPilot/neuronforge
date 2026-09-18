/**
 * POST /api/website/media/generate — the one entry point for AI images
 * (Layer 1.5 FR-11, FR-12, AC-9).
 *
 * The route mints one grouping id per request, logs it with the correlation
 * id, and passes the session user plus that id to the service. The service's
 * own test proves the owner reaches the ledger row.
 */

import { NextRequest } from 'next/server';

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

const infoLogs: unknown[][] = [];
jest.mock('@/lib/logger', () => {
  const make = (bindings: Record<string, unknown> = {}): Record<string, unknown> => {
    const logger: Record<string, unknown> = {
      info: (...a: unknown[]) => infoLogs.push([bindings, ...a]),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    logger.child = (more: Record<string, unknown>) => make({ ...bindings, ...more });
    return logger;
  };
  return { createLogger: () => make() };
});

const mockGenerateImage = jest.fn();
const mockAllowance = jest.fn();
jest.mock('@/lib/services/GeneratedImageService', () => ({
  generateImage: (...a: unknown[]) => mockGenerateImage(...a),
  generationAllowance: (...a: unknown[]) => mockAllowance(...a),
}));

import { POST } from '../route';
import { isUuid, type BosLlmOwner } from '@/lib/business-os/llm/callCatalog';

const USER = { id: '2f734ed5-3681-4049-880d-3de7b096bea3', email: 'owner@example.com' };
const OTHER = '11111111-1111-4111-8111-111111111111';

function req(body: Record<string, unknown>, correlationId = 'corr-1'): NextRequest {
  return new NextRequest('http://localhost/api/website/media/generate', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-correlation-id': correlationId },
  });
}

function ownerOfCall(i: number): BosLlmOwner {
  return mockGenerateImage.mock.calls[i][0] as BosLlmOwner;
}

beforeEach(() => {
  infoLogs.length = 0;
  getUser.mockResolvedValue(USER);
  mockGenerateImage.mockReset();
  mockGenerateImage.mockResolvedValue({ ok: true, url: 'https://cdn.example/x.png', description: 'x' });
  mockAllowance.mockResolvedValue({ used: 1, limit: 10, remaining: 9 });
});

describe('POST /api/website/media/generate — attribution', () => {
  it('passes the session user and a freshly minted group to the service', async () => {
    const res = await POST(req({ prompt: 'A calm treatment room', aspect: 'wide' }));
    expect(res.status).toBe(200);

    const owner = ownerOfCall(0);
    expect(owner.userId).toBe(USER.id);
    expect(isUuid(owner.groupId)).toBe(true);
  });

  it('gives a second request a different group', async () => {
    await POST(req({ prompt: 'A calm treatment room' }));
    await POST(req({ prompt: 'A calm treatment room' }));
    expect(ownerOfCall(0).groupId).not.toBe(ownerOfCall(1).groupId);
  });

  it('logs the group with the request correlation id', async () => {
    await POST(req({ prompt: 'A calm treatment room' }, 'corr-xyz'));
    const groupId = ownerOfCall(0).groupId;
    const line = infoLogs.find(([, fields]) => (fields as Record<string, unknown>)?.groupId === groupId);
    expect(line?.[0]).toMatchObject({ correlationId: 'corr-xyz' });
  });

  it('never takes the account or the group from the body', async () => {
    await POST(req({ prompt: 'A calm treatment room', userId: OTHER, groupId: OTHER, sessionId: OTHER }));
    const owner = ownerOfCall(0);
    expect(owner.userId).toBe(USER.id);
    expect(owner.groupId).not.toBe(OTHER);
  });

  it('refuses an anonymous request before minting anything', async () => {
    getUser.mockResolvedValue(null);
    const res = await POST(req({ prompt: 'A calm treatment room' }));
    expect(res.status).toBe(401);
    expect(mockGenerateImage).not.toHaveBeenCalled();
  });

  it('keeps the existing refusals: 429 at the cap, 400 for people, 503 otherwise', async () => {
    mockGenerateImage.mockResolvedValueOnce({ ok: false, reason: 'limit_reached', used: 10, limit: 10 });
    expect((await POST(req({ prompt: 'A calm treatment room' }))).status).toBe(429);
    mockGenerateImage.mockResolvedValueOnce({ ok: false, reason: 'depicts_people' });
    expect((await POST(req({ prompt: 'A calm treatment room' }))).status).toBe(400);
    mockGenerateImage.mockResolvedValueOnce({ ok: false, reason: 'failed' });
    expect((await POST(req({ prompt: 'A calm treatment room' }))).status).toBe(503);
  });
});
