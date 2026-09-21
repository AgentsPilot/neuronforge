/**
 * The repo-wide admin-authorization surface guard.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * On 2026-09-20 a census of `app/api/admin/` found 44 route files: 3 on the
 * canonical gate, 7 hand-copying it, 2 accepting any signed-in user, and **32
 * reachable by a fully anonymous caller**. The `/admin` pages had no
 * server-side guard at all. None of that was introduced maliciously; it was
 * introduced by omission, one route at a time, and nothing in CI noticed.
 *
 * Gating those 44 files fixes the 44 files. It does not fix the process that
 * produced them. **Route #45 is gated only if its author remembers.** This
 * guard is the part that makes "cannot recur" true rather than aspirational.
 *
 * ── Why repo-wide, and by SHAPE rather than by PATH ────────────────────────
 * This follows `lib/business-os/purge/__tests__/no-deletion-paths.guard.test.ts`
 * deliberately, including its central lesson:
 *
 *   "A guard scoped to files we already know about is structurally incapable
 *    of finding the sixth."
 *
 * Scoping this to `app/api/admin/**` would repeat exactly that mistake.
 * Admin-capability code ALREADY lives outside that tree —
 * `app/api/v2/calibrate/batch/route.ts:116` resolves admin via
 * `AdminAccessService`, and `lib/server/route-identity.ts` gates act-as. So
 * rule R2 scans EVERY `route.ts` in the repository, not just the admin ones.
 * That is what stops inline copy #8 appearing in a different folder the day
 * after the seven known copies are removed.
 *
 * ── WHAT THIS GUARD DELIVERS — read this before believing it does more ────
 *
 * The system is **unified for enforcement, not yet for implementation**, and
 * this guard's job is to hold that line rather than certify a finished state.
 * As of 2026-09-21, of **72 handlers** across the 44 `app/api/admin/**` route
 * files:
 *
 *   65  on the canonical `requireAdmin` gate
 *    7  correct, but each hand-rolling its own AdminAccessService check
 *    0  open
 *
 * All 21 `/admin` pages are guarded on the server too (slice 5).
 *
 * Slices **1L, 4 and 7 remain PARKED**; 2, 3 and 5 shipped 2026-09-21. So the
 * original goal — "the allow-list is empty" — is closer but still not reached,
 * and writing it here would be false while slice 4's seven copies remain. The
 * true claim, and the one the caps enforce:
 *
 *   **THE REPO CAN NO LONGER GET DIRTIER WITHOUT SOMEONE SIGNING FOR IT.**
 *
 * A new ungated admin route fails the build. An 8th R1 exemption fails the
 * build. Neither can happen by accident.
 *
 * What this guard does NOT claim: that the admin surface is HARDENED. Every
 * handler requires an admin, but 7 still reach that answer their own way, and
 * most admin routes still use a service-role client directly — gated, not
 * isolated. See docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md § What is NOT true.
 *
 * This also means "cannot recur" is true **for new surfaces only**. The
 * existing 27 are not a recurrence; they are the unfinished part.
 *
 * ── The shrinking allow-list, and the ratchet ─────────────────────────────
 * The guard shipped WITH the first security slice, not after the last one, and
 * it shipped RED-BY-ALLOW-LIST. The alternative — "introduce the gate once the
 * repo is clean" — is the standard way this kind of programme loses its only
 * structural guarantee: the gate becomes the cheapest thing to cut once the
 * urgency is gone. Landing it first inverted that, and it is why the guard
 * still stands while six slices are parked.
 *
 * The caps below turn "it should shrink" into something enforced. See THE
 * RATCHET RULE above the allow-lists.
 *
 * ── ALLOW-LIST, never a deny-list ──────────────────────────────────────────
 * A deny-list only forbids the shapes someone already thought of. An
 * allow-list forces every new exception to be argued for in a diff. Adding a
 * line here should feel like a decision. Every entry carries a reason and a
 * date, and every entry asserts its file still exists — a stale exemption
 * silently covers a future file re-created at the same path.
 *
 * ── Fail closed, in every direction ────────────────────────────────────────
 * Three failure modes are designed against explicitly, because all three fail
 * SILENTLY in the permissive direction:
 *
 *   1. A comment stripper that mangles its input (the precedent's own past
 *      bug). Both strippers are unit-tested below.
 *   2. A scan whose INPUT became empty — a renamed directory, a changed
 *      extension. Asserted against file-count floors.
 *   3. A handler-export form the parser does not recognise. All 44 current
 *      admin routes use `export async function GET`; a handler written
 *      `export const GET = async () => {}` is valid Next.js and would sail
 *      past a naive scan. Unrecognised export shapes are FLAGGED, not skipped
 *      — including one declared in a shape none of the strict forms match,
 *      even when the same file also contains a parseable handler (D-Q3).
 *
 * ── KNOWN GAPS in this guard — stated, not glossed ────────────────────────
 *
 *   • **Precedence, not just presence (D-5 + D-Q2).** R1 asks whether a handler
 *     body CONTAINS `requireAdmin(`. It does not prove the gate runs FIRST, and
 *     it does not prove the gate is reached at all — a gate inside a closure
 *     that is never invoked satisfies R1. Every one of the 65 gated handlers is
 *     correct today (verified by hand and by the oracle), but that is a
 *     measurement, not an invariant.
 *     QA's refinement, which must not be lost: closing this needs the ORACLE's
 *     instrumentation extended to cover the **body parse**, because
 *     `mockTablesTouched` records DB/RPC/auth-API calls and not `request.json()`.
 *     Without that, a precedence check is only half a check.
 *
 *   • **R7, the inverted rule, is PARKED — deliberately not built.** It would
 *     ask "is everything that BEHAVES like an admin route gated, wherever it
 *     lives?", complementing R1's path-based question. Reasons for parking:
 *     R2 already catches the realistic recurrence (any `route.ts` importing
 *     `AdminAccessService` must be allow-listed); a false positive on a
 *     REQUIRED status check is the single thing most likely to get the check
 *     switched off; and its marginal value is lowest while 27 handlers sit
 *     exempted. Revisit once the parked slices land.
 *
 * @see docs/workplans/admin-authz-unification.md
 * @see docs/requirements/ADMIN_AUTHZ_UNIFICATION_REQUIREMENT.md (FR-10, FR-11, FR-17)
 */

import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');

/** Everything an admin access decision can live in. */
const TS_SCAN_ROOTS = ['app', 'lib', 'components', 'hooks'];

/** Where RLS policies live. */
const SQL_SCAN_ROOTS = [path.join('supabase', 'migrations'), path.join('supabase', 'SQL Scripts')];

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'coverage', '.claude']);

/** Next.js route-handler export names. All of them — authz is not verb-specific. */
const HTTP_HANDLERS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

/** Values of a `role`-ish field that would denote elevated access. */
const ADMIN_ISH_ROLE_VALUES = ['admin', 'super_admin', 'superadmin', 'platform_admin', 'sysadmin'];

// ───────────────────────────────────────────────────────────────────────────
// ALLOW-LISTS — one per rule, each entry dated, each with a written reason.
// ───────────────────────────────────────────────────────────────────────────

interface Exemption {
  /** Repo-relative path. For R1, `path#HANDLER`. */
  readonly id: string;
  readonly why: string;
}

/** `id` → the file it refers to, for the existence assertion. */
const fileOf = (id: string) => id.split('#')[0];

/**
 * ── PARKED vs PERMANENT, and the ratchet ──────────────────────────────────
 *
 * Every exemption is one of exactly two things, and they are kept in separate
 * arrays because **mixing them is the mechanism by which a new exemption looks
 * normal**. A reader skimming one long list cannot tell "architecturally
 * correct forever" from "we chose not to do this yet", so both decay into
 * "that's just how it is".
 *
 *   PERMANENT — an architectural exception with a real reason. Today there is
 *               exactly one: `calibrate/batch` uses `isAdmin` as a CAPABILITY
 *               FLAG, not as authorization. There is no 401/403 to return, so
 *               `requireAdmin` is the wrong tool. This will never be removed.
 *
 *   PARKED    — an open hole that a human decided not to close yet. NOT in
 *               flight. Each says what an anonymous caller can actually do and
 *               where the decision is tracked.
 *
 * ── THE RATCHET RULE ──────────────────────────────────────────────────────
 *
 *   **Any commit that removes an exemption MUST lower that list's cap by the
 *   same number, in the same commit.**
 *
 * Without it the cap goes slack the first time anything is gated: gate three
 * routes, delete three entries, and the list silently has room for three new
 * ones that nobody signed for. The caps below are asserted, so a slack cap is
 * a failing test rather than a comment nobody reads.
 *
 * Worked example — **PR #69**: `user-emails#POST` was gated, its R1 entry was
 * deleted, and `R1.parked` went 35 → 34 in the same commit, with a comment
 * left in place of the entry recording why.
 *
 * ── What this guard now delivers ──────────────────────────────────────────
 *
 * Slices 1L, 4 and 7 remain PARKED; 2, 3 and 5 shipped 2026-09-21. The old
 * goal — "the allow-list is empty" — is still not reached while slice 4's seven
 * copies remain, and claiming it would be false. What IS true, and what the
 * caps enforce:
 *
 *   **The repo can no longer get dirtier without someone signing for it.**
 *
 * A new ungated admin route fails the build. An 8th R1 exemption fails the
 * build. Raising a cap is a visible act in a diff that a reviewer must accept.
 */

