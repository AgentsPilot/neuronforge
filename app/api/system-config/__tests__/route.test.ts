/**
 * GET /api/system-config — the signed-in, allow-listed read of platform settings.
 *
 * Workplan: docs/workplans/system-config-route-auth-workplan.md (test matrix T1-T17).
 *
 * Contract under test:
 *   - signed-in callers only (401 before anything else runs);
 *   - only allow-listed keys are ever queried AND ever returned, whatever the
 *     table (here: the repository mock) holds;
 *   - the success body is a FLAT key -> value map (the agent creation page reads
 *     it that way); every error body is `{ success: false, error, details }`
 *     with `details` only in development.
 *
 * Every seam is mocked: `tests/jest-no-network.ts` refuses real connections, and
 * mocking the `@/lib/repositories` barrel means no service-role client is built.
 */

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

const getByKeys = jest.fn();
const getByCategoryAsMap = jest.fn();
jest.mock('@/lib/repositories', () => ({
  systemConfigRepository: {
    getByKeys: (...a: unknown[]) => getByKeys(...a),
    getByCategoryAsMap: (...a: unknown[]) => getByCategoryAsMap(...a),
  },
}));

const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {
      info: (...a: unknown[]) => mockLog.info(...a),
      warn: (...a: unknown[]) => mockLog.warn(...a),
      error: (...a: unknown[]) => mockLog.error(...a),
      debug: (...a: unknown[]) => mockLog.debug(...a),
    };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import { NextRequest } from 'next/server';

import { GET } from '@/app/api/system-config/route';

const USER = { id: 'test-user-id' };

/** Recognisable sentinel values, so the logging test can prove none leaks. */
const PROVIDER_VALUE = 'sentinel-provider-value';
const MODEL_VALUE = 'sentinel-model-value';
const GENERATION_VALUE = 'sentinel-generation-value';
const OTHER_VALUE = 'sentinel-other-category-value';

const ALLOWED = ['agent_creation_ai_provider', 'agent_creation_ai_model'];

const row = (key: string, value: unknown, category = 'agent_creation') => ({
  id: `id-${key}`,
  key,
  value,
  category,
  description: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  updated_by: null,
});

const ALLOWED_ROWS = [
  row('agent_creation_ai_provider', PROVIDER_VALUE),
  row('agent_creation_ai_model', MODEL_VALUE),
];

const get = (query: string) =>
  new NextRequest(`http://localhost/api/system-config${query}`, { method: 'GET' });

