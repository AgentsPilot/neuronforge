/**
 * T4-1 — the FR-15 literal gate (`scripts/check-bos-llm-literals.ts`).
 *
 * A gate that cannot be shown to fail is not a gate. These tests drive the
 * detector on both sides: the shapes that must fail (a model literal, a model
 * constant, a temperature number, a superseded settings key — including one
 * planted into a REAL call site's source), and the shapes that must not (prose
 * that mentions a model, a resolved value, a module path). The scope tests pin
 * what the gate looks at, because a check that silently stops looking at a file
 * is worse than no check at all.
 *
 * @see docs/requirements/BUSINESS_OS_LLM_MODEL_SETTINGS_LAYER2_REQUIREMENT.md (FR-15, AC-11)
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  EXEMPTIONS,
  findViolations,
  scanFiles,
  scopedFiles,
  staleInclusions,
  type Violation,
} from '../check-bos-llm-literals';
import {
  CATALOG,
  LITERAL_SCOPE_INCLUSIONS,
  isTestFile,
  literalScope,
  type FileImports,
} from '../lib/bos-llm-scope';

const ROOT = path.resolve(__dirname, '..', '..');
const POLICY = 'lib/business-os/llm/modelSettingsPolicy.ts';
const SETTINGS_SCRIPT = 'scripts/bos-llm-settings.ts';

const rules = (violations: Violation[]): string[] => violations.map((violation) => violation.rule);

describe('T4-1: what the literal check flags', () => {
  it('flags a model name written into a request', () => {
    const found = findViolations('site.ts', `provider.chatCompletion({ model: 'gpt-4o', messages });`);
    expect(rules(found)).toEqual(['model-literal']);
    expect(found[0].text).toBe("'gpt-4o'");
    expect(found[0].hint).toContain('resolveBosLlmSettings');
  });

  it.each([
    ['gpt-4o-mini', `const m = 'gpt-4o-mini';`],
    ['o1-preview', `const m = 'o1-preview';`],
    ['o3-mini', `const m = "o3-mini";`],
    ['text-embedding-3-small', `const m = 'text-embedding-3-small';`],
    ['gpt-image-1', `const m = \`gpt-image-1\`;`],
    ['claude-sonnet-4', `const m = 'claude-sonnet-4';`],
    ['kimi-k2', `const m = 'kimi-k2';`],
  ])('flags the model id %s wherever it is written', (_name, source) => {
    expect(rules(findViolations('site.ts', source))).toEqual(['model-literal']);
  });

  it('flags a model-name constant, which is the same hardcode with an import in front of it', () => {
    const source = [
      `import { OPENAI_MODELS } from '@/lib/ai/models';`,
      `provider.chatCompletion({ model: OPENAI_MODELS.GPT_4O_MINI });`,
    ].join('\n');
    // Both the import binding and the use: the import alone would let a rename hide it.
    expect(rules(findViolations('site.ts', source))).toEqual(['model-constant', 'model-constant']);
  });

  it.each([
    ['a plain property', `provider.chatCompletion({ temperature: 0.7 });`],
    ['zero', `provider.chatCompletion({ temperature: 0 });`],
    ['a ?? default', `const request = { temperature: settings.temperature ?? 0.7 };`],
    ['an || default', `const request = { temperature: settings.temperature || 0.3 };`],
    ['a variable', `const temperature = 0.5;`],
    ['an assignment', `request.temperature = 0.2;`],
  ])('flags a temperature number: %s', (_name, source) => {
    expect(rules(findViolations('site.ts', source))).toContain('temperature');
  });

  it.each([
    ['chatgpt-4o-latest', `const m = 'chatgpt-4o-latest';`],
    ['tts-1', `const m = 'tts-1';`],
    ['sora-2', `const m = 'sora-2';`],
    ['omni-moderation-latest', `const m = 'omni-moderation-latest';`],
    ['deepseek-chat', `const m = 'deepseek-chat';`],
  ])('flags %s, a live model id outside the original pattern list (SA finding 4)', (_name, source) => {
    expect(rules(findViolations('site.ts', source))).toEqual(['model-literal']);
  });

  it('flags a read of the exempt policy module, the door the exemption opens (SA finding 6)', () => {
    const source = [
      `import { BOS_LLM_CALL_POLICY } from '@/lib/business-os/llm/modelSettingsPolicy';`,
      `const model = BOS_LLM_CALL_POLICY.website.full_site.model;`,
    ].join('\n');
    expect(rules(findViolations('site.ts', source))).toEqual(['model-constant', 'model-constant']);
  });

  it.each([
    ['a ternary', `chat({ temperature: draft ? 0.7 : 0.3 });`],
    ['a default parameter', `function f(temperature = 0.7) {}`],
    ['a class property', `class A { temperature = 0.7; }`],
    ['an abbreviated name', `const DEFAULT_TEMP = 0.7;`],
  ])('flags a temperature hidden in %s (SA finding 3)', (_name, source) => {
    expect(rules(findViolations('site.ts', source))).toContain('temperature');
  });

  it.each([
    ['??=', `request.temperature ??= 0.8;`],
    ['||=', `opts.temperature ||= 0.3;`],
    ['a destructuring default', `const { temperature: temp = 0.4 } = settings;`],
    ['satisfies', `chat({ temperature: 0.7 satisfies number });`],
  ])('flags a temperature hidden behind %s (QA D4-3)', (_name, source) => {
    // The first two are the header's own promise in assignment form: a stated
    // guarantee that is false is worse than an admitted gap.
    expect(rules(findViolations('site.ts', source))).toContain('temperature');
  });

  it('flags a destructuring default by its SOURCE key, whatever the alias is called', () => {
    // `{ temperature: t = 0.4 }` — the local name carries no signal at all.
    expect(rules(findViolations('site.ts', `const { temperature: t = 0.4 } = settings;`))).toContain(
      'temperature'
    );
  });

  it('flags a model chosen by an environment variable, which no operator can change', () => {
    // chat-v2's shape (`AIDataLayerService`), which is out of scope today only
    // because it does not import the catalog. If it is ever wired, this bites.
    const found = findViolations('site.ts', `const model = process.env.OPENAI_CHAT_MODEL;`);
    expect(rules(found)).toEqual(['env-model']);
    expect(found[0].hint).toContain('not the area row');
  });

  it('flags the bracket form too', () => {
    expect(rules(findViolations('site.ts', `const m = process.env['WEBSITE_MODEL'];`))).toEqual(['env-model']);
  });

  it('does not flag an environment variable that is not a model', () => {
    expect(findViolations('site.ts', `const url = process.env.SUPABASE_URL;`)).toEqual([]);
  });

  it('flags a read of a settings key the area rows superseded', () => {
    const source = `const model = await systemConfigRepository.getString('lead_reply_recommender_model', fallback);`;
    expect(rules(findViolations('site.ts', source))).toEqual(['superseded-key']);
  });
});

describe('T4-1: what the literal check must NOT flag', () => {
  it('ignores comments and JSDoc entirely — prose about a model is not a hardcode', () => {
    // SA Step 2 finding 10: flagging prose pushes authors to write vaguer
    // comments, not better code.
    const source = [
      `/** This route calls gpt-4o and waits for a full page of copy. */`,
      `// use gpt-4o-mini for better cost; temperature: 0.7 used to live here`,
      `provider.complete({ model, ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}) });`,
    ].join('\n');
    expect(findViolations('site.ts', source)).toEqual([]);
  });

  it('ignores a sentence that merely mentions a model', () => {
    const source = `logger.warn({ model }, 'The configured model gpt-4o was refused; falling back');`;
    expect(findViolations('site.ts', source)).toEqual([]);
  });

  it('ignores the resolved value, which is the shape every call site uses', () => {
    const source = [
      `const settings = await resolveBosLlmSettings('website', 'full_site');`,
      `await withModelFallback(settings, (model) => provider.complete({`,
      `  model,`,
      `  ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),`,
      `}));`,
    ].join('\n');
    expect(findViolations('site.ts', source)).toEqual([]);
  });

  it('ignores a module path that happens to look like a model id', () => {
    expect(findViolations('site.ts', `import x from 'gpt-4o-helpers';`)).toEqual([]);
  });

  it.each([
    ['a type alias', `type BosModel = 'gpt-4o' | 'gpt-4o-mini';`],
    ['an interface member', `interface X { model: 'gpt-4o' }`],
  ])('ignores a model id in a type position: %s (SA finding 5)', (_name, source) => {
    // A type cannot send anything to a provider, and the admin screen (FU-3)
    // will be made of exactly these. Noise is what gets a gate disabled.
    expect(findViolations('site.ts', source)).toEqual([]);
  });

  it('does not mistake a template for a temperature', () => {
    expect(findViolations('site.ts', `const template = 0.7;`)).toEqual([]);
  });
});

