// lib/business-os/purge/capabilities.ts
//
// SA-S2 — what a given slice of this feature is allowed to DO.
//
// ── The distinction this file exists to enforce ────────────────────────────
// A capability describes an OPERATION, never a set of TABLES.
//
//   level + options  ->  WHICH TABLES are in scope          (product decision)
//   capability       ->  WHAT MAY BE DONE to them           (build decision)
//
// Those axes must never be mixed, and the reason is specific rather than
// aesthetic. AC-37 proves classification completeness by comparing the
// descriptor set against the live schema. If the executor resolved its work
// list by filtering on capability AS WELL AS level, then a mis-set capability
// term would silently drop a table from the run while AC-37 still reported
// "complete" — because AC-37 never looks at capability. Completeness would be
// measured on one axis and execution performed on another, and the gap between
// them would be invisible to both.
//
// So: capability gates the verbs. `SA-S1` in the invariant suite asserts that
// the executor's resolved table list is identical to the level-filtered
// descriptor list, computed with NO capability term anywhere in the comparison.
// If that test can be made to pass by changing a capability, the test is wrong.
//
// ── Slice status ───────────────────────────────────────────────────────────
// Slice 1 granted COUNT and STORAGE_COUNT.
// Slice 2 adds SNAPSHOT, DELETE_ROWS and DELETE_STORAGE — the Reset path.
// All five capabilities are now granted. The RPC behind `delete_rows` is
// written but deliberately NOT applied until the service_role key is rotated,
// and the orchestrator refuses when it is absent.

/**
 * Every operation this feature can perform.
 *
 * Exhaustive by construction: `assertAllCapabilitiesHandled` below fails to
 * COMPILE when a member is added and left unhandled, rather than allowing it to
 * be silently ignored at runtime. A capability that nobody handles is
 * indistinguishable from one that is switched off, and the second is a
 * decision while the first is an accident.
 */
export const PURGE_CAPABILITIES = [
  /** Count rows per descriptor. Read-only. */
  'count',
  /** Count storage objects under the user's folder. Read-only. */
  'storage_count',
  /** Write and read back the pre-purge snapshot. Not implemented. */
  'snapshot',
  /** Execute the destructive commit RPC. Not implemented. */
  'delete_rows',
  /** Remove storage objects after the commit. Not implemented. */
  'delete_storage',
] as const;

export type PurgeCapability = (typeof PURGE_CAPABILITIES)[number];

/**
 * Capabilities granted in THIS build.
 *
 * Slice 1 is read-only. Adding to this set without the implementation behind it
 * is how a preview quietly becomes a delete.
 */
export const GRANTED_CAPABILITIES: ReadonlySet<PurgeCapability> = new Set<PurgeCapability>([
  'count',
  'storage_count',
  // Slice 2 phase 1: copy rows out to storage. Read-only w.r.t. the business.
  'snapshot',
  // Slice 2 phase 2/3: the Reset commit and the storage removal after it.
  //
  // Granting these says the CODE PATH exists. It does not, today, mean deletion
  // can happen: `delete_rows` calls `purge_business_data`, which is written but
  // NOT applied, and `ResetService` probes for it before doing anything and
  // refuses if it is absent.
  //
  // ⚠️ Do not read the absent function as a second CONTROL. It is an
  // OPERATIONAL HOLD, kept by people: nothing in the system prevents anyone
  // applying `supabase/held/20260916b_purge_business_data.sql`. What prevents it
  // is that the file sits outside `migrations/` with a README, and that the
  // people able to apply it know not to until the service-role key is rotated.
  // A hold is only as strong as the discipline behind it. Once the function is
  // applied, this capability is the only thing on this line of defence.
  'delete_rows',
  'delete_storage',
]);

export function hasCapability(capability: PurgeCapability): boolean {
  return GRANTED_CAPABILITIES.has(capability);
}

/**
 * Compile-time exhaustiveness check.
 *
 * Add a member to `PURGE_CAPABILITIES` without adding a case here and
 * TypeScript rejects the `never` assignment. The switch deliberately returns a
 * human sentence rather than a boolean: the description is what a refusal
 * message shows, so leaving one out is visible in the product too.
 */
export function describeCapability(capability: PurgeCapability): string {
  switch (capability) {
    case 'count':
      return 'count rows per table';
    case 'storage_count':
      return 'count storage objects';
    case 'snapshot':
      return 'write the pre-purge snapshot';
    case 'delete_rows':
      return 'execute the destructive commit';
    case 'delete_storage':
      return 'remove storage objects';
    default: {
      const exhaustive: never = capability;
      throw new Error(`Unhandled purge capability: ${String(exhaustive)}`);
    }
  }
}

/** Capabilities this build does NOT have, for the UI's limitations panel. */
export function missingCapabilities(): PurgeCapability[] {
  return PURGE_CAPABILITIES.filter((c) => !GRANTED_CAPABILITIES.has(c));
}
