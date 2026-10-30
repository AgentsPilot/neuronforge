/**
 * One tick of one agent runs exactly once.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE INVARIANT THIS WHOLE DESIGN EXISTS FOR
 *
 * A scheduled agent walks a plan that writes to real clients in its owner's
 * name — a chase for money owed, a nudge to rebook. Running one tick twice is
 * two emails about one thing, and there is no undo.
 *
 * Three things stand between a tick and a duplicate, and each is tested here:
 *
 *   the CAS on `next_run`     two overlapping cron ticks both read the same due
 *                             agent; only one moves the column, and the loser
 *                             updates zero rows and skips.
 *   the UNIQUE (agent_id,     the database backstop. A race that somehow beat
 *   scheduled_for)            the CAS still cannot produce two rows for a tick.
 *   claim-then-process        the drain only ever executes a row it atomically
 *                             claimed, and closes that same row.
 *
 * `FOR UPDATE SKIP LOCKED` is modelled rather than executed — Jest has no
 * Postgres — so these tests pin the RUNNER's half of the contract: that it
 * claims before executing, executes only what it claimed, and closes what it
 * executed. The SQL half is pinned by the migration's own shape, asserted in
 * theSchedulerUsesTheExecutionLedger.test.ts.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/* ── the agents table ───────────────────────────────────────────────────── */

interface Recorded {
  method: string;
  args: unknown[];
}

/** One agent row, as the scheduler selects it. */
function agentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-1',
    user_id: 'owner-1',
    agent_name: 'Chase overdue invoices',
    status: 'active',
    schedule_cron: '0 9 * * 1',
    timezone: 'UTC',
    next_run: '2026-10-29T09:00:00.000Z',
    last_run: null,
    pilot_steps: [{ step_id: 'step1' }, { step_id: 'step2' }],
    workflow_steps: [{ step_id: 'step1' }],
    plugins_required: ['business-os'],
    user_prompt: null,
    agent_config: { business_os_automation: { id: 'chase_overdue_invoices', stopAfterDays: 60 } },
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: null,
    ...overrides,
  };
}

/* What the fake `agents` table answers, per call, in order. */
let dueRows: unknown[] = [];
let claimWins: boolean[] = [];
let singleRow: unknown = undefined;
let agentQueries: Recorded[][] = [];
let claimCalls: Recorded[][] = [];
/*
 * Every patch passed to `.update()`, recorded when it is ISSUED.
 *
 * `claimCalls` only captures a chain that ends in `.select()`, which is how the
 * CAS resolves. The plan refresh ends at `.eq()` and so never appeared there —
 * a test asserting on it read `undefined` and looked like a missing feature
 * rather than a blind mock.
 */
let updates: Record<string, unknown>[] = [];

function agentsTable() {
  const calls: Recorded[] = [];
  let kind: 'select' | 'update' = 'select';

  const chain: Record<string, unknown> = {
    then: undefined,
  };

  const api: any = {
    select: (...args: unknown[]) => {
      calls.push({ method: 'select', args });
      return api;
    },
    update: (...args: unknown[]) => {
      kind = 'update';
      calls.push({ method: 'update', args });
      updates.push(args[0] as Record<string, unknown>);
      return api;
    },
    eq: (...args: unknown[]) => {
      calls.push({ method: 'eq', args });
      return api;
    },
    is: (...args: unknown[]) => {
      calls.push({ method: 'is', args });
      return api;
    },
    not: (...args: unknown[]) => {
      calls.push({ method: 'not', args });
      return api;
    },
    lte: (...args: unknown[]) => {
      calls.push({ method: 'lte', args });
      return api;
    },
    order: (...args: unknown[]) => {
      calls.push({ method: 'order', args });
      return api;
    },
    limit: (...args: unknown[]) => {
      calls.push({ method: 'limit', args });
      agentQueries.push(calls);
      return Promise.resolve({ data: dueRows, error: null });
    },
    maybeSingle: () => {
      agentQueries.push(calls);
      return Promise.resolve({ data: singleRow, error: null });
    },
    /* `.select('id')` at the end of an update resolves the CAS. */
    then: undefined,
  };

  /*
   * An update chain ends at `.select('id')` and must resolve. A select chain
   * ends at `.limit()` or `.maybeSingle()`. So `select` has to be callable in
   * both positions: it returns the chain, and the chain itself is awaitable.
   */
  api.select = (...args: unknown[]) => {
    calls.push({ method: 'select', args });
    if (kind === 'update') {
      claimCalls.push(calls);
      const won = claimWins.shift() ?? true;
      return Promise.resolve({ data: won ? [{ id: 'agent-1' }] : [], error: null });
    }
    return api;
  };

  void chain;
  return api;
}

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: { from: () => agentsTable() },
}));

/* ── the queue ──────────────────────────────────────────────────────────── */

const queueRun = jest.fn();
const claimDue = jest.fn();
const reapStale = jest.fn();
const markCompleted = jest.fn();
const markSkipped = jest.fn();
const markFailed = jest.fn();