/** R1 — admin route handlers not on `requireAdmin`. 7 inline copies, 0 open. */
const R1_PARKED: ReadonlyArray<Exemption> = [
  /*
   * ── 27 entries removed 2026-09-21 (slices 2, 3 and 5) ──────────────────
   *
   * THE RATCHET IN ACTION: every handler those entries exempted is now gated,
   * so the entries are deleted AND `CAPS.R1.parked` drops 34 -> 7 in this same
   * commit. The cap is asserted by equality, so leaving it at 34 would fail the
   * build — which is the mechanism working, not fighting us.
   *
   * What went: 14 cross-tenant reads (every platform user, per-user LLM spend,
   * platform metrics, the message log, and the three HEAD probes that confirmed
   * route existence to anonymous callers), 9 internal-config GETs, and the 4
   * catalogue GETs. `reward-config#GET` was the one with live customer callers;
   * its gate shipped in the same commit as the replacement projection at
   * `GET /api/rewards/agent-sharing`, so no screen was ever stranded.
   *
   * ── What REMAINS below, and why it is not the same thing ───────────────
   *
   * These 7 handlers are NOT open. Each performs a correct admin check — they
   * simply hand-roll it with `AdminAccessService` instead of calling
   * `requireAdmin`. They are exempted from R1 because R1 requires the canonical
   * gate, and de-duplicating them (slice 4) is hygiene, not risk reduction.
   *
   * So the honest statement after this commit is "38 + 27 = 65 handlers on the
   * canonical gate, 7 correct but duplicated, 0 open" — NOT "one way to
   * validate an admin", which is still not literally true in use.
   */
  { id: 'app/api/admin/agents/route.ts#GET', why: 'PARKED 2026-09-20 — inline AdminAccessService copy. Behaviour already correct. — not in flight; tracked in docs/workplans/admin-authz-unification.md § Parked slices (was slice 4)' },
  { id: 'app/api/admin/audit-trail/route.ts#GET', why: 'PARKED 2026-09-20 — inline AdminAccessService copy. Behaviour already correct. — not in flight; tracked in docs/workplans/admin-authz-unification.md § Parked slices (was slice 4)' },
  { id: 'app/api/admin/business-os/llm-usage/route.ts#GET', why: 'PARKED 2026-09-20 — the inline precedent (lines 49-64) that requireAdminRoute.ts was extracted from. Slice 4 would have removed it; slice 4 is parked, so it remains. — not in flight; tracked in docs/workplans/admin-authz-unification.md § Parked slices (was slice 4)' },
  { id: 'app/api/admin/business-os/llm-usage/businesses/route.ts#GET', why: 'PARKED 2026-09-20 — inline AdminAccessService copy. Behaviour already correct. — not in flight; tracked in docs/workplans/admin-authz-unification.md § Parked slices (was slice 4)' },
  { id: 'app/api/admin/chat-usage/route.ts#GET', why: 'PARKED 2026-09-20 — inline AdminAccessService copy. Behaviour already correct. — not in flight; tracked in docs/workplans/admin-authz-unification.md § Parked slices (was slice 4)' },
  { id: 'app/api/admin/users/[id]/audit-logs/route.ts#GET', why: 'PARKED 2026-09-20 — inline AdminAccessService copy. Behaviour already correct. — not in flight; tracked in docs/workplans/admin-authz-unification.md § Parked slices (was slice 4)' },
  { id: 'app/api/admin/users/[id]/login-stats/route.ts#GET', why: 'PARKED 2026-09-20 — inline AdminAccessService copy. Behaviour already correct. — not in flight; tracked in docs/workplans/admin-authz-unification.md § Parked slices (was slice 4)' },
];

/** R1 has no permanent exceptions: every admin route handler should be gated. */
const R1_PERMANENT: ReadonlyArray<Exemption> = [];

/** R2 — `route.ts` files importing `AdminAccessService` directly. */
const R2_PARKED: ReadonlyArray<Exemption> = [
  { id: 'app/api/admin/agents/route.ts', why: 'PARKED 2026-09-20 — inline copy, replaced by requireAdmin. — not in flight; tracked in docs/workplans/admin-authz-unification.md § Parked slices (was slice 4)' },
  { id: 'app/api/admin/audit-trail/route.ts', why: 'PARKED 2026-09-20 — inline copy, replaced by requireAdmin. — not in flight; tracked in docs/workplans/admin-authz-unification.md § Parked slices (was slice 4)' },
  { id: 'app/api/admin/business-os/llm-usage/route.ts', why: 'PARKED 2026-09-20 — inline copy, replaced by requireAdmin. — not in flight; tracked in docs/workplans/admin-authz-unification.md § Parked slices (was slice 4)' },
  { id: 'app/api/admin/business-os/llm-usage/businesses/route.ts', why: 'PARKED 2026-09-20 — inline copy, replaced by requireAdmin. — not in flight; tracked in docs/workplans/admin-authz-unification.md § Parked slices (was slice 4)' },
  { id: 'app/api/admin/chat-usage/route.ts', why: 'PARKED 2026-09-20 — inline copy, replaced by requireAdmin. — not in flight; tracked in docs/workplans/admin-authz-unification.md § Parked slices (was slice 4)' },
  { id: 'app/api/admin/users/[id]/audit-logs/route.ts', why: 'PARKED 2026-09-20 — inline copy, replaced by requireAdmin. — not in flight; tracked in docs/workplans/admin-authz-unification.md § Parked slices (was slice 4)' },
  { id: 'app/api/admin/users/[id]/login-stats/route.ts', why: 'PARKED 2026-09-20 — inline copy, replaced by requireAdmin. — not in flight; tracked in docs/workplans/admin-authz-unification.md § Parked slices (was slice 4)' },
];

/**
 * The one genuine forever-exception in the whole guard, and the model for what
 * a PERMANENT entry must argue: why the canonical tool is the WRONG tool here,
 * not merely that an exception is convenient.
 */
const R2_PERMANENT: ReadonlyArray<Exemption> = [
  {
    id: 'app/api/v2/calibrate/batch/route.ts',
    why:
      'PERMANENT \u2014 not a route gate but a CAPABILITY FLAG. `calibrate/batch` resolves ' +
      'isAdmin to choose the service-role client (admins may calibrate agents they do ' +
      'not own) over the RLS client. There is no 401/403 to return, so requireAdmin is ' +
      'the wrong tool. Tracked as OI-3: admin-capability surfaces outside /api/admin are ' +
      'not unified by this programme, but R2 makes any NEW one visible in review.',
  },
];

/**
 * R3 — route handlers under `app/admin/**`.
 *
 * **Genuinely zero, and that is a real result rather than an untested rule.** A
 * `route.ts` here would be an unguarded admin surface INSIDE the page tree,
 * because route handlers are NOT wrapped by layouts. It stays closed only while
 * both lists are empty.
 */
const R3_PARKED: ReadonlyArray<Exemption> = [];
const R3_PERMANENT: ReadonlyArray<Exemption> = [];

/**
 * R4 — access decisions keyed on a `role` value.
 *
 * A repo-wide sweep for an access decision keyed on `profiles.role` returns
 * ZERO hits (verified twice, 2026-09-20), so this rule is free to enforce and
 * cannot be argued down as noisy. Neither entry below reads `profiles` — both
 * read a `role` field inside the `system_settings_config.admin_users` JSON
 * blob, which grants nothing.
 *
 * This is the rule that stops F5 (profile self-promotion) being reintroduced
 * through the other door.
 */
const R4_PARKED: ReadonlyArray<Exemption> = [
  { id: 'app/admin/settings/page.tsx', why: 'PARKED 2026-09-20 — 4 occurrences (lines 322, 447, 457, 461) compare a `role` from `system_settings_config.admin_users`, NOT `profiles.role`. The store grants no access; the screen is NOT retired \u2014 slice 7 is parked, so it still exists and still writes to a store that grants nothing. — not in flight; tracked in docs/workplans/admin-authz-unification.md § Parked slices (was slice 7)' },
  { id: 'app/api/admin/settings/admin-users/route.ts', why: 'PARKED 2026-09-20 — 2 occurrences (lines 210, 211); line 211 is inside `.filter(a => a.role === \'super_admin\')`. Same store, same non-grant. (Lines were 196/197 before slice 1 inserted the gate — D-Q4.) — not in flight; tracked in docs/workplans/admin-authz-unification.md § Parked slices (was slice 7)' },
];
const R4_PERMANENT: ReadonlyArray<Exemption> = [];

/**
 * R5 — RLS policies keyed on `profiles.role`.
 *
 * **Genuinely zero.** `20260920a_lock_system_settings_and_pricing_rls.sql`
 * REPLACED the two policies that trusted `profiles.role`; their text survives
 * only as a commented rollback block, which is why `stripSqlComments` is
 * load-bearing and is unit-tested against that exact file.
 */
