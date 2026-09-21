/**
 * T1-9 (Layer 2 Step 1) — the seed migration file.
 *
 * The migration is not applied by this branch, so the only way to know it is
 * right before an operator runs it is to read it: eight inserts that cannot
 * overwrite anything, the six unwrap expressions, the re-runnable "superseded"
 * marker — and, most importantly, that the rows it writes resolve to exactly
 * today's values (FR-16, AC-2 seed side).
 *
 * The row fixtures below are the workplan's §10 "seeded rows" table. They are
 * fed through the real resolver, so if the policy and the seed ever disagree
 * this test fails rather than a production call quietly changing model.
 */

const mockGetPricing = jest.fn();
jest.mock('@/lib/ai/pricing', () => ({
  getPricing: (...args: unknown[]) => mockGetPricing(...args),
  calculateCostSync: () => 0,
  calculateCost: async () => 0,
  hasPricing: async () => true,
}));

const mockGetByKeys = jest.fn();
jest.mock('@/lib/repositories/SystemConfigRepository', () => {
  const actual = jest.requireActual('@/lib/repositories/SystemConfigRepository');
  return {
    ...actual,
    systemConfigRepository: {
      getByKeys: (...args: unknown[]) => mockGetByKeys(...args),
      getImageGenerationConfig: async () => ({
        ...actual.IMAGE_GENERATION_CONFIG_DEFAULTS,
        pricesUsd: {},
      }),
    },
  };
});

import * as fs from 'fs';
import * as path from 'path';

import { BOS_LLM_AREAS, type BosLlmArea } from '../callCatalog';
import {
  __resetBosLlmSettingsForTests,
  bosLlmCodeDefaults,
  resolveBosLlmSettings,
  validateAreaRow,
} from '../modelSettings';
import { bosLlmAreaKey, bosLlmSettingsCallNames } from '../modelSettingsPolicy';
import { SEEDED_ROWS } from '../__fixtures__/seededRows';

const ROOT = path.resolve(__dirname, '../../../..');
const MIGRATION = path.join(ROOT, 'supabase/migrations/20261003_seed_bos_llm_area_settings.sql');
const sql = fs.readFileSync(MIGRATION, 'utf8');
/** The statements only: the header carries the same phrases as instructions. */
const statements = sql
  .split(/\r?\n/)
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

// ---------------------------------------------------------------------------
// Reading the migration's own values (S1-3)
// ---------------------------------------------------------------------------

/**
 * Parse what the SQL actually INSERTs, so "the seed changes nothing" is a claim
 * about the file an operator pastes into the SQL editor — not about the fixture
 * beside it. Before this, T1-9 only matched substrings, so an edited value in
 * the migration could sail through (S1-3).
 *
 * The grammar is tiny and fixed: `jsonb_build_object('key', <value>, …)`, where
 * a value is a quoted string, a number, `true` / `false`, `NULL`, a nested
 * `jsonb_build_object(…)`, or a `stored.<name>` column from the CTE (whose
 * COALESCE default is read from the CTE itself, so the "no legacy value stored"
 * case is what gets compared).
 */
function balancedArgs(text: string, openIndex: number): string {
  let depth = 0;
  let quoted = false;
  for (let i = openIndex; i < text.length; i += 1) {
    const char = text[i];
    if (char === "'") quoted = !quoted;
    else if (!quoted && char === '(') depth += 1;
    else if (!quoted && char === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(openIndex + 1, i);
    }
  }
  throw new Error('unbalanced parentheses in the migration');
}