jest.mock('@/lib/repositories/ScheduledExecutionRepository', () => ({
  scheduledExecutionRepository: {
    queueRun: (...a: unknown[]) => queueRun(...a),
    claimDue: (...a: unknown[]) => claimDue(...a),
    reapStale: (...a: unknown[]) => reapStale(...a),
    markCompleted: (...a: unknown[]) => markCompleted(...a),
    markSkipped: (...a: unknown[]) => markSkipped(...a),
    markFailed: (...a: unknown[]) => markFailed(...a),
  },
}));

/* ── the executor ───────────────────────────────────────────────────────── */

const execute = jest.fn();

jest.mock('@/lib/pilot', () => ({
  WorkflowPilot: class {
    execute(...args: unknown[]) {
      return execute(...args);
    }
  },
}));

const inputsForMock = jest.fn();
jest.mock('../inputsFor', () => ({ inputsFor: (...a: unknown[]) => inputsForMock(...a) }));

import {
  runScheduledAgents,
  nextRunAfter,
  nextRunFor,
  scheduleOffsetMinutes,
  LEASE_SECONDS,
  MAX_ATTEMPTS,
} from '../scheduledAgentRunner';

function queueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    user_id: 'owner-1',
    agent_id: 'agent-1',
    scheduled_at: '2026-10-29T09:00:00.000Z',
    status: 'processing',
    claimed_by: 'runner-1',
    claimed_at: new Date().toISOString(),
    retry_count: 1,
    next_retry_at: null,
    started_at: null,
    completed_at: null,
    error_message: null,
    result: {},
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  /*
   * The scheduler ships behind a default-off switch, so every behavioural test
   * below has to turn it on. The switch's own behaviour is pinned in the last
   * describe, which unsets it again.
   */
  process.env.AGENT_SCHEDULER_ENABLED = 'true';
  dueRows = [];
  claimWins = [];
  singleRow = undefined;
  agentQueries = [];
  claimCalls = [];
  updates = [];
  queueRun.mockResolvedValue({ data: { id: 'run-1' }, error: null });
  claimDue.mockResolvedValue([]);
  reapStale.mockResolvedValue([]);
  inputsForMock.mockResolvedValue({ stop_after_days: -60 });
  execute.mockResolvedValue({ success: true, executionId: 'exec-1' });
});

describe('the enqueue claims the tick before queueing it', () => {
  it('moves next_run with a WHERE on the value it read', async () => {
    dueRows = [agentRow()];

    await runScheduledAgents();

    const cas = claimCalls[0];
    expect(cas).toBeDefined();

    /* The compare-and-swap: matched on the exact tick we selected. Without the
       second `eq` two overlapping runners both "win". */
    expect(cas).toContainEqual({ method: 'eq', args: ['id', 'agent-1'] });
    expect(cas).toContainEqual({
      method: 'eq',
      args: ['next_run', '2026-10-29T09:00:00.000Z'],
    });
  });

  it('does not queue anything when it loses the race', async () => {
    dueRows = [agentRow()];
    claimWins = [false]; // zero rows updated: another tick got there first

    const result = await runScheduledAgents();

    expect(queueRun).not.toHaveBeenCalled();
    expect(result.due).toBe(1);
    expect(result.queued).toBe(0);
  });

  it('queues the tick it claimed, not the time it claimed it', async () => {
    /* `scheduled_for` is the tick. If it were `now()` two attempts at one tick
       would be two different rows and the unique index would never fire. */
    dueRows = [agentRow({ next_run: '2026-10-29T09:00:00.000Z' })];

    await runScheduledAgents();

    expect(queueRun).toHaveBeenCalledWith({
      user_id: 'owner-1',
      agent_id: 'agent-1',
      scheduled_at: '2026-10-29T09:00:00.000Z',
      /* Carried onto the ledger row so a run records WHAT schedule produced
         it, not merely that one did. `agent_executions.cron_expression` has
         always been there for this. */
      cron_expression: '0 9 * * 1',
    });
  });

  it('treats an already-queued tick as success, not a fault', async () => {
    /* The repository returns `{data: null, error: null}` when the unique index
       refuses a duplicate. That is the queue working, so it must not be
       counted as enqueued and must not be logged as broken. */
    dueRows = [agentRow()];
    queueRun.mockResolvedValue({ data: null, error: null });

    const result = await runScheduledAgents();

    expect(result.queued).toBe(0);
    expect(result.failed).toBe(0);
  });

  it('never writes last_run at claim time', async () => {
    /*
     * The retired scheduler did, which made "when did this last run" mean
     * "when was it last picked up" — a lie every time the run then failed.
     */
    dueRows = [agentRow()];

    await runScheduledAgents();

    expect(updates.some((u) => 'last_run' in u)).toBe(false);
  });
});

