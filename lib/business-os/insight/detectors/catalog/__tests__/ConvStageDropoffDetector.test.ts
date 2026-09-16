import { ConvStageDropoffDetector } from '../ConvStageDropoffDetector';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

const DAY = 86_400_000;

/** A `stage_changed` activity, shaped exactly as the CRM writes one. */
function move(contactId: string, from: string | null, to: string, daysAgo: number) {
  return {
    contact_id: contactId,
    activity_date: new Date(Date.now() - daysAgo * DAY).toISOString(),
    description: JSON.stringify({
      kind: 'contact_updated',
      changes: { stage: { from, to, field: 'stage' } },
    }),
  };
}

/**
 * The smallest client that satisfies the detector's call chain.
 *
 * Every builder method returns `this` and the object is awaited at the end, so
 * the chain can be any length in any order — which matters because the detector
 * is free to add a filter without this mock needing to know.
 */
function mockSupabase(tables: Record<string, unknown[]>) {
  return {
    from(table: string) {
      const rows = tables[table] ?? [];
      const chain: Record<string, unknown> = {
        then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
          resolve({ data: rows, error: null }),
        single: () => Promise.resolve({ data: null, error: null }),
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      };
      for (const method of ['select', 'eq', 'neq', 'gte', 'lt', 'not', 'in', 'order', 'limit']) {
        chain[method] = () => chain;
      }
      return chain;
    },
  };
}

const STAGES = [
  // `position` is what makes "moved on" mean FORWARD rather than merely away.
  { stage_key: 'lead', stage_label: 'Lead', stage_type: 'lead', position: 1 },
  { stage_key: 'consultation', stage_label: 'Consultation', stage_type: 'prospect', position: 2 },
  { stage_key: 'package', stage_label: 'Package', stage_type: 'client', position: 3 },
  { stage_key: 'lost', stage_label: 'Lost', stage_type: 'lost', position: 99 },
];

const SERVICES = [{ price: 100 }];

describe('ConvStageDropoffDetector', () => {
  it('reports the stage a cohort reached and never moved past', async () => {
    /*
     * Six people reached the consultation stage five weeks ago. One went on to
     * a package; five did not. That is the brief's "11 stopped after the
     * consultation", at a size a test can assert on.
     */
    const activities = [
      ...['a', 'b', 'c', 'd', 'e', 'f'].map(id => move(id, 'lead', 'consultation', 35)),
      move('a', 'consultation', 'package', 20),
    ];

    const detector = new ConvStageDropoffDetector(
      mockSupabase({
        crm_activities: activities,
        crm_pipeline_stages: STAGES,
        scheduling_services: SERVICES,
      }) as never
    );

    const result = await detector.evaluate('user-1');

    expect(result).not.toBeNull();
    expect(result!.processParameters!.stage_key).toBe('consultation');
    expect(result!.processParameters!.cohort_size).toBe(6);
    expect(result!.processParameters!.stuck_count).toBe(5);
    expect(result!.processParameters!.stuck_rate_percent).toBe(83);
    // The one who moved on must not be listed among the stuck.
    expect(result!.affectedEntityIds).not.toContain('a');
    expect(result!.affectedEntityIds).toHaveLength(5);
  });

  it('does not report a stage where stopping is the point', async () => {
    /*
     * Six people reached `package`, typed `client`, and stayed. They have
     * finished the journey. Reporting them would make every converted customer
     * look like a loss — which is why terminal stages are read by TYPE, not by
     * a hardcoded list of keys the product cannot know in advance.
     */
    const activities = ['a', 'b', 'c', 'd', 'e', 'f'].map(id =>
      move(id, 'consultation', 'package', 35)
    );

    const detector = new ConvStageDropoffDetector(
      mockSupabase({
        crm_activities: activities,
        crm_pipeline_stages: STAGES,
        scheduling_services: SERVICES,
      }) as never
    );

    expect(await detector.evaluate('user-1')).toBeNull();
  });

  it('gives new arrivals time before calling them stuck', async () => {
    // All six arrived yesterday. Not moving on yet is normal, not a leak.
    const activities = ['a', 'b', 'c', 'd', 'e', 'f'].map(id =>
      move(id, 'lead', 'consultation', 1)
    );

    const detector = new ConvStageDropoffDetector(
      mockSupabase({
        crm_activities: activities,
        crm_pipeline_stages: STAGES,
        scheduling_services: SERVICES,
      }) as never
    );

    expect(await detector.evaluate('user-1')).toBeNull();
  });

  it('stays quiet below the cohort floor', async () => {
    // Four stuck people is not a rate, it is four people.
    const activities = ['a', 'b', 'c', 'd'].map(id => move(id, 'lead', 'consultation', 35));

    const detector = new ConvStageDropoffDetector(
      mockSupabase({
        crm_activities: activities,
        crm_pipeline_stages: STAGES,
        scheduling_services: SERVICES,
      }) as never
    );

    expect(await detector.evaluate('user-1')).toBeNull();
  });

  it('ignores an activity whose description is not the shape it expects', async () => {
    /*
     * The from/to pair lives inside a JSON string the CRM writes. A row that
     * does not parse must be skipped, never guessed at — a malformed row
     * becoming a phantom cohort member would quietly shift every percentage.
     */
    const activities = [
      ...['a', 'b', 'c', 'd', 'e', 'f'].map(id => move(id, 'lead', 'consultation', 35)),
      { contact_id: 'g', activity_date: new Date(Date.now() - 35 * DAY).toISOString(), description: 'not json' },
      { contact_id: 'h', activity_date: new Date(Date.now() - 35 * DAY).toISOString(), description: '{"changes":{}}' },
    ];

    const detector = new ConvStageDropoffDetector(
      mockSupabase({
        crm_activities: activities,
        crm_pipeline_stages: STAGES,
        scheduling_services: SERVICES,
      }) as never
    );

    const result = await detector.evaluate('user-1');
    expect(result!.processParameters!.cohort_size).toBe(6);
  });
});
