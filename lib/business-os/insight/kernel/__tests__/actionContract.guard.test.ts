/**
 * A card that offers an action must be able to perform it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * "Handle it for me" renders whenever an insight carries a `paired_process_id`.
 * Pressing it calls `enqueueInsightActions`, which refuses unless the
 * detection's `affectedEntityType` is one the process can act on. Three
 * detectors failed that check on every single run:
 *
 *   cash_booking_unpaid    reported `booking`; the chase acts on `invoice`
 *   cash_revenue_at_risk   reported `contact`, while its id array actually held
 *                          a mix of invoice, instalment and proposal ids
 *   sales_reply_slow       named `draft_reply_templates`, which has no send
 *                          effect at all
 *
 * So the owner pressed a button and got a 400. Nothing failed in CI, because
 * the existing parity test only looks for a detector whose process CONTRADICTS
 * the map — not for one whose entity type the process cannot accept, and not
 * for a map entry left behind after a detector dropped its process.
 *
 * These assertions are read off the same registries the runtime reads, so a new
 * detector cannot offer an impossible action without failing here.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { DetectorEngine } from '../../detectors/DetectorEngine';
import { DETECTOR_TO_PROCESS, TRIGGERABLE_PROCESSES } from '../TriggerableProcesses';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

/**
 * What each process can act on.
 *
 * Mirrors `PROCESS_EFFECTS` in `automation/InsightActionEnqueuer.ts`, which is
 * the gate the runtime applies. A process missing from here sends nothing.
 */
const ENTITY_TYPES: Record<string, string[]> = {
  chase_overdue_invoices: ['invoice'],
  send_followup_nudge: ['contact'],
  send_reminder_sequence: ['booking', 'session'],
};

function detectors() {
  const engine = new DetectorEngine({} as never);
  return (engine as unknown as { detectors: Array<{ definition: Record<string, unknown> }> }).detectors
    .map(d => d.definition as {
      id: string;
      pairedProcessId?: string;
      eligibleForAutomation?: boolean;
    });
}

describe('every offered action can actually run', () => {
  it('pairs each detector only with a process that exists', () => {
    const unknown = detectors()
      .filter(d => d.pairedProcessId && !TRIGGERABLE_PROCESSES[d.pairedProcessId])
      .map(d => `${d.id} → ${d.pairedProcessId}`);

    expect(unknown).toEqual([]);
  });

  it('pairs each detector only with a process that can send something', () => {
    /*
     * `draft_reply_templates` exists as a process and is deliberately not in
     * `PROCESS_EFFECTS`. A detector naming it renders a button that cannot work.
     */
    const noEffect = detectors()
      .filter(d => d.pairedProcessId && !ENTITY_TYPES[d.pairedProcessId])
      .map(d => `${d.id} → ${d.pairedProcessId} (no send effect)`);

    expect(noEffect).toEqual([]);
  });

  it('has no map entry for a detector that dropped its process', () => {
    // The shape that survived: the detector stops offering an action, the map
    // keeps offering one, and the browser reads the map.
    const byId = new Map(detectors().map(d => [d.id, d]));

    const orphans = Object.keys(DETECTOR_TO_PROCESS)
      .filter(id => byId.has(id) && !byId.get(id)!.pairedProcessId)
      .map(id => `${id}: in DETECTOR_TO_PROCESS but the detector has no pairedProcessId`);

    expect(orphans).toEqual([]);
  });

  it('agrees with the detector wherever the map names a process', () => {
    const contradictions = detectors()
      .filter(d => d.pairedProcessId && DETECTOR_TO_PROCESS[d.id] && DETECTOR_TO_PROCESS[d.id] !== d.pairedProcessId)
      .map(d => `${d.id}: map says ${DETECTOR_TO_PROCESS[d.id]}, detector says ${d.pairedProcessId}`);

    expect(contradictions).toEqual([]);
  });
});
