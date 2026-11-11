/**
 * The calendar button asks again, and says so when it cannot.
 *
 * Reported as "the new owner has no calendar in the header". The gate was
 * satisfied the whole time: seven scheduling services, every one `active`.
 * `BusinessOSHeader` lives in `app/business-os/layout.tsx`, the App Router
 * keeps a layout mounted across client-side navigation, and the check ran with
 * `[]` deps — so it was answered once, at the session's only full page load,
 * and frozen.
 *
 * On the account that reported it: signed in 17:35 with nothing published,
 * first five services at 17:41, a seventh published at 20:38, button hidden all
 * evening, back after a hard refresh.
 *
 * Two rules are pinned here, and the second is why the first took a production
 * query to find: the check must re-run, and a failure must not be silent.
 *
 * Source-level, because what matters is the dependency array and the absence of
 * an empty `catch`. A render test would have to simulate App Router navigation
 * to see either, and would pass against the frozen version.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const HEADER = readFileSync(
  join(process.cwd(), 'components', 'business-os', 'BusinessOSHeader.tsx'),
  'utf8'
);

/** The effect that decides whether the button renders. */
const effect = HEADER.slice(
  HEADER.indexOf('const pathname = usePathname()'),
  HEADER.indexOf('// Close dropdown when clicking outside')
);

describe('the scheduling check', () => {
  it('re-runs on navigation rather than once per page load', () => {
    expect(effect).toContain('}, [pathname]);');
    expect(effect).not.toContain('}, []);');
  });

  it('takes the pathname from the router, not from the window', () => {
    expect(HEADER).toContain("import { useRouter, usePathname } from 'next/navigation'");
  });

  it('ignores a reply that arrives after the route changed', () => {
    expect(effect).toContain('let cancelled = false');
    expect(effect).toContain('if (cancelled) return;');
    expect(effect).toMatch(/return \(\) => \{\s*cancelled = true;\s*\};/);
  });
});

describe('a failure is reported, not swallowed', () => {
  it('has no empty catch left', () => {
    expect(effect).not.toMatch(/catch\s*\{\s*(\/\/[^\n]*\n\s*)*\}/);
  });

  it('logs through the Pino client logger, never console (CLAUDE.md rule 3)', () => {
    expect(HEADER).toContain("import { clientLogger } from '@/lib/logger'");
    expect(effect).toContain('clientLogger.warn');
    expect(HEADER).not.toMatch(/\bconsole\.(log|warn|error|info|debug)\b/);
  });

  it('separates a bad status, a bad shape and a thrown request', () => {
    expect(effect).toContain('if (!response.ok)');
    expect(effect).toContain('!Array.isArray(data.services)');
    expect(effect).toMatch(/catch \(err\)/);
    /* Three reports, so the three causes are distinguishable in the console. */
    expect((effect.match(/clientLogger\.warn/g) ?? []).length).toBe(3);
  });
});

describe('the gate itself is unchanged', () => {
  it('is still one active service, not the stricter BOOKABLE pair', () => {
    expect(effect).toContain("service.status === 'active'");
    expect(effect).not.toContain('is_active');
  });

  it('still reads the cheap services endpoint, not /stats', () => {
    expect(effect).toContain("fetch('/api/scheduling/services')");
    expect(effect).not.toContain('business-os/stats');
  });
});
