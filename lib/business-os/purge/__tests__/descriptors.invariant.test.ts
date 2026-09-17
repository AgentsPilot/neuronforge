/**
 * T6 / AC-45 — the structural invariant suite.
 *
 * Requirement §10.9 requires the executor to iterate ONE declarative structure,
 * and requires a unit test that fails when a descriptor is added without a
 * scope. This is that test, plus the bounds SA attached to the DEV-Q1
 * single-repository exception (B-1) and the storage-descriptor rule (C-16).
 *
 * ── The failure mode this suite is built against ───────────────────────────
 * `supabase/SQL Scripts/delete_user_by_id.sql` (since removed) declared a
 * PL/pgSQL variable named `user_id` and filtered a column named `user_id` with
 * it. Under `plpgsql.variable_conflict = use_variable` that resolves to
 * `WHERE <var> = <var>` — constantly true — and deletes every row in the table
 * for every tenant. Which of those happens is a database setting, not a
 * property of the file. Everything below exists so that shape cannot return.
 *
 * ── A note on how these assertions are written ─────────────────────────────
 * Several scan source text. Source-scanning tests have a characteristic way of
 * lying: if the scan matches nothing — a renamed file, a changed format, a
 * mangled preprocessor — every assertion over the empty set passes, and the
 * suite reports green precisely when it has stopped working. Each scanning
 * block below therefore asserts NON-VACUITY first. That is not defensive
 * padding; it is the difference between a check and a decoration.
 */

import fs from 'fs';
import path from 'path';

import {
  PURGE_DESCRIPTORS,
  STORAGE_DESCRIPTORS,
  BLOCKING_EDGES,
  TRIGGER_ORDERING,
  descriptorsForRun,
} from '../descriptors';
import type { PurgeDescriptor } from '../types';
import {
  PURGE_CAPABILITIES,
  GRANTED_CAPABILITIES,
  describeCapability,
  hasCapability,
} from '../capabilities';

const PURGE_DIR = path.join(__dirname, '..');
const API_DIR = path.join(__dirname, '..', '..', '..', '..', 'app', 'api', 'business-os', 'purge');

/** Every `.ts`/`.tsx` under a directory, recursively. Returns [] if absent. */
function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return /\.tsx?$/.test(e.name) ? [full] : [];
  });
}

const byTable = new Map<string, PurgeDescriptor>(
  PURGE_DESCRIPTORS.map((d) => [d.table, d])
);

