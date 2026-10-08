/**
 * A booking sold as one payment shows its money once, in the account.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * Two defects, in sequence, and the second was caused by fixing the first.
 *
 * 1. A quote or a plan listed its stages with a totals strip above them. An
 *    ordinary service fell through that ternary to `null` and printed a bare
 *    "₪300.00" with two buttons. The step whose whole job is the money did not
 *    say whether the money had arrived.
 *
 * 2. Giving it the strip and a row then said the same figure FOUR times: the
 *    step's fact line, the strip's total, the strip's outstanding cell, and the
 *    row repeating "Outstanding ₪300" directly beneath the cell that said
 *    "Outstanding ₪300". A reader cannot tell four copies of one number from
 *    four numbers that happen to agree.
 *
 * So the account owns the figures, and everything that would restate them is
 * silent: the fact line renders nothing, and the row keeps only the date — the
 * one thing three totals cannot express.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * This lives inside a three-thousand-line component, behind a booking, a
 * journey, a day grouping and a step. Mounting it would test the scaffolding.
 * What has to stay true is structural — one gate, used by both the block and
 * the line it silences — and a source assertion holds exactly that.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const tab = fs.readFileSync(
  path.join(process.cwd(), 'components/crm/contact-drawer/BookingsTab.tsx'),
  'utf8'
);

/** The hoisted gate: when does a step draw its own money account? */
function gate(): string {
  const start = tab.indexOf('const showsPaymentAccount');
  expect(start).toBeGreaterThan(-1);

  const end = tab.indexOf('const colors = STATUS_COLORS', start);
  expect(end).toBeGreaterThan(start);

  return tab.slice(start, end);
}

/** The account block itself. */
function block(): string {
  const start = tab.indexOf('THE SAME ROW, for a booking sold as one payment');
  expect(start).toBeGreaterThan(-1);

  const end = tab.indexOf('A plan that is no longer running', start);
  expect(end).toBeGreaterThan(start);

  return tab.slice(start, end);
}