describe('the enqueue selects on the contract, not on a tag', () => {
  it('requires mode, schedule_enabled, active status and a passed next_run', async () => {
    dueRows = [];

    await runScheduledAgents();

    const q = agentQueries[0];
    expect(q).toContainEqual({ method: 'eq', args: ['mode', 'scheduled'] });
    expect(q).toContainEqual({ method: 'eq', args: ['schedule_enabled', true] });
    /* This one is what makes the ledger's pause real: pausing writes
       `status='inactive'` and nothing else. */
    expect(q).toContainEqual({ method: 'eq', args: ['status', 'active'] });
    expect(q).toContainEqual({ method: 'is', args: ['deleted_at', null] });
    expect(q.some((c) => c.method === 'lte' && c.args[0] === 'next_run')).toBe(true);
  });

  it('filters by no tag at all', async () => {
    /*
     * The point of the unification. An `on_demand` agent is excluded by `mode`
     * rather than by a tag allow-list somebody could widen, and a
     * prompt-created agent that is scheduled tomorrow needs no new code.
     */
    dueRows = [];

    await runScheduledAgents();

    const flat = JSON.stringify(agentQueries[0]);
    expect(flat).not.toContain('tags');
    expect(flat).not.toContain('business-os-automation');
    expect(flat).not.toContain('inbox-enquiries');
  });

  it('bounds the batch', async () => {
    await runScheduledAgents();
    expect(agentQueries[0]).toContainEqual({ method: 'limit', args: [25] });
  });
});

describe('the drain executes only what it claimed', () => {
  it('reaps before it claims, so a dead runner frees work this same pass', async () => {
    const order: string[] = [];
    reapStale.mockImplementation(async () => {
      order.push('reap');
      return [];
    });
    claimDue.mockImplementation(async () => {
      order.push('claim');
      return [];
    });

    await runScheduledAgents();

    expect(order).toEqual(['reap', 'claim']);
  });

  it('uses a lease longer than the route can live for', async () => {
    /* The platform hard-kills the function at maxDuration=60s, which is what
       makes a row still processing past the lease PROVABLY dead. A lease below
       it reclaims a live run and the agent runs twice. */
    await runScheduledAgents();

    expect(reapStale).toHaveBeenCalledWith(LEASE_SECONDS, MAX_ATTEMPTS);
    expect(LEASE_SECONDS).toBeGreaterThan(60);
  });

  it('gives each pass its own runner id', async () => {
    claimDue.mockResolvedValue([]);

    await runScheduledAgents();
    await runScheduledAgents();

    const first = claimDue.mock.calls[0][0];
    const second = claimDue.mock.calls[1][0];
    expect(first).not.toBe(second);
  });

  it('executes the claimed row and closes that same row', async () => {
    claimDue.mockResolvedValue([queueRow()]);
    singleRow = agentRow();

    const result = await runScheduledAgents();

    expect(execute).toHaveBeenCalledTimes(1);
    expect(markCompleted).toHaveBeenCalledWith('run-1', {
      executionId: 'exec-1',
      success: true,
    });
    expect(result.ran).toBe(1);
  });

  it('re-reads the agent scoped to the owner on the queue row', async () => {
    /* Cross-tenant safety at the choke point: the row carries `user_id`, and
       the re-read is filtered by it. A claimed row must never be able to
       execute somebody else's agent. */
    claimDue.mockResolvedValue([queueRow()]);
    singleRow = agentRow();

    await runScheduledAgents();

    const reRead = agentQueries.find((q) =>
      q.some((c) => c.method === 'eq' && c.args[0] === 'id' && c.args[1] === 'agent-1')
    );
    expect(reRead).toContainEqual({ method: 'eq', args: ['user_id', 'owner-1'] });
  });
});

