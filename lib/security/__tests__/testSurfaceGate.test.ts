/**
 * The test-surface gate (PROD-1c A-1, lib/security/testSurfaceGate.ts).
 *
 * Unit level: the canonical admin gates are mocked, so these cases pin what
 * THIS module decides (when the surface is closed, and what a refusal becomes)
 * and nothing about how an admin is identified. The route table test next to
 * this file runs the real `requireAdmin` through the real routes.
 */

import { NextResponse } from 'next/server';

const requireAdmin = jest.fn();
jest.mock('@/lib/admin/requireAdminRoute', () => ({
  requireAdmin: (...args: unknown[]) => requireAdmin(...args),
}));

const requireAdminPage = jest.fn();
jest.mock('@/lib/admin/requireAdminPage', () => ({
  requireAdminPage: (...args: unknown[]) => requireAdminPage(...args),
}));

import { isTestSurfaceClosed, testSurfacePageGate, testSurfaceRouteGate } from '../testSurfaceGate';

const logger = { warn: jest.fn(), error: jest.fn() };

const saved = { VERCEL: process.env.VERCEL, VERCEL_ENV: process.env.VERCEL_ENV };

function setEnv(vercel: string | undefined, vercelEnv: string | undefined): void {
  if (vercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = vercel;
  if (vercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = vercelEnv;
}

beforeEach(() => {
  jest.clearAllMocks();
  setEnv(undefined, undefined);
});

afterAll(() => {
  setEnv(saved.VERCEL, saved.VERCEL_ENV);
});

describe('isTestSurfaceClosed', () => {
  it.each([
    ['local and Jest: no VERCEL, no VERCEL_ENV', undefined, undefined, false],
    ['a Vercel preview', '1', 'preview', false],
    ['Vercel development', '1', 'development', false],
    ['production on Vercel', '1', 'production', true],
    ['production without VERCEL (the local next start probe)', undefined, 'production', true],
    // Fail closed (SA D-10): on Vercel, anything but the two exact open values closes.
    ['a mis-cased value on Vercel', '1', 'Production', true],
    ['an empty value on Vercel', '1', '', true],
    ['VERCEL_ENV missing on Vercel', '1', undefined, true],
    ['an unknown environment on Vercel', '1', 'staging', true],
    ['a padded value on Vercel', '1', ' preview', true],
  ])('%s -> closed=%p', (_label, vercel, vercelEnv, closed) => {
    expect(isTestSurfaceClosed(vercelEnv, vercel)).toBe(closed);
    // The defaults read the same variables.
    setEnv(vercel, vercelEnv);
    expect(isTestSurfaceClosed()).toBe(closed);
  });
});

describe('testSurfaceRouteGate', () => {
  it('is a no-op where the surface is open, and never asks who the caller is', async () => {
    for (const [vercel, vercelEnv] of [
      [undefined, undefined],
      ['1', 'preview'],
      ['1', 'development'],
    ] as const) {
      setEnv(vercel, vercelEnv);
      await expect(testSurfaceRouteGate(logger)).resolves.toBeNull();
    }
    expect(requireAdmin).not.toHaveBeenCalled();
  });

  it('lets an admin through on production', async () => {
    setEnv('1', 'production');
    requireAdmin.mockResolvedValue({ user: { id: 'admin-1' } });

    await expect(testSurfaceRouteGate(logger)).resolves.toBeNull();
    expect(requireAdmin).toHaveBeenCalledWith(logger);
  });

  it.each([401, 403])('turns a %p refusal into a JSON 404 on production', async (status) => {
    setEnv('1', 'production');
    requireAdmin.mockResolvedValue(NextResponse.json({ success: false, error: 'x' }, { status }));

    const response = await testSurfaceRouteGate(logger);

    expect(response).not.toBeNull();
    expect(response!.status).toBe(404);
    await expect(response!.json()).resolves.toEqual({ success: false, error: 'Not found' });
  });

  it('fails closed to a 404 if the admin check throws, even though its contract says it never does', async () => {
    setEnv('1', 'production');
    requireAdmin.mockRejectedValue(new Error('unreachable'));

    const response = await testSurfaceRouteGate(logger);

    expect(response!.status).toBe(404);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('refuses on an unrecognised VERCEL_ENV the same way as on production', async () => {
    setEnv('1', 'Production');
    requireAdmin.mockResolvedValue(NextResponse.json({ success: false }, { status: 401 }));

    expect((await testSurfaceRouteGate(logger))!.status).toBe(404);
  });
});

describe('testSurfacePageGate', () => {
  it('is a no-op where the surface is open', async () => {
    setEnv('1', 'preview');
    await expect(testSurfacePageGate()).resolves.toBeUndefined();
    expect(requireAdminPage).not.toHaveBeenCalled();
  });

  it("asks the canonical page gate for a 404 refusal on production", async () => {
    setEnv('1', 'production');
    requireAdminPage.mockResolvedValue({ id: 'admin-1' });

    await expect(testSurfacePageGate()).resolves.toBeUndefined();
    expect(requireAdminPage).toHaveBeenCalledWith({ onRefusal: 'notFound' });
  });

  it("does not catch the page gate's notFound() signal: it must unwind the render (SA B-2)", async () => {
    setEnv('1', 'production');
    const signal = new Error('NEXT_NOT_FOUND');
    requireAdminPage.mockRejectedValue(signal);

    await expect(testSurfacePageGate()).rejects.toBe(signal);
  });
});
