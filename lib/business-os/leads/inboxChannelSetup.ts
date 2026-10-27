/**
 * Turning a finished setup into a running agent, and learning the template
 * that makes one possible.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PLAN IS SHIPPED; ONLY THE VALUES ARE THE OWNER'S
 *
 * `agent/inboxEnquiryAgent.steps.json` and its Outlook sibling are the compiled
 * plans, authored once and committed. Every owner on a given mailbox gets the
 * same steps — search the mailbox, hand each message to the CRM, mark it read
 * only if it was filed — and differs in two things: which emails to look at,
 * and what their form's emails look like.
 *
 * Those reach the run through `agent_configurations.input_values`, which is
 * what the runtime resolves `{{input.*}}` from. Nothing is substituted at setup
 * time, so a stored plan stays identical for everybody and a bug fixed in it is
 * fixed for every owner at once.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE PLAN PER PROVIDER, NOT ONE PLAN WITH A SWITCH
 *
 * The two mailboxes do not merely name their actions differently; they ask
 * different questions. Gmail takes one opaque query string (`from:x
 * subject:"y" is:unread after:d`) and marks read with `modify_email` /
 * `mark_read`. Outlook takes three separate OData filters, cannot accept a
 * free-text query alongside them at all, and marks read with
 * `modify_message` / `is_read`.
 *
 * A single plan with provider branching inside it would have to carry both
 * shapes and pick at run time — which is a conditional in the hot path for a
 * fact that is settled the moment the owner picks a mailbox. One agent per
 * connection means each carries the plan for its own provider and there is
 * nothing to decide while it runs.
 *
 * @module lib/business-os/leads/inboxChannelSetup
 */

import { createLogger } from '@/lib/logger';
import { agentRepository } from '@/lib/repositories/AgentRepository';
import { agentConfigurationRepository } from '@/lib/repositories/AgentConfigurationRepository';
import { PluginExecuterV2 } from '@/lib/server/plugin-executer-v2';
import { deriveEnquiryTemplate, parseEnquiry, type EnquirySample, type EnquiryTemplate } from './enquiryTemplate';
import {
  INBOX_CHANNEL_TAG,
  inboxChannelTag,
  PROVIDER_NAMES,
  type InboxProvider,
} from './inboxChannel';
import { INBOX_CHANNEL_CONFIG_KEY } from './inboxProviders';
import GMAIL_STEPS from './agent/inboxEnquiryAgent.steps.json';
import OUTLOOK_STEPS from './agent/inboxEnquiryAgent.outlook.steps.json';

const logger = createLogger({ module: 'inboxChannelSetup' });

/**
 * How often it looks.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Five minutes, and the number comes from the client's wait rather than from
 * our convenience. `reply_to_enquiries` sends fifteen minutes after a lead is
 * filed, chosen as "long enough to intervene, short enough that the person who
 * wrote in still has this business in mind". Polling every fifteen would add up
 * to fifteen more and halve that intent; polling every five keeps the whole
 * journey inside twenty.
 *
 * It is also an established cadence here: `calendar-sync` and
 * `insight-automations` both run on the same five-minute tick, so it is a load
 * the platform already carries — and each run is one filtered mailbox search
 * that usually returns nothing.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const SCHEDULE_CRON = '*/5 * * * *';

/**
 * What a cron expression alone does NOT do.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The scheduled runner (`/api/run-scheduled-agents`) selects on THREE columns,
 * not one: `mode = 'scheduled'`, `schedule_enabled = true` and a non-null
 * `schedule_cron`. It then skips any row whose `next_run` is null — "not due
 * yet" — and claims a row by matching `next_run` to the value it read, so an
 * unseeded one can never be claimed either.
 *
 * Setting only `schedule_cron` therefore produces an agent that is active,
 * correct, visible, and permanently dormant, with nothing anywhere saying why.
 * These are written together so that cannot happen.
 *
 * The first run is dated now rather than one interval out: the owner has just
 * pressed "Start now", and an enquiry arriving in the next five minutes should
 * not wait for a second tick.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function schedulingFacts(): {
  mode: string;
  schedule_enabled: boolean;
  schedule_cron: string;
  timezone: string;
  next_run: string;
} {
  return {
    mode: 'scheduled',
    schedule_enabled: true,
    schedule_cron: SCHEDULE_CRON,
    /* UTC deliberately. A five-minute cron has no local meaning, and the
       runner defaults to UTC for a null zone anyway. */
    timezone: 'UTC',
    next_run: new Date().toISOString(),
  };
}

