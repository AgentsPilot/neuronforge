/**
 * The automations we ship, and the only place they are declared.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Adding one is adding DATA: a committed `*.steps.json` under `./agents/` and
 * an entry in the array below. No runner, no route, no wizard, no migration.
 *
 * That is the test of whether this mechanism works. If an automation ever needs
 * a file of logic of its own, the mechanism is missing something — and the
 * right move is to add it here, for every automation, rather than to make one
 * of them special. The mailbox channel is special for a reason that does not
 * generalise: it has to LEARN its rule from the owner's own mail.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHICH PLUGIN AN ENTRY MAY CALL
 *
 * `business-os`, for two reasons that both matter.
 *
 * It is the only Business OS surface the agent pipeline can SEE: the capability
 * plugins — crm, scheduling, payments — carry `visibility: "business_os"` and
 * are hidden from discovery, reachable only by explicit key from hand-written
 * code. The mailbox channel is exactly that and correctly calls
 * `crm.capture_enquiry`; a catalogue entry is not.
 *
 * And it is the only one whose sends are governed. `business-os` routes through
 * BizQL, so a send inherits `allowBulk`, `maxFanout`, a daily quota, a real dry
 * run and idempotency claims. The capability plugins have none of that, and at
 * least one of them is a trap: `payments.send_invoice` is status-only and
 * "no email is dispatched by this op".
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { CADENCE_CRON, type AutomationAgent, type AutomationAgentId } from './types';

import chaseOverdueInvoicesSteps from './agents/chaseOverdueInvoices.steps.json';
import draftClientRepliesSteps from './agents/draftClientReplies.steps.json';
import draftClientRepliesOutlookSteps from './agents/draftClientRepliesOutlook.steps.json';
import importLeadsFromSheetSteps from './agents/importLeadsFromSheet.steps.json';
import followUpNewEnquiriesSteps from './agents/followUpNewEnquiries.steps.json';
import followUpStalledDealsSteps from './agents/followUpStalledDeals.steps.json';
import rebookQuietClientsSteps from './agents/rebookQuietClients.steps.json';
import recoverAbandonedCheckoutsSteps from './agents/recoverAbandonedCheckouts.steps.json';
import winBackQuietClientsSteps from './agents/winBackQuietClients.steps.json';

export const AUTOMATION_AGENTS: AutomationAgent[] = [
  {
    id: 'chase_overdue_invoices',
    nameKey: 'automation.chase_overdue_invoices.name',
    descriptionKey: 'automation.chase_overdue_invoices.description',
    watchesKey: 'automation.chase_overdue_invoices.watches',
    /*
     * The process four detectors conclude with — `cash_ar_overdue`,
     * `cash_ar_aging`, `cash_booking_unpaid`, `cash_revenue_at_risk`. All of
     * them end at "money is owed and nobody is asking for it", so one agent
     * answers all four. That is why the join is on the PROCESS and not the
     * detector.
     */
    answersProcess: 'chase_overdue_invoices',
    requires: 'bills_for_anything',
    /*
     * ALONGSIDE the deterministic chaser, never instead of it.
     *
     * `chase_invoices` fires on days 1, 3 and 7 past due and then stops. This
     * agent works the tail it leaves behind — which is why the plan's filter
     * excludes anything still inside those milestones. Four real invoices
     * reached 13 to 31 days overdue in exactly that gap, with the chaser
     * switched on the whole time.
     */
    worksAlongside: 'chase_invoices',
    /*
     * `business-os` only. It is the surface the agent pipeline can see — the
     * capability plugins carry `visibility: "business_os"` and are hidden from
     * discovery — and the only one whose send is capped, quota'd and
     * dry-runnable.
     */
    pluginsRequired: ['business-os'],
    /*
     * Weekly by default, because this writes to a client about money. The
     * deterministic chaser has already asked three times by the time anything
     * reaches this agent, and a fourth ask the next morning reads as pestering
     * rather than diligence. The owner can choose otherwise.
     */
    defaultCron: CADENCE_CRON.weekly,
    cadenceChoices: ['weekly', 'every_3_days', 'daily', 'fortnightly'],
    /* Two months past due by default. The deterministic chaser has already asked three times; beyond this an invoice wants a phone call or a write-off, not another email. */
    defaultStopAfterDays: 60,
    stopAfterChoices: [30, 60, 90, 120],
    steps: chaseOverdueInvoicesSteps,
  },
  {
    id: 'follow_up_new_enquiries',
    nameKey: 'automation.follow_up_new_enquiries.name',
    descriptionKey: 'automation.follow_up_new_enquiries.description',
    watchesKey: 'automation.follow_up_new_enquiries.watches',
    /*
     * `send_followup_nudge` is paired with eight detectors across FOUR
     * different intents — a new enquiry, a stalled deal, a lapsed client, a
     * follow-up after an intro. This agent answers the first only.
     *
     * They are not flavours of one message. A lapsed client is reached under
     * MARKETING consent, with an opt-in gate the others do not need, and
     * approving "follow up on my enquiries" is not approving "email people who
     * stopped buying two years ago". One press cannot stand for both, which is
     * why the intents get separate agents rather than one with a parameter.
     */
    answersProcess: 'send_followup_nudge',
    /*
     * The four detectors that mean "somebody is in the pipeline and nothing is
     * happening". Every one of them reports CONTACTS — checked, not inferred:
     * `affectedEntityType: 'contact'` on each, and `conv_pipeline_stuck` and
     * `conv_stage_dropoff` both exclude client and terminal stages, so their
     * people are pre-client and the find's `has_bookings false` fits them.
     *
     * `conv_pipeline_stuck` and `conv_stage_dropoff` were first given to
     * `follow_up_stalled_deals` on the strength of their names — "pipeline",
     * "deal" — and that was wrong in the way that matters. A live card about
     * two contacts stuck at `lead` offered to chase their quotes; neither has
     * ever been sent one, so the agent would have run fortnightly and done
     * nothing while reporting success.
     */
    /*
     * ───────────────────────────────────────────────────────────────────────
     * ONE DETECTOR, BECAUSE THE FIND BELOW ONLY FITS ONE POPULATION.
     *
     * This agent finds contacts with `has_bookings false`: people who got in
     * touch and never booked anything. `crm_cold_leads` reports exactly those.
     *
     * The other three were claimed on the strength of all four reporting
     * CONTACTS, which is true and is not enough:
     *
     *   conv_pipeline_stuck   a contact idling in a stage. May have booked
     *                         before; on a live account the one it named had.
     *   conv_no_next_step     the catalogue's own "broadest detector":
     *                         ANYBODY with history and nothing scheduled next.
     *                         Its own card says "people who were active before".
     *   conv_stage_dropoff    a stage people reach and never move past, at any
     *                         point in the journey.
     *
     * Checked on the live account that raised it: all four people across those
     * two cards had bookings, so this agent's find would have returned zero for
     * every one of them. The card offered an agent that covered nobody on it.
     *
     * The second time this exact mistake has been made — see the note on
     * `follow_up_stalled_deals` — and the guard that caught the first only
     * compares the ENTITY, which is `contact` on both sides here. The rule the
     * entity check cannot express: the detector's population has to be inside
     * the agent's find, not merely the same kind of thing.
     *
     * What those three need is an agent whose find is "has history, nothing in
     * the diary ahead". That is a different message as well as a different
     * query, which is the whole reason it cannot be this one.
     * ───────────────────────────────────────────────────────────────────────
     */
    answersDetectors: ['crm_cold_leads'],
    /*
     * `reply_to_enquiries` sends the booking link, then one chase five days
     * later, and stops. This picks up what is still quiet after that — the
     * same hand-off the invoice agent makes, and the reason the find excludes
     * anything newer than a week.
     */
    worksAlongside: 'reply_to_enquiries',
    /*
     * Not offered until the platform may lawfully send on the owner's behalf.
     *
     * `invite_contacts` sends through `sendBookingLink` with
     * `trigger: 'automated'`, which is `kind: 'marketing'` — the strict reading
     * the service itself documents, and the same one the deterministic chaser
     * takes. `marketingGate` refuses every marketing send while
     * `MARKETING_SENDING_ENABLED` is false, so without this gate the owner
     * would activate a follow-up, be told it is running, and nothing would
     * leave. Offering it is the lie, not the gate.
     */
    requires: 'can_send_marketing',
    pluginsRequired: ['business-os'],
    /*
     * Weekly. Every run writes a NEW message to a person who has already been
     * contacted twice by the deterministic chaser, and a third voice arriving
     * daily is how a small business gets marked as spam.
     */
    defaultCron: CADENCE_CRON.weekly,
    cadenceChoices: ['weekly', 'fortnightly', 'every_3_days'],
    /* Six weeks. An enquiry older than that is somebody who found another business, and the sentence this agent writes would read as though nobody had noticed. */
    defaultStopAfterDays: 45,
    stopAfterChoices: [14, 30, 45, 90],
    steps: followUpNewEnquiriesSteps,
  },
  {
    id: 'follow_up_stalled_deals',
    nameKey: 'automation.follow_up_stalled_deals.name',
    descriptionKey: 'automation.follow_up_stalled_deals.description',
    watchesKey: 'automation.follow_up_stalled_deals.watches',
    answersProcess: 'send_followup_nudge',
    /*
     * ───────────────────────────────────────────────────────────────────────
     * NOT OFFERED FROM A CARD, AND THE REASON IS NOT A GAP IN THIS FILE.
     *
     * Nothing detects an unanswered quote. Every "conversion" detector that
     * sounded like it does is about a CONTACT idling in a stage, and the one
     * detector that genuinely reads quotes — `conv_quote_acceptance_drop` —
     * sets `pairedProcessId: undefined` on purpose, because it fires on quotes
     * that were DECLINED and nudging someone who said no is worse than
     * silence.
     *
     * So the agent is correct and has no trend to be adopted from. It stays in
     * the catalogue, installable by id, until either a detector reports
     * unanswered quotes or an automations screen lets an owner pick one
     * directly. The flag is what stops it becoming the process fallback and
     * being offered for every detector the other agents have not claimed.
     * ───────────────────────────────────────────────────────────────────────
     */
    offeredFromInsight: false,
    requires: 'sends_quotes',
    /*
     * `chase_quotes` nudges once, 72 hours after the quote goes out, and
     * stops. This takes the tail — which is why the find excludes anything
     * sent in the last week.
     */
    worksAlongside: 'chase_quotes',
    pluginsRequired: ['business-os'],
    /*
     * Fortnightly. A quote has a shelf life and the client already has it;
     * asking every few days about a decision they have not made turns a
     * considered offer into pressure.
     */
    defaultCron: CADENCE_CRON.fortnightly,
    cadenceChoices: ['fortnightly', 'weekly'],
    /* Six weeks, which was the hardcoded 45 before this became a choice. A quote that old wants re-quoting, not another nudge. */
    defaultStopAfterDays: 45,
    stopAfterChoices: [30, 45, 60, 90],
    steps: followUpStalledDealsSteps,
  },
  {
    id: 'rebook_quiet_clients',
    nameKey: 'automation.rebook_quiet_clients.name',
    descriptionKey: 'automation.rebook_quiet_clients.description',
    watchesKey: 'automation.rebook_quiet_clients.watches',
    answersProcess: 'send_followup_nudge',
    /*
     * ───────────────────────────────────────────────────────────────────────
     * THE THREE DETECTORS THAT MEAN "A CLIENT HAS STALLED".
     *
     * The dedupe registry already calls the first two one problem — its
     * opening entry is `['conv_pipeline_stuck', 'conv_no_next_step']`, "both
     * say this contact is not moving" — and keeps them as separate CARDS only
     * because the first names the stage and the days while the second carries
     * everybody else. `conv_stage_dropoff` is the same shape a third time.
     *
     * One conclusion, one action, one agent. They were briefly given to
     * `follow_up_new_enquiries`, whose find is `has_bookings false`, and on
     * the live account every person they named had bookings — so that agent
     * reached none of them. This is the agent whose find actually fits.
     * ───────────────────────────────────────────────────────────────────────
     */
    answersDetectors: ['conv_pipeline_stuck', 'conv_no_next_step', 'conv_stage_dropoff'],
    requires: 'takes_bookings',
    /*
     * Nothing deterministic covers this. `reply_to_enquiries` answers people
     * who have never been in; nothing at all speaks to a client who came last
     * month and booked nothing after.
     */
    pluginsRequired: ['business-os'],
    /*
     * Fortnightly. These are people the business has actually seen, so the
     * message is ordinary rather than a chase — and a reminder about the next
     * appointment every few days reads as a business that needs the money.
     */
    defaultCron: CADENCE_CRON.fortnightly,
    cadenceChoices: ['fortnightly', 'weekly', 'monthly'],
    /* Six months, which is also the boundary with `win_back_quiet_clients`: past it, that agent takes over and this one must let go or both would write to the same person. */
    defaultStopAfterDays: 180,
    stopAfterChoices: [90, 180, 270],
    steps: rebookQuietClientsSteps,
  },
  {
    id: 'recover_abandoned_checkouts',
    nameKey: 'automation.recover_abandoned_checkouts.name',
    descriptionKey: 'automation.recover_abandoned_checkouts.description',
    watchesKey: 'automation.recover_abandoned_checkouts.watches',
    answersProcess: 'send_followup_nudge',
    answersDetectors: ['conv_abandoned_bookings'],
    requires: 'takes_bookings',
    /*
     * The sweep at `/api/cron/abandoned-bookings` sends ONE recovery email per
     * attempt and stamps `recovery_email_sent_at`, then stops. That stamp is
     * its end of life, and this agent's find uses it as the hand-off: only
     * attempts the sweep has finished with.
     */
    worksAlongside: 'abandoned_recovery',
    pluginsRequired: ['business-os'],
    /*
     * Weekly, and no faster. Somebody who left at the payment step made a
     * decision; a second message is reasonable and a third every few days is
     * pressure about money.
     */
    defaultCron: CADENCE_CRON.weekly,
    cadenceChoices: ['weekly', 'fortnightly', 'monthly'],
    /* Three weeks. Past that a cart is cold and the service, the time and
       possibly the price have all moved on. */
    defaultStopAfterDays: 21,
    stopAfterChoices: [14, 21, 45],
    steps: recoverAbandonedCheckoutsSteps,
  },
  {
    id: 'win_back_quiet_clients',
    nameKey: 'automation.win_back_quiet_clients.name',
    descriptionKey: 'automation.win_back_quiet_clients.description',
    watchesKey: 'automation.win_back_quiet_clients.watches',
    answersProcess: 'send_followup_nudge',
    /*
     * The three detectors about a relationship going quiet: they stopped
     * rebooking, they stopped answering, or they took the intro offer and
     * never came back for the real thing.
     *
     * The fourth intent on this process — a client whose PACKAGE is ending —
     * is deliberately not here. That person is mid-commitment and still
     * coming, which is a different message and arguably a different consent
     * class, and the find it needs ("their last remaining instalment of at
     * least three") cannot be written in the query grammar today.
     */
    answersDetectors: ['ret_repeat_booking_low', 'crm_engagement_decay', 'pricing_intro_offer_stuck'],
    /*
     * The six-month line is shared with `rebook_quiet_clients`, and it is what
     * keeps the two off the same person: that agent takes clients seen WITHIN
     * six months, this one takes those quiet for longer. Both finds draw it,
     * from opposite sides.
     */
    /*
     * The strictest requirement any agent carries, and the right one. Writing
     * to somebody who stopped buying is marketing by any reading — there is no
     * enquiry to answer and no transaction in progress — so this is offered
     * only once the platform can send marketing at all AND the owner has the
     * postal address CAN-SPAM wants in the footer. Each recipient's own
     * consent is then checked again at the transport, per person.
     */
    requires: 'can_send_marketing',
    /*
     * Nothing to stand alongside: no deterministic chaser reaches a lapsed
     * client. This is the one automation with no existing tail to pick up,
     * which is also why it is the one most likely to surprise somebody.
     */
    pluginsRequired: ['business-os'],
    /*
     * Monthly, and the choices stop at fortnightly. Ten people a month is a
     * business thinking of someone; the same list every three days is the
     * mailshot this product exists not to be.
     */
    defaultCron: CADENCE_CRON.monthly,
    cadenceChoices: ['monthly', 'fortnightly'],
    /* Eighteen months. Somebody who has not been seen for longer has left, and writing to them is a cold mailshot however it is worded. */
    defaultStopAfterDays: 540,
    stopAfterChoices: [365, 540, 730],
    steps: winBackQuietClientsSteps,
  },
  {
    id: 'draft_client_replies',
    nameKey: 'automation.draft_client_replies.name',
    descriptionKey: 'automation.draft_client_replies.description',
    watchesKey: 'automation.draft_client_replies.watches',
    /*
     * NOTHING REPORTS THIS TREND, so the process named here is inert and the
     * flag below is what makes that true rather than a hope.
     *
     * No detector concludes "a client wrote back and nobody answered", and
     * `TRIGGERABLE_PROCESSES` holds nothing for it either: the closest entry,
     * `draft_reply_templates`, is `eligibleForAutomation: false`, carries
     * `entityType: 'template'`, and exists to generate a handful of REUSABLE
     * templates for common enquiry types. That is a different job from
     * answering one person. So this names the nearest process and is then
     * removed from both joins, exactly as `follow_up_stalled_deals` is.
     */
    answersProcess: 'send_followup_nudge',
    /*
     * Shipped, never offered from a card, and the guard asserts it is
     * unreachable through either join. Without it, an agent naming no detectors
     * becomes the fallback for its whole process — which would offer "shall I
     * draft replies to your clients" on a card about two contacts idling at
     * `lead` who have never emailed anybody.
     *
     * The owner finds it in the "Also available" list instead, which exists for
     * exactly the agents in this position: `availableAutomations` offers those
     * and ONLY those marked `offeredFromInsight: false`, because an agent with
     * detectors behind it is meant to arrive on a card carrying its evidence.
     * That list is this agent's whole discovery, so it needs no card.
     *
     * (An earlier version of this note said the agent was installed for every
     * business from the start, switched off. Nothing installs it: there is no
     * seeding path in the codebase, and the list is what replaced that idea.)
     */
    offeredFromInsight: false,
    /*
     * THE FIRST ENTRY TO NAME A PLUGIN THAT IS NOT `business-os`.
     *
     * The catalogue's rule is that an action touching this business's own data
     * goes through `business-os`, because that door carries tenant scoping and
     * is the one whose writes are capped and quota'd. It was written as
     * "business-os only", which was true by accident while all six plans were
     * data-only chasers. Gmail is not our data layer, and on a plugin platform
     * an agent reading a mailbox is ordinary.
     *
     * `plugins_required` is the column the runtime grants the run from, so it
     * must name both plugins the plan actually calls or the run fails inside a
     * cron where nobody is watching.
     */
    pluginsRequired: ['business-os', 'google-mail'],
    /*
     * Daily, and deliberately no faster.
     *
     * The owner reads a draft before anything reaches a client, so a tighter
     * loop buys them nothing they would notice. It also keeps the cost honest:
     * one pass over yesterday's replies, rather than re-reading the same
     * unanswered message every few minutes.
     *
     * Slower is offered because a business that gets two emails a week does not
     * want this running every morning.
     */
    defaultCron: CADENCE_CRON.daily,
    cadenceChoices: ['daily', 'every_3_days', 'weekly'],
    /*
     * THE STOP RULE MEANS SOMETHING DIFFERENT HERE, and it is still the same
     * sentence: stop considering anything older than this.
     *
     * Elsewhere it bounds how long to keep chasing one person. Here it bounds
     * how far back the agent reads a client's history with this business when
     * working out what their reply refers to. Fourteen days keeps the context
     * relevant and still covers a quote sent a fortnight ago; past it, a reply
     * is answered on its own words or handed to the owner.
     */
    defaultStopAfterDays: 14,
    stopAfterChoices: [7, 14, 30],
    /*
     * THE GMAIL HALF OF ONE CHOICE. See `variantGroup` on the type for why the
     * same job is two entries and one row. This one is the default because an
     * owner who has connected no mailbox yet has to be shown something, and
     * Gmail is the commoner of the two among small businesses.
     */
    variantGroup: 'draft_client_replies',
    variantPlugin: 'google-mail',
    variantDefault: true,
    steps: draftClientRepliesSteps,
  },
  {
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE OUTLOOK HALF, and nothing above the plan differs.
     *
     * It shares the three translation keys with the Gmail entry on purpose: the
     * agent does the same thing, so describing it differently would invent a
     * distinction the owner does not have. Only one of the two is ever offered,
     * which is what makes one set of words correct for both.
     *
     * `pluginsRequired` is the whole reason this is a separate entry rather
     * than a branch inside one. It is the column the runtime grants a run
     * from, so an entry naming both mail plugins would require an owner to
     * connect Gmail AND Outlook before either plan could run.
     *
     * Everything else is held equal deliberately — the same cadence choices,
     * the same stop rule, the same meaning for it — so that a difference
     * between the two files is always a difference Graph forced, never a
     * decision taken twice.
     * ─────────────────────────────────────────────────────────────────────────
     */
    id: 'draft_client_replies_outlook',
    nameKey: 'automation.draft_client_replies.name',
    descriptionKey: 'automation.draft_client_replies.description',
    watchesKey: 'automation.draft_client_replies.watches',
    answersProcess: 'send_followup_nudge',
    offeredFromInsight: false,
    pluginsRequired: ['business-os', 'outlook'],
    defaultCron: CADENCE_CRON.daily,
    cadenceChoices: ['daily', 'every_3_days', 'weekly'],
    defaultStopAfterDays: 14,
    stopAfterChoices: [7, 14, 30],
    variantGroup: 'draft_client_replies',
    variantPlugin: 'outlook',
    steps: draftClientRepliesOutlookSteps,
  },
  {
    id: 'import_leads_from_sheet',
    nameKey: 'automation.import_leads_from_sheet.name',
    descriptionKey: 'automation.import_leads_from_sheet.description',
    watchesKey: 'automation.import_leads_from_sheet.watches',
    /* Inert, as for `draft_client_replies`: no detector reports "there are
       leads in a spreadsheet nobody has filed", and nothing in
       `TRIGGERABLE_PROCESSES` comes near it. Named only because the field is
       required, and unreachable through either join because of the flag below. */
    answersProcess: 'send_followup_nudge',
    offeredFromInsight: false,
    /*
     * The plan reads a mailbox-shaped thing it does not own, so the owner's
     * own Sheets connection is what grants it. `business-os` is the other half
     * — the CRM lookup and the contact write both go through our own door,
     * which is what carries tenant scoping.
     */
    pluginsRequired: ['business-os', 'google-sheets'],
    /*
     * The two the owner must answer, named after the plugin parameters they
     * fill so the agent page finds the right dropdown for each.
     *
     * `spreadsheet_id` matches the Sheets parameter carrying
     * `x-dynamic-options: { source: 'list_spreadsheets' }`, and `range` matches
     * the one carrying `list_sheet_names` with `depends_on: ['spreadsheet_id']`.
     * That dependency is why the tab list reloads from whichever spreadsheet
     * was picked, and why neither needs a wizard of its own.
     *
     * Named differently, both would render as text boxes and the owner would
     * be left pasting an id out of a URL.
     */
    inputSchema: [
      {
        name: 'spreadsheet_id',
        type: 'string',
        required: true,
        description: 'Which spreadsheet holds your leads',
        options: { plugin: 'google-sheets', action: 'read_range', parameter: 'spreadsheet_id' },
      },
      {
        name: 'range',
        type: 'string',
        required: true,
        description: 'Which tab to read',
        /* Reloads from whichever spreadsheet was chosen, and stays disabled
           until one is. The Sheets plugin declares the same dependency on this
           parameter; stating it here is what lets the dialog honour it before
           an agent exists to read that declaration from. */
        options: {
          plugin: 'google-sheets',
          action: 'read_range',
          parameter: 'range',
          dependsOn: ['spreadsheet_id'],
        },
      },
      {
        name: 'email_column',
        type: 'string',
        required: true,
        description: 'Which column holds the email address',
        /*
         * ASKED, NOT MEASURED, and this is the field that decides it.
         *
         * An earlier version had a model work out which column held what. It
         * could not invent an address — the prompt forbade it — but nothing
         * stopped it picking the WRONG column, and the result is contacts
         * filed under addresses that belong to somebody else. That is the only
         * failure in this agent that reaches real people.
         *
         * A spreadsheet's columns are a short, visible list, so asking costs
         * one dropdown and removes the failure entirely. The mailbox channel
         * measures because you cannot ask somebody to describe their email
         * format; that reasoning does not carry across, which is what I got
         * wrong first time.
         */
        options: {
          plugin: 'google-sheets',
          action: 'read_range',
          parameter: 'column',
          dependsOn: ['spreadsheet_id', 'range'],
        },
      },
      {
        name: 'name_column',
        type: 'string',
        required: true,
        description: 'Which column holds their name',
        /* Required because `create_contacts` will not accept a contact
           without a first name. */
        options: {
          plugin: 'google-sheets',
          action: 'read_range',
          parameter: 'column',
          dependsOn: ['spreadsheet_id', 'range'],
        },
      },
      {
        name: 'phone_column',
        type: 'string',
        required: false,
        description: 'Which column holds their phone, if any',
        options: {
          plugin: 'google-sheets',
          action: 'read_range',
          parameter: 'column',
          dependsOn: ['spreadsheet_id', 'range'],
        },
      },
    ],
    /*
     * Daily. A lead that sits in a spreadsheet for a week is a lead the
     * business has already half lost, and the run is cheap: one read, one
     * model call, and a CRM lookup only for people the sheet actually holds.
     *
     * Slower is offered for a sheet that is really an archive rather than a
     * live list.
     */
    defaultCron: CADENCE_CRON.daily,
    cadenceChoices: ['daily', 'every_3_days', 'weekly'],
    /*
     * NO STOP RULE, and its absence is the honest answer rather than an
     * omission.
     *
     * Everywhere else it means "stop considering anything older than this",
     * which needs something with a date. A spreadsheet row has no age: it is
     * the same row whether it was typed this morning or last year, so any
     * number offered here would be a control over nothing, shown to an owner
     * as though it did something.
     *
     * The field is optional for exactly this, and the guard that requires every
     * plan to spend a stop rule now reads the declaration rather than assuming
     * one.
     */
    steps: importLeadsFromSheetSteps,
  },
];

