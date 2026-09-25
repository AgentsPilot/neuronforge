/**
 * Which capabilities have a gate that can actually refuse something, and where
 * that gate lives.
 *
 * ── The problem this solves ─────────────────────────────────────────────────
 * A capability being WITHHELD in the tier matrix and a capability being
 * ENFORCED are different facts, and the gap between them is invisible.
 * `chat.access` is the worked example: Essentials withholds it, but the gate
 * that would stop an Essentials owner using chat is Slice 2 work (FR-46). Until
 * that ships, the matrix says one thing and the product does another — and the
 * admin screen that renders the matrix is exactly what somebody consults when
 * deciding whether it is safe to switch enforcement on.
 *
 * "Nothing is enforced" covers it today. The moment that sentence changes, a
 * page without this distinction asserts something untrue about a specific
 * capability, to the person least able to afford the mistake.
 *
 * ── Why this is not a note somebody has to remember to delete ───────────────
 * It clears itself, because the entry is what makes the caveat go away and the
 * entry cannot be written falsely:
 *
 *   - **Forward:** every file named here must exist and must actually reference
 *     the capability it claims to gate. Claiming a gate that is not there fails
 *     `enforcementPoints.test.ts`.
 *   - **Backward:** a source scan finds every file outside this module that
 *     names a capability id. If one appears that is NOT registered here, the
 *     same suite fails. So shipping a gate and forgetting to register it is a
 *     red build, not a stale caveat.
 *
 * The result: the page's "no gate built yet" marker disappears for a capability
 * in the same commit that makes it false, and cannot be removed before then.
 *
 * ── It says nothing about the MODE ──────────────────────────────────────────
 * A registered gate still refuses nothing while `BOS_ENTITLEMENTS_MODE` is off.
 * This answers "does the code that would refuse exist?", the banner answers "is
 * it switched on?", and the page needs both.
 */

/**
 * capability id → the files that gate it.
 *
 * **Empty on purpose.** Slice 1 built the resolver, the config and the record
 * of what an account is entitled to. It wired no call site: nothing in the
 * product asks the resolver anything yet, so no capability has a gate.
 *
 * Adding a gate? Add its capability here in the same commit, with the file that
 * does the refusing. The test will check you are telling the truth.
 */
export const ENFORCEMENT_POINTS: Readonly<Record<string, readonly string[]>> = {};

/**
 * Does anything in the product refuse this capability today?
 *
 * The registry is a parameter so the rule can be exercised against one that has
 * entries — the shipped registry is empty, and a test that only ever saw the
 * empty one could not tell this function from `() => false` (QA NEW-6).
 */
export function hasEnforcementPoint(
  capability: string,
  registry: Readonly<Record<string, readonly string[]>> = ENFORCEMENT_POINTS
): boolean {
  return (registry[capability]?.length ?? 0) > 0;
}
