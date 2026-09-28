# Workplan: Business OS Credit Deduction — Slice 1 (Label every AI action)

> **Last Updated**: 2026-09-28

**Developer:** Dev
**Requirement:** [BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md): §3 "Reusing what exists", §12 **Slice 1 — Label every AI action**, FR-4, AC-9 (the guard half), and the SA Review (2026-09-28): SQ-12, SA-S12, KI-4, OI-1.
**Supersedes (in part):** [BUSINESS_OS_CREDIT_DEDUCTION_D0_WORKPLAN.md](/docs/workplans/BUSINESS_OS_CREDIT_DEDUCTION_D0_WORKPLAN.md). D-0 bundled what are now slices 1 and 2 and put the labels in a new, separate module. This workplan covers slice 1 only and declares the labels **on the existing `AiActionType`**. Verified facts and the SA rulings from D-0 that still apply are reused and cited.
**Branch:** `feature/business-os-credit-deduction` (worktree `neuronforge-llm-deduction`, HEAD `88d9063e`; the branch was created before this workplan, not by Dev)
**Date:** 2026-09-28
**Status:** Code complete — SA code review APPROVED, QA PASS WITH NOTES (2026-09-28); awaiting user diff approval, then RM commit

## Overview

Slice 1 gives every Business OS AI action type a short, declared set of facts that later slices need: its area, who it faces (the owner or the owner's clients), whether it is setup AI, whether it is charged, a plain-language diary label in English, Hebrew and Spanish, whether a template fallback exists, and whether it is dormant. The facts are declared **next to the existing `AiActionType` union in `lib/business-os/llm/aiActionAudit.ts`**, not in a new list or module. A type-level check makes it impossible to add an action type without its facts. This check is enforced in CI by `typecheck:bos-llm`.

Slice 1 is **metadata plus a guard, and nothing else**. It changes no runtime behaviour: `runAiAction`, the audit entry, pricing, the entitlements module and every call site are untouched. It adds no charge table, no migration and no UI. The one client-facing type, lead reply, already has a no-AI template fallback (`pickFallbackCandidate`), so it is declared **`exists`** (SA C-1); nothing is built for it here.

---

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [Implementation Approach](#2-implementation-approach)
3. [Files to Create / Modify](#3-files-to-create--modify)
4. [Task List](#4-task-list)
5. [Test Plan](#5-test-plan)
6. [Guardrails and Out of Scope](#6-guardrails-and-out-of-scope)
7. [Risks](#7-risks)
8. [Open Questions for SA](#8-open-questions-for-sa)
9. [Flagged Items (console.* and deprecated code)](#9-flagged-items-console-and-deprecated-code)
10. [SA Workplan Review](#10-sa-workplan-review)
11. [QA Testing Report](#11-qa-testing-report)
12. [Commit Info](#12-commit-info)
13. [Change History](#13-change-history)

---

## 1. Analysis Summary

Every path, type and function below was checked in this worktree at `7120adee` and re-checked at `88d9063e` (the only difference is a doc commit).

| Concern | As-built | Evidence |
|---|---|---|
| The action type union | `AiActionType`: 16 string literals, type-only (no runtime list). Two are dormant: `website_section_field_rewrite` (Layer 1 KI-1) and `website_block_enrichment` (Layer 1 KI-3) | `lib/business-os/llm/aiActionAudit.ts:37-54` |
| Stale header (SA-S12) | Says "NOT WIRED YET … nothing calls `runAiAction` in production". It is wired at 16 call sites: 14 live, plus the 2 dormant types' sites, which have no production trigger | `aiActionAudit.ts:12-14`; call sites in the next row |
| Area and trigger at each call site | `chat_turn` chat/user (`app/api/business-os/chat-v4/route.ts:394-399`); `insight_run` insights/scheduled (`app/api/cron/insight-detect/route.ts:372-373`); `briefing_narration` briefing/caller's trigger (`lib/business-os/briefing/BriefingStore.ts:68-71`); `intake_form_generation`, `intake_question_inference` intake/user (`app/api/intake/form/generate/route.ts:54-55`, `app/api/intake/form/infer-question/route.ts:75-76`); `onboarding_build` website/user (`app/api/onboarding/build/route.ts:999-1000`); `onboarding_turn` onboarding/user (`app/api/onboarding/chat/route.ts:220-225`); `website_field_regenerate`, `website_testimonial_enhance`, `website_full_site`, `website_landing_page` website/user (`app/api/website/blocks/[blockId]/regenerate/route.ts:77-78`, `app/api/website/enhance-testimonial/route.ts:40-41`, `app/api/website/generate-from-profile/route.ts:84-85`, `app/api/website/landing-pages/generate/route.ts:115-116`); `image_generation` images/user (`app/api/website/media/generate/route.ts:54-55`); `chat_website_operation` website/user (`lib/business-os/bizql/mutate/MutateExecutor.ts:831-832`); `lead_reply_recommendation` leads/**external** (`lib/services/LeadAlertService.ts:344-345`); dormant `website_block_enrichment`, `website_section_field_rewrite` website/user (`lib/services/WebsiteBlockEnrichmentService.ts:272-273`, `lib/services/WebsiteSectionService.ts:529-530`) | grep of `runAiAction(` at `7120adee`. SA confirmed the same 16 pairs in the D-0 review |
| Lead reply **has** a template fallback (OI-1, corrected by SA C-1) | The model only picks **which** of the owner's own reply candidates to send (`buildLeadReplyCandidates`); it never writes the reply. Every failure (switched off, empty response, unusable shape, index out of range, a throw) falls through to `pickFallbackCandidate`, a deterministic ladder with no model. `LeadAlertService` returns before the AI action when there are no candidates, so its `!recommendation` branch is unreachable in practice | `lib/business-os/leads/LeadReplyRecommender.ts:15-21`, `:86-89`, `:100`; `lib/business-os/leads/leadReplyCandidates.ts:103-138`; `lib/services/LeadAlertService.ts:329-335` |
| Audience per type | Uniform per type: `lead_reply_recommendation` is client-facing, and every other type is owner-facing. The list keyed by `AiActionType` is the right home for these facts | SA ruling SQ-12 (requirement, SA Review) |
| The label pattern to follow | `Labels { en; he; es }`, declared in a types-only file with **no imports** | `lib/business-os/entitlements/types.ts:80-85`; used inline, e.g. `config/catalog.ts:294` |
| `as const satisfies Record<…>` precedent | Already the pattern for declared config in Business OS | `lib/business-os/entitlements/config/catalog.ts:515`, `config/cohorts.ts:216`, `config/chatActionMap.ts:141` |
| Area type | `BosLlmArea` from `BOS_LLM_AREAS` (8 areas). Already imported by `aiActionAudit.ts` | `lib/business-os/llm/callCatalog.ts:37-47`; `aiActionAudit.ts:30` |
| The enforced gate | `typecheck:bos-llm` scopes every file under `lib/business-os/llm/` and `lib/business-os/entitlements/`. The baseline has **no** entry for any `llm/` file, so any new type error in `aiActionAudit.ts` fails the gate. `bos-llm-typecheck.yml` runs it (and the literal gate) on every PR, with no `paths:` filter | `scripts/typecheck-bos-llm.ts:102-106`; `scripts/typecheck-bos-llm.baseline.json`; `.github/workflows/bos-llm-typecheck.yml:19`, `:105`, `:121` |
| Jest in CI | **No CI job runs the `lib/business-os/llm` Jest suites.** The only Business OS Jest in CI is `test:bos-entitlements` (entitlements, repositories, migrations, purge invariants), which does not cover `llm/`. So a Jest guard here is local-only (SA D-0 C-3) | `package.json:21`; `.github/workflows/bos-entitlements.yml:116` |
| Server-only module | `aiActionAudit.ts` imports `AuditTrailService` (Supabase client, `next/server`, `ArchiveRepository`) and `usageScope` (`node:async_hooks`). **No `'use client'` module may import it, even indirectly** (Standard 6, the PR #53 build failure). Today no client module does: `app/admin/audit-trail/page.tsx` only names it in a comment (`:103`) | `aiActionAudit.ts:23-30`; `lib/services/AuditTrailService.ts:5-20`; `.claude/skills/bos-llm-call-standards/SKILL.md:111` |
| Entitlements hooks not to touch | `ai.actions` is `audience: 'mixed'`, `atLimit: 'by_call_site_audience'`. `ENFORCEMENT_POINTS` lives in `config/enforcementPoints.ts`. `balance.ts` is `ALWAYS_SUFFICIENT` | `lib/business-os/entitlements/config/catalog.ts:293-305`; `lib/business-os/entitlements/config/enforcementPoints.ts`; `lib/business-os/entitlements/balance.ts` |

---

## 2. Implementation Approach

### 2.1 Where the facts live: on `AiActionType`, in `aiActionAudit.ts`

Per the user's reuse decision and FR-4 (as refined on 2026-09-28), the facts are declared **directly below the `AiActionType` union**, in the same file. There is no new module and no second list. The union stays exactly as it is, and it remains the source of truth for what an action type is. The declaration is checked against it.

**File:** `lib/business-os/llm/aiActionAudit.ts` (proposed addition, directly after the union)
```typescript
import type { Labels } from '@/lib/business-os/entitlements/types';

/** Who an action's output reaches: the owner, or the owner's clients (FR-19). */
export type AiActionAudience = 'owner' | 'client';

/**
 * What the charge, the diary and the limit need to know about one action type
 * (deduction layer FR-4). Nothing reads it yet: slices 3, 4, 7, 9 and 10 do.
 *
 * Audience and template fallback travel together, so the type itself refuses
 * an owner-facing action with a fallback status, or a client-facing one without.
 */
export type AiActionDeclaration = {
  /** The area the call site passes to runAiAction today (see SA N-4). */
  area: BosLlmArea;
  /** Setup AI (onboarding, first site or form): the class, not the instance (SA D-0 Q-3). */
  isSetup: boolean;
  /** Option B: every action is charged its measured cost. */
  isCharged: boolean;
  /** Plain-language diary label. DRAFT wording: reviewed by BA/user before slice 7 shows it. */
  diaryLabels: Labels;
  /** Declared and labelled, but no production trigger yet (KI-4). */
  isDormant?: true;
} & (
  | { audience: 'owner'; templateFallback: 'n/a' }
  | { audience: 'client'; templateFallback: 'exists' | 'missing' }
);

export const AI_ACTION_DECLARATIONS = {
  chat_turn: { area: 'chat', audience: 'owner', templateFallback: 'n/a', isSetup: false, isCharged: true,
    diaryLabels: { en: '…', he: '…', es: '…' } },
  // … one entry per AiActionType (16), values in §2.2 …
} as const satisfies Record<AiActionType, AiActionDeclaration>;
```

**Why this shape:**

- **Completeness in both directions, at compile time.** `satisfies Record<AiActionType, …>` on an object literal rejects a missing key **and** an excess key. So a new type added to the union without an entry, or an entry left behind after a type is removed, is a type error. SA ruled in D-0 (Q-4, C-3) that this is the **primary, enforced** guard, because `typecheck:bos-llm` runs in CI and Jest does not.
- **One invariant is also enforced by the type.** The audience/fallback union makes `owner` + `missing`, or `client` + `n/a`, a type error rather than a test failure. It costs nothing at runtime.
- **The key is the action type itself.** There is no separate diary-label key string: it would be a hand-typed duplicate that could drift. SA accepted this in D-0 (Q-6). This fulfils the requirement's "diary label (en/he/es, or its key …) — the workplan chooses": **the labels are inline**, following the catalog's `Labels` pattern.
- **`Labels` is reused, not redefined.** It is imported **type-only** from `lib/business-os/entitlements/types.ts`, a file with no imports, so the import is erased at compile time and adds nothing to the module graph.
- **No accessor function.** Later slices read `AI_ACTION_DECLARATIONS[spec.actionType]` directly. A helper is added only when a slice needs one.
- **No precedent is broken.** `as const satisfies Record<…>` is the pattern already used in `entitlements/config/catalog.ts`, `cohorts.ts` and `chatActionMap.ts`.

### 2.2 The declared values

**The labels are drafts.** They follow the requirement's diary example ("Chat — Answered a question — you — 4 credits"): the area is shown separately, so the label says what the action did. **BA and the user must review the wording (and a native speaker the Hebrew and Spanish) before slice 7 shows any of it.** Nothing renders them in slice 1.

| `AiActionType` | Area | Audience | Setup | Charged | Fallback | Dormant | en / he / es (draft) |
|---|---|---|---|---|---|---|---|
| `chat_turn` | chat | owner | no | yes | n/a | | Answered a question / מענה לשאלה / Respuesta a una pregunta |
| `chat_website_operation` | website | owner | no | yes | n/a | | Changed your website from chat / שינוי באתר דרך הצ׳אט / Cambio en tu sitio desde el chat |
| `insight_run` | insights | owner | no | yes | n/a | | Checked your business for insights / בדיקת תובנות לעסק / Revisión de novedades del negocio |
| `briefing_narration` | briefing | owner | no | yes | n/a | | Wrote your daily briefing / כתיבת התדריך היומי / Redacción del resumen diario |
| `website_full_site` | website | owner | **yes** | yes | n/a | | Built your website / בניית האתר / Creación del sitio web |
| `website_landing_page` | website | owner | no | yes | n/a | | Built a landing page / בניית דף נחיתה / Creación de una página de destino |
| `website_field_regenerate` | website | owner | no | yes | n/a | | Rewrote website text / שכתוב טקסט באתר / Reescritura de texto del sitio |
| `website_testimonial_enhance` | website | owner | no | yes | n/a | | Polished a testimonial / ליטוש המלצה / Mejora de un testimonio |
| `website_section_field_rewrite` | website | owner | no | yes | n/a | **yes** | Rewrote a website section / שכתוב מקטע באתר / Reescritura de una sección del sitio |
| `website_block_enrichment` | website | owner | no | yes | n/a | **yes** | Enriched website content / העשרת תוכן האתר / Enriquecimiento del contenido del sitio |
| `intake_form_generation` | intake | owner | **yes** | yes | n/a | | Built an intake form / בניית טופס קליטה / Creación de un formulario de admisión |
| `intake_question_inference` | intake | owner | no | yes | n/a | | Suggested an intake question / הצעת שאלה לטופס / Sugerencia de una pregunta para el formulario |
| `onboarding_build` | website | owner | **yes** | yes | n/a | | Set up your business / הקמת העסק / Configuración de tu negocio |
| `lead_reply_recommendation` | leads | **client** | no | yes | **exists** | | Picked a reply to a new enquiry / בחירת מענה לפנייה חדשה / Elección de respuesta a una nueva consulta |
| `onboarding_turn` | onboarding | owner | **yes** | yes | n/a | | Setup conversation / שיחת הקמה / Conversación de configuración |
| `image_generation` | images | owner | no | yes | n/a | | Created an image / יצירת תמונה / Creación de una imagen |

**How each column was decided:**

- **Area:** exactly what each call site passes to `runAiAction` today (§1). `onboarding_build` spans two areas; its declared primary area is `website`, matching the call site, and `details.areas` stays authoritative in the audit entry (WC-4).
- **Audience:** SA's SQ-12 ruling. `lead_reply_recommendation` is the only client-facing type.
- **Setup:** the requirement's §8 row "Setup (onboarding, first website / intake generation, regenerations)", read **per type**. The flag marks the class. Whether one invocation is a first run or a regeneration is decided per instance in slice 8 (SA D-0 Q-3). `website_field_regenerate` is a field-level rewrite, not setup.
- **Charged:** option B (BD-1). Every action is charged its own measured cost, so all 16 are `true`. The field is `boolean`, so a future non-charged type is a visible, reviewable edit.
- **Template fallback:** `n/a` for every owner-facing type (the owner's AI pauses, it does not degrade). `lead_reply_recommendation` is **`exists`** (SA C-1), with a code comment citing `LeadReplyRecommender.ts:15-21` and `leadReplyCandidates.ts:103-138`: every failure falls through to the deterministic `pickFallbackCandidate` ladder, and the switched-off path already runs it with no LLM call. Slice 10 routes "balance exhausted" to that existing path (FR-20); nothing is built here.
- **Dormant:** the two KI-4 types are declared and labelled now, so they do not arrive unlabelled the day they are wired.

### 2.3 The stale header (SA-S12)

Replace `aiActionAudit.ts:12-14` ("NOT WIRED YET …") with an accurate note. `runAiAction` is wired at 16 call sites: 14 live, plus the two dormant types, whose call sites have no production trigger. The per-type facts are in `AI_ACTION_DECLARATIONS`, below the union. **Comment only.**

### 2.4 The client-bundle question, stated plainly

Co-locating the facts in `aiActionAudit.ts` has one concrete technical cost. The file is **server-only**: it reaches `AuditTrailService` (a Supabase client, `next/server`) and `node:async_hooks`. A `'use client'` module that imports it breaks the build (Standard 6, PR #53).

**Why co-location is still right for slice 1, and for the whole layer as planned:**

| Slice | Who reads the facts | Where it runs |
|---|---|---|
| 3 | `runAiAction`, building the charge row | Server, same file |
| 4 | Operator report (by area, by owner / automatic) | Server (admin route) |
| 7 | The owner's diary | **Server API route**: the diary reads the charge table through a repository, caller-scoped, so the route attaches the label (all three languages, or the caller's) to each line before returning it |
| 9, 10 | The balance pre-check and pause/degrade, by audience | Server, inside `runAiAction` |

No planned consumer is a client component, so no client module needs to import the file.

**If slice 7 turns out to need the labels inside a client component**, the minimal fix is to **move** the union and `AI_ACTION_DECLARATIONS` together into a dependency-free sibling file and **re-export** both from `aiActionAudit.ts`, so the 16 importers do not change. That is a move, not a copy, so there is still one list. It is the pattern Standard 6 already names (`lib/business-os/briefing/briefingLines.ts`). That decision belongs to slice 7's workplan and SA, not here (Q-1).

### 2.5 What slice 1 deliberately does not do

- It does **not** invert the source of truth (`type AiActionType = keyof typeof AI_ACTION_DECLARATIONS`). SA recommended that for the slice that next edits `aiActionAudit.ts` for `schema: 2` (D-0 Q-4). It would also work here, but it changes how the type is declared, and slice 1 promises the union is untouched (Q-2).
- It does **not** make `runAiAction` read the declarations or assert that `spec.area` matches the declared area (SA D-0 N-4). That is a behaviour change; it belongs in slice 3 or slice 9, which change `runAiAction` anyway.

### 2.6 Root cause / phase

Not V6. Slice 1 adds facts, not a fix. It is placed on the action type because the action is the grain of the charge (§8), and SQ-12 ruled that behaviour at the limit is per action, while cost is per call (`BOS_LLM_CALLS` stays the attribution and pricing inventory).

---

## 3. Files to Create / Modify

| File | Action | Reason | `console.*` |
|---|---|---|---|
| `lib/business-os/llm/aiActionAudit.ts` | modify | Header comment (§2.3); `import type { Labels }`; `AiActionAudience`, `AiActionDeclaration`, `AI_ACTION_DECLARATIONS` (§2.1–2.2). **No existing line of code changes** | 0 |
| `lib/business-os/llm/__tests__/aiActionAudit.test.ts` | modify | New `describe('AI_ACTION_DECLARATIONS')` block: the bonus Jest guard (§5), reusing the file's existing mocks | 0 |
| `docs/workplans/BUSINESS_OS_CREDIT_DEDUCTION_SLICE_1_WORKPLAN.md` | create | This document | — |
| `docs/workplans/BUSINESS_OS_CREDIT_DEDUCTION_D0_WORKPLAN.md` | modify | "Superseded by" note at the top, and a Change History row | — |

**Deliberately not touched:** `runAiAction`, `buildAiAuditEntry`, `AiAuditDetails` (the `schema: 1` details), every `runAiAction` call site (§1), `lib/ai/**` (pricing, usage scope, providers), `lib/business-os/entitlements/**` (including `balance.ts`, `EntitlementService.ts`, `config/enforcementPoints.ts`, `config/catalog.ts`, and `types.ts`, which is only imported), `lib/services/LeadAlertService.ts` (cited, not edited), `lib/business-os/LanguageContext.tsx`, `scripts/**`, `supabase/migrations/**`, `.github/**`, the requirement doc.

---

## 4. Task List

Each task is marked ✅ when done.

- ✅ **T0: Baseline.** Record the before state: `npm run typecheck:bos-llm` (0 new errors; note the baseline file's hash), `npm run check:bos-llm-literals`, and `npx jest lib/business-os/llm` (record the pass counts here).
  - *Result @ `88d9063e`:* Jest `lib/business-os/llm`: 18 suites / 413 tests / 23 snapshots, all pass. `typecheck:bos-llm`: 265 files in scope, 28 errors, **0 new**, passed (1 baseline entry reported fixed, pre-existing: `app/api/onboarding/build/route.ts` TS18047). Baseline `scripts/typecheck-bos-llm.baseline.json` sha256 `d81772b0f34aebd42fbbf22d1db2f2303cdd050a50f28a09047971653f9729f2`. `check:bos-llm-literals`: 46 files, 2 exempt, 0 violations, passed.
- ✅ **T1: Stale header (§2.3).** A comment-only edit to `aiActionAudit.ts:12-14`.
  - *Done:* 3 comment lines replaced by 6. No `flush(`, `shutdown(` or `await AuditTrail.log(` token (C-3).
- ✅ **T2: Types (§2.1).** Add the type-only `Labels` import, `AiActionAudience` and `AiActionDeclaration` directly after the union.
- ✅ **T3: Declarations (§2.2).** Add `AI_ACTION_DECLARATIONS` with all 16 entries, `as const satisfies Record<AiActionType, AiActionDeclaration>`. Add the OI-1 comment on `lead_reply_recommendation` and the KI-4 comment on the two dormant entries.
  - *Done:* C-1 applied to this workplan first (overview, §1, §2.2 row and bullet, §5 item 4, §6). `lead_reply_recommendation` is declared `client` + **`exists`**, with a comment citing `LeadReplyRecommender.ts:15-21` and `leadReplyCandidates.ts:103-138`. The `AiActionDeclaration` type still allows `'missing'` for a client-facing type, so a future client-facing action without a fallback can be declared honestly.
- ✅ **T4: Bonus Jest guard (§5).** Extend `aiActionAudit.test.ts` with the new `describe` block.
  - *Done:* 4 tests (union parse, well-formed, distinct labels, pinned facts). The parse extracts quoted literals between `export type AiActionType =` and the first `;` (C-2), with a ≥ 16 floor and a no-duplicates check. The declarations are read through a `Record<AiActionType, AiActionDeclaration>`-typed local, so there is no implicit `any`; the test file adds 0 errors under `typecheck:bos-llm`. Suite: 28 → 32 tests, all pass.
- ✅ **T5: Negative proof of the enforced guard (SA D-0 C-3).** Make each of these edits temporarily, one at a time, and confirm that `typecheck:bos-llm` reports a **new** error in `aiActionAudit.ts` for each: (a) delete one entry; (b) add a stray key; (c) set an owner-facing entry's fallback to `missing`; (d) set `lead_reply_recommendation`'s fallback to `n/a`; (e) remove one language from one label. Revert every one, and record the five results in §10.
  - *Done:* all five fail the gate (`typecheck-bos-llm: FAILED. New type errors…`); codes in §10 "Dev implementation evidence". The file was restored from a copy and verified byte-identical (`cmp`).
- ✅ **T6: Gates.** Re-run T0's commands. `typecheck:bos-llm` must show 0 new errors with `scripts/typecheck-bos-llm.baseline.json` unchanged. `check:bos-llm-literals` must be green (the labels contain no model id). `npx next build` must pass (Standard 6: no client module reaches the file).
  - *Result:* Jest `lib/business-os/llm`: 18 suites / **417** tests (413 + 4 new) / 23 snapshots, all pass. `typecheck:bos-llm`: 265 files, 28 errors, **0 new**, passed; baseline sha256 unchanged (`d81772b0…29f2`). `check:bos-llm-literals`: 46 files, 2 exempt, 0 violations, passed. `next build`: **passed** (exit 0, compiled successfully, 305 static pages). The first local attempt failed at "Collecting page data" only because this worktree has no `.env.local` (`Missing Supabase environment variables`); it was re-run with the exact placeholder env that `.github/workflows/build.yml` uses, and passed. No font flake was hit.
- ✅ **T7: No-behaviour-change evidence for SA.** `git diff --stat` must list only §3's files, with **no deletion-without-insertion** (the agent file-write truncation hazard). `git diff` of `aiActionAudit.ts` must show only additions plus the header comment. A grep must show no `runAiAction(` call site in the diff. `aiActionAudit.test.ts`'s existing assertions must pass unchanged. Record all of it in §10.
  - *Done:* see §10 "Dev implementation evidence".
- ✅ **T8: Handover.** Set the status to Code Complete and leave everything **uncommitted** (the user reviews the diff first). Notify TL for the SA code review. State that the new Jest block is local-only (no CI job runs `lib/business-os/llm` Jest) and that QA must run it.

---

## 5. Test Plan

| Guard | Where | Enforced in CI? | Asserts |
|---|---|---|---|
| **Primary: type-level** | `AI_ACTION_DECLARATIONS … satisfies Record<AiActionType, AiActionDeclaration>` in `aiActionAudit.ts` | **Yes** (`typecheck:bos-llm`, every PR) | Every type has an entry; no entry lacks a type; every required field is present with the right type; all three languages are present; audience and fallback agree. Proven by T5's five negative edits |
| **Bonus: Jest** | `lib/business-os/llm/__tests__/aiActionAudit.test.ts`, new `describe` block | No (local and QA only) | See below |

**The Jest block asserts:**

1. **Keys match the union, both ways (a secondary check).** The test reads `aiActionAudit.ts` as text (the file already imports `fs`/`path`), extracts the quoted `'…'` literals between `export type AiActionType =` and its terminating `;` (not whole lines: two members carry trailing `// dormant` comments, SA C-2), and asserts that the declared keys are exactly that set. It asserts that at least 16 members were found, so a broken parse fails loudly rather than passing empty.
2. **Every entry is well-formed at runtime:** `area` is in `BOS_LLM_AREAS`; `audience` is `owner` or `client`; `isSetup` and `isCharged` are booleans; `en`, `he` and `es` are non-empty after trimming; `templateFallback` is `n/a` if and only if the audience is `owner`.
3. **Labels are distinguishable:** within each language, no two types share a label, so two diary lines are never ambiguous.
4. **The known facts are pinned:** `lead_reply_recommendation` is `client` + `exists` and is the **only** client-facing type (SQ-12, SA C-1). Exactly `website_section_field_rewrite` and `website_block_enrichment` are dormant (KI-4). Every type is charged (option B). The setup set is exactly `onboarding_turn`, `onboarding_build`, `website_full_site` and `intake_form_generation`.
5. **Nothing else changed:** the file's existing `buildAiAuditEntry` / `runAiAction` tests still pass unchanged, which pins the `schema: 1` details and `runAiAction`'s behaviour.

**Commands**
```bash
npx jest lib/business-os/llm
npm run typecheck:bos-llm
npm run check:bos-llm-literals
npx next build
```

**Live check:** none is needed. Slice 1 changes no runtime output: no audit field, no charge, no UI. QA may spot-check that the LLM Usage tab on `/test-business-os` looks identical.

---

## 6. Guardrails and Out of Scope

**Guardrails (from §12 slice 1, and the user's rules):**

| Must not | Why |
|---|---|
| Create a separate, parallel list or module of action facts | User decision (§3, FR-4 refined). Supersedes SA's D-0 item 1 ("one typed module next to `aiActionAudit.ts`") |
| Change `runAiAction`'s behaviour, `buildAiAuditEntry`, or the audit `details` schema | Slice 3 does that (`action_id`, `schema: 2`) |
| Touch `balance.ts`, `EntitlementService`, `ENFORCEMENT_POINTS`, the catalog's `audience`, or the `ai.actions` id | Slices 5 and 9; SA-S11 (keep the id) |
| Change any call site | Nothing reads the declarations yet |
| Touch any pricing file (`lib/ai/pricing.ts`, providers, `usageScope.ts`, `GeneratedImageService`) | Slice 2 |
| Add a migration, a table or any UI | Slices 3, 6 and 7 |
| Build or change the lead-reply template fallback | It already exists (`pickFallbackCandidate`, SA C-1). Slice 1 declares it `exists`; slice 10 routes the degrade to it (FR-20) |
| Show the diary labels anywhere | Slice 7, after BA/user wording review |

**Out of scope, and where it goes:**

| Item | Slice |
|---|---|
| The unpriced signal, the conservative fallback, price coverage, the unrounded audit cost, the failed-call $0 fix | 2 |
| `action_id`, the charge table, the `schema: 2` bump, reading the declarations in `runAiAction`, asserting `spec.area` matches (SA N-4) | 3 (or 9) |
| Inverting the source of truth to `keyof typeof AI_ACTION_DECLARATIONS` (SA D-0 Q-4) | The next slice that edits the union (Q-2) |
| Per-instance setup (first run vs regeneration) and the setup pre-warning | 8 |
| Audience-driven behaviour at zero, the balance pre-check | 9, 10 |

---

## 7. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | A future client component imports `aiActionAudit.ts` to read a label and breaks the build (Standard 6, PR #53) | No planned consumer is client-side (§2.4). `next build` in T6. If slice 7 needs client-side labels, **move** (not copy) the union and declarations into a dependency-free file re-exported from `aiActionAudit.ts` (Q-1) |
| R-2 | Label wording is a product decision, and the Hebrew and Spanish need native review | Drafts only, marked as drafts in the code comment. Nothing renders them until slice 7, and BA/user review them before then |
| R-3 | The declared `area` duplicates what each call site passes, and could drift | Pinned today by the §2.2 table and SA's D-0 check. A runtime assertion is added when `runAiAction` first reads the declarations (slice 3 or 9, SA N-4) |
| R-4 | The Jest source-parse is fragile if the union is reformatted | It is only the secondary guard. It anchors on `export type AiActionType =` and requires ≥ 16 members, so it fails loudly. The enforced guard is the type |
| R-5 | The new object is built at module load in a file imported by 16 call sites | A constant literal of 16 small entries: negligible. No I/O, no side effect |
| R-6 | Agent file-write truncation (project memory) | T7 checks `git diff --stat` for deletion-without-insertion before any diff review |
| R-7 | `isSetup` per class over-flags (e.g. every `website_full_site`, even a regeneration) | Accepted by SA in D-0 (Q-3). It has no effect until slice 8, which decides per instance |

---

## 8. Open Questions for SA

| # | Question | Dev proposal |
|---|---|---|
| Q-1 | Co-location puts the diary labels in a server-only file (§2.4). Accept co-location now, with the slice 7 diary route attaching labels server-side, and the "move into a dependency-free file and re-export" option held for slice 7 if it is ever needed? | Yes. Every planned consumer runs on the server, and a later move keeps one list |
| Q-2 | Keep the explicit union plus `satisfies` in slice 1, and leave the `keyof typeof` inversion (your D-0 Q-4 recommendation) to the slice that next edits the union? | Yes. Slice 1 promises the union is untouched. Both forms are complete in both directions |
| Q-3 | Type `isCharged` as `boolean` (all 16 are `true` under option B, pinned by Jest), or as the literal `true`, so a non-charged type needs a type change? | `boolean`. A `false` is still a visible, reviewable diff, and the Jest pin catches it locally |
| Q-4 | Should slice 1 add a source-scan test that each call site's `area` matches the declared area, or leave it to the runtime assertion in slice 3/9 (N-4)? | Leave it. Call sites format their specs in two ways (inline and multi-line), so a scan would be brittle, and the runtime check is exact |
| Q-5 | Is the Jest block enough as a bonus, or do you want `lib/business-os/llm/__tests__/aiActionAudit.test.ts` added to a CI job (e.g. alongside `test:bos-entitlements`)? | Leave CI as is in slice 1: a CI change is outside the slice. The type check is the enforced guard. Raise the "no Jest in CI" gap separately (it is already a parked finding) |

---

## 9. Flagged Items (console.* and deprecated code)

Per CLAUDE.md § Logging: **every code file this workplan modifies has 0 `console.*` calls** (`lib/business-os/llm/aiActionAudit.ts`: 0; `lib/business-os/llm/__tests__/aiActionAudit.test.ts`: 0; counted at `7120adee`). So no conversion is owed.

Read, but deliberately **not** touched:

| File | `console.*` count | Note |
|---|---|---|
| `lib/business-os/entitlements/types.ts` | 0 | Imported type-only (`Labels`) |
| `lib/services/LeadAlertService.ts` | 0 | Cited only (OI-1) |
| `lib/business-os/LanguageContext.tsx` | 9 (per the D-0 count, SA-verified) | Not edited: labels are inline. If slice 7 edits it, raise the conversion with the user then |

No deprecated system (V1 plugin strategies, direct Supabase outside repositories) is touched or extended.

---

## 10. SA Workplan Review

**Reviewed by SA — 2026-09-28**, against worktree `neuronforge-llm-deduction`, branch `feature/business-os-credit-deduction` @ `88d9063e` (the requirement commit; the workplan still cites `7120adee`, and the only difference is that doc commit). Nothing is implemented: `git status` shows only the two untracked workplan files.
**Status:** APPROVED WITH CONDITIONS (C-1 blocking; C-2, C-3 should-fix)

### Verdict in one paragraph

The shape is right and it follows the user's rules. The facts sit directly on the existing `AiActionType` in `aiActionAudit.ts`. There is no second list: a repo-wide grep finds no other map keyed by action type, on this branch or on `main`. The completeness guard is a `satisfies Record<AiActionType, …>` inside a directory that `typecheck:bos-llm` scopes as core, and the audience/fallback pairing is enforced by the type as well. Scope is metadata, a header comment and a Jest block, and nothing else. **One declared fact is wrong, and the error is mine**, carried from my D-0 item 2 into the requirement: `lead_reply_recommendation` already has a no-AI fallback, so it must be declared `exists`, not `missing` (C-1). With C-1 applied, implementation may start. No re-review of the workplan is needed; I will verify C-1 to C-3 at code review.

### Verified claims

| Claim | Result |
|---|---|
| `AiActionType` has 16 members, is type-only, and has 2 dormant members | ✅ `aiActionAudit.ts:38-54` |
| Stale header (SA-S12) | ✅ Still stale at `aiActionAudit.ts:12-14` |
| 16 call sites: the area, action type and trigger in the §1 row | ✅ All 16 re-checked by grep. Every declared `area` in §2.2 matches what its call site passes today, including `onboarding_build` → `website` |
| `Labels { en; he; es }` in a types-only file with no imports | ✅ `entitlements/types.ts:81-85`; the file has no `import` lines, so `import type` adds nothing to the graph |
| `as const satisfies Record<…>` precedent | ✅ `entitlements/config/catalog.ts:515` (TypeScript `^5`) |
| The enforced gate | ✅ `SCOPED_DIRS` includes `lib/business-os/llm/` (`scripts/typecheck-bos-llm.ts:102-106`), so **both** `aiActionAudit.ts` and `__tests__/aiActionAudit.test.ts` are core scope. The baseline has no `llm/` entry, so any new error fails the gate. **Stronger than the workplan says:** `Type check (Business OS LLM attribution)` is a **required status check on `main`**. `gh api …/branches/main/protection/required_status_checks` lists it with the authz guard, the build and the hooks guard. So a red guard **blocks the merge**; it does not just warn. The docs-only skip (`.github/ci/non-deploying-change.sh`) cannot apply, because this change touches `lib/` |
| No CI job runs `lib/business-os/llm` Jest | ✅ `test:bos-entitlements` (`package.json:21`) does not include it |
| Server-only module; no client module imports it | ✅ There are 16 non-test importers, none `'use client'`. `app/admin/audit-trail/page.tsx` is `'use client'` but names the file only in a comment (`:103`) |
| 0 `console.*` in the two code files | ✅ 0 in each |
| **Lead reply has no template fallback (OI-1)** | ❌ **Incorrect: see C-1** |

### Rulings on Q-1 to Q-5

| # | Ruling |
|---|---|
| **Q-1** | **Accepted, as proposed.** Co-locate now. Slice 7's diary route attaches labels on the server. If a client component ever needs them, **move** the union and the declarations together into a dependency-free sibling and re-export both from `aiActionAudit.ts` (the `briefingLines.ts` pattern). Never copy. That decision belongs to slice 7's workplan |
| **Q-2** | **Accepted.** Keep the explicit union plus `satisfies`. With an object literal, both forms reject a missing key and an excess key, so slice 1 loses nothing. The `keyof typeof` inversion goes to the slice that next edits the union (slice 3's `schema: 2` is the likely one) |
| **Q-3** | **`boolean`.** A `false` is a reviewable one-word diff, and the Jest pin catches it. The literal `true` would buy nothing that FR-4 asks for |
| **Q-4** | **Leave it.** A source scan across two spec formats would be brittle. The exact check is the runtime assertion `spec.area === AI_ACTION_DECLARATIONS[spec.actionType].area` in the slice that first makes `runAiAction` read the list (3 or 9, N-4). Narrowing `AiActionSpec.area` by type is also out: it changes a type that 16 call sites compile against, and slice 1 promises nothing changes there |
| **Q-5** | **Leave CI as is.** The required type check is the enforced guard. The Jest block is local and QA-only, and QA must run it. The "no Jest in CI" gap is already a parked finding (2026-09-24); do not fold it into this slice |

### Findings

#### Blocking (conditions; apply before or at the start of implementation)

| # | Finding |
|---|---|
| **C-1** | **`lead_reply_recommendation` has a template fallback. Declare `templateFallback: 'exists'`, not `'missing'`.** The workplan (§1, §2.2, §5 item 4) repeats my D-0 claim that "when the model returns nothing, no reply is queued" (`LeadAlertService.ts:361-366`). The code says otherwise. `recommendLeadReply` never returns `null` for a non-empty candidate list. Every failure (the area switched off, an empty response, an unusable shape, an index out of range, a throw) falls through to `pickFallbackCandidate`, a deterministic ladder with no model (`LeadReplyRecommender.ts:15-21`, `:86-89`, `:100`, `:122`, `:130`, `:137-140`; `leadReplyCandidates.ts:103-138`). `LeadAlertService` returns **before** the AI action when there are no candidates (`:329-335`), so the `!recommendation` branch at `:361-366` is unreachable in practice. The model only picks **which** of the owner's own links to send. It never writes the reply (`LeadReplyRecommender.ts:5-12`), so the reply is template text either way, which is exactly what AC-14 asks for. The "switched off" path (`:100`) already runs the ladder **without an LLM call**. That is the degrade path slice 10 needs: route "balance exhausted" to it, as `enabled: false` already does. **Apply:** declare `exists`, with a code comment citing `LeadReplyRecommender.ts:15-21` and `leadReplyCandidates.ts:103-138`. Correct the §1 row, the §2.2 table and bullet, the §5 item 4 pin (`client` + `exists`, still the only client-facing type), the §6 guardrail row "Build the lead-reply template fallback", and the overview sentence. T5(d) stays valid, because `client` + `n/a` is still a type error. **The requirement is not edited here.** TL should ask BA to correct OI-1, slice 1's scope ("recorded as missing"), slice 10's FR-20 scope ("build the missing template fallback" becomes "route the degrade to the existing ladder"), and the SA D-0 item 2 note. These are text edits of an as-built fact, not a reopened decision. Slice 10 gets smaller |

#### Should-fix

| # | Finding |
|---|---|
| **C-2** | **The Jest source parse must strip comments.** Two union members carry trailing `// dormant (…)` comments (`aiActionAudit.ts:47-48`). Extract `'…'` literals between `export type AiActionType =` and the terminating `;`, and not whole lines. Keep the "≥ 16 members" floor. The test file is **core scope for `typecheck:bos-llm`** too, so the new block must add 0 type errors: no implicit `any` from `Object.entries` (cast through `AiActionDeclaration` or use `as const` keys). |
| **C-3** | **Do not break the existing static test.** `aiActionAudit.test.ts:383-388` scans the whole source text for `await AuditTrail.log(` and for `flush(` / `shutdown(` / `auditFlush(`. The new header comment (T1) and the declaration comments must not contain those tokens. For example, write "never flushed", as today, and not "never calls flush()". |

#### Notes

- **N-1:** Update the HEAD cited in the header and in §1 from `7120adee` to `88d9063e`. The branch is based on `origin/main` `7ba40a56`. The local `main` ref in this worktree is stale (`fa64e384`), so `git diff main` shows 236 unrelated files. For T7, diff against `HEAD`, not `main`.
- **N-2:** The declared facts are accepted as drafted, apart from C-1. Audience follows SQ-12. The setup set (`onboarding_turn`, `onboarding_build`, `website_full_site`, `intake_form_generation`) is the right class-level reading of §8. `website_landing_page`, `website_field_regenerate` and `intake_question_inference` are correctly not setup. All 16 are charged (option B). Exactly the two KI-4 types are dormant. The labels are drafts and must not render before BA/user and native review (slice 7).
- **N-3:** Owner-facing types are forced to `n/a` even where a degrade exists (`briefing_fallback`, `content_fallback`). That is correct for FR-4/FR-19, where the fallback status matters only for client-facing work. It is not an inventory of every degrade path, and later slices must not read it as one.
- **N-4 (for TL, outside this slice):** Documentation drift. The `bos-llm-typecheck.yml` header (`:2-6`) and the CLAUDE.md Business OS LLM row both say this check "is not a required status check". Branch protection says it is. Do not fix that here: `.github/` and CLAUDE.md are outside slice 1.
- **N-5:** T6 `next build` may hit the known next/font download flake (build-time Google font fetch). A retry is acceptable. It is not a slice-1 failure.
- **N-6:** T5's five negative edits are the right proof. Record the exact TS error code for each (expect TS2741 or TS1360 for (a), TS2353 for (b), TS2322 for (c) to (e)) so the SA code review can match them.

### Adjusted items (marked by SA)

- §2.2 `lead_reply_recommendation`: fallback `missing` → **`exists`** (C-1). The same change applies to §1, §5 item 4, §6 and the overview.
- §5 Jest item 1: parse string literals, not lines (C-2).

### Approval

- [x] Workplan approved **with conditions C-1 to C-3**. Implementation may start once C-1 is reflected in the workplan text; that can be the first edit of T3. No second SA workplan pass is needed.
- [ ] SA code review: verify C-1 to C-3, T5's five negative results, and T7's diff evidence (additions plus the header comment only; no call site; no file outside §3).

**Business questions:** none. C-1 corrects an as-built fact; it does not change a decision.

### Dev implementation evidence (2026-09-28)

**Conditions**

| # | How it was applied |
|---|---|
| C-1 | Workplan text corrected first (overview, §1, §2.2, §5 item 4, §6). Code: `lead_reply_recommendation: { area: 'leads', audience: 'client', templateFallback: 'exists', … }` with the citation comment. Jest pins `client` + `exists` and "only client-facing type". The requirement doc was **not** edited (BA follow-up via TL) |
| C-2 | The union parse uses `/'([a-z_]+)'/g` over the slice from `export type AiActionType =` to the first `;`, so trailing `// dormant (…)` comments are ignored. The test file adds 0 errors under `typecheck:bos-llm` |
| C-3 | `grep` of the added lines in `aiActionAudit.ts` for `flush(`, `shutdown(` and `await AuditTrail.log(`: **0 matches**. The existing static test (`never awaits, flushes or modifies the audit service`) passes unchanged |

**T5: negative proof** (each edit alone, then restored; every run printed `typecheck-bos-llm: FAILED`)

| Edit | Error in `aiActionAudit.ts` | Also reported |
|---|---|---|
| (a) delete the `image_generation` entry | **TS1360** (`does not satisfy the expected type 'Record<AiActionType, AiActionDeclaration>'`) | TS2741 in the test file (`Property 'image_generation' is missing`) |
| (b) add a stray `stray_action` key | **TS2353** (`Object literal may only specify known properties`) | — |
| (c) `chat_turn` (owner) fallback → `'missing'` | **TS2322** (`not assignable to type 'AiActionDeclaration'`) | TS2322 in the test file |
| (d) `lead_reply_recommendation` (client) fallback → `'n/a'` | **TS2322** (`not assignable to type 'AiActionDeclaration'`) | TS2322 in the test file |
| (e) drop `es` from `chat_turn`'s label | **TS2741** (`Property 'es' is missing … required in type 'Labels'`), not TS2322 as N-6 guessed | TS2322 in the test file |

**T7: diff evidence** (against `HEAD` `88d9063e`, not the stale local `main`)

- `git diff HEAD --numstat` for code: `aiActionAudit.ts` +123 / −3; `__tests__/aiActionAudit.test.ts` +66 / −1. No deletion without insertion.
- The 3 lines removed from `aiActionAudit.ts` are exactly the stale "NOT WIRED YET" header. No line of code changed.
- The 1 line removed from the test is the `callCatalog` import, re-added with `BOS_LLM_AREAS`; the `aiActionAudit` import block gained three names. No existing assertion changed.
- `runAiAction(` in added lines: **0**. No call site, no file under `lib/ai/**`, `lib/business-os/entitlements/**`, `supabase/**`, `.github/**` or `scripts/**` changed.
- `docs/requirements/BUSINESS_OS_LLM_DEDUCTION_LAYER_REQUIREMENT.md` shows as modified, but that is the BA's pre-existing uncommitted edit; Dev did not touch it.
- The D-0 workplan already carried its "Superseded" note and Change History row from planning, so it needed no further edit.

**Environment note:** the worktree had no `node_modules`. A junction to the main checkout's `node_modules` was created (the same setup as the other `neuronforge-*` worktrees); `/node_modules` is gitignored, so it is not in the diff.

**Reminder for QA:** the new Jest block is local-only (no CI job runs `lib/business-os/llm` Jest). QA must run `npx jest lib/business-os/llm/__tests__/aiActionAudit.test.ts`.

### SA code review (2026-09-28)

**Code Review by SA — 2026-09-28**, worktree `neuronforge-llm-deduction` @ `88d9063e`, uncommitted diff (`git diff HEAD -- lib/`).
**Status:** APPROVED — may go to QA

#### Verdict in one paragraph

The diff is what the workplan promised and nothing more: two files under `lib/business-os/llm/`, additions plus the three-line stale header. `runAiAction`, `buildAiAuditEntry`, `AiActionSpec`, the audit entry shape and every call site are byte-identical to `HEAD`; no pricing, migration, UI, `.github/`, `scripts/` or `lib/ai/**` change. C-1 to C-3 are all met. Every declared area matches what its call site passes today, the setup set and the two dormant types are right, and the completeness guard is enforced by a required status check. I re-ran all three gates myself and they pass. No blocking or should-fix findings.

#### Conditions verified

| # | Result |
|---|---|
| C-1 | ✅ `lead_reply_recommendation: { area: 'leads', audience: 'client', templateFallback: 'exists', … }`, with a comment citing `LeadReplyRecommender.ts:15-21` and `leadReplyCandidates.ts:103-138`. Both citations checked: the first is the "IT MUST NEVER BE THE REASON NOBODY IS ANSWERED" block, the second is `pickFallbackCandidate`. Jest pins `client` + `exists` and "the only client-facing type" |
| C-2 | ✅ The parse extracts `/'([a-z_]+)'/g` between `export type AiActionType =` and the first `;`, so the two `// dormant (…)` comments are ignored; ≥ 16 floor and a uniqueness check kept. The test block avoids implicit `any` by widening to `Record<AiActionType, AiActionDeclaration>` and casting `Object.keys` once; the file adds 0 errors under the gate |
| C-3 | ✅ `git diff HEAD -- lib/` added lines: 0 matches for `flush(`, `shutdown(`, `await AuditTrail`, and also 0 for `console.` / `: any` / `as any`. The existing static test `never awaits, flushes or modifies the audit service` passes unchanged |

#### Verified facts

| Claim | Result |
|---|---|
| Zero behaviour change | ✅ The only runtime addition is an unread exported `const`. No existing line of code changed; the 3 removed lines are the "NOT WIRED YET" comment |
| Areas vs call sites | ✅ All 16 `runAiAction(` sites re-grepped; each `area` in `AI_ACTION_DECLARATIONS` equals the one the site passes (incl. `onboarding_build` → `website`, `chat_website_operation` → `website` from `MutateExecutor.ts`) |
| New header ("16 sites, 14 in production, 2 dormant") | ✅ 16 non-test call sites; the dormant two are `WebsiteSectionService` and `WebsiteBlockEnrichmentService` |
| Setup set / dormant / charged | ✅ Setup = `intake_form_generation`, `onboarding_build`, `onboarding_turn`, `website_full_site` (N-2). Dormant = exactly the KI-4 pair. All 16 `isCharged: true` (option B) |
| `import type { Labels }` | ✅ `entitlements/types.ts` has 0 `import` lines and `Labels` is an `interface`; `import type` is erased, so no runtime dependency is added to this server-only module |
| Guard is enforced | ✅ `aiActionAudit.ts` has 0 baseline entries in `scripts/typecheck-bos-llm.baseline.json`, and `gh api …/branches/main/protection/required_status_checks` (re-run today) lists `Type check (Business OS LLM attribution)` as required. A missing type, a stray key, or a mismatched audience/fallback pair blocks the merge |
| Standards | ✅ Pino untouched and no `console.*` in either file; no implicit `any`; names follow the conventions (`AI_ACTION_DECLARATIONS` constant, `is…` booleans, `AiAction…` types); comments explain the why |

**Gates re-run by SA:** `npx jest lib/business-os/llm/__tests__/aiActionAudit.test.ts` → 32/32 passed (4 new). `npm run typecheck:bos-llm` → 265 files, 28 errors, **0 new**, passed. `npm run check:bos-llm-literals` → 0 violations, passed. `next build` and T5 not re-run: Dev's evidence accepted (below).

#### Dev's deviations: rulings

| Deviation | Ruling |
|---|---|
| `node_modules` junction to the main checkout | Accepted. Gitignored, not in the diff; same setup as the other worktrees |
| `next build` run with CI placeholder env | Accepted. That is what the required `Build (next build)` check does; slice 1 reads no env |
| T5(e) reported TS2741, not TS2322 | Accepted. My N-6 was a guess: a missing required property of `Labels` is TS2741. (a) reported TS1360, which N-6 listed. All five edits failed the gate, which is the point |
| The type still permits `'missing'` for a client type | Correct by design. FR-4/FR-20 require a future client-facing type to be able to declare a missing fallback so slice 10 can refuse to degrade it; only the owner/`n/a` and client/not-`n/a` pairing is a type rule. The Jest pin keeps the one current client type at `exists` |

#### Findings

**Blocking:** none.
**Should-fix:** none.

**Notes**

- **N-7 (Low, optimisation, not this slice):** the union parse assumes members match `[a-z_]+` and that no comment inside the union contains `;`. Both hold today; if a future type needs a digit, widen the regex. The `keyof typeof` inversion (Q-2) removes the parse entirely when the union is next edited.
- **N-8 (outside this slice):** `typecheck:bos-llm` reports "1 baseline entry is fixed" (`app/api/onboarding/build/route.ts`, TS18047). That file is not in this diff, so it is pre-existing baseline staleness; do not run `--update-baseline` in this change. Flag for whoever next touches the baseline.
- **N-4 still stands** (workflow header and CLAUDE.md say the check is not required; branch protection says it is). TL item, outside slice 1.
- **Requirement fold (quick check):** the BA's uncommitted edit folds C-1 correctly: FR-20 now routes "balance exhausted" down the existing `pickFallbackCandidate` path and drops "build the missing fallback", and the status line records C-1 and SQ-13 to SQ-16 as folded (FR-10, FR-12h, FR-13, AC-29 carry the SQ rulings). Not part of this review's approval.
- Labels remain drafts (N-2): nothing may render them before BA/user and native he/es review in slice 7.

#### Code Approved for QA: **Yes**

QA must run the Jest file locally (no CI job runs it) and should confirm the four new tests plus the unchanged static test.

---

## 11. QA Testing Report

### QA report (2026-09-28)

**QA — 2026-09-28**, worktree `neuronforge-llm-deduction` @ `88d9063e`, uncommitted diff (`git diff HEAD -- lib/`).
**Test mode:** full
**Strategy used:** A (Jest unit) plus the two CI gates (`typecheck:bos-llm`, `check:bos-llm-literals`) and mutation checks against them. The change is a typed constant with a type-level guard and no runtime reader, so no integration, script or E2E test applies.
**Focus:** schema (the declarations and their guard), regression
**Skipped:** `next build` (Dev ran it; SA accepted; slice 1 adds no route, page or env read). E2E is not set up in this repo.
**Input source:** prompt from TL (the five checks below)

#### Scope

Two files: `lib/business-os/llm/aiActionAudit.ts` (+123 / −3) and `lib/business-os/llm/__tests__/aiActionAudit.test.ts` (+66 / −1). Before any run, both were copied to the session scratchpad and hashed (SHA-256 `740de7ba…2b89` and `37495ec1…8f7c`).

#### Commands run and results

| # | Command | Result |
|---|---|---|
| 1 | `npx jest lib/business-os/llm/__tests__/aiActionAudit.test.ts` | ✅ **32/32 passed** (28 existing + 4 new in `AI_ACTION_DECLARATIONS`) |
| 2 | `npx jest lib/business-os/llm` | ✅ **18 suites, 417/417 passed** |
| 3 | `npm run typecheck:bos-llm` | ✅ 265 files, 28 errors, **0 new**, passed. It also printed "1 baseline entry is fixed" (`app/api/onboarding/build/route.ts`, TS18047): pre-existing, outside this diff (SA N-8) |
| 4 | `npm run check:bos-llm-literals` | ✅ 46 files, 2 exempt, **0 violations**, passed |
| 5 | Regression: every other test suite that imports `aiActionAudit` (6 suites: `BriefingStore.audit.attribution`, `lead-reply-attribution`, `modelFallback`, `insight-detect/route.audit`, `qa-slice5-pr2.baseCompare`, `runRecord.adoption`) | ✅ **6 suites, 276/276 passed** |

#### Failure-path evidence (the guard catches breakage)

Each edit was applied alone to a fresh copy of the original, the gate was run, and the file was restored from the saved copy and checked with `cmp` (byte-identical after every run).

| Edit (alone) | `typecheck:bos-llm` | Error in `aiActionAudit.ts` |
|---|---|---|
| A. New union member `'qa_new_action'` added to `AiActionType`, no declaration | ❌ **FAILED**, 2 new | **TS1360** at (175,12): does not satisfy `Record<AiActionType, AiActionDeclaration>`, plus TS2741 in the test file (`Property 'qa_new_action' is missing`) |
| B. `lead_reply_recommendation` (client) `templateFallback` → `'n/a'` | ❌ **FAILED**, 2 new | **TS2322** at (162,3): not assignable to `AiActionDeclaration` |
| C. `image_generation` `area` → `'imagez'` (not a real area) | ❌ **FAILED**, 2 new | **TS2820** at (171,5): not assignable to the `BosLlmArea` union ("Did you mean 'images'?") |

The local Jest block also catches what it is there for (both runs: 1 failed, 3 passed in the block; file restored and `cmp`-checked after each):

| Edit (alone) | Failing Jest test |
|---|---|
| D. `image_generation` English label changed to `'Answered a question'` (a duplicate; the type cannot catch this) | `no two types share a label in any language` |
| A again, under Jest | `declares exactly the members of the AiActionType union (source parse)` |

These are independent of Dev's T5 set (A overlaps Dev's (a) from the other side: a union member added rather than an entry deleted; B matches Dev's (d); C and D are new).

#### No behaviour change

- `git diff HEAD --numstat -- lib/`: `aiActionAudit.ts` 123 / 3, test 66 / 1. No deletion without insertion.
- The only removed lines are the three "NOT WIRED YET" header comment lines and the old `callCatalog` import in the test (re-added with `BOS_LLM_AREAS`). **No existing executable line changed.**
- Added lines matching `runAiAction(`, `flush(`, `shutdown(`, `await AuditTrail`, `console.`, `as any`, `: any`: **0**.
- The 28 existing tests in `aiActionAudit.test.ts` (including the static `never awaits, flushes or modifies the audit service`) pass unchanged, and no existing assertion was edited.

#### Edge checks against the requirement

The 16 declarations were dumped at runtime with a throwaway Jest file (deleted afterwards) and compared with the requirement's FR-4, slice 1, SQ-12, KI-4 and C-1.

| Fact | Required | Found |
|---|---|---|
| Entry count | one per `AiActionType` (16) | ✅ 16 |
| Client-facing types | only `lead_reply_recommendation`, fallback `exists` (C-1, SQ-12) | ✅ exactly that one, `exists`; the other 15 are `owner` / `n/a` |
| Setup types | 4 | ✅ `intake_form_generation`, `onboarding_build`, `onboarding_turn`, `website_full_site` |
| Dormant types | the KI-4 pair | ✅ `website_section_field_rewrite`, `website_block_enrichment` |
| Charged | all (option B) | ✅ 16/16 `isCharged: true` |
| Labels | en / he / es for all 16, non-empty, distinct per language | ✅ 48 labels, all non-empty; no duplicates within any language; Hebrew labels are in Hebrew script, Spanish in Spanish |
| Area vs call site | each declared area equals what its `runAiAction` call passes | ✅ 16 non-test `runAiAction(` call sites grepped; all 16 `(area, actionType)` pairs match the declarations |

#### Issues found

**Bugs:** none.
**Performance issues:** none (one unread exported constant).
**Edge cases / notes (nice to fix, none blocking):**

1. **Label style (Low, for the slice 7 label review).** 15 English labels are past-tense actions ("Built your website", "Created an image"); `onboarding_turn` is a noun phrase, "Setup conversation". Labels are already marked DRAFT for BA/user and native he/es review before anything renders them, so this is recorded for that review, not for Dev now.
2. **Stale status line (Low, doc).** The workplan header still reads "awaiting SA code review", though §10 records the SA code review as APPROVED. TL/Dev to update when moving to commit.
3. The Jest block has no CI job (as already recorded); its value is local. The enforced guard is the `typecheck:bos-llm` required check, which QA proved fails on A, B and C.
4. SA N-7 (union parse regex) and N-8 (stale baseline entry) confirmed as described; neither affects this slice.

#### Final status

- [x] All acceptance criteria in scope (FR-4, AC-9 guard half, KI-4, C-1, SA-S12) pass: ready for the user's diff review, then commit
- [ ] Issues found: Dev must address before commit

**Verdict: PASS WITH NOTES** (notes 1–2 are Low and non-blocking; no bug found). Code files restored and confirmed byte-identical to their pre-QA hashes; `git status --short` unchanged by QA apart from this workplan.

---

## 12. Commit Info

*(RM to populate. Dev does not commit. Changes stay uncommitted until the user has reviewed the diff.)*

---

## 13. Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-28 | Created | Slice 1 workplan, written from the reorganised requirement (§12 slice 1). Replaces the slice 1 half of the D-0 workplan. The facts are co-located on `AiActionType` in `aiActionAudit.ts` (user decision), not in a separate module. The enforced guard is `satisfies Record<AiActionType, …>` under `typecheck:bos-llm`, with a type-level audience/fallback invariant; a Jest block is a local-only bonus. Lead reply recorded as `missing`, not built. Labels are drafts pending BA/user review. Five questions for SA; no `console.*` debt in any modified file |
| 2026-09-28 | SA workplan review | **APPROVED WITH CONDITIONS.** Q-1 to Q-5 accepted as proposed (Q-3 `boolean`). C-1 (blocking): `lead_reply_recommendation` already has a no-AI fallback (`pickFallbackCandidate`), so it is declared `exists`, not `missing`; BA to correct OI-1, slice 1 and slice 10 in the requirement. C-2: the Jest union parse strips comments, and the new block type-checks (the test file is core gate scope). C-3: new comments must not trip the existing static `flush(`/`await AuditTrail.log(` test. Verified: the type check is a **required** status check on `main`. No business question |
| 2026-09-28 | Implemented (Code Complete) | C-1 applied to the workplan, then T1–T8. Declarations added on `AiActionType` with `lead_reply_recommendation` = `client` + `exists`. Gates: Jest 417/417, `typecheck:bos-llm` 0 new (baseline unchanged), literals 0 violations, `next build` passed with CI placeholder env. T5: TS1360, TS2353, TS2322, TS2322, TS2741. Uncommitted, awaiting SA code review and the user's diff review |
| 2026-09-28 | SA code review | **APPROVED — Code Approved for QA.** C-1 to C-3 verified; zero behaviour change (no existing code line changed, no call site/pricing/migration/UI); all 16 declared areas match their call sites; `import type { Labels }` adds no runtime dependency; the guard is enforced by the required `Type check (Business OS LLM attribution)` check. SA re-ran Jest (32/32), `typecheck:bos-llm` (0 new) and `check:bos-llm-literals` (0). Dev deviations accepted. No blocking or should-fix findings; notes N-7 (parse regex) and N-8 (stale baseline entry, pre-existing) |
| 2026-09-28 | QA report | **PASS WITH NOTES.** Jest: target file 32/32, `lib/business-os/llm` 417/417 (18 suites), 6 importer suites 276/276. `typecheck:bos-llm` 0 new; `check:bos-llm-literals` 0 violations. Guard proven: an undeclared union member (TS1360), a client type with `'n/a'` (TS2322) and a bad area (TS2820) each FAIL the gate; a duplicate label and an undeclared member each fail the Jest block; the file was restored byte-identical after each. No existing executable line changed. All 16 facts match the requirement and the call sites. Notes: one label style inconsistency for the slice 7 review, stale status line in the header. No bugs |