/** How many of the sender's other messages to learn from. */
const SIBLINGS_TO_LEARN_FROM = 10;

/** What the picker shows. Enough to find an enquiry, few enough to scan. */
const SAMPLES_TO_OFFER = 30;

export interface InboxMessage {
  id: string;
  from: string;
  subject: string;
  date: string | null;
  snippet?: string | null;
}

/**
 * The gate, as FACTS rather than as one provider's search string.
 *
 * Gmail wants them concatenated into a query; Outlook wants them as three
 * separate OData filters and would choke on the string. Keeping the facts
 * means the derive step measures once and each provider's plan asks its own
 * mailbox its own way — and a rule shown to the owner on screen three is the
 * same rule in both cases.
 */
export interface MailboxRule {
  /** The sender to watch. */
  from: string;
  /** The stable part of the subject, or '' when every subject differs. */
  subjectPrefix: string;
  /**
   * Nothing older than this, ISO 8601.
   *
   * Today, by the owner's decision: a channel switched on now does not reach
   * back through the archive. Filing a fortnight of old enquiries would have
   * the chase email every one of them a booking link fifteen minutes later,
   * including people who were answered by hand weeks ago.
   */
  since: string;
}

/**
 * Why a derive refused, in terms the setup screen can turn into a sentence.
 *
 * It used to return a bare null for five different situations and the route
 * printed one line for all of them — "we could not read an enquiry out of that
 * message" — which is true, unhelpful, and indistinguishable from a bug. An
 * owner cannot tell "that sender writes you newsletters" from "we read the mail
 * and the layout defeated us", and those want opposite reactions.
 */
export type DeriveRefusal =
  /** No address in what the picker handed back. */
  | 'no_sender'
  /** The mailbox returned nothing for that sender. */
  | 'nothing_to_read'
  /**
   * Read, but nothing distinguishes an enquiry from the sender's other mail:
   * no shared field labels and no stable subject. Newsletters and
   * notifications land here, which is correct.
   */
  | 'not_a_form'
  /**
   * A rule WAS found and not one message yielded a contact — every one of them
   * lacked an address we could trust. Rare, and worth its own words: the
   * sender looks right and the reading is what failed.
   */
  | 'no_contacts';

export interface DerivedSetup {
  template: EnquiryTemplate;
  /** The measured rule, in provider-neutral form. */
  rule: MailboxRule;
  /** The same rule in the owner's words, for the confirmation screen. */
  watching: string;
  /** What it would have filed from the sender's recent mail. */
  /**
   * What it would have filed from the sender's recent mail.
   *
   * Carries the phone because the reader takes one when the form asks, and
   * screen three promises "what will be read from each enquiry" — omitting a
   * field we capture makes that promise false by omission.
   */
  preview: { name: string | null; email: string; phone: string | null; when: string | null }[];
  /**
   * Messages from that sender it could NOT read.
   *
   * Surfaced rather than hidden: a template that works on eight of ten is a
   * template the owner should see before switching anything on, and these are
   * the messages that would be left unread for them in normal running.
   */
  unreadable: number;
}

/* `getInstance`, not `new`: the constructor is private and the instance holds
   the resolved connections and the active profile. */
function executer(): Promise<PluginExecuterV2> {
  return PluginExecuterV2.getInstance();
}

/** The address inside `Sarah <sarah@x.com>`, which is what a query needs. */
function addressOf(from: string): string {
  return from.match(/<([^>]+)>/)?.[1]?.trim() ?? from.trim();
}

/** Both providers answer with their own shapes; this is the common ground. */
function toMessages(raw: unknown): InboxMessage[] {
  const list =
    (raw as { emails?: unknown[] })?.emails ??
    (raw as { messages?: unknown[] })?.messages ??
    (Array.isArray(raw) ? raw : []);

  return (list as Record<string, unknown>[]).map(m => ({
    id: String(m.id ?? m.messageId ?? ''),
    from: String(m.from ?? m.sender ?? ''),
    subject: String(m.subject ?? ''),
    /* `received_at` is Graph's name for it, and omitting it left every Outlook
       message undated in the picker — the one column that tells an owner which
       of four identical subjects is the one they remember. */
    date: (m.date ?? m.received_at ?? m.receivedAt ?? null) as string | null,
    snippet: (m.snippet ?? m.body_preview ?? null) as string | null,
    body: (m.body ?? m.bodyText ?? m.text ?? null) as string | null,
    html: (m.html ?? m.bodyHtml ?? null) as string | null,
  })) as InboxMessage[];
}

