// lib/server/crm-plugin-executor.test.ts
//
// Fast, pure unit tests for the CRM plugin executor. The CRM repositories are mocked, so
// there is no DB. Focus: correct dispatch to the repository, user_id scoping from the
// connection, and the T8 no-double-logging GUARDRAIL by construction — mutating a contact
// must never call the activity repository (triggers own those side-effects).

const contactRepo = {
  create: jest.fn(),
  findById: jest.fn(),
  list: jest.fn(),
  count: jest.fn(),
  update: jest.fn(),
  updateStage: jest.fn(),
  delete: jest.fn(),
};
const taskRepo = {
  create: jest.fn(),
  findById: jest.fn(),
  list: jest.fn(),
  countByStatus: jest.fn(),
  update: jest.fn(),
  complete: jest.fn(),
  delete: jest.fn(),
};
const activityRepo = { create: jest.fn(), getForContact: jest.fn() };
const stagesRepo = { list: jest.fn() };

jest.mock('@/lib/repositories/CRMContactRepository', () => ({ crmContactRepository: contactRepo }));
jest.mock('@/lib/repositories/CRMTaskRepository', () => ({ crmTaskRepository: taskRepo }));
jest.mock('@/lib/repositories/CRMActivityRepository', () => ({ crmActivityRepository: activityRepo }));
jest.mock('@/lib/repositories/CRMPipelineStagesRepository', () => ({ crmPipelineStagesRepository: stagesRepo }));

import { CRMPluginExecutor } from './crm-plugin-executor';

// executeSpecificAction is protected — call it directly via a thin cast for unit testing.
function run(action: string, params: any, connection: any = { user_id: 'u1' }) {
  const executor = new CRMPluginExecutor({} as any, {} as any);
  return (executor as any).executeSpecificAction(connection, action, params);
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default every repo method to a success result so dispatch tests don't throw.
  for (const repo of [contactRepo, taskRepo, activityRepo, stagesRepo]) {
    for (const fn of Object.values(repo)) (fn as jest.Mock).mockResolvedValue({ data: {}, error: null });
  }
});

describe('CRMPluginExecutor — dispatch + user_id scoping', () => {
  it('create_contact → crmContactRepository.create with user_id from the connection', async () => {
    await run('create_contact', { first_name: 'Ada', email: 'ada@x.com' });
    expect(contactRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'u1', first_name: 'Ada', email: 'ada@x.com' })
    );
  });

  it('get_contact → findById(id, userId)', async () => {
    await run('get_contact', { id: 'c1' });
    expect(contactRepo.findById).toHaveBeenCalledWith('c1', 'u1');
  });

  it('list_contacts → list(userId, options)', async () => {
    await run('list_contacts', { stage: 'lead', limit: 10 });
    expect(contactRepo.list).toHaveBeenCalledWith('u1', expect.objectContaining({ stage: 'lead', limit: 10 }));
  });

  it('move_stage → updateStage(id, userId, stage)', async () => {
    await run('move_stage', { id: 'c1', stage: 'client' });
    expect(contactRepo.updateStage).toHaveBeenCalledWith('c1', 'u1', 'client');
  });

  it('add_task → crmTaskRepository.create with user_id', async () => {
    await run('add_task', { title: 'Follow up' });
    expect(taskRepo.create).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'u1', title: 'Follow up' }));
  });

  it('complete_task → complete(id, userId)', async () => {
    await run('complete_task', { id: 't1' });
    expect(taskRepo.complete).toHaveBeenCalledWith('t1', 'u1');
  });

  it('list_pipeline_stages → stages.list(userId)', async () => {
    await run('list_pipeline_stages', {});
    expect(stagesRepo.list).toHaveBeenCalledWith('u1');
  });
});

describe('CRMPluginExecutor — T8 no-double-logging guardrail', () => {
  it('create_contact does NOT write an activity (trigger T8 owns contact_created)', async () => {
    await run('create_contact', { first_name: 'Ada' });
    expect(activityRepo.create).not.toHaveBeenCalled();
  });

  it('update_contact and move_stage write no activity', async () => {
    await run('update_contact', { id: 'c1', phone: '123' });
    await run('move_stage', { id: 'c1', stage: 'client' });
    expect(activityRepo.create).not.toHaveBeenCalled();
  });

  it('log_activity is the ONLY op that writes an activity — exactly once', async () => {
    await run('log_activity', { contact_id: 'c1', activity_type: 'note', title: 'Called' });
    expect(activityRepo.create).toHaveBeenCalledTimes(1);
    expect(activityRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'u1', contact_id: 'c1', activity_type: 'note', title: 'Called' })
    );
  });
});

describe('CRMPluginExecutor — guards', () => {
  it('throws when the connection has no user_id (defense-in-depth)', async () => {
    await expect(run('list_contacts', {}, {})).rejects.toThrow(/access_denied/);
    expect(contactRepo.list).not.toHaveBeenCalled();
  });

  it('propagates a repository error result as a throw', async () => {
    contactRepo.findById.mockResolvedValueOnce({ data: null, error: new Error('boom') });
    await expect(run('get_contact', { id: 'c1' })).rejects.toThrow('boom');
  });

  it('rejects unknown actions', async () => {
    await expect(run('frobnicate', {})).rejects.toThrow(/not supported/);
  });
});
