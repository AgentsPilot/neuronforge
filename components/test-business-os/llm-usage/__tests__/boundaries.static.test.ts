/**
 * Static boundary checks for Layer 1.1 (AC-1 via WC-8, AC-4, AC-16).
 *
 * Reads source text, so these hold however the code is later refactored:
 * 1. The client tab imports only TYPES from server modules (RC-8).
 * 2. No direct Supabase access in the new routes, usage modules, usage route or tab.
 * 3. No hand-typed Business OS feature, known-component or helper-label literal
 *    outside the catalog.
 * 4. TokenUsageRepository imports nothing from lib/business-os (RC-7).
 * 5. The admin routes never consult the profile role or app_metadata (WC-8):
 *    AdminAccessService is the only admin signal.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../../..');

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function listDir(rel: string, filter: (name: string) => boolean): string[] {
  return fs
    .readdirSync(path.join(ROOT, rel))
    .filter(filter)
    .map((name) => `${rel}/${name}`);
}

/** Remove block and line comments (good enough for these files: no `//` inside strings that matter). */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

const CLIENT_FILES = [
  ...listDir('components/test-business-os/llm-usage', (n) => /\.(ts|tsx)$/.test(n)),
  'hooks/useLlmUsageAutoRefresh.ts',
  'hooks/llmUsageRefreshMachine.ts',
];

const ROUTES = ['app/api/admin/business-os/llm-usage/route.ts', 'app/api/admin/business-os/llm-usage/businesses/route.ts'];

const NEW_SERVER_MODULES = [
  'lib/business-os/usage/usageSummary.ts',
  'lib/business-os/usage/llmUsageReport.ts',
  'lib/business-os/usage/llmUsageVerification.ts',
  'lib/business-os/usage/llmUsageReportTypes.ts',
];

const SERVER_PREFIXES = ['@/lib/business-os/llm', '@/lib/business-os/usage', '@/lib/repositories'];

describe('Layer 1.1 boundaries', () => {
  it('finds the files it checks', () => {
    expect(CLIENT_FILES.length).toBeGreaterThanOrEqual(9);
    for (const file of [...CLIENT_FILES, ...ROUTES, ...NEW_SERVER_MODULES]) {
      expect(fs.existsSync(path.join(ROOT, file))).toBe(true);
    }
  });

  it.each(CLIENT_FILES)('%s imports only types from server modules (RC-8)', (file) => {
    const source = read(file);
    const imports = source.match(/^import[\s\S]*?from\s+['"][^'"]+['"];?$/gm) ?? [];
    for (const statement of imports) {
      const target = statement.match(/from\s+['"]([^'"]+)['"]/)?.[1] ?? '';
      if (SERVER_PREFIXES.some((prefix) => target.startsWith(prefix))) {
        expect({ file, statement, typeOnly: /^import\s+type\s/.test(statement) }).toEqual({
          file,
          statement,
          typeOnly: true,
        });
      }
    }
    // No dynamic or require-style escape hatch either.
    expect(source).not.toMatch(/(require|import)\(\s*['"]@\/lib\/(business-os|repositories)/);
  });

  it.each([...ROUTES, ...NEW_SERVER_MODULES, ...CLIENT_FILES])('%s has no direct Supabase access (AC-16)', (file) => {
    const code = stripComments(read(file));
    expect(code).not.toMatch(/supabaseServer\s*\.\s*from\s*\(/);
    expect(code).not.toMatch(/\.rpc\s*\(/);
    expect(code).not.toMatch(/createClient\s*\(/);
  });

  it('the owner usage route no longer reads token_usage directly (FR-23)', () => {
    const code = stripComments(read('app/api/business-os/usage/route.ts'));
    expect(code).not.toMatch(/token_usage/);
    expect(code).not.toMatch(/\.rpc\s*\(/);
    expect(code).not.toMatch(/createClient\s*\(/);
    // readAllowanceCredits stays in the route by FR-23 and still reads ais_system_config: the only direct read left.
    const directReads = code.match(/\.from\(\s*['"]([a-z_]+)['"]/g) ?? [];
    expect(directReads).toEqual([".from('ais_system_config'"]);
  });

  it.each([...ROUTES, ...NEW_SERVER_MODULES, ...CLIENT_FILES])(
    '%s hand-types no Business OS feature, known component or helper label (AC-4)',
    (file) => {
      const code = stripComments(read(file));
      expect(code).not.toMatch(/['"`]business-os-/);
      expect(code).not.toMatch(/['"`](BizQLPlanCache|IntentParser|simple-complete)['"`]/);
      expect(code).not.toMatch(/['"`](insight-generation|correlated-insight-generation|health-summary-generation|landing-page-generation|lead-reply)['"`]/);
    }
  );

  it('TokenUsageRepository imports nothing from lib/business-os (RC-7)', () => {
    const source = read('lib/repositories/TokenUsageRepository.ts');
    const targets = (source.match(/from\s+['"][^'"]+['"]/g) ?? []).map((m) => m.replace(/from\s+/, ''));
    expect(targets.some((t) => t.includes('business-os'))).toBe(false);
  });

  it.each(ROUTES)('%s uses AdminAccessService and never the profile role or app_metadata (WC-8)', (file) => {
    const source = read(file);
    expect(source).toMatch(/AdminAccessService\.getInstance\(\)\.isAdmin\(/);
    expect(source).not.toMatch(/profiles\.role/);
    expect(source).not.toMatch(/UserProfileRepository/);
    expect(source).not.toMatch(/app_metadata/);
    expect(source).not.toMatch(/from\(\s*['"]profiles['"]/);
    expect(source).toMatch(/export const runtime = 'nodejs'/);
    expect(source).toMatch(/export const dynamic = 'force-dynamic'/);
  });

  it('the new routes, usage modules and repository never write (FR-19)', () => {
    for (const file of [...ROUTES, ...NEW_SERVER_MODULES, 'lib/repositories/TokenUsageRepository.ts']) {
      const code = stripComments(read(file));
      expect({ file, write: /\.(insert|update|upsert|delete)\s*\(/.test(code) }).toEqual({ file, write: false });
    }
  });
});
