/*
 * WHAT a message was, recorded rather than read back out of its subject line.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE JOURNEY COULD NOT SAY
 *
 * The contact drawer's rail prints the raw subject of every mail it shows, so a
 * booking that was rescheduled twice reads:
 *
 *   ✉ נשלח ללקוח הפגישה שלך אושרה - הצעת מחיר לשיפוץ
 *   ✉ נשלח ללקוח הפגישה נקבעה מחדש - הצעת מחיר לשיפוץ
 *   ✉ נשלח ללקוח התגעגענו אליך - הצעת מחיר לשיפוץ
 *
 * The service name repeats on every row and carries nothing: it is one booking,
 * so it is the same service throughout. What the owner wants to know is which
 * KIND of message went out, and the subject is a poor way to ask — it is
 * composed for the client, in the client's language, and a template change
 * silently changes the meaning of any code matching on it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A COLUMN AND NOT A LOOKUP
 *
 * Every sender already knows what it is sending; the fact was simply discarded
 * at the point of writing. Recovering it afterwards means matching Hebrew,
 * English and Spanish subject templates against free text, which fails for any
 * account whose client language differs from the owner's. That is the same
 * mistake `is_resend` was added to avoid.
 *
 * TEXT rather than an enum, deliberately. A new kind of mail should not need a
 * migration to be recorded, and an unrecognised value degrades to the subject,
 * which is exactly today's behaviour.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FORWARD-ONLY, AND NO BACKFILL
 *
 * Existing rows keep NULL. There is no honest way to assign a kind to mail sent
 * before anything recorded one: the subject is the only evidence, and inferring
 * from it is the very thing this column exists to stop. The rail falls back to
 * the subject for those rows, so they render exactly as they do today.
 *
 * Plan: docs/workplans/BOOKING_MEETINGS_TABLE_PLAN.md (Phase 4d)
 * ─────────────────────────────────────────────────────────────────────────────
 */

BEGIN;

ALTER TABLE public.email_sends
  ADD COLUMN IF NOT EXISTS email_kind text;

COMMENT ON COLUMN public.email_sends.email_kind IS
  'What this message was, as its sender knew it: booking_confirmed, booking_rescheduled, missed_appointment, meeting_reminder, payment_receipt and so on. Set by lib/notifications/recordEmailSend.ts, which is the only writer. NULL on rows predating 20261081 — there is no honest way to assign one retrospectively, and the journey falls back to the subject. Deliberately not an enum: a new kind of mail should not need a migration.';

/*
 * The journey reads a contact's mail newest-first and then buckets it by kind.
 * Narrow enough to be worth having and cheap to maintain at this table's write
 * rate.
 */
CREATE INDEX IF NOT EXISTS idx_email_sends_kind
  ON public.email_sends (email_kind)
  WHERE email_kind IS NOT NULL;

COMMIT;
