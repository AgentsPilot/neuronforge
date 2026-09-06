# Task 2 — Public pages follow the service, and load its availability

> **Last Updated**: 2026-09-01
> **Status**: ⬜ Open — reported from the live site, not yet reproduced
> **Area**: `app/site/[subdomain]/`, `app/api/website/booking/`, website blocks

## Overview

Two symptoms reported against a real published site:

1. The public pages do not follow the client journey per service.
2. Availability is not loaded for the services that require booking.

The per-service model reaches the code that renders the booking widget, so the fault is somewhere between the stored page and the screen. This task is to find where, then fix it — the diagnosis below is a starting point, not a conclusion.

---

## What is already wired (so the bug is not here)

| Piece | State |
|---|---|
| `journeySteps()` — the single resolver | `lib/business-os/clientJourney.ts` |
| Website booking widget | imports and calls it, per selected service ([BookingWidget.tsx:267](/app/site/[subdomain]/book/BookingWidget.tsx)) |
| Public payload | carries `is_scheduled` and `collection` per service ([public/[subdomain]/route.ts:142-143](/app/api/website/public/[subdomain]/route.ts)) |
| Availability route | reads `business_profiles.scheduling_availability`, filters services on **both** `is_active` and `status` ([booking/availability/route.ts:101-102](/app/api/website/booking/availability/route.ts)) |

`scheduling_availability` on `business_profiles` is the single column; every reader agrees on it.

## Leading suspects

1. **The Process block is page-level, not per service.** It renders one stored `client_flow` for the whole site, written once by the wizard or the build. A business with a booked service and an invoiced product shows one flow describing neither. This is the likeliest reading of "the public pages do not follow the client journey" — the *page* still narrates a single journey while the *widget* resolves per service.
2. **The Services section does not show each service's journey.** The owner sees the journey strip in Business OS; the client sees a price and a duration.
3. **Availability.** The route is correct on both flags, so check in order: does `scheduling_availability` actually hold hours for this business; does the widget reach `/api/website/booking/availability` at all for a `is_scheduled` service; and does the booking **section** on the homepage (as opposed to `/book`) load slots or only link onward.
4. **A wizard-built site.** Its blocks come from template defaults and its services block is populated separately — worth confirming the reported site was not one of these, since that changes the diagnosis entirely.

## Work

| # | Step |
|---|---|
| 1 | Reproduce on the live subdomain: which service, which step is wrong, `/book` or the homepage section |
| 2 | Fix the Process block so it describes the service's journey rather than one stored page-level flow |
| 3 | Show the journey per service in the public Services section, from the same resolver the widget uses |
| 4 | Trace availability from `scheduling_availability` to the rendered slots and fix the break |
| 5 | Retire `client_flow` as a stored page fact once nothing reads it — it is the page-level twin of the `?flow=` pin already removed from links |

## Verification

1. One business, three services — appointment+card, product+card, appointment+invoice. Each shows its own journey on the homepage, on `/book`, on a landing page and on a smart link. No card form on the invoiced one, no date step on the product.
2. A booked service loads real slots from the configured hours.
3. A business with no hours configured says so, rather than showing an empty calendar.
4. Deactivating a service removes it from all four surfaces.

## Related

- [website-ai-generation-every-path.md](/docs/workplans/website-ai-generation-every-path.md) — Task 1, the content side of the same wizard path.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-01 | Created | Reported from a live published site; suspects listed from a first pass over the render path |
