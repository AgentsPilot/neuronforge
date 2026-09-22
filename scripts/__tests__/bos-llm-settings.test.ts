/**
 * T1-13 / T1-13b (Layer 2 Step 1) — the change script.
 *
 * Until the admin screen exists, this script is the only way an operator
 * changes an area row, so its job is to refuse: a row the resolver would not
 * honour must never reach the database, and a row that LOOKS like it switches
 * an area off but would not must not be written either (RC-W8c).
 *
 * The two verify modes are the gates around applying the seed (§9 P-3, P-5b),
 * so they are tested the same way: what they accept, what they stop on, and
 * that neither of them ever writes.
 *
 * AC-16, AC-2, AC-13.
 */

const logged: Array<{ level: string; fields: Record<string, unknown>; msg: string }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
      logger[level] = (first: unknown, second?: unknown) => {
        logged.push({
          level,
          fields: typeof first === 'object' && first !== null ? (first as Record<string, unknown>) : {},
          msg: typeof first === 'string' ? first : String(second ?? ''),
        });
      };
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

const mockGetPricing = jest.fn();
jest.mock('@/lib/ai/pricing', () => ({
  getPricing: (...args: unknown[]) => mockGetPricing(...args),
  calculateCostSync: () => 0,
  calculateCost: async () => 0,
  hasPricing: async () => true,
}));

const store = new Map<string, unknown>();
const mockSet = jest.fn();
const mockGetImageGenerationConfig = jest.fn();
jest.mock('@/lib/repositories/SystemConfigRepository', () => {
  const actual = jest.requireActual('@/lib/repositories/SystemConfigRepository');
  return {
    ...actual,
    systemConfigRepository: {
      getByKey: async (key: string) =>
        store.has(key)
          ? { data: { key, value: store.get(key), updated_at: '2026-10-03T00:00:00.000Z' }, error: null }
          : { data: null, error: null },
      getByKeys: async (keys: string[]) => ({
        data: keys.filter((key) => store.has(key)).map((key) => ({ key, value: store.get(key) })),
        error: null,
      }),
      getString: async (key: string, fallback: string) =>
        store.has(key) ? String(store.get(key)) : fallback,
      getBoolean: async (key: string, fallback: boolean) => {
        if (!store.has(key)) return fallback;
        const value = store.get(key);
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') return value.toLowerCase() === 'true';
        return fallback;
      },
      getImageGenerationConfig: (...args: unknown[]) => mockGetImageGenerationConfig(...args),
      set: (...args: unknown[]) => mockSet(...args),
    },
  };
});

// The chat keys are read through the deprecated service today; the equivalence
// check must call the REAL getters, so the double mirrors their semantics.
jest.mock('@/lib/services/SystemConfigService', () => ({
  SystemConfigService: {
    getString: async (_client: unknown, key: string, fallback: string) =>
      store.has(key) ? String(store.get(key)) : fallback,
    getBoolean: async (_client: unknown, key: string, fallback: boolean) => {
      if (!store.has(key)) return fallback;
      const value = store.get(key);
      if (typeof value === 'string') return value.toLowerCase() === 'true';
      return Boolean(value);
    },
  },
}));

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { isCanonicalLegacyValue, runBosLlmSettingsCommand } from '../bos-llm-settings';
import { __resetBosLlmSettingsForTests } from '@/lib/business-os/llm/modelSettings';
import { IMAGE_GENERATION_CONFIG_DEFAULTS } from '@/lib/repositories/SystemConfigRepository';
import { SEEDED_ROWS } from '@/lib/business-os/llm/__fixtures__/seededRows';

/** Write a row file and return its path. */
function rowFile(row: unknown): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bos-llm-')), 'row.json');
  fs.writeFileSync(file, JSON.stringify(row), 'utf8');
  return file;
}

function errorFields(): Array<Record<string, unknown>> {
  return logged.filter((line) => line.level === 'error').map((line) => line.fields);
}

beforeEach(() => {
  logged.length = 0;
  store.clear();
  mockSet.mockReset().mockResolvedValue({ data: {}, error: null });
  mockGetPricing.mockReset().mockResolvedValue({ input: 0.0025, output: 0.01 });
  mockGetImageGenerationConfig.mockReset().mockResolvedValue({
    ...IMAGE_GENERATION_CONFIG_DEFAULTS,
    pricesUsd: {},
  });
  __resetBosLlmSettingsForTests();
});