describe('purge descriptors — structural invariants (AC-45)', () => {
  describe('the set itself', () => {
    it('is non-empty and has no duplicate tables', () => {
      expect(PURGE_DESCRIPTORS.length).toBeGreaterThan(100);
      expect(byTable.size).toBe(PURGE_DESCRIPTORS.length);
    });

    it('every descriptor has a non-global scope OR is level:never', () => {
      // The core rule. A `global` scope cannot produce a scoping predicate, so
      // a deleting descriptor carrying one would emit an unscoped DELETE.
      const offenders = PURGE_DESCRIPTORS.filter(
        (d) => d.scope.kind === 'global' && d.level !== 'never'
      ).map((d) => d.table);

      expect(offenders).toEqual([]);
    });

    it('fails when a descriptor is added without a scope (the required negative case)', () => {
      // AC-45 requires this suite to FAIL on a scope-less descriptor. Proving
      // that with a deliberately broken fixture is the only way to know the
      // assertion above can fail at all — an assertion that cannot fail is
      // indistinguishable from one that always passes.
      const broken = { table: 'x', level: 'reset', scope: { kind: 'global' } } as unknown as PurgeDescriptor;
      const check = (ds: PurgeDescriptor[]) =>
        ds.filter((d) => d.scope.kind === 'global' && d.level !== 'never');

      expect(check([broken])).toHaveLength(1);
      expect(check([...PURGE_DESCRIPTORS])).toHaveLength(0);
    });

    it('every via-scoped descriptor names a parent that itself has a descriptor', () => {
      // Otherwise the child's ownership is unresolvable: `via` means "this row
      // belongs to whoever owns the parent", and an absent parent makes that
      // sentence meaningless.
      const dangling = PURGE_DESCRIPTORS.filter(
        (d) => d.scope.kind === 'via' && !byTable.has((d.scope as { parent: string }).parent)
      ).map((d) => d.table);

      expect(dangling).toEqual([]);
    });

    it('no table is classified both deletable and never', () => {
      const never = new Set(PURGE_DESCRIPTORS.filter((d) => d.level === 'never').map((d) => d.table));
      const deleting = PURGE_DESCRIPTORS.filter((d) => d.level !== 'never').map((d) => d.table);
      expect(deleting.filter((t) => never.has(t))).toEqual([]);
    });
  });

  describe('ordering — verified against the live FK dump, not asserted', () => {
    it('knows about the blocking edges at all', () => {
      expect(BLOCKING_EDGES.length).toBeGreaterThanOrEqual(5);
      expect(TRIGGER_ORDERING.length).toBeGreaterThanOrEqual(1);
    });

    it.each(BLOCKING_EDGES.map((e) => [e.id, e.child, e.parent] as const))(
      '%s: %s is ordered before %s',
      (_id, child, parent) => {
        const c = byTable.get(child);
        const p = byTable.get(parent);

        // Both endpoints must exist, or the constraint is silently unenforced.
        expect(c).toBeDefined();
        expect(p).toBeDefined();
        expect(c!.order).toBeLessThan(p!.order);
      }
    );

    it.each(TRIGGER_ORDERING.map((t) => [t.before, t.after, t.why] as const))(
      '%s is ordered before %s (%s)',
      (before, after) => {
        expect(byTable.get(before)!.order).toBeLessThan(byTable.get(after)!.order);
      }
    );

    it('crm_activities is ordered last of everything that gets deleted', () => {
      // FR-17 / AC-22. Deleting payment_refunds fires a trigger chain that
      // writes a row into crm_activities mid-purge; ordering is the ONLY
      // mitigation, because trigger suppression is unavailable to the service
      // role (DISABLE TRIGGER is owner-only, session_replication_role is
      // superuser-only).
      const activities = byTable.get('crm_activities')!;
      const others = PURGE_DESCRIPTORS.filter(
        (d) => d.level !== 'never' && d.table !== 'crm_activities'
      );

      expect(others.length).toBeGreaterThan(0);
      for (const d of others) {
        expect(d.order).toBeLessThan(activities.order);
      }
    });

    it('descriptorsForRun returns tables in non-decreasing order for every option combination', () => {
      const levels = ['reset', 'purge'] as const;
      const bools = [false, true];
      let combinations = 0;

      for (const level of levels) {
        for (const integrations of bools) {
          for (const agents of bools) {
            for (const activityHistory of bools) {
              combinations += 1;
              const run = descriptorsForRun(level, { integrations, agents, activityHistory });
              expect(run.length).toBeGreaterThan(0);
              for (let i = 1; i < run.length; i += 1) {
                expect(run[i].order).toBeGreaterThanOrEqual(run[i - 1].order);
              }
              // No `never` row may ever reach a run.
              expect(run.filter((d) => d.level === 'never')).toEqual([]);
            }
          }
        }
      }

      expect(combinations).toBe(16);
    });

    it('the blocking edges hold inside the runs that actually include them', () => {
      // B6 and B7 live in the off-by-default agents option, so a default run
      // never exercises them — which is exactly why C-28 makes the agents-on
      // sweep a hard gate. Assert them in the configuration that contains them.
      const run = descriptorsForRun('purge', {
        integrations: true,
        agents: true,
        activityHistory: true,
      });
      const position = new Map(run.map((d, i) => [d.table, i]));

      for (const edge of BLOCKING_EDGES) {
        if (!position.has(edge.child) || !position.has(edge.parent)) continue;
        expect(position.get(edge.child)!).toBeLessThan(position.get(edge.parent)!);
      }

      // Non-vacuity: this run must actually contain the agents-only edges.
      expect(position.has('agent_logs')).toBe(true);
      expect(position.has('agent_scheduler_state')).toBe(true);
    });
  });

  describe('the portable-row prohibition (§8.2)', () => {
    it('business_chat_plan_cache is present and user_id-scoped', () => {
      const d = byTable.get('business_chat_plan_cache');
      expect(d).toBeDefined();
      expect(d!.scope.kind).toBe('user_id');
    });

    it('the portable-row table is equality-scoped in the structure, not just in prose', () => {
      // Rows WHERE user_id IS NULL are portable and shared by every tenant, so
      // the predicate must stay equality. The danger is not today's code — it is
      // a future "tidy-up" rewriting `user_id = p_user_id` as an exclusion,
      // which would delete every other tenant's portable rows.
      //
      // Asserted as a PROPERTY of the descriptor rather than by scanning this
      // file's text. A text scan for 'IS DISTINCT FROM' matches `descriptors.ts`
      // documenting the prohibition — the same self-matching bug that broke the
      // tombstone assertions (F-22). That one failed closed rather than open, so
      // it was merely wrong rather than dangerous, but a checker that trips on
      // its own documentation is not a checker.
      //
      // The forbidden SQL can only ever appear in the phase-2 RPC, so the
      // syntax-level prohibition is asserted there, against the migration
      // source, by T9's own test — not here.
      const d = byTable.get('business_chat_plan_cache')!;
      expect(d.scope).toEqual({ kind: 'user_id' });
      expect(d.level).not.toBe('never');
    });
  });

  describe('storage descriptors (C-16)', () => {
    it('exist, and cover the content buckets', () => {
      const buckets = STORAGE_DESCRIPTORS.map((s) => s.bucket);
      expect(buckets).toContain('contact-documents');
      expect(buckets).toContain('website-images');
      expect(new Set(buckets).size).toBe(buckets.length);
    });

    it('the snapshot bucket is never emptied by a purge', () => {
      // Deleting the forensic artefact as part of the act it records would
      // defeat its purpose.
      const snap = STORAGE_DESCRIPTORS.find((s) => s.bucket === 'business-purge-snapshots');
      expect(snap).toBeDefined();
      expect(snap!.level).toBe('never');
    });

    it('every storage descriptor is scoped by the user folder prefix', () => {
      for (const s of STORAGE_DESCRIPTORS) {
        expect(s.pathPrefix).toContain('{user_id}');
      }
    });
  });

  describe('B-1 — the single-Supabase-importer bound on the DEV-Q1 exception', () => {
    const files = [...walk(PURGE_DIR), ...walk(API_DIR)].filter((f) => !f.includes('__tests__'));

    const SUPABASE_TOKENS = [
      '@supabase/supabase-js',
      '@supabase/ssr',
      '@/lib/supabaseServer',
      '@/lib/supabaseClient',
      '@/lib/supabaseServerAuth',
      'createClient(',
    ];

    it('scanned the files it is supposed to scan', () => {
      // Non-vacuity. If `walk` returns nothing — a moved directory, a renamed
      // extension — every assertion below passes over the empty set and the
      // bound silently stops being enforced.
      //
      // Asserted by NAME rather than by count: a count threshold has to be
      // revised every time the engine gains a file, and the revision is exactly
      // the moment someone lowers it to make the suite green. Naming the files
      // that must be present grows naturally and cannot be tuned away.
      const names = files.map((f) => path.basename(f));
      expect(names).toEqual(expect.arrayContaining(['descriptors.ts', 'types.ts', 'purgeAuthz.ts']));
    });

    it('no file in the purge engine or its routes imports a Supabase client', () => {
      // SA's B-1: the DEV-Q1 exception is a GRANULARITY choice inside the
      // repository layer, not a layering waiver. Without this assertion it
      // quietly becomes "direct Supabase wherever convenient", which is the
      // thing the user's standing preference exists to stop.
      const offenders = files.filter((f) => {
        const src = fs.readFileSync(f, 'utf-8');
        return SUPABASE_TOKENS.some((t) => src.includes(t));
      });

      expect(offenders.map((f) => path.basename(f))).toEqual([]);
    });
  });

  describe('B-2 — table names live only in descriptors.ts', () => {
    const engineFiles = walk(PURGE_DIR).filter(
      (f) => !f.includes('__tests__') && !f.endsWith('descriptors.ts')
    );

    it('scanned a non-empty set of files', () => {
      expect(engineFiles.length).toBeGreaterThan(1);
    });

    it('no engine file hard-codes an in-scope table name in a query position', () => {
      // `.from('<table>')` is the shape that matters — a table name in prose or
      // a comment is documentation, not a leak. Restricting the match to the
      // query position keeps this assertion about the property it cares about
      // rather than about how people write comments.
      const offenders: string[] = [];

      for (const f of engineFiles) {
        const src = fs.readFileSync(f, 'utf-8');
        for (const match of src.matchAll(/\.from\(\s*['"]([a-z0-9_]+)['"]/g)) {
          offenders.push(`${path.basename(f)}: .from('${match[1]}')`);
        }
      }

      expect(offenders).toEqual([]);
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Slicing invariants (SA-S1 / SA-S2 / SA-S3)
//
// These exist because the feature is being delivered in slices, and slicing
// introduces a failure mode the earlier assertions cannot see: completeness
// (AC-37) is measured on the CLASSIFICATION axis, while a sliced build executes
// on a CAPABILITY axis. If those axes are ever mixed, a table can be both
// "classified" and "silently skipped" at the same time, and every existing
// check still reports green.
// ────────────────────────────────────────────────────────────────────────────

describe('SA-S1 — capability filters operations, never tables', () => {
  it('the descriptor module does not import capabilities at all', () => {
    // The strongest available form of this assertion. If `descriptors.ts`
    // cannot SEE the capability set, no capability term can influence which
    // tables are resolved — the property holds by construction rather than by
    // the current implementation happening to be correct.
    const source = fs.readFileSync(path.join(PURGE_DIR, 'descriptors.ts'), 'utf-8');

    // Matched as an IMPORT, not as a bare word. `user_capabilities` and
    // `user_capability_blocks` are real tables with real descriptors, so a
    // substring check for "capabilit" reports a violation against correct code
    // — which is the F-22 self-matching class again, and it fired here on the
    // first run. Assert the dependency, not the vocabulary.
    expect(source).not.toMatch(/from\s+['"]\.\/capabilities['"]/);
    expect(source).not.toMatch(/import\s+[\s\S]{0,200}?PurgeCapability/);
    expect(source).not.toContain('GRANTED_CAPABILITIES');
    expect(source).not.toContain('hasCapability');
  });

  it('the resolved table list is reproducible from level and options alone', () => {
    // Recomputed here INDEPENDENTLY rather than by calling `descriptorsForRun`
    // twice — comparing a function against itself would pass no matter what it
    // did. This mirror is deliberately written from the level semantics only,
    // with no capability term anywhere in it.
    const mirror = (
      level: 'reset' | 'purge',
      options: { integrations: boolean; agents: boolean; activityHistory: boolean }
    ): string[] =>
      PURGE_DESCRIPTORS.filter((d) => {
        if (d.level === 'never') return false;
        if (d.level === 'reset') return true;
        if (d.level === 'purge') return level === 'purge';
        const key = d.level.slice('optional:'.length) as keyof typeof options;
        return options[key];
      })
        .map((d) => d.table)
        .sort();

    for (const level of ['reset', 'purge'] as const) {
      for (const integrations of [false, true]) {
        for (const agents of [false, true]) {
          for (const activityHistory of [false, true]) {
            const opts = { integrations, agents, activityHistory };
            const resolved = descriptorsForRun(level, opts).map((d) => d.table).sort();

            expect(resolved).toEqual(mirror(level, opts));
          }
        }
      }
    }
  });

  it('granting or revoking a capability cannot change the resolved tables', () => {
    // The behavioural counterpart. `descriptorsForRun` takes no capability
    // argument, so there is nowhere for one to enter; this asserts the signature
    // itself, which is what a future refactor would have to break first.
    expect(descriptorsForRun.length).toBe(2); // (level, options) — and nothing else
  });
});

describe('SA-S2 — the capability set is exhaustive', () => {
  it('every capability has a description (compile-time exhaustiveness, checked at runtime too)', () => {
    for (const capability of PURGE_CAPABILITIES) {
      expect(() => describeCapability(capability)).not.toThrow();
      expect(describeCapability(capability).length).toBeGreaterThan(0);
    }
  });

  it('destructive and snapshot operations are reachable from exactly one orchestrator', () => {
    // Slice 2 is the first slice that GRANTS deletion, so the slice 1 assertion
    // ("nothing destructive is granted") is retired here and replaced with a
    // stronger structural one: these operations may be CALLED from exactly one
    // file.
    //
    // Every guard — the RPC-existence probe, both controls, the verified
    // snapshot — lives in `ResetService`. A second caller is a path that skips
    // all of them and looks perfectly reasonable in isolation.
    //
    // M-2: `writeVerifiedSnapshot` is in this list too, for the same reason. It
    // already HAD a second caller — a phase-1 demonstration route that wrote a
    // full business snapshot without ever checking the function existed — and
    // this assertion, had it covered snapshots, would have caught it.
    //
    // C-36: the scan covers ALL of `app/` and `lib/`, not just the purge
    // directories. A second caller dropped into `app/api/admin/**` — where the
    // routes are unauthenticated — would pass a scan scoped to the feature
    // folders, and that is exactly the directory most worth watching.
    const REPO = path.join(__dirname, '..', '..', '..', '..');
    const everywhere = [...walk(path.join(REPO, 'app')), ...walk(path.join(REPO, 'lib'))].filter(
      (f) => !f.includes(`${path.sep}__tests__${path.sep}`) && !f.includes('node_modules')
    );

    // Non-vacuity: a scan that silently found nothing would pass every
    // assertion below. Same failure as the comment-stripper, one level up.
    expect(everywhere.length).toBeGreaterThan(500);

    /**
     * Files that CALL `method`, in any form.
     *
     * E-1: the first version matched only `.method(` and `await method(`, and QA
     * proved two bypasses with planted callers — a bare `return method(...)`
     * with no `await`, and a direct call to the repository's own write. Both got
     * past it. So this now matches `method(` in ANY position and removes the
     * things that are not calls instead:
     *
     *   * comments — stripped LINE-FIRST (block-first lets a `/*` inside a line
     *     comment swallow real code, which failed OPEN elsewhere in this cycle);
     *   * definitions — `async method(`, `function method(`, and class-method
     *     heads, which contain `method(` without being a call.
     *
     * Erring toward matching is deliberate. A false positive costs a look; a
     * false negative is a second path to the delete that skips every guard.
     */
    const stripComments = (src: string) =>
      src.replace(/^[ \t]*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

    const callers = (method: string) =>
      everywhere
        .filter((f) => {
          const code = stripComments(fs.readFileSync(f, 'utf-8'))
            // Remove definitions so a declaration is not counted as a call.
            .replace(new RegExp(`\\b(?:async\\s+|function\\s+)${method}\\s*\\(`, 'g'), '');
          return new RegExp(`\\b${method}\\s*\\(`).test(code);
        })
        .map((f) => path.relative(REPO, f).split(path.sep).join('/'))
        .sort();

    expect(callers('executePurge')).toEqual(['lib/business-os/purge/ResetService.ts']);
    expect(callers('removeStorageUnderUser')).toEqual(['lib/business-os/purge/ResetService.ts']);
    expect(callers('writeVerifiedSnapshot')).toEqual(['lib/business-os/purge/ResetService.ts']);

    // E-1: the repository's own write, one level below the orchestrator. A caller
    // that skipped `writeVerifiedSnapshot` and wrote directly would also skip
    // the read-back verification — not just the guards.
    expect(callers('writeSnapshot')).toEqual(['lib/business-os/purge/SnapshotWriter.ts']);

    expect(hasCapability('delete_rows')).toBe(true);
    expect(hasCapability('delete_storage')).toBe(true);
    expect([...GRANTED_CAPABILITIES].sort()).toEqual([...PURGE_CAPABILITIES].sort());
  });

  it('no user-facing copy claims deletion is impossible', () => {
    // The same failure has now shipped in THREE places in this feature:
    //
    //   1. the Danger Zone banner       — "nothing will be deleted"       (fixed, M-4)
    //   2. the preview limitations panel — "no delete capability. Nothing
    //                                       here can remove a row."        (fixed, B-1)
    //   3. the /test-business-os tab copy — "no delete capability at all" (fixed, B-1)
    //
    // Each was true in slice 1 and silently became false in slice 2, rendering
    // beside a button that deletes. Each was found by a reviewer rather than by
    // a test. A fourth would be found the same way — or not at all.
    //
    // So: whether deletion is possible is stated in exactly ONE place, driven by
    // the server's `purgeFunctionExists()` probe. No static string anywhere on
    // the purge surface may assert that it is impossible. Comments are stripped
    // first (line-first), because several of them quote these phrases to
    // explain why they were removed.
    const REPO = path.join(__dirname, '..', '..', '..', '..');
    const surface = [
      ...walk(path.join(REPO, 'components', 'business-os', 'purge')),
      ...walk(path.join(REPO, 'app', 'api', 'business-os', 'purge')),
      ...walk(PURGE_DIR),
      path.join(REPO, 'app', 'test-business-os', 'page.tsx'),
    ].filter((f) => !f.includes(`${path.sep}__tests__${path.sep}`) && fs.existsSync(f));

    // Non-vacuity: the files this exists to protect must actually be scanned.
    const names = surface.map((f) => path.basename(f));
    expect(names).toEqual(
      expect.arrayContaining(['PurgeDangerZone.tsx', 'PreviewService.ts', 'page.tsx'])
    );

    const FALSE_REASSURANCE = [
      /no delete capability/i,
      /nothing (here )?can (remove|delete)/i,
      /no commit route/i,
      /nothing will be deleted/i,
      /cannot delete anything/i,
    ];

    const strip = (src: string) =>
      src.replace(/^[ \t]*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
        // JSX comments: {/* ... */}
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

    const offenders: string[] = [];
    for (const f of surface) {
      const code = strip(fs.readFileSync(f, 'utf-8'));
      for (const re of FALSE_REASSURANCE) {
        if (re.test(code)) offenders.push(`${path.relative(REPO, f)}: ${re}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('the RPC-existence probe keeps BOTH of its defensive arguments', () => {
    // The probe calls the function that deletes a business. It is safe only
    // because that function rejects it twice before the advisory lock:
    // `p_user_id: null` raises on the first statement, `p_tables: []` on the
    // next. A tidy-up passing a real id or a real table list removes a defence
    // while the probe keeps returning true — so nothing would reveal it. With
    // both changed, the probe IS a Reset. A comment asks; this enforces.
    const REPO = path.join(__dirname, '..', '..', '..', '..');
    const src = fs.readFileSync(
      path.join(REPO, 'lib', 'repositories', 'BusinessPurgeRepository.ts'),
      'utf-8'
    );

    const start = src.indexOf('async purgeFunctionExists()');
    expect(start).toBeGreaterThan(-1);
    const probe = src.slice(start, src.indexOf('});', start));

    expect(probe).toMatch(/p_user_id:\s*null/);
    expect(probe).toMatch(/p_tables:\s*\[\]/);
  });
});

describe('SA-S3 — classification is snapshotted, not re-decided per slice', () => {
  // `never` is a claim about the schema — "this table is not this business's
  // data" — not a scheduling device. Under slicing the standing temptation is
  // to mark an awkward table `never` so it fits the current slice's
  // capabilities. That passes AC-37, loses data permanently, and carries
  // forward into later slices where nobody re-derives it.
  //
  // So the classification is frozen. A level change fails here until someone
  // reviews it and updates the baseline deliberately.
  const baseline = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'classification-baseline.json'), 'utf-8')
  ) as { count: number; levels: Record<string, string> };

  it('the baseline is non-trivial', () => {
    expect(baseline.count).toBeGreaterThan(100);
    expect(Object.keys(baseline.levels).length).toBe(baseline.count);
  });

  it('no table has changed level since the baseline', () => {
    const changed: string[] = [];

    for (const d of PURGE_DESCRIPTORS) {
      const was = baseline.levels[d.table];
      if (was !== undefined && was !== d.level) {
        changed.push(`${d.table}: ${was} -> ${d.level}`);
      }
    }

    // If this fails, do NOT simply regenerate the baseline. A table moving to
    // `never` is a claim that it is not this business's data; a table moving
    // off `never` is a claim that it is. Either needs a reason in the diff.
    expect(changed).toEqual([]);
  });

  it('no table has been removed from the classification', () => {
    const current = new Set(PURGE_DESCRIPTORS.map((d) => d.table));
    const removed = Object.keys(baseline.levels).filter((t) => !current.has(t));

    // A removed descriptor is the same defect as a mis-set level, minus the
    // paper trail: the table stops being classified, and AC-37 only notices if
    // the table is still user-scoped and live.
    expect(removed).toEqual([]);
  });
});
