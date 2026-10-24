import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/*
 * A client component must not import a server-only module.
 *
 * `lib/supabaseServer.ts` calls `createClient` with the SERVICE ROLE key at
 * module load. That key is not `NEXT_PUBLIC_`, so in a browser it is undefined
 * and the call throws `supabaseKey is required` — as an unhandled runtime
 * error, on whatever page happened to render.
 *
 * It reached three client components by accident: a pure gap→settings-tab
 * mapping was added to `journeyReadiness.ts`, which imports `supabaseServer` at
 * module level. Importing one function from a module imports the module. The
 * mapping now lives in `journeyGapFix.ts`, which has no I/O in it.
 *
 * A source-level guard because the failure is invisible until a browser runs
 * it: every one of those files type-checked, compiled and passed its tests.
 */

const ROOT = join(__dirname, '..', '..', '..');

/** Modules that construct a service-role client, or transitively reach one. */
const SERVER_ONLY = [
  '@/lib/supabaseServer',
  '@/lib/business-os/journeyReadiness',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (entry.endsWith('.tsx')) out.push(path);
  }
  return out;
}

describe('server-only modules stay out of client bundles', () => {
  it('no "use client" file imports one', () => {
    const offenders: string[] = [];

    for (const file of [...walk(join(ROOT, 'components')), ...walk(join(ROOT, 'app'))]) {
      const source = readFileSync(file, 'utf-8');
      if (!/^['"]use client['"]/m.test(source)) continue;

      for (const module of SERVER_ONLY) {
        // `import type` is erased at build, so it is not a runtime edge.
        const runtimeImport = new RegExp(`import\\s+(?!type\\s)[^;]*from\\s+['"]${module}['"]`);
        if (runtimeImport.test(source)) {
          offenders.push(`${file.replace(ROOT + '/', '')} → ${module}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS GUARD STILL CANNOT SEE, AND WHY IT IS WRITTEN DOWN RATHER THAN BUILT
 *
 * `SERVER_ONLY` is hand-maintained, so this only catches a client file
 * importing a module somebody remembered to list. It does not follow chains.
 *
 * That gap is not theoretical. `JourneyGapNotice` imported `journeyReadiness`
 * for a single type guard and took the service-role client into the browser
 * bundle with it, which stopped the platform loading — and the module WAS on
 * the list. The failure was that the sweep which would have reported it was
 * never run, because the test selection had been narrowed to named files.
 *
 * A transitive version was attempted and is deliberately NOT here: a first cut
 * reported twenty chains, a mixture of genuine pre-existing leaks (a client
 * component importing `CRMPipelineStagesRepository`, which rule 1 forbids) and
 * false positives from import-statement parsing. Shipping it would have meant a
 * permanently red test nobody trusts. It is worth doing properly — resolving
 * imports with the TypeScript program rather than a regex, and triaging what it
 * finds — as its own piece of work.
 * ─────────────────────────────────────────────────────────────────────────────
 */