const call = async (query: string) => {
  const res = await GET(get(query));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

/** The rows the mock returns, restricted to what was asked for (a well-behaved repository). */
const returnRequested = (rows: ReturnType<typeof row>[]) => async (keys: string[]) => ({
  data: rows.filter((r) => keys.includes(r.key)),
  error: null,
});

const expectRepositoryUntouched = () => {
  expect(getByKeys).not.toHaveBeenCalled();
  expect(getByCategoryAsMap).not.toHaveBeenCalled();
};

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue(USER);
  getByKeys.mockImplementation(returnRequested(ALLOWED_ROWS));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('GET /api/system-config — happy paths', () => {
  it('T1: category mode returns exactly the allow-listed keys of that category, flat', async () => {
    const { status, body } = await call('?category=agent_creation');

    expect(status).toBe(200);
    expect(body).toEqual({
      agent_creation_ai_provider: PROVIDER_VALUE,
      agent_creation_ai_model: MODEL_VALUE,
    });
    expect(getByKeys).toHaveBeenCalledTimes(1);
    expect([...getByKeys.mock.calls[0][0]].sort()).toEqual([...ALLOWED].sort());
    expect(getByCategoryAsMap).not.toHaveBeenCalled();
  });

  it('T2: keys mode returns the requested allow-listed key', async () => {
    const { status, body } = await call('?keys=agent_creation_ai_model');

    expect(status).toBe(200);
    expect(body).toEqual({ agent_creation_ai_model: MODEL_VALUE });
    expect(getByKeys).toHaveBeenCalledWith(['agent_creation_ai_model']);
  });

  it('T17: duplicate keys are queried once', async () => {
    const { status } = await call('?keys=agent_creation_ai_model,agent_creation_ai_model');

    expect(status).toBe(200);
    expect(getByKeys).toHaveBeenCalledWith(['agent_creation_ai_model']);
  });
});

describe('GET /api/system-config — the allow-list filter', () => {
  it('T3: non-allowed keys are dropped before the query, not rejected', async () => {
    const { status, body } = await call(
      '?keys=agent_creation_ai_model,tokens_per_pilot_credit,agent_generation_ai_model',
    );

    expect(status).toBe(200);
    expect(body).toEqual({ agent_creation_ai_model: MODEL_VALUE });
    expect(getByKeys).toHaveBeenCalledWith(['agent_creation_ai_model']);
  });

  it('T4: a request with no allowed key at all is 200 {} and never reaches the repository', async () => {
    const { status, body } = await call('?keys=tokens_per_pilot_credit');

    expect(status).toBe(200);
    expect(body).toEqual({});
    expectRepositoryUntouched();
  });

  it('T5: rows the repository returns beyond what was asked are stripped', async () => {
    getByKeys.mockResolvedValue({
      data: [
        ...ALLOWED_ROWS,
        row('agent_generation_ai_model', GENERATION_VALUE),
        row('some_other_setting', OTHER_VALUE, 'other'),
      ],
      error: null,
    });

    const { status, body } = await call('?category=agent_creation');

    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual([...ALLOWED].sort());
    expect(JSON.stringify(body)).not.toContain(GENERATION_VALUE);
    expect(JSON.stringify(body)).not.toContain(OTHER_VALUE);
  });

  it('T5b: keys mode also strips rows that were not requested', async () => {
    getByKeys.mockResolvedValue({ data: ALLOWED_ROWS, error: null });

    const { body } = await call('?keys=agent_creation_ai_model');

    expect(body).toEqual({ agent_creation_ai_model: MODEL_VALUE });
  });

  it('T15: allow-list invariants hold, observed through the handler', async () => {
    // Every key category mode queries is also accepted, unchanged, by keys mode —
    // so the two modes are driven by one list and each key passes the key regex.
    await call('?category=agent_creation');
    const categoryKeys: string[] = [...getByKeys.mock.calls[0][0]];

    getByKeys.mockClear();
    await call(`?keys=${categoryKeys.join(',')}`);
    expect([...getByKeys.mock.calls[0][0]].sort()).toEqual([...categoryKeys].sort());

    for (const key of categoryKeys) {
      getByKeys.mockClear();
      const { status } = await call(`?keys=${key}`);
      expect(status).toBe(200);
      expect(getByKeys).toHaveBeenCalledWith([key]);
    }

    // The success body is flat, so no allowed key may collide with an envelope field.
    for (const reserved of ['success', 'error', 'details', 'data']) {
      expect(categoryKeys).not.toContain(reserved);
    }
  });
});

describe('GET /api/system-config — auth', () => {
  it.each(['?category=agent_creation', '?keys=agent_creation_ai_model', '?category=bogus', ''])(
    'T6: signed out (%s) is 401 and never reaches the repository',
    async (query) => {
      getUser.mockResolvedValue(null);

      const { status, body } = await call(query);

      expect(status).toBe(401);
      expect(body).toEqual({ success: false, error: 'Unauthorized' });
      expectRepositoryUntouched();
    },
  );

  it('T14: getUser throwing is a 500 and never reaches the repository', async () => {
    getUser.mockRejectedValue(new Error('auth backend down'));

    const { status, body } = await call('?category=agent_creation');

    expect(status).toBe(500);
    expect(body.success).toBe(false);
    expect(JSON.stringify(body)).not.toContain('auth backend down');
    expectRepositoryUntouched();
  });
});

describe('GET /api/system-config — invalid input', () => {
  const tooLongSegment = 'a'.repeat(101);
  const tooManyKeys = Array.from({ length: 21 }, (_, i) => `key_${i}`).join(',');
  // Every segment is valid once trimmed, so only the raw-length cap can reject it.
  const tooLongRaw = encodeURIComponent(`agent_creation_ai_model,${' '.repeat(2100)}agent_creation_ai_provider`);

  it.each([
    ['T7: a category not on the allow-list', '?category=admin'],
    ['T7: an empty category', '?category='],
    ['T8: uppercase key', '?keys=Agent_Creation_AI_Model'],
    ['T8: a key with a separator character', '?keys=a;b'],
    ['T8: an empty segment', '?keys=a,,b'],
    ['T8: a trailing comma', '?keys=agent_creation_ai_model,'],
    ['T8: an empty keys param', '?keys='],
    ['T8: a 101-character segment', `?keys=${tooLongSegment}`],
    ['T8: 21 segments', `?keys=${tooManyKeys}`],
    ['T8: a raw keys string over the length cap', `?keys=${tooLongRaw}`],
    ['T9: neither param', ''],
    ['T10: both params', '?category=agent_creation&keys=agent_creation_ai_model'],
  ])('%s is 400 and never reaches the repository', async (_label, query) => {
    const { status, body } = await call(query);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Invalid input');
    expect(body.details).toBeUndefined();
    expectRepositoryUntouched();
  });

  it('T7b: 400 details are present in development', async () => {
    jest.replaceProperty(process.env, 'NODE_ENV', 'development');

    const { status, body } = await call('?category=admin');

    expect(status).toBe(400);
    expect(body.details).toBeDefined();
  });
});

describe('GET /api/system-config — failures', () => {
  it('T11: a repository error is a 500 with no internal detail outside development', async () => {
    getByKeys.mockResolvedValue({ data: null, error: new Error('internal db detail') });

    const { status, body } = await call('?category=agent_creation');

    expect(status).toBe(500);
    expect(body).toEqual({ success: false, error: 'Failed to fetch configuration' });
    expect(JSON.stringify(body)).not.toContain('internal db detail');
  });

  it('T12: the same repository error carries details in development', async () => {
    jest.replaceProperty(process.env, 'NODE_ENV', 'development');
    getByKeys.mockResolvedValue({ data: null, error: new Error('internal db detail') });

    const { status, body } = await call('?category=agent_creation');

    expect(status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.details).toBe('internal db detail');
  });

  it('T13: a thrown repository error is a generic 500', async () => {
    getByKeys.mockRejectedValue(new Error('thrown internal detail'));

    const { status, body } = await call('?keys=agent_creation_ai_model');

    expect(status).toBe(500);
    expect(body).toEqual({ success: false, error: 'Internal server error' });
    expect(JSON.stringify(body)).not.toContain('thrown internal detail');
  });
});

describe('GET /api/system-config — logging hygiene', () => {
  const allLogCalls = () =>
    [mockLog.info, mockLog.warn, mockLog.error, mockLog.debug].flatMap((fn) => fn.mock.calls);

  it('T16: no config value and no raw keys param is ever logged; the success line carries userId and counts', async () => {
    const rawKeys = 'agent_creation_ai_model,tokens_per_pilot_credit,agent_generation_ai_model';
    await call('?category=agent_creation');
    await call(`?keys=${rawKeys}`);

    const logged = JSON.stringify(allLogCalls());
    for (const value of [PROVIDER_VALUE, MODEL_VALUE, rawKeys, 'tokens_per_pilot_credit']) {
      expect(logged).not.toContain(value);
    }

    const success = mockLog.debug.mock.calls.find(
      ([ctx]) => typeof ctx === 'object' && ctx !== null && 'returnedCount' in ctx,
    );
    expect(success).toBeDefined();
    expect(success![0]).toEqual(
      expect.objectContaining({
        userId: USER.id,
        requestedCount: expect.any(Number),
        allowedCount: expect.any(Number),
        returnedCount: expect.any(Number),
      }),
    );
  });
});
