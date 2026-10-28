/**
 * THE ACCEPTANCE GATE FOR EC-1 (SA-C7, strengthened by SA RC-3).
 *
 * Runs the REAL route with the REAL classifier and REAL catalogue, with made-up
 * fixture secrets placed in the environment for every class, and asserts that
 * no fixture secret, and no 8-character window of one (compared without regard
 * to case), reaches any of the four sinks:
 *   1. the serialised response body,
 *   2. any logger call, including `child()` bindings at every depth,
 *   3. the audit mock's arguments,
 *   4. the console.
 *
 * Mocked: the auth lookup, the admin access check, the refused-access writer,
 * the logger (recording), the audit service (recording). Nothing else.
 *
 * Every fixture is generated here and is obviously fake (it starts `FAKE`).
 * Failure messages name the fixture's label, never print a sink.
 */

import { inspect } from 'util';

import { NextRequest } from 'next/server';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockIsAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (...args: unknown[]) => mockIsAdmin(...args) }) },
}));
jest.mock('@/lib/audit/recordRefusedAccess', () => ({ recordRefusedAccess: jest.fn(async () => undefined) }));

// RC-3(b): every level call AND every child() binding, at any depth.
const loggerRecords: unknown[] = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
      logger[level] = (...args: unknown[]) => void loggerRecords.push({ level, args });
    }
    logger.child = (bindings: unknown) => {
      loggerRecords.push({ child: bindings });
      return make();
    };
    return logger;
  };
  return { createLogger: (bindings: unknown) => (loggerRecords.push({ create: bindings }), make()) };
});

const auditRecords: unknown[] = [];
let auditBehaviour: 'resolve' | 'reject-with-secret' = 'resolve';
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: {
    getInstance: () => ({
      log: (input: unknown) => {
        auditRecords.push(input);
        return auditBehaviour === 'resolve' ? Promise.resolve() : Promise.reject(new Error(`audit ${FIXTURE_FOR_ERRORS()}`));
      },
    }),
  },
}));

// RC-3(d): seams to make a row, and then the whole classification, throw an
// error whose MESSAGE carries a fixture secret.
let adminEmailsThrows = false;
jest.mock('@/lib/admin/adminEmailsEnv', () => {
  const actual = jest.requireActual('@/lib/admin/adminEmailsEnv');
  return {
    ...actual,
    parseAdminEmails: (raw: string) => {
      if (adminEmailsThrows) throw new Error(`parse failed on ${FIXTURE_FOR_ERRORS()}`);
      return actual.parseAdminEmails(raw);
    },
  };
});
let denyListThrows = false;
jest.mock('@/lib/admin/environment/platformDenyList', () => {
  const actual = jest.requireActual('@/lib/admin/environment/platformDenyList');
  return {
    ...actual,
    isPlatformNoise: (name: string) => {
      if (denyListThrows) throw new Error(`deny-list failed on ${FIXTURE_FOR_ERRORS()}`);
      return actual.isPlatformNoise(name);
    },
  };
});

// EC-6 (SA-L8): a made-up project table, so the gate checks a known label without naming a real ref.
jest.mock('@/lib/admin/environment/supabaseProjects', () => ({
  SUPABASE_URL_ROW_NAMES: ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL'],
  SUPABASE_PROJECTS: new Map([['fixtureknownref', { label: 'Fixture-project', role: 'development-staging' }]]),
}));

import { GET } from '@/app/api/admin/environment/route';
import { ENVIRONMENT_CATALOGUE, ENVIRONMENT_GROUPS } from '../catalogue';
import { UNCATALOGUED_ROLE } from '../classifyEnvironment';

// ── Fixture generation ──────────────────────────────────────────────────────

