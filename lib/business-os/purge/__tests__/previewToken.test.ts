/**
 * Admin delete AD-2a (T1): the signed preview → commit token (purge AC-29,
 * SA-3, parent plan C-6 … C-12, SA AC2-5). Each tampered field has its own
 * code; a missing or short key throws (never "no token needed"); the raw key
 * never reaches createHmac; nothing here logs.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import {
  PREVIEW_TOKEN_CLOCK_SKEW_MS,
  PREVIEW_TOKEN_TTL_MS,
  PreviewTokenKeyError,
  isPreviewTokenKeyAvailable,
  mintPreviewToken,
  tokenDigest,
  verifyPreviewToken,
  type PreviewTokenExpectation,
  type PreviewTokenInput,
} from '../previewToken';

const KEY = 'test-service-role-key-0123456789-abcdefghijklmnop';
const ADMIN = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const NOW = 1_800_000_000_000;

const input = (o: Partial<PreviewTokenInput> = {}): PreviewTokenInput => ({
  surface: 'admin',
  actorId: ADMIN,
  targetId: TARGET,
  level: 'purge',
  options: { integrations: true, agents: false, activityHistory: false },
  confirmKind: 'business name',
  gateVersion: 1,
  schemaFingerprint: 'f'.repeat(64),
  correlationId: 'corr-preview',
  ...o,
});

const expectation = (o: Partial<PreviewTokenExpectation> = {}): PreviewTokenExpectation => ({
  surface: 'admin',
  actorId: ADMIN,
  targetId: TARGET,
  level: 'purge',
  options: { integrations: true, agents: false, activityHistory: false },
  gateVersion: 1,
  ...o,
});

const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
beforeEach(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = KEY;
});
afterAll(() => {
  if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
});

function derived(): Buffer {
  return Buffer.from(
    crypto.hkdfSync('sha256', KEY, 'agentpilot/purge-preview-token/salt/v1', 'agentpilot/purge-preview-token/v1', 32)
  );
}

/** Re-sign a modified payload with the REAL derived key, so each field check is reached past the signature. */
function forge(token: string, mutate: (p: Record<string, unknown>) => void): string {
  const [seg] = token.split('.');
  const payload = JSON.parse(Buffer.from(seg, 'base64url').toString('utf8'));
  mutate(payload);
  const newSeg = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${newSeg}.${crypto.createHmac('sha256', derived()).update(newSeg).digest('base64url')}`;
}

const codeOf = (token: string, exp = expectation(), now = NOW) => {
  const r = verifyPreviewToken(token, exp, now);
  return r.ok ? 'ok' : r.code;
};

describe('round trip', () => {
  it('a fresh token verifies and carries its payload', () => {
    const t = mintPreviewToken(input(), NOW);
    const r = verifyPreviewToken(t, expectation(), NOW + 1000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload).toMatchObject({ v: 1, surface: 'admin', actorId: ADMIN, targetId: TARGET, confirmKind: 'business name' });
    expect(r.payload.exp - r.payload.iat).toBe(PREVIEW_TOKEN_TTL_MS);
    expect(PREVIEW_TOKEN_TTL_MS).toBeLessThanOrEqual(10 * 60 * 1000);
  });

  it('ids are compared in canonical lower case', () => {
    const t = mintPreviewToken(input({ targetId: TARGET.toUpperCase() }), NOW);
    expect(codeOf(t)).toBe('ok');
  });

  it('options key order does not matter', () => {
    const t = mintPreviewToken(input({ options: { activityHistory: false, agents: false, integrations: true } }), NOW);
    expect(codeOf(t)).toBe('ok');
  });
});

describe('each mismatch has its own code (AC-A6)', () => {
  const t = () => mintPreviewToken(input(), NOW);

  it('a tampered payload that was not re-signed → token_signature', () => {
    const [seg, sig] = t().split('.');
    const p = JSON.parse(Buffer.from(seg, 'base64url').toString('utf8'));
    p.targetId = OTHER;
    expect(codeOf(`${Buffer.from(JSON.stringify(p)).toString('base64url')}.${sig}`)).toBe('token_signature');
  });

  it('a signature of another length → token_signature (length guard, no throw)', () => {
    const [seg] = t().split('.');
    expect(codeOf(`${seg}.AAAA`)).toBe('token_signature');
  });

  it('a token signed under another key → token_signature', () => {
    const minted = t();
    process.env.SUPABASE_SERVICE_ROLE_KEY = `${KEY}-rotated`;
    expect(codeOf(minted)).toBe('token_signature');
  });

  it('malformed input → token_malformed', () => {
    expect(codeOf('')).toBe('token_malformed');
    expect(codeOf('abc')).toBe('token_malformed');
    expect(codeOf('a.b.c')).toBe('token_malformed');
    expect(codeOf('a b.c')).toBe('token_malformed');
    expect(codeOf(forge(t(), (p) => delete p.confirmKind))).toBe('token_malformed');
    expect(codeOf(forge(t(), (p) => (p.exp = (p.iat as number) + PREVIEW_TOKEN_TTL_MS * 2)))).toBe('token_malformed');
  });

  it('expired, with only the skew allowance', () => {
    const token = t();
    expect(codeOf(token, expectation(), NOW + PREVIEW_TOKEN_TTL_MS + PREVIEW_TOKEN_CLOCK_SKEW_MS)).toBe('ok');
    expect(codeOf(token, expectation(), NOW + PREVIEW_TOKEN_TTL_MS + PREVIEW_TOKEN_CLOCK_SKEW_MS + 1)).toBe('token_expired');
    expect(codeOf(token, expectation(), NOW - PREVIEW_TOKEN_CLOCK_SKEW_MS - 1)).toBe('token_expired');
  });

  it('version and gateVersion (a bump voids outstanding tokens)', () => {
    expect(codeOf(forge(t(), (p) => (p.v = 2)))).toBe('token_version');
    expect(codeOf(t(), expectation({ gateVersion: 2 }))).toBe('token_gate_version');
  });

  it('another surface, admin, target, level or options', () => {
    expect(codeOf(t(), expectation({ surface: 'customer' }))).toBe('token_surface');
    expect(codeOf(t(), expectation({ actorId: '44444444-4444-4444-8444-444444444444' }))).toBe('token_actor');
    expect(codeOf(t(), expectation({ targetId: OTHER }))).toBe('token_target');
    expect(codeOf(t(), expectation({ level: 'reset' }))).toBe('token_level');
    expect(codeOf(t(), expectation({ options: { integrations: true, agents: true, activityHistory: false } }))).toBe(
      'token_options'
    );
  });
});

describe('the key (C-6, C-7, AC2-5)', () => {
  it('missing or short key: mint AND verify throw PreviewTokenKeyError, never verify', () => {
    const token = mintPreviewToken(input(), NOW);
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => mintPreviewToken(input(), NOW)).toThrow(PreviewTokenKeyError);
    expect(() => verifyPreviewToken(token, expectation(), NOW)).toThrow(PreviewTokenKeyError);
    expect(isPreviewTokenKeyAvailable()).toBe(false);

    process.env.SUPABASE_SERVICE_ROLE_KEY = 'x'.repeat(31);
    expect(() => verifyPreviewToken(token, expectation(), NOW)).toThrow(PreviewTokenKeyError);
    expect(isPreviewTokenKeyAvailable()).toBe(false);
  });

  it('a raw-key HMAC does not verify: the key really is HKDF-derived', () => {
    const [seg] = mintPreviewToken(input(), NOW).split('.');
    const rawSigned = `${seg}.${crypto.createHmac('sha256', KEY).update(seg).digest('base64url')}`;
    expect(codeOf(rawSigned)).toBe('token_signature');
    // And the HKDF-derived key does.
    const derivedSigned = `${seg}.${crypto.createHmac('sha256', derived()).update(seg).digest('base64url')}`;
    expect(codeOf(derivedSigned)).toBe('ok');
  });

  it('source pin: one createHmac call site, keyed by the derived key only', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'previewToken.ts'), 'utf8');
    const code = src.replace(/^[ \t]*\/\/.*$/gm, '');
    expect(code).toMatch(/hkdfSync\('sha256', ikm, HKDF_SALT, HKDF_INFO, 32\)/);
    expect(code.match(/createHmac\(/g)).toHaveLength(1);
    expect(code).toMatch(/createHmac\('sha256', key\)/);
  });
});

describe('never logged (C-12)', () => {
  it('the module imports no logger and writes no console', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'previewToken.ts'), 'utf8');
    const code = src.replace(/^[ \t]*\/\/.*$/gm, '');
    expect(code).not.toMatch(/createLogger|console\./);
  });

  it('tokenDigest is a short, stable handle that is not part of the token', () => {
    const token = mintPreviewToken(input(), NOW);
    expect(tokenDigest(token)).toMatch(/^[0-9a-f]{12}$/);
    expect(tokenDigest(token)).toBe(tokenDigest(token));
    expect(token).not.toContain(tokenDigest(token));
  });
});
