/**
 * MONEY STILL OWED OUTRANKS MONEY ALREADY FINISHED.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS GUARDS
 *
 * A Money row carries one line summarising the whole order. It asked
 * `cancelled > 0 && collected === 0` BEFORE it looked at what was outstanding,
 * and both halves were satisfied by accident:
 *
 *   `cancelled > 0`    is true if ANY ONE period is cancelled, so a single dead
 *                      milestone spoke for the entire order.
 *   `collected === 0`  was the safeguard, meant to mean "nothing ever came in".
 *                      But `collected` is NET of refunds, so money that came in
 *                      and went back produces the same zero. The one guard
 *                      against this mistake is what let it through.
 *
 * Live case 2026-11-08, booking da424f7c: a CONFIRMED booking on an ACCEPTED
 * $333 quote, one of four milestones cancelled and the first refunded, read
 * "Cancelled" with $222.01 still to collect. The same condition also dimmed the
 * row, so it looked dead before the words were read, and the page contradicted
 * itself: `item.status` is `refunded`, so the Cancelled filter did not list the
 * order while the row called it cancelled.
 *
 * The cost is not cosmetic. An owner told a quote is cancelled stops chasing
 * money that is genuinely collectable.
 *
 * This is a source test because the rule is an ordered chain of branches, and
 * what broke it was the ORDER of two of them, not the arithmetic in any one.
 * Rendering the page would assert the output without pinning the thing that
 * actually regressed.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const PAGE = join(__dirname, '..', 'MoneyFlowPage.tsx');

describe('a row that still has money owed is never called cancelled', () => {
  const source = readFileSync(PAGE, 'utf8');

  /** The `const state = (() => { … })();` chain, whitespace and all. */
  const state = source.slice(
    source.indexOf('const state = (() => {'),
    source.indexOf('/*\n    WHAT THIS ROW IS CALLED')
  );

  it('has the state chain to read', () => {
    expect(state.length).toBeGreaterThan(0);
  });

  it('orders the parts by what the owner can act on', () => {
    /*
     * The chain became a LIST: one entry per state, named in the order a
     * reader should meet them — chase, then wait, then what is already
     * settled. Asserted by position in that list rather than by branch order,
     * which is what it replaced.
     */
    const at = (needle: string) => state.indexOf(needle);

    expect(at('flow.overdue')).toBeGreaterThan(-1);
    expect(at('waiting')).toBeGreaterThan(-1);
    expect(at('flow.collected')).toBeGreaterThan(-1);
    expect(at('flow.refunded')).toBeGreaterThan(-1);
    expect(at('flow.cancelled')).toBeGreaterThan(-1);

    /* Owed money is named before money already settled — the whole defect. */
    expect(at('amount: flow.overdue')).toBeLessThan(at('amount: flow.collected'));
    expect(at('amount: waiting')).toBeLessThan(at('amount: flow.collected'));
    expect(at('amount: flow.collected')).toBeLessThan(at('amount: flow.cancelled'));
  });

  it('never decides "cancelled" from collections being net zero', () => {
    /*
     * `collected === 0` is not evidence of a dead order: a refund produces it
     * on an order that is still live. Pairing it with `cancelled` is exactly
     * the bug, so the pairing itself is what is banned.
     */
    expect(state).not.toMatch(/flow\.cancelled > 0 && flow\.collected === 0/);
  });

  it('gives refunded money its own answer', () => {
    expect(state).toMatch(/payments\.refunded/);
  });

  it('does not dim a row that still has money to collect', () => {
    /*
     * The dimming shared the faulty condition, so a live order was greyed out
     * as well as mislabelled. It must consider what is outstanding.
     */
    const dim = source.slice(source.indexOf('opacity:'), source.indexOf('opacity:') + 160);
    expect(dim).toContain('flow.outstanding === 0');
    expect(dim).not.toMatch(/flow\.cancelled > 0 && flow\.collected === 0/);
  });

  it('spans the bar across every state, refunded included', () => {
    /*
     * `collected` is net of refunds, so leaving refunded out of `whole` made
     * the bar cover less than the figure printed above it: a $444.02 order
     * drew a bar worth $333.03. With it, `whole` equals `item.amount` again.
     */
    expect(source).toContain(
      'const whole = flow.collected + flow.refunded + flow.outstanding + flow.cancelled;'
    );
  });

  it('says a job was called off even when the money was refunded', () => {
    /*
     * `flow.cancelled` only knows a cancellation that VOIDED something. Cancel
     * a booking whose payment has settled and the refund lands in `refunded`
     * instead, so the cancellation appeared nowhere. Live case 2026-11-08,
     * booking 0d2ba38f, $89 paid then returned.
     *
     * The booking's own status is the only thing that knows, and it LEADS the
     * line rather than replacing it.
     */
    expect(state).toContain('item.bookingCancelled');
    expect(state).toMatch(/text: off \? `\$\{off\} · \$\{said\}` : said/);
  });

  it('still shows the money beside the cancellation, never instead of it', () => {
    /* Both facts are true and a reader needs both: the job is off, and $89
       went back. The cancellation is a PREFIX to the parts, never a
       replacement for them. */
    expect(state).toContain('`${off} · ${said}`');
  });

  it('carries the booking status through the route and the builders', () => {
    const route = readFileSync(
      join(__dirname, '..', '..', '..', '..', 'app', 'api', 'payments', 'money', 'route.ts'),
      'utf8'
    );
    const items = readFileSync(
      join(__dirname, '..', '..', '..', '..', 'lib', 'payments', 'moneyItems.ts'),
      'utf8'
    );

    /* Selected, or the field is null for every row and the branch never runs. */
    expect(route).toContain("'id, status, start_time");
    expect(route).toMatch(/status: booking\.status \?\? null/);

    /* BOTH builders, or a plan-only order silently loses it. */
    const set = items.match(/bookingCancelled: String\(booking\.status \?\? ''\) === 'cancelled'/g) ?? [];
    expect(set).toHaveLength(2);
  });

  it('colours every payment row by its own state, from the shared resolver', () => {
    /*
     * These rows carried no state colour at all: the number badge and the
     * status word were both `--v2-text-muted`, so a refunded payment and a
     * cancelled one were the same grey — directly beneath a bar that drew them
     * in different colours. Reported 2026-11-08 on booking fe3a0a19.
     *
     * `scheduleTone`, not a local copy: the drawer renders the same schedule
     * and the two must not drift, which is the whole reason that module exists.
     */
    const list = source.slice(source.indexOf('money.entries_title'));
    expect(list).toContain('scheduleTone(row.status)');
    expect(list).toMatch(/color: tone/);

    /* The one hand-mixed tint, from the page's retired private red. */
    expect(source).not.toContain('rgba(240,101,79,.12)');
  });

  it('names every part of the figure on the card, so it adds up', () => {
    /*
     * The amount on the card is the order's FACE VALUE and deliberately does
     * not move when a filter is clicked. That makes this line the only thing
     * that explains it, and it used to name a single part: "$30.00 Overdue"
     * beside a $60 figure, with the other $30 unexplained. Asked three times
     * what the number meant, 2026-11-08.
     *
     * The five parts are non-overlapping and sum to the figure.
     */
    for (const part of ['flow.overdue', 'flow.collected', 'flow.refunded', 'flow.cancelled']) {
      expect(state).toContain(part);
    }

    /*
     * `waiting` is outstanding MINUS overdue. Overdue is a SUBSET of
     * outstanding, not a rival to it, so naming both raw would double-count
     * every late payment and overshoot the card's total.
     */
    expect(state).toContain('Math.max(0, flow.outstanding - flow.overdue)');
    expect(state).not.toMatch(/amount: flow\.outstanding\b/);
  });

  it('names every part of a cancelled order, so the figure adds up', () => {
    /*
     * The amount on the card is the order's face value. On a cancelled order
     * it is money that came back PLUS money never taken, and naming only one
     * left the rest unexplained: a $77 order read "Cancelled · $38.50
     * refunded" and the obvious question was what the other $38.50 was.
     */
    expect(state).toContain('money.never_collected');
    expect(state).toContain('Math.max(0, flow.outstanding - flow.overdue)');
    /* Overdue is a SUBSET of outstanding; naming both raw would overshoot. */
    expect(state).not.toMatch(/amount: flow\.outstanding\b/);
  });

  it('calls a late period late, so the row matches the bar above it', () => {
    /*
     * Nothing ever writes `overdue` onto a period — `matchesFilter` records
     * this — so `itemFlow` derives lateness from the due date with
     * `isLatePeriod`, and that is what fills the bar's red band. The row
     * mapping did not, so the SAME money was red in the bar and orange in the
     * row beneath it. Live case 2026-11-08, booking 051609a7: a $60 plan with
     * period 2 due 3 Nov, bar red, row "Awaiting payment".
     *
     * The same function on both sides, or they drift again.
     */
    const drawer = readFileSync(
      join(__dirname, '..', 'MoneyOrderDrawer.tsx'),
      'utf8'
    );
    const mapping = drawer.slice(drawer.indexOf('export function scheduleOf'));
    expect(mapping).toContain("isLatePeriod(period)");
    expect(mapping).toMatch(/return 'overdue'/);

    /* Derived, never read off a period's own status, which never carries it. */
    const items = readFileSync(
      join(__dirname, '..', '..', '..', '..', 'lib', 'payments', 'moneyItems.ts'),
      'utf8'
    );
    expect(items).toContain('export function isLatePeriod');
  });

  it('lets the bar and its key select the state they draw', () => {
    /*
     * The bar states a proportion and the question it provokes is "which
     * orders are that?". Each band and each key entry now answers it directly
     * instead of leaving the reader to find the matching chip.
     */
    const bands = source.match(/<Band\s/g) ?? [];
    expect(bands.length).toBeGreaterThanOrEqual(4);
    expect(source).toContain('const pickState =');

    /* Filtering what cannot be seen looks broken: the chips are scoped "to the
       list below only", so picking a state opens a list if both doors are shut. */
    expect(source).toMatch(/setListOpen\(open => open \?\? 'orders'\)/);
  });

  it('never lets a segment select a chip of a different colour', () => {
    /*
     * `moneyStatusTone`'s header records why this matters: "the strip is also
     * the filter: clicking its orange 'due' cell returned rows badged blue,
     * which defeats the one thing a coloured filter is for."
     *
     * Checked as a pairing rather than by value, so it holds through any
     * palette change.
     */
    const chips = Object.fromEntries(
      [...source.matchAll(/\{ key: '(\w+)', label: [^,]+, tone: (TONE\.\w+) \}/g)].map(m => [m[1], m[2]])
    );
    const picks = [
      ...source.matchAll(/<(?:Band|Key)\s+tone=\{(TONE\.\w+)\}[\s\S]*?pickState\('(\w+)'\)/g),
    ];

    expect(picks.length).toBeGreaterThan(0);
    for (const [, tone, state] of picks) {
      expect(chips[state]).toBe(tone);
    }
  });

  it('offers the refunded filter the route has always implemented', () => {
    /* `filter: 'refunded'` is answered server-side; no chip ever asked for it. */
    expect(source).toMatch(/key: 'refunded'/);
  });
});
