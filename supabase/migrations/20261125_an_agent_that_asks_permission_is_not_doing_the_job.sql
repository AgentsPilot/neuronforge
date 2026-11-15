/*
 * Removing a switch that should never have been added.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT WAS FOR, AND WHY THAT WAS WRONG.
 *
 * 20261124 added `business_profiles.agents_may_reply_directly`, on the
 * reasoning that teaching the receptionist to send was a new kind of trust and
 * ought to be asked for.
 *
 * It was asked a day later which OTHER agents send email, and the answer made
 * the switch indefensible. Six of the nine catalogue agents already write to
 * clients unprompted:
 *
 *   chase_overdue_invoices        remind_invoices
 *   follow_up_new_enquiries       invite_contacts
 *   follow_up_stalled_deals       remind_proposals
 *   rebook_quiet_clients          invite_contacts
 *   recover_abandoned_checkouts   remind_abandoned_bookings
 *   win_back_quiet_clients        invite_contacts
 *
 * None of them has a permission flag. The control they share is the one every
 * agent has: install it, or pause it. The receptionist was not the one agent
 * that could not be trusted to send — it was the odd one out for not sending.
 *
 * And of all of them, a DOOR is the weakest send: a link to a page the client
 * chooses whether to open, carrying no price, no time and no commitment. A
 * second gate on that one, while an invoice chase goes out unasked, is an
 * inconsistency dressed as caution.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE REASON THAT DECIDED IT
 *
 * An agent exists to take a job off the owner. A door the owner has to approve
 * is the owner handling the request — the same email in their inbox, one extra
 * click, and the feature has bought them nothing.
 *
 * What keeps the send safe is not permission. It is that
 * `send_portal_door_contacts` takes a door from a closed list and the sentence
 * comes from a table with no free-text field, so the agent decides where to
 * point and can never decide what to say. That property is structural and
 * survives this column being gone.
 *
 * Dropped rather than left unused: a column nothing reads is a question the
 * next person has to answer before they can change anything near it.
 */

BEGIN;

ALTER TABLE public.business_profiles
  DROP COLUMN IF EXISTS agents_may_reply_directly;

COMMIT;
