/**
 * File an enquiry as a contact, the way the website's own form files one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A FUNCTION AND NOT SIXTY LINES IN A ROUTE
 *
 * "Create the contact like the contact form does" turns out not to be one
 * insert. It is three decisions, and each has already been got wrong once:
 *
 *   · the STAGE comes from the owner's own pipeline, never the literal
 *     `'lead'`. `CRMPipelineStagesRepository.firstStageKey` owns that rule
 *     because the inline version was one of eight copies, and `'lead'` is a
 *     stage many boards do not contain — which put real contacts in no column
 *     at all.
 *   · an enquiry from somebody already known is an UPDATE, and it writes
 *     `last_website_message`, while a first one writes
 *     `first_website_message`. The gap that chases unanswered enquiries reads
 *     both, so getting the pair backwards loses the owner the message.
 *   · the activity is the business's own history, so its title is written in
 *     the business's language.
 *
 * The website form was the only caller, so all of it lived inline. It is about
 * to have a second caller — the agent that reads enquiries out of a mailbox
 * for businesses who keep their own website — and the one thing that must be
 * true of that agent is that its contacts are indistinguishable from the
 * form's. Not similar: identical, by construction, including the day one of
 * these three rules changes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * Consent, the owner's alert, and the welcome mail to the visitor all stay
 * with their callers. They are not part of "which row does this become":
 * consent needs a checkbox that only a web form has, and whether to greet
 * somebody who has just written to you by hand is a different question from
 * whether they are in the CRM. A caller that wants them calls them, in the
 * order it always did.
 *
 * `source` defaults to `'website_form'` because that string is load-bearing:
 * `FORM_SOURCES` in `lib/business-os/gaps/definitions.ts` is what makes the
 * `enquiry_unanswered` gap see the contact at all, and therefore what makes
 * the chase reply. A caller that passes something outside that set files a
 * contact nobody will answer.
 *
 * @module lib/business-os/leads/captureEnquiry
 */

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { crmPipelineStagesRepository } from '@/lib/repositories/CRMPipelineStagesRepository';
import { activitySentence } from '@/lib/business-os/activityText';
import {
  isStated,
  parseEnquiry,
  textOf,
  type EnquiryTemplate,
  type FieldSource,
} from './enquiryTemplate';
import { extractEnquiry, type ExtractedEnquiry } from './enquiryExtractor';
import { emailLikePattern } from '@/lib/utils/emailMatch';

const logger = createLogger({ module: 'captureEnquiry' });

/**
 * The marker on `crm_contacts.source_metadata.via` for a lead read out of a
 * mailbox. See the note where it is written: `source` cannot carry this,
 * because the chase keys on it.
 */
export const INBOX_CHANNEL_VIA = 'inbox_channel';

export interface CaptureEnquiryInput {
  /** The business this enquiry is for. */
  ownerId: string;
  /** How to reach them. The key this contact is found by. */
  email: string;
  /** Whatever they gave as a name, unsplit. Absent is normal and fine. */
  name?: string | null;
  phone?: string | null;
  /** What they wrote. */
  message: string;
  serviceInterest?: string | null;
  referralSource?: string | null;
  pageUrl?: string | null;
  /**
   * Must stay inside `FORM_SOURCES` or the chase will never see this contact.
   * See the note at the top.
   */
  source?: string;
  /** Where they came from, when the caller can tell. */
  attribution?: Record<string, unknown> | null;
  /**
   * Which sentence names the arrival in the owner's history. Defaults to the
   * website form's, because that is where this came from; the mailbox channel
   * passes its own so an owner can tell the two apart in the timeline.
   */
  activityKey?: string;
}

export interface CaptureEnquiryResult {
  contactId: string;
  /** False when they had written before. Callers greet the two differently. */
  isNewContact: boolean;
}

