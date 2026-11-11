/**
 * The route that answers a client from the dashboard.
 *
 * What is pinned here is the handful of behaviours that are expensive to get
 * wrong, because each one is either mail reaching a client or a card that will
 * not clear:
 *
 *   · a send replies to the THREAD, never to a stored message id
 *   · the agent's draft is deleted once a reply has gone
 *   · a failed draft delete does not fail a request whose mail already left
 *   · ONLY "handled" settles the row; sending deliberately does not
 *   · the activity repository is constructed WITH a client
 *   · a provider that cannot reply is refused before anything is sent
 */

import { NextRequest } from 'next/server';
import { POST } from '../route';

const execute = jest.fn();
const createActivity = jest.fn();

jest.mock('@/lib/auth', () => ({ getUser: jest.fn() }));
jest.mock('@/lib/server/plugin-executer-v2', () => ({
  PluginExecuterV2: { getInstance: jest.fn(async () => ({ execute })) },
}));
jest.mock('@/lib/repositories/CRMActivityRepository', () => ({
  CRMActivityRepository: jest.fn(() => ({ create: createActivity })),
}));
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: { getInstance: () => ({ log: jest.fn(() => Promise.resolve()) }) },
}));

import { getUser } from '@/lib/auth';
import { CRMActivityRepository } from '@/lib/repositories/CRMActivityRepository';

const CONTACT = '11111111-2222-3333-4444-555555555555';

function post(body: unknown) {
  return new NextRequest('http://localhost/api/business-os/gaps/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (getUser as jest.Mock).mockResolvedValue({ id: 'user-1' });
  execute.mockResolvedValue({ message_id: 'sent-1' });
  createActivity.mockResolvedValue({ data: { id: 'act-1' }, error: null });
});

describe('POST /api/business-os/gaps/reply', () => {
  it('replies to the thread, not to a message', async () => {
    const response = await POST(
      post({ action: 'send', contactId: CONTACT, threadId: 'thread-9', body: 'On my way.' })
    );
    expect(response.status).toBe(200);

    const [, , action, params] = execute.mock.calls.find(c => c[2] === 'reply_to_email')!;
    expect(action).toBe('reply_to_email');
    /*
     * The thread is the unit, because the client may have written again
     * between the agent filing the card and the owner pressing send.
     */
    expect(params).toMatchObject({ thread_id: 'thread-9', content: { body: 'On my way.' } });
    expect(params.message_id).toBeUndefined();
  });

  it('deletes the draft once the reply has gone', async () => {
    await POST(
      post({
        action: 'send',
        contactId: CONTACT,
        threadId: 'thread-9',
        draftId: 'draft-7',
        body: 'Thanks, see you then.',
      })
    );
    expect(execute).toHaveBeenCalledWith('user-1', 'google-mail', 'delete_draft', {
      draft_id: 'draft-7',
    });
  });

  it('still succeeds when the draft delete fails, because the mail has left', async () => {
    execute.mockImplementation(async (_u, _p, action) => {
      if (action === 'delete_draft') throw new Error('Gmail said no');
      return { message_id: 'sent-1' };
    });

    const response = await POST(
      post({ action: 'send', contactId: CONTACT, threadId: 't', draftId: 'd', body: 'Hello' })
    );
    expect(response.status).toBe(200);
    expect((await response.json()).success).toBe(true);
  });

  it('settles the card ONLY when the owner says it is handled', async () => {
    await POST(post({ action: 'handled', contactId: CONTACT }));
    expect(execute).not.toHaveBeenCalled();
    expect(createActivity).toHaveBeenCalledWith(
      expect.objectContaining({ activity_type: 'reply_handled', contact_id: CONTACT })
    );
  });

  it('does NOT settle the card when a reply is sent', async () => {
    /*
     * A reply frequently opens the next question, and this row is the only
     * thing holding the thread in front of the owner. Clearing it on their
     * behalf puts the conversation back into the mailbox they were just given
     * a reason not to open.
     */
    const response = await POST(
      post({ action: 'send', contactId: CONTACT, threadId: 't', body: 'On my way.' })
    );
    expect((await response.json()).data.settled).toBe(false);

    /*
     * It records `reply_sent` and NOT `reply_handled`. The gap excludes on the
     * latter, so writing it here would clear the row and undo the decision
     * above — while writing nothing at all left the card with no sign the
     * client had been answered, which is how the same person gets two replies.
     */
    const types = createActivity.mock.calls.map(c => c[0].activity_type);
    expect(types).toContain('reply_sent');
    expect(types).not.toContain('reply_handled');
  });

  it('records what was actually said, so the row can show it was answered', async () => {
    await POST(
      post({ action: 'send', contactId: CONTACT, threadId: 'thread-9', body: 'See you Tuesday.' })
    );
    expect(createActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        activity_type: 'reply_sent',
        description: 'See you Tuesday.',
        source_thread_id: 'thread-9',
      })
    );
  });

  it('does not fail a send whose reply went but whose record did not', async () => {
    /* The mail has left; telling the owner it failed would be a lie about the
       only part the client can see. */
    createActivity.mockResolvedValue({ data: null, error: new Error('db down') });
    const response = await POST(
      post({ action: 'send', contactId: CONTACT, threadId: 't', body: 'Hello' })
    );
    expect(response.status).toBe(200);
  });

  it('does not settle the card when a draft is discarded', async () => {
    await POST(post({ action: 'discard', contactId: CONTACT, draftId: 'd' }));
    expect(createActivity).not.toHaveBeenCalled();
  });

  it('constructs the activity repository WITH a client', async () => {
    /*
     * This repository takes an injected client and has no default. Built bare,
     * `this.supabase` is undefined, the repo catches its own throw and returns
     * an error — so the route answered 200 having settled nothing. A reply
     * reached a real client on 2026-11-10 and the card went on asking for an
     * answer that had already been given.
     *
     * The mock makes the constructor succeed either way, so the argument is
     * what has to be asserted.
     */
    await POST(post({ action: 'handled', contactId: CONTACT }));
    expect(CRMActivityRepository).toHaveBeenCalledWith(expect.anything());
    expect((CRMActivityRepository as unknown as jest.Mock).mock.calls[0][0]).toBeDefined();
  });

  it('reports a failure to clear rather than claiming success', async () => {
    createActivity.mockResolvedValue({ data: null, error: new Error('no') });
    const response = await POST(post({ action: 'handled', contactId: CONTACT }));
    expect(response.status).toBe(500);
  });

  it('refuses to send from a mailbox that cannot reply, before sending anything', async () => {
    const response = await POST(
      post({ action: 'send', contactId: CONTACT, threadId: 't', body: 'Hi', provider: 'outlook' })
    );
    expect(response.status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects a send with nothing to say', async () => {
    const response = await POST(post({ action: 'send', contactId: CONTACT, threadId: 't' }));
    expect(response.status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it('401s when signed out', async () => {
    (getUser as jest.Mock).mockResolvedValue(null);
    const response = await POST(post({ action: 'handled', contactId: CONTACT }));
    expect(response.status).toBe(401);
    expect(createActivity).not.toHaveBeenCalled();
  });
});
