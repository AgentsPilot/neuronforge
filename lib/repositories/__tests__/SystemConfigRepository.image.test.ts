/**
 * SystemConfigRepository.getImageGenerationConfig (Layer 1.5 FR-10, AC-8).
 *
 * One round trip; a documented default for each key that is missing or
 * malformed; configuration values never written to the logs.
 */

const logged: Array<{ level: string; args: unknown[] }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) {
      logger[level] = (...args: unknown[]) => logged.push({ level, args });
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  IMAGE_FALLBACK_PRICING,
  IMAGE_GENERATION_CONFIG_DEFAULTS,
  IMAGE_GENERATION_CONFIG_KEYS,
  SystemConfigRepository,
} from '../SystemConfigRepository';

type Row = { key: string; value: unknown };

function fakeClient(result: { data: Row[] | null; error: Error | null }) {
  const reads: Array<{ table: string; column: string; keys: string[] }> = [];
  const client = {
    from: (table: string) => ({
      select: () => ({
        in: (column: string, keys: string[]) => {
          reads.push({ table, column, keys });
          return Promise.resolve(result);
        },
      }),
    }),
  };
  return { client: client as unknown as SupabaseClient, reads };
}

beforeEach(() => {
  logged.length = 0;
});

describe('getImageGenerationConfig', () => {
  it('reads all four keys in exactly one select', async () => {
    const { client, reads } = fakeClient({ data: [], error: null });
    await new SystemConfigRepository(client).getImageGenerationConfig();

    expect(reads).toHaveLength(1);
    expect(reads[0].table).toBe('system_settings_config');
    expect(reads[0].column).toBe('key');
    expect(reads[0].keys.sort()).toEqual(Object.values(IMAGE_GENERATION_CONFIG_KEYS).sort());
  });

  it('returns the documented defaults when nothing is configured', async () => {
    const { client } = fakeClient({ data: [], error: null });
    const config = await new SystemConfigRepository(client).getImageGenerationConfig();

    expect(config).toEqual({
      model: IMAGE_GENERATION_CONFIG_DEFAULTS.model,
      sizes: { ...IMAGE_GENERATION_CONFIG_DEFAULTS.sizes },
      quality: 'auto',
      pricesUsd: {},
    });
    // The defaults preserve what the service sent before this was configurable.
    expect(IMAGE_GENERATION_CONFIG_DEFAULTS.sizes).toEqual({ wide: '1536x1024', portrait: '1024x1536', square: '1024x1024' });
  });

  it('returns the defaults, with a warning, when the read fails', async () => {
    const { client } = fakeClient({ data: null, error: new Error('db down') });
    const config = await new SystemConfigRepository(client).getImageGenerationConfig();
    expect(config.model).toBe(IMAGE_GENERATION_CONFIG_DEFAULTS.model);
    expect(logged.some((l) => l.level === 'warn')).toBe(true);
  });

  it('applies configured values, as JSONB objects or JSON strings', async () => {
    const { client } = fakeClient({
      data: [
        { key: 'image_generation_model', value: 'gpt-image-2' },
        { key: 'image_generation_quality', value: '"medium"' },
        { key: 'image_generation_sizes', value: JSON.stringify({ wide: '1024x1024' }) },
        { key: 'image_generation_prices_usd', value: { 'gpt-image-2:1024x1024:medium': 0.05, bad: -1, text: 'x' } },
      ],
      error: null,
    });
    const config = await new SystemConfigRepository(client).getImageGenerationConfig();

    expect(config.model).toBe('gpt-image-2');
    expect(config.quality).toBe('medium');
    expect(config.sizes).toEqual({ wide: '1024x1024', portrait: '1024x1536', square: '1024x1024' });
    expect(config.pricesUsd).toEqual({ 'gpt-image-2:1024x1024:medium': 0.05 });
  });

  it('falls back for a malformed key only, and keeps the others', async () => {
    const { client } = fakeClient({
      data: [
        { key: 'image_generation_model', value: 'gpt-image-2' },
        { key: 'image_generation_sizes', value: '{not json' },
        { key: 'image_generation_prices_usd', value: '[1,2]' },
      ],
      error: null,
    });
    const config = await new SystemConfigRepository(client).getImageGenerationConfig();

    expect(config.model).toBe('gpt-image-2');
    expect(config.sizes).toEqual({ ...IMAGE_GENERATION_CONFIG_DEFAULTS.sizes });
    expect(config.pricesUsd).toEqual({});
    const warn = logged.find((l) => l.level === 'warn' && String(l.args[1]).includes('Malformed'));
    expect(warn?.args[0]).toEqual({ keys: ['image_generation_sizes', 'image_generation_prices_usd'] });
  });

  it('never logs a configuration value', async () => {
    const { client } = fakeClient({
      data: [
        { key: 'image_generation_model', value: 'secret-model-name' },
        { key: 'image_generation_prices_usd', value: { 'secret-model-name:1024x1024:high': 0.99 } },
        { key: 'image_generation_sizes', value: 'broken{' },
      ],
      error: null,
    });
    await new SystemConfigRepository(client).getImageGenerationConfig();
    expect(JSON.stringify(logged)).not.toContain('secret-model-name');
    expect(JSON.stringify(logged)).not.toContain('0.99');
  });
});

describe('IMAGE_FALLBACK_PRICING', () => {
  it('prices every default size at every quality the provider can report, for the default model', () => {
    const { model, sizes } = IMAGE_GENERATION_CONFIG_DEFAULTS;
    for (const size of Object.values(sizes)) {
      for (const quality of ['low', 'medium', 'high']) {
        expect(IMAGE_FALLBACK_PRICING[`${model}:${size}:${quality}`]).toBeGreaterThan(0);
      }
    }
  });

  it('defaults the request to auto, which is never a price key (priced by the reported quality)', () => {
    expect(IMAGE_GENERATION_CONFIG_DEFAULTS.quality).toBe('auto');
    expect(Object.keys(IMAGE_FALLBACK_PRICING).some((k) => k.endsWith(':auto'))).toBe(false);
  });
});
