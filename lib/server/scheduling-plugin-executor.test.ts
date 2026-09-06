// lib/server/scheduling-plugin-executor.test.ts
//
// Fast, pure unit tests for the Scheduling plugin executor. Repositories are mocked (no DB).
// Focus: dispatch + user_id scoping, the reschedule conflict/availability logic, and the
// delegate-only guardrail (booking writes never touch CRM repos — the triggers own that).

const serviceRepo = {
  create: jest.fn(),
  listAll: jest.fn(),
  findById: jest.fn(),
  update: jest.fn(),
  publish: jest.fn(),
  delete: jest.fn(),
  countBookings: jest.fn(),
};
const bookingRepo = {
  create: jest.fn(),
  list: jest.fn(),
  findById: jest.fn(),
  update: jest.fn(),
  cancel: jest.fn(),
  complete: jest.fn(),
  markNoShow: jest.fn(),
  checkOverlap: jest.fn(),
};
const businessProfileRepo = { findByUserId: jest.fn() };
// Contact resolution moved into the executor when `client_*` left scheduling_bookings
// (20260810_remove_client_fields_and_total_amount.sql) - see the guardrail test below.
const crmContactRepo = { findByEmail: jest.fn(), create: jest.fn() };

jest.mock('@/lib/repositories/SchedulingRepository', () => ({
  schedulingServiceRepository: serviceRepo,
  schedulingBookingRepository: bookingRepo,
}));
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: businessProfileRepo,
}));
jest.mock('@/lib/repositories/CRMContactRepository', () => ({
  crmContactRepository: crmContactRepo,
}));

import { SchedulingPluginExecutor } from './scheduling-plugin-executor';

function run(action: string, params: any, connection: any = { user_id: 'u1' }) {
  const executor = new SchedulingPluginExecutor({} as any, {} as any);
  return (executor as any).executeSpecificAction(connection, action, params);
}

const ok = (data: any) => ({ data, error: null });

beforeEach(() => {
  jest.clearAllMocks();
  for (const repo of [serviceRepo, bookingRepo]) {
    for (const fn of Object.values(repo)) (fn as jest.Mock).mockResolvedValue(ok({}));
  }
  bookingRepo.checkOverlap.mockResolvedValue(ok([]));
  businessProfileRepo.findByUserId.mockResolvedValue(ok(null)); // no availability config → no window restriction
});

describe('SchedulingPluginExecutor — dispatch + user_id scoping', () => {
  it('create_service → serviceRepo.create with user_id', async () => {
    await run('create_service', { service_name: 'Intro', duration_minutes: 30, price: 100 });
    expect(serviceRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'u1', service_name: 'Intro', duration_minutes: 30, price: 100 })
    );
  });

  it('list_services → listAll(userId, activeOnly)', async () => {
    await run('list_services', { active_only: true });
    expect(serviceRepo.listAll).toHaveBeenCalledWith('u1', true);
  });

  it('create_booking → bookingRepo.create with user_id and a resolved contact_id', async () => {
    // Was: asserted `client_email` reached the booking row. That column no longer exists
    // (20260810_remove_client_fields_and_total_amount.sql); the client is carried by
    // contact_id into crm_contacts. Updated during the merge - see F4 / D14.
    crmContactRepo.findByEmail.mockResolvedValueOnce({ data: { id: 'c1' }, error: null });
    await run('create_booking', {
      service_id: 's1', client_first_name: 'Ada', client_email: 'ada@x.com',
      start_time: '2026-08-10T10:00:00Z', end_time: '2026-08-10T10:30:00Z',
    });
    expect(bookingRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'u1', service_id: 's1', contact_id: 'c1' })
    );
    expect(bookingRepo.create.mock.calls[0][0]).not.toHaveProperty('client_email');
  });

  it('count_bookings → countBookings(service_id, userId) (M2 user-scoped)', async () => {
    serviceRepo.countBookings.mockResolvedValueOnce(ok(3));
    const res = await run('count_bookings', { service_id: 's1' });
    expect(serviceRepo.countBookings).toHaveBeenCalledWith('s1', 'u1');
    expect(res).toBe(3);
  });

  it('cancel_booking → cancel(id, userId, reason)', async () => {
    await run('cancel_booking', { id: 'b1', reason: 'client asked' });
    expect(bookingRepo.cancel).toHaveBeenCalledWith('b1', 'u1', 'client asked');
  });
});

