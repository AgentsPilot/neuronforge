/**
 * `lib/supabaseAdmin` reads the one Supabase address variable (PROD-1a, A1).
 * Workplan section 10.4.
 *
 * A1's failure mode was two settable address variables naming different
 * projects, with this service-role client following the server-only one. The
 * first case pins that it now follows the public address even when the
 * retired variable names another project.
 *
 * Addresses are built from parts so the hardcoded-ref guard (G-5) does not
 * read them as real projects (C-2).
 */

// A module, not a script: without an import or export its top-level names
// share the global scope with every other script-style test file.
export {};

const mockCreateClient = jest.fn<{ marker: string }, unknown[]>(() => ({ marker: 'admin-client' }));
jest.mock('@supabase/supabase-js', () => ({ createClient: (...args: unknown[]) => mockCreateClient(...args) }));

const PUBLIC_URL = `https://${'p'.repeat(20)}.supabase.co`;
const OTHER_URL = `https://${'o'.repeat(20)}.supabase.co`;
// Built from parts so this file does not contain the retired name as one token.
const RETIRED_NAME = ['SUPABASE', 'URL'].join('_');

const saved = {
  publicUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  retired: process.env[RETIRED_NAME],
  key: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function load(): unknown {
  let mod: unknown;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- a fresh import per environment is the point
    mod = require('@/lib/supabaseAdmin');
  });
  return mod;
}

beforeEach(() => {
  mockCreateClient.mockClear();
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
});

afterEach(() => {
  restore('NEXT_PUBLIC_SUPABASE_URL', saved.publicUrl);
  restore(RETIRED_NAME, saved.retired);
  restore('SUPABASE_SERVICE_ROLE_KEY', saved.key);
});

describe('lib/supabaseAdmin', () => {
  it('builds the client from the public address, even when the retired variable names another project', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = PUBLIC_URL;
    process.env[RETIRED_NAME] = OTHER_URL;

    const mod = load() as { supabaseAdmin: unknown };

    expect(mockCreateClient).toHaveBeenCalledTimes(1);
    expect(mockCreateClient.mock.calls[0][0]).toBe(PUBLIC_URL);
    expect(mockCreateClient.mock.calls[0][1]).toBe('test-service-role');
    expect(mod.supabaseAdmin).toEqual({ marker: 'admin-client' });
  });

  it('imports and builds with the retired variable unset', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = PUBLIC_URL;
    delete process.env[RETIRED_NAME];

    expect(() => load()).not.toThrow();
    expect(mockCreateClient.mock.calls[0][0]).toBe(PUBLIC_URL);
  });

  it('throws at import when the public address is missing, even if the retired one is set (failure path)', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env[RETIRED_NAME] = OTHER_URL;

    expect(() => load()).toThrow('Missing Supabase environment variables. URL: false, ServiceKey: true');
    expect(mockCreateClient).not.toHaveBeenCalled();
  });
});
