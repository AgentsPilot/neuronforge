/**
 * Which stage means "they have paid", and who is allowed to be moved there.
 *
 * Three separate places used to answer this: the Stripe webhook wrote a
 * hardcoded `'customer'`, the booking finalizer guessed from stage KEYS
 * (`active_client` → `active` → `client` → highest position), and the manual
 * mark-paid route did nothing at all. On a business running its own pipeline —
 * פנייה → ייעוץ ראשוני → לקוח → הושלם — the first wrote contacts into a stage
 * with no column on the board, the second landed correctly by luck, and the
 * third left paying clients sitting as leads.
 *
 * The pipeline is configured per business, so the answer has to be read from
 * that configuration. These tests pin the reading and, more importantly, the
 * refusals.
 */

import { promoteToClientStage } from '../StageTypeUtils';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

/** This account's real pipeline, in its own language. */
const PIPELINE = [
  { stage_key: 'inquiry', stage_label: 'פנייה', stage_type: 'lead', position: 0, is_primary_client_stage: false },
  { stage_key: 'initial_consultation', stage_label: 'ייעוץ ראשוני', stage_type: 'prospect', position: 1, is_primary_client_stage: false },
  { stage_key: 'family_enrolled', stage_label: 'לקוח', stage_type: 'client', position: 2, is_primary_client_stage: true },
  { stage_key: 'completed', stage_label: 'הושלם', stage_type: 'past_client', position: 3, is_primary_client_stage: false },
];

interface Harness {
  stages: typeof PIPELINE;
  contactStage: string | null;
  updates: Array<Record<string, unknown>>;
}

/**
 * A Supabase stand-in driven by the harness.
 *
 * Answers the two tables this touches — `crm_pipeline_stages` filtered the way
 * the resolver filters it, and `crm_contacts` — and records writes so a test can
 * assert that nothing was written.
 */
function makeDb(state: Harness) {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const builder: Record<string, unknown> = {};

      builder.select = () => builder;
      builder.eq = (column: string, value: unknown) => {
        filters[column] = value;
        return builder;
      };
      builder.order = () => builder;
      builder.limit = () => builder;

      builder.maybeSingle = async () => {
        if (table === 'crm_pipeline_stages') {
          const matched = state.stages.filter(stage => {
            if ('is_primary_client_stage' in filters) {
              return stage.is_primary_client_stage === filters.is_primary_client_stage;
            }
            if ('stage_type' in filters) return stage.stage_type === filters.stage_type;
            if ('stage_key' in filters) return stage.stage_key === filters.stage_key;
            return true;
          });
          return { data: matched[0] ?? null, error: null };
        }

        return {
          data: state.contactStage === null ? null : { stage: state.contactStage },
          error: null,
        };
      };

      builder.update = (row: Record<string, unknown>) => {
        state.updates.push(row);
        return {
          eq: () => ({
            eq: async () => ({ error: null }),
          }),
        };
      };

      return builder;
    },
  } as never;
}

const harness = (over: Partial<Harness> = {}): Harness => ({
  stages: PIPELINE,
  contactStage: 'inquiry',
  updates: [],
  ...over,
});

describe('promoteToClientStage', () => {
  it('moves a lead to the stage the business marked as its client stage', async () => {
    const state = harness({ contactStage: 'inquiry' });

    const result = await promoteToClientStage(makeDb(state), 'user-1', 'contact-1');

    // Not 'customer', not 'client' — the key this business actually configured.
    expect(result).toEqual({ moved: true, stageKey: 'family_enrolled' });
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]).toMatchObject({ stage: 'family_enrolled' });
  });

  it('moves a prospect too — anything still in the active pipeline', async () => {
    const state = harness({ contactStage: 'initial_consultation' });

    await expect(promoteToClientStage(makeDb(state), 'user-1', 'contact-1')).resolves.toEqual({
      moved: true,
      stageKey: 'family_enrolled',
    });
  });

  /*
   * The refusal that matters most. A client who finished their programme and
   * then pays a late invoice must not reappear at the start of the board — the
   * business moved them to 'completed' deliberately, and a payment is not
   * evidence that decision was wrong.
   */
  it('refuses to drag a finished client backwards', async () => {
    const state = harness({ contactStage: 'completed' });

    const result = await promoteToClientStage(makeDb(state), 'user-1', 'contact-1');

    expect(result).toEqual({ moved: false, stageKey: 'completed' });
    expect(state.updates).toHaveLength(0);
  });

  it('does nothing when they are already the client stage', async () => {
    const state = harness({ contactStage: 'family_enrolled' });

    const result = await promoteToClientStage(makeDb(state), 'user-1', 'contact-1');

    expect(result).toEqual({ moved: false, stageKey: 'family_enrolled' });
    expect(state.updates).toHaveLength(0);
  });

  /*
   * No client stage configured is not a licence to invent one. Writing a guess
   * like 'customer' is exactly the bug this replaced: the contact lands
   * somewhere the board cannot draw.
   */
  it('leaves the contact alone when no client stage is configured', async () => {
    const state = harness({
      stages: PIPELINE.filter(s => s.stage_type !== 'client'),
      contactStage: 'inquiry',
    });

    const result = await promoteToClientStage(makeDb(state), 'user-1', 'contact-1');

    expect(result).toEqual({ moved: false, stageKey: null });
    expect(state.updates).toHaveLength(0);
  });

  // Falls back to the first client-typed stage when nothing is flagged primary,
  // so a pipeline built without ticking that box still works.
  it('falls back to a client-typed stage when none is marked primary', async () => {
    const state = harness({
      stages: PIPELINE.map(s => ({ ...s, is_primary_client_stage: false })),
      contactStage: 'inquiry',
    });

    await expect(promoteToClientStage(makeDb(state), 'user-1', 'contact-1')).resolves.toEqual({
      moved: true,
      stageKey: 'family_enrolled',
    });
  });

  it('does nothing for a contact that is not there', async () => {
    const state = harness({ contactStage: null });

    const result = await promoteToClientStage(makeDb(state), 'user-1', 'contact-1');

    expect(result).toEqual({ moved: false, stageKey: null });
    expect(state.updates).toHaveLength(0);
  });
});
