// lib/business-os/entitlements/config/creditValue.ts
//
// THE CREDIT VALUE — how many US dollars of real provider cost one credit is.
//
// Business OS credit deduction, slice 3a (requirement BD-1, FR-3, SQ-7, SA-S6).
// Every charge row records the version it was priced at, so a charge can
// always be re-read at the value that produced it, whatever the value is today.
//
// ── APPEND-ONLY ─────────────────────────────────────────────────────────────
// Never edit an entry that has shipped: that rewrites the meaning of every
// charge already recorded at it (FR-3). To change the value, APPEND a new
// entry with the next version, and extend `creditValue.history.json` with it
// in the same PR.
//
// The snapshot test (`__tests__/creditValue.test.ts`) catches an ACCIDENTAL
// edit only. It is not tamper-proof: one PR can edit this file and the
// snapshot together. The audit record of a value change is the PR itself and
// its SA review (SA ruling Q-2, SQ-7, SA-S6).
//
// ── WHY ITS OWN FILE, NOT A FIELD ON TIER_MATRIX ────────────────────────────
// `TIER_MATRIX` is Zod-validated when the config loads, and the hot path must
// not pull config validation in (RC-7). This file is data only: no logic, no
// I/O, no imports beyond types. `matrixVersion` pairs each value with the
// matrix it was decided against (SQ-7).
//
// ── VERSION 0 IS PROVISIONAL ────────────────────────────────────────────────
// Slice 5 derives the real value from slice 4's measurement together with the
// plan allowances (FR-37, BD-8), and appends it as version 1.

export interface CreditValueVersion {
  /** Recorded on every charge row (FR-3). Strictly increasing from 0, no gaps. */
  version: number;
  /** USD of real provider cost per credit (BD-1). Finite and > 0. */
  usdPerCredit: number;
  status: 'provisional' | 'derived';
  /** The `TIER_MATRIX.version` the value is paired with (SQ-7). */
  matrixVersion: number;
  /** ISO date (YYYY-MM-DD) the value was decided. */
  decidedOn: string;
  /** Why this number, in words. */
  derivation: string;
}

/** Append-only. Changing an existing entry rewrites history (FR-3); a test refuses it. */
export const CREDIT_VALUE_HISTORY = [
  {
    version: 0,
    usdPerCredit: 0.001,
    status: 'provisional',
    matrixVersion: 1,
    decidedOn: '2026-09-28',
    derivation:
      'Working figure from requirement §2 (BD-1): one credit is about a tenth of a US cent of real provider cost. Provisional: slice 5 derives the real value from slice 4 measurement together with the plan allowances (FR-37, BD-8).',
  },
] as const satisfies readonly CreditValueVersion[];

/** The value new charges are priced at: the last entry. */
export function currentCreditValue(): CreditValueVersion {
  return CREDIT_VALUE_HISTORY[CREDIT_VALUE_HISTORY.length - 1];
}