describe('what the drain refuses to execute', () => {
  it('skips an agent paused between enqueue and claim', async () => {
    claimDue.mockResolvedValue([queueRow()]);
    singleRow = agentRow({ status: 'inactive' });

    const result = await runScheduledAgents();

    expect(execute).not.toHaveBeenCalled();
    expect(markSkipped).toHaveBeenCalledWith('run-1', 'agent is inactive');
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('skips an agent deleted between enqueue and claim', async () => {
    claimDue.mockResolvedValue([queueRow()]);
    singleRow = null;

    await runScheduledAgents();

    expect(execute).not.toHaveBeenCalled();
    expect(markSkipped).toHaveBeenCalledWith('run-1', 'agent no longer exists');
  });

  it('skips an agent with no compiled plan rather than asking a model', async () => {
    /*
     * There is no prompt fallback on purpose. An agent with no plan has nothing
     * to execute, and improvising one is what the retired dispatch path did.
     *
     * `agent_config: null` so this is a prompt-created agent, not an adopted
     * one. An adopted agent with empty steps is a DIFFERENT case and now heals
     * itself — the plan is refreshed from the catalogue before this check, see
     * the stale-plan describe below. Using an adopted agent here made this test
     * fail the moment that was built, which is the test telling the truth.
     */
    claimDue.mockResolvedValue([queueRow()]);
    singleRow = agentRow({ pilot_steps: [], workflow_steps: [], agent_config: null });

    await runScheduledAgents();

    expect(execute).not.toHaveBeenCalled();
    expect(markSkipped).toHaveBeenCalledWith('run-1', 'agent has no compiled plan');
  });
});

describe('a stale plan is brought up to date before it runs', () => {
  /*
   * THE BUG THIS EXISTS FOR.
   *
   * The plan is COPIED onto each owner's `agents` row at install, and the
   * runtime reads it from there. `planVersion` was stamped so the copy could be
   * detected when it fell behind — and nothing ever compared it.
   *
   * Measured on 2026-10-30: all six committed plans used a bare
   * `{{stop_after_days}}` where the pilot resolves `{{input.stop_after_days}}`,
   * so every one failed on its first step. Fixing the files did nothing for the
   * two agents already installed; their rows kept the broken token.
   */
  it('writes the current plan onto the row when the stamp is behind', async () => {
    claimDue.mockResolvedValue([queueRow()]);
    singleRow = agentRow({
      pilot_steps: [{ step_id: 'ancient' }],
      agent_config: {
        business_os_automation: { id: 'chase_overdue_invoices', planVersion: 'stale00' },
      },
    });

    await runScheduledAgents();

    const patch = updates.find((u) => 'pilot_steps' in u);
    expect(patch).toBeDefined();

    /* Both columns: the runtime reads `pilot_steps`, older surfaces read
       `workflow_steps`, and leaving one behind is how they drift. */
    expect(Object.keys(patch!).sort()).toEqual(
      ['agent_config', 'pilot_steps', 'plugins_required', 'updated_at', 'workflow_steps'].sort()
    );
    expect((patch!.agent_config as any).business_os_automation.planVersion).not.toBe('stale00');
  });

  it('executes the FRESH plan, not the one it read', async () => {
    /* The point of the exercise: refreshing the row and then running the stale
       copy from memory would fix nothing this pass. */
    claimDue.mockResolvedValue([queueRow()]);
    singleRow = agentRow({
      pilot_steps: [{ step_id: 'ancient' }],
      agent_config: {
        business_os_automation: { id: 'chase_overdue_invoices', planVersion: 'stale00' },
      },
    });

    await runScheduledAgents();

    const handed = execute.mock.calls[0][0] as { pilot_steps: { step_id?: string }[] };
    expect(handed.pilot_steps.some((s) => s.step_id === 'ancient')).toBe(false);
    expect(handed.pilot_steps.length).toBeGreaterThan(0);
  });

  it('writes nothing when the stamp is already current', async () => {
    const { planVersion } = await import('@/lib/business-os/automations/types');
    const { automationById } = await import('@/lib/business-os/automations/catalog');
    const current = planVersion(automationById('chase_overdue_invoices')!.steps);

    claimDue.mockResolvedValue([queueRow()]);
    singleRow = agentRow({
      agent_config: {
        business_os_automation: { id: 'chase_overdue_invoices', planVersion: current },
      },
    });

    await runScheduledAgents();

    expect(updates.find((u) => 'pilot_steps' in u)).toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('refreshes a MAILBOX channel too, not only an adopted agent', async () => {
    /*
     * The point of generalising this. The mailbox channel is the same kind of
     * thing — a plan we authored, copied onto the row — and it had no refresh
     * at all. Its plans were just repointed from the `crm` plugin to
     * `business-os.capture_enquiry_contacts`; without this, every connected
     * mailbox would have kept calling the retired door for ever.
     */
    claimDue.mockResolvedValue([queueRow()]);
    singleRow = agentRow({
      pilot_steps: [{ step_id: 'ancient' }],
      agent_config: { inbox_channel: { provider: 'google-mail', planVersion: 'stale00' } },
    });

    await runScheduledAgents();

    const patch = updates.find((u) => 'pilot_steps' in u);
    expect(patch).toBeDefined();

    /* Stamped back under ITS OWN key, not the automations' one. Writing it to
       the wrong place leaves the row looking stale for ever. */
    const config = patch!.agent_config as Record<string, Record<string, unknown>>;
    expect(config.inbox_channel.planVersion).not.toBe('stale00');
    expect(config.inbox_channel.provider).toBe('google-mail');
    expect(config.business_os_automation).toBeUndefined();

    /* And it is granted the plugin its refreshed plan actually calls. */
    expect(patch!.plugins_required).toEqual(['google-mail', 'business-os']);
  });

  it('writes nothing when the mailbox stamp is current', async () => {
    const { inboxPlanVersion } = await import('@/lib/business-os/leads/inboxPlans');

    claimDue.mockResolvedValue([queueRow()]);
    singleRow = agentRow({
      agent_config: {
        inbox_channel: { provider: 'google-mail', planVersion: inboxPlanVersion('google-mail') },
      },
    });

    await runScheduledAgents();

    expect(updates.find((u) => 'pilot_steps' in u)).toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('leaves a mailbox naming a provider we do not ship', async () => {
    /* Nothing to refresh it to, and inventing a plan is the one thing not to
       do. It runs whatever it has. */
    claimDue.mockResolvedValue([queueRow()]);
    singleRow = agentRow({
      agent_config: { inbox_channel: { provider: 'carrier-pigeon', planVersion: 'x' } },
    });

    await runScheduledAgents();

    expect(updates.find((u) => 'pilot_steps' in u)).toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('leaves a prompt-created agent alone', async () => {
    /* No catalogue entry, so nothing to compare against and nothing to write.
       An agent somebody wrote themselves must never have its plan replaced. */
    claimDue.mockResolvedValue([queueRow()]);
    singleRow = agentRow({ agent_config: null, user_prompt: 'Summarise my inbox' });

    await runScheduledAgents();

    expect(updates.find((u) => 'pilot_steps' in u)).toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe('failure is retried with backoff, then stops', () => {
  it('asks for a retry while attempts remain', async () => {
    claimDue.mockResolvedValue([queueRow({ retry_count: 2 })]);
    singleRow = agentRow();
    execute.mockRejectedValue(new Error('the plugin refused'));

    const result = await runScheduledAgents();

    expect(markFailed).toHaveBeenCalledWith('run-1', 'the plugin refused', true);
    expect(result.failed).toBe(1);
  });

  it('stops asking once they are spent', async () => {
    /*
     * This is what replaces the mailbox runner's deliberate hold-the-claim: a
     * permanently broken agent stops instead of being retried every five
     * minutes — but it ends in a state a human can find.
     */
    claimDue.mockResolvedValue([queueRow({ retry_count: MAX_ATTEMPTS })]);
    singleRow = agentRow();
    execute.mockRejectedValue(new Error('still broken'));

    await runScheduledAgents();

    expect(markFailed).toHaveBeenCalledWith('run-1', 'still broken', false);
  });

  it('one failing agent does not stop the ones behind it', async () => {
    claimDue.mockResolvedValue([
      queueRow({ id: 'run-1', agent_id: 'agent-1' }),
      queueRow({ id: 'run-2', agent_id: 'agent-1' }),
    ]);
    singleRow = agentRow();
    execute.mockRejectedValueOnce(new Error('first one broke')).mockResolvedValue({
      success: true,
      executionId: 'exec-2',
    });

    const result = await runScheduledAgents();

    expect(result.failed).toBe(1);
    expect(result.ran).toBe(1);
  });
});

describe('a plan that fails without throwing', () => {
  /*
   * THE BUG THIS EXISTS FOR, FOUND BY RUNNING IT FOR REAL.
   *
   * `pilot.execute` reports a failed step by RESOLVING with
   * `{ success: false }` — it does not reject. So a `try` around it catches a
   * crash and nothing else, and the first version of this runner counted a
   * failed plan as a completed run: it reported `ran: 2, failed: 0` while
   * `workflow_executions` said `failed`, and wrote a ledger row marked
   * `completed` with `success: false` inside it.
   *
   * No mock caught it, because every mock resolved truthfully.
   */
  it('records a returned failure as failed, not completed', async () => {
    claimDue.mockResolvedValue([queueRow({ retry_count: 1 })]);
    singleRow = agentRow();
    execute.mockResolvedValue({ success: false, executionId: 'exec-9', error: 'VARIABLE_RESOLUTION_ERROR' });

    const result = await runScheduledAgents();

    expect(markCompleted).not.toHaveBeenCalled();
    expect(markFailed).toHaveBeenCalledWith('run-1', 'VARIABLE_RESOLUTION_ERROR', true);
    expect(result.failed).toBe(1);
    expect(result.ran).toBe(0);
  });

  it('does not write last_run when the plan failed', async () => {
    /* "When did this last run" must not mean "when was it last attempted". */
    claimDue.mockResolvedValue([queueRow()]);
    singleRow = agentRow();
    execute.mockResolvedValue({ success: false, executionId: 'exec-9' });

    await runScheduledAgents();

    expect(updates.some((u) => 'last_run' in u)).toBe(false);
  });

  it('stops retrying a returned failure once attempts are spent', async () => {
    claimDue.mockResolvedValue([queueRow({ retry_count: MAX_ATTEMPTS })]);
    singleRow = agentRow();
    execute.mockResolvedValue({ success: false });

    await runScheduledAgents();

    expect(markFailed).toHaveBeenCalledWith('run-1', 'the plan reported failure', false);
  });

  it('still treats a genuine throw as a failure', async () => {
    /* Non-vacuous: the crash path must not have been broken by the above. */
    claimDue.mockResolvedValue([queueRow({ retry_count: 1 })]);
    singleRow = agentRow();
    execute.mockRejectedValue(new Error('the executor died'));

    const result = await runScheduledAgents();

    expect(markFailed).toHaveBeenCalledWith('run-1', 'the executor died', true);
    expect(result.failed).toBe(1);
  });

  it('a success is still a success', async () => {
    claimDue.mockResolvedValue([queueRow()]);
    singleRow = agentRow();
    execute.mockResolvedValue({ success: true, executionId: 'exec-ok' });

    const result = await runScheduledAgents();

    expect(markCompleted).toHaveBeenCalledWith('run-1', { executionId: 'exec-ok', success: true });
    expect(result.ran).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('writes last_run on success — the other half of the test above', async () => {
    /*
     * Added because a negative control exposed the gap: deleting the `last_run`
     * write entirely left the "not written on failure" test passing, because
     * nothing asserted it is written on success. A one-sided assertion about a
     * value is satisfied by that value never existing.
     */
    claimDue.mockResolvedValue([queueRow()]);
    singleRow = agentRow();
    execute.mockResolvedValue({ success: true, executionId: 'exec-ok' });

    await runScheduledAgents();

    const stamped = updates.find((u) => 'last_run' in u);
    expect(stamped).toBeDefined();
    expect(typeof stamped!.last_run).toBe('string');
  });
});

describe('what reaches the pilot', () => {
  it('passes the prompt where there is one and empty where there is not', async () => {
    /*
     * The single difference between the two halves of the platform. Safe
     * because `userInput` reaches only the memory injector and a serialization
     * inside the pilot — the plan is what executes.
     */
    claimDue.mockResolvedValue([queueRow()]);
    singleRow = agentRow({ user_prompt: null });
    await runScheduledAgents();
    expect(execute.mock.calls[0][2]).toBe('');

    jest.clearAllMocks();
    execute.mockResolvedValue({ success: true, executionId: 'e' });
    claimDue.mockResolvedValue([queueRow()]);
    singleRow = agentRow({ user_prompt: 'Summarise my inbox' });
    await runScheduledAgents();
    expect(execute.mock.calls[0][2]).toBe('Summarise my inbox');
  });

  it('hands the plan its runtime inputs', async () => {
    /* `planInputs` had no production caller before this runner. Without it
       `{{stop_after_days}}` resolves to nothing and the owner's stop rule
       silently does not apply. */
    claimDue.mockResolvedValue([queueRow()]);
    singleRow = agentRow();

    await runScheduledAgents();

    expect(execute.mock.calls[0][3]).toEqual({ stop_after_days: -60 });
  });

  it('states production mode explicitly', async () => {
    /* It is the pilot's default, but a run that writes to real clients must not
       depend on a default staying what it is. */
    claimDue.mockResolvedValue([queueRow()]);
    singleRow = agentRow();

    await runScheduledAgents();

    expect(execute.mock.calls[0][9]).toBe('production');
  });

  it('executes as the owner on the queue row', async () => {
    claimDue.mockResolvedValue([queueRow()]);
    singleRow = agentRow();

    await runScheduledAgents();

    expect(execute.mock.calls[0][1]).toBe('owner-1');
  });
});

describe('an unreadable cron expression', () => {
  it('refuses rather than inventing a schedule', async () => {
    /*
     * The retired scheduler fell back to `now + 1 hour` — a cadence nobody
     * chose, applied to something that emails clients. Refusing leaves the
     * agent visibly stuck, which is the honest failure.
     */
    expect(nextRunAfter('not a cron', 'UTC')).toBeNull();
  });

  it('does not claim or queue an agent it cannot reschedule', async () => {
    dueRows = [agentRow({ schedule_cron: 'every other tuesday' })];

    const result = await runScheduledAgents();

    expect(claimCalls).toHaveLength(0);
    expect(queueRun).not.toHaveBeenCalled();
    expect(result.queued).toBe(0);
  });

  it('reads a real expression in the agent own timezone', () => {
    const utc = nextRunAfter('0 9 * * *', 'UTC');
    const tokyo = nextRunAfter('0 9 * * *', 'Asia/Tokyo');

    expect(utc).toBeInstanceOf(Date);
    expect(tokyo).toBeInstanceOf(Date);
    /* Nine in the morning is a different instant in the two places. */
    expect(utc!.getTime()).not.toBe(tokyo!.getTime());
  });
});

describe('an agent scheduled by interval rather than by cron', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * "Every three days" has no cron expression. A step on the day-of-month field
   * means days 1, 4, 7 … 28, 31 and then 1, so the gap across the end of a
   * month is one day — which is what `every_3_days` has been doing. Those
   * agents carry an interval, and a cron that states only the time of day.
   * ───────────────────────────────────────────────────────────────────────────
   */

  const EVERY_THREE_DAYS = {
    agent_config: {
      business_os_automation: {
        id: 'chase_overdue_invoices',
        stopAfterDays: 60,
        schedule: '3d',
      },
    },
    /* The carrier: time of day, not cadence. */
    schedule_cron: '0 9 * * *',
    next_run: '2026-10-29T09:00:00.000Z',
  };

  it('moves next_run by the interval, not by the carrier cron', async () => {
    /*
     * THE WHOLE POINT. Reading the carrier would reschedule a three-day agent
     * for tomorrow, which is a cadence its owner did not choose and three times
     * the mail they agreed to.
     */
    dueRows = [agentRow(EVERY_THREE_DAYS)];

    await runScheduledAgents();

    const written = updates
      .map(u => u.next_run)
      .filter((v): v is string => typeof v === 'string');

    expect(written).toHaveLength(1);
    expect(written[0]).toBe('2026-11-01T09:00:00.000Z');
  });

  it('crosses the end of a month exactly', () => {
    /* 29 October plus three days is 1 November. The cron step said 31 October,
       then 1 November: a one-day gap. */
    const next = nextRunFor(
      agentRow(EVERY_THREE_DAYS) as never,
      new Date('2026-10-29T09:00:00.000Z')
    );

    expect(next!.toISOString()).toBe('2026-11-01T09:00:00.000Z');
  });

  it('keeps the time of day the carrier states', async () => {
    dueRows = [agentRow(EVERY_THREE_DAYS)];

    await runScheduledAgents();

    const written = updates.find(u => typeof u.next_run === 'string')!.next_run as string;

    expect(new Date(written).getUTCHours()).toBe(9);
    expect(new Date(written).getUTCMinutes()).toBe(0);
  });

  it('gets no per-owner offset, because the interval already spreads it', () => {
    /*
     * The offset exists because every named cadence fired at 09:00 sharp. An
     * interval is counted from each agent's own tick, so two accounts that
     * installed at different times are already apart and adding an offset would
     * only move the owner's time of day away from the one they were shown.
     */
    const next = nextRunFor(
      agentRow(EVERY_THREE_DAYS) as never,
      new Date('2026-10-29T09:00:00.000Z')
    );

    expect(next!.getUTCMinutes()).toBe(0);
  });

  it('is queued and claimed like any other agent', async () => {
    /* The enqueue guard used to require a cron AND a tick. An interval agent
       that failed that guard would be active, correct and never run. */
    dueRows = [agentRow(EVERY_THREE_DAYS)];

    const result = await runScheduledAgents();

    expect(result.due).toBe(1);
    expect(result.queued).toBe(1);
    expect(queueRun).toHaveBeenCalledTimes(1);
  });

  it('still refuses an agent with neither a readable cron nor an interval', async () => {
    dueRows = [agentRow({ schedule_cron: 'every other tuesday', agent_config: {} })];

    const result = await runScheduledAgents();

    expect(result.queued).toBe(0);
    expect(queueRun).not.toHaveBeenCalled();
  });

  it('prefers the interval over a cron that disagrees', () => {
    /*
     * A row carrying a weekly expression and a three-day interval is what an
     * owner who CHANGED their cadence looks like before anything rewrites the
     * carrier. The interval is the answer, every time.
     */
    const next = nextRunFor(
      agentRow({
        schedule_cron: '0 9 * * 1',
        agent_config: { business_os_automation: { id: 'x', schedule: '3d' } },
      }) as never,
      new Date('2026-10-29T09:00:00.000Z')
    );

    expect(next!.toISOString()).toBe('2026-11-01T09:00:00.000Z');
  });

  it('leaves an agent with no interval entirely on its cron', () => {
    /*
     * Every agent installed before this existed. Nothing is migrated, so the
     * cron path has to keep working untouched — including its offset.
     */
    const row = agentRow();
    const next = nextRunFor(row as never, new Date(row.next_run as string));

    expect(next!.getUTCDay()).toBe(1); // still Mondays
    expect(next!.getUTCMinutes()).toBe(scheduleOffsetMinutes('owner-1'));
  });
});

describe('the platform does not fire every agent in the same minute', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * Every cadence in `CADENCE_CRON` is `0 9` — daily, every three days, weekly,
   * fortnightly and monthly alike. So on the 1st of a month every adopted agent
   * on the platform is due at 09:00:00. At 25 per pass and a pass every five
   * minutes, five thousand of them take most of a day to work through, and the
   * one at the back sends its morning message in the afternoon.
   *
   * Invisible at three scheduled agents, which is why it is fixed now: today it
   * is one function, later it is a migration of everybody's `next_run`.
   * ───────────────────────────────────────────────────────────────────────────
   */

  const OWNERS = Array.from({ length: 200 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);

  it('puts different owners at different minutes of the hour', () => {
    const minutes = new Set(OWNERS.map((o) => scheduleOffsetMinutes(o)));

    /*
     * Asserted as a spread rather than a specific value: the point is that a
     * crowd disperses, and a hash that bunched 200 accounts into five minutes
     * would satisfy "it has an offset" while leaving the pile-up in place.
     */
    expect(minutes.size).toBeGreaterThan(30);
  });

  it('keeps every offset inside the hour', () => {
    for (const owner of OWNERS) {
      const offset = scheduleOffsetMinutes(owner);
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThan(60);
    }
  });

  it('gives one owner the same minute every time', () => {
    /*
     * The reason it is a hash and not a random number. A run that wandered
     * around the hour would mean an owner could not say when their business
     * writes to its clients, and the platform could not tell a late run from a
     * jittered one.
     */
    const first = scheduleOffsetMinutes(OWNERS[7]);

    for (let i = 0; i < 5; i += 1) {
      expect(scheduleOffsetMinutes(OWNERS[7])).toBe(first);
    }
  });

  it('keeps one owner agents together', () => {
    /* Keyed on the account, not the agent: six agents belonging to one business
       staying in step is the behaviour its owner already understands. */
    expect(scheduleOffsetMinutes(OWNERS[3])).toBe(scheduleOffsetMinutes(OWNERS[3]));
    expect(scheduleOffsetMinutes(OWNERS[3])).not.toBe(scheduleOffsetMinutes(OWNERS[4]));
  });

  it('moves the computed next run by exactly that many minutes', () => {
    const plain = nextRunAfter('0 9 * * *', 'UTC');
    const theirs = nextRunAfter('0 9 * * *', 'UTC', OWNERS[11]);

    expect(plain).toBeInstanceOf(Date);
    expect(theirs).toBeInstanceOf(Date);
    expect((theirs!.getTime() - plain!.getTime()) / 60_000).toBe(
      scheduleOffsetMinutes(OWNERS[11])
    );
  });

  it('leaves a sub-hourly cadence completely alone', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE REGRESSION THIS NEARLY WAS.
     *
     * An offset does not shift a repeating interval, it stretches it. The
     * mailbox channel runs every fifteen minutes: offset by seventeen, a run
     * lands at :17, the next quarter hour after that is :30, plus seventeen is
     * :47 — thirty minutes apart instead of fifteen. The channel's freshness
     * halved, silently, by a change made for the daily agents.
     *
     * The first version of the jitter applied to every expression and would
     * have done exactly that.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const quarterly = ['0,15,30,45 * * * *', '0 * * * *'];

    for (const cron of quarterly) {
      const plain = nextRunAfter(cron, 'UTC');
      const theirs = nextRunAfter(cron, 'UTC', OWNERS[11]);

      expect(theirs!.getTime()).toBe(plain!.getTime());
    }
  });

  it('offsets a fixed daily time whatever the day fields say', () => {
    /* `fortnightly` is `0 9 1,15 * *` — a list of days, one time of day. It
       fires once on those days and must be spread like the rest. */
    for (const cron of ['0 9 * * *', '0 9 * * 1', '0 9 1,15 * *', '0 9 1 * *']) {
      const plain = nextRunAfter(cron, 'UTC');
      const theirs = nextRunAfter(cron, 'UTC', OWNERS[11]);

      expect((theirs!.getTime() - plain!.getTime()) / 60_000).toBe(
        scheduleOffsetMinutes(OWNERS[11])
      );
    }
  });

  it('still refuses an unreadable expression, offset or not', () => {
    /* The offset must not become a way for a broken cron to acquire a
       schedule. */
    expect(nextRunAfter('every other tuesday', 'UTC', OWNERS[0])).toBeNull();
  });

  it('is applied by the queueing pass', async () => {
    /*
     * The pass is what writes `next_run`, so an offset the pass does not use is
     * an offset nobody has. Read off the patch the CAS actually issued, and
     * checked against the owner on the row rather than a constant — the first
     * version of this test asserted only that SOMETHING was written, which the
     * un-offset code satisfied.
     */
    const owner = OWNERS[11];
    dueRows = [agentRow({ user_id: owner, schedule_cron: '0 9 * * *' })];

    await runScheduledAgents();

    const written = updates
      .map((u) => u.next_run)
      .filter((v): v is string => typeof v === 'string');

    expect(written.length).toBeGreaterThan(0);
    expect(new Date(written[0]).getUTCMinutes()).toBe(scheduleOffsetMinutes(owner));
  });
});

describe('the off switch', () => {
  /*
   * The cron and its registry entry must land together — a test asserts
   * vercel.json and bosCronJobs.ts agree byte for byte — so the schedule cannot
   * arrive quietly ahead of the decision to run agents. It therefore arrives
   * inert, and this is what inert means.
   */
  afterEach(() => {
    process.env.AGENT_SCHEDULER_ENABLED = 'true';
  });

  it('reads nothing and runs nothing when unset', async () => {
    delete process.env.AGENT_SCHEDULER_ENABLED;
    dueRows = [agentRow()];
    claimDue.mockResolvedValue([queueRow()]);

    const result = await runScheduledAgents();

    expect(reapStale).not.toHaveBeenCalled();
    expect(claimDue).not.toHaveBeenCalled();
    expect(queueRun).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(agentQueries).toHaveLength(0);
    expect(result).toEqual({ due: 0, queued: 0, ran: 0, failed: 0, skipped: 0, reaped: 0 });
  });

  it('is off for anything that is not an explicit yes', async () => {
    for (const value of ['', 'false', '0', 'no', 'TRUE-ish', 'enabled']) {
      jest.clearAllMocks();
      process.env.AGENT_SCHEDULER_ENABLED = value;
      dueRows = [agentRow()];

      await runScheduledAgents();

      expect(`${JSON.stringify(value)} ran: ${execute.mock.calls.length > 0}`).toBe(
        `${JSON.stringify(value)} ran: false`
      );
    }
  });

  it('turns on for true and for 1', async () => {
    /* Non-vacuous: the test above would pass against a switch welded shut. */
    for (const value of ['true', '1']) {
      jest.clearAllMocks();
      execute.mockResolvedValue({ success: true, executionId: 'e' });
      process.env.AGENT_SCHEDULER_ENABLED = value;
      dueRows = [];
      claimDue.mockResolvedValue([queueRow()]);
      singleRow = agentRow();

      await runScheduledAgents();

      expect(`${value} ran: ${execute.mock.calls.length}`).toBe(`${value} ran: 1`);
    }
  });

  it('does not report a switched-off pass as a failure', async () => {
    /* A cron run record showing zero counts and no error is how an operator
       tells a scheduler that is off from one that is broken. */
    delete process.env.AGENT_SCHEDULER_ENABLED;

    const result = await runScheduledAgents();

    expect(result.failed).toBe(0);
  });
});
