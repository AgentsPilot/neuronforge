

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
  /**
   * Whether this session was BILLED on its own, or is a share of one sum.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * A package billed per session has a stage, an invoice and a real amount per
   * meeting. A package paid UPFRONT has none of that: one invoice against the
   * whole block, which this file divides across the sessions so a column is
   * not left blank.
   *
   * That share is this platform's arithmetic, not a charge the client ever
   * agreed to — the comment below says so — and a receipt that prints it in a
   * "Payment" column invites the reader to check three figures against a
   * single sum they already paid. So the figure stays available for surfaces
   * that want it, and this flag lets a surface drop the column instead.
   * ───────────────────────────────────────────────────────────────────────────
   */
  billedPerSession: boolean;
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

    /*
     * ── A PACKAGE PAID AS ONE SUM STILL OWES EACH SESSION A FIGURE ──────────
     *
     * Everything above reads money from `payment_plan_installments`, which is
     * the right source for a package billed PER SESSION: one stage per
     * meeting, each with its own amount and invoice.
     *
     * A package paid UPFRONT has no stages at all. The whole sum is a single
     * invoice against the container, `bill_per_session` is false, and the
     * table is empty — so every session resolved to `amount: null` and the
     * email's Payment column came out blank on every row. Reported on a
     * three-session quote of $660 that had been paid in full.
     *
     * So where there are no stages, the package's own invoice is divided
     * across its sessions.
     *
     * TWO THINGS THIS IS CAREFUL ABOUT:
     *
     *   ROUNDING MUST NOT LOSE MONEY. $660 over 3 is clean; $100 over 3 is
     *   not, and three independently-rounded 33.33s report $99.99 against an
     *   invoice of $100. The last session absorbs the remainder so the shares
     *   sum to the total exactly.
     *
     *   IT IS A SHARE, NOT A CHARGE. The client paid one sum and was never
     *   billed three times. The figure is this platform's arithmetic, which is
     *   why it is derived here rather than written to the installments table
     *   as though three payments had been agreed.
     *
     * A cancelled invoice is ignored: nothing was paid and nothing is owed, so
     * a blank column is the truth there.
     */
    let upfrontShare: Array<number | null> | null = null;
    let upfrontCurrency: string | null = null;
    let upfrontPaid = false;

    /*
     * ── WHICH KIND OF PACKAGE THIS IS, ASKED BEFORE ANY MONEY IS DIVIDED ────
     *
     * There are two, and they must not be reasoned about together:
     *
     *   UPFRONT          one agreed sum, one invoice on the container, no
     *                    stages. Its sessions have no figures of their own, so
     *                    the block is divided across them — that is this whole
     *                    fallback.
     *
     *   PER SESSION      one stage per meeting, billed when it is held. Each
     *                    session already carries its own amount and its own
     *                    invoice. Nothing here applies to it.
     *
     * "No stages" is NOT a safe test for the first one. A per-session package
     * has no stages either until its first session is billed — and if the
     * stage read above merely FAILED, it has none in hand whatever the
     * database holds. In both cases this would go looking for an invoice on
     * the booking, find a single session's bill, and divide it across the
     * whole block as though it were the agreed total. Every figure in the
     * client's email would then be wrong, quietly.
     *
     * So the proposal is asked first, and a per-session block is left alone.
     */
    const { data: agreement } = await supabaseServer
      .from('proposals')
      .select('sessions')
      .eq('package_booking_id', bookingId)
      .eq('user_id', userId)
      .maybeSingle();

    const agreedShape = agreement?.sessions as
      | { dates?: unknown[]; bill_per_session?: boolean }
      | null;

    const billsPerSession = agreedShape?.bill_per_session === true;

    if (!stages?.length && !billsPerSession) {
      const { data: blockInvoice, error: blockError } = await supabaseServer
        .from('payment_invoices')
        .select('id, amount, currency, status, paid_at')
        .eq('booking_id', bookingId)
        .eq('user_id', userId)
        .in('status', ['draft', 'sent', 'overdue', 'paid', 'refunded'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (blockError) {
        logger.warn(
          { err: blockError, bookingId },
          'Could not read a package’s invoice; its sessions will show no money'
        );
      }

      const total = Number(blockInvoice?.amount ?? 0);

      /*
       * ── DIVIDED BY WHAT WAS AGREED, NOT BY WHAT IS ON THE PACKAGE NOW ─────
       *
       * A session added AFTER acceptance is not covered by the block payment:
       * it was either given free or billed on its own. Dividing by the
       * sessions currently attached quietly spends the paid total across it —
       * on the measured booking that turned three agreed sessions of $220 into
       * four rows of $165, understating every session the client actually
       * agreed and inventing a payment for one they did not.
       *
       * So the agreed count comes from the proposal, and the shares stop
       * there. A later session shows no figure until something decides whether
       * it is charged, which is correct: nothing has been.
       *
       * Falls back to the sessions in hand when there is no proposal to ask —
       * every non-quoted package, where the two counts are the same anyway.
       *
       * ── AND A CANCELLED SESSION HANDS ITS SHARE ON ─────────────────────────
       *
       * The agreed rule is that cancelling a session offers a REPLACEMENT, and
       * the replacement carries that session's portion of the payment. The
       * count never grows: a package of three stays a package of three, so the
       * total the client agreed is always the total on the contract.
       *
       * Positional distribution cannot express that. Cancel session 1 and add
       * its replacement and the list is [cancelled, 2, 3, replacement] — the
       * cancelled one keeps a share it will never deliver, and the replacement
       * is fourth, so it falls outside the agreed count and shows nothing. The
       * money would sit on the session that is not happening.
       *
       * So the shares follow the sessions that are still STANDING, in order,
       * capped at the agreed count. A cancelled session shows no figure, which
       * is the truth — its portion moved to whatever replaced it.
       */
      const agreedDates = agreedShape?.dates;

      /* The sessions a share can land on: everything not called off. */
      const standing = sessions.filter(
        ([, row]) => row.meeting_status !== 'cancelled'
      ).length;

      /*
       * ── A SESSION IS WORTH THE SAME WHATEVER HAPPENS TO THE OTHERS ────────
       *
       * Divided by what was AGREED, not by how many sessions happen to be
       * standing. Those differ the moment one is called off, and dividing by
       * the survivors concentrates the whole block onto them: a three-session
       * block of $600 with two cancelled showed $600 against the one
       * remaining session, which says that session is worth triple the price
       * the client agreed for it.
       *
       * Divided by the agreed count, each session is worth $200 and stays
       * worth $200. The cancelled ones show nothing — they will not be
       * delivered — and the list simply does not add up to the invoice while
       * money is waiting on replacements, which is the truth of that moment.
       * When a replacement is booked it takes a $200 place, and the block adds
       * up again.
       *
       * `covered` still caps how MANY sessions can hold a share, so a block
       * grown past what was sold cannot pay out more than was agreed.
       */
      const divisor =
        Array.isArray(agreedDates) && agreedDates.length > 0 ? agreedDates.length : standing;

      const covered = Math.min(divisor, standing);

      if (total > 0 && covered > 0) {
        const each = Math.round((total / divisor) * 100) / 100;

        /* Counts only the sessions that can hold a share, so a cancelled one
           in the middle does not push the rest out of the agreed count. */
        let placed = 0;

        upfrontShare = sessions.map(([, row]) => {
          if (row.meeting_status === 'cancelled') return null;
          if (placed >= covered) return null;

          const index = placed;
          placed += 1;

          /* The last of the AGREED sessions absorbs the rounding remainder, so
             an intact block adds up to its invoice exactly. A block with
             cancellations has fewer shares out than that, deliberately. */
          return index < divisor - 1
            ? each
            : Math.round((total - each * (divisor - 1)) * 100) / 100;
        });
        upfrontCurrency = blockInvoice?.currency ? String(blockInvoice.currency) : null;
        /*
         * `paid_at` as well as the status: this account has a live invoice
         * carrying `paid_at` and a succeeded charge while its status still
         * reads `sent`, and the client who paid it should not be shown a bill.
         */
        upfrontPaid = blockInvoice?.status === 'paid' || Boolean(blockInvoice?.paid_at);
      }
    }

    return sessions.map(([number, row], index) => {
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

      /*
       * The block's share, for a package with no stages — see `upfrontShare`.
       * Null for every per-session package, which keeps the stage reading
       * below exactly as it was.
       */
      const share = stage ? null : (upfrontShare?.[index] ?? null);

      const money: PackageSessionLine['money'] =
        share !== null
          ? /* One sum was taken for the block, so a session's share is in
               whatever state that payment is. It is never `due` per session:
               nobody was billed per session. */
            upfrontPaid
            ? 'paid'
            : 'due'
          : !stage || stage.status === 'cancelled'
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
        amount: share !== null ? share : money ? charged : null,
        currency:
          share !== null
            ? upfrontCurrency
            : money
              ? String(stage?.currency ?? '') || null
              : null,
        refunded: back > 0 ? back : null,
        money,
        isSubject: Boolean(subjectMeetingId) && String(row.id) === String(subjectMeetingId),
        /* A real stage means this session was billed on its own. A share
           means one sum was taken for the block — see the interface. */
        billedPerSession: Boolean(stage),
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