/** One automation by its id, or nothing. */
export function automationById(id: string): AutomationAgent | undefined {
  return AUTOMATION_AGENTS.find(automation => automation.id === (id as AutomationAgentId));
}

/**
 * The automation that answers this insight, if we ship one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The one join. The advisor card holds an insight, the insight holds
 * `paired_process_id`, and this says whether there is an agent for it — the
 * same shape the card already uses to find the operational automation covering
 * the same process.
 *
 * Returns the FIRST match deliberately: two automations claiming one process is
 * a catalogue mistake, and the guard beside this file fails the build for it
 * rather than letting the order of an array decide what an owner is offered.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function automationForProcess(processId: string | undefined): AutomationAgent | undefined {
  if (!processId) return undefined;
  return AUTOMATION_AGENTS.find(
    automation =>
      automation.answersProcess === processId &&
      !automation.answersDetectors &&
      automation.offeredFromInsight !== false
  );
}

/**
 * The agent to offer for THIS insight.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Detector first, process second, and the order is the whole point.
 *
 * Eight detectors reach `send_followup_nudge` carrying four different intents,
 * and one of them — reaching a client who stopped buying — is marketing, with
 * a consent gate the others do not need. An agent that names its detectors is
 * answering a narrower question than the process, so it wins.
 *
 * The fallback is for agents that genuinely cover a whole process. The invoice
 * chaser is one: its four detectors all conclude the same thing, and splitting
 * them would be four presses for one decision.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function automationForInsight(insight: {
  detector_id?: string;
  paired_process_id?: string;
}): AutomationAgent | undefined {
  const byDetector = insight.detector_id
    ? AUTOMATION_AGENTS.find(
        automation =>
          automation.offeredFromInsight !== false &&
          automation.answersDetectors?.includes(insight.detector_id as string)
      )
    : undefined;

  return byDetector ?? automationForProcess(insight.paired_process_id);
}

/**
 * The deterministic chasers these automations work alongside.
 *
 * Nothing is switched off: the chaser keeps its milestone days and the agent
 * takes the tail. This exists so a screen can SAY that — "runs after your
 * invoice chaser finishes" is the sentence that stops an owner assuming one
 * replaced the other.
 */
export function worksAlongside(ids: string[]): string[] {
  return ids
    .map(id => automationById(id)?.worksAlongside)
    .filter((name): name is string => Boolean(name));
}
