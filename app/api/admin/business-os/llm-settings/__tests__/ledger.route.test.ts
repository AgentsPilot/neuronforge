/**
 * GET /api/admin/business-os/llm-settings/ledger — S1-T15 (FR-18, FR-19, AC-17,
 * AC-18, AC-25).
 *
 * The three readings are the whole point. Reading 3 is the one the SA required
 * and the one an operator most needs: on `briefing` (daily), `insights` (cron)
 * or `onboarding` (sporadic), "no calls since the change" means nothing on its
 * own, and without the baseline the panel would print its most reassuring
 * sentence exactly where it proves least.
 */

import { NextRequest } from 'next/server';

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

const isAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (u: unknown) => isAdmin(u) }) },
}));

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = () => undefined;
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

const summarise = jest.fn();
jest.mock('@/lib/repositories/TokenUsageRepository', () => ({
  tokenUsageRepository: {
    summariseFeatureAllAccountsInWindow: (...a: unknown[]) => summarise(...a),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GET } = require('../ledger/route');
import { BOS_LLM_SETTINGS_CACHE_MS } from '@/lib/business-os/llm/modelSettings';
import {
  LEDGER_CHECK_CAVEAT,
  LEDGER_READING_TEXT,
} from '@/lib/business-os/llm/ledgerCheckCopy';

/** Long enough ago that the observation window has opened. */
const SAVED_AT = new Date(Date.now() - 10 * 60_000).toISOString();

function req(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost/api/admin/business-os/llm-settings/ledger');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url.toString());
}

function counts(after: number, before: number) {
  summarise
    .mockResolvedValueOnce({ data: { count: after, latestAt: after ? SAVED_AT : null }, error: null })
    .mockResolvedValueOnce({ data: { count: before, latestAt: before ? SAVED_AT : null }, error: null });
}

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue({ id: 'admin-1', email: 'admin@example.com' });
  isAdmin.mockResolvedValue(true);
});

describe('the gate', () => {
  it('is 401 signed out and 403 for a non-admin, with no ledger read either time', async () => {
    getUser.mockResolvedValue(null);
    expect((await GET(req({ area: 'leads', since: SAVED_AT }))).status).toBe(401);

    getUser.mockResolvedValue({ id: 'u1', email: 'x@example.com' });
    isAdmin.mockResolvedValue(false);
    expect((await GET(req({ area: 'leads', since: SAVED_AT }))).status).toBe(403);

    expect(summarise).not.toHaveBeenCalled();
  });
});

describe('the query is validated before it reaches a cross-tenant read', () => {
  it('refuses an unknown area and a bad timestamp', async () => {
    const bad = [
      req({ area: 'not-an-area', since: SAVED_AT }),
      req({ area: 'leads', since: 'yesterday' }),
      req({ area: 'leads' }),
    ];

    for (const request of bad) expect((await GET(request)).status).toBe(400);
    expect(summarise).not.toHaveBeenCalled();
  });

  it('DERIVES the feature from the area and ignores one supplied by the caller', async () => {
    counts(0, 3);

    await GET(req({ area: 'leads', since: SAVED_AT, feature: 'business-os-chat' }));

    for (const call of summarise.mock.calls) {
      expect(call[1]).toBe('business-os-leads');
    }
  });
});

describe('the windows', () => {
  it('starts the observation window 60 seconds after the save, not at it', async () => {
    counts(0, 1);

    await GET(req({ area: 'leads', since: SAVED_AT }));

    const [afterWindow] = summarise.mock.calls[0];
    expect(afterWindow.start.getTime()).toBe(new Date(SAVED_AT).getTime() + BOS_LLM_SETTINGS_CACHE_MS);
    // `token_usage` is written AFTER the provider call resolves, and instances
    // cache settings for this long — counting from the save moment would show
    // "still arriving" for a switch that held perfectly.
    expect(BOS_LLM_SETTINGS_CACHE_MS).toBe(60_000);
  });

  it('reads the same-length window ending at the save for the baseline', async () => {
    counts(0, 1);

    await GET(req({ area: 'leads', since: SAVED_AT }));

    const [afterWindow] = summarise.mock.calls[0];
    const [beforeWindow] = summarise.mock.calls[1];

    const afterLength = afterWindow.end.getTime() - afterWindow.start.getTime();
    const beforeLength = beforeWindow.end.getTime() - beforeWindow.start.getTime();

    expect(beforeLength).toBe(afterLength);
    expect(beforeWindow.end.toISOString()).toBe(SAVED_AT);
  });

  it('says so, and reads nothing, when the window has not opened yet', async () => {
    const res = await GET(req({ area: 'leads', since: new Date().toISOString() }));
    const body = await res.json();

    expect(body.data.kind).toBe('too_soon');
    expect(summarise).not.toHaveBeenCalled();
  });

  it('serves `too_soon` from the SHARED copy, not from a sentence written inline', async () => {
    // The whole point of the shared module is that the route and the panel
    // cannot disagree. A kind whose text lives at the route is a kind the
    // panel's switch has no branch for.
    const body = await (await GET(req({ area: 'leads', since: new Date().toISOString() }))).json();

    expect(body.data.reading).toBe(LEDGER_READING_TEXT.too_soon);
    expect(body.data.caveat).toBe(LEDGER_CHECK_CAVEAT);
  });

  it('every kind the route can emit has an entry in the shared text map', async () => {
    const emitted = [
      (await (await GET(req({ area: 'chat', since: SAVED_AT }))).json()).data.kind,
      (await (await GET(req({ area: 'leads', since: new Date().toISOString() }))).json()).data.kind,
    ];
    counts(1, 1);
    emitted.push((await (await GET(req({ area: 'leads', since: SAVED_AT }))).json()).data.kind);

    for (const kind of emitted) {
      expect(Object.keys(LEDGER_READING_TEXT)).toContain(kind);
    }
  });
});

describe('the since bound (an unbounded scan of the largest table)', () => {
  it('refuses a since older than the maximum window, before any read', async () => {
    const ancient = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const res = await GET(req({ area: 'leads', since: ancient }));
    const body = await res.json();

    // Two `count: 'exact'` scans over the whole of `token_usage` would
    // otherwise be reachable from one query string. Admin-gated, so not a
    // security hole — but an unbounded scan all the same.
    expect(res.status).toBe(400);
    expect(summarise).not.toHaveBeenCalled();
    expect(body.error).toMatch(/24 hours/);
  });

  it('refuses rather than silently clamping, so no one reads numbers they did not ask for', async () => {
    const ancient = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const body = await (await GET(req({ area: 'leads', since: ancient }))).json();

    expect(body.success).toBe(false);
    expect(body.data).toBeUndefined();
  });

  it('allows a since just inside the bound', async () => {
    counts(0, 1);
    const recent = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString();

    const res = await GET(req({ area: 'leads', since: recent }));

    expect(res.status).toBe(200);
    expect(summarise).toHaveBeenCalled();
  });

  it('chat short-circuits BEFORE the bound, so an old change still gets the chat answer', async () => {
    // DEF-2: this previously asserted `[200, 400]`, which EVERY status code
    // satisfies -- it proved nothing. The real ordering is Zod, then chat,
    // then the bound. So chat answers 200 even with an ancient `since`, and
    // still reads nothing.
    const ancient = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const res = await GET(req({ area: 'chat', since: ancient }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.kind).toBe('ledger_cannot_answer');
    expect(summarise).not.toHaveBeenCalled();
  });

  it('refuses a since in the FUTURE rather than answering "about 60 seconds"', async () => {
    // DEF-1: `2099-01-01` used to return 200 `too_soon`, false by 73 years.
    // No database read was reachable that way, but refuse-never-guess has to
    // be symmetric or it is not a principle.
    const res = await GET(req({ area: 'leads', since: '2099-01-01T00:00:00.000Z' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/in the future/);
    expect(summarise).not.toHaveBeenCalled();
  });

  it('still allows a since a few seconds ahead, for clock skew', async () => {
    // `too_soon` legitimately covers "saved a moment ago", and the app server
    // and the database need not agree to the millisecond.
    const slightlyAhead = new Date(Date.now() + 30_000).toISOString();

    const res = await GET(req({ area: 'leads', since: slightlyAhead }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.kind).toBe('too_soon');
  });

  it('says what is actually bounded: the age of the change, and the ~48 h total reach', async () => {
    // DEF-5: the copy said "24 hours" while the two reads together span about
    // 48. An operator reading the refusal should be able to predict what the
    // check would have covered.
    const ancient = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const body = await (await GET(req({ area: 'leads', since: ancient }))).json();

    expect(body.error).toMatch(/last 24 hours/);
    expect(body.error).toMatch(/48 hours/);
  });
});

describe('the three readings', () => {
  it('1 — calls still arriving', async () => {
    counts(4, 10);

    const body = await (await GET(req({ area: 'leads', since: SAVED_AT }))).json();

    expect(body.data.kind).toBe('still_arriving');
    expect(body.data.reading).toMatch(/not holding/);
  });

  it('2 — none since, and there was traffic before (the only corroborating reading)', async () => {
    counts(0, 10);

    const body = await (await GET(req({ area: 'leads', since: SAVED_AT }))).json();

    expect(body.data.kind).toBe('stopped_with_before');
    expect(body.data.reading).toMatch(/No calls completed since the change/);
  });

  it('3 — none since and none before: the ledger cannot tell you (a quiet area)', async () => {
    counts(0, 0);

    // `briefing` is daily. Without this branch it would render reading 2 —
    // the reassuring one — on exactly the areas where it proves least.
    const body = await (await GET(req({ area: 'briefing', since: SAVED_AT }))).json();

    expect(body.data.kind).toBe('no_traffic_either');
    expect(body.data.reading).toMatch(/cannot tell you/);
  });

  it('carries the caveat on every reading and never claims an area is off', async () => {
    for (const [after, before] of [[4, 10], [0, 10], [0, 0]]) {
      jest.clearAllMocks();
      counts(after, before);

      const body = await (await GET(req({ area: 'leads', since: SAVED_AT }))).json();

      expect(body.data.caveat).toMatch(/corroboration, not proof/);
      expect(body.data.caveat).toMatch(/fail silently/);

      // The assertion-bearing sentence is the READING; the caveat is scoped
      // separately because it legitimately contains those words in a DENIAL
      // ("nothing here can tell you an area is off"), and a blanket scan would
      // flag the very sentence doing the work.
      expect(body.data.reading).not.toMatch(/\bis off\b/);
      expect(body.data.reading).not.toMatch(/\bdisabled\b/i);
      expect(body.data.reading).not.toMatch(/\bswitched off\b/i);
      expect(body.data.reading).not.toMatch(/no calls are being made/i);
      // And the caveat must actively deny it, not merely omit it.
      expect(body.data.caveat).toMatch(/nothing here can tell you an area is off/);
    }
  });
});

describe('FR-19: chat is answered before any read', () => {
  it('renders NONE of the three readings and issues no cross-tenant query', async () => {
    const body = await (await GET(req({ area: 'chat', since: SAVED_AT }))).json();

    expect(body.data.kind).toBe('ledger_cannot_answer');
    expect(body.data.after).toBeNull();
    expect(body.data.before).toBeNull();
    // Not merely hidden by the client: never produced, and the repository is
    // never touched.
    expect(summarise).not.toHaveBeenCalled();
  });

  it('names the two checks that CAN answer', async () => {
    const body = await (await GET(req({ area: 'chat', since: SAVED_AT }))).json();

    expect(body.data.reading).toMatch(/writes no usage row/);
    expect(body.data.reading).toMatch(/entry gate/);
    expect(body.data.reading).toMatch(/Business OS LLM settings changed/);
  });
});

describe('failures', () => {
  it('returns 500 without leaking the error message', async () => {
    summarise.mockResolvedValue({ data: null, error: new Error('relation token_usage does not exist') });

    const res = await GET(req({ area: 'leads', since: SAVED_AT }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('token_usage');
  });
});
