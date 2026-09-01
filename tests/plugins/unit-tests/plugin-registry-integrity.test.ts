/**
 * The plugin catalog shown in the UI must match what the backend can actually
 * load. When it doesn't, the user clicks "Connect" on a real-looking card and
 * gets a 404 from POST /api/v2/plugins/connect with no explanation.
 *
 * Six entries were in that broken state — google-ads, quickbooks, xero, paypal,
 * clickup-project, clickup-docs — advertised with descriptions and icons but
 * backed by no definition file, no executor, and no registry entry.
 *
 * These are source/filesystem checks rather than runtime ones so they cost
 * nothing and can't be skipped by a mock.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '../../..');
const DEFINITIONS_DIR = path.join(ROOT, 'lib/plugins/definitions');

/** Plugin keys that ship a V2 definition file. */
function definedPluginKeys(): string[] {
  return fs
    .readdirSync(DEFINITIONS_DIR)
    .filter(f => f.endsWith('-plugin-v2.json'))
    .map(f => f.replace('-plugin-v2.json', ''))
    .sort();
}

/** Plugin keys advertised in the UI catalog. */
function catalogPluginKeys(): string[] {
  const source = fs.readFileSync(path.join(ROOT, 'lib/plugins/pluginList.tsx'), 'utf8');
  return [...source.matchAll(/pluginKey:\s*'([a-z0-9-]+)'/g)].map(m => m[1]).sort();
}

/** Plugin keys wired into the executor registry. */
function registeredExecutorKeys(): string[] {
  const source = fs.readFileSync(path.join(ROOT, 'lib/server/plugin-executer-v2.ts'), 'utf8');
  const registry = source.match(/executorRegistry[^=]*=\s*\{([\s\S]*?)\n\s*\}/);
  if (!registry) throw new Error('Could not locate executorRegistry in plugin-executer-v2.ts');
  return [...registry[1].matchAll(/'([a-z0-9-]+)'\s*:/g)].map(m => m[1]).sort();
}

/** Definition filenames listed in the plugin manager's corePluginFiles. */
function managerPluginKeys(): string[] {
  const source = fs.readFileSync(path.join(ROOT, 'lib/server/plugin-manager-v2.ts'), 'utf8');
  return [...source.matchAll(/'([a-z0-9-]+)-plugin-v2\.json'/g)].map(m => m[1]).sort();
}

describe('[smoke] plugin registry integrity', () => {
  it('finds the three registries', () => {
    expect(definedPluginKeys().length).toBeGreaterThan(10);
    expect(catalogPluginKeys().length).toBeGreaterThan(10);
    expect(registeredExecutorKeys().length).toBeGreaterThan(10);
  });

  it('advertises no plugin the backend cannot load', () => {
    const defined = definedPluginKeys();
    const advertisedButUndefined = catalogPluginKeys().filter(k => !defined.includes(k));

    // Each of these renders a connect button that 404s.
    expect(advertisedButUndefined).toEqual([]);
  });

  it('registers an executor for every plugin definition', () => {
    const registered = registeredExecutorKeys();
    const missingExecutor = definedPluginKeys().filter(k => !registered.includes(k));

    expect(missingExecutor).toEqual([]);
  });

  it('loads every plugin definition in the plugin manager', () => {
    const loaded = managerPluginKeys();
    const notLoaded = definedPluginKeys().filter(k => !loaded.includes(k));

    expect(notLoaded).toEqual([]);
  });

  it('exports only real plugin keys from PLUGIN_KEYS', () => {
    // The whole point of the constant is that its values are correct. A typo
    // here would reintroduce the silent-no-match bug it exists to prevent.
    const { PLUGIN_KEYS } = require('@/lib/plugins/pluginKeys');
    const defined = definedPluginKeys();
    const bogus = Object.entries(PLUGIN_KEYS)
      .filter(([, key]) => !defined.includes(key as string))
      .map(([name, key]) => `${name} -> '${key}'`);

    expect(bogus).toEqual([]);
  });
});
