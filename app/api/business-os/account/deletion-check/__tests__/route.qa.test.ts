/**
 * QA pre-merge pass for DE-10b.2: the pre-check answers `{ enabled: false }`
 * for every value of the switch except exactly 'true', without reading the
 * session; the delete route answers 404 for the same values. Mocked edges
 * only: nothing here reaches Supabase.
 */

import { NextRequest } from 'next/server';

const FLAG = 'BUSINESS_OS_ACCOUNT_SELF_DELETE_ENABLED';

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

const mockSession = jest.fn();
jest.mock('@/lib/business-os/account-deletion/sessionSubject', () => {
  const actual = jest.requireActual('@/lib/business-os/account-deletion/sessionSubject');
  return { ...actual, readSessionSubject: () => mockSession() };
});
const mockRateLimit = jest.fn();
jest.mock('@/lib/security/rateLimit', () => {
  const actual = jest.requireActual('@/lib/security/rateLimit');
  return { ...actual, rateLimit: (...args: unknown[]) => mockRateLimit(...args) };
});
const mockEngine = jest.fn();
jest.mock('@/lib/business-os/account-deletion/selfServiceDeletion', () => ({
  runAccountDeletionCheck: (...args: unknown[]) => mockEngine(...args),
  runSelfAccountAnonymise: (...args: unknown[]) => mockEngine(...args),
  errorKindFacts: () => ({ kind: null, code: null, name: null }),
}));
const mockFacts = jest.fn();
jest.mock('@/lib/repositories/BusinessOsDataExportJobRepository', () => ({
  BusinessOsDataExportJobRepository: jest.fn().mockImplementation(() => ({ findDeletionFacts: (...a: unknown[]) => mockFacts(...a) })),
}));
const mockSend = jest.fn();
jest.mock('@/lib/notifications/emailTransport', () => ({ sendEmail: (...args: unknown[]) => mockSend(...args) }));
const mockAudit = jest.fn();
jest.mock('@/lib/audit/boundedAuditFlush', () => ({ logAndFlush: (...args: unknown[]) => mockAudit(...args) }));

import { GET } from '../route';
import { POST } from '../../delete/route';

const nothingRan = () => {
  expect(mockSession).not.toHaveBeenCalled();
  expect(mockRateLimit).not.toHaveBeenCalled();
  expect(mockEngine).not.toHaveBeenCalled();
  expect(mockFacts).not.toHaveBeenCalled();
  expect(mockSend).not.toHaveBeenCalled();
  expect(mockAudit).not.toHaveBeenCalled();
};

beforeEach(() => {
  for (const mock of [mockSession, mockRateLimit, mockEngine, mockFacts, mockSend, mockAudit]) mock.mockReset();
});
afterAll(() => {
  delete process.env[FLAG];
});

describe.each([[undefined], ['false'], ['1'], ['TRUE'], ['true '], ['yes']])('switch = %p', (value) => {
  beforeEach(() => {
    if (value === undefined) delete process.env[FLAG];
    else process.env[FLAG] = value;
  });

  it('GET deletion-check → 200 { success: true, data: { enabled: false } }, no-store, nothing read', async () => {
    const res = await GET(new NextRequest('http://localhost/api/business-os/account/deletion-check'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const body = await res.json();
    expect(body).toMatchObject({ success: true, data: { enabled: false } });
    expect(Object.keys(body.data)).toEqual(['enabled']);
    nothingRan();
  });

  it('POST delete → 404, even with a valid body and an extra key, nothing read', async () => {
    const res = await POST(
      new NextRequest('http://localhost/api/business-os/account/delete', {
        method: 'POST',
        body: JSON.stringify({ statement: 'x', language: 'en', userId: 'someone-else' }),
        headers: { 'content-type': 'application/json' },
      })
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('not_found');
    nothingRan();
  });
});
