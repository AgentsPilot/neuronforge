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

import {
  ADMIN_LAYOUT_GUARD_FAILURE,
  distinctSources,
  ADMIN_LAYOUT_UNPARSEABLE,
  adminLayoutGuardVerdict,
  CORPUS_FLOORS,
  DISABLED_ADMIN_LAYOUTS,
  GUARDED_ADMIN_LAYOUTS,
  guardsItselfFirst,
  isClientComponent,
  NOT_A_COMPONENT,
  SELF_GUARDING_SERVER_PAGE,
  SERVER_LAYOUT_WITH_USE_CLIENT_IN_A_COMMENT,
} from '@/tests/helpers/admin-page-guard';
import { blankStringLiterals, stripComments } from '@/tests/helpers/source-scan';

/*
 * Re-exported because this file's own unit tests below exercise it, and because
 * `stripComments` and rule R1 (D-Q1) both depend on it. It MOVED to
 * tests/helpers/source-scan.ts when the page-guard assertion needed the same
 * primitive: SA defeated that assertion with a decoy component signature inside
 * a template literal, which is D-Q1 one file over. One implementation, imported
 * by both rules — a second copy of "what counts as a string" is how two guards
 * drift apart.
 */
export { blankStringLiterals, stripComments };

const REPO_ROOT = path.join(__dirname, '..', '..', '..');

/** Everything an admin access decision can live in. */
const TS_SCAN_ROOTS = ['app', 'lib', 'components', 'hooks'];

/** Where RLS policies live. */
const SQL_SCAN_ROOTS = [path.join('supabase', 'migrations'), path.join('supabase', 'SQL Scripts')];

/*
 * ── QA D3 (High): scope, split by WHERE not just by name ───────────────────
 * This was one flat set matched against `e.name` at EVERY depth, so any
 * directory called `build`, `dist` or `coverage` was invisible to the guard —
 * anywhere. QA put an unguarded server page at `app/admin/build/page.tsx` and an
 * ungated handler at `app/api/admin/build/route.ts` and both passed 106/106,
 * while the identical files in normally-named directories went red. `build` is a
 * perfectly ordinary route segment.
 *
 * Inherited, not introduced here: `origin/main` has the identical single set and
 * the identical `walk`, so its required check has the same blind spot today.
 *
 * Now: tool output that can appear at any depth is skipped by name; the
 * repo-root build directories are skipped ONLY at the root, where they are
 * actually build output.
 */
const SKIP_ANY_DEPTH = new Set(['node_modules', '.git', '.next', '.claude']);
const SKIP_AT_ROOT_ONLY = new Set(['dist', 'build', 'coverage', 'out', '.vercel']);

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

/**
 * R8 — every render entry point under `app/admin/**` is a client component.
 *
 * Numbered 8, not 7, ON PURPOSE. **R7 is reserved** for the parked inverted
 * rule described in this file's header ("is everything that BEHAVES like an
 * admin route gated, wherever it lives?"). Re-using the number would retire a
 * documented parked decision by accident, and the next reader would find R7 in
 * the header and no R7 in the code.
 */
const R8_PARKED: ReadonlyArray<Exemption> = [
  /*
   * EMPTY, and it has to stay that way for the rule to mean anything.
   *
   * `app/admin/layout.tsx` is NOT exempted here — it is excluded by the rule
   * itself, because R6 REQUIRES it to be a Server Component. An exemption and
   * a structural exclusion are different things and are kept different: the
   * exclusion is one named path in the rule body, visible at the point of use.
   */
];
const R8_PERMANENT: ReadonlyArray<Exemption> = [];

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
  R8: { parked: 0, permanent: 0 },
} as const;

const RULE_LISTS = {
  R1: { parked: R1_PARKED, permanent: R1_PERMANENT },
  R2: { parked: R2_PARKED, permanent: R2_PERMANENT },
  R3: { parked: R3_PARKED, permanent: R3_PERMANENT },
  R4: { parked: R4_PARKED, permanent: R4_PERMANENT },
  R5: { parked: R5_PARKED, permanent: R5_PERMANENT },
  R6: { parked: R6_PARKED, permanent: R6_PERMANENT },
  R8: { parked: R8_PARKED, permanent: R8_PERMANENT },
} as const;

