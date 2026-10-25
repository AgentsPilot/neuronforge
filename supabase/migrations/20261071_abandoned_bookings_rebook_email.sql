/*
 * What the abandoned-booking email needs in order to be worth sending.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The email tells a client "you were looking at <service> on <date>" and offers
 * one button: book it again. Two things were missing for that.
 *
 *   `page_url`  — where to send them back to. Resolvable from the service and
 *                 the business, but only by rebuilding a URL the client already
 *                 had: a booking page can be reached by subdomain, by custom
 *                 domain, through a landing page or from a smart link, and a
 *                 reconstructed link drops whatever brought them. The browser
 *                 already sends this to `create`; it was simply not stored.
 *
 *   `locale`    — which language to write in. The booking widget already knows
 *                 ('en' | 'es' | 'he') because it renders in it. Guessing from
 *                 the business's own language would write to an English-speaking
 *                 client of a Hebrew business in Hebrew.
 *
 * The service itself is already on the row as `service_id`, so the email can
 * name what they were booking without a second lookup against a service that
 * may since have been renamed.
 * ─────────────────────────────────────────────────────────────────────────────
 */

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.abandoned_bookings
  /* The page the client was actually on, exactly as they reached it — so the
     rebook button returns them there and not to a reconstructed equivalent. */
  ADD COLUMN IF NOT EXISTS page_url text,

  /* The language the booking page was rendering in when they filled it in.
     Null means unknown, and the sender falls back to the business's own. */
  ADD COLUMN IF NOT EXISTS locale text,

  /*
   * When the abandoned-booking email went out.
   *
   * Null means not sent. It exists so the sender can never send twice: a
   * chaser that re-reads the same `abandoned` rows on its next run would mail
   * the same person every time it ran, which is the fastest way to turn a
   * useful nudge into a spam complaint.
   */
  ADD COLUMN IF NOT EXISTS recovery_email_sent_at timestamptz;

/*
 * The sender's own query: rows worth emailing, oldest first.
 *
 * Partial on exactly the condition the sender uses, so it stays small — most
 * rows are converted, and every row it has already handled drops out of the
 * index rather than being filtered out of a scan.
 */
CREATE INDEX IF NOT EXISTS abandoned_bookings_to_recover_idx
  ON public.abandoned_bookings (user_id, created_at)
  WHERE status = 'abandoned' AND recovery_email_sent_at IS NULL;

COMMENT ON COLUMN public.abandoned_bookings.page_url IS
  'The booking page the client was on, for the rebook link. Stored rather than rebuilt: a page reached by custom domain, landing page or smart link cannot be reconstructed from the service alone.';

COMMENT ON COLUMN public.abandoned_bookings.recovery_email_sent_at IS
  'When the abandoned-booking email was sent. Null means never. Guarantees one email per attempt, however often the sender runs.';

COMMIT;