describe('T4-1: a re-hardcoded REAL call site fails', () => {
  it('fails when the planner stops sending the model it resolved', () => {
    const rel = 'lib/business-os/bizql/planner/Planner.ts';
    const source = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    expect(findViolations(rel, source)).toEqual([]);

    const mutated = source.replace('model: attemptModel,', "model: 'gpt-4o',");
    expect(mutated).not.toBe(source); // the anchor still exists; if it moves, fix the test, not the gate
    const found = findViolations(rel, mutated);
    expect(rules(found)).toEqual(['model-literal']);
  });
});

describe('T4-1: the exemptions', () => {
  it('exempts exactly two named files, each with a reason', () => {
    // A directory exclusion would buy one file and blanket hundreds; the
    // exemption list is the gate's blast radius, so it stays short and readable
    // (SA finding 8). A third entry is a code change with an SA review.
    expect(Object.keys(EXEMPTIONS).sort()).toEqual([POLICY, SETTINGS_SCRIPT].sort());
    expect(EXEMPTIONS[POLICY]).toMatch(/FR-3/);
    expect(EXEMPTIONS[SETTINGS_SCRIPT]).toMatch(/verify-equivalence/);
  });

  it('is load-bearing for the operator script too: it WOULD fail if it were checked', () => {
    // `verify-equivalence` (P-5b) compares the superseded keys and their legacy
    // defaults with the area rows. Naming them is its function.
    const source = fs.readFileSync(path.join(ROOT, SETTINGS_SCRIPT), 'utf8');
    expect(findViolations(SETTINGS_SCRIPT, source).length).toBeGreaterThan(0);
    expect(scanFiles([SETTINGS_SCRIPT])).toEqual([]);
  });

  it('is load-bearing: the policy module WOULD fail if it were checked', () => {
    // It is the one place a model name and a temperature are written (FR-3).
    // If this ever returns nothing, the defaults have moved and the exemption
    // has become a licence rather than a description.
    const source = fs.readFileSync(path.join(ROOT, POLICY), 'utf8');
    expect(findViolations(POLICY, source).length).toBeGreaterThan(0);
    expect(scanFiles([POLICY])).toEqual([]);
  });
});