const R1_ALLOW = [...R1_PARKED, ...R1_PERMANENT];
const R2_ALLOW = [...R2_PARKED, ...R2_PERMANENT];
const R3_ALLOW = [...R3_PARKED, ...R3_PERMANENT];
const R4_ALLOW = [...R4_PARKED, ...R4_PERMANENT];
const R5_ALLOW = [...R5_PARKED, ...R5_PERMANENT];
const R6_ALLOW = [...R6_PARKED, ...R6_PERMANENT];
const R8_ALLOW = [...R8_PARKED, ...R8_PERMANENT];

const ALL_EXEMPTIONS = [
  ...R1_ALLOW,
  ...R2_ALLOW,
  ...R3_ALLOW,
  ...R4_ALLOW,
  ...R5_ALLOW,
  ...R6_ALLOW,
  ...R8_ALLOW,
];

const R1_ALLOWED = new Set(R1_ALLOW.map((e) => e.id));
const R2_ALLOWED = new Set(R2_ALLOW.map((e) => e.id));
const R3_ALLOWED = new Set(R3_ALLOW.map((e) => e.id));
const R4_ALLOWED = new Set(R4_ALLOW.map((e) => e.id));
const R5_ALLOWED = new Set(R5_ALLOW.map((e) => e.id));
const R6_ALLOWED = new Set(R6_ALLOW.map((e) => e.id));
const R8_ALLOWED = new Set(R8_ALLOW.map((e) => e.id));

// ───────────────────────────────────────────────────────────────────────────
// Scanning primitives
// ───────────────────────────────────────────────────────────────────────────

function walk(dir: string, exts: RegExp): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_ANY_DEPTH.has(e.name)) return [];
      // Depth matters: `build` directly under the repo root is build output;
      // `app/admin/build` is a route segment. See SKIP_AT_ROOT_ONLY.
      const isRootChild = path.dirname(full) === REPO_ROOT;
      if (isRootChild && SKIP_AT_ROOT_ONLY.has(e.name)) return [];
      return walk(full, exts);
    }
    return exts.test(e.name) ? [full] : [];
  });
}

/**
 * An INDEPENDENT enumeration, with no skip logic at all.
 *
 * R8's anti-vacuity check compares the scanned set against a second listing. QA
 * pointed out that while both sides call `walk`, a bug in `walk`'s skip list
 * moves both sides together and the equality proves nothing — which is exactly
 * how D3 hid. This function shares no code with `walk`, so a skip-list mistake
 * shows up as a mismatch instead of cancelling out.
 *
 * Safe to run without skips because it is only ever pointed at `app/admin`,
 * which contains no `node_modules`.
 */
function listEveryFileUnconditionally(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const found: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else found.push(full);
    }
  }
  return found;
}

/*
 * `stripComments` MOVED to tests/helpers/source-scan.ts (QA D1/D2, High).
 *
 * The version that lived here blanked STRINGS FIRST and then looked for comments
 * in the scaffold. An apostrophe inside a one-line block comment —
 * `/* the admin user's list *\/` — made the blanker swallow the closing `*\/`,
 * so the comment never closed and the scan deleted real code up to the next
 * `*\/` anywhere later in the file. Silently, and in the permissive direction:
 * QA hid an early return from R6 that way and got 106/106 green with the admin
 * shell rendered to any caller.
 *
 * It was never branch-local. Over the 2,524 files this guard scans,
 * `origin/main`'s copy truncates 16 files / 64,700 characters (including
 * `BusinessProfileRepository.ts`, −36,546) — so R1-R5 have been deciding on
 * mangled source in production CI, not just here.
 *
 * The replacement is one left-to-right pass that recognises comments BEFORE
 * strings. Its unit tests stay below, with QA's regressions added.
 */

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
    /*
     * STRIPPED, not raw, and anchored to the start of the file.
     *
     * Against raw source a block comment one of whose lines begins with
     * `'use client'` — plausible prose in a file explaining why it is NOT a
     * client component — made this true, and R6 then FAILED ON A CORRECT FILE.
     * The `/m` flag made it worse by accepting the directive anywhere.
     *
     * Single-sourced with the page-guard helper so the two cannot disagree.
     */
    isClient: isClientComponent(raw, stripComments),
  };
});

