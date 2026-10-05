/**
 * Recording a day off.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The reading side treats an unreadable `custom_hours` as a CLOSED date — the
 * conservative reading of a recorded intention to restrict. That makes the
 * validation here load-bearing rather than decorative: a short day that slipped
 * through with no hours, or with its end before its start, would close a date
 * the owner meant to shorten and they would never be told why.
 *
 * So these are mostly about what the route REFUSES.
 * ─────────────────────────────────────────────────────────────────────────────
 */

jest.mock('@/lib/logger', () => {
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), child: () => logger };
  return { createLogger: () => logger };
});

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockList = jest.fn();
const mockCreate = jest.fn();
jest.mock('@/lib/repositories/SchedulingTimeOffRepository', () => ({
  schedulingTimeOffRepository: {
    list: (...args: unknown[]) => mockList(...args),
    create: (...args: unknown[]) => mockCreate(...args),
  },
}));

const mockAudit = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: { getInstance: () => ({ log: (...args: unknown[]) => mockAudit(...args) }) },
}));

import { GET, POST } from '../route';

const USER = { id: 'user-1' };

function post(body: unknown) {
  return new Request('http://localhost/api/scheduling/time-off', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0];
}

const get = () =>
  new Request('http://localhost/api/scheduling/time-off') as unknown as Parameters<typeof GET>[0];

const CLOSED = {
  exception_type: 'unavailable',
  start_date: '2026-10-06',
  end_date: '2026-10-14',
  reason: 'Sukkot',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue(USER);
  mockList.mockResolvedValue({ data: [], error: null });
  mockCreate.mockResolvedValue({ data: { id: 'off-1', ...CLOSED }, error: null });
});

describe('who may do this', () => {
  it('refuses a reader with no session', async () => {
    mockGetUser.mockResolvedValue(null);
    expect((await GET(get())).status).toBe(401);
  });

  it('refuses a writer with no session', async () => {
    mockGetUser.mockResolvedValue(null);
    expect((await POST(post(CLOSED))).status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('recording a closed range', () => {
  it('saves it against the caller, never a supplied id', async () => {
    const response = await POST(post({ ...CLOSED, user_id: 'someone-else' }));

    expect(response.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1', exception_type: 'unavailable', reason: 'Sukkot' })
    );
  });

  it('carries no hours, so the reader cannot misread it', async () => {
    await POST(post({ ...CLOSED, custom_hours: { start: '09:00', end: '13:00' } }));

    // A closed day with hours on it is a contradiction; the repository drops
    // them, and this asserts the route does not insist on them either.
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ exception_type: 'unavailable' })
    );
  });

  it('audits it without letting a failed audit fail the write', async () => {
    mockAudit.mockRejectedValueOnce(new Error('audit down'));

    const response = await POST(post(CLOSED));

    expect(response.status).toBe(201);
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SCHEDULING_TIME_OFF_ADDED' })
    );
  });
});

describe('what it refuses', () => {
  it('a range that runs backwards', async () => {
    const response = await POST(post({ ...CLOSED, start_date: '2026-10-14', end_date: '2026-10-06' }));

    expect(response.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('a short day with no hours', async () => {
    // This is the one that matters: it would CLOSE the date, not shorten it.
    const response = await POST(
      post({ exception_type: 'custom_hours', start_date: '2026-10-22', end_date: '2026-10-22' })
    );

    expect(response.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('short hours that end before they start', async () => {
    const response = await POST(
      post({
        exception_type: 'custom_hours',
        start_date: '2026-10-22',
        end_date: '2026-10-22',
        custom_hours: { start: '13:00', end: '09:00' },
      })
    );

    expect(response.status).toBe(400);
  });

  it('a date that is not a date', async () => {
    expect((await POST(post({ ...CLOSED, start_date: '06/10/2026' }))).status).toBe(400);
  });

  it('a type nobody reads', async () => {
    expect((await POST(post({ ...CLOSED, exception_type: 'maybe' }))).status).toBe(400);
  });
});

describe('a short day that is valid', () => {
  it('is saved with its hours', async () => {
    mockCreate.mockResolvedValue({ data: { id: 'off-2' }, error: null });

    const response = await POST(
      post({
        exception_type: 'custom_hours',
        start_date: '2026-10-22',
        end_date: '2026-10-22',
        custom_hours: { start: '09:00', end: '13:00' },
      })
    );

    expect(response.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ custom_hours: { start: '09:00', end: '13:00' } })
    );
  });
});

describe('the list', () => {
  it('asks for everything, because the screen shows everything', async () => {
    await GET(get());

    // No window: an owner looking for the fortnight they booked off in
    // December must find it.
    expect(mockList).toHaveBeenCalledWith('user-1');
  });

  it('reports a failure rather than an empty list', async () => {
    mockList.mockResolvedValue({ data: null, error: new Error('db down') });

    const response = await GET(get());
    expect(response.status).toBe(500);
  });
});
