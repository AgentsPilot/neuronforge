/**
 * GET /api/plugins/webhooks/whatsapp-business: Meta webhook verification.
 *
 * Fails closed when WHATSAPP_VERIFY_TOKEN is unset or empty: 403 with the same
 * body as a wrong token, an error log without any token value, and the challenge
 * is never echoed. The variable is set before each GET call, not before import,
 * which proves it is read per request.
 */

import { NextRequest } from 'next/server';

const logError = jest.fn();
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {
    info: jest.fn(),
    warn: jest.fn(),
    error: (...args: unknown[]) => logError(...args),
    debug: jest.fn(),
  };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

// Importing the route must not build a Supabase client.
jest.mock('@/lib/server/user-plugin-connections', () => ({
  UserPluginConnections: { getInstance: jest.fn() },
}));

import { GET } from '../route';

const ORIGINAL = process.env.WHATSAPP_VERIFY_TOKEN;
const CHALLENGE = 'challenge-123';
const OLD_PLACEHOLDER = 'your-verify-token-here';

function verifyRequest(token: string): NextRequest {
  const params = new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': token, 'hub.challenge': CHALLENGE });
  return new NextRequest(`http://localhost/api/plugins/webhooks/whatsapp-business?${params.toString()}`);
}

function setToken(value: string | undefined): void {
  if (value === undefined) delete process.env.WHATSAPP_VERIFY_TOKEN;
  else process.env.WHATSAPP_VERIFY_TOKEN = value;
}

beforeEach(() => logError.mockReset());
afterEach(() => setToken(ORIGINAL));

describe('WhatsApp webhook verification', () => {
  describe.each([
    ['unset', undefined],
    ['empty', ''],
  ])('W-1 token %s', (_label, value) => {
    it.each([OLD_PLACEHOLDER, '', 'anything'])('refuses supplied token %p with 403 and logs an error', async (supplied) => {
      setToken(value);

      const res = await GET(verifyRequest(supplied));
      const body = await res.text();

      expect(res.status).toBe(403);
      expect(body).toBe('Forbidden');
      expect(body).not.toContain(CHALLENGE);
      expect(logError).toHaveBeenCalledTimes(1);
      if (supplied) expect(JSON.stringify(logError.mock.calls)).not.toContain(supplied);
    });
  });

  it('W-2 set: the correct token verifies and echoes the challenge', async () => {
    setToken('configured-token');
    const res = await GET(verifyRequest('configured-token'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(CHALLENGE);
    expect(logError).not.toHaveBeenCalled();
  });

  it('W-3 set: a wrong token is refused with the same 403 body', async () => {
    setToken('configured-token');
    const res = await GET(verifyRequest(OLD_PLACEHOLDER));
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('Forbidden');
  });

  it('W-4 the value is read per request, not at import', async () => {
    setToken('first-token');
    expect((await GET(verifyRequest('first-token'))).status).toBe(200);
    setToken('second-token');
    expect((await GET(verifyRequest('first-token'))).status).toBe(403);
    expect((await GET(verifyRequest('second-token'))).status).toBe(200);
  });
});