let seed = 20261026;
function nextRandom(): number {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
function fake(length = 24): string {
  let out = 'FAKE';
  while (out.length < length) out += ALPHABET[Math.floor(nextRandom() * ALPHABET.length)];
  return out;
}

/** label -> secret. Every secret here must never reach a sink. */
const secrets = new Map<string, string>();
function secretFor(label: string, length?: number): string {
  const value = fake(length);
  secrets.set(label, value);
  return value;
}

const ERROR_SECRET = secretFor('secret carried in an error message');
function FIXTURE_FOR_ERRORS(): string {
  return ERROR_SECRET;
}

const fixtureEnv: Record<string, string> = {};

// S-1: every secret and personal entry.
for (const entry of ENVIRONMENT_CATALOGUE) {
  if (entry.sensitivity === 'secret') {
    fixtureEnv[entry.name] = secretFor(entry.name);
  } else if (entry.sensitivity === 'personal') {
    if (entry.personalKind === 'list-admin-emails') {
      fixtureEnv[entry.name] = `${secretFor(`${entry.name}#1`)}@example.test, ${secretFor(`${entry.name}#2`)}@example.test`;
    } else if (entry.personalKind === 'list-boost-accounts') {
      // Addresses, not account ids: the reader honours none, so the count is 0 (QA-3).
      fixtureEnv[entry.name] = `${secretFor(`${entry.name}#1`)}@example.test,${secretFor(`${entry.name}#2`)}`;
    } else {
      fixtureEnv[entry.name] = secretFor(entry.name);
    }
  }
}
// S-1: two uncatalogued names, one that the name pattern catches and one it does not.
const UNCATALOGUED_PLAIN = 'ZZ_FIXTURE_PLAIN_SETTING';
const UNCATALOGUED_PATTERN = 'ZZ_FIXTURE_API_TOKEN';
fixtureEnv[UNCATALOGUED_PLAIN] = secretFor(UNCATALOGUED_PLAIN);
fixtureEnv[UNCATALOGUED_PATTERN] = secretFor(UNCATALOGUED_PATTERN);
// S-2: a JWT-shaped value and a key-shaped value under config entries.
fixtureEnv.GOOGLE_SEARCH_ENGINE_ID = `eyJ${secretFor('jwt header')}.${secretFor('jwt payload')}.${secretFor('jwt signature')}`;
fixtureEnv.STRIPE_CLIENT_ID = secretFor('key-shaped config', 48);
// S-3: a URL with secrets in user-info, password, path and query.
fixtureEnv.NEXT_PUBLIC_APP_URL =
  `https://${secretFor('url user')}:${secretFor('url password')}@example.test/hook/${secretFor('url path')}` +
  `?token=${secretFor('url query')}#${secretFor('url fragment')}`;
// S-3b (EC-6, SA-L8): a credential-bearing URL on a Supabase host, on both Supabase rows.
const SUPABASE_FIXTURE_ORIGIN = 'https://fixtureknownref.supabase.co';
fixtureEnv.NEXT_PUBLIC_SUPABASE_URL =
  `https://${secretFor('supabase url user')}:${secretFor('supabase url password')}@fixtureknownref.supabase.co` +
  `/rest/v1/${secretFor('supabase url path')}?apikey=${secretFor('supabase url query')}`;
fixtureEnv.SUPABASE_URL = `https://${secretFor('supabase server url user')}@fixtureknownref.supabase.co/${secretFor('supabase server url path')}`;
// S-4: an unrecognised flag value that is itself a secret, lenient and strict.
fixtureEnv.ADMIN_BUSINESS_DELETE_ENABLED = secretFor('lenient flag value');
fixtureEnv.CALIBRATION_AUTO_RCA_ENABLED = secretFor('strict flag value');
// S-5 (RC-3(c)): deny-listed names, upper and lower case, carrying secrets.
const DENY_LISTED = ['AWS_SESSION_TOKEN', 'npm_config_fixture_secret', 'lc_fixture_thing'];
for (const name of DENY_LISTED) fixtureEnv[name] = secretFor(name);

/** Names that may legitimately appear in a body (catalogued and uncategorised). */
const ALLOWED_TEXT = [
  ...ENVIRONMENT_CATALOGUE.flatMap((e) => [e.name, e.role, ...(e.sensitivity === 'config' && e.shape === 'enum' ? e.enumValues : [])]),
  ...ENVIRONMENT_GROUPS.flatMap((g) => [g.id, g.label, g.description]),
  UNCATALOGUED_ROLE,
  UNCATALOGUED_PLAIN,
  UNCATALOGUED_PATTERN,
  'https://example.test',
  SUPABASE_FIXTURE_ORIGIN,
  'Fixture-project',
].join('\n').toLowerCase();

function windowsOf(secret: string): string[] {
  const out: string[] = [];
  for (let i = 0; i + 8 <= secret.length; i += 1) out.push(secret.slice(i, i + 8).toLowerCase());
  return out;
}

/** Returns the labels of fixtures that leaked into `text`. Never the text itself. */
function leaksIn(text: string): string[] {
  const lower = text.toLowerCase();
  const leaked: string[] = [];
  for (const [label, secret] of secrets) {
    if (windowsOf(secret).some((w) => lower.includes(w))) leaked.push(label);
  }
  return leaked;
}

/**
 * SA CR-1: how a sink is turned into text for the check. NOT `JSON.stringify`,
 * which writes an Error as `{}` and drops Map and Set contents, so a secret in
 * `err.message` (which Pino WOULD write) would pass unseen. `util.inspect` with
 * no depth or length limits expands errors (name, message, stack, cause),
 * collections and nested objects.
 */
function sinkText(value: unknown): string {
  return inspect(value, { depth: null, maxArrayLength: null, maxStringLength: null, breakLength: Infinity, showHidden: false });
}

// ── Harness ─────────────────────────────────────────────────────────────────

const env = process.env as Record<string, string | undefined>;
const saved: Record<string, string | undefined> = {};
const consoleRecords: unknown[] = [];
const consoleSpies: jest.SpyInstance[] = [];

beforeAll(() => {
  for (const [name, value] of Object.entries(fixtureEnv)) {
    saved[name] = env[name];
    env[name] = value;
  }
  saved.NODE_ENV = env.NODE_ENV;
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    consoleSpies.push(jest.spyOn(console, method).mockImplementation((...args: unknown[]) => void consoleRecords.push(args)));
  }
});