describe('set: a row the resolver would refuse is never written (T1-13, AC-16)', () => {
  it('refuses a model with no price', async () => {
    mockGetPricing.mockResolvedValue(null);
    const code = await runBosLlmSettingsCommand(['set', 'leads', '--file', rowFile({ model: 'gpt-4o-imaginary' })]);
    expect(code).toBe(1);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('refuses a temperature outside 0 … 1', async () => {
    const code = await runBosLlmSettingsCommand(['set', 'insights', '--file', rowFile({ temperature: 1.5 })]);
    expect(code).toBe(1);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it.each([
    ['onboarding cannot be switched off', 'onboarding', { enabled: false }],
    ['the planner has no switch of its own', 'chat', { calls: { planner: { enabled: false } } }],
    ["the planner's temperature is locked", 'chat', { calls: { planner: { temperature: 0.5 } } }],
    ['images take no temperature', 'images', { temperature: 0.5 }],
  ])('refuses a locked field: %s (RC-W8a)', async (_label, area, row) => {
    const code = await runBosLlmSettingsCommand(['set', area, '--file', rowFile(row)]);
    expect(code).toBe(1);
    expect(mockSet).not.toHaveBeenCalled();
    expect(errorFields().some((fields) => Array.isArray(fields.rejected))).toBe(true);
  });

  it('refuses an unknown call name rather than writing a row that does nothing', async () => {
    const code = await runBosLlmSettingsCommand([
      'set',
      'insights',
      '--file',
      rowFile({ calls: { insight_contnet: { temperature: 0.2 } } }),
    ]);
    expect(code).toBe(1);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('writes a valid row through the repository, in the Layer 2 category', async () => {
    const row = { model: 'gpt-4o', temperature: 0.5 };
    const code = await runBosLlmSettingsCommand(['set', 'insights', '--file', rowFile(row)]);
    expect(code).toBe(0);
    expect(mockSet).toHaveBeenCalledWith(
      'bos_llm_area_insights',
      row,
      'business_os_llm',
      expect.stringContaining('insights')
    );
  });

  it('writes nothing for a dry run', async () => {
    const code = await runBosLlmSettingsCommand([
      'set',
      'insights',
      '--file',
      rowFile({ model: 'gpt-4o' }),
      '--dry-run',
    ]);
    expect(code).toBe(0);
    expect(mockSet).not.toHaveBeenCalled();
  });
});

describe('set --enabled false must really switch the area off (T1-13, RC-W8c)', () => {
  beforeEach(() => {
    store.set('bos_llm_area_leads', {
      ...SEEDED_ROWS.leads,
      calls: { reply_recommendation: { enabled: true } },
    });
  });

  it('refuses, and names the overrides that would keep calls running', async () => {
    const code = await runBosLlmSettingsCommand(['set', 'leads', '--enabled', 'false']);
    expect(code).toBe(1);
    expect(mockSet).not.toHaveBeenCalled();
    expect(errorFields()).toContainEqual(
      expect.objectContaining({ callsStillEnabled: ['reply_recommendation'] })
    );
  });

  it('switches them off too with --include-calls', async () => {
    const code = await runBosLlmSettingsCommand(['set', 'leads', '--enabled', 'false', '--include-calls']);
    expect(code).toBe(0);
    expect(mockSet).toHaveBeenCalledWith(
      'bos_llm_area_leads',
      expect.objectContaining({
        enabled: false,
        calls: { reply_recommendation: { enabled: false } },
      }),
      'business_os_llm',
      expect.any(String)
    );
  });

  /*
   * S1-7, closed. Between Steps 2 and 3 the website switch covered five of
   * eight calls and the script said so, by name, every time. Step 3 shipped
   * the three missing off paths, so there is nothing left to warn about — and
   * the test that used to demand the warning now demands its ABSENCE, for
   * every area. If a future change re-creates a call that keeps spending after
   * `--enabled false`, `modelSettingsPolicy.test.ts` fails first.
   */
  it.each(['website', 'insights'])(
    'says nothing about partial coverage when switching %s off — no area is partial any more',
    async (area) => {
      store.set(`bos_llm_area_${area}`, SEEDED_ROWS[area as 'website' | 'insights']);

      const code = await runBosLlmSettingsCommand(['set', area, '--enabled', 'false']);

      expect(code).toBe(0);
      expect(logged.some((line) => typeof line.msg === 'string' && line.msg.includes('PARTIAL SWITCH'))).toBe(
        false
      );
      expect(logged.some((line) => Array.isArray(line.fields.callsStillRunning))).toBe(false);
    }
  );

  it('names the database it is talking to, before anything else (S1-11)', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example-project.supabase.co';
    await runBosLlmSettingsCommand(['get', 'leads']);
    expect(logged[0].fields).toMatchObject({
      command: 'get',
      supabaseHost: 'example-project.supabase.co',
    });
  });

  it('needs no flag when no call override would survive', async () => {
    store.set('bos_llm_area_leads', SEEDED_ROWS.leads);
    const code = await runBosLlmSettingsCommand(['set', 'leads', '--enabled', 'false']);
    expect(code).toBe(0);
    expect(mockSet.mock.calls[0][1]).toMatchObject({ enabled: false });
  });
});

describe('verify-stored: the P-3 pre-apply gate (T1-13, RC-W1a)', () => {
  it('passes on canonical values', async () => {
    store.set('bizchat_planner_model', 'gpt-4o');
    store.set('bizchat_analysis_enabled', 'TRUE');
    store.set('lead_reply_recommender_model', 'gpt-4o-mini');
    store.set('lead_reply_recommender_enabled', false);
    store.set('image_generation_model', 'gpt-image-1');

    expect(await runBosLlmSettingsCommand(['verify-stored'])).toBe(0);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it.each([
    ['"no" reads as OFF today but would seed ON', 'bizchat_analysis_enabled', 'no'],
    ['"0" reads as OFF today', 'lead_reply_recommender_enabled', '0'],
    ['a number reads as OFF today', 'lead_reply_recommender_enabled', 0],
    ['an untrimmed model name', 'bizchat_planner_model', ' gpt-4o '],
    ['a double-encoded model name', 'bizchat_planner_model', '"gpt-4o"'],
  ])('stops on %s', async (_label, key, value) => {
    store.set(key, value);
    expect(await runBosLlmSettingsCommand(['verify-stored'])).toBe(1);
    expect(errorFields().some((fields) => Array.isArray(fields.problems))).toBe(true);
  });

  it('stops on a stored model the guardrails would refuse', async () => {
    mockGetPricing.mockResolvedValue(null);
    store.set('bizchat_planner_model', 'gpt-4o-imaginary');
    expect(await runBosLlmSettingsCommand(['verify-stored'])).toBe(1);
  });

  it('classifies canonical values the same way on its own (unit)', () => {
    expect(isCanonicalLegacyValue('enabled', true)).toBe(true);
    expect(isCanonicalLegacyValue('enabled', 'TRUE')).toBe(true);
    expect(isCanonicalLegacyValue('enabled', 'no')).toBe(false);
    expect(isCanonicalLegacyValue('enabled', 0)).toBe(false);
    expect(isCanonicalLegacyValue('model', 'gpt-4o-mini')).toBe(true);
    expect(isCanonicalLegacyValue('model', ' gpt-4o ')).toBe(false);
    expect(isCanonicalLegacyValue('model', '"gpt-4o"')).toBe(false);
    expect(isCanonicalLegacyValue('model', '')).toBe(false);
  });
});

describe('verify-equivalence: the P-5b post-seed gate (T1-13b, RC-W1b)', () => {
  function seedAllAreas(overrides: Record<string, unknown> = {}) {
    for (const [area, row] of Object.entries(SEEDED_ROWS)) {
      store.set(`bos_llm_area_${area}`, overrides[area] ?? row);
    }
  }

  it('passes when the legacy readers and the resolver agree', async () => {
    store.set('bizchat_planner_model', 'gpt-4o-mini');
    store.set('bizchat_analysis_model', 'gpt-4o-mini');
    store.set('bizchat_analysis_enabled', true);
    store.set('lead_reply_recommender_model', 'gpt-4o-mini');
    store.set('lead_reply_recommender_enabled', true);
    store.set('image_generation_model', 'gpt-image-1');
    seedAllAreas();

    expect(await runBosLlmSettingsCommand(['verify-equivalence'])).toBe(0);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('stops when a non-canonical stored value reads as off today but seeded on', async () => {
    // Exactly the RC-W1 hazard: `"no"` is FALSE to today's reader, while the
    // seed's unwrap rules would drop it and leave the default, ON.
    store.set('lead_reply_recommender_enabled', 'no');
    seedAllAreas();

    expect(await runBosLlmSettingsCommand(['verify-equivalence'])).toBe(1);
    const difference = errorFields().find((fields) => Array.isArray(fields.differences));
    expect(difference?.differences).toContainEqual(
      expect.objectContaining({
        key: 'lead_reply_recommender_enabled',
        legacy: false,
        resolved: true,
      })
    );
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('stops on a model mismatch', async () => {
    store.set('bizchat_planner_model', 'gpt-4o');
    seedAllAreas(); // the seeded chat row still says gpt-4o-mini
    expect(await runBosLlmSettingsCommand(['verify-equivalence'])).toBe(1);
    const difference = errorFields().find((fields) => Array.isArray(fields.differences));
    expect(difference?.differences).toContainEqual(
      expect.objectContaining({ key: 'bizchat_planner_model', legacy: 'gpt-4o', resolved: 'gpt-4o-mini' })
    );
  });
});

describe('usage', () => {
  it.each([
    [['get', 'nonsense']],
    [['set', 'leads']],
    [['set', 'leads', '--enabled', 'maybe']],
    [['explode']],
    [[]],
  ])('refuses %p without writing', async (argv) => {
    expect(await runBosLlmSettingsCommand(argv)).toBe(2);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('prints a row and its resolved settings', async () => {
    store.set('bos_llm_area_insights', SEEDED_ROWS.insights);
    expect(await runBosLlmSettingsCommand(['get', 'insights'])).toBe(0);
    const line = logged.find((entry) => entry.level === 'info' && entry.fields.area === 'insights');
    expect(line?.fields.resolved).toMatchObject({
      insight_content: { model: 'gpt-4o-mini', temperature: 0.3, enabled: true, provider: 'openai' },
      health_summary: { temperature: 0.5 },
    });
  });
});
