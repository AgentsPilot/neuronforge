/**
 * Source rules for the slice 5 fetch (AI model price review; SA RR-1, RR-8,
 * SC-9, SC-15, SC-16).
 *
 *   - NO LLM reads a pricing page: nothing in `lib/ai/pricing-research` or the
 *     fetch route imports an AI provider, the provider factory or an SDK.
 *   - One outbound door: `fetch(` appears only in `fetchSources.ts`, and the
 *     only full URLs are its pinned constants (no SSRF surface).
 *   - No page body in a log line.
 *   - No model id literal in the new feature code (CLAUDE.md rule 5). These
 *     files do not reach the call catalog, so `check:bos-llm-literals` cannot
 *     see them; this test is their gate. Fixtures and tests are exempt.
 *   - The route imports only read exports from the charging modules and never
 *     writes a live price table (the same rules `chargingUntouched.guard`
 *     applies to the lib files, which it already scans).
 *   - Fixtures hold no backslash (Tailwind scan hazard, PR #180).
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { LITERAL_RULES, codeOf } from '@/tests/helpers/bos-llm-literal-rules';

const ROOT = process.cwd();
const read = (relative: string) => readFileSync(join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n');

const RESEARCH_DIR = 'lib/ai/pricing-research';
const ROUTE = 'app/api/admin/model-pricing/fetch-runs/route.ts';
const LIB_FILES = readdirSync(join(ROOT, RESEARCH_DIR))
  .filter((file) => file.endsWith('.ts'))
  .map((file) => `${RESEARCH_DIR}/${file}`);
const SCANNED = [...LIB_FILES, ROUTE];

/** The new slice 5 feature files (SC-15). */
const SLICE5_FILES = [
  `${RESEARCH_DIR}/fetchSources.ts`,
  `${RESEARCH_DIR}/openaiPricingAdapter.ts`,
  `${RESEARCH_DIR}/litellmCrossCheck.ts`,
  `${RESEARCH_DIR}/fetchRound.ts`,
  `${RESEARCH_DIR}/fetchOutcomes.ts`,
  ROUTE,
  'app/admin/system-config/priceFetchRun.ts',
  'app/admin/system-config/components/ProviderPriceCheck.tsx',
];

/** Comments out, including trailing `//` comments (URLs inside strings keep their `//`). */
function code(source: string): string {
  return codeOf(source).replace(/(^|[^:'"`])[/][/].*$/gm, '$1');
}

it('scans the research folder and the route', () => {
  expect(LIB_FILES.length).toBeGreaterThanOrEqual(13);
  for (const file of SLICE5_FILES) expect(() => read(file)).not.toThrow();
});

describe('no LLM reads a pricing page (RR-1, MP-NFR-7)', () => {
  const BANNED_IMPORTS = [
    /from '@[/]lib[/]ai[/]providerFactory'/,
    /from '@[/]lib[/]ai[/]providers[/]/,
    /from 'openai'/,
    /from '@anthropic-ai[/]/,
    /from 'groq-sdk'/,
    /from '@mistralai[/]/,
    /from '@[/]lib[/]orchestration[/]/,
  ];

  it.each(SCANNED)('%s imports no AI provider, factory or SDK', (file) => {
    const source = read(file);
    for (const banned of BANNED_IMPORTS) expect({ file, banned: String(banned), hit: banned.test(source) }).toEqual({ file, banned: String(banned), hit: false });
    expect(source).not.toMatch(/getProviderFactory|createChatCompletion|messages[.]create/);
  });
});

it.each(SLICE5_FILES)('%s does not import the call catalog (SC-15: the literal gate cannot see it, this file can)', (file) => {
  expect(read(file)).not.toMatch(/callCatalog/);
});

describe('one outbound door (SC-9)', () => {
  it.each(SCANNED)('%s: fetch( only in fetchSources.ts', (file) => {
    const calls = code(read(file)).match(/(?<![A-Za-z0-9_.])fetch[(]/g) ?? [];
    expect({ file, calls: calls.length }).toEqual({ file, calls: file.endsWith('/fetchSources.ts') ? 1 : 0 });
  });

  it.each(SCANNED)('%s: full URLs only as the pinned constants', (file) => {
    const urls = code(read(file)).match(/'https:[/][/][^']*'/g) ?? [];
    const expected = file.endsWith('/fetchSources.ts')
      ? [
          "'https://developers.openai.com/api/docs/pricing.md'",
          "'https://developers.openai.com/api/docs/pricing'",
          "'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'",
        ]
      : [];
    expect({ file, urls }).toEqual({ file, urls: expected });
  });

  it('fetchSources is server-only', () => {
    expect(read(`${RESEARCH_DIR}/fetchSources.ts`)).toContain("import 'server-only';");
  });
});

describe('no page body in a log line', () => {
  it.each([`${RESEARCH_DIR}/fetchSources.ts`, ROUTE])('%s', (file) => {
    const logCalls = code(read(file)).match(/[Ll]ogger[.](info|warn|error|debug)[(][^;]*;/g) ?? [];
    // The route logs one line per source; fetchSources logs nothing at all.
    expect(logCalls.length > 0).toBe(file === ROUTE);
    for (const call of logCalls) {
      expect(call).not.toMatch(/[.]text(?![A-Za-z])|(?<![A-Za-z])text:|(?<![A-Za-z'])raw(?![A-Za-z])|[{,] *body(?![A-Za-z])/);
    }
  });
});

describe('no model id literal in the new feature code (SC-15)', () => {
  const rule = LITERAL_RULES[0];

  it('the rule can match (a dead rule finds nothing)', () => {
    expect(rule.pattern.test(rule.mustMatch)).toBe(true);
    expect(rule.pattern.test("const m = 'gpt-4o-mini';")).toBe(true);
  });

  it.each(SLICE5_FILES)('%s', (file) => {
    const lines = code(read(file)).split('\n').filter((line) => rule.pattern.test(line));
    expect({ file, lines }).toEqual({ file, lines: [] });
  });
});

describe('the route reads, and never writes, the charging side', () => {
  const source = read(ROUTE);

  it('imports only read exports from the charging modules', () => {
    const fromPricing = [...source.matchAll(/import [{]([^}]*)[}] from '@[/]lib[/]ai[/]pricing'/g)].flatMap((match) =>
      match[1].split(',').map((name) => name.trim()).filter(Boolean)
    );
    expect(fromPricing).toEqual(['isInputOnlyPricedModel']);
    expect(source).not.toMatch(/refreshPricingCache|calculateCost|priceActionForCharge/);
  });

  it('never names a live price table or a write on it (code, not the header comment)', () => {
    expect(code(source)).not.toMatch(/ai_model_pricing|ai_model_image_pricing/);
    expect(code(source)).not.toMatch(/aiModelPricingRepository|syncMany|updateCosts|deleteById/);
  });
});

describe('fixtures', () => {
  const FIXTURE_DIR = `${RESEARCH_DIR}/__fixtures__`;
  const fixtures = readdirSync(join(ROOT, FIXTURE_DIR)).map((file) => `${FIXTURE_DIR}/${file}`);

  it.each(fixtures)('%s holds no backslash', (file) => {
    expect(read(file)).not.toContain(String.fromCharCode(92));
  });

  it('are dated', () => {
    for (const file of fixtures) expect(file).toMatch(/-2026-[0-9]{2}-[0-9]{2}[.](md|json)$/);
  });
});
