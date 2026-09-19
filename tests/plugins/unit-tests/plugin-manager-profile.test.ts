/**
 * PluginManagerV2 under a plugin profile (lib/server/plugin-profile.ts).
 *
 * Covers requirement BUSINESS_OS_PLUGIN_PROFILE AC2, AC3, AC5, AC6, AC7, AC11 and
 * AC12: the manager loads exactly the profile's plugins, never touches the files of
 * skipped ones, keeps the Business OS visibility split, degrades cleanly for
 * connections to skipped plugins and logs one summary line.
 *
 * Managers are built directly with an explicit profile (requirement SA Q5-a), so no
 * env var and no singleton are involved.
 */

import * as fs from 'fs';
import * as path from 'path';

const mockLog = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  trace: jest.fn(),
};
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {
      info: (...a: unknown[]) => mockLog.info(...a),
      warn: (...a: unknown[]) => mockLog.warn(...a),
      error: (...a: unknown[]) => mockLog.error(...a),
      debug: (...a: unknown[]) => mockLog.debug(...a),
      trace: (...a: unknown[]) => mockLog.trace(...a),
    };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make(), logger: make() };
});

import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import {
  getPluginProfile,
  resolveActivePluginProfile,
  type PluginProfile,
} from '@/lib/server/plugin-profile';
import { isPluginDiscoverable } from '@/lib/plugins/plugin-visibility';
import { createMockUserConnections } from '../common/mock-user-connections';
import { createMockConnection } from '../common/mock-connection';

const DEFINITIONS_DIR = path.join(__dirname, '../../../lib/plugins/definitions');
const BUSINESS_OS = getPluginProfile('business_os');
const ALL = getPluginProfile('all');
const EXCLUDED = ALL.pluginKeys.filter(k => !BUSINESS_OS.pluginKeys.includes(k));

async function buildManager(
  profile: PluginProfile,
  userConnections = createMockUserConnections()
): Promise<PluginManagerV2> {
  const pm = new PluginManagerV2(userConnections);
  await pm.initializeWithCorePlugins(profile);
  return pm;
}

/** `${VAR}` placeholders used by a plugin's definition file. */
function envVarsOf(pluginKey: string): Set<string> {
  const source = fs.readFileSync(path.join(DEFINITIONS_DIR, `${pluginKey}-plugin-v2.json`), 'utf8');
  return new Set([...source.matchAll(/\$\{([^}]+)\}/g)].map(m => m[1]));
}

function warnedVarNames(): string[] {
  return mockLog.warn.mock.calls
    .map(([fields]) => (fields as { varName?: string } | undefined)?.varName)
    .filter((v): v is string => typeof v === 'string');
}

beforeEach(() => {
  Object.values(mockLog).forEach(fn => fn.mockClear());
});

describe('[smoke] plugin profile: loader', () => {
  it('commits business_os as the active profile', () => {
    // The one-line switch. Flipping it to 'all' must be deliberate (requirement FR3).
    expect(resolveActivePluginProfile().name).toBe('business_os');
    expect(resolveActivePluginProfile()).toBe(BUSINESS_OS);
  });

  it('loads exactly the business_os set', async () => {
    const pm = await buildManager(BUSINESS_OS);

    expect(pm.getAllPluginNames().sort()).toEqual([...BUSINESS_OS.pluginKeys].sort());
    expect(pm.getAllPluginNames()).toHaveLength(11);
    expect(pm.getActiveProfile()).toBe(BUSINESS_OS);
  });

  it('loads exactly the all set, in profile order', async () => {
    const pm = await buildManager(ALL);

    expect(pm.getAllPluginNames()).toEqual([...ALL.pluginKeys]);
    expect(pm.getAllPluginNames()).toHaveLength(28);
    expect(pm.getActiveProfile()).toBe(ALL);
  });

  it('keeps the Business OS visibility split (INTERIM DUPLICATION)', async () => {
    const pm = await buildManager(BUSINESS_OS);

    const businessOs = pm.getPluginDefinition('business-os');
    expect(businessOs).toBeDefined();
    expect(businessOs!.plugin.visibility).toBeUndefined();
    expect(isPluginDiscoverable(businessOs)).toBe(true);

    for (const key of ['crm', 'scheduling', 'payments', 'website']) {
      const def = pm.getPluginDefinition(key);
      expect(def).toBeDefined();
      expect(isPluginDiscoverable(def)).toBe(false);
    }
  });

  it('returns not-found for a skipped plugin instead of crashing', async () => {
    const pm = await buildManager(BUSINESS_OS);

    expect(pm.getPluginDefinition('google-mail')).toBeUndefined();
  });
});

