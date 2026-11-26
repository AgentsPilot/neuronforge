/**
 * Every figure on the money card is made of rows the reader can get to.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE OWNER SAID
 *
 * "The numbers in Payments & Invoices don't make any sense with total
 * collected/paid." Then, having seen the figures fixed: "make sure the list of
 * payments, refund, paid etc are all there and make sense based on the total
 * and vice versa."
 *
 * Both halves of that mattered, and the second found more than the first.
 * Checked against one live contact:
 *
 *                rows   list        tile
 *   Collected       5   397.01  ✗   467.01
 *   Refunded        8   290.00  ✓   290.00
 *   Waiting         6   407.04  ✓   407.04
 *   Called off      0     0.00  ✗   403.03
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO WAYS A FIGURE CAME TO HAVE NO ROWS
 *
 * An order carries ONE status, and it is the state of its LAST event. Both
 * failures follow from that:
 *
 *   · a job part-paid and then part-refunded reads `partially_refunded`, so it
 *     sat only under "Money you returned" and its collected half appeared in no
 *     list at all — while still counting toward the Collected tile. Three such
 *     orders here: $35.00, $25.00, $10.00, which is the missing $70.00 exactly.
 *
 *   · most called-off money is a cancelled PLAN PERIOD inside an order that is
 *     otherwise alive, so the order never reads `cancelled` and the group was
 *     empty beneath a tile reading $403.03.
 *
 * The product already had this shape of fix for ONE case — collected money on a
 * waiting order — with a comment explaining it. Neither of the two above was
 * covered, which is why this suite asserts the RULE rather than the three
 * splits: any figure the card states has rows behind it, wherever the order
 * holding them happened to land.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND WHY THE GROUP TOTALS ARE ON SCREEN
 *
 * A tile reading $467.01 sat above rows totalling $397.01 and nobody noticed
 * for weeks, because nothing on the page claimed they were the same money. Each
 * list now states its own figure, from the SAME function the tile uses. A
 * second sum written out here is how the two would drift again.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const read = (relative: string) => readFileSync(join(process.cwd(), relative), 'utf8');

const SECTION = 'components/crm/contact-drawer/PaymentsSection.tsx';

/** Source with comments removed, so these notes cannot satisfy a match. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const section = code(read(SECTION));

describe('money that arrived has a row, wherever its order ended up', () => {
  it('collected entries are lifted out of every settled group, not just waiting', () => {
    /*
     * `[...out.waiting]` alone was the bug. A part-refunded order is just as
     * capable of having taken money as a part-paid one.
     */
    expect(section).toContain(
      'for (const item of [...out.waiting, ...out.refunded, ...out.cancelled]) {'
    );
  });

  it('and money still owed is lifted out of the settled groups too', () => {
    /* The mirror, which already existed and must stay. */
    expect(section).toMatch(/for \(const group of \['paid', 'refunded', 'cancelled'\] as MoneyGroup\[\]\)/);
  });
});

describe('called-off money has rows', () => {
  it('built from the orders that carry it, whatever their own status says', () => {
    expect(section).toMatch(/for \(const group of \['waiting', 'refunded', 'paid'\] as MoneyGroup\[\]\)/);
    expect(section).toContain('if (itemFlow(item).cancelled <= 0) continue;');
  });

  it('under a key of its own, so the row can find its order again', () => {
    expect(section).toContain("const VOIDED_SUFFIX = '::cancelled';");
    expect(section).toContain('[SETTLED_SUFFIX, OWED_SUFFIX, VOIDED_SUFFIX]');
  });

  it('and a half-row never spawns another half-row', () => {
    /*
     * The splits run over groups that the earlier splits have already added to.
     * Without this, a collected half would grow a cancelled half of its own and
     * the same money would be listed twice.
     */
    expect(section).toContain("if (String(item.key).includes('::')) continue;");
  });
});