/** What a raw message must yield before anything is filed from it. */
export interface CaptureFromEmailInput {
  ownerId: string;
  subject?: string | null;
  body?: string | null;
  html?: string | null;
  /**
   * The headers that usually carry the enquirer on a form notification.
   * `from` is the BUSINESS — passed so it can be excluded, never filed. See
   * the note on `EnquirySample` in `enquiryTemplate.ts`.
   */
  replyTo?: string | null;
  cc?: string | null;
  from?: string | null;
  /** The mailbox owner's own address, refused as a lead by both readers. */
  owner?: string | null;
  /** Which mailbox this came from, for the channel's own lead count. */
  provider?: string | null;
  /** One id for the whole action, so an LLM call is grouped with its lead. */
  groupId?: string;
  /** Learned from the owner's own mail during setup. */
  template?: EnquiryTemplate | null;
  source?: string;
  activityKey?: string;
}

export type CaptureFromEmailResult =
  | (CaptureEnquiryResult & { filed: true })
  /**
   * Nothing was filed, and that is an answer rather than a fault.
   *
   * `no_address` is the important one: the parser refuses to return an address
   * that is not in the message, so a message it cannot read produces nothing
   * and the caller LEAVES IT UNREAD for a person to look at. Marking it read
   * would lose an enquiry silently, which is the only truly bad outcome here.
   */
  | { filed: false; reason: 'no_address' };

