/**
 * Auth gate for POST /api/sentinel/webhook/[agentId] (QA-1, option (d)).
 *
 * The route was anonymous: it built a service-role client at module scope and executed
 * the named agent through WorkflowPilot / runAgentKit AS `agent.user_id`, with that
 * owner's connected plugin credentials. Anyone who knew or guessed an agent id could run
 * someone else's agent against their real accounts.
 *
 * The property these tests defend is not "a gate exists" but "the gate runs FIRST":
 * before the URL parameter is resolved, before the body is read, before any query. A
 * late gate still leaks an enumeration oracle, because a real id answered "Invalid agent
 * mode" while a random one answered "Agent not found". T5 and T6 are the load-bearing
 * cases; the rest lock in the shape.
 *
 * Shape follows app/api/agent-executions/stats/__tests__/auth.test.ts.
 */

const from = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (...args: unknown[]) => from(...args) }),
}));

const pilotExecute = jest.fn();
jest.mock('@/lib/pilot', () => ({
  WorkflowPilot: class {
    execute = (...args: unknown[]) => pilotExecute(...args);
  },
}));

const runAgentKit = jest.fn();
jest.mock('@/lib/agentkit/runAgentKit', () => ({
  runAgentKit: (...args: unknown[]) => runAgentKit(...args),
}));

const getBoolean = jest.fn();
jest.mock('@/lib/services/SystemConfigService', () => ({
  SystemConfigService: { getBoolean: (...args: unknown[]) => getBoolean(...args) },
}));

const createExecution = jest.fn();
const completeExecution = jest.fn();
const failExecution = jest.fn();
jest.mock('@/lib/database/executionHelpers', () => ({
  createExecution: (...args: unknown[]) => createExecution(...args),
  completeExecution: (...args: unknown[]) => completeExecution(...args),
  failExecution: (...args: unknown[]) => failExecution(...args),
}));

import { NextRequest } from 'next/server';

import { POST } from '@/app/api/sentinel/webhook/[agentId]/route';

const SECRET = 'sentinel-test-secret-value';
const REAL_AGENT_ID = '11111111-1111-4111-8111-111111111111';
const MISSING_AGENT_ID = '22222222-2222-4222-8222-222222222222';
const OWNER_USER_ID = '33333333-3333-4333-8333-333333333333';
const EXECUTION_ROW_ID = '44444444-4444-4444-8444-444444444444';

const TRIGGERED_AGENT = {
  id: REAL_AGENT_ID,
  user_id: OWNER_USER_ID,
  agent_name: 'Sentinel Test Agent',
  mode: 'triggered',
  status: 'active',
  workflow_steps: null,
  plugins_required: [],
};

