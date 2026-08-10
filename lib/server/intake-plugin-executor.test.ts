// lib/server/intake-plugin-executor.test.ts
//
// Fast, pure unit tests for the Intake plugin executor. Repositories are mocked (no DB).
// Focus: dispatch, missing user_id, the M1 settings-patch allow-list (a caller-supplied
// params.user_id is ignored — upsertSettings receives the authenticated userId and a patch
// WITHOUT the injected field), template-existence rejection on update_intake_settings,
// get_intake_settings defaults synthesis, list_intake_templates vertical resolution from the
// business profile (not params), and param guards.
//
// DB-backed behaviour (real upsert round-trip, defaults persistence) is QA-manual — see the
// workplan lean-test policy.

const intakeRepo = {
  listTemplatesByVertical: jest.fn(),
  getTemplateById: jest.fn(),
  getSettingsWithTemplate: jest.fn(),
  upsertSettings: jest.fn(),
};
const businessProfileRepo = { findByUserId: jest.fn() };

jest.mock('@/lib/repositories/IntakeRepository', () => ({
  intakeRepository: intakeRepo,
}));
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: businessProfileRepo,
}));

import { IntakePluginExecutor } from './intake-plugin-executor';

function run(action: string, params: any, connection: any = { user_id: 'u1' }) {
  const executor = new IntakePluginExecutor({} as any, {} as any);
  return (executor as any).executeSpecificAction(connection, action, params);
}

const ok = (data: any) => ({ data, error: null });

beforeEach(() => {
  jest.clearAllMocks();
  // Sensible defaults so happy-path delegation succeeds.
  intakeRepo.listTemplatesByVertical.mockResolvedValue(ok([]));
  intakeRepo.getTemplateById.mockResolvedValue(ok({ id: 't1' }));
  intakeRepo.getSettingsWithTemplate.mockResolvedValue(ok({ id: 's1', is_enabled: true }));
  intakeRepo.upsertSettings.mockResolvedValue(ok({ id: 's1' }));
  businessProfileRepo.findByUserId.mockResolvedValue(ok({ vertical: 'therapy' }));
});

describe('IntakePluginExecutor — dispatch', () => {
  it('list_intake_templates → resolves vertical from business profile and lists it', async () => {
    intakeRepo.listTemplatesByVertical
      .mockResolvedValueOnce(ok([{ id: 'v1' }])) // therapy
      .mockResolvedValueOnce(ok([{ id: 'o1' }])); // other
    const res = await run('list_intake_templates', {});
    expect(businessProfileRepo.findByUserId).toHaveBeenCalledWith('u1');
    expect(intakeRepo.listTemplatesByVertical).toHaveBeenCalledWith('therapy');
    expect(intakeRepo.listTemplatesByVertical).toHaveBeenCalledWith('other');
    expect(res.vertical).toBe('therapy');
    expect(res.templates).toEqual([{ id: 'v1' }, { id: 'o1' }]);
  });

  it("list_intake_templates → uses vertical from profile, NOT from params", async () => {
    await run('list_intake_templates', { vertical: 'ATTACKER_VERTICAL' });
    expect(intakeRepo.listTemplatesByVertical).toHaveBeenCalledWith('therapy');
    expect(intakeRepo.listTemplatesByVertical).not.toHaveBeenCalledWith('ATTACKER_VERTICAL');
  });

  it("list_intake_templates → falls back to 'other' when no profile (no double 'other' fetch)", async () => {
    businessProfileRepo.findByUserId.mockResolvedValueOnce(ok(null));
    intakeRepo.listTemplatesByVertical.mockResolvedValueOnce(ok([{ id: 'o1' }]));
    const res = await run('list_intake_templates', {});
    expect(intakeRepo.listTemplatesByVertical).toHaveBeenCalledTimes(1);
    expect(intakeRepo.listTemplatesByVertical).toHaveBeenCalledWith('other');
    expect(res.vertical).toBe('other');
  });

  it('get_intake_template → getTemplateById(id) and returns the template', async () => {
    intakeRepo.getTemplateById.mockResolvedValueOnce(ok({ id: 't7', template_key: 'k' }));
    const res = await run('get_intake_template', { id: 't7' });
    expect(intakeRepo.getTemplateById).toHaveBeenCalledWith('t7');
    expect(res).toEqual({ id: 't7', template_key: 'k' });
  });

  it('get_intake_template → throws not_found when template is null (PGRST116)', async () => {
    intakeRepo.getTemplateById.mockResolvedValueOnce(ok(null));
    await expect(run('get_intake_template', { id: 'missing' })).rejects.toThrow(/not_found/);
  });

  it('get_intake_settings → returns the settings row when present', async () => {
    intakeRepo.getSettingsWithTemplate.mockResolvedValueOnce(ok({ id: 's1', is_enabled: true }));
    const res = await run('get_intake_settings', {});
    expect(intakeRepo.getSettingsWithTemplate).toHaveBeenCalledWith('u1');
    expect(res).toEqual({ id: 's1', is_enabled: true });
  });

  it('get_intake_settings → synthesizes disabled defaults when no row exists', async () => {
    intakeRepo.getSettingsWithTemplate.mockResolvedValueOnce(ok(null));
    const res = await run('get_intake_settings', {});
    expect(res).toEqual({
      is_enabled: false,
      template_id: null,
      template: null,
      collect_during_booking: true,
      send_after_booking: false,
    });
  });
});

