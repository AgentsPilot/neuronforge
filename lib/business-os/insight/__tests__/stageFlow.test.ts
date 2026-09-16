import { computeStageFlow, parseStageMove, type StageMove, type StageRank } from '../stageFlow';

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-15T12:00:00Z');

const move = (contactId: string, from: string | null, to: string | null, daysAgo: number): StageMove => ({
  contactId,
  from,
  to,
  at: NOW - daysAgo * DAY,
});

const RANKS: StageRank[] = [
  { stageKey: 'lead', position: 1, type: 'lead' },
  { stageKey: 'consultation', position: 2, type: 'prospect' },
  { stageKey: 'client', position: 3, type: 'client' },
  { stageKey: 'lost', position: 99, type: 'lost' },
];

const flowFor = (moves: StageMove[], stage: string, ranks?: StageRank[]) =>
  computeStageFlow(moves, { now: NOW, ranks }).find(f => f.stageKey === stage);

describe('computeStageFlow', () => {
  it('measures a cohort, not the difference between two queue lengths', () => {
    /*
     * The case the funnel map got wrong: six people reached consultation, four
     * moved on, two are still there. The old maths divided the current
     * headcount of one stage by the next and reported the difference as people
     * who had dropped — which counted everyone still in flight as lost.
     */
    const moves = [
      ...['a', 'b', 'c', 'd', 'e', 'f'].map(id => move(id, 'lead', 'consultation', 30)),
      ...['a', 'b', 'c', 'd'].map(id => move(id, 'consultation', 'client', 20)),
    ];

    const flow = flowFor(moves, 'consultation', RANKS)!;
    expect(flow.arrived).toBe(6);
    expect(flow.movedOn).toBe(4);
    expect(flow.stuck).toBe(2);
    expect(flow.stuckIds.sort()).toEqual(['e', 'f']);
  });

  it('does not count being lost as progress', () => {
    /*
     * Without this, a business losing people reads as a business with
     * throughput: they left the stage, so the connector above them turns green.
     */
    const moves = [
      ...['a', 'b', 'c', 'd', 'e', 'f'].map(id => move(id, 'lead', 'consultation', 30)),
      ...['a', 'b', 'c', 'd', 'e', 'f'].map(id => move(id, 'consultation', 'lost', 20)),
    ];

    const flow = flowFor(moves, 'consultation', RANKS)!;
    expect(flow.movedOn).toBe(0);
    expect(flow.stuck).toBe(6);
  });

  it('does not count going backwards as progress', () => {
    const moves = [
      ...['a', 'b', 'c'].map(id => move(id, 'lead', 'consultation', 30)),
      ...['a', 'b', 'c'].map(id => move(id, 'consultation', 'lead', 20)),
    ];

    expect(flowFor(moves, 'consultation', RANKS)!.movedOn).toBe(0);
  });

  it('gives new arrivals time before calling them stuck', () => {
    // Arrived yesterday. Not having moved on is normal, not a leak.
    const moves = ['a', 'b', 'c', 'd', 'e'].map(id => move(id, 'lead', 'consultation', 1));
    expect(flowFor(moves, 'consultation', RANKS)).toBeUndefined();
  });

  it('counts a person once however often they revisit a stage', () => {
    // Back and forth must not inflate the denominator and flatter the stage.
    const moves = [
      move('a', 'lead', 'consultation', 40),
      move('a', 'consultation', 'lead', 35),
      move('a', 'lead', 'consultation', 30),
    ];

    expect(flowFor(moves, 'consultation', RANKS)!.arrived).toBe(1);
  });

  it('falls back to counting any movement when the ordering orders nothing', () => {
    /*
     * Every stage at position 0 — unset, or never migrated. Comparing them
     * would make no move forward, so every cohort would report as entirely
     * stuck: a total failure that looks like a finding.
     */
    const flat: StageRank[] = [
      { stageKey: 'lead', position: 0, type: 'lead' },
      { stageKey: 'consultation', position: 0, type: 'prospect' },
      { stageKey: 'client', position: 0, type: 'client' },
    ];
    const moves = [
      ...['a', 'b', 'c', 'd', 'e'].map(id => move(id, 'lead', 'consultation', 30)),
      ...['a', 'b', 'c'].map(id => move(id, 'consultation', 'client', 20)),
    ];

    const flow = flowFor(moves, 'consultation', flat)!;
    expect(flow.movedOn).toBe(3);
    expect(flow.stuck).toBe(2);
  });

  it('counts any movement when no ordering is supplied', () => {
    // The honest fallback: told nothing about order, it cannot judge direction.
    const moves = [
      ...['a', 'b', 'c'].map(id => move(id, 'lead', 'consultation', 30)),
      move('a', 'consultation', 'lost', 20),
    ];

    expect(flowFor(moves, 'consultation')!.movedOn).toBe(1);
  });

  it('ignores arrivals older than the window', () => {
    const moves = ['a', 'b', 'c'].map(id => move(id, 'lead', 'consultation', 400));
    expect(flowFor(moves, 'consultation', RANKS)).toBeUndefined();
  });
});

describe('parseStageMove', () => {
  it('reads the from/to pair out of the CRM description blob', () => {
    const parsed = parseStageMove({
      contact_id: 'c1',
      activity_date: '2026-09-10T15:55:25.25+00:00',
      description: JSON.stringify({
        kind: 'contact_updated',
        changes: { stage: { from: 'family_enrolled', to: 'initial_consultation', field: 'stage' } },
      }),
    });

    expect(parsed).toMatchObject({ contactId: 'c1', from: 'family_enrolled', to: 'initial_consultation' });
  });

  it('skips rows it cannot read rather than guessing', () => {
    // A malformed row becoming a phantom cohort member would silently shift
    // every percentage drawn from it.
    expect(parseStageMove({ contact_id: 'c1', activity_date: '2026-09-10T00:00:00Z', description: 'not json' })).toBeNull();
    expect(parseStageMove({ contact_id: 'c1', activity_date: '2026-09-10T00:00:00Z', description: '{"changes":{}}' })).toBeNull();
    expect(parseStageMove({ contact_id: '', activity_date: '2026-09-10T00:00:00Z', description: '{}' })).toBeNull();
  });
});
