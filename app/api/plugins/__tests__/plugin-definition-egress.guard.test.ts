/**
 * Source-level guard: no API route may serialise a plugin definition or an auth_config
 * without projecting it first.
 *
 * Closes SA residual risk R1 from the auth_config exposure fix
 * (docs/workplans/plugin-auth-config-exposure-workplan.md): the branded
 * `ClientSafeAuthConfig` type only binds where a route declares the response type, and
 * `PluginDefinitionContext.toJSON()` only covers CLASS instances. A NEW route that does
 * `NextResponse.json({ plugin: definition })` or `{ auth_config: def.plugin.auth_config }`
 * on a raw definition still compiles, still passes the runtime egress suite
 * (no-secret-egress.test.ts only knows about the routes it imports) — and still leaks the
 * env-substituted client_secret / STRIPE_SECRET_KEY.
 *
 * This is deliberately a text scan with an explicit allow-list rather than a type check:
 * it costs nothing, it covers every route file including ones nobody wrote a runtime test
 * for, and a new offender has to be added to the allow-list ON PURPOSE.
 *
 * If this test fails on YOUR new route: project the definition through
 * `toClientPluginInfo()` / `sanitizeAuthConfig()` (lib/plugins/sanitize-plugin-definition.ts)
 * or `toShortLLMContext()`. Only add an allow-list entry if the value provably never
 * reaches the response body — and say why in the entry.
 *
 * KNOWN BLIND SPOTS (SA probe) — the scan only reads the serialising call's own text, so
 * it does NOT catch:
 *   1. assign-then-serialise: `const payload = { plugin: definition }; NextResponse.json(payload)`;
 *   2. mixed payloads: `{ safe: toClientPluginInfo(...), raw: definition }` — one projection
 *      token anywhere in the expression clears the whole expression;
 *   3. `const plugins = defs.map(...); NextResponse.json({ plugins })` — which is the exact
 *      source shape of the original P0 leak in available/route.ts, i.e. as written this guard
 *      would NOT have caught the bug it memorialises.
 * A pass therefore means "no known-bad shape found", NOT "no leak possible". F14
 * (one-level variable resolution) is the tracked strengthening follow-up.
 *
 * Modelled on app/api/plugins/__tests__/dead-plugin-routes-removed.guard.test.ts.
 */

import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const API_ROOT = path.join(REPO_ROOT, 'app', 'api');

const SKIP_DIRS = new Set(['node_modules', '.next', '__tests__']);

/** Helpers that provably strip secrets. Their presence clears an occurrence. */
const PROJECTIONS = [
  'sanitizeAuthConfig',
  'sanitizePluginDefinition',
  'toClientPluginInfo',
  'toShortLLMContext',
  'toLLMContext',
];

/** Identifiers that mean "a whole plugin definition is in this expression". */
const DEFINITION_TOKENS: Array<[string, RegExp]> = [
  ['definition', /\bdefinitions?\b/],
  ['pluginDefinition', /\bpluginDefinitions?\b/],
  ['PluginDefinitionContext', /\bPluginDefinitionContext\b/],
  ['getAvailablePlugins()', /getAvailablePlugins\s*\(/],
  ['getPluginDefinition()', /getPluginDefinition\s*\(/],
  ['auth_config', /\bauth_config\b/],
];

const SERIALISERS = /(?:NextResponse\.json|Response\.json|JSON\.stringify)\s*\(/g;

/**
 * Routes that mention `auth_config` but provably never put it in a response body.
 * Each entry is a REVIEWED exception — re-verify before editing one.
 */
const AUTH_CONFIG_ALLOWLIST: Record<string, string> = {
  'app/api/plugins/fetch-options/route.ts':
    'passes pluginSchema.plugin.auth_config into userConnections.getConnection() (token refresh); never serialised',
  'app/api/plugins/refresh-token/route.ts':
    'passes the auth_config into userConnections.refreshToken(); the response carries only plugin keys',
  'app/api/plugins/user-status/route.ts':
    'projects the single scalar auth_config.auth_type, not the object',
  'app/api/v2/plugins/connect/route.ts':
    'reads auth_url / required_scopes / redirect_uri server-side to build the OAuth redirect URL',
};

// ── Analysis (pure, so the self-test can run it on a synthetic file) ──────────────────

/** Comments explain the rule; they must not trip it. */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<![:'"`])\/\/[^\n]*/g, '');
}

/** Extracts the argument text of every serialising call, with balanced parens. */
function serialisedExpressions(source: string): Array<{ line: number; expression: string }> {
  const out: Array<{ line: number; expression: string }> = [];
  SERIALISERS.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SERIALISERS.exec(source)) !== null) {
    let i = SERIALISERS.lastIndex;
    let depth = 1;
    while (i < source.length && depth > 0) {
      const c = source[i];
      if (c === '(') depth += 1;
      else if (c === ')') depth -= 1;
      i += 1;
    }
    out.push({
      line: source.slice(0, match.index).split('\n').length,
      expression: source.slice(SERIALISERS.lastIndex, i - 1),
    });
  }
  return out;
}

export interface Offence {
  file: string;
  line: number;
  token: string;
  snippet: string;
}

/** A definition/auth_config inside a response body with no projection applied. */
export function findUnprojectedResponses(file: string, rawSource: string): Offence[] {
  const source = stripComments(rawSource);
  const offences: Offence[] = [];
  for (const { line, expression } of serialisedExpressions(source)) {
    if (PROJECTIONS.some((p) => expression.includes(p))) continue;
    for (const [token, pattern] of DEFINITION_TOKENS) {
      if (pattern.test(expression)) {
        offences.push({
          file,
          line,
          token,
          snippet: expression.replace(/\s+/g, ' ').slice(0, 160),
        });
        break;
      }
    }
  }
  return offences;
}

/** A route that touches auth_config at all and has no projection helper in sight. */
export function mentionsUnprojectedAuthConfig(rawSource: string): boolean {
  const source = stripComments(rawSource);
  return source.includes('auth_config') && !PROJECTIONS.some((p) => source.includes(p));
}

// ── Corpus ────────────────────────────────────────────────────────────────────────────

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (SKIP_DIRS.has(e.name)) return [];
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return /^route\.tsx?$/.test(e.name) ? [full] : [];
  });
}

