/**
 * Where charging reads its prices (AI model price review slice 7, workplan §4,
 * SA RC7-9). A source scan, with a negative control for every rule.
 *
 * - G-1 The conservative rate stays in-code (requirement finding 3): the FULL
 *   import set of `chargePricing.ts` is pinned, so it can never import a
 *   database reader, the image price cache or a cost function.
 * - G-2 `cached_input_cost_per_token` is read for charging only in
 *   `lib/ai/pricing.ts`. Beside it: the repository that selects it, the types,
 *   and the review code, which displays it.
 * - G-3 `IMAGE_FALLBACK_PRICING` is read only by the shared image resolver, the
 *   conservative rate and the review code (plus its definition). The guardrail
 *   and the image service no longer hold their own copy of the chain.
 * - G-4 The retired settings stay retired (O-1, BQ-7b): the image service, the
 *   guardrail and the comparison never read `pricesUsd`, and `EmbeddingService`
 *   never names the old embedding cost setting.
 * (G-5 was dropped: `livePriceWrites.guard` LW-2 pins the image repository.)
 *
 * Scope: a fixed list of five directory trees (about 700 files), not the whole
 * repository (SA F-2). Comments are stripped first, so prose may name anything.
 */

import * as fs from 'fs';
import * as path from 'path';

import { stripComments } from '@/tests/helpers/source-scan';

const ROOT = process.cwd();
const DIRS = ['lib/ai', 'lib/business-os/llm', 'lib/services', 'lib/repositories', 'app/api'];
const SKIP = new Set(['__tests__', '__fixtures__', 'node_modules']);

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) walk(`${dir}/${entry.name}`, out);
    } else if (/[.]tsx?$/.test(entry.name) && !/[.]test[.]/.test(entry.name)) {
      out.push(`${dir}/${entry.name}`);
    }
  }
}

