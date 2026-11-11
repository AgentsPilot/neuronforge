// lib/server/gmail-plugin-executor.ts

import { UserPluginConnections } from './user-plugin-connections';
import { PluginManagerV2 } from './plugin-manager-v2';
import { GoogleBasePluginExecutor } from './google-base-plugin-executor';
import { htmlToText } from '@/lib/email/htmlToText';

const pluginName = 'google-mail'; // Current plugin key

// Known Gmail system label IDs — these can be used directly without resolution
const SYSTEM_LABELS = new Set([
  'IMPORTANT', 'STARRED', 'UNREAD', 'INBOX', 'SPAM', 'TRASH',
  'SENT', 'DRAFT', 'CATEGORY_PERSONAL', 'CATEGORY_SOCIAL',
  'CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS',
]);

// Executor for Gmail plugin actions

/**
 * What the sender actually wrote, without the conversation underneath it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS WORTH DOING AT ALL
 *
 * A reply carries the whole thread below it. A client writing two sentences
 * back to a booking confirmation produced ~4,100 tokens of message, almost all
 * of it our own HTML card quoted back at us, and every one of those tokens was
 * paid for on the way into a model that needed the two sentences.
 *
 * MARKERS, NOT GUESSES. Each pattern below is something a mail client WRITES to
 * mark a quote. Nothing here infers from blank lines, indentation or length,
 * because a short message is not a quote and a long one is not a thread.
 *
 *   gmail_quote / blockquote   what Gmail and most web clients emit
 *   -----Original Message----- Outlook and everything imitating it
 *   From: … Sent: … To:        the Outlook header block, which arrives as
 *                              plain text inside the body
 *   On <date>, <who> wrote:    the Apple Mail and Thunderbird convention
 *   a run of lines opening >   the oldest convention of all
 *
 * THE SAFETY RULE, which matters more than the patterns: people bottom-post.
 * Plenty of readers answer UNDER the quote, so cutting at the first marker
 * would throw their entire reply away and hand the model an empty string. If
 * what survives is empty or too short to be a message, the original is
 * returned untouched. A long prompt costs money; a blank one costs an answer.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const QUOTE_MARKERS: RegExp[] = [
  /<div[^>]*class=["'][^"']*gmail_quote/i,
  /<blockquote/i,
  /-{2,}\s*original message\s*-{2,}/i,
  /^\s*from:.*$\n^\s*sent:.*$/im,
  /^\s*on .{0,120}wrote:\s*$/im,
  /(^|\n)(>\s?.*\n){2,}/,
];

/*
 * The floor catches an EMPTY cut, not a short one.
 *
 * It was 12, which is the kind of number that looks cautious and is not:
 * "Yes please." is 11 characters and a complete answer, and at 12 it fell back
 * to the whole quoted thread — the exact cost this function exists to avoid.
 * Two characters is the real question being asked: did the cut leave anything
 * at all, or did this person answer underneath the quote?
 */
const TOO_SHORT_TO_BE_A_MESSAGE = 2;

export function stripQuotedThread(body: string): string {
  if (!body) return body;

  let cut = body.length;
  for (const marker of QUOTE_MARKERS) {
    const found = body.search(marker);
    if (found >= 0 && found < cut) cut = found;
  }

  if (cut >= body.length) return body;

  const kept = body.slice(0, cut).trim();

  /* Nothing above the quote means they answered underneath it, and the reply
     we want is in the part we just cut. Hand back the original. */
  return kept.length >= TOO_SHORT_TO_BE_A_MESSAGE ? kept : body;
}

export class GmailPluginExecutor extends GoogleBasePluginExecutor {
  protected gmailApisUrl: string;

  constructor(userConnections: UserPluginConnections, pluginManager: PluginManagerV2) {
    super(pluginName, userConnections, pluginManager);

    this.gmailApisUrl = 'https://gmail.googleapis.com/gmail/v1';
  }

  // Execute Gmail action with validation and error handling
  protected async executeSpecificAction(
    connection: any,
    actionName: string,
    parameters: any
  ): Promise<any> {
    switch (actionName) {
      case 'send_email':
        return await this.sendEmail(connection, parameters);
      case 'search_emails':
        return await this.searchEmails(connection, parameters);
      case 'create_draft':
        return await this.createDraft(connection, parameters);
      case 'get_email_attachment':
        return await this.getEmailAttachment(connection, parameters);
      case 'modify_email':
        return await this.modifyEmail(connection, parameters);
      case 'get_or_create_label':
        return await this.getOrCreateLabel(connection, parameters);
      // NOTE: dispatches to the private listAllLabels ACTION method — NOT the
      // public `list_labels(connection, options)` dropdown fetcher (~line 884),
      // which is the x-dynamic-options source and has a different signature/shape.
      case 'list_labels':
        return await this.listAllLabels(connection, parameters);
      case 'delete_label':
        return await this.deleteLabel(connection, parameters);
      case 'reply_to_email':
        return await this.replyToThread(connection, parameters);
      case 'send_draft':
        return await this.sendDraft(connection, parameters);
      case 'delete_draft':
        return await this.deleteDraft(connection, parameters);
      case 'batch_modify_emails':
        return await this.batchModifyMessages(connection, parameters);
      default:
        throw new Error(`Action ${actionName} not supported`);
    }
  }

