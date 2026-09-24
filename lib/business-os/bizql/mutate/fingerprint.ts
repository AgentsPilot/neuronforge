/**
 * Fingerprinting a parked write, so what comes back is what went in.
 *
 * Shared by every store that parks a write in `command_sessions` and reads it
 * back on a later turn — ConfirmationStore and PendingChoiceStore today. It
 * lives in its own file rather than being copied, because the round trip has a
 * trap in it that is invisible until it bites.
 *
 * @module lib/business-os/bizql/mutate
 */

import { createHash } from 'crypto';

/**
 * Stable JSON: object keys sorted, recursively.
 *
 * Required because the fingerprint below is computed before storage and checked
 * after reading back, and the round trip goes through Postgres `jsonb` — which
 * does NOT preserve key order. Plain JSON.stringify therefore produces a
 * different string for a semantically identical object, the fingerprint never
 * matches, and every confirmation is silently rejected.
 *
 * That is precisely what happened: park() succeeded, take() always returned
 * null, and no unit test caught it because they mocked the store.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);

  return `{${entries.join(',')}}`;
}

/**
 * Fingerprint of the exact thing the user was shown.
 *
 * Stored alongside the parked payload and re-checked on the next turn, so a bug
 * that mutated the stored plan between turns cannot cause an unapproved write to
 * execute — or a pick to land on a candidate list the user never saw.
 */
export function fingerprint(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex').slice(0, 16);
}
