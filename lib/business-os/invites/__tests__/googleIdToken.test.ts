/**
 * The Google ID-token verifier (Slice 3b; T-3b-1, SA R-1, R-2, R-5, R-6, Q-2).
 *
 * Google's client is faked at the two calls the verifier makes, so every
 * branch is reachable without a network: the certificate fetch (R-5: an outage
 * is `unavailable`, not the invitee's bad token), the library's verification
 * (R-1: its error messages carry the payload, and nothing of them escapes), and
 * our own fail-closed claim checks (nonce, iat, email, `email_verified`, the
 * authoritative-address rule).
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

import {
  GOOGLE_ID_TOKEN_MAX_AGE_SECONDS,
  GOOGLE_ID_TOKEN_MAX_FUTURE_SECONDS,
  createGoogleIdTokenVerifier,
  hashGoogleNonce,
  verifyGoogleIdToken,
  type GoogleTokenClient,
} from '../googleIdToken';
import { googleSignInClientId } from '../googleSignInConfig';

const CLIENT_ID = '1234567890-abc.apps.googleusercontent.com';
const NOW = new Date('2026-10-01T12:00:00.000Z');
const NOW_S = NOW.getTime() / 1000;
const RAW_NONCE = 'r'.repeat(43);
const ID_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMTAxNjkifQ.c2lnbmF0dXJl';
const EMAIL = 'invitee@gmail.com';
const SUB = '110169484474386276334';

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: SUB,
    email: EMAIL,
    email_verified: true,
    name: 'Invitee Person',
    nonce: hashGoogleNonce(RAW_NONCE),
    iat: NOW_S - 30,
    exp: NOW_S + 3570,
    ...overrides,
  };
}

interface FakeOptions {
  claims?: Record<string, unknown> | undefined;
  certsFail?: boolean;
  verifyThrows?: Error;
}

function fakeClient(options: FakeOptions = {}) {
  const calls: string[] = [];
  const client: GoogleTokenClient = {
    getFederatedSignonCertsAsync: jest.fn(async () => {
      calls.push('certs');
      if (options.certsFail) throw new Error('Failed to retrieve verification certificates: getaddrinfo ENOTFOUND');
      return { certs: {} };
    }),
    verifyIdToken: jest.fn(async (args: { idToken: string; audience: string }) => {
      calls.push(`verify:${args.audience}`);
      if (options.verifyThrows) throw options.verifyThrows;
      return { getPayload: () => ('claims' in options ? options.claims : payload()) };
    }),
  };
  return { client, calls };
}

function verifier(options: FakeOptions = {}, clientId: string | null = CLIENT_ID) {
  const fake = fakeClient(options);
  return {
    ...fake,
    verify: createGoogleIdTokenVerifier({ client: fake.client, clientId: () => clientId, now: () => NOW }),
  };
}

const verifyWith = (options: FakeOptions, rawNonce = RAW_NONCE) =>
  verifier(options).verify({ idToken: ID_TOKEN, rawNonce });

describe('a valid token', () => {
  it('returns the email, trimmed and lower-cased, and nothing else', async () => {
    const { verify, calls } = verifier({ claims: payload({ email: '  Invitee@Gmail.COM ' }) });
    expect(await verify({ idToken: ID_TOKEN, rawNonce: RAW_NONCE })).toEqual({ kind: 'ok', email: EMAIL });
    // R-5: the certificates are fetched first, then the token is verified against the ONE configured audience.
    expect(calls).toEqual(['certs', `verify:${CLIENT_ID}`]);
  });

  it('accepts both issuer forms Google uses', async () => {
    expect(await verifyWith({ claims: payload({ iss: 'accounts.google.com' }) })).toEqual({ kind: 'ok', email: EMAIL });
    expect(await verifyWith({ claims: payload({ iss: 'https://accounts.google.com' }) })).toEqual({ kind: 'ok', email: EMAIL });
  });

  it('D-7: no Gmail dot or +tag folding; the address is returned as Google reports it', async () => {
    expect(await verifyWith({ claims: payload({ email: 'in.vi.tee+x@gmail.com' }) })).toEqual({ kind: 'ok', email: 'in.vi.tee+x@gmail.com' });
  });
});

describe('R-6: not configured', () => {
  it('no client id: not_configured, with no call to Google at all', async () => {
    const { verify, calls } = verifier({}, null);
    expect(await verify({ idToken: ID_TOKEN, rawNonce: RAW_NONCE })).toEqual({ kind: 'not_configured' });
    expect(calls).toEqual([]);
  });
});

describe('R-5: fail closed', () => {
  it('a failed certificate fetch is unavailable (503), not invalid, and verifies nothing', async () => {
    const { verify, calls } = verifier({ certsFail: true });
    expect(await verify({ idToken: ID_TOKEN, rawNonce: RAW_NONCE })).toEqual({ kind: 'unavailable' });
    expect(calls).toEqual(['certs']);
  });

  it('a certificate fetch that fails inside verifyIdToken (a cache refresh) is also unavailable', async () => {
    expect(
      await verifyWith({ verifyThrows: new Error('Failed to retrieve verification certificates: socket hang up') })
    ).toEqual({ kind: 'unavailable' });
  });

  it.each([
    ['a library refusal (signature, aud, exp)', { verifyThrows: new Error('Wrong recipient, payload audience != requiredAudience') }, 'verification_failed'],
    ['no payload', { claims: undefined }, 'claims_unreadable'],
    ['a foreign issuer', { claims: payload({ iss: 'https://evil.example.com' }) }, 'issuer'],
    ['a missing issuer', { claims: payload({ iss: undefined }) }, 'issuer'],
    ['another audience', { claims: payload({ aud: 'someone-else.apps.googleusercontent.com' }) }, 'audience'],
    ['a missing nonce', { claims: payload({ nonce: undefined }) }, 'nonce'],
    ['the RAW nonce instead of its hash', { claims: payload({ nonce: RAW_NONCE }) }, 'nonce'],
    ['an upper-case hex nonce', { claims: payload({ nonce: hashGoogleNonce(RAW_NONCE).toUpperCase() }) }, 'nonce'],
    ['a missing iat', { claims: payload({ iat: undefined }) }, 'issued_at'],
    ['a string iat', { claims: payload({ iat: String(NOW_S) }) }, 'issued_at'],
    ['an iat older than 600 s', { claims: payload({ iat: NOW_S - GOOGLE_ID_TOKEN_MAX_AGE_SECONDS - 1 }) }, 'issued_at'],
    ['an iat more than 300 s ahead', { claims: payload({ iat: NOW_S + GOOGLE_ID_TOKEN_MAX_FUTURE_SECONDS + 1 }) }, 'issued_at'],
    ['a missing email', { claims: payload({ email: undefined }) }, 'email_missing'],
    ['a non-string email', { claims: payload({ email: 42 }) }, 'email_missing'],
    ['an email with no domain', { claims: payload({ email: 'invitee@' }) }, 'email_missing'],
  ] as Array<[string, FakeOptions, string]>)('%s is invalid (%s)', async (_label, options, reason) => {
    expect(await verifyWith(options)).toEqual({ kind: 'invalid', reason });
  });

  it('the iat bounds are inclusive at exactly 600 s old and 300 s ahead', async () => {
    expect(await verifyWith({ claims: payload({ iat: NOW_S - GOOGLE_ID_TOKEN_MAX_AGE_SECONDS }) })).toMatchObject({ kind: 'ok' });
    expect(await verifyWith({ claims: payload({ iat: NOW_S + GOOGLE_ID_TOKEN_MAX_FUTURE_SECONDS }) })).toMatchObject({ kind: 'ok' });
  });

  it('a different raw nonce than the one hashed into the token is invalid', async () => {
    expect(await verifyWith({}, 's'.repeat(43))).toEqual({ kind: 'invalid', reason: 'nonce' });
  });

  it.each([
    ['false', false],
    ['missing', undefined],
    ['the string "true"', 'true'],
  ])('email_verified %s is unverified', async (_label, value) => {
    expect(await verifyWith({ claims: payload({ email_verified: value }) })).toEqual({ kind: 'unverified' });
  });
});

describe('R-2: Google must be authoritative for the address', () => {
  it('a Workspace account whose hd equals the email domain passes (case-insensitive)', async () => {
    expect(await verifyWith({ claims: payload({ email: 'dana@company.com', hd: 'Company.COM' }) })).toEqual({
      kind: 'ok',
      email: 'dana@company.com',
    });
  });

  it('a consumer Google account on a non-Gmail address (no hd) is not_authoritative', async () => {
    expect(await verifyWith({ claims: payload({ email: 'dana@company.com' }) })).toEqual({ kind: 'not_authoritative' });
  });

  it('an hd for another domain is not_authoritative', async () => {
    expect(await verifyWith({ claims: payload({ email: 'dana@company.com', hd: 'other.com' }) })).toEqual({ kind: 'not_authoritative' });
    expect(await verifyWith({ claims: payload({ email: 'dana@sub.company.com', hd: 'company.com' }) })).toEqual({ kind: 'not_authoritative' });
  });

  it('only gmail.com counts as Gmail (not googlemail.com, not a look-alike)', async () => {
    expect(await verifyWith({ claims: payload({ email: 'dana@googlemail.com' }) })).toEqual({ kind: 'not_authoritative' });
    expect(await verifyWith({ claims: payload({ email: 'dana@gmail.com.evil.com' }) })).toEqual({ kind: 'not_authoritative' });
  });

  it('unverified is decided before authority, and both before any address comparison (the caller does that)', async () => {
    expect(await verifyWith({ claims: payload({ email: 'dana@company.com', email_verified: false }) })).toEqual({ kind: 'unverified' });
  });
});

describe('R-1: the verifier never throws and never passes a library error on', () => {
  // Exactly the shape google-auth-library produces: the whole payload, JSON, in the message.
  const leakingError = () => new Error(`Token used too late, ${NOW_S} > ${NOW_S - 1}: ${JSON.stringify(payload())}`);

  it('a payload-bearing library error becomes a fixed reason, and no email or sub is in the result', async () => {
    const result = await verifyWith({ verifyThrows: leakingError() });
    expect(result).toEqual({ kind: 'invalid', reason: 'verification_failed' });
    const text = JSON.stringify(result);
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain(SUB);
  });

  it('a getPayload that throws, or a non-Error throw, still resolves', async () => {
    const throwingPayload: GoogleTokenClient = {
      getFederatedSignonCertsAsync: async () => ({}),
      verifyIdToken: async () => ({
        getPayload: () => {
          throw leakingError();
        },
      }),
    };
    const verify = createGoogleIdTokenVerifier({ client: throwingPayload, clientId: () => CLIENT_ID, now: () => NOW });
    await expect(verify({ idToken: ID_TOKEN, rawNonce: RAW_NONCE })).resolves.toEqual({ kind: 'invalid', reason: 'verification_failed' });

    const stringThrow: GoogleTokenClient = {
      getFederatedSignonCertsAsync: async () => ({}),
      verifyIdToken: async () => {
        throw `raw ${EMAIL}`;
      },
    };
    const verify2 = createGoogleIdTokenVerifier({ client: stringThrow, clientId: () => CLIENT_ID, now: () => NOW });
    await expect(verify2({ idToken: ID_TOKEN, rawNonce: RAW_NONCE })).resolves.toEqual({ kind: 'invalid', reason: 'verification_failed' });
  });

  it('the module logs nothing, and never rethrows or stores a caught error', () => {
    const source = readFileSync(join(process.cwd(), 'lib', 'business-os', 'invites', 'googleIdToken.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/createLogger|logger\.|console\./);
    expect(code).not.toMatch(/\bthrow\b/);
    expect(code).not.toMatch(/\.message\b(?!\.startsWith)/);
  });
});

describe('Q-2: the library, its one import and its one client', () => {
  it('googleIdToken.ts is server-only and holds one module-level OAuth2Client', () => {
    const source = readFileSync(join(process.cwd(), 'lib', 'business-os', 'invites', 'googleIdToken.ts'), 'utf8');
    expect(source.startsWith("import 'server-only';")).toBe(true);
    expect(source.match(/new OAuth2Client\(/g)).toHaveLength(1);
    expect(source).toMatch(/^const googleClient = new OAuth2Client\(\);$/m);
  });

  it('no other source file in lib/, app/, components/ or hooks/ imports google-auth-library', () => {
    const skip = new Set(['node_modules', '.next', '__tests__']);
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const entry of readdirSync(dir)) {
        if (skip.has(entry)) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.(t|j)sx?$/.test(entry)) out.push(full);
      }
      return out;
    };
    const importer = /(from\s+|require\(\s*|import\(\s*)['"]google-auth-library['"]/;
    const hits = ['lib', 'app', 'components', 'hooks']
      .flatMap((root) => walk(join(process.cwd(), root)))
      .filter((file) => importer.test(readFileSync(file, 'utf8')))
      .map((file) => relative(process.cwd(), file).split(sep).join('/'));
    expect(hits).toEqual(['lib/business-os/invites/googleIdToken.ts']);
  });

  it('the production verifier is wired to the dedicated accessor: unset means not_configured, with no network', async () => {
    const saved = process.env.NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID;
    delete process.env.NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID;
    try {
      expect(await verifyGoogleIdToken({ idToken: ID_TOKEN, rawNonce: RAW_NONCE })).toEqual({ kind: 'not_configured' });
    } finally {
      if (saved === undefined) delete process.env.NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID;
      else process.env.NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID = saved;
    }
  });
});

describe('R-6: googleSignInClientId reads the dedicated variable only', () => {
  const saved = { signin: process.env.NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID, plugin: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID };
  afterEach(() => {
    for (const [name, value] of [
      ['NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID', saved.signin],
      ['NEXT_PUBLIC_GOOGLE_CLIENT_ID', saved.plugin],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('the plugin client id being set does NOT switch Google sign-up on', () => {
    delete process.env.NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID;
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = 'plugin-client.apps.googleusercontent.com';
    expect(googleSignInClientId()).toBeNull();
  });

  it('blank means unset; a value is trimmed', () => {
    process.env.NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID = '   ';
    expect(googleSignInClientId()).toBeNull();
    process.env.NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID = `  ${CLIENT_ID}\n`;
    expect(googleSignInClientId()).toBe(CLIENT_ID);
  });

  it('the accessor names the dedicated variable with a literal member access (so Next.js inlines it) and no other', () => {
    const source = readFileSync(join(process.cwd(), 'lib', 'business-os', 'invites', 'googleSignInConfig.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).toContain('process.env.NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID');
    expect(code.match(/process\.env\.\w+/g)).toEqual(['process.env.NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID']);
  });
});