const post = (
  agentId: string,
  { headers = {}, body = { event: 'contact.created' } }: {
    headers?: Record<string, string>;
    body?: unknown;
  } = {}
) => {
  const request = new NextRequest(`http://localhost/api/sentinel/webhook/${agentId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return POST(request, { params: Promise.resolve({ agentId }) });
};

const auth = (secret = SECRET) => ({ authorization: `Bearer ${secret}` });

/** Minimal stand-in for the two PostgREST chains the route uses. */
const stubSupabase = (agentRow: unknown) => {
  from.mockImplementation((table: string) => {
    if (table === 'agents') {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.single = async () =>
        agentRow ? { data: agentRow, error: null } : { data: null, error: { message: 'not found' } };
      return chain;
    }
    // agent_configurations
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.order = () => chain;
    chain.limit = () => chain;
    chain.maybeSingle = async () => ({ data: null, error: null });
    return chain;
  });
};

/** Let the fire-and-forget executeAgentAsync run to completion. */
const flush = () => new Promise(resolve => setImmediate(resolve));

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SENTINEL_WEBHOOK_SECRET = SECRET;
  stubSupabase(TRIGGERED_AGENT);
  getBoolean.mockResolvedValue(false);
  createExecution.mockResolvedValue({ data: { id: EXECUTION_ROW_ID }, error: null });
  completeExecution.mockResolvedValue({ error: null });
  failExecution.mockResolvedValue({ error: null });
  runAgentKit.mockResolvedValue({ success: true });
});

afterEach(() => {
  Object.defineProperty(process.env, 'NODE_ENV', { value: ORIGINAL_NODE_ENV, configurable: true });
});

/** The single response D5 mandates for every rejection cause, as literal bytes. */
const UNAUTHORIZED_BODY = JSON.stringify({ success: false, error: 'Unauthorized' });

/** Nothing may reach the database or an execution engine on a rejected request. */
const expectNothingExecuted = () => {
  expect(from).not.toHaveBeenCalled();
  expect(createExecution).not.toHaveBeenCalled();
  expect(pilotExecute).not.toHaveBeenCalled();
  expect(runAgentKit).not.toHaveBeenCalled();
};

describe('POST /api/sentinel/webhook/[agentId] — shared-secret gate', () => {
  it('T1: 401s when SENTINEL_WEBHOOK_SECRET is unset (fail closed)', async () => {
    delete process.env.SENTINEL_WEBHOOK_SECRET;

    const res = await post(REAL_AGENT_ID, { headers: auth() });

    expect(res.status).toBe(401);
    expect(await res.text()).toBe(UNAUTHORIZED_BODY);
    expectNothingExecuted();
  });

  it('T2: every rejection cause returns a byte-identical 401 (D5)', async () => {
    // D5 requires ONE response for all four causes. Asserting status only would let a
    // "helpful" refactor give each cause its own message — the exact divergence D5
    // forbids — while staying green. So each cause is pinned to the literal bytes.
    const causes: Array<[string, () => Promise<Response>]> = [
      ['missing header', () => post(REAL_AGENT_ID)],
      ['malformed scheme (none)', () => post(REAL_AGENT_ID, { headers: { authorization: SECRET } })],
      ['malformed scheme (Basic)', () =>
        post(REAL_AGENT_ID, { headers: { authorization: `Basic ${SECRET}` } })],
      ['malformed scheme (empty Bearer)', () =>
        post(REAL_AGENT_ID, { headers: { authorization: 'Bearer ' } })],
      ['wrong secret', () => post(REAL_AGENT_ID, { headers: auth('not-the-secret') })],
      // Same length as the real secret — reaches timingSafeEqual, not the length guard.
      ['wrong secret (same length)', () =>
        post(REAL_AGENT_ID, { headers: auth('x'.repeat(SECRET.length)) })],
    ];

    for (const [label, send] of causes) {
      const res = await send();
      // Labelled so a failure names the diverging cause.
      expect([label, res.status]).toEqual([label, 401]);
      expect([label, await res.text()]).toEqual([label, UNAUTHORIZED_BODY]);
    }

    // The fourth cause — unset secret — must be indistinguishable from the other three.
    delete process.env.SENTINEL_WEBHOOK_SECRET;
    const unset = await post(REAL_AGENT_ID, { headers: auth() });
    expect(unset.status).toBe(401);
    expect(await unset.text()).toBe(UNAUTHORIZED_BODY);

    expectNothingExecuted();
  });

  it('T3: with the correct secret, a non-triggered agent still 400s (behaviour unchanged)', async () => {
    stubSupabase({ ...TRIGGERED_AGENT, mode: 'on_demand' });

    const res = await post(REAL_AGENT_ID, { headers: auth() });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Invalid agent mode');
    expect(runAgentKit).not.toHaveBeenCalled();
    expect(pilotExecute).not.toHaveBeenCalled();
  });

  it('T4: with the correct secret, a triggered agent executes and returns the written row id', async () => {
    const res = await post(REAL_AGENT_ID, { headers: auth() });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    // The id handed to the caller must be the row createExecution actually wrote,
    // not a locally generated uuid that points at nothing.
    expect(body.executionId).toBe(EXECUTION_ROW_ID);
    expect(createExecution).toHaveBeenCalledWith({
      agent_id: REAL_AGENT_ID,
      user_id: OWNER_USER_ID,
      execution_type: 'triggered',
    });

    await flush();

    expect(runAgentKit).toHaveBeenCalledTimes(1);
    expect(runAgentKit.mock.calls[0][0]).toBe(OWNER_USER_ID);
    // Session id is the execution row id, so logs and the row line up.
    expect(runAgentKit.mock.calls[0][4]).toBe(EXECUTION_ROW_ID);
    expect(completeExecution).toHaveBeenCalledTimes(1);
    expect(completeExecution.mock.calls[0][0]).toBe(EXECUTION_ROW_ID);
  });

  it('T5: an unauthenticated request cannot distinguish a real agent id from a random one', async () => {
    stubSupabase(TRIGGERED_AGENT);
    const real = await post(REAL_AGENT_ID);
    const realBody = await real.text();

    jest.clearAllMocks();
    stubSupabase(null);
    const missing = await post(MISSING_AGENT_ID);
    const missingBody = await missing.text();

    // Byte-identical: no enumeration oracle. Before the gate, the real id answered
    // 400 "Invalid agent mode" and the random one 404 "Agent not found".
    expect(real.status).toBe(missing.status);
    expect(real.status).toBe(401);
    expect(realBody).toBe(missingBody);
    expect(realBody).toBe(UNAUTHORIZED_BODY);
  });

  it('T6: on a 401 the database and both execution engines are never touched (gate is FIRST)', async () => {
    const res = await post(REAL_AGENT_ID, { headers: auth('wrong') });

    expect(res.status).toBe(401);
    // Gate present but late would still have run the lookup. This is the difference.
    expect(from).not.toHaveBeenCalled();
    expect(getBoolean).not.toHaveBeenCalled();
    expect(createExecution).not.toHaveBeenCalled();
    expect(pilotExecute).not.toHaveBeenCalled();
    expect(runAgentKit).not.toHaveBeenCalled();

    await flush();
    expect(runAgentKit).not.toHaveBeenCalled();
  });

  it('T7: the secret is not accepted as a query parameter', async () => {
    const request = new NextRequest(
      `http://localhost/api/sentinel/webhook/${REAL_AGENT_ID}?secret=${SECRET}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }
    );

    const res = await POST(request, { params: Promise.resolve({ agentId: REAL_AGENT_ID }) });

    expect(res.status).toBe(401);
    expectNothingExecuted();
  });

  it('T8: authenticated non-object and oversized bodies are rejected without executing', async () => {
    const array = await post(REAL_AGENT_ID, { headers: auth(), body: [1, 2, 3] });
    expect(array.status).toBe(400);

    const str = await post(REAL_AGENT_ID, { headers: auth(), body: '"just a string"' });
    expect(str.status).toBe(400);

    const nul = await post(REAL_AGENT_ID, { headers: auth(), body: 'null' });
    expect(nul.status).toBe(400);

    const invalidJson = await post(REAL_AGENT_ID, { headers: auth(), body: '{not json' });
    expect(invalidJson.status).toBe(400);

    // 128 KB cap — one key whose value comfortably exceeds it.
    const oversized = await post(REAL_AGENT_ID, {
      headers: auth(),
      body: { blob: 'x'.repeat(200 * 1024) },
    });
    expect(oversized.status).toBe(400);
    expect((await oversized.json()).error).toBe('Payload too large');

    await flush();

    // The body is bounded before the agent is ever looked up or executed.
    expect(createExecution).not.toHaveBeenCalled();
    expect(runAgentKit).not.toHaveBeenCalled();
    expect(pilotExecute).not.toHaveBeenCalled();
  });

  it('T9: development mode does not bypass the gate when the secret is unset', async () => {
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'development', configurable: true });
    delete process.env.SENTINEL_WEBHOOK_SECRET;

    const res = await post(REAL_AGENT_ID, { headers: auth() });

    expect(res.status).toBe(401);
    expect(await res.text()).toBe(UNAUTHORIZED_BODY);
    expectNothingExecuted();
  });
});
