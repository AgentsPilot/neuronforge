/**
 * PluginCoordinator reads connections and saves a refreshed token through
 * pluginConnectionRepository, never through the run context's Supabase client
 * (data export DE-0b, BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md §0.1.2 S1). The
 * context client is the caller's cookie session (`authenticated`), which no
 * longer holds the token columns once the DE-0b migration is applied.
 */

import fs from 'fs';
import path from 'path';

const mockFindAllByUser = jest.fn();
const mockFindByUserAndPlugin = jest.fn();
const mockUpdateRefreshedToken = jest.fn();
jest.mock('@/lib/repositories/PluginConnectionRepository', () => ({
  pluginConnectionRepository: {
    findAllByUser: (...args: unknown[]) => mockFindAllByUser(...args),
    findByUserAndPlugin: (...args: unknown[]) => mockFindByUserAndPlugin(...args),
    updateRefreshedToken: (...args: unknown[]) => mockUpdateRefreshedToken(...args),
  },
}));

const mockLogged: Array<{ level: string; args: unknown[] }> = [];
jest.mock('@/lib/logger', () => ({
  createLogger: () => {
    const at = (level: string) => (...args: unknown[]) => {
      mockLogged.push({ level, args });
    };
    return { info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug') };
  },
}));

const mockRun = jest.fn();
const mockRefresh = jest.fn();
jest.mock('@/lib/plugins/pluginRegistry', () => ({
  pluginRegistry: {
    'test-plugin': {
      run: (...args: unknown[]) => mockRun(...args),
      refreshToken: (...args: unknown[]) => mockRefresh(...args),
    },
  },
}));

import { PluginCoordinator } from '@/lib/intelligence/execution/PluginCoordinator';

const intent = {
  primaryIntent: 'other',
  subIntents: [],
  urgency: 'low',
  complexity: 'simple',
  businessContext: 'general',
  requiredCapabilities: [],
  dataRequirements: [],
  expectedOutputFormat: 'text',
  qualityThreshold: 0.5,
  confidenceLevel: 0.5,
};
const strategy = { riskMitigation: [] };

/** A context client that fails the test if anything touches it. */
const contextSupabase = {
  from: jest.fn(() => {
    throw new Error('PluginCoordinator must not use the context Supabase client');
  }),
};

function context() {
  return { userId: 'user-1', supabase: contextSupabase, input_variables: {} };
}

const run = (coordinator: PluginCoordinator) =>
  // The legacy types do not line up with the runtime shapes; the test only
  // needs the fields the coordinator reads.
  coordinator.executeSmartCoordination(['test-plugin'], context() as never, intent as never, strategy as never, 'exec-1');

beforeEach(() => {
  // The coordinator races each run against a 10 s timer it never clears;
  // fake timers keep that timer from outliving the test.
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockLogged.length = 0;
  mockRun.mockResolvedValue({ summary: 'ok', data: { a: 1 } });
  mockUpdateRefreshedToken.mockResolvedValue({ data: true, error: null });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('PluginCoordinator connection access (DE-0b S1)', () => {
  it('loads credentials via findAllByUser for the run user, not the context client', async () => {
    mockFindAllByUser.mockResolvedValue({
      data: [{ plugin_key: 'test-plugin', access_token: 'tok', refresh_token: 'r', username: 'u', expires_at: null }],
      error: null,
    });

    const result = await run(new PluginCoordinator());

    expect(mockFindAllByUser).toHaveBeenCalledWith('user-1');
    expect(contextSupabase.from).not.toHaveBeenCalled();
    expect(mockRun).toHaveBeenCalledWith(
      expect.objectContaining({ connection: expect.objectContaining({ access_token: 'tok' }), userId: 'user-1' })
    );
    expect(result['test-plugin'].summary).toBe('ok');
    expect(mockUpdateRefreshedToken).not.toHaveBeenCalled();
  });

  it('an expired token is refreshed and saved through updateRefreshedToken, scoped to the run user', async () => {
    mockFindAllByUser.mockResolvedValue({
      data: [{ plugin_key: 'test-plugin', access_token: 'old', refresh_token: 'r', username: 'u', expires_at: '2000-01-01T00:00:00Z' }],
      error: null,
    });
    mockRefresh.mockResolvedValue({ access_token: 'new-token', expires_at: '2099-01-01T00:00:00Z' });

    await run(new PluginCoordinator());

    expect(mockUpdateRefreshedToken).toHaveBeenCalledWith('user-1', 'test-plugin', {
      accessToken: 'new-token',
      expiresAt: '2099-01-01T00:00:00Z',
    });
    expect(mockRun).toHaveBeenCalledWith(
      expect.objectContaining({ connection: expect.objectContaining({ access_token: 'new-token' }) })
    );
    expect(contextSupabase.from).not.toHaveBeenCalled();
    expect(JSON.stringify(mockLogged)).not.toContain('new-token');
  });

  it('a failed save is logged and the run continues with the refreshed token', async () => {
    mockFindAllByUser.mockResolvedValue({
      data: [{ plugin_key: 'test-plugin', access_token: 'old', refresh_token: 'r', username: 'u', expires_at: '2000-01-01T00:00:00Z' }],
      error: null,
    });
    mockRefresh.mockResolvedValue({ access_token: 'new-token', expires_at: null });
    mockUpdateRefreshedToken.mockResolvedValue({ data: null, error: new Error('db down') });

    const result = await run(new PluginCoordinator());

    expect(mockUpdateRefreshedToken).toHaveBeenCalledWith('user-1', 'test-plugin', { accessToken: 'new-token', expiresAt: null });
    expect(result['test-plugin'].summary).toBe('ok');
    expect(mockLogged.some((l) => l.level === 'warn')).toBe(true);
  });

  it('a credential read error yields "No credentials", not a crash', async () => {
    mockFindAllByUser.mockResolvedValue({ data: null, error: new Error('boom') });
    const result = await run(new PluginCoordinator());
    expect(result['test-plugin'].error).toBe('No credentials');
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('source: no .from(), no console.*, no context.supabase', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'lib/intelligence/execution/PluginCoordinator.ts'),
      'utf8'
    );
    expect(source).not.toMatch(/\.from\(/);
    expect(source).not.toMatch(/console\./);
    expect(source).not.toMatch(/context\.supabase/);
  });
});
