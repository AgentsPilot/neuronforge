/**
 * The plan checkout switch (plan payments P-3a, workplan T1): off by default,
 * server-only, read on every call.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { isPlanCheckoutEnabled } from '@/lib/business-os/billing/planCheckoutFlag';

const NAME = 'BUSINESS_OS_PLAN_CHECKOUT_ENABLED';
const original = process.env[NAME];

afterEach(() => {
  if (original === undefined) delete process.env[NAME];
  else process.env[NAME] = original;
});

describe('isPlanCheckoutEnabled', () => {
  it('is off when unset', () => {
    delete process.env[NAME];
    expect(isPlanCheckoutEnabled()).toBe(false);
  });

  it.each(['', '   ', 'yes', 'on', 'enabled', 'false', '0'])('is off for %p', (value) => {
    process.env[NAME] = value;
    expect(isPlanCheckoutEnabled()).toBe(false);
  });

  it.each(['true', 'TRUE', '1', ' true '])('is on for %p', (value) => {
    process.env[NAME] = value;
    expect(isPlanCheckoutEnabled()).toBe(true);
  });

  it('reads the variable on every call (no module cache)', () => {
    process.env[NAME] = 'true';
    expect(isPlanCheckoutEnabled()).toBe(true);
    process.env[NAME] = 'false';
    expect(isPlanCheckoutEnabled()).toBe(false);
  });

  it('is server-only: no NEXT_PUBLIC_ name, and it imports only the zero-import parser', () => {
    const source = readFileSync(join(process.cwd(), 'lib', 'business-os', 'billing', 'planCheckoutFlag.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toContain('NEXT_PUBLIC_');
    expect(code).toContain('process.env.BUSINESS_OS_PLAN_CHECKOUT_ENABLED');
    expect(source.match(/^import .*$/gm)).toEqual(["import { parseBooleanFlag } from '@/lib/utils/parseBooleanFlag';"]);
  });
});
