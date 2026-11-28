/**
 * Every gated test or debug route, through the REAL `requireAdmin` (PROD-1c
 * A-1, T-3, T-4 and T-7 to T-10 (T-5 and T-6 were deleted in F-8); F-2: on
 * every deployment, not only production).
 *
 * The unit test next to this file pins the gate on its own. This one pins
 * precedence: on every deployment a non-admin gets the gate's 404 and none of the
 * route's own work runs (no session read past the gate's, no plugin manager,
 * no database, no LLM, no workflow). An admin gets past the
 * gate to the route's own checks. G-9 in envConfigHardening.guard.test.ts pins
 * the same thing as source; this pins it as behaviour.
 *
 * Only the seams are mocked: the session, the admin table, and each route's
 * heavy dependency. Nothing reaches the network.
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
// The refused-access row for a signed-in non-admin (requireAdmin, SA D-12): recorded, never sent.
const recordRefusedAccess = jest.fn();
jest.mock('@/lib/audit/recordRefusedAccess', () => ({
  recordRefusedAccess: (...args: unknown[]) => recordRefusedAccess(...args),
}));

/** Each route's own work. None of these may run for a refused caller. */
const work = {
  analyzePrompt: jest.fn(),
  pluginManager: jest.fn(),
  v5Generate: jest.fn(),
  database: jest.fn(),
  workflow: jest.fn(),
  llm: jest.fn(),
  identity: jest.fn(),
};

jest.mock('@/lib/agentkit/analyzePrompt-v3-direct', () => ({
  analyzePromptDirectAgentKit: (...args: unknown[]) => work.analyzePrompt(...args),
}));
jest.mock('@/lib/server/plugin-manager-v2', () => ({
  PluginManagerV2: { getInstance: (...args: unknown[]) => work.pluginManager(...args) },
}));
jest.mock('@/lib/agentkit/v4/v5-generator', () => ({
  V5WorkflowGenerator: class {
    constructor(...args: unknown[]) {
      work.v5Generate(...args);
    }
  },
}));
jest.mock('@/lib/supabaseServer', () => {
  // Any chain of calls, awaited, is an empty count. Every call is recorded.
  const chain: unknown = new Proxy(function () {}, {
    get: (_t, prop) =>
      prop === 'then'
        ? (resolve: (v: unknown) => void) => resolve({ count: 0, data: [], error: null })
        : chain,
    apply: (_t, _this, args) => {
      work.database(...(args as unknown[]));
      return chain;
    },
  });
  return { supabaseServer: chain, createServerSupabaseClient: () => chain };
});
jest.mock('@/lib/pilot/WorkflowPilot', () => ({
  WorkflowPilot: class {
    execute = (...args: unknown[]) => work.workflow(...args);
  },
}));
jest.mock('@/lib/ai/providerFactory', () => ({
  ProviderFactory: { getProvider: (...args: unknown[]) => work.llm(...args) },
  PROVIDERS: { OPENAI: 'openai' },
}));
jest.mock('@/lib/agentkit/v6/compiler/WorkflowPostValidator', () => ({
  WorkflowPostValidator: class {
    constructor(...args: unknown[]) {
      work.llm(...args);
    }
  },
}));
jest.mock('@/lib/server/route-identity', () => ({
  resolveActingUserIdentity: (...args: unknown[]) => work.identity(...args),
}));

import { NextRequest } from 'next/server';

import * as analyzePrompt from '@/app/api/test/analyze-prompt/route';
import * as v5Wrapper from '@/app/api/test/generate-agent-v5-test-wrapper/route';
import * as dataCheck from '@/app/api/v2/debug/data-check/route';
import * as executeTest from '@/app/api/v6/execute-test/route';
import * as directGeneration from '@/app/api/v6/test-direct-generation/route';
import * as testAudit from '@/app/api/plugins/test-audit/route';

type Handler = (request: NextRequest) => Promise<Response>;

