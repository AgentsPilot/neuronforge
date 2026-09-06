/**
 * Sending one email to one person — the shared implementation.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT INSIDE ForEachExecutor ANY MORE
 *
 * It lived there as a private function, which meant BULK contact email worked
 * ("email everyone who owes me money") while sending to a SINGLE contact did
 * not: `contacts.send` was declared in the catalog, had no handler in
 * MutateExecutor, and failed every time it was asked for. The capability was
 * present and unreachable, differing only in how many people it was aimed at.
 *
 * Rather than write a second sender for the one-off case — two implementations
 * of "send an email to a client", drifting apart on branding, on validation, on
 * what counts as sent — the one that already worked moved here and both callers
 * use it.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/bizql/mutate
 */

import { sendEmail, type EmailAttachment } from '@/lib/notifications/emailTransport';
import {
  wrapInBrandedTemplate,
  type BrandingData,
} from '@/lib/email/templates/base-template';

export interface EmailOutcome {
  ok: boolean;
  provider?: string;
  error?: string;
}

/**
 * A conservative ceiling on what one message may carry.
 *
 * Providers differ — Resend allows ~40MB, most inbound servers reject above
 * 25MB — and the failure arrives asynchronously as a bounce, long after the
 * send was reported successful. Refusing here turns "the accountant never got
 * it" into an error the caller sees at the point of sending.
 */
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

/** How big a payload is, whether it arrived as a Buffer or as base64. */
function byteLength(content: Buffer | string): number {
  return Buffer.isBuffer(content)
    ? content.length
    : // base64 encodes 3 bytes per 4 characters.
      Math.ceil((content.length * 3) / 4);
}

/**
 * Validate the attachments, or say why not.
 *
 * Returns an error string rather than dropping bad entries. A silent drop is
 * the worst outcome available here: the message still goes, still reads as a
 * success, and the file it existed to deliver is simply absent — which nobody
 * discovers until the accountant asks where the ledger is.
 */
function readAttachments(
  value: unknown
): { attachments?: EmailAttachment[]; error?: string } {
  if (value === undefined || value === null) return {};
  if (!Array.isArray(value)) return { error: 'attachments must be a list' };
  if (value.length === 0) return {};

  const attachments: EmailAttachment[] = [];
  let total = 0;

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      return { error: 'each attachment must be an object' };
    }

    const { filename, content, contentType } = entry as Record<string, unknown>;

    if (typeof filename !== 'string' || !filename.trim()) {
      return { error: 'each attachment needs a filename' };
    }
    if (typeof contentType !== 'string' || !contentType.trim()) {
      return { error: `attachment '${filename}' needs a contentType` };
    }
    if (!Buffer.isBuffer(content) && typeof content !== 'string') {
      return { error: `attachment '${filename}' has no content` };
    }

    total += byteLength(content as Buffer | string);
    attachments.push({
      filename: filename.trim(),
      content: content as Buffer | string,
      contentType: contentType.trim(),
    });
  }

  if (total > MAX_ATTACHMENT_BYTES) {
    return {
      error: `attachments total ${Math.round(total / 1024 / 1024)}MB, over the ${
        MAX_ATTACHMENT_BYTES / 1024 / 1024
      }MB limit`,
    };
  }

  return { attachments };
}

/**
 * Send one email. Returns an outcome rather than throwing: in a fan-out, partial
 * failure is normal and the caller needs to count it, not abort on it.
 */
export async function performEmail(
  params: Record<string, unknown>,
  branding?: BrandingData
): Promise<EmailOutcome> {
  const to = params.to;

  if (typeof to !== 'string' || !to.includes('@')) {
    // A row with no usable address is skipped honestly rather than counted as
    // sent. Silently "succeeding" here is how a report claims 47 sends when
    // only 40 had an address.
    return { ok: false, error: 'no email address' };
  }

  const subject = String(params.subject ?? '').trim();
  const body = String(params.body ?? params.html ?? '').trim();

  if (!subject || !body) {
    return { ok: false, error: 'missing subject or body' };
  }

  const content = body.startsWith('<') ? body : `<p>${body.replace(/\n/g, '<br>')}</p>`;

  // Only wrap a FRAGMENT. A body that is already a whole document was authored
  // as one deliberately, and nesting a second <html> inside it renders as broken
  // markup in most clients.
  const isWholeDocument = /^\s*(<!doctype html|<html)/i.test(body);
  const html =
    branding && !isWholeDocument ? wrapInBrandedTemplate(content, branding) : content;

  /*
   * Files, where the caller has them.
   *
   * The transport has accepted attachments all along and nothing on this path
   * ever passed any, so every capability built on it could only send prose —
   * which is why "send my accountant the ledger" had no way through even once
   * the ledger itself could be produced. A malformed attachment fails the send
   * rather than being dropped: see `readAttachments`.
   */
  const { attachments, error: attachmentError } = readAttachments(params.attachments);
  if (attachmentError) {
    return { ok: false, error: attachmentError };
  }

  // Sent as the business: this reaches a CLIENT, and it is the owner they
  // should see in their inbox and reach on Reply. The caller supplies the owner
  // — this function receives a loose param bag and has no user of its own.
  const ownerUserId = typeof params.userId === 'string' ? params.userId : undefined;
  const result = await sendEmail({
    to: [to],
    subject,
    html,
    ownerUserId,
    ...(attachments ? { attachments } : {}),
  });

  return { ok: result.sent, provider: result.provider, error: result.error };
}
