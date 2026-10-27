# Requirement: Admin Environment View, EC-6: Supabase Project Label

> **Last Updated**: 2026-10-27

**Created by:** BA
**Date:** 2026-10-27
**Status:** Approved. Scope approved by the user in chat 2026-10-27; SA approved with changes the same day (see SA Review). The SA conditions bind the build.
**Parent:** [ADMIN_ENVIRONMENT_CONFIGURATION_VIEW_REQUIREMENT.md](/docs/requirements/ADMIN_ENVIRONMENT_CONFIGURATION_VIEW_REQUIREMENT.md) (§3.2 masking, §3.3 catalogue, §4.3 diagnostics, §10.1 SA rulings). Every parent rule and SA condition applies here unless this document says otherwise.

## Overview

The Database group of `/admin/environment` shows `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_URL` reduced to their origin (SA-C4), which reads as `https://<ref>.supabase.co`. An admin cannot tell from that string which Supabase project the deployment talks to. EC-6 adds a small project table in code that maps a project ref to a display label and a role, shows that label beside the two URL rows, and adds one diagnostic when the two URLs name different projects. The label is derived only from an origin the page already shows, so no new value leaves the server.

> **Public repository.** This document follows the parent's rule: it contains no project reference, no value, and no remark about how any deployment is configured or which variables are set. The table's initial entry was given by the user in chat and goes into code only (subject to OQ-5).

---

## 1. Progress

