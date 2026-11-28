/**
 * POST /api/v6/test-direct-generation (T-9): admin only on every deployment,
 * attributed to the admin, and no error text to the caller (PROD-1c F-2).
 *
 * The route had no authentication of its own, attributed its LLM calls to
 * `'system'`, and returned the raw error message in its body. F-2 puts the
 * route's own `requireAdmin` directly after the test-surface gate, attributes
 * all three LLM calls to the signed-in admin, and keeps the reason for a
 * failure in the log (and in `details` in development only).
 *
 * The real gate and the real `requireAdmin` run. Only the seams are mocked:
 * the session, the admin table, the refusal audit, the plugin manager, the
 * validator and the LLM provider. Nothing reaches the network.
 */

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

const isAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: {
    getInstance: () => ({ isAdmin: (...args: unknown[]) => isAdmin(...args) }),
  },
}));

jest.mock('@/lib/services/AuditTrailService', () => jest.requireActual('@/tests/helpers/silentAuditTrail'));
const recordRefusedAccess = jest.fn();
jest.mock('@/lib/audit/recordRefusedAccess', () => ({
  recordRefusedAccess: (...args: unknown[]) => recordRefusedAccess(...args),
}));

/*
 * Every logger the route builds is this one, so the catch's log can be read.
 * Built inside the factory: the route calls createLogger while it is imported,
 * before this file's own constants exist.
 */
jest.mock('@/lib/logger', () => {
  const logger: Record<string, jest.Mock> = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  logger.child = jest.fn(() => logger);
  return { createLogger: () => logger, clientLogger: logger, testLogger: logger };
});

const getAvailablePlugins = jest.fn();
jest.mock('@/lib/server/plugin-manager-v2', () => ({
  PluginManagerV2: { getInstance: async () => ({ getAvailablePlugins: () => getAvailablePlugins() }) },
}));

const validate = jest.fn();
jest.mock('@/lib/agentkit/v6/compiler/WorkflowPostValidator', () => ({
  WorkflowPostValidator: class {
    validate = (...args: unknown[]) => validate(...args);
  },
}));

/** The LLM seam. */
const chatCompletion = jest.fn();
const getProvider = jest.fn();
jest.mock('@/lib/ai/providerFactory', () => ({
  ProviderFactory: { getProvider: (...args: unknown[]) => getProvider(...args) },
  PROVIDERS: { OPENAI: 'openai' },
}));

import { NextRequest } from 'next/server';

import { POST } from '@/app/api/v6/test-direct-generation/route';

const log = (jest.requireMock('@/lib/logger') as { testLogger: Record<'info' | 'warn' | 'error' | 'debug' | 'child', jest.Mock> }).testLogger;

const ADMIN = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'ops@example.com' };
const CUSTOMER = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', email: 'customer@example.com' };

/** Must never reach a log line or the response. */
const PROMPT_MARKER = 'PROMPT-MARKER-7f3a';
/** The provider's failure text: must reach the log, and the body only in development. */
const FAILURE_MARKER = 'PROVIDER-FAILURE-91c2';

const BODY = { enhanced_prompt: { plan_description: PROMPT_MARKER, specifics: { services_involved: [] } } };

const post = (raw: string = JSON.stringify(BODY)) =>
  new NextRequest('http://localhost/api/v6/test-direct-generation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw,
  });

const reply = (content: string) => ({ choices: [{ message: { content } }] });

const DEPLOYMENTS: Array<[string, string | undefined, string | undefined]> = [
  ['production', '1', 'production'],
  ['a Vercel preview', '1', 'preview'],
  ['a local run with no Vercel variables', undefined, undefined],
];

// `NODE_ENV` is typed read-only; this suite switches it for one case.
const env = process.env as Record<string, string | undefined>;
const saved = { VERCEL: env.VERCEL, VERCEL_ENV: env.VERCEL_ENV, NODE_ENV: env.NODE_ENV };

const setEnv = (vercel: string | undefined, vercelEnv: string | undefined) => {
  if (vercel === undefined) delete env.VERCEL;
  else env.VERCEL = vercel;
  if (vercelEnv === undefined) delete env.VERCEL_ENV;
  else env.VERCEL_ENV = vercelEnv;
};

const signInAsAdmin = () => {
  getUser.mockResolvedValue(ADMIN);
  isAdmin.mockResolvedValue(true);
};

beforeEach(() => {
  jest.clearAllMocks();
  recordRefusedAccess.mockResolvedValue(undefined);
  getAvailablePlugins.mockReturnValue({});
  getProvider.mockReturnValue({ chatCompletion: (...args: unknown[]) => chatCompletion(...args) });
  env.NODE_ENV = saved.NODE_ENV;
});

afterAll(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
});