/**
 * Everything that differs between the two mailboxes, in one table.
 *
 * Collected here rather than spread through the functions below, so that
 * adding a third provider is a row and reading what a provider does is one
 * look. Each entry answers three questions: which plan its agents run, how to
 * ask it for recent mail, and how to ask it for one sender's mail in full.
 */
const PROVIDERS: Record<
  InboxProvider,
  {
    plan: unknown[];
    recent: (limit: number) => Record<string, unknown>;
    /**
     * That sender's mail, narrowed to the shape of the chosen message.
     *
     * `subjectKey` is NOT optional decoration. Searching by sender alone
     * returns the most recent N, and a mailbox where the form writes weekly
     * among daily traffic simply does not contain the enquiries in that
     * window — the first real account tested returned ten booking receipts and
     * not one of the seven "New enquiry from …" messages sitting behind them.
     * The provider must do the narrowing, because only it can see past N.
     */
    fromSender: (sender: string, limit: number, subjectKey: string) => Record<string, unknown>;
  }
> = {
  'google-mail': {
    plan: GMAIL_STEPS as unknown[],
    /* Recent, and nothing older: an enquiry worth learning from is one they
       still recognise. */
    recent: limit => ({
      query: 'newer_than:30d',
      max_results: limit,
      content_level: 'metadata',
    }),
    fromSender: (sender, limit, subjectKey) => ({
      /* `subject:"two words"` is a phrase match in Gmail, which is what the
         cluster key is. Omitted when there is no subject to key on. */
      query: subjectKey ? `from:${sender} subject:"${subjectKey}"` : `from:${sender}`,
      max_results: limit,
      content_level: 'full',
    }),
  },
  outlook: {
    plan: OUTLOOK_STEPS as unknown[],
    /*
     * A DATE FILTER, not a query. Graph refuses `$search` beside `$filter`, and
     * it has no `newer_than:` of its own — the window has to be a real
     * timestamp.
     */
    recent: limit => ({
      from_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      max_results: limit,
      content_level: 'metadata',
    }),
    fromSender: (sender, limit, subjectKey) => ({
      from_address: sender,
      /* `startswith(subject, …)` server-side — the parameter added for exactly
         this, so Graph narrows before the limit applies rather than after. */
      ...(subjectKey ? { subject_prefix: subjectKey } : {}),
      max_results: limit,
      content_level: 'full',
    }),
  },
};

/** Recent mail, for the owner to point at one enquiry. */
export async function listRecentMessages(
  userId: string,
  provider: InboxProvider
): Promise<InboxMessage[]> {
  const exec = await executer();
  const result = await exec.execute(
    userId,
    provider,
    'search_emails',
    PROVIDERS[provider].recent(SAMPLES_TO_OFFER)
  );

  return toMessages((result as { data?: unknown })?.data ?? result);
}

/**
 * Learn the template from everything that sender has sent them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE OWNER CLICKS ONE EMAIL; WE READ THAT SENDER'S OTHERS OURSELVES
 *
 * One sample cannot tell a fixed subject from a parameterised one, and getting
 * that wrong produces a rule that matches the person in the sample and
 * silently misses everybody after them. Asking the owner to tick three would
 * work too and costs them more; this costs them nothing and sees more.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT TAKES THE SENDER, NOT THE MESSAGE ID
 *
 * This used to take the chosen message's id and re-read it in full before
 * doing anything else. That read could not succeed: neither mail plugin has a
 * get-one-message-by-id action, so it went out as `search_emails` with the id
 * as the query — which matches nothing — and the fallback was the same search
 * again. Every derive returned null, on every account, for every message.
 *
 * The id was never needed. The only thing the chosen message contributed was
 * its SENDER, and the picker already showed the owner that address to choose
 * it by. Searching `from:<sender>` with full content now returns the chosen
 * message among its siblings, so one search replaces three and the sample it
 * was clicked for is genuinely in the set.
 * ─────────────────────────────────────────────────────────────────────────────
 */