describe('T4-1: scope', () => {
  const graph = (entries: Record<string, string[]>): Map<string, FileImports> =>
    new Map(
      Object.entries(entries).map(([rel, imports]) => [
        rel,
        { imports: new Set(imports), reExports: new Set<string>() },
      ])
    );

  it('takes non-test files that import the catalog, and the catalog itself', () => {
    expect(
      literalScope(
        graph({
          [CATALOG]: [],
          'lib/services/WebsiteAIContentService.ts': [CATALOG],
          'app/api/website/page/route.ts': ['lib/services/WebsiteAIContentService.ts'],
        })
      )
    ).toEqual([CATALOG, 'lib/services/WebsiteAIContentService.ts']);
  });

  it('excludes tests, fixtures and mocks, which must name models', () => {
    expect(
      literalScope(
        graph({
          'lib/business-os/llm/__tests__/callParams.boundary.step2.test.ts': [CATALOG],
          'lib/business-os/llm/__fixtures__/seededRows.ts': [CATALOG],
        })
      )
    ).toEqual([]);
  });

  it('keeps the operator script IN scope and exempts it by name (SA finding 8)', () => {
    // Not a directory exclusion: a backfill script that imports the catalog
    // tomorrow is checked, and this one's pass is visible in `--list`.
    expect(literalScope(graph({ [SETTINGS_SCRIPT]: [CATALOG] }))).toEqual([SETTINGS_SCRIPT]);
    expect(EXEMPTIONS[SETTINGS_SCRIPT]).toBeDefined();
  });

  it.each([
    'lib/business-os/llm/__tests__/modelSettings.test.ts',
    'lib/services/__tests__/GeneratedImageService.attribution.test.ts',
    'lib/business-os/llm/__fixtures__/seededRows.ts',
    'app/api/x/route.test.ts',
  ])('treats %s as a test file', (rel) => {
    expect(isTestFile(rel)).toBe(true);
  });

  it('does not treat a production call site as a test file', () => {
    expect(isTestFile('lib/business-os/bizql/planner/Planner.ts')).toBe(false);
  });
});