function splitTopLevel(args: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = '';
  for (const char of args) {
    if (char === "'") quoted = !quoted;
    if (!quoted && char === '(') depth += 1;
    if (!quoted && char === ')') depth -= 1;
    if (char === ',' && depth === 0 && !quoted) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** The CTE's COALESCE defaults: `<column> -> the value used when nothing is stored`. */
function storedDefaults(sqlText: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const pattern =
    /COALESCE\(\(SELECT (?:text|bool)_value FROM legacy WHERE key = '[a-z_]+'\),\s*('[^']*'|true|false)\)\s*AS\s*(\w+)/g;
  let match = pattern.exec(sqlText);
  while (match) {
    out[match[2]] = match[1].startsWith("'") ? match[1].slice(1, -1) : match[1] === 'true';
    match = pattern.exec(sqlText);
  }
  return out;
}

function parseValue(token: string, defaults: Record<string, unknown>): unknown {
  const text = token.replace(/\s*--[^\n]*/g, '').trim();
  if (text.startsWith('jsonb_build_object')) {
    return parseObject(text, defaults);
  }
  if (text.startsWith("'")) return text.slice(1, -1);
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'NULL') return null;
  if (text.startsWith('stored.')) {
    const column = text.slice('stored.'.length);
    if (!(column in defaults)) throw new Error(`unknown CTE column ${column}`);
    return defaults[column];
  }
  const number = Number(text);
  if (!Number.isNaN(number)) return number;
  throw new Error(`unparsed migration value: ${text}`);
}

function parseObject(text: string, defaults: Record<string, unknown>): Record<string, unknown> {
  const open = text.indexOf('(');
  const parts = splitTopLevel(balancedArgs(text, open));
  const out: Record<string, unknown> = {};
  for (let i = 0; i < parts.length; i += 2) {
    const key = parts[i].replace(/\s*--[^\n]*/g, '').trim();
    out[key.slice(1, -1)] = parseValue(parts[i + 1], defaults);
  }
  return out;
}

/** The row the migration writes for one area, with no legacy value stored. */
function migrationRow(area: BosLlmArea): Record<string, unknown> {
  const marker = `'${bosLlmAreaKey(area)}',`;
  const start = statements.indexOf(marker);
  if (start < 0) throw new Error(`no INSERT for ${area}`);
  const objectStart = statements.indexOf('jsonb_build_object', start);
  return parseObject(statements.slice(objectStart), storedDefaults(statements));
}

function seededRows(overrides: Partial<Record<BosLlmArea, Record<string, unknown>>> = {}) {
  return {
    data: BOS_LLM_AREAS.map((area) => ({
      key: bosLlmAreaKey(area),
      value: overrides[area] ?? SEEDED_ROWS[area],
      category: 'business_os_llm',
      updated_at: '2026-10-03T00:00:00.000Z',
    })),
    error: null,
  };
}

beforeEach(() => {
  mockGetPricing.mockReset().mockResolvedValue({ input: 0.0025, output: 0.01 });
  mockGetByKeys.mockReset().mockResolvedValue(seededRows());
  __resetBosLlmSettingsForTests();
});

describe('the migration file (T1-9, FR-16)', () => {
  it('inserts one row per area, in the Layer 2 category, and never overwrites', () => {
    for (const area of BOS_LLM_AREAS) {
      expect(sql).toContain(`'${bosLlmAreaKey(area)}'`);
    }
    expect(sql).toContain("'business_os_llm'");
    expect(statements.match(/ON CONFLICT \(key\) DO NOTHING/g)).toHaveLength(1);
    expect(statements).not.toMatch(/DO UPDATE/i);
    // The rollback DELETE lives in the header, as an instruction, never as a statement.
    expect(statements).not.toMatch(/DELETE\s+FROM/i);
  });

  it('unwraps all six legacy keys, strings and booleans alike (RC-4)', () => {
    for (const key of [
      'bizchat_planner_model',
      'bizchat_analysis_model',
      'bizchat_analysis_enabled',
      'lead_reply_recommender_model',
      'lead_reply_recommender_enabled',
      'image_generation_model',
    ]) {
      expect(sql).toContain(`'${key}'`);
    }
    // JSON-encoded strings and string booleans, per §3.7.
    expect(statements).toContain("jsonb_typeof(value) = 'string'");
    expect(statements).toContain("jsonb_typeof(value) = 'boolean'");
    expect(statements).toContain("value #>> '{}'");
    expect(statements).toContain("IN ('true', 'false')");
  });


  // S1-3: the values in the FILE, not only in the fixture beside it.
  it('writes exactly the rows the fixture describes, value for value', () => {
    for (const area of BOS_LLM_AREAS) {
      expect({ area, row: migrationRow(area) }).toEqual({ area, row: SEEDED_ROWS[area] });
    }
  });

  it('falls back to the code defaults when a legacy key is not stored', () => {
    // The CTE's COALESCE defaults are what the seed writes when nothing is
    // stored, so they must be today's values (F-3).
    expect(storedDefaults(statements)).toEqual({
      planner_model: 'gpt-4o-mini',
      analysis_model: 'gpt-4o-mini',
      analysis_enabled: true,
      leads_model: 'gpt-4o-mini',
      leads_enabled: true,
      image_model: 'gpt-image-1',
    });
  });

  it('marks the old keys superseded, re-runnably, and deletes nothing', () => {
    expect(statements).toContain('superseded by bos_llm_area_*');
    expect(statements).toContain("NOT LIKE '%superseded%'");
  });

  it('carries the pre-check, the parity check and the rollback in its header (§9)', () => {
    for (const marker of [
      'PRE-CHECK A',
      'PRE-CHECK B',
      'PRE-CHECK C',
      'verify-stored',
      'verify-equivalence',
      'ROLLBACK',
    ]) {
      expect(sql).toContain(marker);
    }
  });

  it('writes no temperature for images and an explicit NULL for onboarding (F-7)', () => {
    expect(SEEDED_ROWS.images).not.toHaveProperty('temperature');
    expect(SEEDED_ROWS.onboarding.temperature).toBeNull();
    expect(statements).toContain("'temperature', NULL");
  });
});

describe('the seeded rows reproduce today exactly (T1-9, AC-2)', () => {
  it('is accepted by the resolver guardrails, area by area', async () => {
    for (const area of BOS_LLM_AREAS) {
      // eslint-disable-next-line no-await-in-loop
      const validation = await validateAreaRow(area, SEEDED_ROWS[area]);
      expect({ area, rejected: validation.rejected }).toEqual({ area, rejected: [] });
    }
  });

  it('resolves every call to its code default — the seed changes nothing', async () => {
    for (const area of BOS_LLM_AREAS) {
      for (const callName of bosLlmSettingsCallNames(area)) {
        // eslint-disable-next-line no-await-in-loop
        const resolved = await resolveBosLlmSettings(area as never, callName as never);
        expect({ area, callName, resolved }).toEqual({
          area,
          callName,
          resolved: bosLlmCodeDefaults(area, callName),
        });
      }
    }
  });

  it('carries a stored legacy value through to the call that used to read it (F-3)', async () => {
    // What the migration does when `bizchat_planner_model` holds 'gpt-4o' and
    // `lead_reply_recommender_enabled` holds false.
    mockGetByKeys.mockResolvedValue(
      seededRows({
        chat: {
          ...SEEDED_ROWS.chat,
          calls: { planner: { model: 'gpt-4o' }, analysis: { model: 'gpt-4o-mini', enabled: false } },
        },
        leads: { ...SEEDED_ROWS.leads, enabled: false },
      })
    );

    expect(await resolveBosLlmSettings('chat', 'planner')).toMatchObject({
      model: 'gpt-4o',
      temperature: 0,
      enabled: true,
    });
    expect(await resolveBosLlmSettings('chat', 'analysis')).toMatchObject({
      model: 'gpt-4o-mini',
      enabled: false,
    });
    expect(await resolveBosLlmSettings('leads', 'reply_recommendation')).toMatchObject({
      enabled: false,
      model: 'gpt-4o-mini',
    });
  });
});
