// lib/server/outlook-plugin-executor.ts
// Outlook plugin executor using Microsoft Graph API

import { BasePluginExecutor } from './base-plugin-executor';
import { UserPluginConnections } from './user-plugin-connections';
import { PluginManagerV2 } from './plugin-manager-v2';
import { createLogger } from '@/lib/logger';
import { htmlToText } from '@/lib/email/htmlToText';
import {
  CALENDAR_CHANGE_REFUSED_MESSAGE,
  CALENDAR_NOTICE_SUPPRESSED_MESSAGE,
  checkOutboundRecipients,
  isRecipientGuardOn,
  recipientsOf,
  refusalLogFields,
  RECIPIENT_REFUSED_MESSAGE,
  type OutboundRecipientVerdict,
} from '@/lib/email/recipientAllowList';

const logger = createLogger({ module: 'OutlookPluginExecutor', service: 'plugin-system' });
const pluginName = 'outlook';

/** Shown in a result when the event was written but nobody was invited (PROD-1b.2). */
const INVITATIONS_SUPPRESSED_NOTE =
  'Saved without attendees: this environment only sends calendar invitations to addresses on its allow-list.';
/** Shown in a result when nothing was written, because the write would email someone not on the list. */
const CHANGE_REFUSED_NOTE =
  "Not changed: an attendee is not on this environment's allow-list, and the change would email them.";

/** What a guarded update or delete needs to know about an event as it stands. */
interface GuardedEventSnapshot {
  /** Every address Graph could mail on a change; '' wherever one could not be read. */
  notifiable: string[];
  subject: string | null;
  start: string | null;
  end: string | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** `{ emailAddress: { address } }` gives the address; any other shape gives '' (refused by the check). */
function graphAddressOf(value: unknown): string {
  const address = asRecord(asRecord(value).emailAddress).address;
  return typeof address === 'string' ? address : '';
}

/** `{ dateTime }` gives the string; any other shape gives null. */
function graphDateTimeOf(value: unknown): string | null {
  const dateTime = asRecord(value).dateTime;
  return typeof dateTime === 'string' ? dateTime : null;
}

/**
 * Everyone Graph could mail when this event changes or is deleted (PROD-1b.2,
 * SA condition 1). It fails closed on the SHAPE of the read, not only on each
 * address: a missing or non-array `attendees` is one unparseable recipient,
 * never "no attendees", and unless `isOrganizer` is exactly `true` the
 * organizer counts too (SA D-6). So an empty body, which is what a 204 gives,
 * can never mean "nobody to email".
 */
function notifiableOf(event: unknown): string[] {
  const body = asRecord(event);
  const out: string[] = Array.isArray(body.attendees) ? body.attendees.map(graphAddressOf) : [''];
  if (body.isOrganizer !== true) out.push(graphAddressOf(body.organizer));
  return out;
}

export class OutlookPluginExecutor extends BasePluginExecutor {
  private graphBaseUrl = 'https://graph.microsoft.com/v1.0';

  constructor(userConnections: UserPluginConnections, pluginManager: PluginManagerV2) {
    super(pluginName, userConnections, pluginManager);
  }

  protected async executeSpecificAction(
    connection: any,
    actionName: string,
    parameters: any
  ): Promise<any> {
    logger.debug({ actionName, params: parameters }, 'Executing Outlook action');

    switch (actionName) {
      case 'send_email':
        return await this.sendEmail(connection, parameters);
      case 'search_emails':
        return await this.searchEmails(connection, parameters);
      case 'create_draft':
        return await this.createDraft(connection, parameters);
      case 'modify_message':
        return await this.modifyMessage(connection, parameters);
      case 'get_email_attachment':
        return await this.getEmailAttachment(connection, parameters);
      case 'list_events':
        return await this.listEvents(connection, parameters);
      case 'create_event':
        return await this.createEvent(connection, parameters);
      case 'update_event':
        return await this.updateEvent(connection, parameters);
      case 'delete_event':
        return await this.deleteEvent(connection, parameters);
      case 'get_event_details':
        return await this.getEventDetails(connection, parameters);
      default:
        throw new Error(`Unsupported Outlook action: ${actionName}`);
    }
  }

  // === EMAIL ACTIONS ===

