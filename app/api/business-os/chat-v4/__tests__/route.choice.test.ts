/**
 * POST /api/business-os/chat-v4 — a parked "which one?" resumes the write.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THESE PIN
 *
 * The branch exists because the question used to COST the write: the resolved
 * command was dropped, and "the second one" was planned from scratch as a fresh
 * request. So the property under test is not that the right row is picked — that
 * is `pending-choice.test.ts` — but that picking it does not go near the
 * planner, and that a posted row id cannot reach a row the user was never shown.
 *
 * Also pinned: the branch sits ABOVE the AI kill switch and the budget wall. A
 * user who is out of allowance, or an operator who turned the chat off between
 * the question and the answer, must not strand a write the user already started
 * — the same rule the confirmation branch has followed since it was written.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest } from 'next/server';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrail: { log: jest.fn() },
  AuditTrailService: { getInstance: () => ({ log: jest.fn().mockResolvedValue(undefined) }) },
}));

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

/**
 * A chainable no-op client. The turn reads `user_preferences` for the timezone
 * before any branch runs, so a bare `{}` fails every test in this file for a
 * reason that has nothing to do with what they test.
 */
jest.mock('@/lib/supabaseServer', () => {
  const result = { data: null, error: null };
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'limit', 'order', 'neq', 'gt', 'lt']) {
    chain[method] = () => chain;
  }
  chain.single = async () => result;
  chain.maybeSingle = async () => result;
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return { supabaseServer: { from: () => chain } };
});
jest.mock('@/lib/business-os/userCurrency', () => ({ resolveUserCurrency: async () => 'USD' }));

/** Off by default, so "the branch runs anyway" is what each test proves. */
const mockAreaEnabled = jest.fn(async () => true);
jest.mock('@/lib/business-os/llm/modelSettings', () => {
  const actual = jest.requireActual('@/lib/business-os/llm/modelSettings');
  return { ...actual, isBosLlmAreaEnabled: () => mockAreaEnabled() };
});

const mockBudget = jest.fn(async () => ({
  allowed: true,
  turnsUsed: 1,
  turnsLimit: 100,
  turnsRemaining: 99,
  warn: false,
  resetsAt: null,
}));
jest.mock('@/lib/business-os/bizql/telemetry/ChatBudget', () => ({
  checkBudget: () => mockBudget(),
}));

jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: { findByUserId: async () => ({ data: { language: 'en' } }) },
}));

/** THE assertion of this file: none of these tests may reach the planner. */
const mockPlan = jest.fn();
jest.mock('@/lib/business-os/bizql/planner/Planner', () => ({
  getBizQLPlanner: () => ({ plan: (...a: unknown[]) => mockPlan(...a) }),
}));

/** No other parked state: the choice is the only session in play. */
jest.mock('@/lib/business-os/bizql/mutate/ConfirmationStore', () => ({
  ...jest.requireActual('@/lib/business-os/bizql/mutate/ConfirmationStore'),
  getConfirmationStore: () => ({ take: async () => null, park: async () => ({}), clear: async () => undefined }),
}));
jest.mock('@/lib/business-os/bizql/mutate/PendingFillStore', () => ({
  ...jest.requireActual('@/lib/business-os/bizql/mutate/PendingFillStore'),
  getPendingFillStore: () => ({ take: async () => null, park: async () => ({}), clear: async () => undefined }),
}));

const CANDIDATES = [
  { id: 'row-1', label: 'David Cohen — Tue 10:00', index: 1 },
  { id: 'row-2', label: 'David Levy — Wed 14:00', index: 2 },
];

const STEP = {
  id: 's1',
  op: 'mutate',
  entity: 'bookings',
  action: 'complete',
  target: { find: { where: [{ field: 'contact_name', op: 'eq', value: 'David' }] } },
};

