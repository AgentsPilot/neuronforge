# Account Deletion — Privacy Notice Paragraph (Draft)

> **Last Updated**: 2026-10-21

## Overview

A draft paragraph for AgentPilot's privacy notice that tells a customer what happens to their data when they delete their account, and what we keep. It is written for the user, the lawyer and the CPA to review and to place. AgentPilot has **no platform privacy page today** (only each business's own site privacy page), so where this text is published is a business decision (data export DE-10b.2 workplan, X-4; SA business call (b)). Until it is published, the delete drawer shows one short "what we keep" line.

Source rules: requirement [BUSINESS_OS_DATA_EXPORT_DE10B_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_DATA_EXPORT_DE10B_REQUIREMENT.md) §6.7, amended by SA Review 2 C2-12, the user decisions of 2026-10-18 (NBQ-3, SQL-4b) and the DE-10b.2 SA workplan review V-9.

---

## The paragraph (English draft)

> **What happens when you delete your account.** When you delete your account we erase your profile, your business, your clients' records, your invoices to your clients, your website, your booking pages and your files. Invitations you sent that were never used stop working and are deleted. Your sign-in is closed for good, and the entries in our sign-in log that name your account are removed. You can sign up again later with the same email address, as a new account.
>
> **What we keep.** If you paid us, we keep our own billing records with your personal details removed: invoice and payment numbers, dates, amounts, currency, plan, taxes, fees, refunds and chargebacks. They no longer hold your name, email address, phone number or address. We also keep the records of your clients' marketing consent (who agreed, or refused, to receive marketing, and when), because they are evidence of a choice your clients made. And we keep a short deletion receipt that proves we did what you asked: the dates, the statement you typed, and a coded fingerprint of your email address that cannot be turned back into the address.
>
> **Why, who can see it and for how long.** We keep these because tax and accounting rules require it, and to show that we honoured your request. Only our platform administrators can see them, and only for accounting, tax or legal purposes. We keep them for {N} years.
>
> **Payment providers.** Our payment provider (Stripe) keeps its own records of payments you made to us, under its own privacy policy. Deleting your AgentPilot account does not delete those records.

---

## Wording rules (do not change without SA)

| Rule | Source | Why |
|---|---|---|
| May say the sign-in log entries that name the account are removed | SQL-4b decision, V-9 | The anonymise deletes the account's `auth.audit_log_entries` rows inside the function (DE-10b.1 W-4) |
| Must **not** claim the Stripe Customer object was cleaned | C2-12, V-9 | The kept Stripe ids still point at a Stripe Customer that holds the person's details. Redacting it is a later slice (§6.6, §13) |
| Must say clients' marketing-consent records are kept | NBQ-3, V-9 | They are kept whole under the nameless account; the lawyer confirms |
| Must say our billing records are kept without personal details | §6.7, V-9 | The pseudonymised keep-set |
| Must say unused invitations the account sent are deleted | O-4, NQ-2, V-9 | Every invite the account issued is deleted |
| `{N}` | BQ-13 | Placeholder 7 years until the CPA answers (`DELETION_RECEIPT_RETENTION` in code is the one setting) |

## Open for the user

| # | Question | Default |
|---|---|---|
| X-4 | Where is this published (a future privacy page, the terms, the sign-up flow)? | Not published; the drawer shows one "what we keep" line |
| BQ-13 | The retention period {N} | 7 years (placeholder) |
| — | Hebrew and Spanish versions | To be translated after the English is approved |

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-21 | Draft created (Dev, DE-10b.2) | From requirement §6.7 with C2-12, NBQ-3, SQL-4b and SA V-9 applied; for the user, lawyer and CPA |