const HANDLERS: Array<[string, Handler, 'GET' | 'POST' | 'OPTIONS']> = [
  ['T-3 POST /api/test/analyze-prompt', analyzePrompt.POST as Handler, 'POST'],
  ['T-4 POST /api/test/generate-agent-v5-test-wrapper', v5Wrapper.POST as Handler, 'POST'],
  ['T-7 GET /api/v2/debug/data-check', dataCheck.GET as Handler, 'GET'],
  ['T-8 POST /api/v6/execute-test', executeTest.POST as Handler, 'POST'],
  ['T-8 OPTIONS /api/v6/execute-test', executeTest.OPTIONS as Handler, 'OPTIONS'],
  ['T-9 POST /api/v6/test-direct-generation', directGeneration.POST as Handler, 'POST'],
  ['T-10 POST /api/plugins/test-audit', testAudit.POST as Handler, 'POST'],
];

const request = (method: 'GET' | 'POST' | 'OPTIONS') =>
  new NextRequest('http://localhost/api/x', {
    method,
    ...(method === 'POST' ? { headers: { 'content-type': 'application/json' }, body: '{}' } : {}),
  });

const ADMIN = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'ops@example.com' };
const CUSTOMER = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', email: 'customer@example.com' };

const saved = { VERCEL: process.env.VERCEL, VERCEL_ENV: process.env.VERCEL_ENV };

/*
 * F-2: the same cases on three deployments. The production row carries A-1's
 * assertions unchanged ("production is unchanged"); the preview and local rows
 * make the same assertions ("a non-admin is refused off production, an admin
 * passes").
 */
const DEPLOYMENTS: Array<[string, string | undefined, string | undefined]> = [
  ['production', '1', 'production'],
  ['a Vercel preview', '1', 'preview'],
  ['a local run with no Vercel variables (next dev, Jest)', undefined, undefined],
];

const setEnv = (vercel: string | undefined, vercelEnv: string | undefined) => {
  if (vercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = vercel;
  if (vercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = vercelEnv;
};

beforeEach(() => {
  jest.clearAllMocks();
  recordRefusedAccess.mockResolvedValue(undefined);
});

afterAll(() => {
  if (saved.VERCEL === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = saved.VERCEL;
  if (saved.VERCEL_ENV === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = saved.VERCEL_ENV;
});

const noWorkRan = () => {
  for (const [name, fn] of Object.entries(work)) {
    expect({ name, calls: fn.mock.calls.length }).toEqual({ name, calls: 0 });
  }
};

describe.each(DEPLOYMENTS)('on %s, every gated handler answers 404 to a non-admin before any of its own work', (_deployment, vercel, vercelEnv) => {
  beforeEach(() => setEnv(vercel, vercelEnv));

  it.each(HANDLERS)('%s: anonymous', async (_label, handler, method) => {
    getUser.mockResolvedValue(null);

    const response = await handler(request(method));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ success: false, error: 'Not found' });
    // One session read, the gate's own; the route's never ran.
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(isAdmin).not.toHaveBeenCalled();
    noWorkRan();
  });

  it.each(HANDLERS)('%s: a signed-in non-admin (and the refusal is recorded as admin_api)', async (_label, handler, method) => {
    getUser.mockResolvedValue(CUSTOMER);
    isAdmin.mockResolvedValue(false);

    const response = await handler(request(method));

    expect(response.status).toBe(404);
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(recordRefusedAccess).toHaveBeenCalledTimes(1);
    expect(recordRefusedAccess.mock.calls[0][0]).toMatchObject({ userId: CUSTOMER.id, surface: 'admin_api' });
    noWorkRan();
  });
});

describe.each(DEPLOYMENTS)('on %s, an admin gets past the gate to the route itself', (_deployment, vercel, vercelEnv) => {
  beforeEach(() => setEnv(vercel, vercelEnv));

  it.each(HANDLERS)('%s', async (_label, handler, method) => {
    getUser.mockResolvedValue(ADMIN);
    isAdmin.mockResolvedValue(true);

    const response = await handler(request(method));

    // Whatever the route answers to an empty request, it is not the gate's 404.
    const body = response.headers.get('content-type')?.includes('application/json')
      ? await response.json()
      : null;
    expect({ status: response.status, body }).not.toEqual({
      status: 404,
      body: { success: false, error: 'Not found' },
    });
    expect(recordRefusedAccess).not.toHaveBeenCalled();
  });
});