/**
 * The first two words of a subject, lower-cased. The cluster key.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SENDER IS NOT ENOUGH
 *
 * This learned from everything a sender had written, which assumed one address
 * sends one kind of mail. Real mailboxes break that constantly, and the first
 * one we tested broke it completely: the owner's form notifications and their
 * personal correspondence arrived from the SAME address, so "New enquiry from
 * Yael Omer" was averaged together with ordinary letters. Nothing was shared,
 * so a perfectly good form was refused as "not a form".
 *
 * Two words, because that is the part a parameterised subject keeps fixed:
 * "New enquiry from <name>" and "פנייה חדשה <name>" both survive it, and it is
 * language-neutral — no word list, no translation table, nothing to maintain.
 * One word would group "New enquiry" with "New invoice"; three would split a
 * subject whose third word varies.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function subjectKey(subject: string | null | undefined, words = 2): string {
  return (subject ?? '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .slice(0, words)
    .join(' ');
}

/**
 * How many leading words to group by, longest first.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO WORDS IS NOT ALWAYS THE RIGHT WIDTH
 *
 * A fixed two assumed the second word holds still. It does for "New enquiry
 * from ‹name›" and it does not for "התעניינות: ‹campaign›", where word two is
 * already the name of the lecture being asked about. On a real Elementor form
 * that narrowed the search to one message, and a single sample makes
 * `deriveEnquiryTemplate` take the subject WHOLE — so the rule it showed the
 * owner was "subject starts with: התעניינות: הרצאה על התארגנות בוקר רגועה
 * ויעילה אוקטובר 2026". That matches one campaign and silently misses every
 * enquiry about anything else, forever, which is the exact failure the
 * stable-prefix design exists to prevent, reached by another road.
 *
 * So the width is measured rather than assumed: try three words, then two,
 * then one, and keep the first that actually finds the sender writing more
 * than once. Wider is better when it works, because it separates two
 * different notifications from the same sender; narrower is better than a
 * group of one.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const KEY_WIDTHS = [3, 2, 1] as const;

export async function deriveFromSender(
  userId: string,
  provider: InboxProvider,
  from: string,
  /**
   * The chosen message's subject, when the picker knows it.
   *
   * Optional so an older caller still works, but without it this falls back to
   * "everything from that sender" and inherits the flaw described on
   * `subjectKey`. The wizard always sends it.
   */
  subject?: string
): Promise<DerivedSetup | DeriveRefusal> {
  const exec = await executer();

  const sender = addressOf(from);
  if (!sender) {
    logger.info({ userId }, 'No sender to learn from');
    return 'no_sender';
  }

  /*
   * THE SEARCH IS NARROWED, NOT THE RESULT.
   *
   * See `subjectKey` and the note on `fromSender`. Fetching the sender's most
   * recent ten and filtering them here looked equivalent and is not: on the
   * first real mailbox tested, those ten were all booking receipts and the
   * seven "New enquiry from …" messages sat behind them, unreachable. The
   * filter then matched nothing and an empty sample set was reported as "not a
   * form" — a true-looking refusal for a mailbox that had seven perfectly good
   * enquiries in it.
   */
  /*
   * WIDEST KEY THAT FINDS MORE THAN ONE MESSAGE — see `KEY_WIDTHS`.
   *
   * Each attempt is one narrow mailbox search, and the loop stops the moment a
   * width works, so the common case is a single request: "New enquiry from"
   * succeeds at three words. A subject whose second word varies falls through
   * to one word and finds its siblings there instead of giving up with a
   * sample of one and a rule that matches nothing else.
   */
  let key = subjectKey(subject);
  let all: InboxMessage[] = [];

  for (const width of KEY_WIDTHS) {
    const attempt = subjectKey(subject, width);
    if (!attempt) continue;

    const raw = await exec.execute(
      userId,
      provider,
      'search_emails',
      PROVIDERS[provider].fromSender(sender, SIBLINGS_TO_LEARN_FROM, attempt)
    );
    const found = toMessages((raw as { data?: unknown })?.data ?? raw);

    /* Remember the best so far, so a narrower try that finds nothing cannot
       lose what a wider one already had. */
    if (found.length > all.length) {
      all = found;
      key = attempt;
    }
    if (found.length > 1) break;
  }

  /* No subject to key on at all: fall back to the sender's recent mail. */
  if (!all.length && !key) {
    const raw = await exec.execute(
      userId,
      provider,
      'search_emails',
      PROVIDERS[provider].fromSender(sender, SIBLINGS_TO_LEARN_FROM, '')
    );
    all = toMessages((raw as { data?: unknown })?.data ?? raw);
  }

  if (!all.length) {
    logger.info({ userId, provider, key }, 'That sender has nothing left to read');
    return 'nothing_to_read';
  }

  /*
   * A second pass for exactness: Gmail's `subject:` matches a phrase anywhere
   * in the subject, so a narrowed search can still return a near miss. Falls
   * back to everything the search returned rather than emptying the set —
   * the refusal above is for "nothing came back", never for "we filtered it
   * all away ourselves".
   */
  const clustered = key ? all.filter(m => subjectKey(m.subject) === key) : all;
  const siblings = clustered.length ? clustered : all;

  logger.info(
    { userId, provider, returned: all.length, sameShape: siblings.length, key },
    'Read the sender’s mail of that shape'
  );

  const samples: EnquirySample[] = siblings.map(m => {
    const raw = m as unknown as Record<string, string | undefined>;
    return {
      subject: m.subject,
      body: raw.body,
      html: raw.html,
      /* The headers that usually hold the client. See the note on
         `EnquirySample.replyTo`: the `from` is the business, not the lead. */
      replyTo: raw.reply_to,
      cc: raw.cc,
      from: m.from,
    };
  });

  const template = deriveEnquiryTemplate(samples);
  if (!template) {
    logger.info(
      { userId, provider, read: samples.length },
      'That sender has no rule to learn: no shared labels and no stable subject'
    );
    return 'not_a_form';
  }

  /*
   * THE RULE, which is the gate.
   *
   * Unread, this sender, this subject prefix, nothing older than today. Both
   * providers apply all four server-side — Gmail from one assembled query,
   * Outlook from three OData filters — so a run fetches the handful that
   * match, never the inbox. The facts are recorded here and each provider's
   * plan phrases them its own way; see the note on `MailboxRule`.
   */
  const rule: MailboxRule = {
    from: sender,
    subjectPrefix: template.subjectPrefix,
    since: startOfToday(),
  };

  const read = samples.map(s => parseEnquiry(s, template));
  const preview = read
    .map((p, i) =>
      p ? { name: p.name, email: p.email, phone: p.phone, when: siblings[i]?.date ?? null } : null
    )
    .filter(Boolean) as DerivedSetup['preview'];

  /*
   * A rule that reads NOTHING is not a setup worth offering.
   *
   * This used to return the template anyway, so screen four said "this would
   * have added 0 leads" over an empty list and still offered Start now — an
   * owner would switch on a channel that had just demonstrated it files
   * nothing. Refusing names the real situation instead: the sender looks
   * plausible and the reading is what failed.
   */
  if (preview.length === 0) {
    logger.info(
      { userId, provider, read: samples.length },
      'A rule was found but no message yielded a contact'
    );
    return 'no_contacts';
  }

  return {
    template,
    rule,
    watching: template.subjectPrefix ? `${sender} · “${template.subjectPrefix}…”` : sender,
    preview,
    unreadable: read.filter(p => !p).length,
  };
}