describe('IntakePluginExecutor — update_intake_settings (M1 allow-list)', () => {
  it('M1: a params.user_id is IGNORED — upsertSettings gets the authenticated userId and a patch WITHOUT user_id', async () => {
    await run('update_intake_settings', {
      user_id: 'ATTACKER',
      id: 'ignored',
      is_enabled: true,
      collect_during_booking: false,
      send_after_booking: true,
    });
    expect(intakeRepo.upsertSettings).toHaveBeenCalledTimes(1);
    const [passedUserId, patch] = intakeRepo.upsertSettings.mock.calls[0];
    expect(passedUserId).toBe('u1');
    expect(patch).toEqual({
      is_enabled: true,
      collect_during_booking: false,
      send_after_booking: true,
    });
    expect(patch).not.toHaveProperty('user_id');
    expect(patch).not.toHaveProperty('id');
  });

  it('validates template_id exists before upserting', async () => {
    intakeRepo.getTemplateById.mockResolvedValueOnce(ok({ id: 't1' }));
    await run('update_intake_settings', { template_id: 't1', is_enabled: true });
    expect(intakeRepo.getTemplateById).toHaveBeenCalledWith('t1');
    expect(intakeRepo.upsertSettings).toHaveBeenCalledWith('u1', expect.objectContaining({ template_id: 't1' }));
  });

  it('rejects a non-existent template_id (!template) BEFORE upserting', async () => {
    intakeRepo.getTemplateById.mockResolvedValueOnce(ok(null));
    await expect(
      run('update_intake_settings', { template_id: 'missing', is_enabled: true })
    ).rejects.toThrow(/not_found/);
    expect(intakeRepo.upsertSettings).not.toHaveBeenCalled();
  });

  it('does not look up a template when template_id is absent', async () => {
    await run('update_intake_settings', { is_enabled: false });
    expect(intakeRepo.getTemplateById).not.toHaveBeenCalled();
    expect(intakeRepo.upsertSettings).toHaveBeenCalledWith('u1', { is_enabled: false });
  });
});

describe('IntakePluginExecutor — guards', () => {
  it('throws when connection has no user_id', async () => {
    await expect(run('list_intake_templates', {}, {})).rejects.toThrow(/access_denied/);
  });

  it('rejects unknown actions', async () => {
    await expect(run('frobnicate', {})).rejects.toThrow(/not supported/);
  });

  it('requires id on get_intake_template', async () => {
    await expect(run('get_intake_template', {})).rejects.toThrow(/id/);
    expect(intakeRepo.getTemplateById).not.toHaveBeenCalled();
  });

  it('propagates a repository error as a throw', async () => {
    intakeRepo.getSettingsWithTemplate.mockResolvedValueOnce({ data: null, error: new Error('boom') });
    await expect(run('get_intake_settings', {})).rejects.toThrow('boom');
  });
});
