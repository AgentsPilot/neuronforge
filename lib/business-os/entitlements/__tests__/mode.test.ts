/**
 * The switch, and the launch gate that will not let it be turned all the way on
 * too early (UD-2).
 *
 * This is the one place where the right answer is to IGNORE the operator: a
 * deployment that sets `enforce` before a tier exists has asked for every new
 * signup to reach the end of their trial with nothing to buy.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { getEntitlementMode, isEntitlementResolutionEnabled, MODE_ENV_VAR } from '@/lib/business-os/entitlements/mode';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import { LAUNCH } from '@/lib/business-os/entitlements/config/launch';

/** Mocked so the refusal can be asserted rather than assumed. */
const logged = { error: jest.fn() };
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    error: (...args: unknown[]) => logged.error(...args),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(),
  }),
}));

beforeEach(() => logged.error.mockClear());

const original = process.env[MODE_ENV_VAR];

afterEach(() => {
  if (original === undefined) delete process.env[MODE_ENV_VAR];
  else process.env[MODE_ENV_VAR] = original;
});

function withMode(value: string | undefined) {
  if (value === undefined) delete process.env[MODE_ENV_VAR];
  else process.env[MODE_ENV_VAR] = value;
}

describe('the mode', () => {
  it('is off when nothing is set — the default everything else assumes', () => {
    withMode(undefined);
    expect(getEntitlementMode()).toBe('off');
    expect(isEntitlementResolutionEnabled()).toBe(false);
  });

  it('is off for an empty or blank value', () => {
    withMode('');
    expect(getEntitlementMode()).toBe('off');
    withMode('   ');
    expect(getEntitlementMode()).toBe('off');
  });

  it('reads shadow, case-insensitively', () => {
    withMode('shadow');
    expect(getEntitlementMode()).toBe('shadow');
    withMode('SHADOW');
    expect(getEntitlementMode()).toBe('shadow');
    expect(isEntitlementResolutionEnabled()).toBe(true);
  });

  it('treats a value it does not recognise as OFF, not as enforce', () => {
    withMode('enforcing');
    expect(getEntitlementMode()).toBe('off');
  });

  it('is read afresh every call, so changing it does not need a redeploy', () => {
    withMode('off');
    expect(getEntitlementMode()).toBe('off');
    withMode('shadow');
    expect(getEntitlementMode()).toBe('shadow');
  });
});

describe('UD-2 — enforce is refused while no tier is configured', () => {
  it('downgrades enforce to shadow on the shipped config', () => {
    // Production ships NO tiers (U-1), so this is the live behaviour today.
    expect(TIER_ORDER.length).toBe(0);
    expect(LAUNCH.enforceRequiresConfiguredTier).toBe(true);

    withMode('enforce');
    expect(getEntitlementMode()).toBe('shadow');
  });

  it('refuses LOUDLY, at error level, naming the reason', () => {
    // A deployment that believes it is enforcing and is not is exactly the kind
    // of thing nobody notices. The refusal is an `error`, not a `warn`.
    withMode('enforce');
    getEntitlementMode();

    expect(logged.error).toHaveBeenCalledTimes(1);
    expect(logged.error.mock.calls[0][0]).toMatchObject({ effectiveMode: 'shadow', reason: 'no_tier_configured' });
  });

  it('says nothing when the mode is a legitimate one', () => {
    // The negative control on the assertion above: a logger that shouted on
    // every call would satisfy it.
    withMode('shadow');
    getEntitlementMode();
    expect(logged.error).not.toHaveBeenCalled();
  });
});

describe('RC-7, restated (SA C3-1) — the mode reader cannot run config validation', () => {
  it('imports neither source.ts nor schema.ts', () => {
    // The property is narrow on purpose: `shadow.ts` imports this file and the
    // chat route imports `shadow.ts`, so anything that could THROW AT IMPORT
    // here would take chat down at cold start with entitlements switched OFF.
    // `source.ts` loads and Zod-parses the configuration; `schema.ts` is the Zod
    // itself. `config/launch.ts` and `config/tierMatrix.ts` are data and are
    // imported normally.
    const source = readFileSync(join(process.cwd(), 'lib', 'business-os', 'entitlements', 'mode.ts'), 'utf8');

    expect(source).not.toMatch(/from '\.\/source'/);
    expect(source).not.toMatch(/from '\.\/schema'/);
    expect(source).not.toMatch(/require\(['"]\.\/(source|schema)['"]\)/);
    // Non-vacuity: it does import the two data modules it needs, so a file that
    // imported nothing at all would not pass this by accident.
    expect(source).toMatch(/from '\.\/config\/launch'/);
    expect(source).toMatch(/from '\.\/config\/tierMatrix'/);
  });
});

describe('UD-2 — enforce is allowed once a tier exists', () => {
  it('passes through when the launch gate is satisfied', () => {
    // The negative control for the block above: without it, an implementation
    // that ALWAYS returned shadow would pass every test here.
    jest.isolateModules(() => {
      jest.doMock('@/lib/business-os/entitlements/config/tierMatrix', () => ({
        TIER_ORDER: ['growth'],
        TIER_MATRIX: { version: 1, tiers: {}, removals: [] },
      }));

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getEntitlementMode: getMode } = require('@/lib/business-os/entitlements/mode');
      withMode('enforce');
      expect(getMode()).toBe('enforce');
    });
  });

  it('passes through when the gate itself is switched off', () => {
    jest.isolateModules(() => {
      jest.doMock('@/lib/business-os/entitlements/config/launch', () => ({
        LAUNCH: { enforceRequiresConfiguredTier: false },
      }));

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getEntitlementMode: getMode } = require('@/lib/business-os/entitlements/mode');
      withMode('enforce');
      expect(getMode()).toBe('enforce');
    });
  });
});
