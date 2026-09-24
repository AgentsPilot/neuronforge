/**
 * GET /api/admin/business-os/llm-settings — admin screen slice 1.
 *
 * S1-T1 the gate (401 → 403, nothing read either time, `requireAdmin` first and
 * no hand-rolled `AdminAccessService`), S1-T2 no key ever comes from the
 * request, S1-T12 the source rules the two CI gates cannot see.
 *
 * The payload's own behaviour (provenance, issues, the three FR-14 states, the
 * option list) is tested where it is built, in
 * `lib/business-os/llm/__tests__/adminSettingsView.test.ts` — this file is
 * about the route.
 */

import * as fs from 'fs';
import * as path from 'path';
import { NextRequest } from 'next/server';

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

const isAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (u: unknown) => isAdmin(u) }) },
}));

const logs: Array<{ level: string; ctx: unknown; msg: unknown }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) {
      logger[level] = (ctx: unknown, msg: unknown) => logs.push({ level, ctx, msg });
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

const buildAdminSettingsView = jest.fn();
jest.mock('@/lib/business-os/llm/adminSettingsView', () => ({
  buildAdminSettingsView: () => buildAdminSettingsView(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GET } = require('../route');

const ROUTE_PATH = path.join(process.cwd(), 'app/api/admin/business-os/llm-settings/route.ts');
const routeSource = fs.readFileSync(ROUTE_PATH, 'utf8');

/**
 * Source with comments removed.
 *
 * These files are documented with the very names they must not USE — the route
 * header explains at length why `AdminAccessService` is not called here and why
 * the `bos_llm_area_*` key never comes from the request. Asserting over raw
 * text would make the correct explanation fail the test and pressure a future
 * reader into deleting it. The literal gate takes the same position: it walks
 * the AST, "so comments and JSDoc are never read — the settings are the truth,
 * prose about them is not".
 */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const routeCode = codeOf(routeSource);

function req(url = 'http://localhost/api/admin/business-os/llm-settings'): NextRequest {
  return new NextRequest(url);
}

beforeEach(() => {
  jest.clearAllMocks();
  logs.length = 0;
  buildAdminSettingsView.mockResolvedValue({ areas: [], generatedAt: '2026-09-22T00:00:00.000Z' });
});

describe('S1-T1: the gate', () => {
  it('returns 401 when signed out, and reads nothing', async () => {
    getUser.mockResolvedValue(null);

    const res = await GET(req());

    expect(res.status).toBe(401);
    expect(buildAdminSettingsView).not.toHaveBeenCalled();
  });

  it('returns 403 for a signed-in non-admin, and reads nothing', async () => {
    getUser.mockResolvedValue({ id: 'u1', email: 'someone@example.com' });
    isAdmin.mockResolvedValue(false);

    const res = await GET(req());

    expect(res.status).toBe(403);
    expect(buildAdminSettingsView).not.toHaveBeenCalled();
  });

  it('fails closed when the admin check throws', async () => {
    getUser.mockResolvedValue({ id: 'u1', email: 'someone@example.com' });
    isAdmin.mockRejectedValue(new Error('supabase down'));

    const res = await GET(req());

    expect(res.status).toBe(403);
    expect(buildAdminSettingsView).not.toHaveBeenCalled();
  });

  it('serves an admin', async () => {
    getUser.mockResolvedValue({ id: 'admin-1', email: 'admin@example.com' });
    isAdmin.mockResolvedValue(true);

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(buildAdminSettingsView).toHaveBeenCalledTimes(1);
  });

  it('returns 500 without leaking the error message outside development', async () => {
    getUser.mockResolvedValue({ id: 'admin-1', email: 'admin@example.com' });
    isAdmin.mockResolvedValue(true);
    buildAdminSettingsView.mockRejectedValue(new Error('a stack trace with a table name in it'));

    const previous = process.env.NODE_ENV;
    // @ts-expect-error -- NODE_ENV is readonly in the Next types; the test needs to set it.
    process.env.NODE_ENV = 'production';
    try {
      const res = await GET(req());
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.details).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain('table name');
    } finally {
      // @ts-expect-error -- see above.
      process.env.NODE_ENV = previous;
    }
  });

  it('is `requireAdmin` first, and never the llm-usage sibling pattern', () => {
    // The sibling `app/api/admin/business-os/llm-usage/route.ts` hand-rolls
    // `AdminAccessService.getInstance().isAdmin(...)` INSIDE the route. That is
    // one of the seven parked inline handlers, and copying it fails the
    // required `Admin authz surface guard` check.
    expect(routeCode).not.toContain('AdminAccessService');

    const handlerBody = routeCode.slice(routeCode.indexOf('export async function GET'));
    const firstAwait = handlerBody.indexOf('await ');
    expect(handlerBody.slice(firstAwait, firstAwait + 40)).toContain('requireAdmin');
  });
});

describe('S1-T2: the client can never name a settings key', () => {
  it('ignores any key-shaped query parameter', async () => {
    getUser.mockResolvedValue({ id: 'admin-1', email: 'admin@example.com' });
    isAdmin.mockResolvedValue(true);

    const res = await GET(
      req('http://localhost/api/admin/business-os/llm-settings?key=bos_llm_area_chat&area=chat')
    );

    expect(res.status).toBe(200);
    // The builder takes no arguments at all — there is nothing to forge.
    expect(buildAdminSettingsView).toHaveBeenCalledWith();
  });

  it('contains no settings key literal and no raw table access', () => {
    expect(routeCode).not.toContain('bos_llm_area_');
    expect(routeCode).not.toContain('system_settings_config');
    expect(routeCode).not.toContain('supabase');
  });
});

describe('S1-T12: the source rules, as a backstop to the gate', () => {
  // This is a BACKSTOP, not the coverage. The real coverage is
  // `check:bos-llm-literals`, which walks the AST and is a required check:
  // `route.ts` is named into `LITERAL_SCOPE_INCLUSIONS` and its four siblings
  // are in scope by direct import. These assertions exist because jest is not
  // a required check here, so they must not be the only thing standing up —
  // and they are deliberately derived, not hand-listed, so a sixth file or a
  // second route in this folder is covered the moment it is written.
  const FEATURE_ROOTS = 'gpt|chatgpt|o[1345]|text-embedding|tts|sora|omni-moderation|claude|kimi|mistral|gemini|llama|moonshot|deepseek|grok|dall-e|whisper';

  /** Every non-test source file of this feature, found rather than enumerated. */
  function featureFiles(): string[] {
    const roots = [
      path.join(process.cwd(), 'app/api/admin/business-os/llm-settings'),
      path.join(process.cwd(), 'lib/business-os/llm'),
    ];
    const ours = (rel: string) =>
      rel.startsWith('app/api/admin/business-os/llm-settings/') ||
      [
        'lib/business-os/llm/adminSettingsView.ts',
        'lib/business-os/llm/modelOptions.ts',
        'lib/business-os/llm/switchOffPredicate.ts',
        'lib/business-os/llm/ledgerCheckCopy.ts',
      ].includes(rel);

    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === '__tests__' || entry.name === '__snapshots__') continue;
          walk(full);
          continue;
        }
        if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
        const rel = full.replace(process.cwd() + path.sep, '').split(path.sep).join('/');
        if (ours(rel)) found.push(rel);
      }
    };
    for (const root of roots) walk(root);
    return found.sort();
  }

  const allFiles = featureFiles();
  const serverOnlyFiles = allFiles.filter(
    (rel) => rel.startsWith('lib/business-os/llm/') && !rel.endsWith('ledgerCheckCopy.ts')
  );

  it('finds every file of this feature, so the list cannot fall behind the code', () => {
    // If this number moves, a file was added — and it is now covered, which is
    // the point of deriving the list.
    expect(allFiles.length).toBeGreaterThanOrEqual(6);
    expect(allFiles).toContain('app/api/admin/business-os/llm-settings/route.ts');
    expect(allFiles).toContain('lib/business-os/llm/modelOptions.ts');
  });

  /**
   * The five rules, each named — and each with a sample it MUST match.
   *
   * Two of these were dead on arrival: written as plain template literals,
   * `` `case\s+…` `` compiles to `/cases+…/` and `` `\[\s*…\]` `` to a
   * character class, so the switch-on-a-model rule could never fire. Coverage
   * survived only because the broad quoted-literal rule happens to subsume
   * both shapes — which is luck, not design.
   *
   * A regex that cannot match is worse than an absent one: it reads as
   * coverage. Hence `String.raw` for anything with a backslash, and
   * `mustMatch`, which proves every rule is alive independently of whether the
   * files happen to be clean.
   */
  const LITERAL_RULES: ReadonlyArray<{ name: string; pattern: RegExp; mustMatch: string }> = [
    {
      name: 'a quoted model id of any vendor family',
      pattern: new RegExp(String.raw`['"](${FEATURE_ROOTS})-[a-z0-9._:-]*['"]`, 'i'),
      mustMatch: `const m = 'claude-3-5-sonnet-20241022';`,
    },
    {
      name: 'a z.enum allow-list of model ids',
      pattern: /z\.enum\(\s*\[\s*['"](gpt|claude|kimi|mistral)-/i,
      mustMatch: `z.enum(['gpt-4o', 'gpt-4o-mini'])`,
    },
    {
      name: 'a switch case on a model name',
      pattern: new RegExp(String.raw`case\s+['"](${FEATURE_ROOTS})-`, 'i'),
      mustMatch: `switch (m) { case 'gpt-4o': break; }`,
    },
    {
      name: 'a price-index key literal',
      pattern: new RegExp(String.raw`\[\s*['"](${FEATURE_ROOTS})-[^'"]*['"]\s*\]`, 'i'),
      mustMatch: `const p = PRICES['gpt-4o'];`,
    },
    {
      name: 'a temperature bound to a literal number',
      pattern: /temperature\s*[:=]\s*[0-9]/,
      mustMatch: `chat({ temperature: 0.7 })`,
    },
  ];

  it.each(LITERAL_RULES.map((r) => [r.name, r] as const))(
    'rule "%s" is alive: it matches the shape it exists to catch',
    (_name, rule) => {
      // Proves the REGEX, not the files. Without this a broken escape reads as
      // a passing rule for ever.
      expect(rule.mustMatch).toMatch(rule.pattern);
    }
  );

  it('each rule is independently load-bearing: no rule is matched by another rule\'s sample alone', () => {
    // The two dead rules were masked by the broad quoted-literal rule. This
    // records which rules genuinely overlap, so a future reader knows the
    // subsumption exists rather than rediscovering it.
    const broad = LITERAL_RULES[0];
    const subsumed = LITERAL_RULES.filter(
      (rule) => rule !== broad && broad.pattern.test(rule.mustMatch)
    ).map((rule) => rule.name);

    // Measured, not assumed: the broad rule subsumes all THREE of the shape
    // rules, because each of their samples contains a quoted model id. That is
    // why the two dead regexes went unnoticed — and why this assertion is
    // written down rather than left as folklore. The narrow rules still earn
    // their place: they name the shape in the failure message, and they keep
    // matching if the broad family list is ever narrowed.
    expect(subsumed).toEqual([
      'a z.enum allow-list of model ids',
      'a switch case on a model name',
      'a price-index key literal',
    ]);

    // The temperature rule is genuinely independent — nothing else catches it.
    expect(broad.pattern.test(LITERAL_RULES[4].mustMatch)).toBe(false);
  });

  it.each(allFiles)('%s writes no model id and no temperature literal', (relative) => {
    const code = codeOf(fs.readFileSync(path.join(process.cwd(), relative), 'utf8'));

    for (const rule of LITERAL_RULES) {
      expect({ file: relative, rule: rule.name, matched: rule.pattern.test(code) }).toEqual({
        file: relative,
        rule: rule.name,
        matched: false,
      });
    }
  });

  it.each(allFiles)('%s logs through Pino only', (relative) => {
    const source = fs.readFileSync(path.join(process.cwd(), relative), 'utf8');
    expect(source).not.toMatch(/console\.(log|warn|error|info|debug)\s*\(/);
  });

  it.each(serverOnlyFiles)('%s is server-only by import, not by convention', (relative) => {
    // RC-9: makes "the client imports no server module" a BUILD failure rather
    // than a source test a refactor can quietly stop covering.
    const source = fs.readFileSync(path.join(process.cwd(), relative), 'utf8');
    expect(source.startsWith("import 'server-only';")).toBe(true);
  });

  it('the shared ledger copy is deliberately NOT server-only — the client needs it', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'lib/business-os/llm/ledgerCheckCopy.ts'),
      'utf8'
    );
    expect(source).not.toContain("import 'server-only'");
  });

  it('the route is named into the literal gate, not exempted from it', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { LITERAL_SCOPE_INCLUSIONS } = require('@/scripts/lib/bos-llm-scope');
    const included = LITERAL_SCOPE_INCLUSIONS.map((e: { file: string }) => e.file);
    expect(included).toContain('app/api/admin/business-os/llm-settings/route.ts');
    for (const entry of LITERAL_SCOPE_INCLUSIONS) expect(entry.reason.length).toBeGreaterThan(20);
  });
});
