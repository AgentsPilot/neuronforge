/**
 * GET /api/admin/environment (admin environment view EC-1; workplan §1.8.4,
 * R-1 to R-10; SA rulings OQ-2, OQ-8, conditions SA-C6, SA-C9, SA-C10, RC-5).
 *
 * The admin gate is real (with `getUser` and the access service mocked); the
 * classifier and catalogue are real unless a case swaps the classifier to make
 * it fail. All environment values are made up.
 */

import * as fs from 'fs';
import * as path from 'path';
import { NextRequest } from 'next/server';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockIsAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (...args: unknown[]) => mockIsAdmin(...args) }) },
}));
jest.mock('@/lib/audit/recordRefusedAccess', () => ({ recordRefusedAccess: jest.fn(async () => undefined) }));

const logged: Array<{ level: string; args: unknown[] }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) {
      logger[level] = (...args: unknown[]) => void logged.push({ level, args });
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

const mockAuditLog = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: { getInstance: () => ({ log: (input: unknown) => mockAuditLog(input) }) },
}));

let classifyOverride: ((...args: unknown[]) => unknown) | null = null;
jest.mock('@/lib/admin/environment/classifyEnvironment', () => {
  const actual = jest.requireActual('@/lib/admin/environment/classifyEnvironment');
  return {
    ...actual,
    classifyEnvironment: (...args: unknown[]) =>
      classifyOverride ? classifyOverride(...args) : actual.classifyEnvironment(...args),
  };
});

import { GET } from '../route';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import type { EnvironmentViewPayload } from '@/lib/admin/environment-types';

const ADMIN = { id: '11111111-1111-4111-8111-11111111111a', email: 'ops@example.test' };
const env = process.env as Record<string, string | undefined>;

const call = (query = '') => GET(new NextRequest(`http://localhost/api/admin/environment${query}`));