const R5_PARKED: ReadonlyArray<Exemption> = [];
const R5_PERMANENT: ReadonlyArray<Exemption> = [];

/** R6 — the `/admin` page-tree guard. */
const R6_PARKED: ReadonlyArray<Exemption> = [
  /*
   * EMPTY as of 2026-09-21, and that is a real result.
   *
   * `app/admin/layout.tsx` is now an async Server Component that awaits
   * `requireAdminPage()` before rendering `AdminChrome`. All 21 admin pages are
   * guarded BY INHERITANCE — none of them was edited, which is the point: a new
   * page under `app/admin/` is protected before its author writes a line.
   *
   * R3 (no `route.ts` under `app/admin/**`) is what keeps that true, because a
   * route handler is the one thing a layout does not wrap.
   */

];
const R6_PERMANENT: ReadonlyArray<Exemption> = [];

// ── Hard caps ─────────────────────────────────────────────────────────────
//
// Derived from the tree on 2026-09-20 and asserted below. See THE RATCHET RULE
// above: removing an exemption MUST lower the matching cap in the same commit.
const CAPS = {
  R1: { parked: 7, permanent: 0 },
  R2: { parked: 7, permanent: 1 },
  R3: { parked: 0, permanent: 0 },
  R4: { parked: 2, permanent: 0 },
  R5: { parked: 0, permanent: 0 },
  R6: { parked: 0, permanent: 0 },
} as const;

const RULE_LISTS = {
  R1: { parked: R1_PARKED, permanent: R1_PERMANENT },
  R2: { parked: R2_PARKED, permanent: R2_PERMANENT },
  R3: { parked: R3_PARKED, permanent: R3_PERMANENT },
  R4: { parked: R4_PARKED, permanent: R4_PERMANENT },
  R5: { parked: R5_PARKED, permanent: R5_PERMANENT },
  R6: { parked: R6_PARKED, permanent: R6_PERMANENT },
} as const;

const R1_ALLOW = [...R1_PARKED, ...R1_PERMANENT];
const R2_ALLOW = [...R2_PARKED, ...R2_PERMANENT];
const R3_ALLOW = [...R3_PARKED, ...R3_PERMANENT];
const R4_ALLOW = [...R4_PARKED, ...R4_PERMANENT];
const R5_ALLOW = [...R5_PARKED, ...R5_PERMANENT];
const R6_ALLOW = [...R6_PARKED, ...R6_PERMANENT];

const ALL_EXEMPTIONS = [
  ...R1_ALLOW,
  ...R2_ALLOW,
  ...R3_ALLOW,
  ...R4_ALLOW,
  ...R5_ALLOW,
  ...R6_ALLOW,
];

const R1_ALLOWED = new Set(R1_ALLOW.map((e) => e.id));
const R2_ALLOWED = new Set(R2_ALLOW.map((e) => e.id));
const R3_ALLOWED = new Set(R3_ALLOW.map((e) => e.id));
const R4_ALLOWED = new Set(R4_ALLOW.map((e) => e.id));
const R5_ALLOWED = new Set(R5_ALLOW.map((e) => e.id));
const R6_ALLOWED = new Set(R6_ALLOW.map((e) => e.id));

// ───────────────────────────────────────────────────────────────────────────
// Scanning primitives
// ───────────────────────────────────────────────────────────────────────────

function walk(dir: string, exts: RegExp): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (SKIP_DIRS.has(e.name)) return [];
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full, exts);
    return exts.test(e.name) ? [full] : [];
  });
}

/**
 * Remove TypeScript comments so documentation cannot match itself.
 *
 * This repo is full of comments that say things like "never profiles.role" and
 * "requireAdmin" — `lib/server/route-identity.ts:121` and
 * `lib/business-os/purge/purgeAuthz.ts:23-26` are comments FORBIDDING the very
 * pattern R4 looks for. Without stripping, this guard would flag the files that
 * document the rule.
 *
 * ── D-3 (SA review, 2026-09-20): why this is a scan and not two regexes ────
 * The previous implementation was
 *   source.replace(/^[ \t]*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
 * whose line-comment pass is anchored to the START of a line (`^[ \t]*`). It
 * therefore removed only comments occupying a WHOLE line. A **trailing**
 * comment survived into the block pass — and if it contained a `/*` (a glob,
 * say) that pass matched from there to the next close-comment anywhere later in
 * the file, deleting everything in between.
 *
 * SA reproduced it deleting an access decision: with a trailing
 * `// glob note: <slash-star>.ts files`, the following
 * `if (p.role === 'admin') { grantEverything(); }` was swallowed whole. R2 and
 * R4 scan stripped code, so that violation became invisible — silently, and in
 * the PERMISSIVE direction.
 *
 * This is the bug class the old docstring claimed to be designed against.
 * "Line comments first" only ever covered whole-line comments, and the unit
 * test used a whole-line comment, so nothing pinned the trailing case.
 *
 * Now: one left-to-right scan over a string-blanked scaffold, so a comment is
 * recognised wherever it starts, and `//` or a block opener inside a string
 * literal is not treated as a comment. Newlines inside removed regions are
 * preserved so every later line keeps its number.
 */