describe.each(DEPLOYMENTS)('on %s', (_deployment, vercel, vercelEnv) => {
  beforeEach(() => setEnv(vercel, vercelEnv));

  it('refuses an anonymous caller with the gate 404, before any LLM call', async () => {
    getUser.mockResolvedValue(null);

    const res = await POST(post());

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ success: false, error: 'Not found' });
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(getProvider).not.toHaveBeenCalled();
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it('refuses a signed-in non-admin with the gate 404, records it as admin_api, and makes no LLM call', async () => {
    getUser.mockResolvedValue(CUSTOMER);
    isAdmin.mockResolvedValue(false);

    const res = await POST(post());

    expect(res.status).toBe(404);
    expect(recordRefusedAccess).toHaveBeenCalledTimes(1);
    expect(recordRefusedAccess.mock.calls[0][0]).toMatchObject({ userId: CUSTOMER.id, surface: 'admin_api' });
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it('lets an admin through the gate and its own check, and attributes all three LLM calls to the admin', async () => {
    signInAsAdmin();
    // 1. The semantic plan has no steps[], so the IR repair runs.
    // 2. The IR repair is valid; the validator below still says invalid, so the Pilot repair runs.
    // 3. The Pilot repair.
    chatCompletion
      .mockResolvedValueOnce(reply('{}'))
      .mockResolvedValueOnce(reply('{"steps": []}'))
      .mockResolvedValueOnce(reply('{"workflow_steps": []}'));
    validate.mockReturnValue({ valid: false, issues: [{ message: 'still invalid' }], autoFixed: false });

    const res = await POST(post());

    expect(res.status).toBe(200);
    expect((await res.json()).method).toBe('ir -> compile -> normalize -> validate -> pilot_repair');
    // The gate's session read, then the route's own.
    expect(getUser).toHaveBeenCalledTimes(2);
    expect(recordRefusedAccess).not.toHaveBeenCalled();

    expect(chatCompletion).toHaveBeenCalledTimes(3);
    const contexts = chatCompletion.mock.calls.map((call) => call[1] as { userId: string; activity_type: string });
    expect(contexts.map((c) => c.activity_type)).toEqual(['semantic_plan', 'ir_repair', 'pilot_repair']);
    expect(contexts.map((c) => c.userId)).toEqual([ADMIN.id, ADMIN.id, ADMIN.id]);
    expect(JSON.stringify(contexts)).not.toContain('system');
  });

  it('outside development, a failure puts no error text anywhere in the body, and logs { err } without the prompt', async () => {
    signInAsAdmin();
    const failure = new Error(`upstream said ${FAILURE_MARKER}`);
    chatCompletion.mockRejectedValue(failure);

    const res = await POST(post());
    const text = await res.text();
    const body = JSON.parse(text);

    expect(res.status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Workflow generation failed');
    expect(body.validation.issues).toEqual([{ level: 'fatal', message: 'Workflow generation failed' }]);
    expect(body).not.toHaveProperty('details');
    // The whole serialised body (SA B-2), not just `error`.
    expect(text).not.toContain(FAILURE_MARKER);
    expect(text).not.toContain(PROMPT_MARKER);
    // `debug` holds lengths only.
    for (const value of Object.values(body.debug)) expect(typeof value).toBe('number');

    // Logged once, as `{ err }`, through the request logger; never the prompt.
    const failureLogs = log.error.mock.calls.filter((call) => call[1] === 'Direct generation failed');
    expect(failureLogs).toHaveLength(1);
    expect(Object.keys(failureLogs[0][0])).toEqual(['err']);
    expect(failureLogs[0][0].err).toBe(failure);
    expect(log.child).toHaveBeenCalledWith({ correlationId: expect.any(String) });
    for (const level of [log.info, log.warn, log.error, log.debug]) {
      expect(JSON.stringify(level.mock.calls)).not.toContain(PROMPT_MARKER);
    }
  });

  it('a body that is not JSON gets the same generic failure, with no parse text', async () => {
    signInAsAdmin();

    const res = await POST(post('{ not json'));
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(JSON.parse(text).error).toBe('Workflow generation failed');
    expect(JSON.parse(text)).not.toHaveProperty('details');
    expect(text).not.toMatch(/Unexpected|position|not valid JSON/i);
    expect(chatCompletion).not.toHaveBeenCalled();
  });
});

describe('in development only, the reason is in `details`', () => {
  it('carries the error message in details, and nowhere else in the body', async () => {
    setEnv(undefined, undefined);
    env.NODE_ENV = 'development';
    signInAsAdmin();
    chatCompletion.mockRejectedValue(new Error(`upstream said ${FAILURE_MARKER}`));

    const res = await POST(post());
    const body = await res.json();

    expect(body.details).toBe(`upstream said ${FAILURE_MARKER}`);
    expect(body.error).toBe('Workflow generation failed');
    const { details: _details, ...rest } = body;
    expect(JSON.stringify(rest)).not.toContain(FAILURE_MARKER);
  });
});
