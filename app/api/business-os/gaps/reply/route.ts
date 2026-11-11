/**
 * Answer a waiting client from the dashboard, without opening the mailbox.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS CLOSES
 *
 * The "needs you" card could describe a waiting message in full — who, what
 * they asked, what the agent made of it — and then had exactly one move:
 * "open the client". The owner left for Gmail, found the thread, and answered
 * there. Everything the card knew was thrown away at the door.
 *
 * Three answers reach here, and they are genuinely different acts:
 *
 *   send     put a reply in the client's inbox, inside their own thread
 *   discard  throw away the agent's draft; answer nothing
 *   handled  this is dealt with; take it off the card
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT REPLIES TO A THREAD, NOT TO A MESSAGE, AND THAT IS DELIBERATE
 *
 * The activity stores `source_thread_id`. Between the agent filing the card and
 * the owner pressing send, the client may have written twice more — and
 * answering the message the agent happened to scan would thread the reply under
 * a stale message and read, to them, as a non-sequitur. `reply_to_email` takes
 * `thread_id` and resolves the newest message itself.
 *
 * THE DRAFT IS DELETED WHEN A REPLY GOES. Without that the agent's draft stays
 * in the mailbox looking unsent, and a fortnight later somebody sends the same
 * answer a second time.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SENDING DOES NOT CLEAR THE ROW
 *
 * Only `handled` writes `reply_handled`, which is the row
 * `client_reply_waiting` excludes on. A reply frequently opens the next
 * question, and the card is the only thing holding the thread in front of the
 * owner — clearing it on their behalf puts the conversation back in the
 * mailbox they had just been given a reason not to open. They say when it is
 * done. See the block around that write for the full reasoning.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { PluginExecuterV2 } from '@/lib/server/plugin-executer-v2';
import { CRMActivityRepository } from '@/lib/repositories/CRMActivityRepository';
import { supabaseServer } from '@/lib/supabaseServer';
import { renderHtml, renderText, isEmpty as blocksAreEmpty } from '@/lib/business-os/mail/replyBody';

const logger = createLogger({ module: 'GapReplyAPI' });
const auditTrail = AuditTrailService.getInstance();

/**
 * Long enough for a real answer, short enough that a runaway paste cannot be
 * mailed to a client. The agent's own drafts are three sentences.
 */
const MOST_A_REPLY_SHOULD_BE = 10_000;

