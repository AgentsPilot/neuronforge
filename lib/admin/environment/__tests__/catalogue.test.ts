/**
 * The environment catalogue (admin environment view EC-1; workplan §1.8.2,
 * K-1 to K-7; SA rulings OQ-5, Q-1, Q-4, RC-4).
 *
 * K-5 is the OQ-5 check: the catalogue repeats each flag's parser and default
 * instead of importing the readers, so this test runs every real reader over
 * the same inputs and requires the classifier to agree with it.
 */

import * as fs from 'fs';
import * as path from 'path';

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make(), logger: make() };
});
jest.mock('@/lib/logger/client', () => ({
  clientLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('@/lib/services/AdminAccessService', () => ({ adminAccessService: { isAdmin: jest.fn() } }));
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));

import { classifyEnvironment, nameLooksSecret } from '../classifyEnvironment';
import { ENVIRONMENT_CATALOGUE, ENVIRONMENT_GROUPS, type EnvCatalogueEntry, type EnvFlagEntry } from '../catalogue';
import * as featureFlags from '@/lib/utils/featureFlags';
import { isPlanCheckoutEnabled } from '@/lib/business-os/billing/planCheckoutFlag';
import { isPlanPriceRecognitionEnabled } from '@/lib/business-os/billing/planPricesFlag';
import { isTestCreditToolsEnabled } from '@/lib/business-os/credits/testCreditToolsFlag';
import { isUpgradeModalDemoEnabled } from '@/lib/business-os/upgradeModalDemoFlag';
import { isCreditHistoryRouteEnabled } from '@/lib/business-os/credits/creditHistoryFlag';
import { isBusinessDeleteSurfaceEnabled } from '@/lib/business-os/purge/purgeAuthz';
import { isCalibrationAutoRcaEnabled } from '@/lib/calibration/calibrationRcaConfig';
import { parseBoostTestAccounts } from '@/lib/business-os/boost/boostCheckoutAccess';

const env = process.env as Record<string, string | undefined>;

const flags = ENVIRONMENT_CATALOGUE.filter((e): e is EnvFlagEntry => e.sensitivity === 'flag');

/** Every flag that has a named reader, mapped to its readers. */
const READERS: Record<string, Array<() => boolean>> = {
  NEXT_PUBLIC_USE_V6_AGENT_GENERATION: [featureFlags.isV6AgentGenerationEnabled],
  NEXT_PUBLIC_USE_V6_REVIEW_MODE: [featureFlags.isV6ReviewModeEnabled],
  NEXT_PUBLIC_MOVE_TO_CALIBRATION_AFTER_AGENT_CREATION: [featureFlags.isMoveToCalibrationAfterCreationEnabled],
  NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION: [featureFlags.isThreadBasedAgentCreationEnabled],
  NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI: [featureFlags.isNewAgentCreationUIEnabled],
  NEXT_PUBLIC_USE_AI_DATA_LAYER: [featureFlags.isAIDataLayerEnabled],
  NEXT_PUBLIC_ENABLE_BUSINESS_DELETE: [featureFlags.isBusinessDeleteSurfaceVisible, isBusinessDeleteSurfaceEnabled],
  NEXT_PUBLIC_BUSINESS_OS_CREDIT_HISTORY: [featureFlags.isBusinessOsCreditHistoryEnabled, isCreditHistoryRouteEnabled],
  ADMIN_BUSINESS_DELETE_ENABLED: [featureFlags.isAdminBusinessDeleteEnabled],
  AGENT_SCHEDULER_ENABLED: [featureFlags.isAgentSchedulerEnabled],
  BUSINESS_OS_CREDITS_BOOST_ENABLED: [featureFlags.isBusinessOsCreditsBoostEnabled],
  BUSINESS_OS_ACCOUNT_SELF_DELETE_ENABLED: [featureFlags.isAccountSelfDeleteEnabled],
  BUSINESS_OS_MODULE_EXPORT_ENABLED: [featureFlags.isModuleExportEnabled],
  NEXT_PUBLIC_ALLOW_EARLY_SESSION_OUTCOME: [featureFlags.isEarlySessionOutcomeEnabled],
  BUSINESS_OS_PLAN_CHECKOUT_ENABLED: [isPlanCheckoutEnabled],
  BUSINESS_OS_PLAN_PRICES_ENABLED: [isPlanPriceRecognitionEnabled],
  BUSINESS_OS_TEST_CREDIT_TOOLS_ENABLED: [isTestCreditToolsEnabled],
  BUSINESS_OS_UPGRADE_MODAL_DEMO_ENABLED: [isUpgradeModalDemoEnabled],
  CALIBRATION_AUTO_RCA_ENABLED: [isCalibrationAutoRcaEnabled],
};

/** Flags read only inline with `=== 'true'` (no named reader to call). */
const INLINE_STRICT = ['V6_SEMANTIC_SKELETON_ENABLED', 'V6_VALIDATION_DRIVEN_ENABLED', 'DEBUG_IR_FORMALIZER', 'SMTP_SECURE'];

const INPUTS: Array<string | undefined> = [undefined, 'true', 'TRUE', '1', '0', 'false', 'yes'];

function classifiedState(entry: EnvCatalogueEntry, value: string | undefined): 'on' | 'off' {
  const { payload } = classifyEnvironment(value === undefined ? {} : { [entry.name]: value }, { catalogue: [entry] });
  const display = payload.groups.flatMap((g) => g.rows)[0].display;
  if (display.kind !== 'flag') throw new Error('not a flag display');
  return display.state;
}

describe('environment catalogue', () => {
  it('K-1 names are unique, groups valid, roles are plain sentences', () => {
    const names = ENVIRONMENT_CATALOGUE.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
    const groupIds = new Set(ENVIRONMENT_GROUPS.map((g) => g.id));
    for (const entry of ENVIRONMENT_CATALOGUE) {
      expect(groupIds.has(entry.group)).toBe(true);
      expect(entry.role.trim().length).toBeGreaterThan(10);
      expect(entry.role.trim().endsWith('.')).toBe(true);
      // No variable-name codes or other underscore identifiers in prose.
      expect(entry.role).not.toMatch(/_/);
    }
    expect(ENVIRONMENT_GROUPS.map((g) => g.id)).toContain('external');
  });

  it('K-2 no config or personal entry has a name the SA-C1 pattern would mask', () => {
    const offenders = ENVIRONMENT_CATALOGUE.filter(
      (e) => (e.sensitivity === 'config' || e.sensitivity === 'personal') && nameLooksSecret(e.name)
    ).map((e) => e.name);
    expect(offenders).toEqual([]);
  });

  it('K-3 browser-inlined scope is exactly the NEXT_PUBLIC_ names', () => {
    for (const entry of ENVIRONMENT_CATALOGUE) {
      const expected = entry.name.startsWith('NEXT_PUBLIC_');
      expect({ name: entry.name, browser: entry.scope === 'browser-inlined' }).toEqual({ name: entry.name, browser: expected });
    }
  });

  it('K-4 every class carries its required fields; strict flags default off (RC-4)', () => {
    for (const entry of ENVIRONMENT_CATALOGUE) {
      if (entry.sensitivity === 'config') {
        expect(['url', 'host', 'integer', 'enum', 'gitSha', 'region', 'identifier']).toContain(entry.shape);
        if (entry.shape === 'enum') expect(entry.enumValues.length).toBeGreaterThan(0);
      }
      if (entry.sensitivity === 'flag') {
        expect(['lenient', 'strict-true']).toContain(entry.flagParser);
        expect(typeof entry.flagDefault).toBe('boolean');
        if (entry.flagParser === 'strict-true') expect({ name: entry.name, flagDefault: entry.flagDefault }).toEqual({ name: entry.name, flagDefault: false });
      }
      if (entry.sensitivity === 'personal') {
        expect(['single', 'list-admin-emails', 'list-boost-accounts']).toContain(entry.personalKind);
      }
      for (const where of ['production', 'preview', 'local'] as const) {
        expect(['required', 'optional', 'forbidden']).toContain(entry.expectedIn[where]);
      }
    }
  });

  it('every flag is covered by K-5, by a reader or as an inline strict read', () => {
    const covered = new Set([...Object.keys(READERS), ...INLINE_STRICT]);
    expect(flags.map((f) => f.name).filter((n) => !covered.has(n))).toEqual([]);
    expect([...covered].filter((n) => !flags.some((f) => f.name === n))).toEqual([]);
  });

  describe('K-5 parser and default agree with the code (OQ-5, Q-1)', () => {
    const saved: Record<string, string | undefined> = {};
    beforeAll(() => {
      for (const f of flags) saved[f.name] = env[f.name];
    });
    afterEach(() => {
      for (const f of flags) {
        if (saved[f.name] === undefined) delete env[f.name];
        else env[f.name] = saved[f.name];
      }
    });

    for (const [name, readers] of Object.entries(READERS)) {
      it(`${name} matches its reader(s) for every input`, () => {
        const entry = flags.find((f) => f.name === name);
        if (!entry) throw new Error('missing entry');
        for (const value of INPUTS) {
          if (value === undefined) delete env[name];
          else env[name] = value;
          for (const reader of readers) {
            expect({ value, state: classifiedState(entry, value) }).toEqual({ value, state: reader() ? 'on' : 'off' });
          }
        }
      });
    }

    it.each(INLINE_STRICT)('%s is strict-true, default off, like its inline read', (name) => {
      const entry = flags.find((f) => f.name === name);
      if (!entry) throw new Error('missing entry');
      expect(entry.flagParser).toBe('strict-true');
      for (const value of INPUTS) {
        expect({ value, state: classifiedState(entry, value) }).toEqual({ value, state: value === 'true' ? 'on' : 'off' });
      }
    });
  });

  it('K-6 consumedBy sits on exactly the sdk and page-consumed entries, each with a note', () => {
    const marked = ENVIRONMENT_CATALOGUE.filter((e) => e.consumedBy).map((e) => [e.name, e.consumedBy?.by]);
    expect(marked).toEqual([
      ['VERCEL_REGION', 'environment-page'],
      ['VERCEL_GIT_COMMIT_REF', 'environment-page'],
      ['VERCEL_GIT_COMMIT_SHA', 'environment-page'],
      ['NODE_TLS_REJECT_UNAUTHORIZED', 'platform'],
      ['QSTASH_CURRENT_SIGNING_KEY', 'sdk'],
      ['QSTASH_NEXT_SIGNING_KEY', 'sdk'],
    ]);
    for (const entry of ENVIRONMENT_CATALOGUE) {
      if (entry.consumedBy) expect(entry.consumedBy.note.trim().length).toBeGreaterThan(10);
    }
  });

  it('E4-2 the TLS check switch is a server secret, forbidden on Vercel, read by the platform', () => {
    const entry = ENVIRONMENT_CATALOGUE.find((e) => e.name === 'NODE_TLS_REJECT_UNAUTHORIZED');
    expect(entry).toMatchObject({
      sensitivity: 'secret',
      scope: 'server',
      expectedIn: { production: 'forbidden', preview: 'forbidden', local: 'optional' },
      consumedBy: { by: 'platform' },
    });
  });

  it('K-8 the boost test-accounts count agrees with the checkout reader (QA-3, SA Q4-9)', () => {
    const entry = ENVIRONMENT_CATALOGUE.find((e) => e.name === 'BUSINESS_OS_CREDITS_BOOST_TEST_ACCOUNTS');
    expect(entry).toMatchObject({ sensitivity: 'personal', personalKind: 'list-boost-accounts' });
    if (!entry) throw new Error('missing entry');
    const idA = '0f0e0d0c-0b0a-4908-8706-050403020100';
    const idB = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    for (const raw of [
      `${idA},${idB}`,
      `${idA}, someone@example.test ,${idB}`,
      `${idA},${idA.toUpperCase()}`,
      'someone@example.test,other@example.test',
      ` ${idA} ,, `,
      ',',
    ]) {
      const { payload } = classifyEnvironment({ [entry.name]: raw }, { catalogue: [entry] });
      const display = payload.groups.flatMap((g) => g.rows)[0].display;
      const reader = parseBoostTestAccounts(raw);
      expect({ raw, display }).toEqual({ raw, display: reader === null ? { kind: 'status', set: false } : { kind: 'count', entries: reader.size } });
    }
  });

  it('K-7 the catalogue imports types only', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'catalogue.ts'), 'utf8');
    const imports = source.split(/\r?\n/).filter((line) => /^\s*import\b/.test(line));
    expect(imports.length).toBeGreaterThan(0);
    for (const line of imports) expect(line).toMatch(/^\s*import type\b/);
  });
});
