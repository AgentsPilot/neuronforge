import { DetectorEngine } from '../../detectors/DetectorEngine';
import { TRIGGERABLE_PROCESSES, DETECTOR_TO_PROCESS } from '../TriggerableProcesses';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

/**
 * The same fact is written down twice: each detector declares a
 * `pairedProcessId`, and `DETECTOR_TO_PROCESS` maps detector ids to process
 * ids. Two statements of one fact drift, and this one drifts SILENTLY —
 * `getProcessForDetector` returns null for anything missing, so a detector left
 * out of the map simply stops offering "put it on autopilot" with no error
 * anywhere.
 *
 * These tests make that omission fail here instead of failing quietly in front
 * of a user. Detectors are instantiated with a stub client: the definitions are
 * plain properties and no query runs.
 */
const detectors = new DetectorEngine({} as never).getDetectors();

describe('detector ↔ process wiring', () => {
  it('registers at least the detectors we expect', () => {
    /*
     * A guard on the guard: if this list ever came back empty the assertions
     * below would all pass vacuously.
     *
     * The floor was 30 and is now 25, because five detectors were deliberately
     * removed rather than lost:
     *
     *   ret_package_ending      advised renewing a package, and the product has
     *                           no renewal for a client's plan to be renewed into
     *   cash_cards_expiring     reads saved_payment_methods, which is empty on
     *                           every account — cards live at Stripe, not here
     *   pricing_discount_abuse  looks for discounts, and there is no discount
     *                           feature to produce any
     *   web_mobile_issues       every query named a column that does not exist
     *   web_page_underperform   four of its five queries did the same
     *
     * The last two are worth rebuilding: the analytics are real
     * (website_page_views, smart_link_clicks), only the column names were wrong.
     * Raise this floor again when they come back.
     */
    expect(detectors.length).toBeGreaterThanOrEqual(25);
  });

  it('never contradicts a detector about its own process', () => {
    const contradictions = detectors
      .filter(d => d.definition.pairedProcessId)
      .filter(d => {
        const mapped = DETECTOR_TO_PROCESS[d.definition.id];
        return mapped !== undefined && mapped !== d.definition.pairedProcessId;
      })
      .map(d => `${d.definition.id}: detector says ${d.definition.pairedProcessId}, map says ${DETECTOR_TO_PROCESS[d.definition.id]}`);

    expect(contradictions).toEqual([]);
  });

  it('maps every detector whose process actually exists', () => {
    /*
     * The omission that matters. A detector pointing at a REAL process but
     * absent from the map silently loses its automation offer — which is the
     * exact failure this file exists to catch.
     *
     * Detectors pointing at a process that was never built are not flagged
     * here: they are a known gap tracked separately, and failing on them would
     * turn this into a permanently red test nobody reads.
     */
    const forgotten = detectors
      .filter(d => {
        const paired = d.definition.pairedProcessId;
        return paired && TRIGGERABLE_PROCESSES[paired] && !DETECTOR_TO_PROCESS[d.definition.id];
      })
      .map(d => `${d.definition.id} -> ${d.definition.pairedProcessId}`);

    expect(forgotten).toEqual([]);
  });

  it('maps nothing that is not a registered detector', () => {
    const ids = new Set(detectors.map(d => d.definition.id));
    const strays = Object.keys(DETECTOR_TO_PROCESS).filter(id => !ids.has(id));

    expect(strays).toEqual([]);
  });

  it('points every mapped process at one that exists', () => {
    const dangling = Object.entries(DETECTOR_TO_PROCESS)
      .filter(([, processId]) => !TRIGGERABLE_PROCESSES[processId])
      .map(([detectorId, processId]) => `${detectorId} -> ${processId}`);

    expect(dangling).toEqual([]);
  });
});