const replySchema = z
  .object({
    action: z.enum(['send', 'discard', 'handled']),
    contactId: z.string().uuid(),
    /** The conversation to answer. Required for a send; absent on old rows. */
    threadId: z.string().min(1).max(256).optional(),
    /** The draft to remove, where the agent created one. */
    draftId: z.string().min(1).max(256).optional(),
    /** What to say, as plain text. The fallback when no blocks are sent. */
    body: z.string().trim().min(1).max(MOST_A_REPLY_SHOULD_BE).optional(),
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE FORMATTED REPLY, AS STRUCTURE RATHER THAN MARKUP.
     *
     * The editor could post HTML and have this route sanitise it, which would
     * mean running a parser over attacker-shaped input and trusting the result
     * on a path that ends in a client's inbox. Instead it posts paragraphs and
     * list items made of text runs, and `renderHtml` writes the markup here —
     * so every tag in the outgoing mail was written by us and every character
     * the owner typed is escaped.
     *
     * Bounded on both axes. A reply is a few paragraphs; the limits exist so a
     * malformed or hostile post cannot turn into an unbounded render.
     * ─────────────────────────────────────────────────────────────────────────
     */
    blocks: z
      .array(
        z.object({
          type: z.enum(['p', 'li']),
          list: z.enum(['ul', 'ol']).optional(),
          runs: z
            .array(
              z.object({
                text: z.string().max(MOST_A_REPLY_SHOULD_BE),
                bold: z.boolean().optional(),
                italic: z.boolean().optional(),
                /* Validated again by `safeHref` at render: this only bounds
                   the size, it does not decide what is a safe address. */
                href: z.string().max(2048).optional(),
              })
            )
            .max(200),
        })
      )
      .max(100)
      .optional(),
    /** Shown on the client's timeline so the row says what it was about. */
    subject: z.string().max(500).optional(),
    /** Which mailbox answered. Only Gmail can reply today; see below. */
    provider: z.enum(['google-mail', 'outlook']).default('google-mail'),
  })
  .refine(
    data =>
      data.action !== 'send' ||
      (!!data.threadId && (!!data.body || (data.blocks?.length ?? 0) > 0)),
    {
      message: 'A reply needs both a thread to answer and something to say',
      path: ['body'],
    }
  );

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const validated = replySchema.parse(await request.json());
    const { action, contactId, threadId, draftId, body, blocks, subject, provider } = validated;

    /*
     * OUTLOOK CANNOT REPLY FROM HERE YET, and it says so rather than failing
     * obscurely. Its plugin has `create_draft` and no reply action at all —
     * see the note on step10 in `draftClientReplies.steps.json`. Marking
     * handled and discarding are provider-agnostic and work for both.
     */
    if (action === 'send' && provider !== 'google-mail') {
      requestLogger.warn({ userId: user.id, provider }, 'Reply from the card attempted on a provider that cannot send');
      return NextResponse.json(
        { success: false, error: 'This mailbox cannot send a reply from here yet', code: 'provider_cannot_reply' },
        { status: 400 }
      );
    }

    requestLogger.info({ userId: user.id, action, contactId, hasDraft: !!draftId }, 'Gap reply request received');

    const executer = await PluginExecuterV2.getInstance();
    let sentMessageId: string | undefined;

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * BOTH HALVES, BUILT HERE, FROM THE SAME SOURCE.
     *
     * A formatted reply goes out as HTML with a plain-text twin, because a mail
     * client picks one and the two must say the same thing. Both come from the
     * same blocks, so they cannot drift.
     *
     * `body` remains the whole story when no blocks were sent — an older
     * client, or a caller that only has plain text. Then there is no HTML half
     * and the reply is plain, exactly as it was before the editor existed.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const formatted = blocks && blocks.length > 0 ? blocks : null;
    const plain = formatted ? renderText(formatted) : (body as string);
    const html = formatted ? renderHtml(formatted) : undefined;

    if (action === 'send' && formatted && blocksAreEmpty(formatted)) {
      return NextResponse.json(
        { success: false, error: 'There is nothing to send' },
        { status: 400 }
      );
    }

    if (action === 'send') {
      const sent = await executer.execute(user.id, provider, 'reply_to_email', {
        thread_id: threadId,
        content: { body: plain, ...(html ? { html_body: html } : {}) },
      });
      sentMessageId = (sent as { message_id?: string })?.message_id;
      requestLogger.info({ userId: user.id, contactId, sentMessageId }, 'Reply sent into the client thread');
    }

    /*
     * Remove the agent's draft once the answer has gone, or because the owner
     * threw it away. Non-blocking on a send: the client already has the reply,
     * and failing the request over a leftover draft would tell the owner their
     * answer did not go when it did. `delete_draft` treats an absent draft as
     * success.
     */
    if (draftId && (action === 'send' || action === 'discard')) {
      await executer
        .execute(user.id, provider, 'delete_draft', { draft_id: draftId })
        .catch(err => requestLogger.warn({ err, draftId }, 'Draft delete failed (non-blocking)'));
    }

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * SENDING DOES NOT CLEAR THE ROW. ONLY THE OWNER DOES.
     *
     * The first version settled the card the moment a reply went, on the
     * reasoning that an answered client is a finished task. That is the
     * platform deciding a conversation is over on the owner's behalf, and it
     * is frequently wrong: a reply often opens the next question, and the row
     * is the only thing holding the thread in front of them. Clearing it put
     * the thread back into a mailbox they had just been given a reason not to
     * open.
     *
     * So `send` sends and stops. `discard` throws the draft away and stops.
     * `handled` is the only action that writes `reply_handled`, and it exists
     * for exactly this — the owner saying the thread is done.
     *
     * The agent can still settle a thread by itself on a later run, when it
     * reads the mailbox and concludes the client was answered. That is a
     * different claim with evidence behind it, and it writes the same row
     * through the same vocabulary.
     * ─────────────────────────────────────────────────────────────────────────
     */
    let settled = false;

    /*
     * The client is INJECTED; this repository has no default and constructing
     * it bare leaves `this.supabase` undefined. The repo then catches its own
     * throw and returns an error, so the route can answer 200 having written
     * nothing. Measured on 2026-11-10: a reply reached a real client and the
     * card went on asking for an answer that had already been given.
     */
    const activities = new CRMActivityRepository(supabaseServer);

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * A SENT REPLY LEAVES A RECORD, EVEN THOUGH IT DOES NOT CLEAR THE ROW.
     *
     * These are two separate decisions and the first version conflated them.
     * Sending deliberately does not settle the card — a reply often opens the
     * next question, and the owner says when a thread is done. But writing
     * NOTHING meant the only evidence a reply had gone was a word in the
     * browser's memory: on reload the row rendered exactly as before, empty
     * box and all, with no sign the client had already been answered.
     *
     * That is how somebody answers the same person twice, and it is worse than
     * either of the designs it fell between.
     *
     * `reply_sent` rather than `reply_handled`: the gap excludes on the latter,
     * so using it here would clear the row and undo the decision above. This
     * one records the fact and changes nothing about whose move it is.
     * ─────────────────────────────────────────────────────────────────────────
     */
    if (action === 'send') {
      const { error: traceError } = await activities.create({
        user_id: user.id,
        contact_id: contactId,
        activity_type: 'reply_sent',
        title: subject || 'Reply sent',
        /* The plain half: a timeline entry is read, not rendered. */
        description: plain.slice(0, 2000),
        auto_logged: false,
        source_capability: 'needs_you_card',
        ...(threadId ? { source_thread_id: threadId } : {}),
      } as Parameters<CRMActivityRepository['create']>[0]);

      if (traceError) {
        /*
         * NOT fatal, and not rolled back. The mail has left; telling the owner
         * their answer failed would be a lie about the only part the client
         * can see. What is lost is the card's memory of it, which is why this
         * is logged at error rather than swallowed.
         */
        requestLogger.error(
          { err: traceError, userId: user.id, contactId },
          'Reply sent but not recorded; the card will not show that it was answered'
        );
      }
    }

    if (action === 'handled') {
      const { error: logError } = await activities.create({
        user_id: user.id,
        contact_id: contactId,
        activity_type: 'reply_handled',
        title: subject || 'Reply handled',
        description: 'Marked handled by the owner.',
        auto_logged: false,
        source_capability: 'needs_you_card',
        ...(threadId ? { source_thread_id: threadId } : {}),
      } as Parameters<CRMActivityRepository['create']>[0]);

      if (logError) {
        requestLogger.error(
          { err: logError, userId: user.id, contactId },
          'Could not settle the row; the card will not clear'
        );
        return NextResponse.json(
          { success: false, error: 'Could not clear this from your list' },
          { status: 500 }
        );
      }
      settled = true;
    }

    auditTrail
      .log({
        action: action === 'send' ? 'CLIENT_REPLY_SENT' : 'CLIENT_REPLY_CLOSED',
        entityType: 'crm_contact',
        entityId: contactId,
        userId: user.id,
        request,
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    return NextResponse.json({
      success: true,
      data: { action, sentMessageId, settled },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.flatten() },
        { status: 400 }
      );
    }
    requestLogger.error({ err: error }, 'Gap reply request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Could not send the reply',
        details:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : String(error)
            : undefined,
      },
      { status: 500 }
    );
  }
}
