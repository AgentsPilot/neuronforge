// app/api/contact/route.ts
// POST: the public contact form. Saves the message, then sends one
// notification to our own team inbox (reply-to = the sender), through the
// shared email transport. Input is validated and rate limited.
// Workplan: docs/workplans/contact-inbox-standard-workplan.md.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { createLogger } from '@/lib/logger';
import { htmlToText } from '@/lib/email/htmlToText';
import { escapeHtml } from '@/lib/email/escapeHtml';
import { CONTACT_FORM_INBOX } from '@/lib/business-os/supportContact';
import { sendEmail } from '@/lib/notifications/emailTransport';
import { contactMessagesRepository } from '@/lib/repositories/ContactMessagesRepository';
import { rateLimit, RATE_LIMITS, tooManyRequests } from '@/lib/security/rateLimit';
import { contactFormBodySchema } from '@/lib/validation/contactMessages';

const logger = createLogger({ module: 'ContactAPI' });

/** Fixed, so no submitted text reaches the transport's subject log line. Not exported: a route file may export only route fields. */
const CONTACT_NOTIFICATION_SUBJECT = 'New contact form message';

const devDetails = (details: unknown) => (process.env.NODE_ENV === 'development' ? details : undefined);

/*
 * Escaped, then line breaks restored — in that order.
 *
 * Everything here is typed into a public form. Unescaped, a message
 * containing a "<" opens a tag the rest of the email lives inside, and the
 * message arrives looking broken. Escaping after the <br> swap would turn the
 * breaks back into visible text.
 */
function notificationHtml(name: string, email: string, message: string): string {
  return `
          <div style="font-family: Arial, sans-serif; max-width: 600px;">
            <h2>New Contact Form Submission</h2>
            <div style="background: #f8f9fa; padding: 20px; border-radius: 8px;">
              <h3>Contact Details</h3>
              <p><strong>Name:</strong> ${escapeHtml(name)}</p>
              <p><strong>Email:</strong> ${escapeHtml(email)}</p>
              <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>

              <h3>Message</h3>
              <div style="background: #ffffff; padding: 15px; border-radius: 6px; border: 1px solid #ddd;">
                ${escapeHtml(message).replace(/\n/g, '<br>')}
              </div>

              <p><strong>Reply directly to this email to respond to ${escapeHtml(name)}</strong></p>
            </div>
          </div>
        `;
}

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  // Counted before the body is read: no session stands in front of this route.
  const throttle = await rateLimit(request, 'contact-form', RATE_LIMITS.create);
  if (!throttle.allowed) return tooManyRequests(RATE_LIMITS.create.windowSeconds);

  try {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: devDetails('Body is not valid JSON') },
        { status: 400 }
      );
    }
    const { name, email, message } = contactFormBodySchema.parse(raw);

    const saved = await contactMessagesRepository.createFromContactForm({ name, email, message });
    if (saved.error || !saved.data) {
      requestLogger.error({ err: saved.error }, 'Failed to save contact message');
      return NextResponse.json(
        { success: false, error: 'Failed to save message', details: devDetails(saved.error?.message) },
        { status: 500 }
      );
    }
    const messageId = saved.data.id;

    // One notification, to our own inbox only. The sender is the reply-to
    // address (already a validated email), so a reply reaches them. The
    // shared transport applies the recipient allow-list and never throws.
    const html = notificationHtml(name, email, message);
    const result = await sendEmail({
      kind: 'transactional',
      to: [CONTACT_FORM_INBOX],
      replyTo: email,
      subject: CONTACT_NOTIFICATION_SUBJECT,
      html,
      text: htmlToText(html),
    });

    const emailSent = result.sent;
    if (emailSent) {
      const marked = await contactMessagesRepository.markEmailSent(messageId);
      if (marked.error) {
        requestLogger.warn({ err: marked.error, messageId }, 'Notification sent, but email_sent was not recorded');
      }
      requestLogger.info({ messageId, provider: result.provider }, 'Contact notification sent');
    } else {
      requestLogger.warn(
        { messageId, provider: result.provider, blocked: result.blocked ?? null },
        'Contact notification not sent (message saved)'
      );
    }

    return NextResponse.json({
      success: true,
      emailSent,
      message: `Thanks ${name}! We've received your message and will get back to you soon.`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: devDetails(error.flatten()) },
        { status: 400 }
      );
    }
    requestLogger.error({ err: error }, 'Contact form request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: devDetails(error instanceof Error ? error.message : String(error)),
      },
      { status: 500 }
    );
  }
}