/**
 * File an enquiry straight from a mailbox message.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PARSING IS OURS, NOT A MODEL'S
 *
 * Everything filed here is emailed to the address it found, fifteen minutes
 * later, by the unanswered-enquiry chase. That is why the reading is done by
 * `parseEnquiry` against a template measured from the owner's own messages,
 * and why it returns an address only when that address appears verbatim in the
 * message: a model that hallucinates one would have the business writing to a
 * stranger. It can fail to read an enquiry. It cannot invent one.
 *
 * Everything after the parse is the shared path, so a lead read out of a
 * mailbox is the same row as one typed into the website's form.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function captureEnquiryFromEmail(
  input: CaptureFromEmailInput
): Promise<CaptureFromEmailResult> {
  const parsed = parseEnquiry(
    {
      subject: input.subject,
      body: input.body,
      html: input.html,
      replyTo: input.replyTo,
      cc: input.cc,
      from: input.from,
    },
    input.template
  );

  /*
   * ─────────────────────────────────────────────────────────────────────────
   * THE MODEL READS WHAT THE RULES COULD NOT, AND ONLY THAT.
   *
   * It fires on exactly two outcomes: no address at all, or an address with no
   * name. A form that labels its fields satisfies both without a call, so the
   * common case costs nothing and stays instant — and the cost of this scales
   * with FAILURES rather than with volume.
   *
   * Everything it returns is checked by us: the address must be verbatim in
   * the message and must not be the business's own. See `enquiryExtractor`.
   * A null answer leaves the turn exactly as the rules left it.
   * ─────────────────────────────────────────────────────────────────────────
   */
  /*
   * ASK THE MODEL WHENEVER THE RULES WERE INFERRING, NOT ONLY WHEN THEY FAILED.
   *
   * The first cut fired only on "found nothing", which treats a labelled field
   * and a guess as equally good — so a confident wrong answer scraped out of a
   * footer, or a campaign name read as a person, would never be questioned.
   *
   * `isStated` is the line: a Reply-To header or a labelled field is the form
   * TELLING us what a value is, and no model reading beats that. Everything
   * else — an address found by scanning the body, a name taken off the end of
   * the subject, a message assembled from leftovers — is us inferring, and
   * inference is exactly where five separate real formats defeated the rules.
   */
  const needsHelp =
    !parsed ||
    !isStated(parsed.sources.email) ||
    !isStated(parsed.sources.name) ||
    (!parsed.message && !parsed.phone);
  let extracted: ExtractedEnquiry | null = null;

  if (needsHelp) {
    extracted = await extractEnquiry({
      userId: input.ownerId,
      /* One id for this action, so the ledger groups the call with the lead it
         was spent on rather than leaving it orphaned. */
      groupId: input.groupId ?? `enquiry:${input.ownerId}:${input.subject ?? ''}`.slice(0, 120),
      subject: input.subject,
      text: textOf({ subject: input.subject, body: input.body, html: input.html }),
      from: input.from,
      owner: input.owner,
    });
  }

  if (!parsed && !extracted) {
    logger.info(
      { ownerId: input.ownerId, subject: input.subject?.slice(0, 80) },
      'No address found in this message; nothing filed and it stays unread'
    );
    return { filed: false, reason: 'no_address' };
  }

  /*
   * A STATED value wins; an inferred one yields to the model.
   *
   * Deliberately not "the model is cleverer so it wins": when the form says
   * `אימייל: osnat@…`, reading that label is free and provably right, and a
   * model re-deriving it could only be equal or worse. But when the rules
   * merely scanned the body or chopped the subject, the model has read the
   * whole message in context and should be preferred.
   *
   * Either way the extractor's own checks have already run: the address is
   * verbatim in the message and is not the business's own.
   */
  const prefer = <T>(
    ruleValue: T | null | undefined,
    source: FieldSource | undefined,
    modelValue: T | null | undefined
  ): T | null => {
    if (isStated(source) && ruleValue) return ruleValue;
    return (modelValue ?? ruleValue) ?? null;
  };

  const email =
    isStated(parsed?.sources.email) && parsed
      ? parsed.email
      : (extracted?.email ?? parsed?.email ?? null);

  /* Can only be null if BOTH readers failed, which the guard above returned
     on. Narrowed here so the capture call cannot be handed nothing. */
  if (!email) {
    logger.info({ ownerId: input.ownerId }, 'No address survived either reader; nothing filed');
    return { filed: false, reason: 'no_address' };
  }

  const name = prefer(parsed?.name, parsed?.sources.name, extracted?.name);
  const phone = prefer(parsed?.phone, parsed?.sources.phone, extracted?.phone);
  const message = prefer(parsed?.message, parsed?.sources.message, extracted?.message);

  const filed = await captureEnquiry({
    ownerId: input.ownerId,
    /*
     * WHICH CHANNEL BROUGHT THIS ONE.
     *
     * The `source` must stay inside FORM_SOURCES or the unanswered-enquiry
     * chase never sees the contact — that identity with the website form is
     * the whole design. Which means a mailbox lead and a form lead are
     * indistinguishable, and the Channels card cannot say what the channel
     * brought in.
     *
     * `source_metadata` is the place for it: a marker beside the source
     * rather than instead of it, so the chase is untouched and the count
     * becomes possible.
     */
    attribution: { via: INBOX_CHANNEL_VIA, ...(input.provider ? { provider: input.provider } : {}) },
    email,
    name,
    message: message ?? '',
    /* From a labelled field, or from the model when the form labelled none, so
       a lead that gave a number arrives with it rather than the owner having
       to open the email to find it. */
    ...(phone ? { phone } : {}),
    ...(input.source ? { source: input.source } : {}),
    ...(input.activityKey ? { activityKey: input.activityKey } : {}),
  });

  return { ...filed, filed: true };
}

/**
 * Find or create the contact, and log the message against them.
 *
 * Throws only when the contact itself cannot be written — that is the one
 * failure a caller must not treat as success, because everything downstream
 * (the gap, the chase, the booking link) hangs off the row existing. A failed
 * ACTIVITY is logged and swallowed: the lead is worth more than its note.
 */
