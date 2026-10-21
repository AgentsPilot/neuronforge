/**
 * Every session of a package, as the CLIENT should see it in an email.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE WHOLE LIST, AND NOT JUST THE ONE THAT CHANGED
 *
 * A client holding six sessions reads "your meeting has been moved" or "the
 * meeting below will not take place" and is left to work out what that leaves
 * them with. They have no drawer to open and no table to look at: the email is
 * the only record they have of a block they paid for.
 *
 * So the email that tells them about ONE session also shows them all of them,
 * with what has happened to each and what it cost. The one that changed is
 * marked, and the rest answer the question the change raises — "so what do I
 * still have?" — without them having to ask.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE LINE PER SESSION, NOT PER ATTEMPT
 *
 * A moved session has two rows in the table: the hour it was for, stamped
 * `moved`, and the hour it is for now. The client was told about both at the
 * time and needs only the second — listing the superseded one would show them
 * a date nobody is expecting them at.
 *
 * The money follows the same rule. A stage is bound to the attempt that holds
 * the hour (`moveMeeting` carries it across), so reading the current attempt's
 * stage is reading what this session actually costs.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'packageSessionLines' });

/** What has happened to one session, in words the client's email can use. */
export type SessionState = 'upcoming' | 'held' | 'missed' | 'cancelled';

export interface PackageSessionLine {
  /** 1-based, the order the sessions were sold in. */
  number: number;
  start: string;
  state: SessionState;
  /** What this session costs, where it is billed one session at a time. */
  amount: number | null;
  currency: string | null;
  /**
   * Settled, still owed, or returned — null when there is no stage at all.
   *
   * `partly_refunded` is its own answer: any refund used to read as the whole
   * amount coming back, so a session paid 133.33 with 66.67 returned told the
   * client they had been refunded in full.
   */
  money: 'paid' | 'due' | 'refunded' | 'partly_refunded' | null;
  /** What came back, where some of it did. */
  refunded: number | null;
  /** The session this email is about, so the client can find it in the list. */
  isSubject: boolean;
}

/**
 * @param bookingId the PURCHASE — a package is one booking with N meetings.
 * @param subjectMeetingId the session the email is about, marked in the list.
 * @returns [] for an ordinary booking, which has no sessions to list.
 */
export async function packageSessionLines(
  bookingId: string,
  userId: string,
  subjectMeetingId?: string | null
): Promise<PackageSessionLine[]> {
  try {
    const { data: rows, error } = await supabaseServer
      .from('scheduling_meetings')
      .select('id, start_time, meeting_status, session_number, occurrence_number')
      .eq('booking_id', bookingId)
      .eq('user_id', userId)
      .not('session_number', 'is', null)
      .order('session_number', { ascending: true })
      .order('occurrence_number', { ascending: true });

    if (error) {
      logger.warn({ err: error, bookingId }, 'Could not read a package’s sessions for an email');
      return [];
    }

    if (!rows?.length) return [];

    /*
     * The CURRENT attempt at each session: the highest `occurrence_number`,
     * which the ordering above puts last. A `moved` row is skipped outright —
     * it is an hour the client gave back, and naming it would send them to a
     * time nobody is expecting them.
     */
    const current = new Map<number, (typeof rows)[number]>();

    for (const row of rows) {
      if (row.meeting_status === 'moved') continue;
      current.set(Number(row.session_number), row);
    }

    const sessions = [...current.entries()].sort(([a], [b]) => a - b);
    if (sessions.length === 0) return [];

    /*
     * The money, by the attempt that holds the hour. `moveMeeting` carries a
     * stage across when a session moves, so this is what the session costs
     * rather than what some superseded attempt once did.
     */
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * REAL COLUMNS ONLY, AND THE ERROR IS READ.
     *
     * This asked for `refunded_amount` and `refunded_at` on the INSTALMENT.
     * Neither exists there — they are derived by trigger on the INVOICE — and
     * PostgREST rejects the whole select for one unknown name. The result came
     * back null, the stage map was empty, and every session in every email
     * showed no money at all. Silently: the error was never looked at.
     *
     * So the error is checked now, and the figures come from where they live.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const { data: stages, error: stageError } = await supabaseServer
      .from('payment_plan_installments')
      .select('meeting_id, amount, currency, status, invoice_id')
      .eq('user_id', userId)
      .in('meeting_id', sessions.map(([, row]) => String(row.id)));

    if (stageError) {
      logger.warn(
        { err: stageError, bookingId },
        'Could not read a package’s stages; its sessions will show no money'
      );
    }

    /*
     * A refund lives on the invoice the stage raised, flattened there by
     * trigger from the `payment_refunds` ledger. One query for the few
     * invoices these sessions have, or none when nothing has been billed yet.
     */
    const invoiceIds = [
      ...new Set(
        (stages ?? [])
          .map(stage => stage.invoice_id)
          .filter((id): id is string => typeof id === 'string' && Boolean(id))
      ),
    ];

    /* How much came back, not merely whether any did. */
    const refundedByInvoice = new Map<string, number>();

    if (invoiceIds.length > 0) {
      const { data: invoices, error: invoiceError } = await supabaseServer
        .from('payment_invoices')
        .select('id, amount, refunded_amount, refunded_at')
        .eq('user_id', userId)
        .in('id', invoiceIds);

      if (invoiceError) {
        logger.warn({ err: invoiceError, bookingId }, 'Could not read a package’s refunds');
      }

      for (const invoice of invoices ?? []) {
        const back = Number(invoice.refunded_amount ?? 0);
        /*
         * A refund with no amount recorded is a whole one — the ledger has
         * always written the figure, but a row that predates it would
         * otherwise read as nothing coming back at all.
         */
        const amount = back > 0 ? back : invoice.refunded_at ? Number(invoice.amount ?? 0) : 0;
        if (amount > 0) refundedByInvoice.set(String(invoice.id), amount);
      }
    }

    const stageByMeeting = new Map(
      (stages ?? []).map(stage => [String(stage.meeting_id), stage])
    );

    return sessions.map(([number, row]) => {
      const stage = stageByMeeting.get(String(row.id));

      const state: SessionState =
        row.meeting_status === 'held'
          ? 'held'
          : row.meeting_status === 'no_show'
            ? 'missed'
            : row.meeting_status === 'cancelled'
              ? 'cancelled'
              : 'upcoming';

      /*
       * A cancelled session's stage is voided when it is called off, so it
       * carries no figure — which is the truth: it will never be billed.
       */
      const back = stage?.invoice_id ? (refundedByInvoice.get(String(stage.invoice_id)) ?? 0) : 0;
      const charged = Number(stage?.amount ?? 0);

      const money =
        !stage || stage.status === 'cancelled'
          ? null
          : back > 0
            ? /* All of it, or part — the client is owed the difference. */
              back >= charged && charged > 0
              ? 'refunded'
              : 'partly_refunded'
            : stage.status === 'paid'
              ? 'paid'
              : 'due';

      return {
        number,
        start: String(row.start_time),
        state,
        amount: money ? charged : null,
        currency: money ? String(stage?.currency ?? '') || null : null,
        refunded: back > 0 ? back : null,
        money,
        isSubject: Boolean(subjectMeetingId) && String(row.id) === String(subjectMeetingId),
      };
    });
  } catch (err) {
    /*
     * Never fatal. The email's own news — moved, called off — is what the
     * client must receive; a list that could not be built is a paragraph
     * missing, not a message withheld.
     */
    logger.error({ err, bookingId }, 'Building a package’s session list threw');
    return [];
  }
}