const rel = (f: string) => path.relative(REPO_ROOT, f).split(path.sep).join('/');

const ROUTES = walk(API_ROOT).map((f) => ({ file: rel(f), source: fs.readFileSync(f, 'utf-8') }));

const describeOffence = (o: Offence) =>
  `${o.file}:${o.line} serialises \`${o.token}\` unprojected — ${o.snippet}`;

describe('guard: no API route serialises a raw plugin definition', () => {
  it('scanned a plausible number of route files', () => {
    // Fail closed: "0 files scanned, 0 offenders" would be a green build proving nothing.
    expect(ROUTES.length).toBeGreaterThan(200);
  });

  it('no response body carries a definition or auth_config without a projection', () => {
    const offenders = ROUTES.flatMap((r) => findUnprojectedResponses(r.file, r.source));
    expect(offenders.map(describeOffence)).toEqual([]);
  });

  it('every route touching auth_config either projects it or is a reviewed exception', () => {
    const offenders = ROUTES.filter(
      (r) => mentionsUnprojectedAuthConfig(r.source) && !(r.file in AUTH_CONFIG_ALLOWLIST)
    ).map(
      (r) =>
        `${r.file} reads auth_config without sanitizeAuthConfig/toClientPluginInfo. ` +
        'Project it before responding, or add a reviewed AUTH_CONFIG_ALLOWLIST entry.'
    );
    expect(offenders).toEqual([]);
  });

  it('the allow-list has no stale entries', () => {
    // A stale entry silently widens the exemption for whatever lands at that path next.
    const stale = Object.keys(AUTH_CONFIG_ALLOWLIST).filter((f) => {
      const full = path.join(REPO_ROOT, f);
      return !fs.existsSync(full) || !mentionsUnprojectedAuthConfig(fs.readFileSync(full, 'utf-8'));
    });
    expect(stale).toEqual([]);
  });

  it('can actually fail: detects a synthetic regression', () => {
    const rawDefinition = `
      const definition = pluginManager.getPluginDefinition(key);
      return NextResponse.json({ success: true, plugin: definition });
    `;
    expect(findUnprojectedResponses('app/api/fake/route.ts', rawDefinition)).toHaveLength(1);

    const rawAuthConfig = `
      return NextResponse.json({ auth_config: def.plugin.auth_config });
    `;
    expect(findUnprojectedResponses('app/api/fake/route.ts', rawAuthConfig)).toHaveLength(1);
    expect(mentionsUnprojectedAuthConfig(rawAuthConfig)).toBe(true);
  });

  it('does not fire on projected responses or on comments', () => {
    const projected = `
      // never serialise the raw definition — it aliases the env-substituted auth_config
      return NextResponse.json({ plugins: defs.map((d) => toClientPluginInfo(d.key, d)) });
    `;
    expect(findUnprojectedResponses('app/api/fake/route.ts', projected)).toEqual([]);
    expect(mentionsUnprojectedAuthConfig(projected)).toBe(false);

    const commentOnly = `
      /* definition: do not return the raw auth_config here */
      return NextResponse.json({ ok: true });
    `;
    expect(findUnprojectedResponses('app/api/fake/route.ts', commentOnly)).toEqual([]);
    expect(mentionsUnprojectedAuthConfig(commentOnly)).toBe(false);
  });
});
