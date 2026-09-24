/*
 * "Publish this service" from the assistant has to actually publish it.
 *
 * The `publish` capability declared `{ is_active: true, status: 'active' }`,
 * but the executor forwarded a fixed field list that did not include `status`,
 * so the flag was dropped in transit. A service is bookable only when
 * `is_active` AND `status = 'active'` (`SchedulingServiceRepository.BOOKABLE`),
 * so the action returned success and left the service on `draft`: the owner was
 * told their service was live while no client could see it.
 *
 * `activate` had the same hole from the other side — `is_active: true` alone
 * leaves a paused service on `inactive`, which is equally unbookable.
 *
 * Which path is correct depends on where the service is, and the two are not
 * interchangeable: `publish()` carries the draft guard, and it deliberately
 * refuses to un-pause an inactive service.
 */

const mockPublish = jest.fn();
const mockUpdate = jest.fn();
const mockFindById = jest.fn();

jest.mock('@/lib/repositories/SchedulingRepository', () => ({
  schedulingServiceRepository: {
    publish: (...a: unknown[]) => mockPublish(...a),
    update: (...a: unknown[]) => mockUpdate(...a),
    findById: (...a: unknown[]) => mockFindById(...a),
    create: jest.fn(),
    delete: jest.fn(),
  },
  schedulingBookingRepository: {},
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
  }),
}));

import { SafeExecutionLayer } from '@/lib/business-os/ai-data-layer/SafeExecutionLayer';

const USER = 'user-1';
const SERVICE = 'service-1';

/** `mutateService` is private; this is the seam the capability reaches it by. */
const mutateService = (
  layer: SafeExecutionLayer,
  operation: string,
  payload: Record<string, unknown> | undefined,
  id?: string
) => (layer as unknown as {
  mutateService: (o: string, p: Record<string, unknown> | undefined, i?: string) => Promise<{ success: boolean; error?: string }>;
}).mutateService(operation, payload, id);

describe('making a service bookable from the assistant', () => {
  let layer: SafeExecutionLayer;

  beforeEach(() => {
    jest.clearAllMocks();
    layer = new SafeExecutionLayer(USER);
    mockPublish.mockResolvedValue({ data: { id: SERVICE }, error: null });
    mockUpdate.mockResolvedValue({ data: { id: SERVICE }, error: null });
  });

  it('publishes a draft through publish(), not a field write', async () => {
    mockFindById.mockResolvedValue({ data: { id: SERVICE, status: 'draft' }, error: null });

    const result = await mutateService(layer, 'update', { is_active: true, status: 'active' }, SERVICE);

    expect(result.success).toBe(true);
    expect(mockPublish).toHaveBeenCalledWith(SERVICE, USER);
    // The old code called update() and silently dropped `status` — the whole bug.
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('un-pauses an inactive service through update(), which publish() refuses', async () => {
    mockFindById.mockResolvedValue({ data: { id: SERVICE, status: 'inactive' }, error: null });

    const result = await mutateService(layer, 'update', { is_active: true, status: 'active' }, SERVICE);

    expect(result.success).toBe(true);
    expect(mockPublish).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(SERVICE, USER, { is_active: true, status: 'active' });
  });

  it('sets BOTH flags when un-pausing — either alone leaves it unbookable', async () => {
    mockFindById.mockResolvedValue({ data: { id: SERVICE, status: 'inactive' }, error: null });

    await mutateService(layer, 'update', { is_active: true, status: 'active' }, SERVICE);

    expect(mockUpdate.mock.calls[0][2]).toMatchObject({ is_active: true, status: 'active' });
  });

  it('reports the failure instead of claiming success when the service is gone', async () => {
    mockFindById.mockResolvedValue({ data: null, error: null });

    const result = await mutateService(layer, 'update', { is_active: true, status: 'active' }, SERVICE);

    expect(result.success).toBe(false);
    expect(mockPublish).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('forwards only the fields the caller sent', async () => {
    // `deactivate` carries nothing but `is_active`. The old list sent
    // `service_name: undefined` and three more along with it.
    await mutateService(layer, 'update', { is_active: false }, SERVICE);

    expect(mockUpdate).toHaveBeenCalledWith(SERVICE, USER, { is_active: false });
    expect(Object.keys(mockUpdate.mock.calls[0][2])).toEqual(['is_active']);
  });

  it('still passes ordinary field edits straight through', async () => {
    await mutateService(layer, 'update', { price: 300, service_name: 'Intro' }, SERVICE);

    expect(mockPublish).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(SERVICE, USER, { price: 300, service_name: 'Intro' });
  });
});