  private async sendEmail(connection: any, params: any): Promise<any> {
    const { to, subject, body, cc, bcc, importance = 'normal' } = params;

    /*
     * PROD-1b (A7): the recipient guard, on to, cc and bcc, before any Graph
     * call. A refusal is success-shaped like the Gmail executor's (SA D-5) and
     * logged with counts only. Calendar meeting requests are guarded in the
     * calendar actions below (PROD-1b.2).
     */
    const verdict = checkOutboundRecipients(recipientsOf(to, cc, bcc));
    if (!verdict.allowed) {
      logger.warn({ action: 'send_email', ...refusalLogFields(verdict) }, RECIPIENT_REFUSED_MESSAGE);
      return {
        message_id: null,
        sent_at: null,
        status: 'not_sent',
        allowlist_suppressed: true,
        note: 'Not sent: this environment only sends email to addresses on its allow-list.',
      };
    }

    // D12 (deferred, secondary): Graph's simple message model exposes a SINGLE body
    // with one `contentType` and does not accept a parallel plaintext alternative, so
    // this send is HTML-only (no true multipart/alternative). The only way to emit a
    // real multipart/alternative via Graph is to build a full raw-MIME message and POST
    // it to `/me/sendMail` as base64 with `Content-Type: text/plain` — a materially
    // different send shape from the JSON message model below. That is a deferred
    // follow-up: the Gmail plugin (raw-MIME) is the D12 primary fix; Graph HTML renders
    // acceptably in Outlook/Graph clients. See the D12 workplan for the decision.
    const message = {
      subject,
      body: {
        contentType: 'HTML',
        content: body || ''
      },
      toRecipients: to.map((email: string) => ({
        emailAddress: { address: email }
      })),
      ...(cc && { ccRecipients: cc.map((email: string) => ({ emailAddress: { address: email } })) }),
      ...(bcc && { bccRecipients: bcc.map((email: string) => ({ emailAddress: { address: email } })) }),
      importance
    };

    const response = await this.makeGraphRequest(
      connection,
      '/me/sendMail',
      'POST',
      { message, saveToSentItems: true }
    );

    return {
      message_id: 'sent', // Graph API sendMail doesn't return message ID
      sent_at: new Date().toISOString(),
      status: 'sent'
    };
  }

