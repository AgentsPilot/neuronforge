/*
 * The receptionist may answer, and a refund request may be marked handled.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO UNRELATED COLUMNS, ONE MIGRATION, BECAUSE THEY SHIP TOGETHER.
 *
 * 1. `business_profiles.agents_may_reply_directly` — whether this business
 *    lets an agent send to a client, or wants a draft it presses send on.
 * 2. `refund_requests.status` gains 'handled', and the table gains
 *    `source_thread_id` so a decision can settle the conversation it came from.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE SWITCH IS A BUSINESS SETTING AND NOT AN AGENT ONE
 *
 * "May an agent speak to my clients" is a question about the business, not
 * about one automation. An owner who answers no means it for every agent they
 * ever install, and storing it per agent would ask them again each time — and
 * get a different answer each time, which is worse than no answer.
 *
 * It is also not a plan input: `planInputs` returns `Record<string, number>`,
 * so a mode could only ride in as 0 or 1, and a boolean smuggled through a
 * numeric channel is the kind of thing that reads as a count six months later.
 *
 * DEFAULT FALSE, AND THAT IS THE WHOLE POINT. Every business already running
 * the receptionist has it on the understanding that it writes drafts and sends
 * nothing. Flipping that silently would be the platform deciding, on their
 * behalf, that an agent may now write to their clients. They turn it on.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY 'handled' IS ITS OWN STATUS
 *
 * The owner can answer a refund request three ways: return the money, say no,
 * or deal with it themselves — a bank transfer, a phone call, something agreed
 * off the record.
 *
 * That third one has no honest home in the existing set. `refunded` claims
 * money moved through us, and `payment_refunds` would disagree. `declined`
 * claims they said no, which may be the opposite of what happened. `superseded`
 * means the money came back another way, which is only sometimes true.
 *
 * So: 'handled' — the owner says this is dealt with, and the platform does not
 * claim to know how. It is terminal, and the refund agent reads only
 * 'submitted', so a handled row is never looked at again.
 *
 * Requirement: docs/requirements/BUSINESS_OS_RECEPTIONIST_SENDS_REQUIREMENT.md
 */

BEGIN;

/* ── 1. MAY AN AGENT WRITE TO THIS BUSINESS'S CLIENTS? ────────────────── */

ALTER TABLE public.business_profiles
  ADD COLUMN IF NOT EXISTS agents_may_reply_directly boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.business_profiles.agents_may_reply_directly IS
  'Whether an agent may SEND to a client, or must leave a draft for the owner. '
  'Default false: every existing install runs on the understanding that nothing '
  'reaches a client without the owner pressing send. Only ever lets an agent '
  'send a LINK to a self-service page the client then acts on — never a price, '
  'a time or a commitment, which stay drafts whatever this says.';

/* ── 2. A REFUND REQUEST CAN BE MARKED HANDLED ────────────────────────── */

ALTER TABLE public.refund_requests DROP CONSTRAINT IF EXISTS refund_requests_status_check;

ALTER TABLE public.refund_requests
  ADD CONSTRAINT refund_requests_status_check
  CHECK (status IN (
    'submitted',
    'assessing',
    'awaiting_owner',
    'refunded',
    'declined',
    /*
     * The owner dealt with it outside the platform. Terminal, and deliberately
     * silent about how: see the header. The agent reads only 'submitted', so
     * this is never picked up again.
     */
    'handled',
    'withdrawn',
    'superseded'
  ));

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CONVERSATION IT CAME FROM.
 *
 * A request that began as an email has a mail thread behind it, and the
 * receptionist's own row for that thread is what `client_reply_waiting` reads
 * to decide whether somebody is still waiting for a reply.
 *
 * Without this column the two are joined only by contact, which is the same
 * mistake `client_reply_waiting` already made once: one settled conversation
 * silenced every other escalation from that person. Marking a refund handled
 * must settle THAT thread and no other.
 *
 * Null for a request raised from the portal, which has no conversation.
 * ─────────────────────────────────────────────────────────────────────────────
 */
ALTER TABLE public.refund_requests
  ADD COLUMN IF NOT EXISTS source_thread_id text;

CREATE INDEX IF NOT EXISTS idx_refund_requests_thread
  ON public.refund_requests(user_id, source_thread_id)
  WHERE source_thread_id IS NOT NULL;

COMMIT;