afterAll(() => {
  for (const name of Object.keys(saved)) {
    if (saved[name] === undefined) delete env[name];
    else env[name] = saved[name];
  }
  for (const spy of consoleSpies) spy.mockRestore();
});

beforeEach(() => {
  loggerRecords.length = 0;
  auditRecords.length = 0;
  consoleRecords.length = 0;
  auditBehaviour = 'resolve';
  adminEmailsThrows = false;
  denyListThrows = false;
  env.NODE_ENV = saved.NODE_ENV;
  mockGetUser.mockReset().mockResolvedValue({ id: '11111111-1111-4111-8111-11111111111a', email: 'ops@example.test' });
  mockIsAdmin.mockReset().mockResolvedValue(true);
});

async function runAndCollect(): Promise<{ status: number; body: string; parsed: Record<string, unknown> }> {
  const res = await GET(new NextRequest('http://localhost/api/admin/environment'));
  const body = await res.text();
  // Let the non-blocking audit .catch run before the sinks are read.
  await new Promise((resolve) => setImmediate(resolve));
  return { status: res.status, body, parsed: JSON.parse(body) as Record<string, unknown> };
}

function expectNoLeakAnywhere(body: string): void {
  expect({ sink: 'response body', leaked: leaksIn(body) }).toEqual({ sink: 'response body', leaked: [] });
  expect({ sink: 'logger', leaked: leaksIn(sinkText(loggerRecords)) }).toEqual({ sink: 'logger', leaked: [] });
  expect({ sink: 'audit', leaked: leaksIn(sinkText(auditRecords)) }).toEqual({ sink: 'audit', leaked: [] });
  expect({ sink: 'console', leaked: leaksIn(sinkText(consoleRecords)) }).toEqual({ sink: 'console', leaked: [] });
}

// ── The gate ────────────────────────────────────────────────────────────────

