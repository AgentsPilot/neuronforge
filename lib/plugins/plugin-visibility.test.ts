// lib/plugins/plugin-visibility.test.ts
import { isPluginDiscoverable } from './plugin-visibility';

const def = (visibility?: 'public' | 'business_os') =>
  ({ plugin: { visibility } } as any);

describe('isPluginDiscoverable', () => {
  it('public / absent visibility is always discoverable', () => {
    expect(isPluginDiscoverable(def('public'))).toBe(true);
    expect(isPluginDiscoverable(def(undefined))).toBe(true);
    expect(isPluginDiscoverable(def('public'), false)).toBe(true);
  });

  it('business_os is hidden by default and shown only when opted in', () => {
    expect(isPluginDiscoverable(def('business_os'))).toBe(false);
    expect(isPluginDiscoverable(def('business_os'), false)).toBe(false);
    expect(isPluginDiscoverable(def('business_os'), true)).toBe(true);
  });

  it('undefined definition is not discoverable', () => {
    expect(isPluginDiscoverable(undefined)).toBe(false);
  });
});
