# Task 1 — Every path to a website generates AI content

> **Last Updated**: 2026-09-01
> **Status**: ⬜ Open
> **Area**: `lib/services/WebsiteGenerationService.ts`, `app/business-os/website/page.tsx`, `app/api/website/pages/route.ts`

## Overview

A business can arrive at a website two ways: the onboarding build creates one, or the owner decides later and runs the wizard from the Online Presence header. Only the first writes AI content. The second installs template sentences. The site a business shows its clients should not depend on which door it came through.

---

## What is true today

| | onboarding build | wizard |
|---|---|---|
| entry | `/api/onboarding/build` → `WebsiteGenerationService.generateWebsite()` | `POST /api/website/pages` → `apply-template` |
| copy | **AI**, from company name, description, vertical, sub-vertical and services ([WebsiteGenerationService.ts:310-313](/lib/services/WebsiteGenerationService.ts)) | `getStandardHomepageBlocks()` defaults, run through `translateBlockContent` |
| business data | AI prose + real services | `enrichBlocks(...)` called with `useAI = false` ([route.ts:237](/app/api/website/pages/route.ts)) — substitutes real values, writes no prose |
| theme | LLM-chosen, also seeded onto `business_profiles.theme` | the chosen template's theme |
| language | `profile.language` | the page's `website_language` |

`apply-template` cannot close the gap: by design it changes only the theme and preserves block content ([apply-template/route.ts:1-10](/app/api/website/pages/[id]/apply-template/route.ts)).

## The double-check: does the AI choose the sections?

**No.** `planSections(services)` is a deterministic rule, and it reads services only — never the vertical, never the AI:

```ts
services:     hasServices,
process:      hasServices,
booking:      hasServices && anyScheduled,
testimonials: true,
faq:          true,
contact:      true,
cta:          true,
```

Two consequences worth deciding on:

1. **The vertical does not influence the section list at all.** A consultant, a tutor and a clinic get the same seven-section skeleton, differing only in whether anything is booked. The AI writes vertical-specific *copy* into a fixed set of sections.
2. **`testimonials: true` unconditionally.** A business that signed up an hour ago has no clients, so the AI writes testimonials it has no source for. Previously flagged; still open, and it is a truthfulness question rather than a layout one.

---

## Work

| # | Change | Files |
|---|---|---|
| 1 | `generateWebsite(userId, options?)` accepts `{ pageId?, templateId? }` — configures an existing page instead of always creating one, and honours a template the owner chose rather than the LLM's colours | `WebsiteGenerationService.ts` |
| 2 | The wizard calls it after `ensureWizardPage()`, so template + AI copy compose instead of competing | `app/business-os/website/page.tsx` |
| 3 | The wizard shows generation progress and survives failure — a site with template copy is a worse outcome than a slow one, but a blank page is worse than both | `WebsiteSetupWizard.tsx` |
| 4 | **Decision required:** section selection — keep the services rule, or let the vertical (or the AI) choose. See Open Questions | `WebsiteGenerationService.ts` |
| 5 | **Decision required:** testimonials for a business with no clients | `WebsiteGenerationService.ts` |

### Constraint

`generateWebsite()` currently creates its own homepage ([:149](/lib/services/WebsiteGenerationService.ts)) and derives the theme from the LLM ([:124-140](/lib/services/WebsiteGenerationService.ts)). Both fight the wizard, which has already created a page and already has a template. Item 1 is the whole of the difficulty; items 2-3 follow from it.

## Open questions

1. Should the **vertical** decide which sections exist? A tutor may want a schedule, a clinic an insurance section, a consultant case studies. That is a bigger change than this task and may deserve its own.
2. Testimonials for a business with no clients: omit the section, or write it as an empty placeholder the owner fills in?

## Verification

1. Wizard on a business with no website → blocks contain the company name and description in the owner's language, not template sentences.
2. Onboarding build unchanged — same content as today.
3. Wizard with a chosen template → that template's colours survive generation.
4. Hebrew business → Hebrew copy including button labels.
5. `npx jest lib/business-os`.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-01 | Created | Written after confirming the wizard installs template defaults and that `planSections` is a services rule, not an AI or vertical decision |