export async function captureEnquiry(
  input: CaptureEnquiryInput
): Promise<CaptureEnquiryResult> {
  const {
    ownerId,
    email,
    message,
    source = 'website_form',
    activityKey = 'website_contact_form',
  } = input;

  const log = logger.child({ ownerId, source });

  /*
   * The start of THIS owner's board, resolved in the repository that owns the
   * table rather than guessed here.
   */
  const { data: resolvedFirstStage } =
    await crmPipelineStagesRepository.firstStageKey(ownerId);

  const initialStage = resolvedFirstStage;

  const { data: existingContact } = await supabaseServer
    .from('crm_contacts')
    .select('id, custom_fields')
    .eq('user_id', ownerId)
    /* `ilike`, not `eq`: an address stored before this route started
         normalising is whatever the visitor typed, so a case-sensitive match
         misses it and a SECOND contact is created for the same person. The
         insert side is normalised now; this is what finds the rows that
         predate it. No wildcards in the value, so it stays an equality match
         in everything but case. */
      .ilike('email', emailLikePattern(email))
    .single();

  let contactId: string;
  let isNewContact = false;

  if (existingContact) {
    const updatedCustomFields = {
      ...(existingContact.custom_fields || {}),
      last_website_message: message,
      last_website_contact: new Date().toISOString(),
      service_interest:
        input.serviceInterest || existingContact.custom_fields?.service_interest,
    };

    const { error: updateError } = await supabaseServer
      .from('crm_contacts')
      .update({
        phone: input.phone || existingContact.custom_fields?.phone,
        custom_fields: updatedCustomFields,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingContact.id);

    if (updateError) {
      log.error({ err: updateError }, 'Failed to update contact');
      throw updateError;
    }

    contactId = existingContact.id;
    log.info({ contactId }, 'Contact updated');
  } else {
    /*
     * Parse the name into first and last — and leave BOTH null when there is
     * none. The columns are nullable precisely so an unnamed contact can be
     * stored as one; the CRM shows the address, and the owner sees what they
     * actually have.
     */
    const trimmedName = input.name?.trim();
    const nameParts = trimmedName ? trimmedName.split(/\s+/) : [];
    const firstName = nameParts[0] ?? null;
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;

    const { data: newContact, error: createError } = await supabaseServer
      .from('crm_contacts')
      .insert({
        user_id: ownerId,
        first_name: firstName,
        last_name: lastName,
        email,
        phone: input.phone || null,
        source,
        /* Omitted with no pipeline configured, so the column's own
           `NOT NULL DEFAULT 'lead'` applies rather than this restating it. */
        ...(initialStage ? { stage: initialStage } : {}),
        source_metadata: (input.attribution ?? {}) as unknown as Record<string, unknown>,
        custom_fields: {
          first_website_message: message,
          service_interest: input.serviceInterest,
          referral_source: input.referralSource,
          page_url: input.pageUrl,
        },
      })
      .select('id')
      .single();

    if (createError || !newContact) {
      log.error({ err: createError }, 'Failed to create contact');
      throw createError || new Error('Failed to create contact');
    }

    contactId = newContact.id;
    isNewContact = true;
    log.info({ contactId }, 'New contact created');
  }

  /*
   * The message, in the owner's history. Context is appended rather than
   * stored in columns of its own: it is prose for a human reading a timeline.
   */
  let activityDescription = message;
  if (input.serviceInterest) {
    activityDescription += `\n\nService Interest: ${input.serviceInterest}`;
  }
  if (input.referralSource) {
    activityDescription += `\nReferral Source: ${input.referralSource}`;
  }

  const { data: ownerProfile } = await supabaseServer
    .from('business_profiles')
    .select('language')
    .eq('user_id', ownerId)
    .maybeSingle();
  const ownerLocale = ownerProfile?.language || 'en';

  const { error: activityError } = await supabaseServer
    .from('crm_activities')
    .insert({
      user_id: ownerId,
      contact_id: contactId,
      activity_type: 'note',
      // The business's language, not English: this is its own history.
      title: activitySentence(activityKey, {}, ownerLocale),
      description: activityDescription,
      activity_date: new Date().toISOString(),
      auto_logged: true,
      source_capability: 'website',
    });

  if (activityError) {
    /* Swallowed on purpose: the lead is worth more than its note. */
    log.error({ err: activityError, contactId }, 'Failed to create activity');
  } else {
    log.info({ contactId }, 'Activity created for enquiry');
  }

  return { contactId, isNewContact };
}