describe('each list states the figure it is made of', () => {
  it('computed from the same functions the tiles use', () => {
    expect(section).toContain('const groupTotal = rows.reduce((sum, item) => {');
    expect(section).toContain('const flow = itemFlow(item);');
    expect(section).toContain('return sum + outstandingOf(item);');
  });

  it('never by summing the rows a second way', () => {
    /*
     * `amount - refunded` is a DIFFERENT basis from the one `totalMoney` uses
     * for outstanding, and summing it here is how the header and the tile come
     * to disagree.
     */
    const header = section.slice(
      section.indexOf('const groupTotal = rows.reduce'),
      section.indexOf('}, 0);', section.indexOf('const groupTotal = rows.reduce'))
    );

    expect(header).not.toContain('amount');
  });

  it('and the collapsed sentence states the header figure, not a sum of its own', () => {
    /*
     * The quiet Paid line summed `amount - refunded`, which on a part-paid plan
     * is the whole agreement: Tal's read "$1,363.10 received" under a $713.03
     * header, $650.07 of it plan payments never made. Measured 2026-11-26.
     */
    expect(section).toContain(".replace('{amount}', formatCurrency(groupTotal, rows[0].currency))");
    expect(section).not.toMatch(/sum \+ \(Number\(i\.amount\) \|\| 0\) - \(Number\(i\.refunded\) \|\| 0\)/);
  });
});

describe('the tiles read as a sum, and cancelled is kept out of them', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * RECEIVED − REFUNDED = KEPT, THEN STILL TO COLLECT. A DELIBERATE RETURN.
   *
   * Received (gross) beside a net figure was tried once and replaced by
   * Total sales · Collected · Refunded · Still to collect, as "four tiles for
   * three facts". That design confused the owner and testers in turn (2026-11-26):
   * "Total sales" counted refunded money as sold, and "Collected", being net,
   * matched nothing the processor shows.
   *
   * The pair is back on purpose, and this time it states its own arithmetic:
   * the Refunded tile carries a minus, and the sentence above says "You
   * refunded X, so you kept Y". The subtraction is done on screen, so nobody is
   * left to do it twice. Approved from the mockup by the owner.
   * ───────────────────────────────────────────────────────────────────────────
   */
  it('received is the gross, collected plus refunded', () => {
    expect(section).toContain("'received',\n                      totals.collected + totals.refunded,");
  });

  it('kept is the net figure, by that name', () => {
    expect(section).toContain("['kept', totals.collected, STATUS_TONE.paid]");
  });

  it('the refunded tile shows the subtraction it stands for', () => {
    expect(section).toContain("{key === 'returned' ? '−' : ''}");
  });

  it('there is no "Total sales" tile counting refunded money as sold', () => {
    expect(section).not.toContain("'total',");
  });

  it('cancelled sits past a rule with its reason beside it', () => {
    expect(section).toContain('border-t border-dashed');
    expect(section).toContain("t('payments.stat.cancelled_note')");
  });
});

describe('a tile selects the rows behind it', () => {
  it('through a declared mapping, not a guess at the click', () => {
    /* A tile filtering to a group whose rows do not add up to it is worse than
       no filter: it would assert a reconciliation that is false. */
    expect(section).toContain('const TILE_GROUP: Record<string, MoneyGroup | null>');
    expect(section).toContain("kept: 'paid'");
    expect(section).toContain("returned: 'refunded'");
    expect(section).toContain("waiting: 'waiting'");
    /* Received is Paid and Refunded together, so like a total it clears. */
    expect(section).toContain('received: null');
  });

  it('and the groups honour it', () => {
    expect(section).toContain('if (focus && focus !== group) return null;');
  });

  it('with three ways out, so it is never a mode you are stuck in', () => {
    /* The total clears it; pressing the active tile clears it; and the bar
       names the filter with a button beside it. A pending group renders no
       control of its own, so without these there is no way back. */
    expect(section).toContain('onClick={() => setFocus(active || group === null ? null : group)}');
    expect(section).toContain('onClick={() => setFocus(null)}');
    expect(section).toContain("t('payments.filter.show_all')");
  });

  it('announced to a screen reader as a pressed control', () => {
    expect(section).toContain('aria-pressed={active}');
    expect(section).toContain("aria-pressed={focus === 'cancelled'}");
  });
});

describe('the words exist in every language', () => {
  it.each(['en', 'he', 'es'])('%s', language => {
    const file = read(`lib/business-os/translations/${language}.ts`);

    for (const key of [
      'payments.stat.received',
      'payments.stat.kept',
      'payments.stat.returned',
      'payments.stat.waiting',
      'payments.stat.cancelled',
      'payments.stat.cancelled_note',
      'payments.filter.showing',
      'payments.filter.show_all',
      'payments.answer.paid_you',
      'payments.answer.refunded_kept',
      'payments.quiet.refunded',
      'payments.group.orders',
      'payments.group_short.paid',
      'payments.also_listed',
    ]) {
      expect(file).toContain(key);
    }
  });
});
