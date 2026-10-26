/**
 * Learn this business's enquiry template from its own mail.
 *
 * The owner has clicked one message. This reads the others from that sender,
 * works out what they share, and answers with the rule, what it would have
 * filed, and how many it could not read — so the next screen shows evidence
 * rather than a promise.
 *
 * Writes nothing. Nothing is switched on until `enable`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { deriveFromSender } from '@/lib/business-os/leads/inboxChannelSetup';

const logger = createLogger({ module: 'InboxDeriveAPI' });

const Body = z.object({
  provider: z.enum(['google-mail', 'outlook']),
  /*
   * The chosen message's SENDER, as the picker showed it — `Forms
   * <forms@site.com>` or a bare address, either reads.
   *
   * Not its id. Neither mail plugin can fetch one message by id, so an id
   * reached the mailbox as a search query that matched nothing and every
   * derive refused. The sender is the only part of the choice that was ever
   * used: the template is learned from that sender's mail, and the chosen
   * message is in that set.
   */
  from: z.string().min(3).max(320),
  /*
   * The chosen message's subject, which narrows WHICH of that sender's mail we
   * learn from. A sender who writes both form notifications and ordinary
   * letters would otherwise average the two and look like neither.
   */
  subject: z.string().max(998).optional(),
});

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Pick one message from a connected mailbox' },
        { status: 400 }
      );
    }

    const derived = await deriveFromSender(
      user.id,
      parsed.data.provider,
      parsed.data.from,
      parsed.data.subject
    );

    /*
     * A refusal the owner can act on, not a fault — so a 400 with words rather
     * than a 500.
     *
     * The words differ by reason. One sentence for all of them ("we could not
     * read an enquiry out of that message") was true and useless: it could not
     * distinguish "that sender writes you newsletters, pick a different one"
     * from "the sender is right and the layout defeated us", and those call
     * for opposite reactions from the person reading it.
     */
    if (typeof derived === 'string') {
      const sender = parsed.data.from;
      const reasons: Record<typeof derived, string> = {
        no_sender: 'That message has no sender we can read. Pick a different one.',
        nothing_to_read: `There is nothing left to read from ${sender}. Pick a message from a sender who has written more than once.`,
        not_a_form: `${sender} does not look like a contact form. Their messages share no common fields and no fixed subject, which is what a form email has. Pick an email your own website sent you when somebody filled in your form.`,
        no_contacts: `We recognised ${sender}'s layout but could not find a sender's email address in any of their recent messages, so there would be nobody to reply to. Pick a different email.`,
      };

      requestLogger.info({ userId: user.id, reason: derived }, 'Derive refused');
      return NextResponse.json({ success: false, error: reasons[derived] }, { status: 400 });
    }

    requestLogger.info(
      {
        userId: user.id,
        learnedFrom: derived.template.learnedFrom,
        labels: derived.template.labels.length,
        preview: derived.preview.length,
        unreadable: derived.unreadable,
      },
      'Derived an enquiry template'
    );

    return NextResponse.json({ success: true, data: derived });
  } catch (error) {
    requestLogger.error({ err: error }, 'Could not derive the enquiry template');
    return NextResponse.json(
      {
        success: false,
        error: 'Could not read your mailbox. Check the connection and try again.',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}
