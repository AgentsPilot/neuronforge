/**
 * FR-12 — no application code branches on a tier name.
 *
 * This is the invariant that keeps the one-line promise honest. If a route ever
 * says `if (tier === 'pro')`, then moving a capability between plans stops being
 * a config edit and becomes a code change — and the next person to move one will
 * not know that route exists.
 *
 * So: tier names may appear in `entitlements/config/**` and in the fixture, and
 * nowhere else. The repository already contains a handful of unrelated
 * occurrences ('pro' as a model suffix, 'basic' as a plan word in the agent
 * platform), which are baselined by file with a count — the same ratchet the
 * typecheck gate uses. A NEW one fails; removing one and not lowering the
 * baseline also fails, so the list cannot rot upwards.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';

const ROOT = process.cwd();
const SCANNED = ['app', 'lib', 'components', 'hooks'];

/**
 * The names a tier could have.
 *
 * The draft names plus whatever is actually configured: if someone adds an
 * `enterprise` tier tomorrow, `if (tier === 'enterprise')` is caught from the
 * moment the tier exists, with no second list to remember.
 */
const FORBIDDEN = ['basic', 'growth', 'pro', ...(TIER_ORDER as readonly string[])];

/** Where tier names are legitimate. */
const ALLOWED_PREFIXES = [
  join('lib', 'business-os', 'entitlements', 'config'),
  join('lib', 'business-os', 'entitlements', '__fixtures__'),
  join('lib', 'business-os', 'entitlements', '__tests__'),
];

/**
 * Pre-existing, unrelated occurrences — file → count.
 *
 * Checked by equality, not `<=`: if a file is cleaned up, its entry must be
 * removed in the same change, so the baseline can only shrink deliberately.
 */
const BASELINE: Record<string, number> = {
  'app/api/enhance-prompt/route.ts': 1,
  'components/v2/analytics/AIRecommendations.tsx': 2,
  'components/v2/analytics/HeroMetricsGrid.tsx': 1,
  'components/website/blocks/StatsBlock.tsx': 1,
  'lib/intelligence/analysis/QualityValidator.ts': 1,
  'lib/intelligence/core/types.ts': 1,
  'lib/pilot/WorkflowPilot.ts': 1,
  'lib/pilot/insight/AutomationAdvisor.ts': 1,
  // 'growth' in a `subVerticalKeywords` map, beside 'marketing' and 'digital':
  // a business vertical, not a pricing tier. Same collision as the entries
  // around it — the word is ordinary English before it is a tier name.
  'lib/services/WebsiteAutoBuildService.ts': 1,
  'lib/services/OnboardingConfigurationService.ts': 1,
  'lib/services/OnboardingConversationManager.ts': 2,
  'lib/testing/GenericTestSystem.ts': 1,
};

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }

  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.next' || entry === '.claude') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Quoted occurrences of a tier name: `'pro'`, `"growth"`, `` `basic` ``. */
const PATTERN = new RegExp(`['"\`](${FORBIDDEN.join('|')})['"\`]`, 'g');

const files = SCANNED.flatMap((dir) => walk(join(ROOT, dir)));

function isAllowed(relativePath: string): boolean {
  return ALLOWED_PREFIXES.some((prefix) => relativePath.startsWith(prefix));
}

describe('FR-12 — tier names live in config, and nowhere else', () => {
  it('scans a non-trivial number of files', () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it('has no occurrence outside the config folder that is not baselined', () => {
    const found: Record<string, number> = {};

    for (const file of files) {
      const relativePath = relative(ROOT, file);
      if (isAllowed(relativePath)) continue;
      // The tests' own fixtures and expectations name tiers on purpose.
      if (relativePath.includes(`${sep}__tests__${sep}`) && relativePath.includes('entitlements')) continue;

      const matches = readFileSync(file, 'utf8').match(PATTERN);
      if (matches) found[relativePath.split(sep).join('/')] = matches.length;
    }

    // Diffed both ways so a failure says which side is wrong: a NEW occurrence
    // (fix the code, or justify a baseline entry in the PR), or a baselined one
    // that has gone (lower the baseline in the same change).
    const unexpected = Object.entries(found)
      .filter(([file, count]) => BASELINE[file] !== count)
      .map(([file, count]) => `${file}: ${count} (baseline ${BASELINE[file] ?? 0})`);
    const vanished = Object.keys(BASELINE).filter((file) => !(file in found));

    expect(unexpected).toEqual([]);
    expect(vanished).toEqual([]);
  });

  it('the entitlements module itself names no tier outside config', () => {
    // The sharper version of the same rule, with no baseline: this module is new
    // code, so it has no excuse.
    const offenders = files
      .map((file) => relative(ROOT, file))
      .filter((relativePath) => relativePath.startsWith(join('lib', 'business-os', 'entitlements')))
      .filter((relativePath) => !isAllowed(relativePath))
      .filter((relativePath) => PATTERN.test(readFileSync(join(ROOT, relativePath), 'utf8')));

    expect(offenders).toEqual([]);
  });
});
