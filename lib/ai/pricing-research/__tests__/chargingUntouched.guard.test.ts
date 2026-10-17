/**
 * The review code never prices a call (AI model price review; written for
 * slice 3, SA C-6; re-scoped in place by slice 7, SA O-4).
 *
 * Charging changes only in the charging modules, under their own suites
 * (slice 7: `lib/ai/__tests__/chargeParity.test.ts`, frozen, and
 * `lib/ai/__tests__/chargeSources.guard.test.ts`). This guard pins what the
 * research and review files (the price comparison, manual entry, the provider
 * fetch) can and cannot do:
 *   - they import from the charging modules only the named READ exports, and
 *     from `lib/ai/imagePricing.ts` only its PURE functions, never its cache;
 *   - none of them writes `ai_model_pricing` or `ai_model_image_pricing`;
 *   - none of them refreshes the billing cache or prices a call;
 *   - the price repositories are called only through their exact-text reads.
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const read = (relative: string) => readFileSync(join(ROOT, relative), 'utf8');

const RESEARCH_DIR = join('lib', 'ai', 'pricing-research');
const SLICE_FILES = [
  ...readdirSync(join(ROOT, RESEARCH_DIR))
    .filter((file) => file.endsWith('.ts'))
    .map((file) => join(RESEARCH_DIR, file)),
  join('lib', 'repositories', 'AiPriceProposalRepository.ts'),
  join('app', 'api', 'admin', 'model-pricing', 'manual-entries', 'route.ts'),
  join('app', 'api', 'admin', 'model-pricing', 'comparison', 'route.ts'),
  join('app', 'api', 'admin', 'model-pricing', 'fetch-runs', 'route.ts'),
];

/** Every named import from a module, per file. */
function importsFrom(source: string, modulePath: string): string[] {
  const names: string[] = [];
  const pattern = new RegExp(`import\\s+(?:type\\s+)?[{]([^}]*)[}]\\s+from\\s+'${modulePath.replace(/[/.]/g, (c) => `[${c}]`)}'`, 'g');
  for (const match of source.matchAll(pattern)) {
    names.push(...match[1].split(',').map((part) => part.trim().replace(/^type\s+/, '')).filter(Boolean));
  }
  return names;
}

it('covers the files of this slice', () => {
  expect(SLICE_FILES.length).toBeGreaterThanOrEqual(10);
});

it.each(SLICE_FILES)('%s imports only read exports from the charging modules', (file) => {
  const source = read(file);
  const allowed: Record<string, string[]> = {
    '@/lib/ai/pricing': ['inCodeTokenPrices', 'isInputOnlyPricedModel'],
    '@/lib/business-os/llm/chargePricing': ['conservativeRateDerivation'],
    '@/lib/services/GeneratedImageService': ['resolveImagePrice'],
    '@/lib/business-os/llm/modelSettings': ['validateAreaRow'],
    // Slice 7 (SA RC7-7): the pure selection rule and resolver, never `loadImagePrices`.
    '@/lib/ai/imagePricing': ['selectActiveImagePrices', 'resolveImagePriceFrom', 'imagePriceKey'],
  };
  for (const [modulePath, names] of Object.entries(allowed)) {
    for (const name of importsFrom(source, modulePath)) expect({ file, modulePath, name, ok: names.includes(name) }).toEqual({ file, modulePath, name, ok: true });
  }
  // Nothing in this slice may refresh the billing cache or price a call.
  expect(source).not.toMatch(/refreshPricingCache|calculateCost|priceActionForCharge|warmPricingCache|loadImagePrices|invalidateImagePrices/);
});

it.each(SLICE_FILES)('%s never writes a live price table', (file) => {
  const source = read(file);
  expect(source).not.toMatch(/from[(]'ai_model(_image)?_pricing'[)][\s\S]{0,200}[.](insert|update|upsert|delete)[(]/);
  expect(source).not.toMatch(/[.](syncMany|updateCosts|deleteById)[(]/);
  expect(source).not.toMatch(/aiModelPricingRepository[.](create|updateCosts|deleteById|syncMany)/);
  expect(source).not.toMatch(/aiModelImagePricingRepository[.](insert|update|upsert|delete|rpc)/);
});

it.each(['aiModelPricingRepository', 'aiModelImagePricingRepository'])('the only %s method the review code calls is listActiveExact', (repository) => {
  let calls = 0;
  for (const file of SLICE_FILES) {
    for (const match of read(file).matchAll(new RegExp(`${repository}[.]([a-zA-Z]+)`, 'g'))) {
      calls += 1;
      expect({ file, method: match[1] }).toEqual({ file, method: 'listActiveExact' });
    }
  }
  // Not vacuous: the comparison reads both tables (slice 7 RC7-7 for the image table).
  expect(calls).toBeGreaterThan(0);
});

// SA CR-3: the image price setting is a charging input, and both of these
// repositories have write methods. The slice may only read through them.
it.each([
  ['systemConfigRepository', ['getByKeys', 'getImageGenerationConfig']],
  ['adminUserRepository', ['listActive']],
])('the only %s methods this slice calls are read methods', (repository, allowed) => {
  let calls = 0;
  for (const file of SLICE_FILES) {
    for (const match of read(file).matchAll(new RegExp(`${repository}[.]([a-zA-Z]+)`, 'g'))) {
      calls += 1;
      expect({ file, method: match[1], ok: allowed.includes(match[1]) }).toEqual({ file, method: match[1], ok: true });
    }
  }
  expect(calls).toBeGreaterThan(0);
});

it('listActive, the billing reader, still has its filter and order (the hunk is additive)', () => {
  const source = read(join('lib', 'repositories', 'AiModelPricingRepository.ts'));
  const start = source.indexOf('async listActive(): Promise');
  const end = source.indexOf('async listActiveExact(): Promise');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const body = source.slice(start, end);
  expect(body).toContain(".select('*')");
  expect(body).toContain(".is('retired_date', null)");
  expect(body).toContain(".lte('effective_date', today)");
  expect(body).toContain(".order('effective_date', { ascending: false })");
  expect(body).toContain(".order('created_at', { ascending: false })");
});