/**
 * Midnight today, in UTC, as an ISO timestamp.
 *
 * The start of the day rather than the moment of setup: an owner who switches
 * the channel on at four in the afternoon should still get the enquiry that
 * arrived at lunchtime and is sitting unread. "From now on" means today, not
 * from this second.
 */
function startOfToday(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

/**
 * The rule as Gmail's query language, which is the one provider that wants a
 * single string. `after:` takes `YYYY/MM/DD` and nothing else.
 */
function gmailQuery(rule: MailboxRule): string {
  const d = new Date(rule.since);
  const after = `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  const subjectClause = rule.subjectPrefix ? ` subject:"${rule.subjectPrefix}"` : '';
  return `from:${rule.from}${subjectClause} is:unread after:${after}`;
}

/**
 * Create this owner's agent for ONE mailbox, from that provider's shipped plan.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IDEMPOTENT PER CONNECTION, NOT PER BUSINESS
 *
 * Matched on the provider tag (`inbox-enquiries:google-mail`), so running setup
 * twice for the same mailbox re-points the agent that mailbox already has, and
 * running it for a SECOND mailbox creates a second agent beside the first.
 *
 * Matching on the shared tag — which this did — meant a business setting up
 * Outlook found its Gmail channel and re-pointed it: the second mailbox
 * appeared to be set up, and the first silently stopped being read. Two
 * mailboxes are two sources of leads and get two agents.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function enableInboxChannel(input: {
  userId: string;
  provider: InboxProvider;
  rule: MailboxRule;
  template: EnquiryTemplate;
  watching: string;
}): Promise<{ agentId: string }> {
  const { userId, provider, rule, template, watching } = input;
  const log = logger.child({ userId, provider });
  const providerTag = inboxChannelTag(provider);

  const { data: existing } = await agentRepository.findAllByUser(userId, {
    includeInactive: true,
    limit: 200,
  });
  const current = (existing ?? []).find(a => (a.tags ?? []).includes(providerTag));

  /*
   * Both phrasings of the same rule, on every channel.
   *
   * Each plan reads only the keys its own provider needs — Gmail the assembled
   * `mail_query`, Outlook the three facts — and writing both costs nothing.
   * The alternative is a provider-shaped set of input values, which makes the
   * stored configuration something you have to know the provider to read.
   */
  const inputValues = {
    mail_query: gmailQuery(rule),
    mail_from: rule.from,
    mail_subject_prefix: rule.subjectPrefix,
    mail_since: rule.since,
    /*
     * THE OBJECT, NOT A JSON STRING.
     *
     * This was `JSON.stringify(template)`, with a comment claiming the
     * executor took either form. It does not: `crm.capture_enquiry` declares
     * `template` as an object and the plugin layer validates it, so every run
     * died with "Parameter template should be object, got string" — the scatter
     * failed on item 0, no enquiry was ever filed, and the channel looked
     * healthy throughout. `input_values` is JSONB, so an object stores and
     * resolves as one.
     */
    enquiry_template: template,
  };

  if (current) {
    await agentRepository.update(current.id, userId, {
      /* All of it, not just the cron — a re-point must be able to revive an
         agent whose scheduling facts were cleared, or setup appears to succeed
         and nothing ever runs. */
      ...schedulingFacts(),
      /* MERGED, never replaced: `agent_config` also carries creation metadata
         and the V6 ai_context (WP-48, WP-55), and a channel re-point must not
         throw those away. */
      agent_config: {
        ...((current.agent_config as Record<string, unknown>) ?? {}),
        /* The template too: the RUNTIME reads it from
           `agent_configurations.input_values`, which is what `{{input.*}}`
           resolves from, but the status reader looks here — so without it
           `InboxChannelRow.template` was a field that could never be
           populated, which reads as a bug rather than as an absence. */
        [INBOX_CHANNEL_CONFIG_KEY]: { provider, watching, enquiry_template: template },
      },
    });

    /*
     * Status goes through the transition guard, not the update.
     *
     * `status` is deliberately absent from `UpdateAgentInput`: the repository
     * owns the legal transitions (`STATUS_TRANSITIONS`), and `active → active`
     * is not one of them — so this is asked only when it is actually needed.
     */
    if (current.status !== 'active') {
      const { error: activateError } = await agentRepository.activate(current.id, userId);
      if (activateError) {
        log.error({ err: activateError, agentId: current.id }, 'Could not reactivate the channel');
        throw activateError;
      }
    }

    await agentConfigurationRepository.saveInputValues(current.id, userId, inputValues);
    log.info({ agentId: current.id }, 'Inbox channel re-pointed');
    return { agentId: current.id };
  }

  const { data: agent, error } = await agentRepository.create({
    user_id: userId,
    /* Named for its mailbox, because a business can have two of these and
       "Website enquiries from my mailbox" twice in an agent list tells its
       owner nothing about which is which. */
    agent_name: `Website enquiries from ${PROVIDER_NAMES[provider]}`,
    description:
      'Reads the enquiry emails your website form sends you and files each sender as a lead.',
    /*
     * BOTH markers. On tags, not the name: a renamed agent must stay findable,
     * or the next setup silently creates a second one.
     *
     * The shared tag is what the cron runs and the card lists; the provider tag
     * is what makes setup idempotent for THIS mailbox without touching the
     * other one.
     */
    tags: [INBOX_CHANNEL_TAG, providerTag],
    status: 'active',
    ...schedulingFacts(),
    plugins_required: [provider, 'crm'],
    workflow_steps: PROVIDERS[provider].plan,
    pilot_steps: PROVIDERS[provider].plan,
    agent_config: {
      [INBOX_CHANNEL_CONFIG_KEY]: { provider, watching, enquiry_template: template },
    },
  });

  if (error || !agent) {
    log.error({ err: error }, 'Could not create the inbox channel agent');
    throw error ?? new Error('Could not create the inbox channel agent');
  }

  await agentConfigurationRepository.saveInputValues(agent.id, userId, inputValues);
  log.info({ agentId: agent.id }, 'Inbox channel enabled');
  return { agentId: agent.id };
}