  // Send email via Gmail API
  private async sendEmail(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Sending email via Gmail API');

    // Phase 4 — during a calibration test run, redirect + label this email.
    // Details live in applyCalibrationModeToEmail; no-op outside calibration.
    const calibration = this.getCalibrationNotice(parameters);
    if (calibration.isCalibration) {
      // Degraded run (an upstream step failed) → skip the real send entirely.
      // Prevents the classic "empty digest" side-effect where calibration
      // re-runs a broken workflow and dispatches a placeholder ("No data
      // available.") email each time. No API call, no delivery; return a
      // success-shaped result so the workflow completes and calibration can
      // still evaluate the rest of the run.
      if (calibration.suppressSend) {
        this.logger.info(
          { recipientCount: this.countRecipients(parameters.recipients) },
          'Calibration: suppressing outbound email — run had failed steps (empty/degraded output not delivered)'
        );
        return {
          message_id: null,
          thread_id: null,
          sent_at: new Date().toISOString(),
          recipient_count: 0,
          recipients: parameters.recipients,
          subject: parameters.content?.subject || '(no subject)',
          calibration_suppressed: true,
          note: 'Calibration: send suppressed because the run had failed steps; no email was delivered.',
        };
      }
      this.applyCalibrationModeToEmail(parameters, calibration);
    }

    // Build email message
    const message = this.buildEmailMessage(parameters);

    // Send via Gmail API
    const response = await fetch(`${this.gmailApisUrl}/users/me/messages/send`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: message })
    });

    if (!response.ok) {
      const errorData = await response.text();
      this.logger.error({ status: response.status, errorData }, 'Gmail send failed');
      throw new Error(`Gmail API error: ${response.status} - ${errorData}`);
    }

    const result = await response.json();

    // Return formatted result
    const recipientCount = this.countRecipients(parameters.recipients);

    return {
      message_id: result.id,
      thread_id: result.threadId,
      sent_at: new Date().toISOString(),
      recipient_count: recipientCount,
      recipients: parameters.recipients,
      subject: parameters.content?.subject || '(no subject)'
    };
  }

  /**
   * Phase 4 — calibration-mode behavior for an outgoing email. Mutates
   * `parameters` in place so a test run is safe and clearly labeled:
   *   1. Redirect to the agent owner (`notice.redirectTo`) so the test never
   *      reaches a real third party; remember the original recipients.
   *   2. Prepend the calibration banner (incl. who it was originally for) to the
   *      subject + body/html_body.
   * Best-effort — never throws (a labeling/redirect glitch must not break the run).
   * Called only when `getCalibrationNotice(...).isCalibration` is true.
   */
  private applyCalibrationModeToEmail(
    parameters: any,
    notice: { subjectPrefix: string; htmlBanner: string; textBanner: string; redirectTo?: string }
  ): void {
    try {
      const content = parameters?.content;
      if (!content) return;

      // (1) Recipient redirect — send to the owner instead of the real recipients.
      let originalRecipientsNote = '';
      if (notice.redirectTo) {
        const fmt = (v: any): string => Array.isArray(v) ? v.join(', ') : (typeof v === 'string' ? v : '');
        const orig = parameters.recipients || {};
        const parts = [fmt(orig.to), orig.cc ? `cc: ${fmt(orig.cc)}` : '', orig.bcc ? `bcc: ${fmt(orig.bcc)}` : '']
          .filter(Boolean).join('; ');
        originalRecipientsNote = parts ? ` Originally addressed to: ${parts} — redirected to you for the test.` : '';
        parameters.recipients = { to: [notice.redirectTo] };
      }

      // (2) Banner + subject prefix (banner includes the redirect note).
      const htmlNote = originalRecipientsNote
        ? `<div style="color:#9a3412;font-size:12px;margin-bottom:14px;">${originalRecipientsNote.trim()}</div>`
        : '';
      const textNote = originalRecipientsNote ? `${originalRecipientsNote.trim()}\n\n` : '';

      content.subject = typeof content.subject === 'string' && content.subject.length > 0
        ? notice.subjectPrefix + content.subject
        : notice.subjectPrefix.trim();
      if (typeof content.html_body === 'string' && content.html_body.length > 0) {
        content.html_body = notice.htmlBanner + htmlNote + content.html_body;
      }
      if (typeof content.body === 'string' && content.body.length > 0) {
        content.body = notice.textBanner + textNote + content.body;
      }
    } catch (err) {
      this.logger.warn({ err }, 'Failed to apply calibration mode to email (non-blocking)');
    }
  }

  // Search emails via Gmail API
  private async searchEmails(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Searching emails via Gmail API');

    // Build search query
    const searchQuery = this.buildSearchQuery(parameters);

    // Search messages
    const listUrl = new URL(`${this.gmailApisUrl}/users/me/messages`);
    listUrl.searchParams.set('maxResults', parameters.max_results?.toString() || '10');
    listUrl.searchParams.set('q', searchQuery);

    const listResponse = await fetch(listUrl.toString(), {
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Accept': 'application/json',
      },
    });

    if (!listResponse.ok) {
      const errorData = await listResponse.text();
      this.logger.error(
        {
          status: listResponse.status,
          errorData,
          connectionExpiresAt: connection.expires_at,
        },
        'Gmail search failed'
      );
      throw new Error(`Gmail search failed: ${listResponse.status} - ${errorData}`);
    }

    const listData = await listResponse.json();

    if (!listData.messages || listData.messages.length === 0) {
      return {
        emails: [],
        total_found: 0,
        search_query: searchQuery,
        message: 'No emails found matching search criteria'
      };
    }

    // Determine content level
    // include_attachments forces 'full' content level
    const contentLevel = parameters.include_attachments
      ? 'full'
      : (parameters.content_level || 'snippet');

    this.logger.debug({ contentLevel, includeAttachments: parameters.include_attachments }, 'Email content level');

    // Fetch email details
    const emails = [];
    const messagesToFetch = listData.messages.slice(0, parameters.max_results || 10);

    for (const message of messagesToFetch) {
      try {
        const emailDetail = await this.fetchEmailDetail(
          connection.access_token,
          message.id,
          parameters.include_attachments || false,
          contentLevel,
          /* Opt-in, and deliberately not the default: every other caller of
             this action wants the message exactly as it arrived. */
          parameters.strip_quoted_reply === true
        );
        emails.push(emailDetail);
      } catch (error) {
        this.logger.warn({ err: error, messageId: message.id }, 'Failed to fetch email');
      }
    }

    return {
      emails,
      total_found: emails.length,
      total_available: listData.resultSizeEstimate || 0,
      search_query: searchQuery,
      searched_at: new Date().toISOString()
    };
  }

  // Create draft via Gmail API
  /**
   * A draft, and optionally a draft that belongs to a conversation.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * `reply_to_message_id` IS THE WHOLE DIFFERENCE BETWEEN A REPLY AND A LETTER.
   *
   * Without it a drafted answer arrives as its own message carrying "Re:", and
   * the client's mail client files it as a new conversation beside the one it
   * answers. The owner sends what looks, to the person receiving it, like a
   * stranger to the thread they wrote in.
   *
   * Gmail needs two things to disagree with that, and both come from the
   * message being replied to: the `threadId`, and `In-Reply-To`/`References`
   * headers naming the original's `Message-ID`. `users.drafts.create` takes the
   * same `{ raw, threadId }` shape that `messages.send` does, so a threaded
   * draft is the threaded SEND minus the sending — which is exactly what an
   * agent that must never email a client needs.
   *
   * Absent, everything below is skipped and the old behaviour stands. No
   * existing caller passes it.
   * ───────────────────────────────────────────────────────────────────────────
   */
  private async createDraft(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Creating draft via Gmail API');

    let message: string;
    let threadId: string | undefined;
    /*
     * THE RESOLVED recipients AND subject, not the ones asked for.
     *
     * When threading, both are worked out from the original: the subject gains
     * a "Re:" and recipients may have been defaulted to the sender. Reporting
     * `parameters` back would describe a draft other than the one just written
     * — a `subject` without its "Re:", and a `recipient_count` of 0 whenever
     * the caller let the sender be inferred. Whatever reads this result (an
     * activity line, the owner's own eyes) should see what is in the drafts
     * folder.
     */
    let recipients: any = parameters.recipients || {};
    let subject: string = parameters.content?.subject || '(no subject)';

    if (parameters.reply_to_message_id) {
      const threaded = await this.threadedReplyParts(
        connection,
        String(parameters.reply_to_message_id),
        parameters
      );
      message = threaded.raw;
      threadId = threaded.threadId;
      recipients = threaded.recipients;
      subject = threaded.subject;
    } else {
      message = this.buildEmailMessage(parameters);
    }

    // Create draft
    const response = await fetch(`${this.gmailApisUrl}/users/me/drafts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: threadId ? { raw: message, threadId } : { raw: message }
      })
    });

    if (!response.ok) {
      const errorData = await response.text();
      this.logger.error({ status: response.status, errorData }, 'Gmail draft creation failed');
      throw new Error(`Gmail draft creation failed: ${response.status} - ${errorData}`);
    }

    const result = await response.json();

    // Return formatted result
    return {
      draft_id: result.id,
      message_id: result.message?.id,
      thread_id: result.message?.threadId ?? threadId ?? null,
      created_at: new Date().toISOString(),
      recipient_count: this.countRecipients(recipients),
      recipients,
      subject
    };
  }

  // Download email attachment content
  private async getEmailAttachment(connection: any, parameters: any): Promise<any> {
    const { message_id, attachment_id, filename } = parameters;

    if (!message_id || !attachment_id) {
      throw new Error('message_id and attachment_id are required parameters');
    }

    this.logger.debug({ message_id, attachment_id, filename }, 'Downloading email attachment');

    try {
      // Download attachment using Gmail API
      const response = await fetch(
        `${this.gmailApisUrl}/users/me/messages/${message_id}/attachments/${attachment_id}`,
        {
          headers: {
            'Authorization': `Bearer ${connection.access_token}`,
            'Accept': 'application/json',
          },
        }
      );

      if (!response.ok) {
        const errorData = await response.text();
        this.logger.error({ status: response.status, errorData }, 'Attachment download failed');
        throw new Error(`Attachment download failed: ${response.status} - ${errorData}`);
      }

      const attachmentData = await response.json();

      // Detect MIME type from filename extension
      let mimeType = 'application/octet-stream';
      if (filename) {
        const ext = filename.split('.').pop()?.toLowerCase();
        const mimeMap: Record<string, string> = {
          'pdf': 'application/pdf',
          'png': 'image/png',
          'jpg': 'image/jpeg',
          'jpeg': 'image/jpeg',
          'gif': 'image/gif',
          'txt': 'text/plain',
          'csv': 'text/csv',
          'json': 'application/json',
          'doc': 'application/msword',
          'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'xls': 'application/vnd.ms-excel',
          'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        };
        mimeType = ext ? (mimeMap[ext] || 'application/octet-stream') : mimeType;
      }

      // ✅ FIX: Convert Gmail's base64url format to standard base64
      // Gmail API returns base64url (uses - and _ instead of + and /)
      // Other services (Google Drive, document-extractor) expect standard base64
      const standardBase64 = this.convertBase64UrlToBase64(attachmentData.data);

      const result: any = {
        filename: filename || 'attachment',
        mimeType,
        size: attachmentData.size || 0,
        data: standardBase64, // Standard base64-encoded content
        // PDFs can be processed visually by vision models (GPT-4o, etc.)
        is_image: mimeType.startsWith('image/') || mimeType === 'application/pdf'
      };

      // Attempt text extraction for text files
      if (mimeType.startsWith('text/')) {
        try {
          result.extracted_text = this.decodeBase64Url(attachmentData.data);
        } catch (textError) {
          this.logger.warn({ err: textError }, 'Text extraction failed');
          result.extracted_text = '(Text extraction unavailable)';
        }
      } else if (mimeType === 'application/pdf') {
        // PDF text extraction would require additional library
        // For now, indicate it's not extracted
        result.extracted_text = '(PDF text extraction not yet implemented)';
      }

      this.logger.debug(
        { filename, mimeType, size: result.size },
        'Attachment downloaded successfully'
      );

      return result;

    } catch (error: any) {
      this.logger.error({ err: error, message_id, attachment_id }, 'Attachment download error');
      throw new Error(`Failed to download attachment: ${error.message}`);
    }
  }

  // Modify email labels — mark as important, apply/remove labels, mark read/unread
  private async modifyEmail(connection: any, parameters: any): Promise<any> {
    const { add_labels, remove_labels, mark_important, mark_read } = parameters;
    // Accept both 'message_id' and 'id' — search_emails returns 'id' but modify_email schema uses 'message_id'
    const message_id = parameters.message_id || parameters.id;

    if (!message_id) {
      throw new Error('message_id is a required parameter');
    }

    this.logger.debug({ message_id, add_labels, remove_labels, mark_important, mark_read }, 'Modifying email labels');

    // Build addLabelIds from explicit labels + shorthands
    // Normalize: accept both array ["Label1"] and string "Label1" (config values may resolve as string)
    const addLabelNames: string[] = Array.isArray(add_labels) ? [...add_labels] : (add_labels ? [add_labels] : []);
    const removeLabelNames: string[] = Array.isArray(remove_labels) ? [...remove_labels] : (remove_labels ? [remove_labels] : []);

    // Apply mark_important shorthand
    if (mark_important === true) {
      addLabelNames.push('IMPORTANT');
    } else if (mark_important === false) {
      removeLabelNames.push('IMPORTANT');
    }

    // Apply mark_read shorthand (read = remove UNREAD, unread = add UNREAD)
    if (mark_read === true) {
      removeLabelNames.push('UNREAD');
    } else if (mark_read === false) {
      addLabelNames.push('UNREAD');
    }

    // Resolve label names to IDs (system labels pass through, custom labels get resolved/created)
    const addLabelIds = await this.resolveLabelNames(connection, addLabelNames);
    const removeLabelIds = await this.resolveLabelNames(connection, removeLabelNames);

    // Call Gmail modify endpoint
    const response = await fetch(
      `${this.gmailApisUrl}/users/me/messages/${message_id}/modify`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${connection.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          addLabelIds,
          removeLabelIds,
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.text();
      this.logger.error({ status: response.status, errorData }, 'Gmail modify failed');
      throw new Error(`Gmail modify failed: ${response.status} - ${errorData}`);
    }

    // Gmail returns the modified message; we return a simplified result
    await response.json();

    return {
      message_id,
      labels_added: addLabelIds,
      labels_removed: removeLabelIds,
    };
  }

  /**
   * Resolve an array of label names to Gmail label IDs.
   * System labels (IMPORTANT, STARRED, etc.) are returned as-is.
   * Custom labels are resolved via GET /users/me/labels; if not found, created via POST /users/me/labels.
   * Makes at most one GET call per modifyEmail invocation (cached within the resolution batch).
   */
  private async resolveLabelNames(connection: any, labelNames: string[]): Promise<string[]> {
    if (labelNames.length === 0) return [];

    // Separate system labels from custom labels
    const resolvedIds: string[] = [];
    const customNames: string[] = [];

    for (const name of labelNames) {
      if (SYSTEM_LABELS.has(name.toUpperCase())) {
        resolvedIds.push(name.toUpperCase());
      } else {
        customNames.push(name);
      }
    }

    if (customNames.length === 0) return resolvedIds;

    // Fetch all labels once for resolving custom label names
    const labelsResponse = await fetch(`${this.gmailApisUrl}/users/me/labels`, {
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Accept': 'application/json',
      },
    });

    if (!labelsResponse.ok) {
      const errorData = await labelsResponse.text();
      this.logger.error({ status: labelsResponse.status, errorData }, 'Failed to fetch labels for resolution');
      throw new Error(`Failed to fetch labels: ${labelsResponse.status} - ${errorData}`);
    }

    const labelsData = await labelsResponse.json();
    const existingLabels: Array<{ id: string; name: string }> = labelsData.labels || [];

    this.logger.debug({ customNames, existingLabelCount: existingLabels.length, existingNames: existingLabels.map((l: any) => l.name).slice(0, 20) }, 'Resolving custom label names');

    // Resolve each custom label name
    for (const customName of customNames) {
      const existing = existingLabels.find(
        (l) => l.name.toLowerCase() === customName.toLowerCase()
      );

      if (existing) {
        this.logger.debug({ labelName: customName, labelId: existing.id }, 'Resolved custom label');
        resolvedIds.push(existing.id);
      } else {
        // Create the label
        const newLabel = await this.createLabel(connection, customName);
        resolvedIds.push(newLabel.id);
      }
    }

    return resolvedIds;
  }

  /**
   * Create a new Gmail label.
   * Returns the created label object with { id, name }.
   */
  private async createLabel(connection: any, labelName: string): Promise<{ id: string; name: string }> {
    this.logger.warn({ labelName }, 'Creating new Gmail label (not found in existing labels)');

    const response = await fetch(`${this.gmailApisUrl}/users/me/labels`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: labelName,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
      }),
    });

    if (!response.ok) {
      // D-B10b: Handle 409 "Label name exists or conflicts" — label exists but wasn't
      // found in the initial GET /labels response (can happen with nested labels or
      // timing issues). Re-fetch labels and find it.
      if (response.status === 409) {
        this.logger.info({ labelName }, 'Label already exists (409 conflict) — re-fetching to resolve ID');
        const refetchResponse = await fetch(`${this.gmailApisUrl}/users/me/labels`, {
          headers: {
            'Authorization': `Bearer ${connection.access_token}`,
            'Accept': 'application/json',
          },
        });
        if (refetchResponse.ok) {
          const refetchData = await refetchResponse.json();
          const found = (refetchData.labels || []).find(
            (l: any) => l.name.toLowerCase() === labelName.toLowerCase()
          );
          if (found) {
            this.logger.debug({ labelName, labelId: found.id }, 'Resolved existing label after 409');
            return { id: found.id, name: found.name };
          }
        }
      }

      const errorData = await response.text();
      this.logger.error({ status: response.status, errorData, labelName }, 'Failed to create label');
      throw new Error(`Failed to create label "${labelName}": ${response.status} - ${errorData}`);
    }

    const label = await response.json();
    this.logger.debug({ labelName, labelId: label.id }, 'Created new Gmail label');
    return { id: label.id, name: label.name };
  }

  // ─── Phase 1 actions: labels + reply/draft/batch ──────────────────────────

  /**
   * Fetch all Gmail labels once. Shared by the new label actions.
   * Returns the raw label objects ({ id, name, type }).
   */
  private async fetchLabels(connection: any): Promise<Array<{ id: string; name: string; type?: string }>> {
    const response = await fetch(`${this.gmailApisUrl}/users/me/labels`, {
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.text();
      this.logger.error({ status: response.status, errorData }, 'Gmail labels fetch failed');
      throw new Error(`Failed to fetch labels: ${response.status} - ${errorData}`);
    }

    const data = await response.json();
    return Array.isArray(data.labels) ? data.labels : [];
  }

  /**
   * Idempotent find-or-create for a Gmail label.
   * Lists labels, case-insensitive match by name → returns it (created:false);
   * on miss, reuses the 409-safe createLabel (created:true).
   */
  private async getOrCreateLabel(connection: any, parameters: any): Promise<any> {
    const labelName: string = typeof parameters.label_name === 'string' ? parameters.label_name.trim() : '';
    if (!labelName) {
      throw new Error('label_name is a required parameter');
    }

    this.logger.debug({ labelName }, 'get_or_create_label: resolving label');

    const labels = await this.fetchLabels(connection);
    const existing = labels.find((l) => l.name?.toLowerCase() === labelName.toLowerCase());

    if (existing) {
      this.logger.debug({ labelName, labelId: existing.id }, 'get_or_create_label: found existing');
      return {
        label_id: existing.id,
        label_name: existing.name,
        created: false,
        created_at: new Date().toISOString(),
      };
    }

    // createLabel is 409-safe (re-fetches on conflict). Visibility is hardcoded
    // inside createLabel by design — no visibility params on this action (CR-1).
    const created = await this.createLabel(connection, labelName);
    return {
      label_id: created.id,
      label_name: created.name,
      created: true,
      created_at: new Date().toISOString(),
    };
  }

  /**
   * List all Gmail labels (action). Distinct from the public `list_labels`
   * dropdown fetcher — this returns the schema-shaped action payload.
   * Optional `label_type` filter: 'system' | 'user' | 'all' (default all).
   */
  private async listAllLabels(connection: any, parameters: any): Promise<any> {
    const labelType: string = typeof parameters.label_type === 'string' ? parameters.label_type : 'all';

    const labels = await this.fetchLabels(connection);

    const filtered = labelType === 'all'
      ? labels
      : labels.filter((l) => l.type === labelType);

    const mapped = filtered.map((l) => ({
      id: l.id,
      name: l.name,
      type: l.type || 'user',
    }));

    return {
      labels: mapped,
      total_found: mapped.length,
      listed_at: new Date().toISOString(),
    };
  }

  /**
   * Delete a Gmail label by id.
   * - Hard-rejects Gmail SYSTEM_LABELS BEFORE the DELETE (CR-4).
   * - DELETE returns 204 No Content → does NOT call .json().
   * - 404 → treated as already-absent success (idempotent-ish).
   */
  private async deleteLabel(connection: any, parameters: any): Promise<any> {
    const labelId: string = typeof parameters.label_id === 'string' ? parameters.label_id.trim() : '';
    if (!labelId) {
      throw new Error('label_id is a required parameter');
    }

    // In-executor hard guard — refuse to delete a built-in Gmail system label
    // (Gmail would reject it anyway; fail fast before any network call).
    if (SYSTEM_LABELS.has(labelId.toUpperCase())) {
      throw new Error(`cannot_delete_system_label: "${labelId}" is a built-in Gmail label and cannot be deleted.`);
    }

    this.logger.debug({ labelId }, 'delete_label: deleting label');

    const response = await fetch(`${this.gmailApisUrl}/users/me/labels/${encodeURIComponent(labelId)}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Accept': 'application/json',
      },
    });

    // 404 → the label is already gone; net effect is the desired state.
    if (response.status === 404) {
      this.logger.info({ labelId }, 'delete_label: label already absent (404) — treating as success');
      return {
        label_id: labelId,
        deleted: true,
        already_absent: true,
        deleted_at: new Date().toISOString(),
      };
    }

    if (!response.ok) {
      const errorData = await response.text();
      this.logger.error({ status: response.status, errorData, labelId }, 'Gmail label delete failed');
      throw new Error(`Gmail label delete failed: ${response.status} - ${errorData}`);
    }

    // Success is 204 No Content — do NOT call response.json() (empty body).
    return {
      label_id: labelId,
      deleted: true,
      already_absent: false,
      deleted_at: new Date().toISOString(),
    };
  }

  /**
   * EVERYTHING THAT MAKES A MESSAGE PART OF A CONVERSATION, worked out once.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Threading is not one fact but four, and all four come from the message
   * being answered: the `threadId` Gmail files it under, the original's
   * `Message-ID` echoed back as `In-Reply-To`, the `References` chain extended
   * by it, and a subject that says `Re:` exactly once. Get any of them wrong
   * and the answer arrives beside the conversation instead of inside it.
   *
   * SHARED BY `reply_to_email` AND `create_draft` ON PURPOSE. They differ in
   * one line — one sends the result, the other stores it — and it would be a
   * poor bargain to copy all four facts to avoid sharing them. Two copies drift,
   * and a drifted copy does not fail loudly: it produces a reply that looks
   * right to whoever drafted it and lands as a stray message for whoever reads
   * it. `reply_to_email` behaves exactly as it did; this is its own code, lifted
   * whole and given a name.
   *
   * Recipients: an explicit `parameters.recipients` wins. Absent one, it answers
   * the sender (`Reply-To` ?? `From`), and `reply_all: true` widens Cc to the
   * original To + Cc. Self-exclusion is not performed (no profile lookup here)
   * — a documented v1 limitation that predates this extraction.
   * ───────────────────────────────────────────────────────────────────────────
   */
  private async threadedReplyParts(
    connection: any,
    messageId: string,
    parameters: any
  ): Promise<{
    raw: string;
    threadId: string;
    inReplyTo: string;
    recipients: any;
    subject: string;
  }> {
    const content = parameters.content || {};

    // (1) Fetch original message metadata to resolve threading headers.
    const metaResponse = await fetch(
      `${this.gmailApisUrl}/users/me/messages/${encodeURIComponent(messageId)}?format=metadata`,
      {
        headers: {
          'Authorization': `Bearer ${connection.access_token}`,
          'Accept': 'application/json',
        },
      }
    );

    if (!metaResponse.ok) {
      const errorData = await metaResponse.text();
      this.logger.error({ status: metaResponse.status, errorData, messageId }, 'threading: failed to fetch the message being replied to');
      throw new Error(`Failed to fetch original message: ${metaResponse.status} - ${errorData}`);
    }

    const original = await metaResponse.json();
    const headers: Array<{ name: string; value: string }> = original.payload?.headers || [];
    const getHeader = (name: string): string =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

    const threadId: string = original.threadId;
    const originalMessageIdHeader = getHeader('Message-ID') || getHeader('Message-Id');
    const originalReferences = getHeader('References');
    const originalSubject = getHeader('Subject');
    const originalFrom = getHeader('From');
    const originalReplyTo = getHeader('Reply-To');
    const originalTo = getHeader('To');
    const originalCc = getHeader('Cc');

    // (2) Compute recipients: explicit override → else reply to sender (Reply-To ?? From).
    // reply_all (when no explicit override) widens Cc to the original To + Cc set.
    // Note: self-exclusion is not performed (no profile lookup here) — documented v1 limitation.
    let recipients = parameters.recipients;
    if (!recipients || (!recipients.to && !recipients.cc && !recipients.bcc)) {
      const sender = originalReplyTo || originalFrom;
      recipients = { to: sender ? [sender] : [] };
      if (parameters.reply_all === true) {
        const cc = [originalTo, originalCc].filter((v) => v && v.length > 0);
        if (cc.length > 0) recipients.cc = cc;
      }
    }

    // (3) Build subject: Re: <original>, avoiding a double "Re:".
    const subject = /^re:/i.test(originalSubject.trim())
      ? originalSubject
      : `Re: ${originalSubject}`;

    // (4) Build the reply MIME with threading headers.
    const references = originalReferences
      ? `${originalReferences} ${originalMessageIdHeader}`.trim()
      : originalMessageIdHeader;

    const raw = this.buildEmailMessage(
      { recipients, content: { ...content, subject } },
      {
        'In-Reply-To': originalMessageIdHeader,
        'References': references,
      }
    );

    return { raw, threadId, inReplyTo: originalMessageIdHeader, recipients, subject };
  }

  /**
   * Reply within an existing thread.
   * Threading is resolved by `threadedReplyParts` (metadata fetch, In-Reply-To /
   * References, recipients, subject); this sends the result with the threadId so
   * it CONTINUES the conversation rather than starting one.
   * NOT idempotent — each call sends a new message (double-send on re-run).
   */
  /**
   * The newest message in a thread — the one a reply should answer.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Gmail threading is driven by a MESSAGE: `In-Reply-To` and `References` are
   * built from the message being answered, and `threadedReplyParts` needs one.
   * A caller holding only a conversation had no way in.
   *
   * That caller is the "needs you" card. It stores a THREAD on the activity,
   * deliberately — a thread is what the owner is answering, and by the time
   * they press send the client may have written twice more. Pinning the stored
   * message would answer whichever message the agent happened to scan, which on
   * a moving conversation is the wrong one and reads as a non-sequitur.
   *
   * `format=minimal` returns the message list without bodies. Gmail returns
   * them oldest-first, so the last is the newest.
   * ───────────────────────────────────────────────────────────────────────────
   */
  private async newestMessageInThread(connection: any, threadId: string): Promise<string> {
    const response = await fetch(
      `${this.gmailApisUrl}/users/me/threads/${encodeURIComponent(threadId)}?format=minimal`,
      { headers: { Authorization: `Bearer ${connection.access_token}`, Accept: 'application/json' } }
    );

    if (!response.ok) {
      const errorData = await response.text();
      this.logger.error({ status: response.status, threadId, errorData }, 'reply_to_email: thread lookup failed');
      throw new Error(`Gmail thread lookup failed: ${response.status} - ${errorData}`);
    }

    const thread = await response.json();
    const messages: Array<{ id?: string }> = Array.isArray(thread?.messages) ? thread.messages : [];
    const newest = messages[messages.length - 1]?.id;

    if (!newest) {
      throw new Error(`Gmail thread ${threadId} has no messages to reply to`);
    }
    return newest;
  }

  private async replyToThread(connection: any, parameters: any): Promise<any> {
    let messageId: string = typeof parameters.message_id === 'string' ? parameters.message_id.trim() : '';

    /*
     * A thread is an accepted alternative to a message — see
     * `newestMessageInThread`. The message still wins where both are given,
     * because a caller naming one is answering that one specifically.
     */
    const threadParam: string = typeof parameters.thread_id === 'string' ? parameters.thread_id.trim() : '';
    if (!messageId && threadParam) {
      messageId = await this.newestMessageInThread(connection, threadParam);
    }

    if (!messageId) {
      throw new Error('reply_to_email needs either message_id or thread_id');
    }

    const content = parameters.content || {};
    const hasBody = (typeof content.body === 'string' && content.body.length > 0)
      || (typeof content.html_body === 'string' && content.html_body.length > 0);
    if (!hasBody) {
      throw new Error('content must include at least one of body or html_body');
    }

    const { raw, threadId, inReplyTo, recipients, subject } =
      await this.threadedReplyParts(connection, messageId, parameters);

    // Send within the thread. threadId keeps the reply in the same conversation.
    const sendResponse = await fetch(`${this.gmailApisUrl}/users/me/messages/send`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw, threadId }),
    });

    if (!sendResponse.ok) {
      const errorData = await sendResponse.text();
      this.logger.error({ status: sendResponse.status, errorData }, 'reply_to_email: send failed');
      throw new Error(`Gmail reply send failed: ${sendResponse.status} - ${errorData}`);
    }

    const result = await sendResponse.json();

    return {
      message_id: result.id,
      thread_id: result.threadId,
      in_reply_to: inReplyTo,
      recipient_count: this.countRecipients(recipients),
      subject,
      sent_at: new Date().toISOString(),
    };
  }

  /**
   * Send an existing Gmail draft (drafts.send { id }).
   * NOT idempotent — consumes the draft; a re-run 404s.
   */
  /**
   * Throw away a draft nobody is going to send.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Needed the moment a reply can be sent from somewhere OTHER than the draft.
   * The "needs you" card lets an owner edit the agent's proposed text and send
   * it as a threaded reply — which leaves the original draft sitting in the
   * mailbox, identical-looking and still sendable. A fortnight later it is
   * indistinguishable from a reply that never went, and sending it delivers the
   * same answer twice.
   *
   * Also the honest answer to "discard": an owner who rejects the agent's draft
   * should not have to go into Gmail to finish rejecting it.
   *
   * A 404 is SUCCESS here, not an error. The draft may already be gone — the
   * owner deleted it by hand, or sent it themselves — and the caller's intent
   * ("this draft should not exist") is satisfied either way.
   * ───────────────────────────────────────────────────────────────────────────
   */
  private async deleteDraft(connection: any, parameters: any): Promise<any> {
    const draftId: string = typeof parameters.draft_id === 'string' ? parameters.draft_id.trim() : '';
    if (!draftId) {
      throw new Error('draft_id is a required parameter');
    }

    const response = await fetch(
      `${this.gmailApisUrl}/users/me/drafts/${encodeURIComponent(draftId)}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${connection.access_token}` } }
    );

    if (response.status === 404) {
      this.logger.debug({ draftId }, 'delete_draft: already gone, treating as done');
      return { draft_id: draftId, deleted: false, already_absent: true };
    }

    if (!response.ok) {
      const errorData = await response.text();
      this.logger.error({ status: response.status, errorData, draftId }, 'delete_draft failed');
      throw new Error(`Gmail draft delete failed: ${response.status} - ${errorData}`);
    }

    return { draft_id: draftId, deleted: true, already_absent: false };
  }

  private async sendDraft(connection: any, parameters: any): Promise<any> {
    const draftId: string = typeof parameters.draft_id === 'string' ? parameters.draft_id.trim() : '';
    if (!draftId) {
      throw new Error('draft_id is a required parameter');
    }

    this.logger.debug({ draftId }, 'send_draft: sending draft');

    const response = await fetch(`${this.gmailApisUrl}/users/me/drafts/send`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: draftId }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      this.logger.error({ status: response.status, errorData, draftId }, 'send_draft failed');
      throw new Error(`Gmail draft send failed: ${response.status} - ${errorData}`);
    }

    const result = await response.json();

    return {
      message_id: result.id,
      thread_id: result.threadId,
      draft_id: draftId,
      sent_at: new Date().toISOString(),
    };
  }

  /**
   * Batch add/remove labels across many messages (messages.batchModify).
   * - Hard-rejects empty and > 1000 ids BEFORE the fetch (CR-4; 1000 = Gmail max).
   * - Requires at least one of add_labels / remove_labels / archive.
   * - archive shorthand → removes the INBOX label (parity with modify_email).
   * - batchModify returns 204 No Content → does NOT call .json().
   * Idempotent (re-applying a label / removing an absent one is a Gmail no-op).
   */
  private async batchModifyMessages(connection: any, parameters: any): Promise<any> {
    const messageIds: unknown = parameters.message_ids;

    // In-executor hard guards (the real enforcement — rules.limits is inert).
    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      throw new Error('message_ids must be a non-empty array');
    }
    if (messageIds.length > 1000) {
      throw new Error(`too_many_ids: message_ids has ${messageIds.length} entries; the maximum per batch is 1000.`);
    }

    const addLabelNames: string[] = Array.isArray(parameters.add_labels) ? parameters.add_labels : [];
    const removeLabelNames: string[] = Array.isArray(parameters.remove_labels) ? parameters.remove_labels : [];
    const archive: boolean = parameters.archive === true;

    if (addLabelNames.length === 0 && removeLabelNames.length === 0 && !archive) {
      throw new Error('At least one of add_labels, remove_labels, or archive is required');
    }

    this.logger.debug(
      { count: messageIds.length, addLabelNames, removeLabelNames, archive },
      'batch_modify_emails: modifying messages'
    );

    // Resolve label names → ids (system labels pass through; custom resolved/created).
    const addLabelIds = await this.resolveLabelNames(connection, addLabelNames);
    const removeLabelIds = await this.resolveLabelNames(connection, removeLabelNames);

    // archive = remove the INBOX label (consistent with modify_email).
    if (archive && !removeLabelIds.includes('INBOX')) {
      removeLabelIds.push('INBOX');
    }

    const response = await fetch(`${this.gmailApisUrl}/users/me/messages/batchModify`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ids: messageIds,
        addLabelIds,
        removeLabelIds,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      this.logger.error({ status: response.status, errorData }, 'batch_modify_emails failed');
      throw new Error(`Gmail batch modify failed: ${response.status} - ${errorData}`);
    }

    // Success is 204 No Content — do NOT call response.json() (empty body).
    return {
      modified_count: messageIds.length,
      message_ids: messageIds,
      labels_added: addLabelIds,
      labels_removed: removeLabelIds,
      modified_at: new Date().toISOString(),
    };
  }

  // Private helper methods

  // Build RFC 2822 email message
  /**
   * WP-8: RFC 2047 MIME-encode a header value if it contains non-ASCII characters.
   * Returns the value unchanged if it's pure ASCII.
   * For email addresses with display names like "ברק מאירי <barak@example.com>",
   * only the display name part is encoded.
   */
  private mimeEncodeHeader(value: string): string {
    if (!/[^\x00-\x7F]/.test(value)) return value;

    // Check if it's an email address with display name: "Name <email>"
    const emailMatch = value.match(/^(.+?)\s*<([^>]+)>$/);
    if (emailMatch) {
      const displayName = emailMatch[1].replace(/^["']|["']$/g, ''); // Strip quotes
      const email = emailMatch[2];
      const encoded = Buffer.from(displayName, 'utf-8').toString('base64');
      return `=?UTF-8?B?${encoded}?= <${email}>`;
    }

    // Plain value (e.g., subject line)
    const encoded = Buffer.from(value, 'utf-8').toString('base64');
    return `=?UTF-8?B?${encoded}?=`;
  }

  /**
   * Build an RFC 2822 message and base64url-encode it (Gmail's format).
   *
   * @param parameters   { recipients, content } — same shape send_email/create_draft use.
   * @param extraHeaders Optional additive RFC822 headers (e.g. In-Reply-To / References
   *                     for reply_to_email) injected BEFORE the MIME-Version line. Defaults
   *                     to none so the existing sendEmail/createDraft call sites are
   *                     byte-for-byte unchanged (no reply headers leak into the send path).
   *                     Values run through mimeEncodeHeader to keep the single header code path.
   */
  private buildEmailMessage(parameters: any, extraHeaders?: Record<string, string>): string {
    const { recipients, content } = parameters;

    let message = '';

    // WP-42: tolerate LLM emitting a single-email string for to/cc/bcc instead of
    // the schema-declared array. Coerce string → [string], pass arrays through, and
    // handle comma-separated strings like "a@b.com, c@d.com".
    // Also flattens NESTED arrays (e.g. [["a@b.com"]]) — these arise when an
    // array-typed input is wrapped in a DSL array literal (`to: ["{{input.X}}"]`
    // where X is already an array). The old flat `.filter(typeof === 'string')`
    // silently dropped the inner array → empty `to` → Gmail 400 "Recipient address
    // required" (agent bb821b6b RCA, 2026-07-05). Recursively collect every string.
    const normalizeRecipients = (field: any): string[] => {
      const out: string[] = [];
      const walk = (v: any): void => {
        if (Array.isArray(v)) { v.forEach(walk); return; }
        if (typeof v === 'string') {
          for (const part of v.split(',')) {
            const s = part.trim();
            if (s) out.push(s);
          }
        }
      };
      walk(field);
      return out;
    };

    const toList = normalizeRecipients(recipients?.to);
    const ccList = normalizeRecipients(recipients?.cc);
    const bccList = normalizeRecipients(recipients?.bcc);

    // WP-8: All headers use mimeEncodeHeader for non-ASCII safety
    if (toList.length) {
      message += `To: ${toList.map((r) => this.mimeEncodeHeader(r)).join(', ')}\r\n`;
    }
    if (ccList.length) {
      message += `Cc: ${ccList.map((r) => this.mimeEncodeHeader(r)).join(', ')}\r\n`;
    }
    if (bccList.length) {
      message += `Bcc: ${bccList.map((r) => this.mimeEncodeHeader(r)).join(', ')}\r\n`;
    }
    if (content?.subject) {
      message += `Subject: ${this.mimeEncodeHeader(content.subject)}\r\n`;
    }

    // Additive threading/custom headers (In-Reply-To, References for reply_to_email).
    // Injected before MIME-Version so they sit with the other top-level headers.
    // Empty/undefined values are skipped; no callers pass this except replyToThread.
    if (extraHeaders) {
      for (const [name, value] of Object.entries(extraHeaders)) {
        if (typeof value === 'string' && value.length > 0) {
          message += `${name}: ${this.mimeEncodeHeader(value)}\r\n`;
        }
      }
    }

    // MIME headers + body.
    message += `MIME-Version: 1.0\r\n`;

    // D12: when HTML is present, send proper `multipart/alternative` (a text/plain
    // part AND a text/html part) instead of single-part text/html. Previously the
    // executor emitted single-part HTML and SILENTLY DISCARDED `content.body` — the
    // plaintext field exists in the plugin schema but was thrown away whenever HTML
    // was set. The plaintext part is `content.body` when the caller supplied a
    // non-empty one, else it is derived from the HTML via the shared htmlToText util
    // (this fallback is the branch that actually fires today, since V6 generation
    // only ever wires `html_body`). Parts are ordered least→most preferred per
    // RFC 2046 (plaintext first, HTML last) so capable clients render the HTML.
    if (content?.html_body) {
      const suppliedPlain = typeof content?.body === 'string' ? content.body.trim() : '';
      const plainPart = suppliedPlain || htmlToText(content.html_body);

      // Unique boundary that will not collide with body content.
      const boundary = `=_alt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;

      message += `Content-Type: multipart/alternative; boundary="${boundary}"\r\n`;
      message += '\r\n'; // Empty line between top-level headers and the first part.

      // text/plain part
      message += `--${boundary}\r\n`;
      message += `Content-Type: text/plain; charset=utf-8\r\n`;
      message += '\r\n';
      message += `${plainPart}\r\n`;

      // text/html part
      message += `--${boundary}\r\n`;
      message += `Content-Type: text/html; charset=utf-8\r\n`;
      message += '\r\n';
      message += `${content.html_body}\r\n`;

      // Closing boundary.
      message += `--${boundary}--\r\n`;
    } else {
      // Text-only path unchanged: single-part text/plain.
      message += `Content-Type: text/plain; charset=utf-8\r\n`;
      message += '\r\n'; // Empty line between headers and body
      if (content?.body) {
        message += content.body;
      }
    }

    // Base64url encode the message (Gmail's format)
    return Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  // Build Gmail search query
  private buildSearchQuery(parameters: any): string {
    let query = parameters.query || '';

    // Add folder filter
    if (parameters.folder && parameters.folder !== 'all') {
      if (query) query += ' ';
      query += `in:${parameters.folder}`;
    }

    // Default to inbox if no query provided
    if (!query) {
      query = 'in:inbox';
    }

    return query;
  }

  // Fetch detailed email information
  // contentLevel: 'metadata' (headers only), 'snippet' (headers + snippet), 'full' (complete body)
  private async fetchEmailDetail(
    accessToken: string,
    messageId: string,
    includeAttachments: boolean,
    contentLevel: 'metadata' | 'snippet' | 'full' = 'snippet',
    stripQuotedReply = false
  ): Promise<any> {
    // Determine Gmail API format based on content level
    // - 'metadata': Only fetch headers (fastest, no body/snippet in payload)
    // - 'snippet': Use 'metadata' format but Gmail always returns snippet in response
    // - 'full': Fetch complete message including body and attachments
    const needsFullFormat = contentLevel === 'full' || includeAttachments;
    const format = needsFullFormat ? 'full' : 'metadata';

    this.logger.debug({ messageId, contentLevel, format }, 'Fetching email detail');

    const response = await fetch(
      `${this.gmailApisUrl}/users/me/messages/${messageId}?format=${format}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch email details: ${response.status}`);
    }

    const email = await response.json();
    const headers = email.payload?.headers || [];

    const getHeader = (name: string) =>
      headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

    const emailInfo: any = {
      id: email.id,
      thread_id: email.threadId,
      subject: getHeader('Subject'),
      from: getHeader('From'),
      to: getHeader('To'),
      /*
       * REPLY-TO AND CC, which were not returned at all.
       *
       * On a notification email the `From` is the SYSTEM that sent it —
       * `info@`, `support@`, `forms@`, a WordPress host — and the human it is
       * about is somewhere else. Most form plugins set `Reply-To` to the
       * person who filled the form in, precisely so that hitting reply reaches
       * them; some CC them instead.
       *
       * Without these, anything reading mail had the body as its only source
       * for who wrote in, and a form that states the address only in its
       * headers was unreadable. They are two header lookups from data already
       * fetched, so there is no request cost.
       */
      reply_to: getHeader('Reply-To'),
      cc: getHeader('Cc'),
      /*
       * THE BARE ADDRESSES, beside the raw headers rather than instead of them.
       *
       * `From` is a header, not an address: it arrives as `"Dana Levi"
       * <dana@host>` about as often as it arrives bare. So anything that needed
       * to MATCH a sender — against `crm_contacts.email`, against
       * `email_sends.to_email` — could not, and anything that needed to WRITE
       * BACK had to hand a display name to a recipient field expecting an
       * address.
       *
       * The workarounds for that are both worse than this: parse the header in
       * every caller, or ask a model to pick the address out of the string.
       * The second is how a draft ends up addressed to a hallucinated client,
       * and it was the blocker for the mail receptionist agent.
       *
       * Raw headers are untouched — callers reading `from` for display keep
       * exactly what they had.
       */
      from_email: this.parseEmailAddress(getHeader('From')),
      reply_to_email: this.parseEmailAddress(getHeader('Reply-To')),
      date: getHeader('Date'),
      snippet: email.snippet || '', // Gmail always returns snippet regardless of format
      labels: email.labelIds || [],
    };

    // Only include body field if content_level is 'full'
    // This prevents sending large body data to LLM when not needed
    if (contentLevel === 'full') {
      const whole = email.payload ? this.extractEmailBody(email.payload) : '';
      emailInfo.body = stripQuotedReply ? stripQuotedThread(whole) : whole;
    }
    // Note: For 'metadata' and 'snippet' levels, body field is intentionally omitted
    // Use the 'snippet' field (~200 chars) for content matching/filtering

    // Only include attachments array if explicitly requested
    if (includeAttachments && email.payload) {
      emailInfo.attachments = await this.processEmailAttachments(email.payload, messageId, accessToken);
    }

    return emailInfo;
  }

  /**
   * The bare address out of an address header.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Handles the three shapes RFC 5322 actually delivers:
   *
   *   Dana Levi <dana@host>        the common one
   *   "Levi, Dana" <dana@host>     quoted, because the display name has a comma
   *   dana@host                    bare, no angle brackets at all
   *
   * ANGLE BRACKETS WIN WHEREVER THEY APPEAR, and that ordering is the whole
   * point rather than a stylistic choice: a quoted display name is allowed to
   * contain an @ ("admin@old-domain" <dana@host> is legal), so reaching for
   * the first @-looking token returns the DISPLAY NAME and a draft goes to the
   * wrong person. Taking what is inside the brackets first makes that
   * impossible.
   *
   * Only the FIRST address is returned. These headers may carry a list, and
   * every caller here wants one person to match or write to; returning a
   * comma-joined string that looks like an address but is not would be worse
   * than returning nothing.
   *
   * Returns '' rather than null for an absent or unparseable header, so a
   * caller interpolating it into a query gets an empty match instead of the
   * string "null" — which a search engine answers by returning everything.
   */
  private parseEmailAddress(header: string): string {
    if (!header) return '';

    const bracketed = header.match(/<([^<>]+)>/);
    if (bracketed) return bracketed[1].trim().toLowerCase();

    const first = header.split(',')[0].trim();
    /* No brackets, so the whole token must itself look like an address. An
       unquoted display name with no address ("Reception Desk") reaches here and
       must come back empty rather than being passed on as one. */
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(first) ? first.toLowerCase() : '';
  }

  // Extract email body text
  private extractEmailBody(payload: any): string {
    if (payload.parts) {
      // Multi-part email
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          return this.decodeBase64Url(part.body.data);
        }
        if (part.mimeType === 'text/html' && part.body?.data) {
          // Basic HTML to text conversion
          const html = this.decodeBase64Url(part.body.data);
          return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        }
        // Check nested parts
        if (part.parts) {
          const nestedText = this.extractEmailBody(part);
          if (nestedText) return nestedText;
        }
      }
    }

    // Simple email body
    if (payload.body?.data) {
      return this.decodeBase64Url(payload.body.data);
    }

    return '';
  }

  // Process email attachments
  private async processEmailAttachments(payload: any, messageId: string, accessToken: string): Promise<any[]> {
    const attachments: any[] = [];

    const processPayload = async (part: any) => {
      if (part.parts) {
        for (const subPart of part.parts) {
          await processPayload(subPart);
        }
      }

      if (part.filename && part.body?.attachmentId) {
        try {
          // Return attachment metadata with IDs needed for get_email_attachment action
          // Include BOTH snake_case (schema convention) and camelCase (legacy) for compatibility
          attachments.push({
            filename: part.filename,
            mimeType: part.mimeType,
            size: part.body.size || 0,
            // Primary format (snake_case to match schema parameter names)
            attachment_id: part.body.attachmentId,
            message_id: messageId,
            // Legacy format (camelCase for backward compatibility)
            attachmentId: part.body.attachmentId,
            messageId: messageId,
          });
        } catch (error) {
          this.logger.warn({ err: error, filename: part.filename }, 'Failed to process attachment');
        }
      }
    };

    await processPayload(payload);
    return attachments;
  }

  /**
   * Convert Gmail's base64url format to standard base64 format
   * Gmail uses base64url (- instead of +, _ instead of /) which is URL-safe
   * but incompatible with most other services that expect standard base64
   */
  private convertBase64UrlToBase64(base64url: string): string {
    // Replace URL-safe characters with standard base64 characters
    const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
    // Add padding if necessary (base64 must be multiple of 4)
    const padding = '='.repeat((4 - base64.length % 4) % 4);
    return base64 + padding;
  }

  /**
   * Decode base64url (Gmail's encoding) to text.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * UTF-8, NOT `atob`.
   *
   * `atob` yields a "binary string" — one character per BYTE — so every
   * non-ASCII character arrives as the individual bytes of its UTF-8 encoding,
   * each rendered as a separate Latin-1 character. A Hebrew body came back as
   * `×××©×× ××¦×¨ ×××ª× ×§×©×¨` instead of `שלום, נוצר איש קשר`, and the same
   * applies to Spanish accents, French, Arabic, emoji and smart quotes.
   *
   * This corrupts every agent that reads mail in any language but English, not
   * only the mailbox lead channel that found it: the text is what reaches the
   * LLM steps, the CRM, and anything matching on content. ASCII survived
   * unharmed, which is why it went unnoticed.
   *
   * `Buffer.from(…, 'base64')` keeps the bytes and `toString('utf8')` decodes
   * them properly. Mail that is genuinely not UTF-8 degrades to the same
   * replacement characters it would have anyway, rather than to mojibake.
   * ─────────────────────────────────────────────────────────────────────────
   */
  private decodeBase64Url(data: string): string {
    try {
      const base64 = this.convertBase64UrlToBase64(data);
      return Buffer.from(base64, 'base64').toString('utf8');
    } catch (error) {
      this.logger.warn({ err: error }, 'Failed to decode base64url');
      return '';
    }
  }

  // Override to handle Gmail-specific errors
  protected mapGoogleServiceSpecificError(error: any, commonErrors: Record<string, string>): string | null {
    // Check for Gmail-specific error codes or messages
    if (error.message?.includes('dailyLimitExceeded')) {
      return 'Gmail daily sending limit exceeded. Try again tomorrow.';
    }

    if (error.message?.includes('invalidRecipient')) {
      return commonErrors.invalid_recipient || 'Invalid email address format.';
    }

    if (error.message?.includes('messageTooLarge')) {
      return commonErrors.attachment_too_large || 'Message size exceeds Gmail limits.';
    }

    // Return null to fall back to common Google error handling
    return null;
  }

  protected async performConnectionTest(connection: any): Promise<any> {
    const response = await fetch(`${this.gmailApisUrl}/users/me/profile`, {
      headers: this.buildAuthHeader(connection.access_token)
    });

    const profile = await this.handleApiResponse(response, 'Gmail connection test');

    return {
      email: profile.emailAddress,
      total_messages: profile.messagesTotal,
      total_threads: profile.threadsTotal
    };
  }

  /**
   * List all Gmail labels for dynamic dropdown options
   * This method is called by the fetch-options API route
   */
  async list_labels(connection: any, options: { page?: number; limit?: number } = {}): Promise<Array<{value: string; label: string; description?: string; icon?: string; group?: string}>> {
    try {
      const response = await fetch(`${this.gmailApisUrl}/users/me/labels`, {
        headers: this.buildAuthHeader(connection.access_token)
      });

      const data = await this.handleApiResponse(response, 'list_labels');

      if (!data.labels || !Array.isArray(data.labels)) {
        return [];
      }

      // Transform to option format
      return data.labels.map((label: any) => {
        // Determine group based on label type
        let group = 'Custom Labels';
        if (label.type === 'system') {
          group = 'System Labels';
        } else if (label.type === 'user') {
          group = 'User Labels';
        }

        return {
          value: label.id,
          label: label.name,
          description: label.type === 'system' ? 'Built-in label' : undefined,
          icon: '🏷️',
          group,
        };
      });

    } catch (error: any) {
      this.logger.error({ err: error }, 'Error listing Gmail labels for options');
      throw error;
    }
  }
}