let parked: Record<string, unknown> | null = null;
const mockChoiceClear = jest.fn(async () => {
  parked = null;
});
const mockChoicePark = jest.fn(async () => ({ choiceId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', candidates: CANDIDATES }));

jest.mock('@/lib/business-os/bizql/mutate/PendingChoiceStore', () => ({
  ...jest.requireActual('@/lib/business-os/bizql/mutate/PendingChoiceStore'),
  getPendingChoiceStore: () => ({
    take: async () => parked,
    park: (...a: unknown[]) => mockChoicePark(...(a as [])),
    clear: () => mockChoiceClear(),
  }),
}));

/** Everything downstream of the pick, stubbed: this file is about the branch. */
const mockResolveWrites = jest.fn(async () => ({
  status: 'resolved',
  writes: [{ step: { ...STEP, target: { id: 'row-2' } } }],
}));
jest.mock('@/lib/business-os/bizql/mutate/resolveWrites', () => ({
  ...jest.requireActual('@/lib/business-os/bizql/mutate/resolveWrites'),
  resolveWrites: (...a: unknown[]) => mockResolveWrites(...(a as [])),
}));

/**
 * The action log needs a database; stub it. Its real guarantee is a UNIQUE
 * index, so nothing is lost here — what these assert is that the resume path
 * claims AT ALL, and under the id of the question the user answered.
 */
const mockClaim = jest.fn(async (_args: { planId: string }) => ({
  proceed: true,
  entryId: 'entry-1' as string | null,
}));
jest.mock('@/lib/business-os/bizql/mutate/ActionLog', () => ({
  getActionLog: () => ({
    claim: (...a: Parameters<typeof mockClaim>) => mockClaim(...a),
    complete: async () => undefined,
    countToday: async () => 0,
    dailyLimit: async () => 200,
    isAvailable: () => true,
  }),
  idempotencyKey: (p: string, s: string) => `${p}|${s}`,
}));

const mockExecuteMutate = jest.fn(
  async (_q: unknown, _c: unknown, _o: { dryRun?: boolean } = {}) => ({
    op: 'mutate',
    preview: 'completed: David Levy',
  })
);
jest.mock('@/lib/business-os/bizql/mutate/MutateExecutor', () => ({
  ...jest.requireActual('@/lib/business-os/bizql/mutate/MutateExecutor'),
  executeMutate: (...a: Parameters<typeof mockExecuteMutate>) => mockExecuteMutate(...a),
}));

import { POST } from '../route';

const USER = { id: '2f734ed5-3681-4049-880d-3de7b096bea3', email: 'owner@example.com' };

function turn(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/business-os/chat-v4', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-correlation-id': '9c7a0c55-1111-4111-8111-111111111111',
    },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue(USER);
  mockAreaEnabled.mockResolvedValue(true);
  mockClaim.mockResolvedValue({ proceed: true, entryId: 'entry-1' });
  mockBudget.mockResolvedValue({
    allowed: true,
    turnsUsed: 1,
    turnsLimit: 100,
    turnsRemaining: 99,
    warn: false,
    resetsAt: null,
  });
  parked = {
    choiceId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
    entity: 'bookings',
    kind: 'ambiguous',
    total: 2,
    candidates: CANDIDATES,
    slot: { kind: 'target', stepIndex: 0 },
    steps: [STEP],
    names: [{}],
    sources: [],
    utterance: "mark David's booking done",
    language: 'en',
    attempts: 0,
  };
});

describe('a parked choice resumes the write', () => {
  it('applies a tapped row without planning anything', async () => {
    const res = await POST(turn({ message: 'David Levy — Wed 14:00', pick: { choiceId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', rowId: 'row-2' } }));

    expect(res.status).toBe(200);
    // The whole point: the write was carried, not re-derived.
    expect(mockPlan).not.toHaveBeenCalled();
    expect(mockExecuteMutate).toHaveBeenCalled();

    // Cleared BEFORE the write, so a double-tapped chip finds nothing parked.
    expect(mockChoiceClear).toHaveBeenCalled();

    // And clearing is only the first guard. The write is claimed under the id of
    // the question the user answered, so two taps that BOTH read the parked
    // choice before either clears it still apply it once.
    expect(mockClaim).toHaveBeenCalledWith(
      expect.objectContaining({ planId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' })
    );
  });

  it('does not write twice when the claim is already held', async () => {
    mockClaim.mockResolvedValue({ proceed: false, reason: 'already_done' } as never);

    const res = await POST(turn({ message: 'x', pick: { choiceId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', rowId: 'row-2' } }));

    expect(res.status).toBe(200);
    // Only the dry run that renders the line the user was already shown.
    expect(mockExecuteMutate.mock.calls.every((c) => c[2]?.dryRun)).toBe(true);
  });

  it('accepts a typed ordinal the same way', async () => {
    const res = await POST(turn({ message: 'the second one' }));

    expect(res.status).toBe(200);
    expect(mockPlan).not.toHaveBeenCalled();
    expect(mockExecuteMutate).toHaveBeenCalled();
  });

  it('refuses a row id that was never offered', async () => {
    /*
     * The injection case, and the reason the id is validated server-side against
     * the parked list rather than trusted from the body. A posted id must not be
     * a way to write to a row the user was never shown — so this falls back to
     * "I didn't catch which one", not to a write.
     */
    const res = await POST(turn({ message: 'x', pick: { choiceId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', rowId: 'row-999' } }));

    expect(res.status).toBe(200);
    expect(mockExecuteMutate).not.toHaveBeenCalled();
    expect(mockPlan).not.toHaveBeenCalled();
    expect((await res.json()).choice?.retry).toBe(true);
  });

  it('re-asks once, then lets the message be planned', async () => {
    const first = await POST(turn({ message: 'the one from Tuesday' }));
    expect((await first.json()).choice?.retry).toBe(true);
    expect(mockPlan).not.toHaveBeenCalled();

    // Second miss: the choice is dropped rather than trapping someone who has
    // moved on, and the message becomes an ordinary request again.
    parked = { ...(parked as object), attempts: 1 } as Record<string, unknown>;
    mockPlan.mockResolvedValue({ ok: false, error: 'nope', diagnostics: { model: 'x', cache: 'miss', repairAttempted: false, planningMs: 1 } });

    await POST(turn({ message: 'how many bookings today?' }));
    expect(mockChoiceClear).toHaveBeenCalled();
    expect(mockPlan).toHaveBeenCalled();
  });

  it('cancels on a bare cancel, writing nothing', async () => {
    const res = await POST(turn({ message: 'cancel' }));

    expect(res.status).toBe(200);
    expect(mockExecuteMutate).not.toHaveBeenCalled();
    expect(mockPlan).not.toHaveBeenCalled();
    expect(mockChoiceClear).toHaveBeenCalled();
  });
});

describe('the branch sits above the refusals', () => {
  it('still resumes when the chat AI is switched off', async () => {
    // Nothing here calls a model, and an operator flipping the switch between
    // the question and the answer must not strand a half-finished write.
    mockAreaEnabled.mockResolvedValue(false);

    const res = await POST(turn({ message: 'x', pick: { choiceId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', rowId: 'row-2' } }));

    expect(res.status).toBe(200);
    expect(mockExecuteMutate).toHaveBeenCalled();
  });

  it('still resumes when the user is out of allowance', async () => {
    mockBudget.mockResolvedValue({
      allowed: false,
      turnsUsed: 100,
      turnsLimit: 100,
      turnsRemaining: 0,
      warn: true,
      resetsAt: null,
    });

    const res = await POST(turn({ message: 'x', pick: { choiceId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', rowId: 'row-2' } }));

    expect(res.status).toBe(200);
    expect(mockExecuteMutate).toHaveBeenCalled();
  });
});
