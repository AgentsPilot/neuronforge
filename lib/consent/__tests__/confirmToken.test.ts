/**
 * The confirmation token, which is the only thing standing between a URL and a
 * consent record.
 *
 * Unlike the unsubscribe token, this one CREATES permission. A forgeable or
 * replayable token here does not inconvenience somebody — it manufactures
 * evidence that they agreed to something they never saw. So the properties
 * below are the feature, not hygiene around it.
 */

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.resetModules();
});

function load() {
  // Re-required per test: the secret is read at call time, and these tests
  // change it deliberately.
  return require('../confirmToken') as typeof import('../confirmToken');
}

const PAYLOAD = {
  u: 'owner-1',
  e: 'someone@example.com',
  c: 'contact-1',
  s: 'newsletter',
  l: 'en',
};

describe('consent confirmation token', () => {
  it('round-trips a payload', () => {
    process.env.CONSENT_TOKEN_SECRET = 'a-real-secret';
    const { signConsentConfirmToken, verifyConsentConfirmToken } = load();

    const result = verifyConsentConfirmToken(signConsentConfirmToken(PAYLOAD));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.e).toBe('someone@example.com');
      expect(result.payload.u).toBe('owner-1');
      expect(result.payload.v).toBe(1);
    }
  });

  it('REFUSES TO SIGN when no secret is configured', () => {
    // The failure that matters most. `BookingEmailService` falls back to the
    // literal 'fallback-secret-change-in-prod'; the same fallback here would
    // let anyone who has read this codebase mint consent for any address at
    // any business. Not sending the email is the better outcome.
    delete process.env.CONSENT_TOKEN_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    const { signConsentConfirmToken } = load();

    expect(() => signConsentConfirmToken(PAYLOAD)).toThrow(/must be set/i);
  });

  it('falls back to NEXTAUTH_SECRET rather than to a literal', () => {
    delete process.env.CONSENT_TOKEN_SECRET;
    process.env.NEXTAUTH_SECRET = 'the-app-secret';
    const { signConsentConfirmToken, verifyConsentConfirmToken } = load();

    expect(verifyConsentConfirmToken(signConsentConfirmToken(PAYLOAD)).ok).toBe(true);
  });

  it('rejects a token signed with a different secret', () => {
    process.env.CONSENT_TOKEN_SECRET = 'secret-a';
    const signed = load().signConsentConfirmToken(PAYLOAD);

    jest.resetModules();
    process.env.CONSENT_TOKEN_SECRET = 'secret-b';
    const result = load().verifyConsentConfirmToken(signed);

    expect(result).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects tampering with the address', () => {
    process.env.CONSENT_TOKEN_SECRET = 'a-real-secret';
    const { signConsentConfirmToken, verifyConsentConfirmToken } = load();

    const signed = signConsentConfirmToken(PAYLOAD);
    const [header, body, signature] = signed.split('.');
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString());
    decoded.e = 'victim@example.com';
    const forgedBody = Buffer.from(JSON.stringify(decoded)).toString('base64url');

    const result = verifyConsentConfirmToken(`${header}.${forgedBody}.${signature}`);

    expect(result).toEqual({ ok: false, reason: 'invalid' });
  });

  it('reports expiry separately, so the page can offer a fresh link', () => {
    process.env.CONSENT_TOKEN_SECRET = 'a-real-secret';
    const jwt = require('jsonwebtoken');
    const stale = jwt.sign({ ...PAYLOAD, v: 1 }, 'a-real-secret', { expiresIn: '-1s' });

    const result = load().verifyConsentConfirmToken(stale);

    // Not lumped in with 'invalid': "this expired, sign up again" is an answer
    // a person can act on, and "not valid" is not.
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  it('refuses a token from a superseded version', () => {
    process.env.CONSENT_TOKEN_SECRET = 'a-real-secret';
    const jwt = require('jsonwebtoken');
    // The escape hatch: bumping `v` invalidates every outstanding link at once.
    const old = jwt.sign({ ...PAYLOAD, v: 0 }, 'a-real-secret', { expiresIn: '7d' });

    expect(load().verifyConsentConfirmToken(old)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('refuses a well-signed token that names no address', () => {
    process.env.CONSENT_TOKEN_SECRET = 'a-real-secret';
    const jwt = require('jsonwebtoken');
    const empty = jwt.sign({ u: 'owner-1', v: 1 }, 'a-real-secret', { expiresIn: '7d' });

    expect(load().verifyConsentConfirmToken(empty)).toEqual({ ok: false, reason: 'invalid' });
  });
});