const ROUTE_FILES = SCANNED.filter((s) => ROUTE_FILE_RE.test(s.file));
const ADMIN_API_ROUTES = ROUTE_FILES.filter((s) => s.file.startsWith('app/api/admin/'));

// ── R8 inputs — the `/admin` page tree's render entry points ───────────────

/** The one file R6 requires to be a Server Component: the guard itself. */
const ADMIN_GUARD_LAYOUT = 'app/admin/layout.tsx';

/**
 * Every file Next.js will RENDER ON THE SERVER for a URL under `/admin`.
 *
 * Not just `page.tsx`. A nested `app/admin/foo/layout.tsx` renders INSIDE the
 * segment the header bypass skips, so a Server Component there would leak
 * exactly as a server page would. `template`, `default`, `loading`, `error` and
 * `not-found` are in the list for the same reason — none exists today, which is
 * precisely when a rule is cheap to write and expensive to retrofit.
 */
const ADMIN_RENDER_ENTRY_RE =
  /\/(page|layout|template|default|loading|error|not-found|global-error)\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/;

const ADMIN_RENDER_ENTRIES = SCANNED.filter(
  (s) => s.file.startsWith('app/admin/') && ADMIN_RENDER_ENTRY_RE.test(s.file)
);

const ADMIN_PAGES = ADMIN_RENDER_ENTRIES.filter((s) => /\/page\.[a-z]+$/.test(s.file));