describe('SA-C7 serialisation gate', () => {
  it('pre-check: no fixture window occurs in any text the response may legitimately carry', () => {
    expect(secrets.size).toBeGreaterThan(60);
    expect(leaksIn(ALLOWED_TEXT)).toEqual([]);
  });

  it('negative control (SA CR-1): a logged Error, a cause, a Map and a Set are all expanded and caught', () => {
    const sample = secrets.get('url query') as string;
    // The exact shape a careless `logger.error({ err }, ...)` would record.
    expect(leaksIn(sinkText([{ level: 'error', args: [{ err: new Error(`failed on ${sample}`) }, 'x'] }]))).toContain('url query');
    expect(leaksIn(sinkText({ err: new Error('outer', { cause: new Error(sample) }) }))).toContain('url query');
    expect(leaksIn(sinkText({ m: new Map([['k', sample]]) }))).toContain('url query');
    expect(leaksIn(sinkText({ s: new Set([sample]) }))).toContain('url query');
    // ...which JSON.stringify would have missed: the reason for CR-1.
    expect(leaksIn(JSON.stringify({ err: new Error(sample) }))).not.toContain('url query');
  });

  it('negative control: the detector finds an 8-character window in any case', () => {
    const sample = secrets.get('url path') as string;
    expect(leaksIn(`prefix ${sample.slice(3, 11).toUpperCase()} suffix`)).toContain('url path');
    expect(leaksIn(`prefix ${sample.slice(3, 10)} suffix`)).not.toContain('url path');
  });

  it('S-1..S-5: a normal view leaks no fixture into any sink', async () => {
    const { status, body, parsed } = await runAndCollect();
    expect(status).toBe(200);
    expect(parsed.success).toBe(true);
    expectNoLeakAnywhere(body);

    // The masking did what it should, not merely "nothing leaked".
    const data = parsed.data as { groups: Array<{ rows: Array<{ name: string; display: unknown }> }>; uncategorised: Array<{ name: string }> };
    const rows = new Map(data.groups.flatMap((g) => g.rows).map((r) => [r.name, r.display]));
    expect(rows.get('NEXT_PUBLIC_APP_URL')).toEqual({ kind: 'shown', text: 'https://example.test' });
    // S-3b (EC-6): the label shows; no part of the credential does (checked by expectNoLeakAnywhere above).
    const projects = new Map(
      (parsed.data as { groups: Array<{ rows: Array<{ name: string; supabaseProject?: unknown; diagnostics: string[] }> }> }).groups
        .flatMap((g) => g.rows)
        .map((r) => [r.name, r])
    );
    for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL']) {
      expect(rows.get(name)).toEqual({ kind: 'shown', text: SUPABASE_FIXTURE_ORIGIN });
      expect(projects.get(name)?.supabaseProject).toEqual({ kind: 'known', label: 'Fixture-project', role: 'development-staging' });
      expect(projects.get(name)?.diagnostics).not.toContain('supabase-url-mismatch');
    }
    expect(body).toContain('Fixture-project');
    expect(rows.get('GOOGLE_SEARCH_ENGINE_ID')).toEqual({ kind: 'hidden', reason: 'not-plain-config' });
    expect(rows.get('STRIPE_CLIENT_ID')).toEqual({ kind: 'hidden', reason: 'not-plain-config' });
    expect(rows.get('ADMIN_BUSINESS_DELETE_ENABLED')).toEqual({ kind: 'flag', state: 'off', source: 'unrecognised' });
    expect(rows.get('CALIBRATION_AUTO_RCA_ENABLED')).toEqual({ kind: 'flag', state: 'off', source: 'unrecognised' });
    expect(rows.get('ADMIN_EMAILS')).toEqual({ kind: 'count', entries: 2 });
    expect(rows.get('BUSINESS_OS_CREDITS_BOOST_TEST_ACCOUNTS')).toEqual({ kind: 'count', entries: 0 });
    expect(data.uncategorised.map((r) => r.name)).toEqual(expect.arrayContaining([UNCATALOGUED_PLAIN, UNCATALOGUED_PATTERN]));

    // S-5: deny-listed names are absent from every sink, as names too.
    const everySink = [body, sinkText(loggerRecords), sinkText(auditRecords), sinkText(consoleRecords)].join('\n');
    for (const name of DENY_LISTED) expect({ name, present: everySink.toLowerCase().includes(name.toLowerCase()) }).toEqual({ name, present: false });

    // The audit row names no variable at all.
    const audit = sinkText(auditRecords);
    for (const name of [UNCATALOGUED_PLAIN, UNCATALOGUED_PATTERN, ...ENVIRONMENT_CATALOGUE.map((e) => e.name)]) {
      expect({ name, inAudit: audit.includes(name) }).toEqual({ name, inAudit: false });
    }
  });

  it('a rejecting audit whose error carries a fixture leaks nothing', async () => {
    auditBehaviour = 'reject-with-secret';
    const { status, body } = await runAndCollect();
    expect(status).toBe(200);
    expectNoLeakAnywhere(body);
  });

  it('S-6a a row error whose message carries a fixture is masked and leaks nothing, in development', async () => {
    env.NODE_ENV = 'development';
    adminEmailsThrows = true;
    const { status, body, parsed } = await runAndCollect();
    expect(status).toBe(200);
    const data = parsed.data as { groups: Array<{ rows: Array<{ name: string; display: unknown }> }> };
    const adminEmails = data.groups.flatMap((g) => g.rows).find((r) => r.name === 'ADMIN_EMAILS');
    expect(adminEmails?.display).toEqual({ kind: 'hidden', reason: 'classification-error' });
    expectNoLeakAnywhere(body);
  });

  describe('S-7 (EC-4) every diagnostic code, under every label, leaks nothing', () => {
    const CODES = ['required-not-set', 'should-not-be-set', 'unrecognised-flag', 'surrounding-whitespace', 'supabase-url-mismatch'];
    const LABELS: Array<[string, { VERCEL_ENV?: string; NODE_ENV: string }]> = [
      ['production', { VERCEL_ENV: 'production', NODE_ENV: 'production' }],
      ['preview', { VERCEL_ENV: 'preview', NODE_ENV: 'production' }],
      ['local', { NODE_ENV: 'development' }],
      ['unknown', { NODE_ENV: 'test' }],
    ];
    const PADDED_SECRET = 'STRIPE_SECRET_KEY';
    const REQUIRED_REMOVED = 'SUPABASE_SERVICE_ROLE_KEY';
    let savedVercelEnv: string | undefined;

    type Row = { name: string; display: unknown; diagnostics: string[] };
    type Data = { environment: { label: string; checkedAgainst: string | null }; groups: Array<{ rows: Row[] }>; uncategorised: Row[]; counts: Record<string, number | null> };

    beforeAll(() => {
      savedVercelEnv = env.VERCEL_ENV;
    });
    afterEach(() => {
      if (savedVercelEnv === undefined) delete env.VERCEL_ENV;
      else env.VERCEL_ENV = savedVercelEnv;
      env[PADDED_SECRET] = fixtureEnv[PADDED_SECRET];
      env[REQUIRED_REMOVED] = fixtureEnv[REQUIRED_REMOVED];
      env[UNCATALOGUED_PLAIN] = fixtureEnv[UNCATALOGUED_PLAIN];
    });

    function applyLabel(vars: { VERCEL_ENV?: string; NODE_ENV: string }): void {
      if (vars.VERCEL_ENV === undefined) delete env.VERCEL_ENV;
      else env.VERCEL_ENV = vars.VERCEL_ENV;
      env.NODE_ENV = vars.NODE_ENV;
    }

    it.each(LABELS)('%s', async (label, vars) => {
      applyLabel(vars);
      // Triggers: a whitespace-wrapped secret, an unset required secret, a padded
      // uncatalogued name; the fixtures already hold an unrecognised flag and a
      // set secret that is forbidden on production and preview.
      env[PADDED_SECRET] = ` ${fixtureEnv[PADDED_SECRET]}\r\n`;
      delete env[REQUIRED_REMOVED];
      env[UNCATALOGUED_PLAIN] = `\t${fixtureEnv[UNCATALOGUED_PLAIN]} `;

      const { status, body, parsed } = await runAndCollect();
      expect(status).toBe(200);
      expectNoLeakAnywhere(body);

      const data = parsed.data as Data;
      expect(data.environment.label).toBe(label);
      const rows = data.groups.flatMap((g) => g.rows);
      for (const row of [...rows, ...data.uncategorised]) {
        expect(Array.isArray(row.diagnostics)).toBe(true);
        for (const code of row.diagnostics) expect({ name: row.name, code, known: CODES.includes(code) }).toEqual({ name: row.name, code, known: true });
      }
      const seen = new Set(rows.flatMap((r) => r.diagnostics));
      expect(seen.has('unrecognised-flag')).toBe(true);
      expect(seen.has('surrounding-whitespace')).toBe(true);
      expect(rows.find((r) => r.name === PADDED_SECRET)?.display).toEqual({ kind: 'status', set: true });
      expect(data.uncategorised.find((r) => r.name === UNCATALOGUED_PLAIN)?.diagnostics).toEqual([]);
      if (label === 'unknown') {
        expect(data.environment.checkedAgainst).toBeNull();
        expect(data.counts.requiredNotSet).toBeNull();
        expect(data.counts.shouldNotBeSet).toBeNull();
        expect(seen.has('required-not-set') || seen.has('should-not-be-set')).toBe(false);
      } else {
        expect(rows.find((r) => r.name === REQUIRED_REMOVED)?.diagnostics).toContain('required-not-set');
        if (label !== 'local') expect(rows.find((r) => r.name === 'NODE_TLS_REJECT_UNAUTHORIZED')?.diagnostics).toContain('should-not-be-set');
      }

      // The audit row: the EC-1 keys plus the four EC-4 counts and the EC-6 mismatch count, nothing else.
      const audit = auditRecords[0] as { details: Record<string, unknown> };
      expect(Object.keys(audit.details).sort()).toEqual(
        [
          'correlationId',
          'environment',
          'notSet',
          'platformHidden',
          'requiredNotSet',
          'rows',
          'set',
          'shouldNotBeSet',
          'supabaseUrlMismatch',
          'surroundingWhitespace',
          'uncategorised',
          'unrecognisedFlags',
        ].sort()
      );
    });

    it('M-7 (e): wrapping a secret in whitespace changes only that row\'s diagnostics and the whitespace count', async () => {
      applyLabel({ VERCEL_ENV: 'production', NODE_ENV: 'production' });
      const plain = (await runAndCollect()).parsed.data as Data & { generatedAt?: string };
      env[PADDED_SECRET] = `\n${fixtureEnv[PADDED_SECRET]} `;
      const padded = (await runAndCollect()).parsed.data as Data & { generatedAt?: string };
      expect(leaksIn(JSON.stringify(padded))).toEqual([]);

      const strip = (d: Data & { generatedAt?: string }) => {
        const copy = JSON.parse(JSON.stringify(d)) as Data & { generatedAt?: string };
        delete copy.generatedAt;
        return copy;
      };
      const a = strip(plain);
      const b = strip(padded);
      const rowOf = (d: Data) => d.groups.flatMap((g) => g.rows).find((r) => r.name === PADDED_SECRET) as Row;
      expect(rowOf(a).diagnostics).not.toContain('surrounding-whitespace');
      expect(rowOf(b).diagnostics).toEqual([...rowOf(a).diagnostics, 'surrounding-whitespace']);
      expect(b.counts.surroundingWhitespace).toBe((a.counts.surroundingWhitespace as number) + 1);
      // Undo exactly those two differences: the rest must be identical.
      rowOf(b).diagnostics = rowOf(a).diagnostics;
      b.counts.surroundingWhitespace = a.counts.surroundingWhitespace;
      expect(b).toEqual(a);
    });
  });

  it('S-6b a whole-classification throw carrying a fixture is a 500 with the fixed code, in development', async () => {
    env.NODE_ENV = 'development';
    denyListThrows = true;
    const { status, body, parsed } = await runAndCollect();
    expect(status).toBe(500);
    expect(parsed.details).toBe('environment_classification_failed');
    expectNoLeakAnywhere(body);
  });
});
