/**
 * "Export all orders" exports all the orders.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * The button's own tooltip read "Export all orders" / "ייצוא כל ההזמנות". It
 * serialised `items`, which is one page — `PAGE_SIZE` is 10 — while the footer
 * directly underneath said "1-10 of 73".
 *
 * Nothing errored. The file downloaded, had the right columns and the right
 * shape, and was missing 63 rows. An owner reconciling a bank statement has no
 * reason to count the lines in a file they just asked for, so this is the kind
 * of wrong that is found months later by someone who trusted it.
 *
 * Two more things the file got wrong on the way:
 *
 *   NO CLIENT COLUMN. It opened with the service name and never named the
 *   person, though the row on screen leads with them and the client is the
 *   column a bank statement is reconciled against.
 *
 *   A RAW INSTANT. `item.date` went in whole, so a cell read
 *   `2026-10-14T09:00:00.000Z` — UTC, for a row whose date on screen is the
 *   business's own and can be the day either side of it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * The handler builds a Blob and drives an `<a download>`, which jsdom does not
 * perform, and the branch that matters is a fetch with different query
 * parameters. What has to hold is which parameters it sends and which fields it
 * writes — properties of the source. The serialiser those rows pass through is
 * tested for real in `csv.test`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';
import { dictionarySource } from '@/tests/helpers/dictionarySource';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

const list = read('components/payments/MoneyList.tsx');
const view = read('components/payments/PaymentsView.tsx');
const route = read('app/api/payments/money/route.ts');
const ledger = read('lib/payments/ledgerService.ts');
const copy = dictionarySource();

/** The export handler, bounded so an assertion cannot drift into the loader. */
const handler = (() => {
  const from = list.indexOf('const exportCsv = async ()');
  expect(from).toBeGreaterThan(-1);
  return list.slice(from, list.indexOf('exportRef.current = exportCsv'));
})();

describe('it exports every matching row, not the page', () => {
  it('re-asks the route without the page window', () => {
    expect(handler).toMatch(/limit: String\(EXPORT_CAP\)/);
    expect(handler).toMatch(/offset: '0'/);
  });

  it('no longer serialises the page it already had', () => {
    /* `items` is one page. It may still be read for a PICKED set — those rows
       were chosen by hand and are all on this page by definition. */
    expect(handler).toMatch(/items\.filter\(i => selected\.has\(i\.key\)\)/);
    expect(handler).not.toMatch(/const chosen = selected\.size > 0 \? items\.filter\(.*\) : items/);
  });

  it('carries the SAME filter the screen is showing', () => {
    /*
     * Not a recomputation of it. A second implementation of "what is on
     * screen" is exactly how an export comes to disagree with the screen.
     */
    for (const param of ['filter,', 'sort,', 'kind:']) {
      expect(handler).toContain(param);
    }
    expect(handler).toMatch(/params\.set\('search', searchQuery\.trim\(\)\)/);
  });

  it('the route will actually serve that many', () => {
    /*
     * The Zod ceiling was 100, so asking for more was silently clamped and the
     * file would have been short in a new way. Bounded by the same cap the
     * route already applies to its own reads.
     */
    expect(route).toMatch(/limit: z\.coerce\.number\(\)\.int\(\)\.min\(1\)\.max\(GROUPING_CAP\)/);
  });

  it('says so when it cannot build the file', () => {
    // A download that silently does not happen gets clicked again, and again.
    expect(handler).toMatch(/setError\(t\('payments\.export\.failed'\)/);
  });

  it('the button reports that it is working', () => {
    /* It is a round trip now. */
    expect(view).toMatch(/setExportingView\(true\)/);
    expect(view).toMatch(/await moneyApi\.exportCsv\(\)/);
    expect(view).toMatch(/disabled=\{!canExportView \|\| exportingView\}/);
  });
});

describe('the file says what the screen says', () => {
  it('names the client, in the first column', () => {
    const header = handler.slice(handler.indexOf('const rows'), handler.indexOf('...chosen.map'));

    expect(header).toMatch(/payments\.export\.client/);
    expect(header.indexOf('export.client')).toBeLessThan(header.indexOf('export.item'));
  });

  it('writes the client name into the row', () => {
    expect(handler).toMatch(/item\.contactName \?\? ''/);
  });

  it('writes the date the row shows, not the raw instant', () => {
    expect(handler).toMatch(/item\.date \? formatDate\(item\.date\) : ''/);
    expect(handler).not.toMatch(/^\s*item\.date,$/m);
  });

  it('keeps the amount gross with the refund beside it', () => {
    /* The same decision as every other money surface: what was paid, then what
       came back. A net figure in one column answers neither question. */
    expect(handler).toMatch(/item\.amount\.toFixed\(2\)/);
    expect(handler).toMatch(/item\.refunded \? item\.refunded\.toFixed\(2\) : ''/);
  });
});

describe('both exports go through the one serialiser', () => {
  it('the orders export does', () => {
    expect(handler).toMatch(/toCsvFile\(rows\)/);
    /* The hand-rolled quoting is gone: it was valid CSV and no defence. */
    expect(handler).not.toMatch(/replace\(\/"\/g, '""'\)/);
  });

  it('the ledger export does', () => {
    /*
     * The accountant's file carries the same publicly-submitted names. It had
     * its own copy of the same unsafe quoting.
     */
    expect(ledger).toMatch(/import \{ toCsv \} from '@\/lib\/payments\/csv'/);
    expect(ledger).not.toMatch(/\.map\(cell => `"\$\{String\(cell \?\? ''\)/);
  });
});

describe('the copy exists in all three languages', () => {
  it('for every new export string', () => {
    for (const key of ['failed', 'working']) {
      const hits = copy.match(new RegExp(`'payments\\.export\\.${key}':`, 'g')) ?? [];
      expect({ key, count: hits.length }).toEqual({ key, count: 3 });
    }
  });

  it('and the client heading is declared once per language, not twice', () => {
    /*
     * It already existed, used by the transactions export. Adding it again
     * produced a duplicate object key in each locale block — the TS1117 class
     * this file is already full of, where the later declaration silently wins.
     */
    const hits = copy.match(/'payments\.export\.client':/g) ?? [];

    expect(hits).toHaveLength(3);
  });
});
