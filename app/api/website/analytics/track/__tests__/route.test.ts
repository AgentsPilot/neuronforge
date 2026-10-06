/**
 * POST /api/website/analytics/track — purge slice 3b, AC-27 (structural half).
 *
 * After a Purge (or Reset) the business's `website_pages` rows are gone. This
 * public, unauthenticated INSERT path resolves the owner THROUGH a page, so a
 * view for a purged business must 404 before any insert — no row may be
 * attributed to the purged user. These tests pin that ordering: the owner is
 * only ever the owner of a page that was found, never a value from the body.
 *
 * The live half (a real request after a real Purge) belongs to the parent
 * workplan's post-rotation sweep (T28).
 */

import { NextRequest } from 'next/server';

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

const findById = jest.fn();
const findBySubdomainAny = jest.fn();
jest.mock('@/lib/repositories/WebsitePageRepository', () => ({
  WebsitePageRepository: jest.fn().mockImplementation(() => ({
    findById: (...a: unknown[]) => findById(...a),
    findBySubdomainAny: (...a: unknown[]) => findBySubdomainAny(...a),
  })),
}));

const trackPageView = jest.fn();
jest.mock('@/lib/repositories/WebsiteAnalyticsRepository', () => ({
  WebsiteAnalyticsRepository: jest.fn().mockImplementation(() => ({
    trackPageView: (...a: unknown[]) => trackPageView(...a),
  })),
  hashIP: () => 'hashed',
  detectDeviceType: () => 'desktop',
}));

import { POST } from '../route';

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/website/analytics/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue(null);
  trackPageView.mockResolvedValue({ data: { id: 'v1' }, error: null });
});

describe('AC-27 — a purged business gets no page-view rows', () => {
  it('public view of a subdomain with no page (purged) is a 404 and inserts nothing', async () => {
    findBySubdomainAny.mockResolvedValue({ data: null, error: null });

    const res = await POST(req({ subdomain: 'purged-business' }));

    expect(res.status).toBe(404);
    expect(trackPageView).not.toHaveBeenCalled();
  });

  it('a lookup error is treated the same way: 404, no insert', async () => {
    findBySubdomainAny.mockResolvedValue({ data: null, error: { message: 'boom' } });

    const res = await POST(req({ subdomain: 'purged-business' }));

    expect(res.status).toBe(404);
    expect(trackPageView).not.toHaveBeenCalled();
  });

  it('preview by page_id for a page that no longer exists is a 404 and inserts nothing', async () => {
    getUser.mockResolvedValue({ id: 'owner-1' });
    findById.mockResolvedValue({ data: null, error: null });

    const res = await POST(req({ page_id: '11111111-1111-4111-8111-111111111111' }));

    expect(res.status).toBe(404);
    expect(trackPageView).not.toHaveBeenCalled();
  });

  it('a user_id in the body is not a way to attribute a row (unknown keys are stripped)', async () => {
    findBySubdomainAny.mockResolvedValue({ data: null, error: null });

    await POST(req({ subdomain: 'purged-business', user_id: 'purged-user' }));

    expect(trackPageView).not.toHaveBeenCalled();
  });

  it('control: when the page exists, the row is attributed to the PAGE owner', async () => {
    findBySubdomainAny.mockResolvedValue({ data: { id: 'page-1', user_id: 'owner-1' }, error: null });

    const res = await POST(req({ subdomain: 'live-business', user_id: 'someone-else' }));

    expect(res.status).toBe(200);
    expect(trackPageView).toHaveBeenCalledTimes(1);
    expect(trackPageView.mock.calls[0][0]).toMatchObject({ page_id: 'page-1', user_id: 'owner-1' });
  });
});