  /**
   * A single-quoted OData string literal.
   *
   * Graph escapes a quote by doubling it, and a sender address or subject
   * prefix is attacker-reachable text — it comes off a message somebody else
   * sent. Without this, one apostrophe terminates the literal and the rest of
   * the value is parsed as filter syntax.
   */
  private odataString(value: string): string {
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  private async searchEmails(connection: any, params: any): Promise<any> {
    const {
      query,
      folder = 'inbox',
      max_results = 20,
      from_date,
      to_date,
      has_attachments,
      // Added 2026-10-25 for the mailbox lead channel — see the note below.
      is_unread,
      from_address,
      subject_prefix,
      content_level = 'metadata',
      // Added for the reply-drafting agent — see the note below.
      within_days,
      to_address,
      // Added so the agent can skip what it has already marked — see the note below.
      exclude_categories,
    } = params;

    // Build OData filter
    const filter: string[] = [];

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * A RELATIVE WINDOW, AND A RECIPIENT FILTER
     *
     * Added for the reply-drafting agent, which reads the same mailbox on
     * either provider and could express neither of these here.
     *
     * `within_days` is the counterpart of Gmail's `newer_than:Nd`. The agent's
     * scan window is derived from its own cadence, so it arrives as a NUMBER OF
     * DAYS and nothing in the plan can turn that into a date: `{"$date":…}` is
     * a BizQL construct that only the business-os filter compiler understands,
     * and the pilot has no date arithmetic. Without this the only honest
     * Outlook query was "the newest 50", which reaches back months on a quiet
     * mailbox and re-reads the same morning's mail on a busy one.
     *
     * `to_address` asks "was this addressed to them", which `from_address`
     * cannot answer and which the sent and drafts folders are entirely about —
     * in both, the sender is the owner. It is what lets the agent see whether
     * it has already written to somebody.
     *
     * Both are `$filter` for the reason the block below records: Graph refuses
     * a messages request carrying `$search` as well.
     * ─────────────────────────────────────────────────────────────────────────
     */
    /*
     * COERCED, NOT TYPE-CHECKED. The declared type is a number, and every value
     * the pilot interpolates into a param is a STRING — `{{input.scan_days}}`
     * arrives as "2". A `typeof === 'number'` test would reject it silently and
     * the agent would scan the whole mailbox while reporting nothing wrong,
     * which is the worst of the available failures.
     */
    const withinDays = Number(within_days);
    if (Number.isFinite(withinDays) && withinDays > 0) {
      const since = new Date(Date.now() - withinDays * 24 * 60 * 60 * 1000);
      filter.push(`receivedDateTime ge ${since.toISOString()}`);
    }
    if (to_address) {
      filter.push(`toRecipients/any(r:r/emailAddress/address eq ${this.odataString(to_address)})`);
    }

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * SKIP WHAT WE HAVE ALREADY JUDGED — the counterpart of Gmail's
     * `-label:"AgentPilot/Seen"`.
     *
     * `modify_message` can now write a category, which is the only mark
     * Outlook offers that is both visible to the owner and safe to filter on.
     * Writing one is useless without this: the agent would mark a message and
     * then read it again on the next overlap anyway, and re-judging a message
     * costs a model call.
     *
     * `not(categories/any(...))` is the OData form, and it is the reason this
     * is a `$filter` rather than a `$search` — the block below records that
     * Graph refuses a messages request carrying both.
     *
     * A message with NO categories satisfies this: `any` over an empty
     * collection is false, so `not(false)` is true. That is what makes it safe
     * to add to a mailbox where nothing is marked yet — it removes messages
     * from the scan and can never remove one that carries no category.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const excluded = (Array.isArray(exclude_categories) ? exclude_categories : exclude_categories ? [exclude_categories] : [])
      .map((c: unknown) => String(c).trim())
      .filter((c: string) => c.length > 0);
    for (const category of excluded) {
      filter.push(`not(categories/any(c:c eq ${this.odataString(category)}))`);
    }

    if (from_date) {
      filter.push(`receivedDateTime ge ${new Date(from_date).toISOString()}`);
    }
    if (to_date) {
      filter.push(`receivedDateTime le ${new Date(to_date).toISOString()}`);
    }
    if (has_attachments !== undefined) {
      filter.push(`hasAttachments eq ${has_attachments}`);
    }

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE THREE THINGS A LEAD CHANNEL NEEDS, AND WHY THEY ARE FILTERS
     *
     * Added for the mailbox lead channel, which reads the enquiry emails a
     * business's own website form sends it. That channel needs to ask for
     * "unread mail from this sender whose subject starts like this", and
     * before this it could ask for none of the three:
     *
     *   · there was no unread filter at all, so the agent would re-read and
     *     re-file the same enquiry on every run — the whole idempotency of
     *     the channel is "unread, then marked read"
     *   · there was no sender filter except free-text `$search`
     *   · `$select` named `bodyPreview` and never `body`, so the enquiry's
     *     own text — the name, address and message — was truncated at ~255
     *     characters with no way to ask for the rest
     *
     * All three are expressed as `$filter`, not `$search`, because Graph
     * REJECTS a messages request carrying both: the previous code appended
     * `$search` on top of any date filter, so `from_date` plus a query was
     * already a guaranteed 400. `$search` is now used only when nothing else
     * narrows the request.
     * ─────────────────────────────────────────────────────────────────────────
     */
    if (is_unread !== undefined) {
      filter.push(`isRead eq ${is_unread ? 'false' : 'true'}`);
    }
    if (from_address) {
      filter.push(`from/emailAddress/address eq ${this.odataString(from_address)}`);
    }
    if (subject_prefix) {
      filter.push(`startswith(subject,${this.odataString(subject_prefix)})`);
    }

    // Build folder path
    const folderMap: Record<string, string> = {
      inbox: 'inbox',
      sentitems: 'sentitems',
      drafts: 'drafts',
      deleteditems: 'deleteditems'
    };
    const folderName = folderMap[folder] || 'inbox';

    /* `body` only when asked for. It is the largest field on a message and
       most callers want a list, not ten full messages. */
    const select = [
      'id',
      'subject',
      'from',
      'toRecipients',
      'receivedDateTime',
      'bodyPreview',
      'hasAttachments',
      /* The human the notification is ABOUT. See the note in the Gmail
         executor: `from` is the system that sent it, and most form plugins put
         the person who filled the form in here. */
      'replyTo',
      'ccRecipients',
      ...(content_level === 'full' ? ['body', 'isRead'] : []),
    ].join(',');

    // Build request URL
    let url = `/me/mailFolders/${folderName}/messages?$top=${max_results}&$select=${select}`;

    if (filter.length > 0) {
      url += `&$filter=${filter.join(' and ')}`;
    }

    /*
     * `$search` is mutually exclusive with `$filter` on Graph's message
     * collection. A caller that passes both gets the filter, which is the
     * precise one — silently dropping a free-text hint beats a 400 that drops
     * the whole request.
     */
    if (query && filter.length === 0) {
      url += `&$search="${query}"`;
    }

    const response = await this.makeGraphRequest(connection, url, 'GET');

    const emails = response.value.map((msg: any) => ({
      id: msg.id,
      subject: msg.subject,
      from: msg.from?.emailAddress?.address,
      /*
       * THE SAME FIELD NAME GMAIL USES, so one plan can read either mailbox.
       *
       * An alias here, and a parse there. Graph hands back a structured
       * address, so `from` above is already bare — while Gmail reads MIME
       * headers and returns `"Dana Levi" <dana@host>`, which is why its
       * executor has a parser. The raw-header problem is Gmail's alone.
       *
       * Without the alias, `from_email` would mean "the bare address" on one
       * provider and be undefined on the other, so a plan referencing it would
       * work against Gmail and silently match nothing against Outlook — an
       * agent that finds no clients and reports no error. One name, one
       * meaning, whatever the mailbox.
       *
       * Lowercased for the same reason Gmail's is: this value is matched
       * against `email_sends.to_email` and `crm_contacts.email`, and one person
       * has to be one key.
       */
      from_email: (msg.from?.emailAddress?.address ?? '').toLowerCase(),
      to: msg.toRecipients?.map((r: any) => r.emailAddress.address) || [],
      received_at: msg.receivedDateTime,
      body_preview: msg.bodyPreview,
      has_attachments: msg.hasAttachments,
      reply_to: (msg.replyTo ?? []).map((r: any) => r.emailAddress?.address).filter(Boolean).join(', '),
      cc: (msg.ccRecipients ?? []).map((r: any) => r.emailAddress?.address).filter(Boolean).join(', '),
      /*
       * Graph returns one body with a `contentType` of 'html' or 'text', never
       * both. `html` is reported ONLY when the message really was HTML, so a
       * reader can tell markup from text rather than having to sniff it — the
       * mistake that made every learned field label come back as an HTML
       * attribute on the Gmail side.
       *
       * `body` IS ALWAYS THE READABLE TEXT, which it was not before.
       *
       * It used to be present only for a plaintext message, and almost no real
       * business email is plaintext — so a plan asking for `body` got `null`
       * from Outlook and the full text from Gmail. For the reply-drafting agent
       * that is not an empty field but a wrong decision: its prompt is told to
       * escalate anything it cannot read, so every Outlook message would have
       * been handed to the owner as unreadable while the same mailbox on Gmail
       * answered fine. Derived with the same shared converter the send paths
       * use, so one message cannot read two ways.
       */
      ...(msg.body?.contentType?.toLowerCase() === 'html'
        ? { html: msg.body?.content ?? null, body: htmlToText(msg.body?.content ?? '') }
        : { body: msg.body?.content ?? null }),
    }));

    return {
      emails,
      email_count: emails.length,
      /*
       * THE NAME GMAIL USES, for the reason `from_email` above is aliased: a
       * plan that gates on how many messages came back should read the same key
       * whichever mailbox answered. `email_count` stays, because callers
       * written before this one read it.
       */
      total_found: emails.length,
      searched_at: new Date().toISOString()
    };
  }

  /**
   * A draft, and optionally a draft that belongs to a conversation.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * `reply_to_message_id` GOES THROUGH A DIFFERENT DOOR, and has to.
   *
   * Gmail threads a draft by handing `messages.create` a `threadId` and the
   * `In-Reply-To` / `References` headers worked out from the original. Graph
   * exposes none of that on `/me/messages`: there is no threading field to set,
   * so a draft POSTed there is a new conversation whatever its subject says.
   *
   * What Graph has instead is `createReply`, which makes the draft FROM the
   * original — already in the conversation, already addressed to the sender,
   * already subjected `Re:` once, with the quoted original beneath. The owner's
   * words go in as `comment`, which Graph places above that quote: exactly
   * where a person writes a reply.
   *
   * So the two providers reach the same place by opposite routes — Gmail builds
   * the reply and says which conversation it joins, Graph is asked for a reply
   * to a message and fills the rest in. The AGENT sees one behaviour, which is
   * the only thing that matters to it: supply the id and the draft lands inside
   * the client's own thread.
   *
   * Absent, everything below is the plain draft it always was. No existing
   * caller passes it.
   * ───────────────────────────────────────────────────────────────────────────
   */
  private async createDraft(connection: any, params: any): Promise<any> {
    const { to, subject, body, cc, bcc } = params;

    if (params.reply_to_message_id) {
      return await this.createThreadedDraft(connection, params);
    }

    const message = {
      subject,
      body: {
        contentType: 'HTML',
        content: body || ''
      },
      ...(to && { toRecipients: to.map((email: string) => ({ emailAddress: { address: email } })) }),
      ...(cc && { ccRecipients: cc.map((email: string) => ({ emailAddress: { address: email } })) }),
      ...(bcc && { bccRecipients: bcc.map((email: string) => ({ emailAddress: { address: email } })) })
    };

    const response = await this.makeGraphRequest(
      connection,
      '/me/messages',
      'POST',
      message
    );

    return {
      message_id: response.id,
      created_at: response.createdDateTime,
      web_link: response.webLink,
      thread_id: response.conversationId ?? null
    };
  }

  /**
   * The threaded half of `create_draft` — see its header for why Graph needs
   * its own route.
   */
  private async createThreadedDraft(connection: any, params: any): Promise<any> {
    const replyTo = String(params.reply_to_message_id);

    /*
     * PLAIN TEXT INTO AN HTML BODY, which is why the newlines are converted.
     *
     * A model writes a reply as paragraphs separated by blank lines. Graph puts
     * `comment` into an HTML body, where every one of those line breaks
     * collapses and the reply arrives as a single unbroken block — correct text,
     * unreadable letter. Escaping comes first, in that order: escape then
     * convert, or the `<br>` we just inserted is escaped into visible markup.
     */
    const comment = String(params.body ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\r\n|\r|\n/g, '<br>');

    /*
     * Recipients are passed only when stated. `createReply` already addresses
     * the sender of the original, which is almost always right and is right
     * here; overriding it with an empty array would address nobody.
     */
    const message: any = {};
    if (Array.isArray(params.to) && params.to.length > 0) {
      message.toRecipients = params.to.map((email: string) => ({ emailAddress: { address: email } }));
    }
    if (Array.isArray(params.cc) && params.cc.length > 0) {
      message.ccRecipients = params.cc.map((email: string) => ({ emailAddress: { address: email } }));
    }
    if (Array.isArray(params.bcc) && params.bcc.length > 0) {
      message.bccRecipients = params.bcc.map((email: string) => ({ emailAddress: { address: email } }));
    }

    const response = await this.makeGraphRequest(
      connection,
      `/me/messages/${encodeURIComponent(replyTo)}/createReply`,
      'POST',
      Object.keys(message).length > 0 ? { message, comment } : { comment }
    );

    return {
      message_id: response.id,
      created_at: response.createdDateTime,
      web_link: response.webLink,
      thread_id: response.conversationId ?? null,
      /*
       * The subject Graph chose, not the one asked for. `createReply` derives
       * it from the original, so the `subject` param is deliberately ignored on
       * this path — reporting the ignored one back would describe a draft that
       * does not exist.
       */
      subject: response.subject ?? null,
      in_reply_to: replyTo
    };
  }

  private async modifyMessage(connection: any, params: any): Promise<any> {
    const { message_id, is_read, folder, importance, add_categories } = params;

    const updates: any = {};

    if (is_read !== undefined) {
      updates.isRead = is_read;
    }
    if (importance) {
      updates.importance = importance;
    }

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * CATEGORIES: OUTLOOK'S ANSWER TO A GMAIL LABEL.
     *
     * The reply-drafting agent marks every message it has judged, so the next
     * scan can skip it — without a mark, the same classification is paid for
     * again on the ten-minute overlap, on a manual run, and on every attempt
     * of a failed run. On Gmail that mark is a label. Outlook has no labels,
     * and this action offered only read state, a folder move and an importance
     * flag: moving a client's mail is far heavier than tagging it, and read
     * state is not a safe scan filter because the OWNER also reads their mail.
     *
     * Graph has carried `categories` on a message all along; nothing here
     * exposed it.
     *
     * READ, MERGE, THEN WRITE — and that is not optional. A PATCH of
     * `categories` REPLACES the array, so writing `['AgentPilot/Seen']`
     * straight out would silently delete every category the owner had put on
     * that message by hand. So the current list is fetched first and the new
     * values are added to it, and a category already present is not written
     * twice.
     *
     * The extra GET is skipped entirely unless a caller asks for a category,
     * so no existing call pays for it.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const wanted = (Array.isArray(add_categories) ? add_categories : add_categories ? [add_categories] : [])
      .map((c: unknown) => String(c).trim())
      .filter((c: string) => c.length > 0);

    if (wanted.length > 0) {
      const current = await this.makeGraphRequest(
        connection,
        `/me/messages/${message_id}?$select=categories`,
        'GET'
      );
      const existing: string[] = Array.isArray(current?.categories) ? current.categories : [];
      const merged = [...existing];
      for (const category of wanted) {
        if (!merged.some(c => String(c).toLowerCase() === category.toLowerCase())) {
          merged.push(category);
        }
      }
      /* Nothing to write when the owner, or an earlier run, already set them. */
      if (merged.length !== existing.length) {
        updates.categories = merged;
      }
    }

    /*
     * NOTHING TO CHANGE IS NOT A REASON TO WRITE. A caller asking only for a
     * category that is already on the message leaves `updates` empty, and a
     * PATCH with an empty body is a request that can only fail or do nothing.
     * Read the message instead, so the return shape is the same either way.
     */
    const response = Object.keys(updates).length > 0
      ? await this.makeGraphRequest(
          connection,
          `/me/messages/${message_id}`,
          'PATCH',
          updates
        )
      : await this.makeGraphRequest(
          connection,
          `/me/messages/${message_id}?$select=id,isRead`,
          'GET'
        );

    // Handle folder move if specified
    if (folder) {
      const folderMap: Record<string, string> = {
        inbox: 'inbox',
        sentitems: 'sentitems',
        drafts: 'drafts',
        deleteditems: 'deleteditems'
      };
      const targetFolder = folderMap[folder];

      await this.makeGraphRequest(
        connection,
        `/me/messages/${message_id}/move`,
        'POST',
        { destinationId: targetFolder }
      );
    }

    return {
      message_id: response.id,
      is_read: response.isRead,
      updated_at: new Date().toISOString()
    };
  }

  private async getEmailAttachment(connection: any, params: any): Promise<any> {
    const { message_id, attachment_id } = params;

    if (attachment_id) {
      // Get specific attachment
      const attachment = await this.makeGraphRequest(
        connection,
        `/me/messages/${message_id}/attachments/${attachment_id}`,
        'GET'
      );

      return {
        attachments: [{
          attachment_id: attachment.id,
          filename: attachment.name,
          content_type: attachment.contentType,
          size: attachment.size,
          content: attachment.contentBytes
        }],
        attachment_count: 1
      };
    } else {
      // Get all attachments
      const response = await this.makeGraphRequest(
        connection,
        `/me/messages/${message_id}/attachments`,
        'GET'
      );

      const attachments = response.value.map((att: any) => ({
        attachment_id: att.id,
        filename: att.name,
        content_type: att.contentType,
        size: att.size,
        content: att.contentBytes
      }));

      return {
        attachments,
        attachment_count: attachments.length
      };
    }
  }

  // === CALENDAR ACTIONS ===

  private async listEvents(connection: any, params: any): Promise<any> {
    const {
      start_date = new Date().toISOString(),
      end_date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      max_results = 50,
      calendar_id
    } = params;

    const calendarPath = calendar_id ? `/me/calendars/${calendar_id}` : '/me/calendar';

    // Request times in UTC using Prefer header
    const url = `${calendarPath}/calendarView?startDateTime=${start_date}&endDateTime=${end_date}&$top=${max_results}&$select=id,subject,start,end,location,attendees,organizer`;

    const response = await this.makeGraphRequestWithPrefer(connection, url, 'GET', undefined, 'outlook.timezone="UTC"');

    const events = response.value.map((evt: any) => {
      // Convert dateTime to proper ISO format with Z suffix for UTC
      const startDateTime = evt.start.dateTime;
      const endDateTime = evt.end.dateTime;

      // Ensure times are in ISO format with Z suffix (UTC)
      const startISO = startDateTime.endsWith('Z') ? startDateTime : `${startDateTime.split('.')[0]}Z`;
      const endISO = endDateTime.endsWith('Z') ? endDateTime : `${endDateTime.split('.')[0]}Z`;

      return {
        id: evt.id,
        subject: evt.subject,
        start: startISO,
        end: endISO,
        location: evt.location?.displayName,
        attendees: evt.attendees?.map((a: any) => a.emailAddress.address) || [],
        organizer: evt.organizer?.emailAddress?.address
      };
    });

    return {
      events,
      event_count: events.length,
      retrieved_at: new Date().toISOString()
    };
  }

  private async createEvent(connection: any, params: any): Promise<any> {
    const {
      subject,
      start,
      end,
      location,
      attendees,
      body,
      is_online_meeting = false,
      reminder_minutes = 15
    } = params;

    /*
     * PROD-1b.2 (E-9a): Graph emails a meeting request to every attendee of a
     * new event, and has no flag to stop it. So when any attendee is refused,
     * the event is still written to the owner's calendar but with NO
     * attendees: the invitation goes to everyone on it or to no one (PROD-1b
     * D-2), and the owner's entry is still made (as Google's E-8 does).
     */
    let invitationsSuppressed = false;
    if (Array.isArray(attendees) && attendees.length > 0) {
      const inviteVerdict = checkOutboundRecipients(recipientsOf(attendees));
      if (!inviteVerdict.allowed) {
        invitationsSuppressed = true;
        logger.info({ action: 'create_event', ...refusalLogFields(inviteVerdict) }, CALENDAR_NOTICE_SUPPRESSED_MESSAGE);
      }
    }

    const event = {
      subject,
      start: {
        dateTime: start,
        timeZone: 'UTC'
      },
      end: {
        dateTime: end,
        timeZone: 'UTC'
      },
      ...(location && { location: { displayName: location } }),
      ...(body && { body: { contentType: 'HTML', content: body } }),
      ...(attendees && !invitationsSuppressed && {
        attendees: attendees.map((email: string) => ({
          emailAddress: { address: email },
          type: 'required'
        }))
      }),
      isOnlineMeeting: is_online_meeting,
      reminderMinutesBeforeStart: reminder_minutes
    };

    const response = await this.makeGraphRequest(
      connection,
      '/me/events',
      'POST',
      event
    );

    return {
      id: response.id,
      subject: response.subject,
      start: response.start.dateTime,
      end: response.end.dateTime,
      web_link: response.webLink,
      ...(is_online_meeting && response.onlineMeeting && {
        online_meeting_url: response.onlineMeeting.joinUrl
      }),
      created_at: new Date().toISOString(),
      ...(invitationsSuppressed && { invitations_suppressed: true, note: INVITATIONS_SUPPRESSED_NOTE })
    };
  }

  /**
   * The event as it stands, for a guarded update or delete (PROD-1b.2). Any
   * failure throws through `makeGraphRequest`'s own mapping, so the caller
   * writes nothing (SA D-5). Read as `unknown` and narrowed (SA condition 1).
   */
  private async readEventForGuard(connection: unknown, eventId: string): Promise<GuardedEventSnapshot> {
    const event: unknown = await this.makeGraphRequest(
      connection,
      `/me/events/${eventId}?$select=attendees,organizer,isOrganizer,subject,start,end`,
      'GET'
    );
    const body = asRecord(event);
    return {
      notifiable: notifiableOf(event),
      subject: typeof body.subject === 'string' ? body.subject : null,
      start: graphDateTimeOf(body.start),
      end: graphDateTimeOf(body.end),
    };
  }

  /** The result and log line of an update or delete that was not made. Counts only, no address. */
  private changeRefused(
    action: 'update_event' | 'delete_event',
    verdict: Extract<OutboundRecipientVerdict, { allowed: false }>
  ): { allowlist_suppressed: true; note: string } {
    logger.warn({ action, ...refusalLogFields(verdict) }, CALENDAR_CHANGE_REFUSED_MESSAGE);
    return { allowlist_suppressed: true, note: CHANGE_REFUSED_NOTE };
  }

  private async updateEvent(connection: any, params: any): Promise<any> {
    const { event_id, subject, start, end, location, attendees, body } = params;

    const updates: any = {};

    if (subject) updates.subject = subject;
    if (start) updates.start = { dateTime: start, timeZone: 'UTC' };
    if (end) updates.end = { dateTime: end, timeZone: 'UTC' };
    if (location) updates.location = { displayName: location };
    if (body) updates.body = { contentType: 'HTML', content: body };
    if (attendees) {
      updates.attendees = attendees.map((email: string) => ({
        emailAddress: { address: email },
        type: 'required'
      }));
    }

    /*
     * PROD-1b.2 (E-9b). Any change to a meeting can email the people already
     * on it, and removing one emails them a cancellation, so the event is read
     * first (guard on only; production with the list unset makes no extra
     * call):
     *  - someone already on it is refused: nothing is changed;
     *  - only the new attendees are refused: the attendee change is dropped
     *    and the rest applies (SA D-3), unless nothing else was asked for, in
     *    which case nothing was done (SA condition 3).
     */
    let invitationsSuppressed = false;
    if (isRecipientGuardOn()) {
      const current = await this.readEventForGuard(connection, event_id);
      const notUpdated = () => ({
        id: event_id,
        subject: current.subject,
        start: current.start,
        end: current.end,
        updated_at: null,
        status: 'not_updated',
      });

      if (current.notifiable.length > 0) {
        const existingVerdict = checkOutboundRecipients(recipientsOf(current.notifiable));
        if (!existingVerdict.allowed) return { ...notUpdated(), ...this.changeRefused('update_event', existingVerdict) };
      }

      if (Array.isArray(attendees) && attendees.length > 0) {
        const addedVerdict = checkOutboundRecipients(recipientsOf(attendees));
        if (!addedVerdict.allowed) {
          delete updates.attendees;
          if (Object.keys(updates).length === 0) {
            return { ...notUpdated(), ...this.changeRefused('update_event', addedVerdict) };
          }
          invitationsSuppressed = true;
          logger.info({ action: 'update_event', ...refusalLogFields(addedVerdict) }, CALENDAR_NOTICE_SUPPRESSED_MESSAGE);
        }
      }
    }

    const response = await this.makeGraphRequest(
      connection,
      `/me/events/${event_id}`,
      'PATCH',
      updates
    );

    return {
      id: response.id,
      subject: response.subject,
      start: response.start.dateTime,
      end: response.end.dateTime,
      updated_at: new Date().toISOString(),
      ...(invitationsSuppressed && { invitations_suppressed: true, note: INVITATIONS_SUPPRESSED_NOTE })
    };
  }

  private async deleteEvent(connection: any, params: any): Promise<any> {
    const { event_id } = params;

    /*
     * PROD-1b.2 (E-9c): deleting a meeting emails its attendees a
     * cancellation, and Graph has no silent delete. So the event is read first
     * (guard on only), and when anyone Graph could mail is refused, the event
     * is left in place and the result says so.
     */
    if (isRecipientGuardOn()) {
      const current = await this.readEventForGuard(connection, event_id);
      if (current.notifiable.length > 0) {
        const deleteVerdict = checkOutboundRecipients(recipientsOf(current.notifiable));
        if (!deleteVerdict.allowed) {
          return { event_id, deleted_at: null, status: 'not_deleted', ...this.changeRefused('delete_event', deleteVerdict) };
        }
      }
    }

    await this.makeGraphRequest(
      connection,
      `/me/events/${event_id}`,
      'DELETE'
    );

    return {
      event_id,
      deleted_at: new Date().toISOString(),
      status: 'deleted'
    };
  }

  private async getEventDetails(connection: any, params: any): Promise<any> {
    const { event_id } = params;

    const response = await this.makeGraphRequest(
      connection,
      `/me/events/${event_id}?$select=id,subject,start,end,location,body,attendees,organizer,onlineMeeting`,
      'GET'
    );

    return {
      id: response.id,
      subject: response.subject,
      start: response.start.dateTime,
      end: response.end.dateTime,
      location: response.location?.displayName,
      body: response.body?.content,
      attendees: response.attendees?.map((a: any) => ({
        email: a.emailAddress.address,
        name: a.emailAddress.name,
        response: a.status.response
      })) || [],
      organizer: {
        email: response.organizer?.emailAddress?.address,
        name: response.organizer?.emailAddress?.name
      },
      ...(response.onlineMeeting && {
        online_meeting_url: response.onlineMeeting.joinUrl
      }),
      retrieved_at: new Date().toISOString()
    };
  }

  // === HELPER METHODS ===

  /**
   * Graph request variant that attaches a `Prefer` header (e.g.
   * `outlook.timezone="UTC"` so calendarView returns start/end times in UTC).
   * Thin wrapper over makeGraphRequest to keep a single request implementation.
   */
  private async makeGraphRequestWithPrefer(
    connection: any,
    endpoint: string,
    method: string = 'GET',
    body: any,
    prefer: string
  ): Promise<any> {
    return this.makeGraphRequest(connection, endpoint, method, body, prefer);
  }

  private async makeGraphRequest(
    connection: any,
    endpoint: string,
    method: string = 'GET',
    body?: any,
    prefer?: string
  ): Promise<any> {
    const url = endpoint.startsWith('http') ? endpoint : `${this.graphBaseUrl}${endpoint}`;

    const options: RequestInit = {
      method,
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(prefer && { 'Prefer': prefer })
      },
      ...(body && { body: JSON.stringify(body) })
    };

    logger.debug({ url, method }, 'Making Graph API request');

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, errorText }, 'Graph API request failed');

      // Map common errors to user-friendly messages
      if (response.status === 401) {
        throw new Error('auth_failed');
      } else if (response.status === 404) {
        throw new Error('not_found');
      } else if (response.status === 403) {
        throw new Error('insufficient_permissions');
      } else if (response.status === 429) {
        throw new Error('quota_exceeded');
      }

      throw new Error(`Graph API error: ${response.status} - ${errorText}`);
    }

    // DELETE requests may return 204 No Content
    if (response.status === 204) {
      return {};
    }

    return await response.json();
  }
}
