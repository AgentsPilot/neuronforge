# Database-level tests

> **Last Updated**: 2026-09-18

## Overview

Behaviour that lives in Postgres — triggers, constraints, referential actions —
and cannot be reached from Jest. Everything here runs against a throwaway
container, so it needs no credentials and touches nothing real.

These exist because the consent ledger shipped with three bugs that every other
check in the repo passed cleanly:

| Bug | Why nothing else caught it |
|---|---|
| The append-only guard rejected `ON DELETE SET NULL`, so **deleting a CRM contact failed outright** | A referential action arrives as an `UPDATE`. There is no TypeScript to typecheck and no Jest test that talks to a real FK |
| The guard's own fix never fired, because `email_normalized` is `GENERATED` and reads **NULL in `NEW` inside a `BEFORE` trigger** | The SQL was valid and the logic looked right. Only executing it shows the value is not there yet |
| The `email_unsubscribes` mirror was written from the incoming event while the state table applied ordering rules, so a **backdated withdrawal resurrected a suppression** a newer grant had cleared | Both halves were individually correct. Only a grant → withdraw → re-grant → backdated-import sequence puts them in conflict |

None is visible in a diff. All three are obvious the moment the SQL runs.

---

## Running them

Needs Docker. Nothing else.

```bash
docker run --rm -d --name consent-pg \
  -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=test -p 55433:5432 postgres:16-alpine

# Wait for it, then load: stubs → the real migration → the tests.
docker cp supabase/tests/marketing_consent_stubs.sql consent-pg:/tmp/
docker cp supabase/migrations/20260930_marketing_consent.sql consent-pg:/tmp/
docker cp supabase/tests/marketing_consent_test.sql consent-pg:/tmp/

docker exec consent-pg psql -U postgres -d test -v ON_ERROR_STOP=1 -q \
  -f /tmp/marketing_consent_stubs.sql
docker exec consent-pg psql -U postgres -d test -v ON_ERROR_STOP=1 -q \
  -f /tmp/20260930_marketing_consent.sql
docker exec consent-pg psql -U postgres -d test -v ON_ERROR_STOP=1 \
  -f /tmp/marketing_consent_test.sql

docker rm -f consent-pg
```

Twelve `PASS` lines and no `ERROR` is a pass. The first failed `ASSERT` aborts
the block, so a run that stops early has failed at the line above where it
stopped.

---

## Writing more

**Apply the real migration file, never a copy of it.** The stubs exist so the
migration can be applied *unchanged* — that is the whole point. A test against a
hand-copied schema tests the copy.

**The stubs are deliberately minimal**: `auth.users`, `auth.uid()`,
`crm_contacts`, `email_unsubscribes`. `business_profiles` is absent on purpose,
which also exercises the migration's `to_regclass` guard around the ownership
foreign key.

**One transaction means one `now()`.** Every statement inside a `DO` block sees
the same transaction timestamp, so any test about ordering has to spell its
timestamps out. A sequence written with bare `now()` is a tie, not a sequence —
and this suite's tie case asserts that a tie resolves to *withdrawn*.

## The suites

| Suite | Covers |
|---|---|
| `marketing_consent_*` | Append-only guard, the state projection, the `email_unsubscribes` mirror, backfill idempotency |
| `business_subscribers_*` | The newsletter roster: the migration off `stage='subscriber'`, the `crm_contacts` trigger that promotes a subscriber who books, tenant scoping, and that a promoted row outlives its contact |

Run either the same way — stubs, then the real migration, then the test file.
`business_subscribers` needs `20260930_marketing_consent.sql` applied first, since
its migration reads `marketing_consent_state` to decide each migrated row's status.

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-22 | Added | `business_subscribers`: migration, promotion trigger, tenant scoping |
| 2026-09-18 | Added | Marketing consent ledger: append-only guard, projection, mirror, backfill idempotency |