describe('SchedulingPluginExecutor — T1/T2 delegate-only guardrail', () => {
  // The guardrail narrowed during the merge (F4 / D14). It used to read "no CRM emission at
  // all", because trigger T1 created the contact from the booking's client_* columns. Those
  // columns are gone and T1's fallback with them, so the caller must resolve the contact
  // first -- exactly what app/api/website/booking/create does. What still holds, and is what
  // the guardrail was actually protecting: the executor writes no services and emits no CRM
  // ACTIVITY (T2 owns that).
  it('create_booking reuses an existing contact and writes no service or activity', async () => {
    crmContactRepo.findByEmail.mockResolvedValueOnce({ data: { id: 'c1' }, error: null });
    await run('create_booking', {
      service_id: 's1', client_first_name: 'Ada', client_email: 'ada@x.com',
      start_time: '2026-08-10T10:00:00Z', end_time: '2026-08-10T10:30:00Z',
    });
    expect(bookingRepo.create).toHaveBeenCalledTimes(1);
    expect(serviceRepo.create).not.toHaveBeenCalled();
    expect(crmContactRepo.create).not.toHaveBeenCalled();
  });

  it('create_booking creates the contact when none exists, then books against it', async () => {
    crmContactRepo.findByEmail.mockResolvedValueOnce({ data: null, error: null });
    crmContactRepo.create.mockResolvedValueOnce({ data: { id: 'c2' }, error: null });
    await run('create_booking', {
      service_id: 's1', client_first_name: 'Ada', client_email: 'ada@x.com',
      start_time: '2026-08-10T10:00:00Z', end_time: '2026-08-10T10:30:00Z',
    });
    expect(crmContactRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'u1', email: 'ada@x.com', first_name: 'Ada' })
    );
    expect(bookingRepo.create).toHaveBeenCalledWith(expect.objectContaining({ contact_id: 'c2' }));
  });

  it('create_booking honours an explicit contact_id without a lookup', async () => {
    await run('create_booking', {
      service_id: 's1', contact_id: 'c9', client_first_name: 'Ada', client_email: 'ada@x.com',
      start_time: '2026-08-10T10:00:00Z', end_time: '2026-08-10T10:30:00Z',
    });
    expect(crmContactRepo.findByEmail).not.toHaveBeenCalled();
    expect(bookingRepo.create).toHaveBeenCalledWith(expect.objectContaining({ contact_id: 'c9' }));
  });
});

describe('SchedulingPluginExecutor — reschedule_booking', () => {
  const booking = { id: 'b1', start_time: '2026-08-10T10:00:00Z', end_time: '2026-08-10T10:30:00Z' };

  it('reschedules when free and within availability (no config)', async () => {
    bookingRepo.findById.mockResolvedValueOnce(ok(booking));
    await run('reschedule_booking', { id: 'b1', new_start_time: '2026-08-11T09:00:00Z' });
    expect(bookingRepo.update).toHaveBeenCalledWith('b1', 'u1', expect.objectContaining({ start_time: expect.any(String), end_time: expect.any(String) }));
  });

  it('throws conflict when the new time overlaps', async () => {
    bookingRepo.findById.mockResolvedValueOnce(ok(booking));
    bookingRepo.checkOverlap.mockResolvedValueOnce(ok([{ id: 'other' }]));
    await expect(run('reschedule_booking', { id: 'b1', new_start_time: '2026-08-11T09:00:00Z' })).rejects.toThrow(/conflict/);
    expect(bookingRepo.update).not.toHaveBeenCalled();
  });

  it('throws unavailable when outside configured availability', async () => {
    bookingRepo.findById.mockResolvedValueOnce(ok(booking));
    businessProfileRepo.findByUserId.mockResolvedValueOnce(ok({ scheduling_availability: {} })); // config present, no slots for any day
    await expect(run('reschedule_booking', { id: 'b1', new_start_time: '2026-08-11T09:00:00Z' })).rejects.toThrow(/unavailable/);
    expect(bookingRepo.update).not.toHaveBeenCalled();
  });
});

describe('SchedulingPluginExecutor — check_availability', () => {
  it('available when free and no availability config', async () => {
    const res = await run('check_availability', { start_time: '2026-08-11T09:00:00Z', end_time: '2026-08-11T09:30:00Z' });
    expect(res).toEqual({ available: true });
  });

  it('not available (with conflicts) when overlapping', async () => {
    bookingRepo.checkOverlap.mockResolvedValueOnce(ok([{ start_time: 'x', end_time: 'y', client_first_name: 'Bo', client_last_name: null }]));
    const res = await run('check_availability', { start_time: '2026-08-11T09:00:00Z', end_time: '2026-08-11T09:30:00Z' });
    expect(res.available).toBe(false);
    expect(res.conflicts).toHaveLength(1);
  });
});

describe('SchedulingPluginExecutor — guards', () => {
  it('throws when connection has no user_id', async () => {
    await expect(run('list_services', {}, {})).rejects.toThrow(/access_denied/);
  });
  it('rejects unknown actions', async () => {
    await expect(run('frobnicate', {})).rejects.toThrow(/not supported/);
  });
  it('propagates a repository error as a throw', async () => {
    serviceRepo.findById.mockResolvedValueOnce({ data: null, error: new Error('boom') });
    await expect(run('get_service', { id: 's1' })).rejects.toThrow('boom');
  });
});