export function stripComments(source: string): string {
  const scaffold = blankStringLiterals(source);
  let out = '';

  for (let i = 0; i < source.length; ) {
    if (scaffold[i] === '/' && scaffold[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (scaffold[i] === '/' && scaffold[i + 1] === '*') {
      const end = scaffold.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      for (let j = i; j < stop; j++) if (source[j] === '\n') out += '\n';
      i = stop;
      continue;
    }
    out += source[i];
    i++;
  }

  return out;
}

/**
 * Remove SQL comments (`-- line` and block).
 *
 * Load-bearing: every surviving `profiles.role` policy text in
 * `supabase/migrations/` is inside a comment, including a full commented
 * rollback block. See R5_ALLOW.
 */
export function stripSqlComments(source: string): string {
  return source.replace(/^[ \t]*--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Blank the CONTENTS of string and template literals, preserving length and
 * newlines, so brace-matching cannot be thrown off by a `{` inside a string.
 *
 * Only used for finding a handler's body boundaries. The gate check itself
 * runs against the un-blanked code, because a primitive inside a string literal
 * must still count (a false positive costs a conversation; a false negative
 * costs the platform).
 */
export function blankStringLiterals(code: string): string {
  /*
   * Quote rules follow JavaScript, deliberately: only a template literal may
   * span newlines. The earlier single pattern allowed `'` and `"` to run across
   * lines, so one apostrophe in prose (`// don't`) could "open" a string that
   * ran to the next apostrophe pages later, blanking real code in between.
   *
   * That was harmless while this helper was only used for brace matching. It is
   * NOT harmless now that `stripComments` scans this scaffold (D-3): a blanked
   * region is a region where `//` and block openers stop being visible. Bounding
   * `'` and `"` to a single line keeps the worst case to the line the
   * apostrophe is on — which, being a comment, is discarded anyway.
   */
  return code.replace(
    /`(?:\\[\s\S]|[^`\\])*`|'(?:\\[^\n]|[^'\\\n])*'|"(?:\\[^\n]|[^"\\\n])*"/g,
    (m) => m[0] + m.slice(1, -1).replace(/[^\n]/g, ' ') + m[m.length - 1]
  );
}

/** Index just past the `)` matching the `(` at `openParen`, or -1. */
function matchParen(scaffold: string, openParen: number): number {
  let depth = 0;
  for (let i = openParen; i < scaffold.length; i++) {
    if (scaffold[i] === '(') depth++;
    else if (scaffold[i] === ')') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Given the index just past a parameter list's `)`, return the index of the
 * `{` that opens the FUNCTION BODY — or -1 if what follows is not a body.
 *
 * This is the D-1/D-2 fix, and the whole point is the -1 case.
 *
 * ── D-1 (HIGH, SA review 2026-09-20) ──────────────────────────────────────
 * The old code took "the first `{` after the parameter list" as the body. For
 * a handler wrapped in a higher-order function, the parens matched are the
 * WRAPPER's, so the next `{` belongs to whatever happens to come next in the
 * file. SA reproduced:
 *
 *   export const GET = withAuth(async (req) => { return 1; });
 *   function unrelated() { const g = requireAdmin(l); return 2; }
 *
 * → `handlers: [{ name: 'GET', body: '{ const g = requireAdmin(l); return 2; }' }]`
 *   with `unparseable: []`.
 *
 * An UNRELATED function's body was attributed to `GET`; the guard saw
 * `requireAdmin(` in it and passed an ungated admin route. Both safety nets
 * failed at once — R1 said "gated" and the fail-closed rule had nothing to
 * flag. HOC-wrapped handlers are an ordinary Next.js pattern, so this is the
 * single outcome this guard exists to prevent.
 *
 * ── D-2 (MEDIUM, same review) ─────────────────────────────────────────────
 * `export async function POST(req): Promise<{ ok: boolean }> { … }` had its
 * body extracted as `{ ok: boolean }` — the RETURN TYPE — and a correctly
 * gated handler was reported ungated. Same family as the `{ params }` bug,
 * one position later: paren-matching skipped the parameter list, but nothing
 * skipped the return-type annotation.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 * After the parameter list, the only things that may legally precede a body
 * are an optional `: ReturnType` annotation and, for arrows, `=>`. So:
 *   • skip an optional `:`-introduced type annotation (which may itself
 *     contain braces, e.g. `Promise<{ ok: boolean }>`) at nesting depth 0;
 *   • then accept `{` (function form) or `=>` `{` (arrow form);
 *   • anything else — `;`, `)`, `,`, an identifier — means those parens were
 *     NOT the handler's parameter list. Return -1, and the caller records the
 *     handler as unparseable rather than guessing.
 */
function findBodyBrace(scaffold: string, afterParams: number): number {
  let i = afterParams;
  const skipWs = () => {
    while (i < scaffold.length && /\s/.test(scaffold[i])) i++;
  };

  skipWs();

  // Optional `: ReturnType`. Walk it at depth 0 so a braced or generic type
  // (`Promise<{ ok: boolean }>`) is skipped rather than mistaken for the body.
  if (scaffold[i] === ':') {
    i++;
    let depth = 0;
    while (i < scaffold.length) {
      const c = scaffold[i];
      if (c === '<' || c === '(' || c === '[') depth++;
      else if (c === '>' || c === ')' || c === ']') depth--;
      else if (c === '{') {
        if (depth === 0) break; // the body
        depth++;
      } else if (c === '}') depth--;
      else if (depth === 0 && c === '=' && scaffold[i + 1] === '>') break;
      else if (depth === 0 && (c === ';' || c === ',')) break;
      i++;
    }
    skipWs();
  }

  if (scaffold[i] === '{') return i;

  if (scaffold[i] === '=' && scaffold[i + 1] === '>') {
    i += 2;
    skipWs();
    // An expression-bodied arrow (`=> NextResponse.json(…)`) has no braced
    // body and therefore no place a gate could live. -1 → unparseable.
    return scaffold[i] === '{' ? i : -1;
  }

  return -1;
}

/**
 * Return a handler's body, given the index of its parameter list's `(`.
 *
 * **The parameter list must be skipped before looking for the body brace.**
 * Next.js dynamic routes are declared
 * `export async function PATCH(request: NextRequest, { params }: { params: { id: string } })`
 * — so the first `{` after the handler name belongs to a DESTRUCTURING PATTERN,
 * not the body. An earlier version of this guard matched that brace and
 * "extracted" a body of `{ params }`, then reported
 * `app/api/admin/messages/[id]/route.ts#PATCH` as ungated when it was gated
 * correctly. Caught on this guard's second run against real files.
 *
 * That was a false positive — the safe direction — but a guard that cries wolf
 * on correct code is a guard someone switches off, so it is a real defect.
 * D-1 and D-2 are the same instinct applied one step further; see
 * `findBodyBrace`, which is where "what may legally precede a body" is decided.
 *
 * `null` means "could not parse", and every caller must treat it as a FAILURE,
 * never as "no violation found".
 */
function extractBracedBody(code: string, parenIndex: number): string | null {
  const scaffold = blankStringLiterals(code);

  const afterParams = matchParen(scaffold, parenIndex);
  if (afterParams === -1) return null;

  const open = findBodyBrace(scaffold, afterParams);
  if (open === -1) return null;

  let depth = 0;
  for (let i = open; i < scaffold.length; i++) {
    const ch = scaffold[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return code.slice(open, i + 1);
    }
  }
  return null;
}

/**
 * For the `export const GET = …` form: find the parameter list's `(`.
 *
 * Returns -1 when the value is not a function we can trace — `export const GET
 * = someHandler` or `export const GET = { … }`. Those are FLAGGED, not skipped.
 */
function findValueParen(scaffold: string, from: number): number {
  const paren = scaffold.indexOf('(', from);
  const brace = scaffold.indexOf('{', from);
  if (paren === -1) return -1;
  if (brace !== -1 && brace < paren) return -1;
  return paren;
}

const HANDLER_ALTERNATION = HTTP_HANDLERS.join('|');

export interface HandlerScan {
  /** Handlers found, with their body source. */
  handlers: Array<{ name: string; body: string }>;
  /** Human-readable reasons the file could not be fully parsed. */
  unparseable: string[];
}

/**
 * Extract the HTTP handlers a route file exports.
 *
 * W-7: recognises BOTH export forms, and reports anything it cannot attribute
 * to a body rather than skipping it.
 *
 * All 44 current admin route files use `export async function GET`. A handler
 * written `export const GET = async (req) => {}` is valid Next.js and would
 * pass a scanner that only knew the first form — silently, and in the
 * permissive direction. That is the failure mode that matters.
 */
export function scanHandlers(code: string): HandlerScan {
  const handlers: Array<{ name: string; body: string }> = [];
  const unparseable: string[] = [];

  const scaffold = blankStringLiterals(code);

  // Form 1 — `export async function GET(` / `export function GET(`
  const fnRe = new RegExp(`export\\s+(?:async\\s+)?function\\s+(${HANDLER_ALTERNATION})\\s*\\(`, 'g');
  for (let m = fnRe.exec(code); m; m = fnRe.exec(code)) {
    // The `(` of the parameter list is the last character of the match.
    const body = extractBracedBody(code, m.index + m[0].length - 1);
    if (body === null) {
      unparseable.push(
        `${m[1]}: could not trace the function body. The guard will not guess ` +
          'which braces belong to this handler — see findBodyBrace (D-1/D-2).'
      );
    } else handlers.push({ name: m[1], body });
  }

  // Form 2 — `export const GET = …` (also let/var, and an optional type annotation)
  const constRe = new RegExp(
    `export\\s+(?:const|let|var)\\s+(${HANDLER_ALTERNATION})\\s*(?::[^=]+)?=`,
    'g'
  );
  for (let m = constRe.exec(code); m; m = constRe.exec(code)) {
    const paren = findValueParen(scaffold, m.index + m[0].length);
    if (paren === -1) {
      unparseable.push(
        `${m[1]}: assigned a value this guard cannot trace to a function body ` +
          '(a bare reference, or an object). Inline the handler so its gate is visible.'
      );
      continue;
    }
    const body = extractBracedBody(code, paren);
    if (body === null) {
      // The D-1 shape lands here: `export const GET = withAuth(async (req) => {…})`
      // matches a `(`, but what follows its `)` is `;`, not a body. Rather than
      // adopting the next unrelated `{` in the file, say so.
      unparseable.push(
        `${m[1]}: the parentheses after the assignment are not this handler's ` +
          'parameter list — it looks wrapped (a higher-order function) or ' +
          'expression-bodied. The guard cannot prove where its gate is, so it ' +
          'will not pass it. Inline the handler, or gate inside the wrapper and ' +
          'allow-list it with a reason.'
      );
    } else handlers.push({ name: m[1], body });
  }

  // Form 3 — anything else. We cannot attribute these to a body, so we FLAG.
  const braceRe = /export\s*\{([^}]*)\}/g;
  for (let m = braceRe.exec(code); m; m = braceRe.exec(code)) {
    for (const name of HTTP_HANDLERS) {
      if (new RegExp(`\\b${name}\\b`).test(m[1])) {
        unparseable.push(`${name}: re-exported via \`export { … }\`, which this guard cannot trace`);
      }
    }
  }
  if (/export\s*\*\s/.test(code)) {
    unparseable.push('`export *` — this guard cannot know which handlers it re-exports');
  }

  /*
   * D-Q3 (QA, 2026-09-20): catch a handler DECLARED in a shape none of the three
   * strict forms matched.
   *
   * The zero-handler safety net below only fires when a file yields NOTHING. A
   * file with one parseable handler and one unrecognised one has
   * `handlers.length > 0`, so the net never fires and the unrecognised handler
   * is invisible to R1. QA's examples:
   *
   *   export async function GET<T>(req) { … }   // generic — no form matches
   *   export let GET; GET = async () => { … };  // declared, assigned later
   *
   * Generics on a route handler are contrived; the CLASS is not. It is exactly
   * "we only recognise the shapes people currently write".
   *
   * So: re-scan with DELIBERATELY LOOSE patterns that do not require the `(` or
   * the `=`, and flag any handler name they find that the strict forms did not
   * attribute. Loose-but-flagging is the safe direction — the cost of a false
   * positive here is one allow-list line with a reason.
   */
  const attributed = new Set(handlers.map((h) => h.name));
  const alreadyFlagged = (name: string) => unparseable.some((u) => u.startsWith(`${name}:`));

  const looseRes = [
    new RegExp(`export\\s+(?:async\\s+)?function\\s+(${HANDLER_ALTERNATION})\\b`, 'g'),
    new RegExp(`export\\s+(?:const|let|var)\\s+(${HANDLER_ALTERNATION})\\b`, 'g'),
  ];
  for (const re of looseRes) {
    for (let m = re.exec(code); m; m = re.exec(code)) {
      const name = m[1];
      if (attributed.has(name) || alreadyFlagged(name)) continue;
      unparseable.push(
        `${name}: exported in a shape this guard does not recognise (a generic, a ` +
          'deferred assignment, or something else). It cannot be proven gated, so it ' +
          'is not assumed to be. Write it as `export async function NAME(req) { … }`.'
      );
      attributed.add(name); // report each name once
    }
  }

  return { handlers, unparseable };
}

const rel = (f: string) => path.relative(REPO_ROOT, f).split(path.sep).join('/');

/**
 * This file, excluded from its own scan by EXACT PATH.
 *
 * It must contain every forbidden shape by construction — in the allow-list
 * reasons, in the synthetic fixtures, and in the header. Excluded by path
 * rather than by skipping `__tests__`, because blanket-exempting test
 * directories is a hole big enough to drive the next incident through.
 */
const SELF = 'lib/admin/__tests__/admin-authz-surface.guard.test.ts';

interface ScannedTs {
  file: string;
  code: string;
  isClient: boolean;
}

/*
 * D-4 (SA, 2026-09-20): scan every extension Next.js accepts, not just the ones
 * people currently write.
 *
 * `ROUTE_FILES` used to match only `/route.ts`, so a handler in `route.tsx`
 * escaped R1, R2 and R3 entirely, and a `route.js` was never even read. None
 * exists in the repo today — but "we only scan the extension people currently
 * use" is the same shape as "we only scan the paths we already know about",
 * which this guard's own header rejects. Widening is a no-op against the
 * current tree and closes the hole for the next file.
 */
const CODE_EXT = /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/;
const ROUTE_FILE_RE = /\/route\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/;

const TS_FILES = TS_SCAN_ROOTS.flatMap((r) => walk(path.join(REPO_ROOT, r), CODE_EXT));

const SCANNED: ScannedTs[] = TS_FILES.filter((f) => rel(f) !== SELF).map((f) => {
  const raw = fs.readFileSync(f, 'utf-8');
  return {
    file: rel(f),
    code: stripComments(raw),
    isClient: /^\s*['"]use client['"]/m.test(raw),
  };
});

const ROUTE_FILES = SCANNED.filter((s) => ROUTE_FILE_RE.test(s.file));
const ADMIN_API_ROUTES = ROUTE_FILES.filter((s) => s.file.startsWith('app/api/admin/'));

const SQL_FILES = SQL_SCAN_ROOTS.flatMap((r) => walk(path.join(REPO_ROOT, r), /\.sql$/)).map((f) => ({
  file: rel(f),
  sql: stripSqlComments(fs.readFileSync(f, 'utf-8')),
}));

/** A `role` compared against a value that would denote elevated access. */
const ROLE_COMPARISON = new RegExp(
  String.raw`role\s*(?:===|!==|==|!=)\s*['"\`](?:${ADMIN_ISH_ROLE_VALUES.join('|')})['"\`]` +
    '|' +
    String.raw`['"\`](?:${ADMIN_ISH_ROLE_VALUES.join('|')})['"\`]\s*(?:===|!==|==|!=)\s*[\w.?\[\]']*role` +
    '|' +
    String.raw`\.eq\(\s*['"\`]role['"\`]\s*,\s*['"\`](?:${ADMIN_ISH_ROLE_VALUES.join('|')})['"\`]` +
    '|' +
    String.raw`\[[^\]\n]*['"\`](?:${ADMIN_ISH_ROLE_VALUES.join('|')})['"\`][^\]\n]*\]\s*\.\s*(?:includes|some)\s*\(`
);

// ───────────────────────────────────────────────────────────────────────────

describe('repo-wide guard: the admin authorization surface', () => {
  describe('the guard actually ran', () => {
    it('scanned a plausible number of TypeScript files', () => {
      // "Scanned 0 files, found 0 violations" is a green build that proves
      // nothing. A renamed directory or a changed extension produces exactly
      // that, silently, in the permissive direction.
      expect(SCANNED.length).toBeGreaterThan(500);
    });

    it('found every TypeScript scan root', () => {
      for (const root of TS_SCAN_ROOTS) {
        expect(SCANNED.some((s) => s.file.startsWith(`${root}/`))).toBe(true);
      }
    });

    it('D-4: scans every route-file extension Next.js accepts', () => {
      // Latent today (the repo has only `route.ts`), so assert the MATCHER
      // rather than the tree — otherwise this passes for the wrong reason.
      for (const ext of ['ts', 'tsx', 'js', 'jsx', 'mts', 'cts']) {
        expect(ROUTE_FILE_RE.test(`app/api/admin/thing/route.${ext}`)).toBe(true);
        expect(CODE_EXT.test(`app/api/admin/thing/route.${ext}`)).toBe(true);
      }
      // …and does not match things that merely end in the word "route".
      expect(ROUTE_FILE_RE.test('app/api/admin/thing/my-route.ts')).toBe(false);
      expect(ROUTE_FILE_RE.test('app/api/admin/route.md')).toBe(false);
    });

    it('found the admin API routes it exists to guard', () => {
      // The census measured 44 on 2026-09-20. A floor, not an equality: new
      // admin routes are expected, and each must be GATED, not counted.
      expect(ADMIN_API_ROUTES.length).toBeGreaterThanOrEqual(40);
    });

    it('scanned SQL migrations', () => {
      expect(SQL_FILES.length).toBeGreaterThan(20);
    });

    it('every allow-listed file still exists', () => {
      // A stale exemption silently covers a future file re-created at the same
      // path. This is why entries are deleted, never just left behind.
      const missing = ALL_EXEMPTIONS.map((e) => fileOf(e.id)).filter(
        (f) => !fs.existsSync(path.join(REPO_ROOT, f))
      );
      expect(missing).toEqual([]);
    });

    it('every allow-list entry carries a written reason', () => {
      // FR-11: an exception is never the default, and never silent.
      const unreasoned = ALL_EXEMPTIONS.filter((e) => !e.why || e.why.trim().length < 20);
      expect(unreasoned.map((e) => e.id)).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────

  describe('the ratchet — these lists may only shrink', () => {
    /*
     * This is what the guard delivers now that slices 1L/2/3/4/5/7 are parked.
     * The old goal — "the allow-list is empty" — is unreachable, and claiming it
     * would be false. What the caps make true instead:
     *
     *   THE REPO CAN NO LONGER GET DIRTIER WITHOUT SOMEONE SIGNING FOR IT.
     *
     * A new ungated admin route fails the build. So does an 8th R1 exemption.
     * Raising a cap is possible — it is simply no longer possible to do it by
     * accident, or without a reviewer seeing the number change.
     */
    /*
     * D6-1 (SA, 2026-09-20): the hint must sit on the surface that FAILS.
     *
     * It used to ride on `expect({…}).toMatchObject({ count: expect.any(Number) })`
     * — an assertion that can never fail, so Jest never printed it. The bare
     * `toBeLessThanOrEqual` underneath then failed with nothing but
     * `Expected: <= 34 / Received: 35`.
     *
     * That asymmetry is the whole problem. The GATING case also trips the
     * equality test below, whose name and numbers lead you to the right action.
     * The EXEMPTION-ADDING case trips only the cap, and with no hint the
     * expedient response is to bump the cap to 35 and move on — which is
     * precisely the erosion these caps exist to prevent.
     *
     * So: emit a violation OBJECT carrying the hint and compare it to `[]`, the
     * same idiom the rule assertions use. Jest prints the received array in
     * full, hint included.
     */
    const RATCHET_HINT =
      'THE RATCHET RULE — this list may only SHRINK. If you GATED something: delete ' +
      'its entry AND lower this cap by the same number, in the same commit. If you are ' +
      'adding a GENUINELY NEW exemption: raise the cap in the same commit and justify ' +
      'it in the PR body. Do not raise the cap to make this test pass — that is the ' +
      'one move this check exists to make visible.';

    for (const [rule, caps] of Object.entries(CAPS)) {
      const lists = RULE_LISTS[rule as keyof typeof RULE_LISTS];

      it(`${rule}: no more than ${caps.parked} PARKED exemptions`, () => {
        const overCap =
          lists.parked.length > caps.parked
            ? [{ rule, parked: lists.parked.length, cap: caps.parked, ratchet: RATCHET_HINT }]
            : [];

        expect(overCap).toEqual([]);
      });

      it(`${rule}: no more than ${caps.permanent} PERMANENT exemption(s)`, () => {
        // A PERMANENT entry must argue why the canonical tool is the WRONG tool,
        // not merely that an exception is convenient. Adding one is a design
        // decision and should be as hard as raising a cap.
        const overCap =
          lists.permanent.length > caps.permanent
            ? [{ rule, permanent: lists.permanent.length, cap: caps.permanent, ratchet: RATCHET_HINT }]
            : [];

        expect(overCap).toEqual([]);
      });
    }

    it('the caps match the lists exactly — a slack cap is as bad as no cap', () => {
      // `<=` alone lets a cap drift above reality after something is gated,
      // silently creating room nobody signed for. Equality is the ratchet.
      //
      // QA (2026-09-20): the ratchet hint belongs here too, not just on the
      // over-cap test. This is the failure the GATING case hits — delete an
      // entry, leave the cap at 34 — and it was previously the one path that
      // printed bare numbers with no instruction. D6-1 fixed the
      // exemption-adding direction; this closes the other one.
      const drift = Object.entries(CAPS)
        .map(([rule, caps]) => {
          const l = RULE_LISTS[rule as keyof typeof RULE_LISTS];
          return { rule, parked: l.parked.length, capParked: caps.parked, permanent: l.permanent.length, capPermanent: caps.permanent, ratchet: RATCHET_HINT };
        })
        .filter((r) => r.parked !== r.capParked || r.permanent !== r.capPermanent);

      expect(drift).toEqual([]);
    });

    it('R3 and R5 are genuinely zero — a real result, not an untested rule', () => {
      // Worth asserting separately: these two are the only rules with nothing
      // exempted at all, so "green" for them means the repo is actually clean,
      // not that everything was allow-listed.
      expect(R3_PARKED.length + R3_PERMANENT.length).toBe(0);
      expect(R5_PARKED.length + R5_PERMANENT.length).toBe(0);
    });

    it('no id appears in both the PARKED and PERMANENT list of a rule', () => {
      // A duplicate would make a parked hole look architectural.
      for (const [rule, lists] of Object.entries(RULE_LISTS)) {
        const parked = new Set(lists.parked.map((e) => e.id));
        const both = lists.permanent.filter((e) => parked.has(e.id)).map((e) => e.id);
        expect({ rule, both }).toEqual({ rule, both: [] });
      }
    });

    it('every PARKED reason says it is parked and where it is tracked', () => {
      // These previously read "Slice 2 (2026-09-20): lists every platform user",
      // which reads as IN FLIGHT. It is not in flight. The overclaim risk starts
      // inside the code, so the wording is asserted rather than trusted.
      const bad = Object.values(RULE_LISTS)
        .flatMap((l) => l.parked)
        .filter((e) => !/^PARKED \d{4}-\d{2}-\d{2} —/.test(e.why) || !/tracked in/i.test(e.why))
        .map((e) => e.id);

      expect(bad).toEqual([]);
    });

    it('every PERMANENT reason is labelled PERMANENT', () => {
      const bad = Object.values(RULE_LISTS)
        .flatMap((l) => l.permanent)
        .filter((e) => !/^PERMANENT\b/.test(e.why))
        .map((e) => e.id);

      expect(bad).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────

  describe('stripComments', () => {
    it('removes line and block comments', () => {
      expect(stripComments('// gone\nconst a = 1;')).not.toContain('gone');
      expect(stripComments('/* gone */const a = 1;')).not.toContain('gone');
      expect(stripComments('const a = 1; // gone')).toContain('const a = 1;');
    });

    it('removes a TRAILING line comment, not just a whole-line one', () => {
      // The old regex was anchored `^[ \t]*//`, so this assertion would have
      // failed. The original test only checked the CODE survived, which passed
      // either way — that is why D-3 went unnoticed.
      expect(stripComments('const a = 1; // gone')).not.toContain('gone');
    });

    // ── D-3 (MEDIUM) ──────────────────────────────────────────────────────
    it('D-3: a trailing comment containing a block-opener does NOT swallow the code after it', () => {
      // SA's exact reproduction. With the old two-regex implementation the
      // trailing `//` survived the line pass, its `/*` opened a block match,
      // and everything up to the next `*/` was deleted — including an access
      // decision. R2 and R4 scan stripped code, so the violation vanished.
      // Silent, and in the PERMISSIVE direction.
      const source = [
        'const a = 1; // glob note: /*.ts files',
        "if (p.role === 'admin') { grantEverything(); }",
        '/** docblock */',
        'const b = 2;',
      ].join('\n');

      const code = stripComments(source);

      // The access decision must survive so R4 can see it.
      expect(code).toContain("p.role === 'admin'");
      expect(code).toContain('grantEverything');
      expect(code).toContain('const b = 2;');
      // …and the comments must still be gone.
      expect(code).not.toContain('glob note');
      expect(code).not.toContain('docblock');
    });

    it('D-3: R4 still fires on a violation hidden behind such a comment', () => {
      // The defect only matters because of what it hides, so assert the
      // consequence, not just the stripper's output.
      const source = [
        'const a = 1; // glob note: /*.ts files',
        "export function check(p) { return p.role === 'admin'; }",
        '/** docblock */',
      ].join('\n');

      expect(ROLE_COMPARISON.test(stripComments(source))).toBe(true);
    });

    it('D-3: does not treat `//` or a block opener inside a string literal as a comment', () => {
      const code = stripComments('const url = "https://example.com/*"; const b = 2;');
      expect(code).toContain('https://example.com/*');
      expect(code).toContain('const b = 2;');
    });

    it("D-3: an apostrophe in a trailing comment does not blank the following lines", () => {
      // `// don't` opens a quote that has no partner on that line. Bounding
      // ' and " to a single line keeps the damage inside the comment, which is
      // discarded anyway.
      const source = ["const a = 1; // don't do this", "if (p.role === 'admin') { boom(); }"].join(
        '\n'
      );
      expect(stripComments(source)).toContain("p.role === 'admin'");
    });

    it('D-3: preserves line numbers across removed block comments', () => {
      const source = ['const a = 1;', '/* one', ' two', ' three */', 'const b = 2;'].join('\n');
      const out = stripComments(source);
      expect(out.split('\n')).toHaveLength(source.split('\n').length);
      expect(out.split('\n')[4]).toContain('const b = 2;');
    });

    it('does NOT let a glob inside a line comment swallow the code after it', () => {
      // The exact input that broke the purge guard's predecessor.
      const source = [
        '// scope note: app/admin/** is unauthenticated',
        "import { requireAdmin } from '@/lib/admin/requireAdminRoute';",
        '/** a real docblock */',
        'const x = 1;',
      ].join('\n');

      const code = stripComments(source);

      expect(code).toContain('requireAdmin');
      expect(code).toContain('const x = 1;');
      expect(code).not.toContain('a real docblock');
    });

    it('keeps string literals intact', () => {
      expect(stripComments("const s = 'AdminAccessService';")).toContain('AdminAccessService');
    });
  });

  describe('stripSqlComments', () => {
    it('removes `--` line comments', () => {
      expect(stripSqlComments('-- CREATE POLICY x ON profiles USING (role)')).not.toContain('POLICY');
    });

    it('keeps real SQL', () => {
      expect(stripSqlComments('CREATE POLICY a ON t;')).toContain('CREATE POLICY');
    });

    it('strips the real commented rollback block that would otherwise trip R5', () => {
      // 20260920a REPLACED the profiles.role policies. Their text survives only
      // as a commented rollback. If this assertion ever fails, R5 is scanning
      // documentation and its result is meaningless.
      const f = SQL_FILES.find((s) =>
        s.file.endsWith('20260920a_lock_system_settings_and_pricing_rls.sql')
      );
      expect(f).toBeDefined();
      expect(f!.sql).not.toMatch(/CREATE POLICY[\s\S]{0,400}profiles[\s\S]{0,200}role/i);
    });
  });

  describe('blankStringLiterals', () => {
    it('blanks contents but preserves offsets', () => {
      const src = 'const a = "xx{yy}zz"; {';
      const out = blankStringLiterals(src);
      expect(out.length).toBe(src.length);
      expect(out.indexOf('{')).toBe(src.lastIndexOf('{'));
    });

    it('preserves newlines so line numbers survive', () => {
      const out = blankStringLiterals('const a = `x\ny`;');
      expect(out.split('\n')).toHaveLength(2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────

  describe('scanHandlers (W-7 — both export forms, fail closed on the rest)', () => {
    it('finds `export async function GET`', () => {
      const r = scanHandlers('export async function GET(req) { return 1; }');
      expect(r.handlers.map((h) => h.name)).toEqual(['GET']);
      expect(r.unparseable).toEqual([]);
    });

    it('finds `export const GET = async () => {}` — the form a naive scan misses', () => {
      // This is the W-7 fixture. All 44 current admin routes use the function
      // form, so a scanner that only knew that form would pass this file
      // silently while it sat ungated.
      const r = scanHandlers('export const GET = async (req) => { return 1; };');
      expect(r.handlers.map((h) => h.name)).toEqual(['GET']);
      expect(r.unparseable).toEqual([]);
    });

    it('finds a typed `export const POST: RouteHandler = …`', () => {
      const r = scanHandlers('export const POST: Handler = async () => { return 1; };');
      expect(r.handlers.map((h) => h.name)).toEqual(['POST']);
    });

    it('FLAGS a handler re-exported via `export { … }`', () => {
      const r = scanHandlers('const h = async () => {}; export { h as GET };');
      expect(r.unparseable.join(' ')).toContain('GET');
    });

    it('FLAGS `export *`', () => {
      const r = scanHandlers("export * from './shared';");
      expect(r.unparseable.join(' ')).toContain('export *');
    });

    it('is not fooled by a brace inside a string literal', () => {
      const r = scanHandlers('export async function GET() { const s = "}"; return s; }');
      expect(r.handlers).toHaveLength(1);
      expect(r.handlers[0].body).toContain('return s;');
    });

    it('does NOT mistake a destructured `{ params }` for the handler body', () => {
      // The exact defect this guard shipped with and that its second run against
      // real files caught. Next.js dynamic routes declare
      //   export async function PATCH(request: NextRequest, { params }: { params: { id: string } })
      // so the first `{` after the handler name is a DESTRUCTURING PATTERN.
      // Matching it "extracted" a body of `{ params }` and reported
      // app/api/admin/messages/[id]/route.ts#PATCH as ungated when it was gated.
      //
      // A false positive is the safe direction — but a guard that cries wolf on
      // correct code is a guard someone switches off.
      const src = [
        'export async function PATCH(',
        '  request: NextRequest,',
        '  { params }: { params: { id: string } }',
        ') {',
        '  const gate = await requireAdmin(requestLogger);',
        '  return gate;',
        '}',
      ].join('\n');

      const r = scanHandlers(src);
      expect(r.handlers).toHaveLength(1);
      expect(r.handlers[0].body).toContain('requireAdmin(');
      expect(r.unparseable).toEqual([]);
    });

    it('handles the same destructuring in the `export const` form', () => {
      const src =
        'export const DELETE = async (req: NextRequest, { params }: { params: { id: string } }) => {\n' +
        '  const gate = await requireAdmin(requestLogger);\n' +
        '  return gate;\n' +
        '};';
      const r = scanHandlers(src);
      expect(r.handlers).toHaveLength(1);
      expect(r.handlers[0].body).toContain('requireAdmin(');
    });

    it('FLAGS `export const GET = someHandler` — a reference it cannot trace', () => {
      const r = scanHandlers('export const GET = sharedHandler;');
      expect(r.handlers).toHaveLength(0);
      expect(r.unparseable.join(' ')).toContain('GET');
    });

    it('proves the real dynamic admin routes parse and are seen as gated', () => {
      // Belt and braces: assert against the actual on-disk file, not a fixture.
      const real = ADMIN_API_ROUTES.find((s) => s.file === 'app/api/admin/messages/[id]/route.ts');
      expect(real).toBeDefined();
      const r = scanHandlers(real!.code);
      expect(r.handlers.map((h) => h.name).sort()).toEqual(['DELETE', 'PATCH']);
      expect(r.handlers.every((h) => h.body.includes('requireAdmin('))).toBe(true);
    });

    // ── D-1 (HIGH) ────────────────────────────────────────────────────────
    it('D-1: does NOT attribute an unrelated function body to an HOC-wrapped handler', () => {
      // SA's exact reproduction. The old parser matched `withAuth(`'s parens,
      // then took the NEXT `{` in the file — which belongs to `unrelated()` —
      // saw `requireAdmin(` in it, and passed an UNGATED admin route while
      // reporting nothing as unparseable. Both safety nets failed at once.
      const src = [
        'export const GET = withAuth(async (req) => { return 1; });',
        'function unrelated() { const g = requireAdmin(l); return 2; }',
      ].join('\n');

      const r = scanHandlers(src);

      expect(r.handlers).toEqual([]);
      expect(r.unparseable.join(' ')).toContain('GET');
      // The specific regression: it must never be reported as a gated handler.
      expect(r.handlers.some((h) => h.body.includes('requireAdmin('))).toBe(false);
    });

    it('D-1: an HOC-wrapped handler is FLAGGED by R1 rather than silently passing', () => {
      // The end-to-end consequence, at the rule level rather than the parser
      // level: unparseable ⇒ the fail-closed assertion reports the file.
      const { handlers, unparseable } = scanHandlers(
        'export const POST = withAuth(async (req) => { return 1; });'
      );
      expect(handlers).toHaveLength(0);
      expect(unparseable.length).toBeGreaterThan(0);
    });

    it('D-1: an expression-bodied arrow handler is flagged, not assumed gated', () => {
      // `=> NextResponse.json(…)` has no braced body, so there is nowhere a
      // gate could live. Guessing "no body, no violation" would be permissive.
      const r = scanHandlers('export const GET = async (req) => NextResponse.json({ ok: true });');
      expect(r.handlers).toEqual([]);
      expect(r.unparseable.join(' ')).toContain('GET');
    });

    // ── D-2 (MEDIUM) ──────────────────────────────────────────────────────
    it('D-2: does NOT mistake a braced RETURN TYPE for the handler body', () => {
      // Same family as the `{ params }` bug, one position later: paren-matching
      // skipped the parameter list, but nothing skipped `: Promise<{…}>`, so a
      // correctly gated handler was reported ungated.
      const src =
        'export async function POST(req: NextRequest): Promise<{ ok: boolean }> {\n' +
        '  const gate = await requireAdmin(requestLogger);\n' +
        '  return gate;\n' +
        '}';

      const r = scanHandlers(src);

      expect(r.handlers).toHaveLength(1);
      expect(r.handlers[0].name).toBe('POST');
      expect(r.handlers[0].body).toContain('requireAdmin(');
      expect(r.handlers[0].body).not.toContain('ok: boolean');
      expect(r.unparseable).toEqual([]);
    });

    it('D-2: handles a braced return type on the `export const` arrow form too', () => {
      const src =
        'export const GET = async (req: NextRequest): Promise<{ data: string[] }> => {\n' +
        '  const gate = await requireAdmin(requestLogger);\n' +
        '  return gate;\n' +
        '};';

      const r = scanHandlers(src);

      expect(r.handlers).toHaveLength(1);
      expect(r.handlers[0].body).toContain('requireAdmin(');
      expect(r.handlers[0].body).not.toContain('data: string[]');
    });

    it('D-Q3: flags a generic handler that the strict forms cannot match', () => {
      // QA's fixture. The file has one parseable GATED handler, so the
      // zero-handler net never fired and the generic GET was invisible to R1.
      const src = [
        'export async function POST(request: NextRequest) {',
        '  const gate = await requireAdmin(logger);',
        '  return gate;',
        '}',
        'export async function GET<T>(request: NextRequest) {',
        '  return NextResponse.json({ leaked: true });',
        '}',
      ].join('\n');

      const r = scanHandlers(src);
      expect(r.handlers.map((h) => h.name)).toEqual(['POST']);
      expect(r.unparseable.join(' ')).toContain('GET');
    });

    it('D-Q3: flags `export let GET;` assigned later', () => {
      const r = scanHandlers('export let GET;\nGET = async () => { return 1; };');
      expect(r.handlers).toHaveLength(0);
      expect(r.unparseable.join(' ')).toContain('GET');
    });

    it('D-Q3: does not double-report a handler the strict forms already flagged', () => {
      const r = scanHandlers('export const GET = withAuth(async (req) => { return 1; });');
      const mentions = r.unparseable.filter((u) => u.startsWith('GET:'));
      expect(mentions).toHaveLength(1);
    });

    it('D-1/D-2: every real admin route still parses with no unparseable exports', () => {
      // The on-disk assertion that stops these fixes rotting. If a future edit
      // to the parser starts guessing again, or stops recognising a real shape,
      // this fails against the actual tree rather than a synthetic string.
      const broken: string[] = [];
      for (const s of ADMIN_API_ROUTES) {
        const { handlers, unparseable } = scanHandlers(s.code);
        if (unparseable.length > 0) broken.push(`${s.file}: ${unparseable.join('; ')}`);
        if (handlers.length === 0) broken.push(`${s.file}: no handler parsed`);
      }
      expect(broken).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────

  describe('R1 — every admin route handler uses the one gate', () => {
    it('no ungated handler outside the allow-list', () => {
      const offenders: string[] = [];

      for (const s of ADMIN_API_ROUTES) {
        const { handlers } = scanHandlers(s.code);
        for (const h of handlers) {
          const id = `${s.file}#${h.name}`;
          if (R1_ALLOWED.has(id)) continue;
          /*
           * D-Q1 (QA, 2026-09-20): scan the STRING-BLANKED body.
           *
           * `extractBracedBody` returns un-blanked source on purpose, because
           * for R2 and R4 a violation inside a string literal must still count
           * — a false positive costs a conversation, a false negative costs the
           * platform.
           *
           * For R1 that polarity is INVERTED. Here a string makes a non-gate
           * look like a gate, so an ungated handler containing
           *   const note = 'this route should call requireAdmin( someday';
           * passed. Comments were already safe (`SCANNED` stores
           * `stripComments(raw)`); strings were not.
           *
           * Only R1 gets the blanked text. R2/R4 keep the raw body.
           */
          if (!blankStringLiterals(h.body).includes('requireAdmin(')) {
            offenders.push(
              `${id} — does not call requireAdmin(). Add ` +
                "`const gate = await requireAdmin(requestLogger); if (gate instanceof NextResponse) return gate;` " +
                'as the FIRST statement, before any body parse, read, write or job trigger.'
            );
          }
        }
      }

      expect(offenders).toEqual([]);
    });

    it('fails closed on any admin route whose handler exports cannot be parsed', () => {
      // A shape guard that silently skips what it cannot understand is the
      // failure mode that matters.
      const offenders: string[] = [];

      for (const s of ADMIN_API_ROUTES) {
        const { handlers, unparseable } = scanHandlers(s.code);
        for (const u of unparseable) offenders.push(`${s.file} — ${u}`);
        if (handlers.length === 0 && unparseable.length === 0) {
          offenders.push(
            `${s.file} — no HTTP handler found at all. Either this route is dead ` +
              '(delete it) or the guard failed to parse it (fix the guard). ' +
              'A silent skip here is an ungated admin route.'
          );
        }
      }

      expect(offenders).toEqual([]);
    });

    it('D-Q1: a `requireAdmin(` that occurs only inside a STRING LITERAL is not a gate', () => {
      // QA's exact fixture. `extractBracedBody` returns un-blanked source (right
      // for R2/R4, where a violation in a string still counts), so this ungated
      // handler read as gated and the guard went green.
      const src = [
        "import { NextRequest, NextResponse } from 'next/server';",
        'export async function PUT(request: NextRequest) {',
        "  const note = 'this route should call requireAdmin( someday';",
        '  return NextResponse.json({ leaked: note });',
        '}',
      ].join('\n');

      const { handlers } = scanHandlers(src);
      expect(handlers).toHaveLength(1);

      // The raw body still contains the token — that is why the old check passed…
      expect(handlers[0].body).toContain('requireAdmin(');
      // …and the blanked body, which R1 now uses, correctly does not.
      expect(blankStringLiterals(handlers[0].body)).not.toContain('requireAdmin(');
    });

    it('D-Q1: blanking does not hide a REAL gate that sits near a string', () => {
      // The fix must not overshoot: a genuine gate alongside string literals
      // must still be seen, or R1 starts crying wolf on correct routes.
      const src = [
        'export async function POST(request: NextRequest) {',
        '  const gate = await requireAdmin(requestLogger);',
        '  if (gate instanceof NextResponse) return gate;',
        "  const label = 'requireAdmin( in a string';",
        '  return NextResponse.json({ label });',
        '}',
      ].join('\n');

      const { handlers } = scanHandlers(src);
      expect(blankStringLiterals(handlers[0].body)).toContain('requireAdmin(');
    });

    it('recognises the canonical gate in a route that uses it', () => {
      // Proves R1 can pass, not just fail — otherwise the previous assertion
      // could be green for the wrong reason.
      const canonical = ADMIN_API_ROUTES.find(
        (s) => s.file === 'app/api/admin/system-config/route.ts'
      );
      expect(canonical).toBeDefined();
      const { handlers } = scanHandlers(canonical!.code);
      expect(handlers.length).toBeGreaterThan(0);
      expect(handlers.every((h) => h.body.includes('requireAdmin('))).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────

  describe('R2 — no route file resolves admin identity for itself', () => {
    it('no route.ts anywhere imports AdminAccessService outside the allow-list', () => {
      // Repo-wide ON PURPOSE. Scoping this to app/api/admin/ would mean that
      // the day after slice 4 removes the seven known inline copies, nothing
      // stops copy #8 appearing in a different folder.
      const offenders = ROUTE_FILES.filter(
        (s) => s.code.includes('AdminAccessService') && !R2_ALLOWED.has(s.file)
      ).map(
        (s) =>
          `${s.file} — imports AdminAccessService directly. Route handlers must use ` +
          '`requireAdmin` from @/lib/admin/requireAdminRoute, which owns the 401/403 ' +
          'semantics and the fail-closed behaviour.'
      );

      expect(offenders).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────

  describe('R3 — no route handlers inside the /admin page tree', () => {
    it('no route.ts under app/admin/**', () => {
      // Route handlers are NOT wrapped by layouts, so one here would bypass the
      // page guard entirely — the single real escape from layout inheritance.
      const offenders = ROUTE_FILES.filter(
        (s) => s.file.startsWith('app/admin/') && !R3_ALLOWED.has(s.file)
      ).map(
        (s) =>
          `${s.file} — route handlers are not wrapped by layouts, so this bypasses the ` +
          'app/admin/layout.tsx guard. Move it under app/api/admin/ and gate it with requireAdmin.'
      );

      expect(offenders).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────

  describe('R4 — no access decision reads a user-writable role', () => {
    it('does not fire on LLM message roles', () => {
      // `role: 'user' | 'assistant' | 'system'` appears hundreds of times in
      // this repo. A rule that flags those gets switched off within a week.
      expect(ROLE_COMPARISON.test("messages.push({ role: 'system', content })")).toBe(false);
      expect(ROLE_COMPARISON.test("{ role: 'assistant', content: text }")).toBe(false);
      expect(ROLE_COMPARISON.test("if (m.role === 'user') return m.content;")).toBe(false);
    });

    it('does not fire on organisation membership roles (W-10)', () => {
      // `organization_members.role` is a different and legitimate concept.
      expect(ROLE_COMPARISON.test(".select('id, role').eq('organization_id', orgId)")).toBe(false);
      expect(ROLE_COMPARISON.test("if (member.role === 'owner') return true;")).toBe(false);
    });

    it('fires on a profiles.role access decision', () => {
      expect(ROLE_COMPARISON.test("if (profile.role === 'admin') return true;")).toBe(true);
      expect(ROLE_COMPARISON.test("if (p.role !== 'admin') return forbidden();")).toBe(true);
      expect(ROLE_COMPARISON.test(".eq('role', 'admin')")).toBe(true);
    });

    it("fires on the `.filter(a => a.role === 'super_admin')` shape (W-8)", () => {
      // admin-users/route.ts:211 (was :197 before slice 1 inserted the gate —
      // D-Q4). Named explicitly because an allow-list that
      // under-counts its own occurrences is an allow-list that under-tests.
      expect(ROLE_COMPARISON.test("adminUsers.filter(a => a.role === 'super_admin').length")).toBe(true);
    });

    it("fires on `['admin','super_admin'].includes(role)`", () => {
      expect(ROLE_COMPARISON.test("['admin', 'super_admin'].includes(profile.role)")).toBe(true);
    });

    it('no access decision on a role value outside the allow-list', () => {
      const offenders = SCANNED.filter(
        (s) => ROLE_COMPARISON.test(s.code) && !R4_ALLOWED.has(s.file)
      ).map(
        (s) =>
          `${s.file} — makes an access decision from a \`role\` value. profiles.role is ` +
          'USER-WRITABLE (PUT /api/user/profile copies it straight from the request body), ' +
          'so it can never be an authorization input. Use AdminAccessService / requireAdmin.'
      );

      expect(offenders).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────

  describe('R5 — no RLS policy keyed on profiles.role (FR-17)', () => {
    it('fires on a synthetic uncommented policy', () => {
      const fixture =
        'CREATE POLICY "x" ON public.system_settings_config FOR ALL ' +
        "USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));";
      expect(hasProfilesRolePolicy(stripSqlComments(fixture))).toBe(true);
    });

    it('does not fire on the same text inside a comment', () => {
      const fixture =
        "--   CREATE POLICY \"x\" ON t USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.role = 'admin'));";
      expect(hasProfilesRolePolicy(stripSqlComments(fixture))).toBe(false);
    });

    it('no migration defines an RLS policy referencing profiles.role', () => {
      const offenders = SQL_FILES.filter(
        (s) => hasProfilesRolePolicy(s.sql) && !R5_ALLOWED.has(s.file)
      ).map(
        (s) =>
          `${s.file} — defines an RLS policy referencing profiles.role. The database-side ` +
          'admin predicate is public.is_platform_admin() (FR-15). profiles.role is user-writable.'
      );

      expect(offenders).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────

  describe('R6 — the /admin page tree is guarded on the server', () => {
    it('app/admin/layout.tsx is a Server Component that calls the page guard', () => {
      const layout = 'app/admin/layout.tsx';
      if (R6_ALLOWED.has(layout)) {
        // Allow-listed: slice 5 is PARKED, so this is not "until" anything.
        // Assert the file still exists so the
        // exemption cannot outlive its subject.
        expect(fs.existsSync(path.join(REPO_ROOT, layout))).toBe(true);
        return;
      }

      const scanned = SCANNED.find((s) => s.file === layout);
      expect(scanned).toBeDefined();
      expect(scanned!.isClient).toBe(false);
      expect(scanned!.code).toContain('requireAdminPage');
    });
  });
});

/**
 * True if the SQL (already comment-stripped) contains a `CREATE POLICY`
 * statement that references both `profiles` and `role`.
 *
 * Statement-scoped rather than file-scoped: a migration may legitimately
 * mention `profiles` and, elsewhere, `role`.
 */
export function hasProfilesRolePolicy(sql: string): boolean {
  const statements = sql.split(';');
  return statements.some(
    (st) => /CREATE\s+POLICY/i.test(st) && /\bprofiles\b/i.test(st) && /\brole\b/i.test(st)
  );
}
