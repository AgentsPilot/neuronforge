/**
 * ConfigRepository.getSystemConfigs (Layer 1.5 F-6, FR-25, AC-19): several
 * `ais_system_config` keys in one round trip, and never a throw.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});
jest.mock('@/lib/supabaseClient', () => ({ supabase: {} }));

import * as fs from 'fs';
import * as path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ConfigRepository } from '../ConfigRepository';
import { createFakeSupabase } from '@/tests/helpers/fakePostgrest';

const ROWS = [
  { config_key: 'monthly_ai_allowance_usd', config_value: '10' },
  { config_key: 'pilot_credit_cost_usd', config_value: '0.00048' },
  { config_key: 'tokens_per_pilot_credit', config_value: '25' },
];

describe('ConfigRepository.getSystemConfigs', () => {
  it('reads the requested keys in one query and returns them as a map', async () => {
    const fake = createFakeSupabase({ tables: { ais_system_config: ROWS } });
    const repo = new ConfigRepository(fake.client as unknown as SupabaseClient);

    const result = await repo.getSystemConfigs(['monthly_ai_allowance_usd', 'pilot_credit_cost_usd']);

    expect(result).toEqual({
      data: { monthly_ai_allowance_usd: '10', pilot_credit_cost_usd: '0.00048' },
      error: null,
    });
    expect(fake.queries).toHaveLength(1);
    expect(fake.queries[0].table).toBe('ais_system_config');
  });

  it('leaves a key with no row out of the map', async () => {
    const fake = createFakeSupabase({ tables: { ais_system_config: [ROWS[0]] } });
    const repo = new ConfigRepository(fake.client as unknown as SupabaseClient);
    const result = await repo.getSystemConfigs(['monthly_ai_allowance_usd', 'pilot_credit_cost_usd']);
    expect(result.data).toEqual({ monthly_ai_allowance_usd: '10' });
  });

  it('returns an error instead of throwing when the read fails', async () => {
    const fake = createFakeSupabase({ tables: { ais_system_config: ROWS }, errorWhen: () => ({ message: 'boom' }) });
    const repo = new ConfigRepository(fake.client as unknown as SupabaseClient);
    const result = await repo.getSystemConfigs(['monthly_ai_allowance_usd']);
    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  });
});

describe('the owner usage route (AC-19)', () => {
  it('no longer reads ais_system_config directly', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'app', 'api', 'business-os', 'usage', 'route.ts'),
      'utf8'
    );
    expect(source).not.toMatch(/\.from\(\s*['"]ais_system_config['"]\s*\)/);
    expect(source).toMatch(/new ConfigRepository\(supabaseServer\)\.getSystemConfigs\(/);
  });
});