describe('T4-1: what the gate CANNOT see (SA finding 2 — documented, not fixed)', () => {
  // These pass. That is the point: the check is syntactic, and a reviewer who
  // believes it is total stops looking. If one ever starts failing, the gate got
  // stronger — update the script header, the skill and this block together.
  // QA's D4-3 four (`??=`, `||=`, a destructuring default, `satisfies`) are
  // deliberately NOT here: they were caught rather than documented, because
  // two of them contradicted a promise the header had already made.
  it.each([
    ['a value imported from another module', `import { PREFERRED_MODEL } from './helper'; chat({ model: PREFERRED_MODEL });`],
    ['a computed model id', `chat({ model: ['gpt', '4o'].join('-') });`],
    ['a temperature in an unnamed variable', `const t = 0.7; chat({ temperature: t });`],
    ['process.env one alias away', `const cfg = process.env; const m = cfg['OPENAI_CHAT_MODEL'];`],
  ])('does not catch %s', (_name, source) => {
    expect(findViolations('site.ts', source)).toEqual([]);
  });
});

describe('T4-1: the gate on this tree (AC-11)', () => {
  // Resolves every import in the project through the compiler; ~20s.
  jest.setTimeout(180_000);

  let files: string[];
  beforeAll(() => {
    files = scopedFiles();
  });

  it('passes: no Business OS call site writes its own model or temperature', () => {
    expect(scanFiles(files)).toEqual([]);
  });

  it('covers every area that resolves settings', () => {
    // One representative site per area. If a file is renamed, update this list
    // — do not delete the entry; an area with no checked call site is the hole
    // this gate exists to close.
    expect(files).toEqual(
      expect.arrayContaining([
        'lib/business-os/bizql/planner/Planner.ts', // chat
        'lib/business-os/insight/repository/InsightRepository.ts', // insights
        'lib/business-os/briefing/BriefingNarrator.ts', // briefing
        'lib/services/WebsiteAIContentService.ts', // website
        'lib/services/IntakeGenerationService.ts', // intake
        'lib/business-os/leads/LeadReplyRecommender.ts', // leads
        'lib/services/GeneratedImageService.ts', // images
        'lib/services/OnboardingConversationManager.ts', // onboarding
      ])
    );
  });

  it('contains no test file and no generated file, and exactly one script', () => {
    expect(files.filter((rel) => isTestFile(rel))).toEqual([]);
    expect(files.filter((rel) => rel.startsWith('.next/') || rel.startsWith('.claude/'))).toEqual([]);
    // The one script that imports the catalog is in scope, and exempt by name.
    expect(files.filter((rel) => rel.startsWith('scripts/'))).toEqual([SETTINGS_SCRIPT]);
  });

  it('leaves the two chat paths that choose their own model out of scope, as decided', () => {
    // DEC-11 / F-13 / V-4: neither imports the catalog; both are stopped by the
    // chat kill switch instead. If either is ever wired to settings it joins
    // this scope automatically, and this expectation is what says so.
    expect(files).not.toContain('lib/business-os/IntentParser.ts');
    expect(files.filter((rel) => rel.endsWith('AIDataLayerService.ts'))).toEqual([]);
  });
});

/**
 * The inclusion list gets the same discipline as the exemption list.
 *
 * `EXEMPTIONS` is capped by equality above, so a third entry fails the suite
 * deliberately. `LITERAL_SCOPE_INCLUSIONS` is the symmetric lever - it decides
 * what the gate DOES cover - and shipped without either guard. Two ways it
 * could rot silently:
 *
 *   - an unnoticed entry widening the gate's surface unreviewed;
 *   - an entry naming a file that no longer exists, which quietly becomes a
 *     no-op and drops the file it covered back OUT of scope with a green gate
 *     - the precise failure the inclusion list was written to prevent.
 *
 * The properties below are proved against a FIXTURE, through the injectable
 * argument `literalScope` and `staleInclusions` both take, so the machinery
 * stays proven independently of what the real list happens to hold. The one
 * thing a fixture cannot prove - that the real entry pulls a real file in -
 * is asserted directly, here, in the change that adds that entry.
 */
