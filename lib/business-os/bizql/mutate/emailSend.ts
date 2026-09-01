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

import { sendEmail } from '@/lib/notifications/emailTransport';
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

  const result = await sendEmail({ to: [to], subject, html });

  return { ok: result.sent, provider: result.provider, error: result.error };
}