/** An `async` default export — the shape of a Server Component that awaits data. */
const ASYNC_DEFAULT_EXPORT =
  /export\s+default\s+async\s+(?:function|\(|[A-Za-z_$])|export\s+default\s+async\s*\([^)]*\)\s*=>/;

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

    it('D3: a source directory named `build` under app/ is NOT skipped', () => {
      /*
       * QA D3 (High). `SKIP_DIRS` matched `e.name` at every depth, so
       * `app/admin/build/page.tsx` and `app/api/admin/build/route.ts` were
       * invisible: an unguarded page and an ungated handler both passed 106/106.
       * `build` is an ordinary route segment. Inherited — `origin/main` has the
       * identical set and the identical walk.
       *
       * Asserted as the RULE, because no such directory exists today: the two
       * sets must not overlap, and the root-only names must not be skipped at
       * depth.
       */
      expect([...SKIP_AT_ROOT_ONLY].filter((d) => SKIP_ANY_DEPTH.has(d))).toEqual([]);
      for (const name of ['build', 'dist', 'coverage', 'out']) {
        expect(SKIP_ANY_DEPTH.has(name)).toBe(false);
      }
      // And the tool directories stay skipped wherever they appear.
      for (const name of ['node_modules', '.next', '.git', '.claude']) {
        expect(SKIP_ANY_DEPTH.has(name)).toBe(true);
      }
    });

    it('D3: R8\'s two sides of the walk-equality share no code', () => {
      // If both sides used `walk`, a skip-list bug would move them together and
      // the equality would prove nothing — which is how D3 hid.
      const independent = listEveryFileUnconditionally(path.join(REPO_ROOT, 'app', 'admin'));
      expect(independent.length).toBeGreaterThan(0);
      expect(listEveryFileUnconditionally.toString()).not.toContain('SKIP_ANY_DEPTH');
      expect(listEveryFileUnconditionally.toString()).not.toContain('walk(');
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
    /*
     * F1 (SA, final re-check). The precedence fix was correct but incomplete:
     * with no REGEX-LITERAL state, `/[/*]/` opens a phantom block comment and
     * everything to the next `*<slash>` disappears. SA demonstrated a
     * `profiles.role` decision vanishing from R4's input, and
     * `AnswerRenderer.ts` losing 22,686 of its 40,701 characters.
     *
     * It fails CLOSED for R6, but R2 and R4 decide on this text, so a deletion
     * is a MISSED VIOLATION for them. Hence one more state in the same pass.
     */
    it('F1: a regex literal containing a comment opener is not a comment', () => {
      const src = ['const rx = /[/*]/;', "const decision = p.role === 'admin';"].join('\n');
      const out = stripComments(src);
      expect(out).toContain('const rx = /[/*]/;');
      expect(out).toContain("p.role === 'admin'");
    });

    it('F1: an access decision after a regex literal survives into R4 input', () => {
      // The shape SA used: without the regex state the decision was deleted, so
      // R4 could not see the violation it exists to catch.
      const src = [
        'const slug = name.replace(/[^a-z]/g, "-");',
        "if (profile.role === 'admin') grantEverything();",
      ].join('\n');
      expect(stripComments(src)).toContain("profile.role === 'admin'");
    });

    it('F1: division is still division, not a regex', () => {
      const src = 'const ratio = total / count / 2;';
      expect(stripComments(src)).toBe(src);
    });

    it('F1: a JSX closing tag is not a regex opener', () => {
      const src = 'const el = <div>{x}</div>;';
      expect(stripComments(src)).toBe(src);
    });

    it('F2: a comment inside a template interpolation IS stripped', () => {
      // `${ … }` is real code, so a comment in there is a comment. Without this
      // the text survived into the scanned source, which for R1 means a
      // `requireAdmin(` mentioned in a comment could read as a gate.
      const src = 'const t = `a ${/* gone */ b} c`;';
      const out = stripComments(src);
      expect(out).not.toContain('gone');
      expect(out).toContain('const t = `a ${');
      expect(out).toContain('} c`;');
    });

    it('F2: template TEXT is still left alone', () => {
      const src = 'const t = `keep // this and /* this */ too`;';
      expect(stripComments(src)).toBe(src);
    });

    it('F1: a CRLF source keeps its line count', () => {
      const src = ['/* one */', 'const a = 1;', '// two', 'const b = 2;'].join('\r\n');
      const out = stripComments(src);
      expect(out.split('\n').length).toBe(src.split('\n').length);
      expect(out).toContain('const a = 1;');
      expect(out).toContain('const b = 2;');
    });

    /*
     * QA D1/D2 (High). These four are the regression: an apostrophe inside a
     * comment used to open a phantom string, swallow the closing `*<slash>`, and
     * delete real code up to the next one anywhere later in the file.
     *
     * Not branch-local — `origin/main`'s copy truncates 16 files / 64,700
     * characters of the corpus this guard scans. Measured, not reasoned.
     */
    it("D1: an apostrophe inside a one-line block comment does not eat the code below it", () => {
      const src = ["/* the admin user's list */", 'const keep = 1;', 'const alsoKeep = 2;'].join('\n');
      const out = stripComments(src);
      expect(out).toContain('const keep = 1;');
      expect(out).toContain('const alsoKeep = 2;');
      expect(out).not.toContain('admin');
    });

    it('D1: an unbalanced apostrophe cannot reach a later block comment', () => {
      const src = ["/* don't */", 'const a = 1;', '/* second */', 'const b = 2;'].join('\n');
      const out = stripComments(src);
      expect(out).toContain('const a = 1;');
      expect(out).toContain('const b = 2;');
    });

    it('D1: a `//` inside a string literal is not a comment', () => {
      expect(stripComments("const url = 'https://example.com/x';")).toContain('https://example.com/x');
    });

    it('D1: line numbers survive — one newline out per newline in', () => {
      const src = ['/*', " * user's note", ' */', 'const a = 1;'].join('\n');
      expect(stripComments(src).split('\n').length).toBe(src.split('\n').length);
    });

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
    /*
     * ── F-2: what this used to assert, and why it was not enough ───────────
     * `expect(scanned!.code).toContain('requireAdminPage')` — which the IMPORT
     * LINE satisfies. SA deleted the call from `app/admin/layout.tsx` and this
     * REQUIRED check stayed green, four times over.
     *
     * The property is now the one slice 2 had already reached and this gate had
     * not: **the guard call is the FIRST STATEMENT of the layout body**, it IS
     * the call rather than merely containing it, and the identifier comes from
     * the real module. The rule and its fixtures live in
     * `tests/helpers/admin-page-guard.ts` — ONE implementation, imported by this
     * gate and by `app/admin/business-os-llm/__tests__/source.guard.test.ts`.
     *
     * Extracted rather than copied because the drift already happened once, in
     * the direction that matters: the weaker copy was the one with authority
     * over merges. Read that module's header before changing the rule; it
     * carries all eight known mutations and SA's ruling that the durable fix is
     * a behavioural test, not a fifth regex.
     */
    it('app/admin/layout.tsx is a Server Component whose FIRST statement is the page guard', () => {
      const layout = ADMIN_GUARD_LAYOUT;
      if (R6_ALLOWED.has(layout)) {
        // Allow-listed: slice 5 is PARKED, so this is not "until" anything.
        // Assert the file still exists so the
        // exemption cannot outlive its subject.
        expect(fs.existsSync(path.join(REPO_ROOT, layout))).toBe(true);
        return;
      }

      const scanned = SCANNED.find((s) => s.file === layout);
      expect(scanned).toBeDefined();

      // A Server Component, or it could not await anything at all.
      expect(scanned!.isClient).toBe(false);

      // Read RAW and stripped by this file's own unit-tested stripper. Passing
      // the stripper is REQUIRED by the helper's signature: on raw source a
      // `//`-commented call passes, because the comment carries its own `;`.
      const verdict = adminLayoutGuardVerdict(
        fs.readFileSync(path.join(REPO_ROOT, layout), 'utf-8'),
        stripComments
      );

      expect({
        layout,
        ...verdict,
        ifGenuinelyUnguarded: ADMIN_LAYOUT_GUARD_FAILURE,
        ifParsedIsFalse: ADMIN_LAYOUT_UNPARSEABLE,
      }).toEqual({
        layout,
        // Echoed on BOTH sides, so it PRINTS on failure without being
      // CONSTRAINED. Pinning the literal text rejected the correct
      // `const admin = await requireAdminPage();` and
      // `const { id } = await requireAdminPage();` on the real file --
      // the same false-positive class SA found three of. The property is
      // the verdict, not the spelling.
      firstStatement: verdict.firstStatement,
        parsed: true,
        firstStatementIsTheGuard: true,
        importsCanonicalGuard: true,
        shadowsTheGuard: false,
        guarded: true,
        ifGenuinelyUnguarded: ADMIN_LAYOUT_GUARD_FAILURE,
        ifParsedIsFalse: ADMIN_LAYOUT_UNPARSEABLE,
      });
    });

    it('the guard is not wrapped in a try/catch, which would swallow the redirect', () => {
      // `requireAdminPage` redirects by THROWING — the hazard the layout names
      // in its own comment. Asserted separately so the failure says so.
      const scanned = SCANNED.find((s) => s.file === ADMIN_GUARD_LAYOUT);
      expect(scanned!.code).not.toMatch(/try\s*\{[\s\S]*?requireAdminPage/);
    });

    /*
     * The rule proved against the inputs it must REJECT — the five from F-1,
     * DEF-S2-1 and DEF-S2-2, plus the three SA found still passing the v3 rule
     * (`&&`, the ternary, a locally shadowed no-op).
     *
     * These run here as well as in the screen suite ON PURPOSE. The extraction
     * removed the duplicated RULE; running the shared fixtures in both callers
     * is what proves the two callers still agree, and it puts the mutation
     * evidence inside the check that actually gates merges.
     */
    it.each(DISABLED_ADMIN_LAYOUTS.map((v) => [v.name, v] as const))(
      'a guard that is %s FAILS this rule',
      (_name, variant) => {
        const verdict = adminLayoutGuardVerdict(variant.source, stripComments);

        expect({ name: variant.name, guarded: verdict.guarded }).toEqual({
          name: variant.name,
          guarded: false,
        });

        // And it is caught by the part of the verdict that is SUPPOSED to catch
        // it, so no sub-rule can go dead behind another that happens to cover
        // the same fixture.
        expect({
          name: variant.name,
          caughtBy: variant.caughtBy,
          caught: verdict[variant.caughtBy],
        }).toEqual({
          name: variant.name,
          caughtBy: variant.caughtBy,
          caught: variant.caughtBy === 'shadowsTheGuard',
        });
      }
    );

    /*
     * And against the inputs it must ACCEPT. Not symmetry for its own sake: a
     * rule that rejects a CORRECT layout turns `main` red for every PR in the
     * repo, which is the single likeliest way to get a required check switched
     * off. `const admin = await requireAdminPage();` is a legitimate future
     * edit — the function returns the admin's identity.
     */
    it.each(GUARDED_ADMIN_LAYOUTS.map((v) => [v.name, v.source] as const))(
      'a correctly guarded layout (%s) PASSES this rule',
      (_name, source) => {
        const verdict = adminLayoutGuardVerdict(source, stripComments);
        expect({
          name: _name,
          parsed: verdict.parsed,
          guarded: verdict.guarded,
          firstStatement: verdict.firstStatement,
          ifThisFails: ADMIN_LAYOUT_UNPARSEABLE,
        }).toEqual({
          name: _name,
          parsed: true,
          guarded: true,
          firstStatement: verdict.firstStatement,
          ifThisFails: ADMIN_LAYOUT_UNPARSEABLE,
        });
      }
    );

    it('a server layout whose COMMENT mentions use client is still a Server Component', () => {
      // `isClient` used to read RAW source with /m, so a block comment line
      // beginning `'use client'` — prose explaining why the directive must NOT
      // be added — failed R6 on a correct file. A false positive on a required
      // check is worse than the hole it closes: the cheap fix is to switch the
      // check off.
      expect(
        isClientComponent(SERVER_LAYOUT_WITH_USE_CLIENT_IN_A_COMMENT, stripComments)
      ).toBe(false);
      expect(
        adminLayoutGuardVerdict(SERVER_LAYOUT_WITH_USE_CLIENT_IN_A_COMMENT, stripComments).guarded
      ).toBe(true);
    });

    it('a file with no default-exported component fails CLOSED rather than vacuously', () => {
      const verdict = adminLayoutGuardVerdict(NOT_A_COMPONENT, stripComments);
      expect({ parsed: verdict.parsed, first: verdict.firstStatement, guarded: verdict.guarded }).toEqual(
        { parsed: false, first: null, guarded: false }
      );
    });

    it('the mutation corpus may only GROW', () => {
      /*
       * The rule and the inputs that give it meaning live in one module, so a
       * future edit could quietly delete the fixtures and leave a green suite
       * that proves nothing. Same spirit as the exemption caps above: the
       * corpus is allowed to grow, never to shrink, and shrinking it is a
       * visible act in a diff.
       */
      // D10: counted by DISTINCT source, so the floor cannot be met by pasting
      // one fixture twice.
      expect(distinctSources(DISABLED_ADMIN_LAYOUTS)).toBeGreaterThanOrEqual(CORPUS_FLOORS.disabled);
      expect(distinctSources(GUARDED_ADMIN_LAYOUTS)).toBeGreaterThanOrEqual(CORPUS_FLOORS.guarded);
      expect(distinctSources(DISABLED_ADMIN_LAYOUTS)).toBe(DISABLED_ADMIN_LAYOUTS.length);
      expect(distinctSources(GUARDED_ADMIN_LAYOUTS)).toBe(GUARDED_ADMIN_LAYOUTS.length);
      expect(new Set(DISABLED_ADMIN_LAYOUTS.map((v) => v.name)).size).toBe(DISABLED_ADMIN_LAYOUTS.length);

      // Every disabled fixture must be attributed to a sub-rule that exists.
      for (const variant of DISABLED_ADMIN_LAYOUTS) {
        expect(['firstStatementIsTheGuard', 'shadowsTheGuard', 'importsCanonicalGuard']).toContain(
          variant.caughtBy
        );
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────

  describe('R8 — every /admin render entry point is a client component (OI-21)', () => {
    /*
     * ── The exploit this rule contains ─────────────────────────────────────
     * Measured 2026-09-24. An UNAUTHENTICATED request carrying a crafted
     * `Next-Router-State-Tree` header, claiming it is already inside `/admin`,
     * returns 200 with no redirect (see OI-21 for the exact curl). React
     * re-uses the cached layout segment, so `app/admin/layout.tsx` is not
     * re-rendered and `requireAdminPage()` NEVER RUNS. The caller does not have
     * to have entered the subtree — it only has to SAY it did, in a header it
     * controls. R6 is therefore a check that can be skipped, not a boundary.
     *
     * Nothing leaks today, and the reason is two properties:
     *
     *   1. every `/admin` render entry point is `'use client'`, so no admin page
     *      has server-rendered data in its payload to leak;  ← ASSERTED HERE
     *   2. every `/api/admin/*` handler requires an admin, which is the actual
     *      security boundary.                                 ← R1 asserts this
     *
     * Property 1 was hand-verified across 22 pages and asserted NOWHERE. The day
     * one admin page becomes a Server Component, or fetches on the server, it
     * breaks — silently, with every check still green. This rule turns that into
     * a red required check.
     *
     * ── If this is failing on your PR ──────────────────────────────────────
     * You have added a server-rendered file under `app/admin/`. Do not exempt
     * it. Either add `'use client'` and fetch through an admin API route (which
     * R1 gates), or close the header bypass properly — a middleware check on the
     * `/admin` path prefix runs before routing and cannot be skipped by a router
     * header. Exempting it re-opens an already-demonstrated unauthenticated
     * request.
     *
     * Tracked as OI-21 in docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md.
     */
    const OI21 =
      'OI-21: a crafted Next-Router-State-Tree header returns 200 for an /admin URL with ' +
      'requireAdminPage() never running (demonstrated unauthenticated, no cookies). That is ' +
      'harmless ONLY because no /admin render entry point is server-rendered UNGUARDED, so there ' +
      'is no server-fetched data in the payload to disclose. TWO WAYS TO FIX IT, both accepted by ' +
      'this rule: (1) add `use client` and fetch through a requireAdmin-gated API route, or ' +
      '(2) keep it a Server Component and `await requireAdminPage()` as this component’s OWN ' +
      'FIRST statement — option 2 is immune to the bypass, because the crafted header re-uses the ' +
      'cached /admin LAYOUT segment and never skips the page’s own render. Note the guard must be ' +
      'the FIRST statement: a guard that runs after a repository read is still an offender. ' +
      'Do not exempt the file. ' +
      'IF YOU BELIEVE THE FILE IS ALREADY CORRECT — a self-guarding page this rule is ' +
      'not recognising — that may be a FALSE POSITIVE in the parser rather than a ' +
      'fault in your code: it lives in tests/helpers/admin-page-guard.ts, it documents ' +
      'its limits, and the fix is to extend it and add your shape to ' +
      'GUARDED_ADMIN_LAYOUTS. Never satisfy this by deleting the assertion.';

    it('the scan sees EVERY render entry point that exists on disk', () => {
      /*
       * The anti-vacuity check, expressed as the PROPERTY rather than as a
       * count. It used to be `>= 22`, which was that day's exact census — so
       * deleting or relocating a single admin page turned a REQUIRED check red
       * for a change that had nothing wrong with it. A count floor cannot tell
       * "the tree shrank legitimately" from "the scanner stopped finding
       * things", and only the second is a defect.
       *
       * What actually matters is that the scanner's view equals the
       * filesystem's, so nothing can hide from the rule, plus a floor of ONE so
       * a renamed directory cannot make the rule vacuous.
       */
      // Enumerated WITHOUT `walk`, so a skip-list bug cannot move both sides
      // of this equality together (QA D3).
      const onDisk = listEveryFileUnconditionally(path.join(REPO_ROOT, 'app', 'admin'))
        .map(rel)
        .filter((f) => CODE_EXT.test(f) && ADMIN_RENDER_ENTRY_RE.test(f))
        .sort();

      expect(ADMIN_RENDER_ENTRIES.map((s) => s.file).sort()).toEqual(onDisk);
      expect(onDisk).toContain(ADMIN_GUARD_LAYOUT);
      expect(ADMIN_PAGES.length).toBeGreaterThan(0);
    });

    /*
     * ── The one server-rendered shape this rule must ACCEPT ────────────────
     * A page that awaits `requireAdminPage()` as its OWN first statement is
     * IMMUNE to the bypass: the crafted header makes React re-use the cached
     * `/admin` LAYOUT segment, and nothing about it skips the PAGE's render. So
     * such a page cannot be rendered past its own guard.
     *
     * Rejecting it would have made this rule forbid the safest thing an author
     * could write, and push them towards the client-component shape whose
     * safety depends on a property held somewhere else entirely. That is the
     * wrong incentive for a required check to create.
     *
     * Not an exemption and not allow-listed: it is the rule's second accepting
     * clause, computed from the file, and it uses the SAME first-statement
     * verdict R6 uses — so all ten disabling shapes apply to it too. A page
     * that only LOOKS self-guarding is still an offender.
     */
    const isServerRendered = (s: (typeof ADMIN_RENDER_ENTRIES)[number]) =>
      s.file !== ADMIN_GUARD_LAYOUT && !R8_ALLOWED.has(s.file) && !s.isClient;

    const selfGuards = (file: string) =>
      guardsItselfFirst(fs.readFileSync(path.join(REPO_ROOT, file), 'utf-8'), stripComments);

    it('every render entry point under app/admin is a client component, or guards itself', () => {
      const offenders = ADMIN_RENDER_ENTRIES.filter(
        (s) =>
          // The guard layout itself MUST be a Server Component — R6 requires it,
          // and it renders no data of its own. A structural exclusion at the
          // point of use, deliberately NOT an allow-list entry: the two are
          // different things and conflating them is how an exemption starts
          // looking architectural.
          isServerRendered(s) && !selfGuards(s.file)
      ).map((s) => `${s.file} — server-rendered file in the /admin page tree. ${OI21}`);

      expect(offenders).toEqual([]);
    });

    it('no render entry point under app/admin awaits on the server unguarded', () => {
      // The same property from the other side: an `async` component is the shape
      // that awaits server data. Independent of the `use client` check, so
      // deleting the directive AND adding an await fails twice, not once — and
      // subject to the same self-guarding clause, since a page that awaits its
      // own guard first is exactly what we want an author to write.
      const offenders = ADMIN_RENDER_ENTRIES.filter(
        (s) => isServerRendered(s) && ASYNC_DEFAULT_EXPORT.test(s.code) && !selfGuards(s.file)
      ).map((s) => `${s.file} — async default export (a Server Component that awaits). ${OI21}`);

      expect(offenders).toEqual([]);
    });

    it('a self-guarding server page is ACCEPTED, and a lookalike is not', () => {
      // Proved on fixtures, because no such page exists in the tree today — so
      // the accepting clause is pinned before someone relies on it.
      expect(guardsItselfFirst(SELF_GUARDING_SERVER_PAGE, stripComments)).toBe(true);

      for (const variant of DISABLED_ADMIN_LAYOUTS) {
        expect({ name: variant.name, accepted: guardsItselfFirst(variant.source, stripComments) }).toEqual(
          { name: variant.name, accepted: false }
        );
      }
    });

    it('R8 is genuinely zero — nothing is exempted from it', () => {
      // Worth its own assertion: "green" here must mean the tree is clean, not
      // that the offenders were allow-listed.
      expect(R8_PARKED.length + R8_PERMANENT.length).toBe(0);
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
