/**
 * Which stage a paid booking moves someone into.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS EXISTS FOR
 *
 * Creating a booking that raises an invoice moves the contact to the "active
 * client" stage — `BookingLifecycleService`, step 6. The resolver it asks used
 * to match a stage whose LABEL contained "active", and
 *
 *     'Inactive'.toLowerCase().includes('active') === true
 *
 * because "inactive" ends with the word it negates. So a stage meaning *the
 * relationship is over* answered *who is an active client*, and booking an
 * appointment for someone marked them as a former client.
 *
 * The therapist pipeline ships exactly that stage — `inactive` / "Inactive" /
 * `past_client`, position 4 — so this was reachable with no configuration at
 * all. It read as intermittent because a pipeline whose keys match earlier
 * never reaches the label test.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT MUST BE TRUE NOW
 *
 * The semantic columns answer first: the owner's own `is_primary_client_stage`,
 * then `stage_type`. The name heuristics remain for rows written before those
 * columns existed, but none of them may return a terminal stage — whatever it
 * is called, in whatever language.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { CRMPipelineStage } from '@/lib/repositories/CRMPipelineStagesRepository';

jest.mock('@/lib/logger', () => {
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), child: () => logger };
  return { createLogger: () => logger };
});

/** The stages this pipeline returns, set per test. */
let pipeline: CRMPipelineStage[] = [];

jest.mock('@/lib/supabaseClient', () => ({ supabaseClient: {} }));

import { crmPipelineStagesRepository } from '@/lib/repositories/CRMPipelineStagesRepository';

beforeEach(() => {
  jest
    .spyOn(crmPipelineStagesRepository, 'list')
    .mockImplementation(async () => ({ data: pipeline, error: null }));
});

afterEach(() => jest.restoreAllMocks());

/** A stage row, with only the fields this resolver reads. */
function stage(
  key: string,
  label: string,
  type: CRMPipelineStage['stage_type'],
  position: number,
  primary = false
): CRMPipelineStage {
  return {
    id: `stage-${key}`,
    user_id: 'user-1',
    vertical: 'therapist',
    stage_key: key,
    stage_label: label,
    position,
    color: null,
    stage_type: type,
    is_primary_client_stage: primary,
    created_at: '2026-01-01T00:00:00Z',
  };
}

const found = async () => (await crmPipelineStagesRepository.findActiveClientStage('user-1')).data;

describe('the pipeline that caused this', () => {
  it('never answers "Inactive" to "who is an active client"', async () => {
    /*
     * The therapist default, minus the key that used to rescue it. Before the
     * fix the label test matched "Inactive" and a paid booking filed the client
     * under past_client.
     */
    pipeline = [
      stage('inquiry', 'Inquiry', 'lead', 0),
      stage('intake', 'Intake', 'prospect', 1),
      stage('completed', 'Completed', 'past_client', 3),
      stage('inactive', 'Inactive', 'past_client', 4),
    ];

    const result = await found();

    expect(result?.stage_key).not.toBe('inactive');
    expect(result?.stage_type).not.toBe('past_client');
  });

  it('picks the real client stage when the pipeline has one', async () => {
    pipeline = [
      stage('inquiry', 'Inquiry', 'lead', 0),
      stage('active_client', 'Active Client', 'client', 2, true),
      stage('inactive', 'Inactive', 'past_client', 4),
    ];

    expect((await found())?.stage_key).toBe('active_client');
  });
});

describe('the semantic columns answer first', () => {
  it("takes the owner's own primary flag over everything", async () => {
    // Even over a stage whose KEY is one the old heuristics preferred.
    pipeline = [
      stage('client', 'Client', 'client', 1),
      stage('family_enrolled', 'לקוח', 'client', 2, true),
    ];

    expect((await found())?.stage_key).toBe('family_enrolled');
  });

  it('falls to the first stage typed as a client stage', async () => {
    pipeline = [
      stage('inquiry', 'פנייה', 'lead', 0),
      stage('family_enrolled', 'לקוח', 'client', 2),
      stage('vip', 'VIP', 'client', 3),
    ];

    expect((await found())?.stage_key).toBe('family_enrolled');
  });

  it('works for a pipeline with no English in it at all', async () => {
    // The label heuristics cannot help here, and must not need to.
    pipeline = [
      stage('inquiry', 'פנייה', 'lead', 0),
      stage('initial_consultation', 'ייעוץ ראשוני', 'prospect', 1),
      stage('family_enrolled', 'לקוח', 'client', 2),
      stage('completed', 'הושלם', 'past_client', 3),
    ];

    expect((await found())?.stage_key).toBe('family_enrolled');
  });
});

describe('the name heuristics, for pipelines written before stage_type', () => {
  /* `'' as StageType` stands for a row carrying no usable classification. */
  const untyped = (key: string, label: string, position: number) =>
    stage(key, label, '' as CRMPipelineStage['stage_type'], position);

  it('still matches a well-known key', async () => {
    pipeline = [untyped('lead', 'Lead', 0), untyped('client', 'Client', 1)];

    expect((await found())?.stage_key).toBe('client');
  });

  it('matches a label by WORD, so "Inactive" is not "active"', async () => {
    pipeline = [
      untyped('stage-a', 'New enquiry', 0),
      untyped('stage-b', 'Inactive', 1),
      untyped('stage-c', 'Working with client', 2),
    ];

    expect((await found())?.stage_key).toBe('stage-c');
  });

  it('refuses a terminal stage even when its name fits', async () => {
    // Typed as past_client and labelled "Active Client": the type wins, because
    // a stage meaning the relationship ended cannot mean it began.
    pipeline = [
      stage('lead', 'Lead', 'lead', 0),
      stage('odd', 'Active Client', 'past_client', 1),
    ];

    expect((await found())?.stage_key).not.toBe('odd');
  });

  it('counts positions only among stages that are not terminal', async () => {
    /*
     * Four stages ending in two terminal ones. "Second to last" over the whole
     * list is `completed`; over the real candidates it is the prospect stage.
     */
    pipeline = [
      untyped('one', 'First', 0),
      untyped('two', 'Second', 1),
      untyped('three', 'Third', 2),
      stage('completed', 'Completed', 'past_client', 3),
      stage('inactive', 'Inactive', 'archived', 4),
    ];

    const result = await found();

    expect(['one', 'two', 'three']).toContain(result?.stage_key);
  });
});

describe('when there is no answer', () => {
  it('returns null rather than inventing a stage', async () => {
    // Every stage means the relationship is over. Moving someone here on a new
    // booking would be worse than leaving them where they are.
    pipeline = [
      stage('completed', 'Completed', 'past_client', 0),
      stage('inactive', 'Inactive', 'archived', 1),
    ];

    expect(await found()).toBeNull();
  });

  it('returns null for an empty pipeline', async () => {
    pipeline = [];

    expect(await found()).toBeNull();
  });
});
