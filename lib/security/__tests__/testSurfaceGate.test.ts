/**
 * The test-surface gate (PROD-1c A-1 and F-2, lib/security/testSurfaceGate.ts).
 *
 * Unit level: the canonical admin gates are mocked, so these cases pin what
 * THIS module decides (that every deployment refuses a non-admin, and what a
 * refusal becomes) and nothing about how an admin is identified. The route
 * table test next to this file runs the real `requireAdmin` through the real
 * routes.
 *
 * F-2: the gate used to be open off production. It now refuses a non-admin on
 * every deployment, so every case runs over the same table of deployments,
 * production included, and the production assertions are A-1's.
 */

import * as fs from 'fs';
import * as path from 'path';

import { NextResponse } from 'next/server';

const requireAdmin = jest.fn();
jest.mock('@/lib/admin/requireAdminRoute', () => ({
  requireAdmin: (...args: unknown[]) => requireAdmin(...args),
}));

const requireAdminPage = jest.fn();
jest.mock('@/lib/admin/requireAdminPage', () => ({
  requireAdminPage: (...args: unknown[]) => requireAdminPage(...args),
}));

import { testSurfacePageGate, testSurfaceRouteGate } from '../testSurfaceGate';

const logger = { warn: jest.fn(), error: jest.fn() };

const saved = { VERCEL: process.env.VERCEL, VERCEL_ENV: process.env.VERCEL_ENV };

function setEnv(vercel: string | undefined, vercelEnv: string | undefined): void {
  if (vercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = vercel;
  if (vercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = vercelEnv;
}

/**
 * Every deployment shape A-1's predicate used to tell apart. None of them may
 * open the surface now: the open ones (local, preview, development) because
 * F-2 closed them, and the odd values because nothing reads them any more.
 */
const DEPLOYMENTS: Array<[string, string | undefined, string | undefined]> = [
  ['local and Jest: no VERCEL, no VERCEL_ENV', undefined, undefined],
  ['a Vercel preview', '1', 'preview'],
  ['Vercel development', '1', 'development'],
  ['production on Vercel', '1', 'production'],
  ['production without VERCEL (the local next start probe)', undefined, 'production'],
  ['a mis-cased value on Vercel', '1', 'Production'],
  ['an empty value on Vercel', '1', ''],
  ['an unknown environment on Vercel', '1', 'staging'],
];

beforeEach(() => {
  jest.clearAllMocks();
  setEnv(undefined, undefined);
});

afterAll(() => {
  setEnv(saved.VERCEL, saved.VERCEL_ENV);
});

describe('testSurfaceRouteGate, on every deployment', () => {
  it.each(DEPLOYMENTS)('%s: lets an admin through', async (_label, vercel, vercelEnv) => {
    setEnv(vercel, vercelEnv);
    requireAdmin.mockResolvedValue({ user: { id: 'admin-1' } });

    await expect(testSurfaceRouteGate(logger)).resolves.toBeNull();
    expect(requireAdmin).toHaveBeenCalledWith(logger);
  });

  it.each(DEPLOYMENTS.flatMap(([label, vercel, vercelEnv]) => [401, 403].map((status) => [label, status, vercel, vercelEnv] as const)))(
    '%s: turns a %p refusal into a JSON 404',
    async (_label, status, vercel, vercelEnv) => {
      setEnv(vercel, vercelEnv);
      requireAdmin.mockResolvedValue(NextResponse.json({ success: false, error: 'x' }, { status }));

      const response = await testSurfaceRouteGate(logger);

      expect(response).not.toBeNull();
      expect(response!.status).toBe(404);
      await expect(response!.json()).resolves.toEqual({ success: false, error: 'Not found' });
    }
  );

  it.each(DEPLOYMENTS)(
    '%s: fails closed to a 404 if the admin check throws, even though its contract says it never does',
    async (_label, vercel, vercelEnv) => {
      setEnv(vercel, vercelEnv);
      requireAdmin.mockRejectedValue(new Error('unreachable'));

      const response = await testSurfaceRouteGate(logger);

      expect(response!.status).toBe(404);
      expect(logger.error).toHaveBeenCalledTimes(1);
    }
  );
});

describe('testSurfacePageGate, on every deployment', () => {
  it.each(DEPLOYMENTS)('%s: asks the canonical page gate for a not-found refusal', async (_label, vercel, vercelEnv) => {
    setEnv(vercel, vercelEnv);
    requireAdminPage.mockResolvedValue({ id: 'admin-1' });

    await expect(testSurfacePageGate()).resolves.toBeUndefined();
    expect(requireAdminPage).toHaveBeenCalledWith({ onRefusal: 'notFound' });
  });

  it.each(DEPLOYMENTS)(
    "%s: does not catch the page gate's notFound() signal: it must unwind the render (SA B-2)",
    async (_label, vercel, vercelEnv) => {
      setEnv(vercel, vercelEnv);
      const signal = new Error('NEXT_NOT_FOUND');
      requireAdminPage.mockRejectedValue(signal);

      await expect(testSurfacePageGate()).rejects.toBe(signal);
    }
  );
});

/*
 * F-2, SA F2-D4 / N-1: no environment branch can come back quietly. The
 * behavioural table above only covers the deployments it lists; an opt-out
 * variable or a helper that reads the environment would pass it. So the
 * module's source is pinned: it imports only these three modules and never
 * reads `process` environment variables. An allow-list, not a deny-list,
 * because a deny-list of known helpers misses the next one.
 */
describe('testSurfaceGate.ts source', () => {
  const source = fs
    .readFileSync(path.join(__dirname, '..', 'testSurfaceGate.ts'), 'utf8')
    .replace(/\r\n/g, '\n');

  it('imports only next/server and the two canonical admin gates', () => {
    // Every module specifier, in any quote style: `import … from`, a bare
    // `import '…'`, and a re-export `export * from` / `export { … } from`.
    const specifier = /^(?:import\s+[^;]*?\bfrom|import|export\s*(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from)\s*['"]([^'"]+)['"]/gm;
    const imports = [...source.matchAll(specifier)].map((m) => m[1]).sort();
    expect(imports).toEqual(['@/lib/admin/requireAdminPage', '@/lib/admin/requireAdminRoute', 'next/server']);
    // No other way in: no require() and no dynamic import().
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).not.toMatch(/\bimport\s*\(/);
  });

  it('reads no environment variable', () => {
    expect(source).not.toMatch(/process\s*\.\s*env/);
    expect(source).not.toMatch(/process\s*\[/);
  });
});