describe('the scope inclusions', () => {
  // A path that is deliberately NOT in the repository. It reaches the catalog
  // one hop away in the fixture graph, which is the shape a real inclusion
  // exists for.
  const FIXTURE = 'app/api/admin/__fixture__/one-hop-away/route.ts';
  const FIXTURE_INCLUSIONS = [
    { file: FIXTURE, reason: 'fixture: reaches the catalog one hop away, so the direct-import rule misses it' },
  ];

  const ADMIN_ROUTE = 'app/api/admin/business-os/llm-settings/route.ts';

  it('names exactly one file, with a reason', () => {
    // Mirrors the EXEMPTIONS cap: the list's contents are pinned by equality,
    // so a SECOND entry fails this assertion and arrives with a review rather
    // than as a config line. Scope only ever grows here, on purpose, and
    // growth must be visible.
    expect(LITERAL_SCOPE_INCLUSIONS.map((entry) => entry.file)).toEqual([ADMIN_ROUTE]);
    for (const entry of LITERAL_SCOPE_INCLUSIONS) {
      expect(entry.reason.length).toBeGreaterThan(20);
    }
  });

  it('the real entry actually pulls the real route into scope', () => {
    // The one property a fixture cannot prove, asserted in the change that
    // adds the entry: the named path matches a file the walk really finds.
    expect(scopedFiles()).toContain(ADMIN_ROUTE);
    expect(staleInclusions(scopedFiles())).toEqual([]);
  });

  it('an entry is not decorative: it actually pulls its file into scope', () => {
    const graph = new Map<string, FileImports>([
      [CATALOG, { imports: new Set<string>() }],
      [FIXTURE, { imports: new Set<string>(['lib/business-os/llm/adminSettingsView.ts']) }],
    ]);

    expect(literalScope(graph, FIXTURE_INCLUSIONS)).toContain(FIXTURE);
  });

  it('an entry is load-bearing: its file does NOT reach scope by the direct-import rule', () => {
    // The counterfactual. If a real included file ever starts importing the
    // catalog directly, its entry can be retired rather than left to rot.
    const graph = new Map<string, FileImports>([
      [CATALOG, { imports: new Set<string>() }],
      [FIXTURE, { imports: new Set<string>(['lib/business-os/llm/adminSettingsView.ts']) }],
    ]);

    const withoutInclusion = [...graph.entries()]
      .filter(([rel, imports]) => !isTestFile(rel) && (rel === CATALOG || imports.imports.has(CATALOG)))
      .map(([rel]) => rel);

    expect(withoutInclusion).not.toContain(FIXTURE);
    expect(literalScope(graph, FIXTURE_INCLUSIONS)).toContain(FIXTURE);
  });

  it('reports an inclusion naming a file that is not in scope, so a rename cannot go green', () => {
    // The real list is clean - vacuously so while it is empty, and this keeps
    // holding as entries arrive.
    expect(staleInclusions(scopedFiles())).toEqual([]);

    // A scope that has LOST the file is detected rather than ignored. This is
    // the assertion that makes the guard a guard, and it is proved here
    // independently of whether a real entry exists yet.
    expect(staleInclusions([CATALOG], FIXTURE_INCLUSIONS)).toEqual([FIXTURE]);

    // ...and an entry whose file IS in scope is not reported.
    expect(staleInclusions([CATALOG, FIXTURE], FIXTURE_INCLUSIONS)).toEqual([]);
  });

  it('can only ever ADD files: the predicate gained a disjunct, so scope cannot shrink', () => {
    const graph = new Map<string, FileImports>([
      [CATALOG, { imports: new Set<string>() }],
      ['lib/business-os/llm/someCallSite.ts', { imports: new Set<string>([CATALOG]) }],
    ]);

    const direct = [CATALOG, 'lib/business-os/llm/someCallSite.ts'].sort();

    // Nothing an inclusion can do removes a direct importer - with the real
    // (empty) list, or with a fixture that names an unrelated file.
    expect(literalScope(graph)).toEqual(direct);
    expect(literalScope(graph, FIXTURE_INCLUSIONS)).toEqual(direct);
  });
});
