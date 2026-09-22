// lib/business-os/entitlements/snapshot.ts
//
// The comparison behind the drift snapshot (T-11 / WC-19 / S-7).
//
// ── WHAT IT IS FOR ──────────────────────────────────────────────────────────
// Adding a capability to a tier is one line and affects everyone on that tier
// immediately. REMOVING one is a decision about people who are already paying,
// so B-10 says they keep it until renewal or a stated sunset date.
//
// Nothing stops someone editing `true` to `false` and shipping it. This module
// is what does: a committed snapshot of the last agreed matrix, and a comparison
// that recognises a LOWERED value and insists on a matching `removals` entry and
// a version bump.
//
// The same logic guards the cohort histories: shortening a trial by editing the
// number, rather than appending a history entry, would shorten trials that are
// already running (S-7).

import type { CapabilityValue, HistoryEntry, MatrixRemoval } from './types';
import type { CapabilityDef } from './types';

/** What a snapshot file holds. */
export interface EntitlementSnapshot {
  /** When it was written, for a human reading a diff. */
  generated: string;
  matrixVersion: number;
  /** tier → capability → value. */
  tiers: Record<string, Record<string, CapabilityValue>>;
  removals: MatrixRemoval[];
  /** Cohort durations and grace lengths, which S-7 freezes too. */
  histories: Record<string, Record<string, HistoryEntry[]>>;
}

/**
 * Rank a value so two can be compared.
 *
 * `null` means "not comparable" — for shapes where higher and lower have no
 * meaning, a change is reported as a change without being called a downgrade.
 */
export function rankValue(value: CapabilityValue, definition: CapabilityDef): number | null {
  const shape = definition.shape;

  switch (shape.kind) {
    case 'boolean':
    case 'group':
      return value === true ? 1 : 0;

    case 'variant': {
      // The catalog's variant order is what makes `branded → unbranded` an
      // upgrade and the reverse a downgrade.
      const index = (shape.variants as readonly string[]).indexOf(value as string);
      return index === -1 ? null : index;
    }

    case 'addon': {
      const order = ['unavailable', 'purchasable', 'included'];
      const index = order.indexOf(value as string);
      return index === -1 ? null : index;
    }

    case 'metered': {
      const metered = value as { perMonth?: number; total?: number };
      return metered.perMonth ?? metered.total ?? null;
    }

    case 'quantity':
      return (value as { included: number }).included;

    case 'fair_use':
      return (value as { ceilingPerMonth: number }).ceilingPerMonth;
  }
}

export interface DriftFinding {
  kind: 'lowered' | 'changed' | 'removed_capability' | 'removed_tier' | 'history_edited';
  where: string;
  detail: string;
}

/**
 * Compare a snapshot with the current configuration.
 *
 * Returns the findings that need a human decision. An ADDED tier or capability
 * is not a finding: adding is the cheap direction, by design.
 */
export function findDrift(
  snapshot: EntitlementSnapshot,
  current: {
    matrixVersion: number;
    tiers: Record<string, Record<string, CapabilityValue>>;
    removals: readonly MatrixRemoval[];
    histories: Record<string, Record<string, readonly HistoryEntry[]>>;
    catalog: Readonly<Record<string, CapabilityDef>>;
  }
): DriftFinding[] {
  const findings: DriftFinding[] = [];

  for (const [tier, snapshotRow] of Object.entries(snapshot.tiers)) {
    const currentRow = current.tiers[tier];

    if (!currentRow) {
      findings.push({
        kind: 'removed_tier',
        where: tier,
        detail: `tier "${tier}" is in the snapshot but not in the matrix. Retiring a tier is a commercial decision: record what happens to its subscribers.`,
      });
      continue;
    }

    for (const [capability, was] of Object.entries(snapshotRow)) {
      const definition = current.catalog[capability];
      if (!definition) continue; // the capability itself was removed; the catalog test owns that

      if (!(capability in currentRow)) {
        findings.push({
          kind: 'removed_capability',
          where: `${tier}.${capability}`,
          detail: 'the capability is no longer assigned in this tier, which is not the same as being set to off',
        });
        continue;
      }

      const now = currentRow[capability];
      if (JSON.stringify(now) === JSON.stringify(was)) continue;

      const wasRank = rankValue(was, definition);
      const nowRank = rankValue(now, definition);
      const lowered = wasRank !== null && nowRank !== null && nowRank < wasRank;

      // A lowered value is allowed — as long as somebody said so, in the two
      // places B-10 requires.
      const recorded = current.removals.some(
        (removal) => removal.tier === tier && removal.capability === capability && removal.version > snapshot.matrixVersion
      );
      const bumped = current.matrixVersion > snapshot.matrixVersion;

      if (lowered && !(recorded && bumped)) {
        findings.push({
          kind: 'lowered',
          where: `${tier}.${capability}`,
          detail:
            `${JSON.stringify(was)} → ${JSON.stringify(now)} takes something away from existing subscribers. ` +
            'Add a `removals` entry with a sunset date and bump the matrix version (B-10), then refresh the snapshot.',
        });
      } else if (!lowered) {
        findings.push({
          kind: 'changed',
          where: `${tier}.${capability}`,
          detail: `${JSON.stringify(was)} → ${JSON.stringify(now)} — an addition or a sideways move; refresh the snapshot to accept it.`,
        });
      }
    }
  }

  // Histories: appending is how a duration changes. Editing or dropping an entry
  // rewrites what someone was already promised.
  for (const [cohort, snapshotHistories] of Object.entries(snapshot.histories)) {
    for (const [name, wasEntries] of Object.entries(snapshotHistories)) {
      const nowEntries = current.histories[cohort]?.[name] ?? [];

      for (const [index, was] of wasEntries.entries()) {
        const now = nowEntries[index];
        if (!now || now.effectiveFrom !== was.effectiveFrom || now.days !== was.days) {
          findings.push({
            kind: 'history_edited',
            where: `${cohort}.${name}[${index}]`,
            detail:
              `${JSON.stringify(was)} → ${JSON.stringify(now ?? null)}. ` +
              'A history entry is a promise already made: append a new entry instead of editing an old one (S-7).',
          });
        }
      }
    }
  }

  return findings;
}