describe('one gate decides, and both places read it', () => {
  it('the block tests nothing of its own', () => {
    /*
     * The gate used to be copied into the block. It now guards TWO things —
     * the account, and the suppression of the fact line above it — so a copy
     * that drifted would leave a card showing both or neither.
     */
    expect(block()).toMatch(/if \(!showsPaymentAccount \|\| !payment\) return null/);
  });

  it('the fact line goes quiet on exactly those steps', () => {
    // "₪300.00" printed above a strip that already names it as the total.
    expect(tab).toMatch(/showsPaymentAccount \|\| showsEmailOutcome \|\| showsPaymentStages \? null : \(/);
  });

  it('the card still counts as having a body', () => {
    /*
     * `cardFact` is suppressed on these steps, and `hasCardBody` is computed
     * from `cardFact`. Without this the payment card could lose its only line
     * and render as a lid on an empty box — the exact failure the comment
     * beside `hasCardBody` warns about.
     *
     * Scoped to the `hasCardBody` declaration, not the file. Searching the
     * whole file passed even with this condition deleted, because the block's
     * own `if (!showsPaymentAccount || !payment)` supplied the match — caught
     * by mutating it.
     */
    const start = tab.indexOf('const hasCardBody');
    expect(start).toBeGreaterThan(-1);

    const hasCardBody = tab.slice(start, tab.indexOf(');', start));

    expect(hasCardBody).toMatch(/showsPaymentAccount \|\|/);
  });
});

describe('the gate stays silent where an account would lie', () => {
  it.each([
    ['a plan that has a written schedule', /!payment\.plan\?\.stages\?\.length/],
    ['a free booking, where no money was expected', /payment\.status !== 'free'/],
  ])('skips %s', (_case, pattern) => {
    expect(gate()).toMatch(pattern);
  });

  it.each([
    ['a refund', /!showAccount/],
    ['a cancelled payment request', /!cancelledUnpaid/],
  ])('no longer stands aside for %s', (_case, pattern) => {
    /*
     * Both used to be excluded and both now render through the strip.
     *
     * A refund kept a two-column ledger of its own — the last payment surface
     * drawing money in a layout nothing else used. A cancelled request kept the
     * plain fact line, which called the money OVERDUE: `isOverdue` upstream is
     * only `status === 'pending'` plus a past due date, and voiding an invoice
     * leaves both true, so "₪300.00 (באיחור)" sat directly above a chip saying
     * the request had been cancelled.
     *
     * If either exclusion comes back, that surface silently returns to its old
     * layout and this block never renders for it.
     */
    expect(gate()).not.toMatch(pattern);
  });

  it('no longer draws a second ledger above the strip', () => {
    /*
     * A plan with a refund kept the old charged/returned/kept block, on the
     * reasoning that the strip could not express a refund. It can now — it
     * swaps collected/outstanding for returned/kept — so the card was stating
     * ₪9,000, ₪2,250 and ₪6,750 twice, a few pixels apart, and a reader cannot
     * tell two copies of one account from two accounts that happen to agree.
     */
    expect(tab).not.toMatch(/showAccount && !showsPaymentAccount \?/);
    expect(tab).not.toMatch(/showAccount && payment\?\.plan && step\.details/);
  });

  it('skips only a plan that HAS stages, not every plan', () => {
    /*
     * `stages` is omitted until the processor confirms the schedule, so
     * rejecting every plan sent those bookings to neither branch — no account
     * at all, in the window where an owner is checking whether the sale went
     * through.
     */
    expect(gate()).not.toMatch(/!payment\.plan\b(?!\?)/);
  });
});

describe('the row says only what the totals cannot', () => {
  it('carries the date and nothing else', () => {
    /*
     * The de-duplication. A state word here sat under a strip cell saying the
     * same word, and an amount here sat under a cell saying the same amount.
     */
    const body = block();

    // One row became a list — a payment can now have two dates, paid and
    // refunded — so the text comes from the line rather than a lone `when`.
    expect(body).toMatch(/\{line\.text\}/);
    expect(body).not.toMatch(/\{state\}/);
    expect(body).not.toMatch(/formatAmount\(charged, payment\.currency\)/);
  });

  it('draws no row at all when there is nothing to date', () => {
    // A lone dot is not a line worth drawing; the strip is then the whole truth.
    expect(block()).toMatch(/\{visibleLines\.length > 0 && \(/);
  });

  it('a plan shows its refund date and no projected state line', () => {
    /*
     * A plan without a written schedule has no periods, so a state line would
     * be a projection — the reason rows are withheld from a plan at all. A
     * refund is not a projection: it happened, on a date the row can name, and
     * the old ledger used to show it.
     */
    expect(block()).toMatch(/plan\s*\?\s*lines\.filter\(line => line\.key === 'refund'\)/);
  });

  it('names the paid date the way it names the due date', () => {
    /*
     * "Paid 30 Sept" against "due 7 Oct" — a bare date in one row and a
     * labelled one in the other would read as two different kinds of fact.
     */
    expect(block()).toMatch(/\$\{t\('crm\.journey\.paid_on'\)\} \$\{stageDate\(payment\.paidAt\b/);
  });

  it('still says a payment is paid when no date was recorded', () => {
    /*
     * The regression this closed. `paidAt` comes from the invoice's `paid_at`
     * or a settled transaction's, and an invoice can carry `status: 'paid'`
     * with `paid_at` still null — the status-versus-ledger split that has
     * bitten the chasers. The row then returned '' and did not render, so a
     * PAID booking showed a totals strip and nothing else: the missing date
     * had become a missing fact.
     *
     * The word, with no date invented to sit beside it.
     */
    const body = block();
    const paidBranch = body.slice(body.indexOf('const when = isPaid'), body.indexOf('return ('));

    expect(paidBranch).toMatch(/:\s*(?:\/\*[\s\S]*?\*\/\s*)?t\('crm\.journey\.paid_on'\)/);
    expect(paidBranch).not.toMatch(/\?\s*''\s*$/m);
  });

  it('still colours the dot by state', () => {
    /*
     * The state did not stop mattering, it stopped needing words. The dot says
     * it in no space at all, in the same four colours the stage rows use — so
     * green means settled reading down a drawer of mixed bookings.
     */
    const body = block();

    for (const colour of ['#22C58B', '#B54708', '#F79009']) {
      expect(body).toContain(colour);
    }
  });

  it('distinguishes overdue from billed from not yet billed', () => {
    // Three facts an owner acts on differently: chase it, wait, or raise it.
    const body = block();

    expect(body).toMatch(/invoiceStatus === 'overdue'/);
    expect(body).toMatch(/Boolean\(payment\.invoiceId\)/);
  });
});

describe('the totals strip is the one the staged branch uses', () => {
  it('renders PaymentPlanTotals rather than summing again here', () => {
    /*
     * Two renderers for one strip is how the booking card and the payment
     * dialog came to print different totals for the same job — the bug that
     * component was written to end.
     *
     * The trailing boundary matters: `/<PaymentPlanTotals/` alone also matches
     * `<PaymentPlanTotalsAnythingElse`, so a mutation swapping the component
     * passed this test until the `\s` was added.
     */
    expect(block()).toMatch(/<PaymentPlanTotals\s/);
  });

  it('counts only periods the mirror has confirmed paid', () => {
    // `periodsPaid` is undefined until the mirror exists, and undefined must
    // not round up to "collected" — that reports money taken on an unsettled sale.
    expect(block()).toMatch(/plan\.periodsPaid \?\? 0/);
  });

  it('tells the strip when the money is late rather than merely owed', () => {
    expect(block()).toMatch(/overdue=\{isOverdue\}/);
  });
});

describe('dates are formatted by the helper that knows what they are', () => {
  it('routes both through stageDate', () => {
    /*
     * `invoiceDueDate` is a bare SQL DATE and `paidAt` is an instant. Formatting
     * either by hand is how an invoice raised on the 30th read "due 29 Sept"
     * with OVERDUE beside it.
     */
    const body = block();

    /*
     * `\b` rather than a closing paren: both calls now pass `true` for the
     * year, and pinning the argument list here would fail for a reason that
     * has nothing to do with which helper formats the date.
     */
    expect(body).toMatch(/stageDate\(payment\.paidAt\b/);
    expect(body).toMatch(/stageDate\(payment\.invoiceDueDate\b/);
  });

  it('asks for the year on a date that stands alone', () => {
    /*
     * A stage list is read as a sequence and takes the year from its
     * neighbours. A single payment has no neighbours: its one date is the whole
     * record of when the money moved, and "2 Oct" on a booking from a previous
     * year cannot be reconciled against a statement without opening something
     * else.
     */
    const body = block();

    expect(body).toMatch(/stageDate\(payment\.paidAt, true\)/);
    expect(body).toMatch(/stageDate\(payment\.invoiceDueDate, true\)/);
  });

  it('formats no date inline anywhere in the block', () => {
    expect(block()).not.toMatch(/toLocaleDateString/);
  });
});

describe('the quote step shows no money of its own', () => {
  it('draws no totals strip', () => {
    /*
     * It had one, briefly. It reported the same three figures as the payment
     * step's strip, for the same booking, one card apart — agreed, collected,
     * outstanding, twice. Money has one home on this journey and it is the
     * payment step; the quote step says what was OFFERED and what became of the
     * offer.
     *
     * Asserted by counting: the staged branch and the single-payment account
     * each render one, and a third would be this coming back.
     */
    const strips = tab.match(/<PaymentPlanTotals\s/g) ?? [];

    expect(strips).toHaveLength(2);
  });

  it('still keeps the header quiet, because the version row carries it', () => {
    /*
     * Unchanged by the strip's removal, and for its own reason: the standing
     * version's row reads "אושרה ₪9,000.00 · 7 באוק׳", so the amount and the
     * state line above it were printing the same two facts a few pixels up.
     */
    expect(tab).toMatch(/quoteAnswered \? null : \(/);
    expect(tab).toMatch(/isProposalStep && !quoteAnswered && \(/);
  });
});

describe('a quote version keeps its reason after it is replaced', () => {
  /** The version-history rows on the quote step. */
  function versions(): string {
    const start = tab.indexOf('const tone = VERSION_TONES');
    expect(start).toBeGreaterThan(-1);

    const end = tab.indexOf('AddPackageMeeting', start);
    return tab.slice(start, end > start ? end : start + 9000);
  }

  it('shows a decline reason on the data, not on the status', () => {
    /*
     * `markSuperseded` rewrites every row in ('sent','viewed','declined') to
     * 'superseded' when a revision goes out. Gated on `version.status ===
     * 'declined'`, the reason therefore vanished the moment the owner sent the
     * revised quote it explains — "₪10,000 · הוחלפה · 7 באוק׳" and nothing
     * about why.
     *
     * The column is never cleared; only the condition that printed it was
     * wrong. A reason is a fact about what happened to that version, and what
     * happens to it afterwards does not unmake it.
     */
    const body = versions();

    expect(body).toMatch(/\{\(version\.declineReason \|\| version\.declineNote\) && \(/);
    expect(body).not.toMatch(/version\.status === 'declined' &&/);
  });

  it('shows a stop reason the same way', () => {
    const body = versions();

    expect(body).toMatch(/\{\(version\.stopReason \|\| version\.stopNote\) && \(/);
    expect(body).not.toMatch(/version\.status === 'stopped' &&/);
  });
});

describe('a milestone can be refunded on its own', () => {
  const drawer = fs.readFileSync(
    path.join(process.cwd(), 'components/crm/contact-drawer/CRMContactDrawerV2.tsx'),
    'utf8'
  );

  it('the stage row offers a refund', () => {
    /*
     * A job with two paid milestones had no route to returning one of them.
     * "נהל תשלום" opens on the BOOKING, and with several payments behind it
     * that dialog forces `full` — there is no honest way to split ₪7,000 across
     * two ₪4,500 charges that a card statement would agree with — so it refunds
     * all of them and says to use the payments list instead.
     *
     * The payments list does carry a per-payment refund, four levels down: the
     * row, its detail drawer, the entry panel, the ⋯ menu. Told to go there
     * with no idea where, an owner does not find it.
     */
    expect(tab).toMatch(/onRefundStage\(\{/);
    expect(tab).toMatch(/invoiceId: stage\.invoiceId as string/);
  });

  it('offers it only while something is left to return', () => {
    /*
     * `amount − refunded`. A fully refunded stage stops offering it, and the
     * line above the row already says what came back.
     *
     * Split across two files once the actions moved behind the row's menu: the
     * row computes what is left, and the menu decides whether that is worth
     * offering. Both halves are asserted, because either alone would let a
     * settled stage keep inviting a refund it cannot take.
     */
    const actions = fs.readFileSync(
      path.join(process.cwd(), 'components/crm/contact-drawer/StageRowActions.tsx'),
      'utf8'
    );

    expect(tab).toMatch(/remaining=\{\s*stage\.amount - Number\(stage\.refundedAmount \|\| 0\)/);
    expect(actions).toMatch(/paid && invoiceId && onRefund && remaining > 0/);
  });

  it('addresses the dialog by INVOICE, which is what makes partial possible', () => {
    /*
     * The difference that matters. Given a booking, the resolver finds every
     * settled payment and the dialog becomes a group refund. Given an invoice it
     * finds one, `payment_count` is 1, `isGroup` is false, and the partial
     * control comes back — because now there is a single charge for the amount
     * to come off.
     */
    expect(drawer).toMatch(/invoiceId=\{refundStage\.invoiceId\}/);
    expect(drawer).not.toMatch(/bookingId=\{refundStage/);
  });

  it('opens with this stage’s own remaining, not the whole job’s', () => {
    // So the dialog cannot open on a figure the server will refuse.
    expect(drawer).toMatch(/alreadyRefunded=\{refundStage\.refunded\}/);
    expect(drawer).toMatch(/originalAmount=\{refundStage\.amount\}/);
  });
});

describe('the stage menu is reachable where it is drawn', () => {
  it('the stage list does not clip it', () => {
    /*
     * The list had `overflow-hidden` for its rounded corners, and an absolutely
     * positioned menu cannot escape a clipping ancestor — it rendered cut off,
     * with options the owner could not reach. The rows carry no background of
     * their own, so the radius had nothing to clip.
     *
     * The same fix the meetings list needed, found the same way: by opening the
     * menu and seeing half of it.
     */
    const list = tab.slice(tab.indexOf('<PaymentPlanTotals'), tab.indexOf('<StageRowActions'));

    expect(list).toMatch(/className="flex flex-col gap-px"/);
    expect(list).not.toMatch(/flex flex-col gap-px overflow-hidden/);
  });
});

describe('the stage row ends with its menu', () => {
  it('the ⋯ comes after the end-aligned status, not before it', () => {
    /*
     * The status span carries `ms-auto`, so it pushes itself AND everything
     * after it to the row's inline end — the left in Hebrew, the right in
     * English. Placed before that span, the ⋯ sat stranded mid-row beside the
     * date, which is where it first landed.
     *
     * Asserted by order rather than by a class, because the class is on the
     * span and the position is what actually moved.
     */
    /* Anchored on the stage's own declaration: the comment this used to start
       from moved out of the row when the refund became a second line. */
    const from = tab.indexOf('const stageRefunded');
    expect(from).toBeGreaterThan(-1);

    const row = tab.slice(from, tab.indexOf('A plan that is no longer running'));

    const status = row.indexOf('ms-auto shrink-0');
    const menu = row.indexOf('<StageRowActions');

    expect(status).toBeGreaterThan(-1);
    expect(menu).toBeGreaterThan(status);
  });
});

describe('the stage menu opens where it fits', () => {
  const actions = fs.readFileSync(
    path.join(process.cwd(), 'components/crm/contact-drawer/StageRowActions.tsx'),
    'utf8'
  );

  it('flips above the trigger when there is no room below', () => {
    /*
     * The last stage of a block has nothing under it: the menu ran past the card
     * into a scrolling drawer and its lower options could not be reached. Every
     * row above was fine, which made it read as a one-row bug rather than a
     * placement rule.
     */
    expect(actions).toMatch(/bottom-full mb-1/);
    expect(actions).toMatch(/top-full mt-1/);
  });

  it('measures rather than assuming which row is last', () => {
    /*
     * "Is this the last row" is the wrong question. A card near the bottom of a
     * short panel runs out of space on its second row too, and a row with three
     * items needs more than one with two.
     */
    expect(actions).toMatch(/shouldOpenUpward\(triggerRef\.current, items\.length\)/);
  });

  it('measures the box that clips it, not the window', () => {
    /*
     * The first version asked the VIEWPORT, which had room to spare while the
     * drawer's own bottom edge was doing the cutting — so the flip never fired
     * and the menu kept running off the card.
     */
    const placement = fs.readFileSync(
      path.join(process.cwd(), 'components/crm/contact-drawer/menuPlacement.ts'),
      'utf8'
    );

    expect(placement).toMatch(/function clippingAncestor/);
    expect(placement).toMatch(/overflowY !== 'visible'/);
    expect(actions).not.toMatch(/window\.innerHeight/);
  });

  it('only flips when the other side genuinely has more room', () => {
    // Otherwise a cramped panel trades one clipped edge for the other.
    const placement = fs.readFileSync(
      path.join(process.cwd(), 'components/crm/contact-drawer/menuPlacement.ts'),
      'utf8'
    );

    expect(placement).toMatch(/below < needed && above > below/);
  });

  it('the meetings menu uses the same rule', () => {
    // Same drawer, same edge. A second hand-rolled measurement would drift.
    const meetings = fs.readFileSync(
      path.join(process.cwd(), 'components/crm/contact-drawer/MeetingRowActions.tsx'),
      'utf8'
    );

    expect(meetings).toMatch(/shouldOpenUpward\(triggerRef\.current, items\.length\)/);
    expect(meetings).toMatch(/bottom-full mb-1/);
  });
});

describe('stopping a job does not erase its money', () => {
  const drawer = fs.readFileSync(
    path.join(process.cwd(), 'components/crm/contact-drawer/CRMContactDrawerV2.tsx'),
    'utf8'
  );

  it('keeps the payment step on a stopped quote', () => {
    /*
     * `quotedPayment` returned null for anything but 'accepted', and stopping
     * rewrites the proposal to 'stopped' — so the payment step VANISHED the
     * moment the owner stopped the work. On a job paid in full that erased
     * ₪9,000 of collected money, both receipts and the stage history from the
     * one screen that holds a client's record.
     *
     * Stopping ends the work; it does not unmake the money. And it is exactly
     * then that an owner needs to see it, because the next decision is whether
     * any of it goes back.
     */
    expect(drawer).toMatch(/proposal\?\.status === 'accepted' \|\| proposal\?\.status === 'stopped'/);
    expect(drawer).not.toMatch(/proposal\.status !== 'accepted' \|\|/);
  });
});

describe('the refund lives on one card only', () => {
  it('the quote step offers no refund of its own', () => {
    /*
     * It used to, once a job was stopped and paid. But this card knows only the
     * JOB, and a refund follows a CHARGE — so offered from here it could mean
     * nothing narrower than "all of it", which is exactly the case an owner
     * stopping a part-delivered job is least likely to want.
     *
     * The money is on the payment card, where every paid milestone carries its
     * own refund. Two doors to one decision, one of which cannot express the
     * common case, is worse than one door.
     */
    expect(tab).not.toMatch(/onRefundJob/);
  });

  it('leaves no dead prop behind on either side', () => {
    /*
     * Removed from the component AND the drawer. A prop with no reader on a
     * four-thousand-line card is the kind of thing that gets wired back to
     * something it no longer means.
     */
    const drawer = fs.readFileSync(
      path.join(process.cwd(), 'components/crm/contact-drawer/CRMContactDrawerV2.tsx'),
      'utf8'
    );

    expect(drawer).not.toMatch(/onRefundJob/);
  });

  it('still refunds a cancelled BOOKING, which is a different act', () => {
    // Cancelling an appointment is not stopping a quoted job, and that path
    // keeps its refund.
    const drawer = fs.readFileSync(
      path.join(process.cwd(), 'components/crm/contact-drawer/CRMContactDrawerV2.tsx'),
      'utf8'
    );

    expect(drawer).toMatch(/setRefundAfterCancel\(\{/);
  });
});
