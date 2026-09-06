#!/usr/bin/env bash
#
# The refund triggers, against a real Postgres.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHY A REAL DATABASE
#
# The over-refund guard is a `SELECT … FOR UPDATE` inside a BEFORE trigger. It
# exists because two requests that both read `refunded_amount` before either
# writes would both pass any check application code can make — the database is
# the only place those two requests meet.
#
# pg-mem cannot model row locks, so a test against it would pass whether or not
# the lock is there. The one assertion that justifies the whole design — two
# sessions each inserting a 60% refund, exactly one committing — needs two real
# connections to a real server, which is what this script sets up.
#
#   ./scripts/test-refund-triggers/run.sh
#
# Requires Docker. Leaves nothing behind: the container is removed on exit,
# including on failure.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
CONTAINER="refund-trigger-tests-$$"
PGPASSWORD="triggers"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start it and try again." >&2
  exit 1
fi

echo "Starting Postgres…"
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD="$PGPASSWORD" \
  -e POSTGRES_DB=triggers \
  postgres:16-alpine >/dev/null

# Readiness, not a fixed sleep — but readiness answered THREE times in a row.
#
# The postgres image starts a temporary server to run its init scripts and then
# shuts it down and starts the real one. A single `pg_isready` catches that first
# server and the next statement dies with "the database system is shutting
# down", which is what happened the first time this ran.
#
# `-h localhost` for the same reason: the init server listens only on the unix
# socket, so a TCP check cannot see it at all.
READY=0
for _ in $(seq 1 120); do
  if docker exec "$CONTAINER" pg_isready -h localhost -U postgres -d triggers >/dev/null 2>&1; then
    READY=$((READY + 1))
    [ "$READY" -ge 3 ] && break
  else
    READY=0
  fi
  sleep 0.5
done

if [ "$READY" -lt 3 ]; then
  echo "Postgres did not come up." >&2
  exit 1
fi

psql_run() {
  docker exec -i "$CONTAINER" psql -U postgres -d triggers -v ON_ERROR_STOP=1 -q "$@"
}

echo "Applying the schema the refund migrations build on…"
psql_run < "$HERE/fixture.sql" >/dev/null

echo "Applying the REAL migrations…"
# Verbatim, in order. A hand-copied trigger would only ever test the copy.
for migration in \
  20260828b_payment_refund_ledger.sql \
  20260828d_invoice_refund_state.sql \
  20260903_propagate_refund_to_booking.sql \
  20260903b_refund_reason_derived.sql \
  20260904_processor_fees.sql
do
  echo "  $migration"
  psql_run < "$ROOT/supabase/migrations/$migration" >/dev/null
done

echo
echo "Running assertions…"
psql_run < "$HERE/assertions.sql"

# ─────────────────────────────────────────────────────────────────────────────
# The concurrency case.
#
# Two sessions, each refunding 60% of the same charge. Serially the second is
# obviously refused; the question is what happens when they overlap, and that
# cannot be asked from one connection.
#
# Session A holds its transaction open past the point where B would read, so B
# must block on the FOR UPDATE rather than read a stale total. Exactly one may
# commit. Without the lock BOTH succeed and the business refunds 120% of a
# payment it took.
# ─────────────────────────────────────────────────────────────────────────────
echo
echo "Concurrent refunds (the assertion the row lock exists for)…"

# One session opens its transaction and holds it; the other arrives while the
# first is still uncommitted, which is the only way to make them genuinely race.
run_refund() {
  docker exec -i "$CONTAINER" psql -U postgres -d triggers -q -c "
    BEGIN;
    SELECT pg_sleep($2);
    SELECT refund_of('$1'::UUID, 60);
    COMMIT;
  " >/dev/null 2>&1 || true
}

# Both refunds race for the same charge; the ledger afterwards is the answer,
# whichever order they happened to land in.
race() {
  run_refund "$1" 0.4 &
  run_refund "$1" 0.1 &
  wait
}

committed_count() {
  psql_run -t -A -c "
    SELECT COUNT(*) FROM payment_refunds
    WHERE transaction_id = '$1'::UUID AND status IN ('pending','succeeded');
  " | tr -d '[:space:]'
}

TX=$(psql_run -t -A -c "SELECT seed(100);" | tr -d '[:space:]')
race "$TX"
COMMITTED=$(committed_count "$TX")

echo "  refunds committed: $COMMITTED of 2 attempted (60 each, against a charge of 100)"

if [ "$COMMITTED" != "1" ]; then
  echo "FAILED: $COMMITTED concurrent refunds of 60 committed against a charge of 100." >&2
  echo "The FOR UPDATE in refund_guard_before is not serialising them." >&2
  exit 1
fi

echo "  ok  exactly one of two concurrent 60% refunds committed"

# ─────────────────────────────────────────────────────────────────────────────
# The control.
#
# A concurrency test that would pass with the protection REMOVED proves nothing,
# and this one is easy to write that way by accident — if the two sessions never
# actually overlap, one refund commits because the other was serialised by the
# harness rather than by the lock.
#
# So the same race is run once with the guard dropped. Both refunds must commit,
# returning 120% of a charge of 100. If they do not, the test above is not
# measuring what it claims to.
# ─────────────────────────────────────────────────────────────────────────────
echo
echo "Control — the same race with the guard removed…"

psql_run -c "DROP TRIGGER refund_guard_before_trigger ON payment_refunds;" >/dev/null

CONTROL_TX=$(psql_run -t -A -c "SELECT seed(100);" | tr -d '[:space:]')
race "$CONTROL_TX"
CONTROL_COMMITTED=$(committed_count "$CONTROL_TX")

# Put it back before anything else runs against this database.
psql_run -c "
  CREATE TRIGGER refund_guard_before_trigger
    BEFORE INSERT OR UPDATE OF amount, status, currency ON payment_refunds
    FOR EACH ROW EXECUTE FUNCTION refund_guard_before();
" >/dev/null

echo "  without the guard: $CONTROL_COMMITTED of 2 committed"

if [ "$CONTROL_COMMITTED" != "2" ]; then
  echo "FAILED: with the guard removed, only $CONTROL_COMMITTED of 2 refunds committed." >&2
  echo "The two sessions are not actually racing, so the assertion above is vacuous." >&2
  exit 1
fi

echo "  ok  both commit without the guard — the race is real and the guard is what stops it"
echo
echo "ALL TRIGGER TESTS PASSED"
