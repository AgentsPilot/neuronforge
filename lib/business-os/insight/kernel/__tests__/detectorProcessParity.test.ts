import { readdirSync } from 'fs';
import { join } from 'path';
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
  it('registers every detector in the catalog', () => {
    /*
     * An EXACT count against the files on disk, not a floor.
     *
     * This asserted `>= 25` while 40 were registered, so fifteen registrations
     * could have been lost without a single test failing — and a detector that
     * is not registered never runs, whatever else is true about it. The barrel
     * in `catalog/index.ts` does not catch it either: `DetectorEngine` imports
     * each class directly and ignores the barrel entirely.
     *
     * Counting the files is what makes this a real census. Adding a detector
     * file without registering it now fails here, which is the mistake the
     * module's own documentation calls the most common one in this area.
     */
    const files = readdirSync(join(__dirname, '..', '..', 'detectors', 'catalog'))
      .filter(f => f.endsWith('Detector.ts') && f !== 'BaseDetector.ts');

    const registered = new Set(detectors.map(d => d.definition.id));

    expect(detectors.length).toBe(files.length);
    // A duplicate registration would keep the count right and the set wrong.
    expect(registered.size).toBe(files.length);
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