/** Strips block and line comments, CRLF-safe, so source pins see code only. */
function codeOf(file: string): string {
  return fs
    .readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|[^:'"`])\/\/.*$/, '$1'))
    .join('\n');
}

const ROUTE_FILE = path.join(__dirname, '..', 'route.ts');
const CLASSIFIER_FILE = path.join(__dirname, '..', '..', '..', '..', '..', 'lib', 'admin', 'environment', 'classifyEnvironment.ts');

beforeEach(() => {
  logged.length = 0;
  classifyOverride = null;
  mockGetUser.mockReset().mockResolvedValue(ADMIN);
  mockIsAdmin.mockReset().mockResolvedValue(true);
  mockAuditLog.mockReset().mockResolvedValue(undefined);
});

describe('GET /api/admin/environment', () => {
  it('R-1 an admin gets the classified view, no-store', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = (await res.json()) as { success: boolean; data: EnvironmentViewPayload };
    expect(body.success).toBe(true);
    expect(body.data.groups.length).toBeGreaterThan(10);
    expect(Array.isArray(body.data.uncategorised)).toBe(true);
    expect(body.data.counts.rows).toBeGreaterThan(100);
    expect(['production', 'preview', 'vercel-development', 'local', 'unknown']).toContain(body.data.environment.label);
  });

  it('R-2 signed out is 401 and a non-admin is 403, both no-store, nothing classified or audited', async () => {
    let classified = 0;
    classifyOverride = () => {
      classified += 1;
      throw new Error('must not run');
    };
    mockGetUser.mockResolvedValueOnce(null);
    const signedOut = await call();
    expect(signedOut.status).toBe(401);
    expect(signedOut.headers.get('Cache-Control')).toBe('no-store');

    mockIsAdmin.mockResolvedValueOnce(false);
    const refused = await call();
    expect(refused.status).toBe(403);
    expect(refused.headers.get('Cache-Control')).toBe('no-store');

    expect(classified).toBe(0);
    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  it.each(['?a=1', '?a=1&a=2', '?=', '?refresh'])('R-3 any query parameter (%s) is a 400, no-store', async (query) => {
    let classified = 0;
    classifyOverride = () => {
      classified += 1;
      return null;
    };
    const res = await call(query);
    expect(res.status).toBe(400);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json();
    expect(body).toMatchObject({ success: false, error: 'This page takes no parameters.', code: 'invalid_input' });
    expect(classified).toBe(0);
    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  it('R-4 a classifier failure is a 500 with fixed words; details only in development, as a fixed code', async () => {
    classifyOverride = () => {
      throw new TypeError('boom');
    };
    const prod = await call();
    expect(prod.status).toBe(500);
    expect(prod.headers.get('Cache-Control')).toBe('no-store');
    const prodBody = await prod.json();
    expect(prodBody).toMatchObject({ success: false, error: 'The environment view could not be built.' });
    expect(prodBody.details).toBeUndefined();

    const savedNodeEnv = env.NODE_ENV;
    env.NODE_ENV = 'development';
    try {
      const dev = await call();
      const devBody = await dev.json();
      expect(devBody.details).toBe('environment_classification_failed');
    } finally {
      env.NODE_ENV = savedNodeEnv;
    }
    const failure = logged.find((l) => l.args[1] === 'Environment view failed');
    expect(failure?.args[0]).toEqual({ adminUserId: ADMIN.id, errorClass: 'TypeError' });
    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  it('R-7 a row error is logged with the variable name and error class only', async () => {
    const actual = jest.requireActual('@/lib/admin/environment/classifyEnvironment');
    classifyOverride = (source: unknown) => {
      const result = actual.classifyEnvironment(source);
      return { ...result, rowErrors: [{ name: 'SOME_NAME', errorClass: 'RangeError' }] };
    };
    const res = await call();
    expect(res.status).toBe(200);
    const warn = logged.find((l) => l.level === 'warn');
    expect(warn?.args[0]).toEqual({ variable: 'SOME_NAME', errorClass: 'RangeError' });
  });

  it('R-8 one audit row per view: label, counts and correlation id, nothing else', async () => {
    const res = await call();
    const body = (await res.json()) as { data: EnvironmentViewPayload };
    expect(mockAuditLog).toHaveBeenCalledTimes(1);
    const input = mockAuditLog.mock.calls[0][0] as Record<string, unknown>;
    expect(input).toMatchObject({
      action: AUDIT_EVENTS.ADMIN_ENVIRONMENT_VIEWED,
      entityType: 'system',
      entityId: null,
      userId: ADMIN.id,
      actorId: ADMIN.id,
      severity: 'info',
    });
    expect(input.details).toEqual({
      correlationId: expect.any(String),
      environment: body.data.environment.label,
      ...body.data.counts,
    });
    // EC-4 (SA Q4-8): the EC-1 counts plus the four diagnostic counts, nothing else.
    expect(Object.keys(input.details as object).sort()).toEqual(
      [
        'correlationId',
        'environment',
        'notSet',
        'platformHidden',
        'requiredNotSet',
        'rows',
        'set',
        'shouldNotBeSet',
        'surroundingWhitespace',
        'uncategorised',
        'unrecognisedFlags',
      ].sort()
    );
  });

  it('R-11 an unrecognised environment still answers 200, with no expectation checks (OQ-7, SA Q4-8)', async () => {
    const saved = { VERCEL_ENV: env.VERCEL_ENV, NODE_ENV: env.NODE_ENV };
    delete env.VERCEL_ENV;
    env.NODE_ENV = 'test';
    try {
      const res = await call();
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: EnvironmentViewPayload };
      expect(body.data.environment).toMatchObject({ label: 'unknown', checkedAgainst: null });
      expect(body.data.counts.requiredNotSet).toBeNull();
      expect(body.data.counts.shouldNotBeSet).toBeNull();
      const details = (mockAuditLog.mock.calls[0][0] as { details: Record<string, unknown> }).details;
      expect(details.requiredNotSet).toBeNull();
      expect(details.shouldNotBeSet).toBeNull();
    } finally {
      if (saved.VERCEL_ENV === undefined) delete env.VERCEL_ENV;
      else env.VERCEL_ENV = saved.VERCEL_ENV;
      env.NODE_ENV = saved.NODE_ENV;
    }
  });

  it('R-9 an audit failure does not fail the view', async () => {
    mockAuditLog.mockRejectedValueOnce(new Error('audit down'));
    const res = await call();
    expect(res.status).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
    const auditError = logged.find((l) => l.args[1] === 'Audit failed (non-blocking)');
    expect(auditError?.args[0]).toEqual({ errorClass: 'Error' });
  });
});

describe('GET /api/admin/environment: source pins', () => {
  const route = codeOf(ROUTE_FILE);
  const classifier = codeOf(CLASSIFIER_FILE);

  it('R-5 segment exports are exactly runtime nodejs and dynamic force-dynamic, and GET is the only method', () => {
    const exported = [...route.matchAll(/export\s+(?:async\s+)?(?:const|function|let|var)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
    expect(exported.sort()).toEqual(['GET', 'dynamic', 'runtime']);
    expect(route).toMatch(/export const runtime = 'nodejs';/);
    expect(route).toMatch(/export const dynamic = 'force-dynamic';/);
    expect(route).not.toMatch(/export\s*\{/);
    expect(route).not.toMatch(/\b(revalidate|fetchCache)\b/);
  });

  it('R-6 requireAdmin runs before the query is read and before classification', () => {
    const body = route.slice(route.indexOf('export async function GET'));
    const gate = body.indexOf('await requireAdmin(');
    expect(gate).toBeGreaterThan(-1);
    expect(body.indexOf('searchParams')).toBeGreaterThan(gate);
    expect(body.indexOf('classifyEnvironment(')).toBeGreaterThan(gate);
    // Nothing awaited before the gate: it is the first statement that does work.
    expect(body.slice(0, gate)).not.toMatch(/\bawait\b/);
  });

  it('R-10 (RC-5) no error message or err object is logged, and the environment goes nowhere but the classifier', () => {
    for (const source of [route, classifier]) {
      expect(source).not.toMatch(/\.message\b/);
      expect(source).not.toMatch(/\{\s*err\s*[,}:]/);
      expect(source).not.toMatch(/\.\.\.\s*process\s*\.\s*env/);
      expect(source).not.toMatch(/\.\.\.\s*env\b/);
    }
    // SA E4-3: the classifier spreads nothing at all, so no entry field (and no
    // value) can ride into a row or its diagnostics.
    expect(classifier).not.toMatch(/\.\.\./);
    const uses = [...route.matchAll(/process\s*\.\s*env[^\n]{0,40}/g)].map((m) => m[0]);
    expect(uses.length).toBe(2);
    for (const use of uses) {
      expect(use).toMatch(/^process\.env(\)|\.NODE_ENV === 'development')/);
    }
    expect(route).toContain('classifyEnvironment(process.env)');
  });
});