| # | Slice | Status | PR | Notes |
|---|---|---|---|---|
| 0 | This requirement | ✅ Approved 2026-10-27: SA approved with changes (OQ-1..OQ-6, SA-L1..L9) | — | Scope approved by the user in chat |
| 6 | EC-6: Supabase project label + `supabase-url-mismatch` diagnostic | 🟡 In PR 2026-10-27: SA code review approved with notes, QA PASS, user approved the diff; auto-merge on | [#543](https://github.com/AgentsPilot/neuronforge/pull/543) | Full cycle: the route's response shape changes. Size 🟢 about half a day |

---

## 2. User Stories

- As a platform admin, I want the Supabase URL rows to name the project they point at, so that I know which database this deployment uses without decoding a project ref.
- As a platform admin, I want to be told when the browser URL and the server URL name different projects, so that I catch a split configuration before it causes confusing data.
- As a platform admin, I want an unrecognised project to read "Unknown project", so that a deployment pointing somewhere unexpected stands out.

---

## 3. Functional Requirements

### 3.1 The project table

1. **FR-6.1** A typed constant (working name `SUPABASE_PROJECTS`) maps a project ref to `{ label, role }`. It sits next to the catalogue under `lib/admin/environment/` (exact file: OQ-2). Pure data, type imports only, like `catalogue.ts`.
2. **FR-6.2** The label is **chosen by us, by role**. It is never read from Supabase: reading project names needs a management API token, which is out of scope (§5).
3. **FR-6.3** Refs are not secret: they already ship to every browser inside `NEXT_PUBLIC_SUPABASE_URL`. The table holds refs and our own labels only, never a key or any other value.
4. **FR-6.4** Initial content: **one entry**, the project the user named in chat. Suggested label wording is in OQ-1; SA rules on it. Projects the user plans to retire, or whose purpose is not settled, are deliberately not listed. A future project's ref is added to the table, in its own small PR, once that project exists.

### 3.2 The label on the two URL rows

5. **FR-6.5** Only the rows `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_URL` can carry a label. The set of names is a constant; no other `url` row is affected.
6. **FR-6.6** A row gets a label **only when its `display` is `shown`** (it already passed the `url` shape check and SA-C4's origin reduction). The ref is taken from that shown origin text, never from the raw value.
7. **FR-6.7** Matching is exact: the origin's host is `<ref>.supabase.co`, where `<ref>` is one or more lowercase letters and digits, with no port and no further subdomain. Recommended scheme: `https` only (OQ-6).

| Shown origin | Label |
|---|---|
| Host `<ref>.supabase.co`, ref in the table | The table's label (and role, per OQ-1) |
| Host `<ref>.supabase.co`, ref not in the table | "Unknown project" (tone: OQ-3) |
| Any other host (a custom domain, a local `127.0.0.1:54321`, a port, an extra label) | No label at all |
| Row not `shown` (Not set, Hidden, classification error) | No label at all |

On a Local deployment that runs the Supabase CLI stack, no label is the expected result, not a fault.

8. **FR-6.8** The response gains one optional, closed field on the row (suggested shape, Dev and SA settle it in the workplan): `supabaseProject?: { kind: 'known'; label: string; role: string } | { kind: 'unknown' }`. The label and role come from the table, never from the value. The ref itself is **not** a new field: it is already inside the shown origin.
9. **FR-6.9** The page shows the label beside the origin in the Value cell, as words, never colour alone. Field picking (SA-C5) and the client boundary (SA-C11) are unchanged: the page still imports only `lib/admin/environment-types.ts`.

### 3.3 New diagnostic: `supabase-url-mismatch`

10. **FR-6.10** A new code, `supabase-url-mismatch`, extends the closed `EnvDiagnostic` set from §4.3 / EC-4. It is raised when **both** rows are `shown` and their origins differ (compared as the shown origin strings).
11. **FR-6.11** It is not raised when either row is unset, hidden, or errored: there is nothing displayable to compare. Recommended: the code is attached to both rows, and counted once as a mismatch (OQ-4).
12. **FR-6.12** It discloses nothing new: both origins are already on the page. It is built from no characters of the value, so M-7 holds without a new exception. The catalogue role for `SUPABASE_URL` already says the two must name the same project.
13. **FR-6.13** The chip reads, for example, "Points at a different project than the other Supabase URL", amber, in words.

### 3.4 Fails closed

14. **FR-6.14** The label and the mismatch are computed after classification, from the row's `display` only. A hidden, masked or unset URL never gets a label and never takes part in a mismatch. An error while deriving the label drops the label (and logs name plus error class only, SA-C6); it never changes the row's display.
15. **FR-6.15** No new value leaves the server, nothing new is logged, and the audit row is unchanged except, if SA rules so, one more diagnostic count (OQ-4).

---

## 4. Non-Functional Requirements

- **Security:** no new value class; label text is ours. The SA-C7 serialisation gate stays green unchanged, and gains one fixture: a credential-bearing Supabase-host URL whose label appears while no 8-character substring of the credential does.
- **Public-repo hygiene (SA-C14):** workplan, QA report and PR description quote no ref, no origin and no label as seen on a real deployment; QA records the live check as pass or fail.
- **Performance:** one string match per row on two rows; no I/O, no network, no database.
- **Accessibility:** label and mismatch are text; the chip is a `StatusChip` with words.
- **No new pattern:** a constant beside the catalogue and one more closed diagnostic code, reusing EC-4's machinery.

---

## 5. Out of Scope / Future Roadmap

- Reading project names or status from Supabase (needs a management API token and a server-held secret).
- Labelling any URL other than the two Supabase rows.
- Comparing projects across environments (parent §9).
- A drift guard that fails when a deployment's ref is missing from the table: "Unknown project" is the signal, not a CI rule.

---

## 6. Acceptance Criteria and Tests

- [ ] **Classifier unit tests** (`classifyEnvironment.test.ts`, made-up refs only):
  - [ ] known ref: both rows carry the table's label;
  - [ ] unknown ref: the row reads "Unknown project";
  - [ ] non-Supabase host (custom domain, `127.0.0.1:54321`, a port, an extra subdomain, upper case): no label;
  - [ ] hidden URL (fails the url shape or the global rejects) and unset URL: no label;
  - [ ] mismatch: two different Supabase origins raise `supabase-url-mismatch`;
  - [ ] one of the two unset, or one hidden: no mismatch;
  - [ ] same origin on both: no mismatch.
- [ ] **Serialisation and leak test** stays green, with the extra fixture from §4.
- [ ] **Render test** (`page.render.test.tsx`): the label shows beside the origin; "Unknown project" shows; a row with no label shows none; the mismatch chip shows in words.
- [ ] **Types:** `EnvDiagnostic` gains exactly one code; existing EC-4 tests stay green.
- [ ] QA confirms the happy path and one failure path before commit; the live admin check after deploy is recorded with no values.

**Size and path:** 🟢 about half a day. **Full cycle** (Dev workplan, SA review, Dev, SA code review, QA), because the route's response shape changes.

---

## 7. Open Questions for SA

Each has a recommended answer. None needs the user unless SA says so.

- [ ] **OQ-1** Exact label wording, and whether the role shows as separate text. *Recommended: a short label (the project's name as we call it) plus the role as a second, muted phrase; SA rules on the wording the user suggested in chat.* (raised by: BA | status: open)
- [ ] **OQ-2** Does the table live in `catalogue.ts` or its own file? *Recommended: its own file, `lib/admin/environment/supabaseProjects.ts`, pure data, so adding a project is a one-file diff that does not touch the catalogue or its drift guard.* (raised by: BA | status: open)
- [ ] **OQ-3** "Unknown project": amber (a diagnostic code) or neutral text? *Recommended: neutral text, not a diagnostic. Local and fresh previews may legitimately show it, and an amber that is routinely expected trains admins to ignore amber.* (raised by: BA | status: open)
- [ ] **OQ-4** Does the mismatch count in the EC-4 KPI tiles, and how is it counted? *Recommended: yes, inside "Values to check" with its sub-line extended, counted once per mismatch (not once per row), plus one more count in the audit row's counts.* (raised by: BA | status: open)
- [ ] **OQ-5** The parent forbids any project reference in documents of this stream, yet the table puts a ref and a role-based label into public source code. A label that says which project is live also says how a deployment is configured. *Recommended: SA confirms a ref in code is acceptable (it already ships to browsers), and rules that the label names the project's intended role only, with no wording about which deployment currently uses it.* (raised by: BA | status: open)
- [ ] **OQ-6** Accept `http` as well as `https` for the match? *Recommended: `https` only; a plain-http Supabase host is unexpected and should get no label.* (raised by: BA | status: open)

---

## 8. Notes on Integration Points

| Area | Effect |
|---|---|
| `lib/admin/environment/` | New project table (OQ-2); label and mismatch derived in `classifyEnvironment.ts` after each row's display is decided |
| `lib/admin/environment-types.ts` | One optional row field (FR-6.8) and one new `EnvDiagnostic` code; possibly one count (OQ-4) |
| `app/api/admin/environment/route.ts` | No code change expected; its response shape changes through the types |
| `app/admin/environment/` | Value cell shows the label; `environmentDisplay.ts` gains the mismatch chip words; KPI sub-line per OQ-4 |
| Database, audit, logging | No table, no migration; audit counts only per OQ-4 |

---

## SA Review (2026-10-27)

**Reviewed by SA, 2026-10-27**
**Status:** APPROVED WITH CHANGES. The conditions below are binding on the Dev workplan; none needs the user. Read against `classifyEnvironment.ts`, `catalogue.ts`, `environment-types.ts`, `environmentDisplay.ts`, `EnvironmentView.tsx`, `EnvironmentKpis.tsx` and the route.

### Rulings on the open questions

| # | Ruling |
|---|---|
| OQ-1 | Two parts, both from our code. **Label** is the project's name as we call it, a plain string in the table. **Role** is a closed union in `environment-types.ts` (initially `'development-staging' \| 'production'`), and its words live in a `Record` in `environmentDisplay.ts`, like `DIAGNOSTIC_WORDS`, so a new role cannot compile without words. The cell reads: origin, then label, then the role words muted. Initial entry: label **`AgentsPilot-dev`**, role `'development-staging'`, shown as **"Development and staging"**. The `'production'` role words are **"Production"**. |
| OQ-2 | Its own file, `lib/admin/environment/supabaseProjects.ts`. Pure data with type-only imports, like `catalogue.ts`. The page must never import it; the existing client-boundary guard already enforces this and must stay green. |
| OQ-3 | Neutral text, not a diagnostic and not amber. It reads "Unknown project", in the same muted style as the role words. |
| OQ-4 | Yes, it is counted inside "Values to check". New count `supabaseUrlMismatch: number` on `EnvironmentCounts` (0 or 1), set from the pair and **not** from the per-row `tally` (the code sits on two rows, so the tally would give 2). The tile value adds it. The sub-line adds ", 1 Supabase address mismatch" only when the count is above 0. `firstVisible` includes the new code. The audit row gets the count for free through the existing `...payload.counts` spread, which is accepted. `isCounts` in `environmentDisplay.ts` must list the new key. |
| OQ-5 | Accepted. A ref in source code discloses nothing new, because it already ships in every browser bundle through `NEXT_PUBLIC_SUPABASE_URL`. The label and the code comments may state **only the project's intended role**. They must never say which deployment, environment, branch or Vercel target uses the project now, or "live", "current" or "temporary". Allowed: "Development and staging". Not allowed: "used by production for now", "Preview points here". The same applies to the PR description, commit message, workplan and QA report: they quote no ref and no real origin, and do not say which project a real deployment showed (SA-C14). |
| OQ-6 | `https` only. Match the shown origin string against the exact pattern `^https://([a-z0-9]+)\.supabase\.co$`. |

### Further rulings

1. **SA-L1 (security: derive only from the shown origin). Approved.** The label input is `display.text` of a `shown` row, which has already passed the global gates and SA-C4's origin reduction. The output is our own string plus a closed role, so M-7 needs no exception and SA-C5 still holds: the value never becomes a field. The only new fact is "this origin's ref is or is not in our table". That fact is about our table, not about the value. **Accepted.**
2. **SA-L2 (correction to FR-6.7 and §6).** `new URL()` lower-cases the host and drops a default `:443` before the origin is shown. So an upper-case input, or an explicit `:443`, **does** get a label, matching the lower-case origin the page displays. Remove "upper case" from the no-label test bullet. Replace it with a test that an upper-case input shows the lower-case origin with its label. Keep a non-default port (for example `:8443`) in the no-label list.
3. **SA-L3 (prototype-safe lookup, High).** The ref pattern accepts `constructor`, `toString` and similar names. The table must be a `ReadonlyMap<string, …>`, or every lookup must use `Object.prototype.hasOwnProperty.call`. A plain `obj[ref]` lookup is rejected. Add a test that `https://constructor.supabase.co` reads "Unknown project".
4. **SA-L4 (FR-6.14, error handling).** Derivation is one anchored regex plus one Map lookup, and **cannot throw**. Do not wrap it in try/catch and do not add a `rowErrors` entry. The route's log line for row errors says "row masked", which would be false for a label error. Drop the error clause of FR-6.14. Keep its fail-closed clause: no label unless `shown`.
5. **SA-L5 (response shape).** Approved: `supabaseProject?: { kind: 'known'; label: string; role: EnvSupabaseRole } | { kind: 'unknown' }`. Set the field only on the two named rows, and only when the host pattern matches. When no label applies, omit it; do not send `null`. Build it field by field (no spread of the table entry). Extend `isRow` in `environmentDisplay.ts`: the field is absent, or it has a closed `kind`, and for `known` the `label` is a string of 1 to 60 characters and the `role` is a key of the role-words map. Any other value fails the guard, and the page shows its existing fallback. The route needs no code change.
6. **SA-L6 (mismatch words and scope).** FR-6.10 compares *any* two shown origins, so two different custom domains also raise it. That is correct: the catalogue role says they must match. But the chip must not claim "different project". Words: **"Not the same address as the other Supabase URL"**, with `detail: null`. The code goes on both rows, appended **after** the existing codes so the fixed order holds, and is independent of `checkedAgainst`, like `surrounding-whitespace`. Uncategorised rows never carry it.
7. **SA-L7 (types).** Adding the code to `EnvDiagnostic` forces a new key in the classifier's `tally` record. Initialise it, but do not read it for the count (OQ-4). `DIAGNOSTIC_WORDS` gains its entry, and compile-time exhaustiveness covers the rest.
8. **SA-L8 (tests). Add to §6:**
   - a known ref on only one row while the other is unset (label shown, no mismatch);
   - `http://<ref>.supabase.co` (no label; mismatch if the other row is `https`);
   - the `constructor` case (SA-L3);
   - `supabaseUrlMismatch` is 1, not 2, and the "Values to check" tile value and sub-line;
   - `isEnvironmentViewPayload` rejects an unknown `kind`, an unknown role, and a non-string or over-long label;
   - the serialisation fixture from §4 (a URL with user-info on a Supabase host): the label appears and no 8-character substring of the credential appears.

   All refs in tests are made up, and none may be a real ref.
9. **SA-L9 (no drift guard).** I agree with §5: "Unknown project" is the signal. A future project is added in its own small PR. That PR is code-only, with no requirement change unless the role union grows.

### Approval
[x] Requirement approved with the changes above. Proceed to the Dev workplan, which quotes SA-L1 to SA-L9 and the OQ table.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-27 | Initial draft | BA scoped EC-6 from the user's chat approval: a code-side project table (ref to label and role), the label on the two Supabase URL rows when the shown host is exactly `<ref>.supabase.co`, "Unknown project" for an unlisted ref, no label otherwise, the `supabase-url-mismatch` diagnostic, fail-closed derivation from the shown origin only, tests, half-day full-cycle sizing, and six questions for SA. |
| 2026-10-27 | SA review: approved with changes | OQ-1..OQ-6 ruled (closed role union with words on the page side, own data file, neutral "Unknown project", mismatch counted once inside Values to check, role-only wording in public code, https only); SA-L1..SA-L9 added: host is normalised before matching, prototype-safe lookup, no try/catch, payload guard for the new field, mismatch chip words, extra tests. |
