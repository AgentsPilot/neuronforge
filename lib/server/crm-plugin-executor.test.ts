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

/*
 * The one function an enquiry must go through, mocked so these tests can say
 * WHAT was asked of it without a database. The point of `capture_enquiry` is
 * that it delegates here rather than re-implementing the row shape, so that is
 * exactly what the tests below assert.
 */
const captureEnquiry = jest.fn();
const captureEnquiryFromEmail = jest.fn();
jest.mock('@/lib/business-os/leads/captureEnquiry', () => ({
  captureEnquiry: (...args: unknown[]) => captureEnquiry(...args),
  captureEnquiryFromEmail: (...args: unknown[]) => captureEnquiryFromEmail(...args),
}));

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

describe('CRMPluginExecutor — capture_enquiry', () => {
  beforeEach(() => {
    captureEnquiry.mockResolvedValue({ contactId: 'c1', isNewContact: true });
  });

  it('files the enquiry through the same function the website form calls', async () => {
    /*
     * Not `crmContactRepository.create`. An enquiry is three decisions — the
     * owner's first pipeline stage, find-or-create by address, and which of
     * first/last_website_message is written — and a second implementation of
     * them is how the mailbox channel would drift away from the form.
     */
    await run('capture_enquiry', { email: 'sarah@x.com', message: 'Can I book?' });

    expect(captureEnquiry).toHaveBeenCalledTimes(1);
    expect(contactRepo.create).not.toHaveBeenCalled();
  });

  it('takes the business from the connection and never from the caller', async () => {
    /* The enquirer is named by the caller; the business never is. A parameter
       claiming another owner must not reach the write. */
    await run(
      'capture_enquiry',
      { email: 'sarah@x.com', message: 'Hello', ownerId: 'someone-else', user_id: 'someone-else' },
      { user_id: 'u1' }
    );

    expect(captureEnquiry.mock.calls[0][0]).toMatchObject({ ownerId: 'u1' });
  });

  it('leaves source and activity_key unset when the caller does not send them', async () => {
    /*
     * So the defaults in `captureEnquiry` apply — `website_form`, which is what
     * puts the contact inside FORM_SOURCES and therefore in front of the chase.
     * Passing `undefined` explicitly would defeat a `= 'website_form'` default.
     */
    await run('capture_enquiry', { email: 'sarah@x.com', message: 'Hello' });

    const input = captureEnquiry.mock.calls[0][0];
    expect('source' in input).toBe(false);
    expect('activityKey' in input).toBe(false);
  });

  it('passes a caller-supplied source and activity key through', async () => {
    await run('capture_enquiry', {
      email: 'sarah@x.com',
      message: 'Hello',
      source: 'conversion_page',
      activity_key: 'mailbox_enquiry',
    });

    expect(captureEnquiry.mock.calls[0][0]).toMatchObject({
      source: 'conversion_page',
      activityKey: 'mailbox_enquiry',
    });
  });

  it('returns the contact and whether they were already known', async () => {
    captureEnquiry.mockResolvedValue({ contactId: 'c9', isNewContact: false });

    const result = await run('capture_enquiry', { email: 'sarah@x.com', message: 'Again' });

    expect(result).toEqual({ contact_id: 'c9', is_new_contact: false });
  });

  it('hands a raw email to the reader rather than demanding parsed fields', async () => {
    /*
     * The mailbox agent has a message, not fields. The executor's job is to
     * route that to the reader with the business resolved server-side; whether
     * the reading is correct is `enquiryTemplate`'s own test.
     */
    captureEnquiryFromEmail.mockResolvedValue({ filed: true, contactId: 'c1', isNewContact: true });

    const result = await run('capture_enquiry', {
      subject: 'New inquiry from your website',
      raw_body: 'Name: Sarah Cohen\nEmail: sarah@example.com\nMessage: Hello.',
      template: { subjectPrefix: 'New inquiry', labels: ['Name', 'Email', 'Message'] },
      activity_key: 'mailbox_enquiry',
    });

    expect(captureEnquiry).not.toHaveBeenCalled();
    expect(captureEnquiryFromEmail.mock.calls[0][0]).toMatchObject({
      ownerId: 'u1',
      subject: 'New inquiry from your website',
      activityKey: 'mailbox_enquiry',
    });
    expect(result).toMatchObject({ filed: true, contact_id: 'c1', is_new_contact: true });
  });

  it('reports "nothing filed" instead of throwing, so the agent can leave it unread', async () => {
    /*
     * A message we cannot read is not a fault. A throw would look like one,
     * and a silent success would lose the enquiry — the agent needs to know
     * precisely so it does NOT mark that message as read.
     */
    captureEnquiryFromEmail.mockResolvedValue({ filed: false, reason: 'no_address' });

    const result = await run('capture_enquiry', { subject: 'Out of office', raw_body: 'Away until Monday.' });

    expect(result).toEqual({ filed: false, reason: 'no_address' });
  });

  it('takes the raw path on html alone, since some forms send only that', async () => {
    captureEnquiryFromEmail.mockResolvedValue({ filed: true, contactId: 'c2', isNewContact: false });

    await run('capture_enquiry', { raw_html: '<table><tr><td>Email:</td><td>a@x.com</td></tr></table>' });

    expect(captureEnquiryFromEmail).toHaveBeenCalledTimes(1);
    expect(captureEnquiry).not.toHaveBeenCalled();
  });

  it('refuses without an address or a message', async () => {
    /* Without the address the enquirer cannot be found or answered, and an
       enquiry with no message is not one. */
    await expect(run('capture_enquiry', { message: 'Hello' })).rejects.toThrow();
    await expect(run('capture_enquiry', { email: 'sarah@x.com' })).rejects.toThrow();
    expect(captureEnquiry).not.toHaveBeenCalled();
  });
});

describe('CRMPluginExecutor — no-double-logging guardrail', () => {
  // Was "trigger T8 owns contact_created". The trigger is not live; the
  // repository owns it now, for every creation path. The assertion is the same
  // either way: the executor must not write it a second time.
  it('create_contact does NOT write an activity (the repository owns contact_created)', async () => {
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