describe('[full] plugin profile: skipped plugins are never touched', () => {
  it('never reads a skipped definition file', async () => {
    // Spy on the real 'fs' module object: the test's `import * as fs` namespace has
    // non-configurable bindings, while the manager's compiled import reads through
    // to this object, so the spy sees its calls.
    const readSpy = jest.spyOn(jest.requireActual<typeof fs>('fs'), 'readFileSync');
    try {
      await buildManager(BUSINESS_OS);

      const readDefinitions = readSpy.mock.calls
        .map(([file]) => String(file).split(path.sep).join('/'))
        .filter(file => file.endsWith('-plugin-v2.json'))
        .map(file => file.split('/').pop()!.replace('-plugin-v2.json', ''));

      // Guard against a spy that silently intercepts nothing.
      expect(readDefinitions.sort()).toEqual([...BUSINESS_OS.pluginKeys].sort());
      expect(readDefinitions.filter(k => EXCLUDED.includes(k))).toEqual([]);
    } finally {
      readSpy.mockRestore();
    }
  });

  it('emits no env-var warning for variables only skipped plugins use', async () => {
    const includedVars = new Set(BUSINESS_OS.pluginKeys.flatMap(k => [...envVarsOf(k)]));
    const excludedOnlyVars = [
      ...new Set(EXCLUDED.flatMap(k => [...envVarsOf(k)])),
    ].filter(v => !includedVars.has(v));
    expect(excludedOnlyVars.length).toBeGreaterThan(0);

    const saved: Record<string, string | undefined> = {};
    for (const v of excludedOnlyVars) {
      saved[v] = process.env[v];
      delete process.env[v];
    }
    try {
      await buildManager(BUSINESS_OS);
      expect(warnedVarNames().filter(v => excludedOnlyVars.includes(v))).toEqual([]);

      // Positive control: the same variables DO warn when their plugins load.
      mockLog.warn.mockClear();
      await buildManager(ALL);
      expect(warnedVarNames().filter(v => excludedOnlyVars.includes(v)).length).toBeGreaterThan(0);
    } finally {
      for (const v of excludedOnlyVars) {
        if (saved[v] === undefined) delete process.env[v];
        else process.env[v] = saved[v];
      }
    }
  });
});

describe('[full] plugin profile: startup logging', () => {
  it('emits exactly one summary info line for business_os', async () => {
    const pm = await buildManager(BUSINESS_OS);

    expect(mockLog.info).toHaveBeenCalledTimes(1);
    const [fields, message] = mockLog.info.mock.calls[0];
    expect(message).toBe('Plugin manager initialized');
    expect(fields).toEqual({
      profile: 'business_os',
      loadedPluginKeys: pm.getAllPluginNames(),
      loadedCount: 11,
      skippedPluginKeys: EXCLUDED,
      skippedCount: 17,
    });
  });

  it('reports nothing skipped under all', async () => {
    await buildManager(ALL);

    expect(mockLog.info).toHaveBeenCalledTimes(1);
    expect(mockLog.info.mock.calls[0][0]).toMatchObject({
      profile: 'all',
      loadedCount: 28,
      skippedPluginKeys: [],
      skippedCount: 0,
    });
  });

  it('logs no per-plugin line for skipped plugins', async () => {
    await buildManager(BUSINESS_OS);

    // Every call except the summary line itself (which lists skipped keys on purpose).
    const otherCalls = Object.values(mockLog)
      .flatMap(fn => fn.mock.calls)
      .filter(([, message]) => message !== 'Plugin manager initialized');
    const serialized = JSON.stringify(otherCalls);
    expect(EXCLUDED.filter(k => serialized.includes(`"${k}`))).toEqual([]);
  });
});

describe('[full] plugin profile: connections to skipped plugins', () => {
  it('drops a live connection to a skipped plugin without error', async () => {
    const userConnections = createMockUserConnections();
    const rows = [createMockConnection('google-mail'), createMockConnection('google-calendar')];
    userConnections.getConnectedPlugins.mockResolvedValue(rows);
    userConnections.getAllActivePlugins.mockResolvedValue(rows);
    const pm = await buildManager(BUSINESS_OS, userConnections);

    const connected = await pm.getConnectedPlugins('user-1', { includeSystemPlugins: false });
    expect(Object.keys(connected)).toEqual(['google-calendar']);

    const executable = await pm.getExecutablePlugins('user-1');
    expect(Object.keys(executable)).toContain('google-calendar');
    expect(Object.keys(executable)).not.toContain('google-mail');
  });
});