const files: string[] = [];
for (const dir of DIRS) walk(dir, files);
const code = new Map(files.map((file) => [file, stripComments(fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n'))]));
const source = (file: string) => code.get(file) ?? '';

// ---------------------------------------------------------------------------
// The rules, as functions, so the negative controls run the same code
// ---------------------------------------------------------------------------

/** Every import of a file: `{ module: [names] }`, plus any import form that is not a named import. */
function importSet(text: string): { named: Record<string, string[]>; other: string[] } {
  const named: Record<string, string[]> = {};
  const other: string[] = [];
  for (const match of text.matchAll(/import\s+(type\s+)?[{]([^}]*)[}]\s+from\s+'([^']+)'/g)) {
    const names = match[2].split(',').map((part) => part.trim().replace(/^type\s+/, '')).filter(Boolean);
    named[match[3]] = [...(named[match[3]] ?? []), ...names].sort();
  }
  for (const match of text.matchAll(/import\s+(?![{]|type\s+[{])[^;]*?from\s+'([^']+)'|import\s+'([^']+)'|require[(]\s*'([^']+)'/g)) {
    other.push(match[1] ?? match[2] ?? match[3]);
  }
  return { named, other };
}

const CHARGE_PRICING_IMPORTS: Record<string, string[]> = {
  '@/lib/ai/pricing': ['inCodeTokenPrices', 'isInputOnlyPricedModel'],
  '@/lib/ai/usageScope': ['UsageCallRecord'],
  '@/lib/repositories/SystemConfigRepository': ['IMAGE_FALLBACK_PRICING'],
  './chargeClassification': ['ChargeKind', 'ClassifiedCall', 'classifyCallForCharge'],
};

/** Files (from a set) whose code names `token`, outside the allowed files and directories. */
function readersOutside(token: string, texts: Map<string, string>, allowed: string[]): string[] {
  return [...texts.entries()]
    .filter(([file, text]) => text.includes(token) && !allowed.some((entry) => (entry.endsWith('/') ? file.startsWith(entry) : file === entry)))
    .map(([file]) => file)
    .sort();
}

const CACHED_COLUMN_ALLOWED = [
  'lib/ai/pricing.ts',
  'lib/repositories/AiModelPricingRepository.ts',
  'lib/repositories/types.ts',
  'lib/ai/pricing-research/',
];
const IMAGE_FALLBACK_ALLOWED = [
  'lib/ai/imagePricing.ts',
  'lib/business-os/llm/chargePricing.ts',
  'lib/repositories/SystemConfigRepository.ts',
  'lib/ai/pricing-research/',
];
/** G-4 as a rule: which retired settings does this code read? (SA F-3) */
function readsRetiredSetting(text: string): string[] {
  const found: string[] = [];
  if (/pricesUsd/.test(text)) found.push('image_generation_prices_usd (pricesUsd)');
  if (text.includes('helpbot_embedding_cost_per_1k_tokens')) found.push('helpbot_embedding_cost_per_1k_tokens');
  return found;
}

const NO_IMAGE_SETTING = [
  'lib/services/GeneratedImageService.ts',
  'lib/business-os/llm/modelSettings.ts',
  'lib/ai/pricing-research/comparisonModel.ts',
];

// ---------------------------------------------------------------------------

it('scans a real, non-empty file set, with every named file present', () => {
  expect(files.length).toBeGreaterThan(200);
  for (const file of ['lib/business-os/llm/chargePricing.ts', ...CACHED_COLUMN_ALLOWED, ...IMAGE_FALLBACK_ALLOWED, ...NO_IMAGE_SETTING, 'lib/services/EmbeddingService.ts']) {
    if (file.endsWith('/')) continue;
    expect({ file, scanned: code.has(file) }).toEqual({ file, scanned: true });
  }
});

describe('G-1: the conservative rate stays in-code', () => {
  it('chargePricing.ts imports exactly the in-code tables, the usage type and the classification', () => {
    const { named, other } = importSet(source('lib/business-os/llm/chargePricing.ts'));
    expect(named).toEqual(CHARGE_PRICING_IMPORTS);
    expect(other).toEqual([]);
  });

  it('negative control: an added reader, an extra name or a default import is caught', () => {
    const base = "import { inCodeTokenPrices, isInputOnlyPricedModel } from '@/lib/ai/pricing';";
    expect(importSet(`${base}\nimport { loadImagePrices } from '@/lib/ai/imagePricing';`).named).not.toEqual(
      importSet(base).named
    );
    expect(importSet("import { inCodeTokenPrices, calculateCostSync } from '@/lib/ai/pricing';").named['@/lib/ai/pricing']).toContain(
      'calculateCostSync'
    );
    expect(importSet("import repo from '@/lib/repositories/AiModelPricingRepository';").other).toEqual([
      '@/lib/repositories/AiModelPricingRepository',
    ]);
    expect(importSet("const r = require('@/lib/ai/imagePricing');").other).toEqual(['@/lib/ai/imagePricing']);
  });
});

describe('G-2: the cached-input column is charged only through lib/ai/pricing.ts', () => {
  it('no other charging file reads it', () => {
    expect(readersOutside('cached_input_cost_per_token', code, CACHED_COLUMN_ALLOWED)).toEqual([]);
  });

  it('the reader is real (not vacuous) and a new reader is caught', () => {
    expect(source('lib/ai/pricing.ts')).toContain('cached_input_cost_per_token');
    const planted = new Map([['lib/ai/providers/openaiProvider.ts', 'const r = row.cached_input_cost_per_token;']]);
    expect(readersOutside('cached_input_cost_per_token', planted, CACHED_COLUMN_ALLOWED)).toEqual(['lib/ai/providers/openaiProvider.ts']);
  });
});

describe('G-3: one image price chain', () => {
  it('IMAGE_FALLBACK_PRICING is read only by the resolver, the conservative rate and the review code', () => {
    expect(readersOutside('IMAGE_FALLBACK_PRICING', code, IMAGE_FALLBACK_ALLOWED)).toEqual([]);
  });

  it('the resolver really reads it, and a copy in the guardrail or the service is caught', () => {
    expect(source('lib/ai/imagePricing.ts')).toContain('IMAGE_FALLBACK_PRICING');
    const planted = new Map([
      ['lib/business-os/llm/modelSettings.ts', 'const f = IMAGE_FALLBACK_PRICING[key];'],
      ['lib/services/GeneratedImageService.ts', 'import { IMAGE_FALLBACK_PRICING } from x;'],
    ]);
    expect(readersOutside('IMAGE_FALLBACK_PRICING', planted, IMAGE_FALLBACK_ALLOWED)).toEqual([
      'lib/business-os/llm/modelSettings.ts',
      'lib/services/GeneratedImageService.ts',
    ]);
  });
});

describe('G-4: the retired settings stay retired (O-1, BQ-7b)', () => {
  it.each([...NO_IMAGE_SETTING, 'lib/services/EmbeddingService.ts'])('%s reads no retired setting', (file) => {
    expect(readsRetiredSetting(source(file))).toEqual([]);
  });

  it('negative control: the rule catches a planted read of either setting, and ignores comments', () => {
    const planted = new Map([
      ['lib/services/GeneratedImageService.ts', 'const p = config.pricesUsd[key];'],
      ['lib/services/EmbeddingService.ts', "await SystemConfigService.getNumber(db, 'helpbot_embedding_cost_per_1k_tokens', 0);"],
    ]);
    expect([...planted.entries()].map(([file, text]) => [file, readsRetiredSetting(text)])).toEqual([
      ['lib/services/GeneratedImageService.ts', ['image_generation_prices_usd (pricesUsd)']],
      ['lib/services/EmbeddingService.ts', ['helpbot_embedding_cost_per_1k_tokens']],
    ]);
    // Comments are stripped before the scan, so prose may still name them.
    const commented = ['// pricesUsd and helpbot_embedding_cost_per_1k_tokens are gone', 'const x = 1;'].join(String.fromCharCode(10));
    expect(readsRetiredSetting(stripComments(commented))).toEqual([]);
  });
});
