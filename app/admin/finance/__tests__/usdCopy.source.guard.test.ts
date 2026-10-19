/**
 * Money MK-5a, USD-6 (KPI restructure review §3.4, SA-9): the Finance copy
 * guard. A US-dollar amount is shown as `$1,234.56`, never "USD 1,234.56".
 *
 * Source rule: no file under `app/admin/finance` (comments stripped) holds a
 * money string of the shape `USD <digit>`, `USD -<digit>`, `` `USD ${`` or
 * `'USD '` / `"USD "` (a code glued to an amount). Labels that name the
 * currency, such as "(USD)" or "estimate, USD", are not money strings and pass.
 * The render rule (no rendered "USD <digit>" on the page with every section
 * filled) lives beside the page's fixtures in `financePage.render.test.tsx`.
 *
 * Exempt by scope, as SA-9 rules: the Businesses drawer's own-currency client
 * payments live in `app/admin/users`, and the SQL check files in `scripts/`;
 * neither is under this folder. Every rule has a planted control.
 */

import * as fs from 'fs';
import * as path from 'path';

import { stripComments } from '@/tests/helpers/source-scan';

const ROOT = process.cwd();
const DIR = 'app/admin/finance';

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      found.push(...walk(rel));
    } else if (/\.tsx?$/.test(entry.name)) {
      found.push(rel);
    }
  }
  return found.sort();
}

/** A money string with the US-dollar code instead of the sign. */
const USD_MONEY = /USD -?\d|`USD \$\{|['"]USD ['"]|USD \$\{/;

const offendersIn = (code: string): string[] => code.split(/\r?\n/).filter((line) => USD_MONEY.test(line)).map((line) => line.trim());

const FILES = walk(DIR);

describe('USD-6: no "USD " money string in the Finance page source', () => {
  it('walked the folder (non-vacuity)', () => {
    expect(FILES).toEqual(expect.arrayContaining([`${DIR}/financeFormat.ts`, `${DIR}/financeCopy.ts`, `${DIR}/components/FinanceKpiStrip.tsx`]));
    expect(FILES.length).toBeGreaterThan(20);
  });

  it.each(FILES)('%s', (file) => {
    const code = stripComments(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    expect({ file, offenders: offendersIn(code) }).toEqual({ file, offenders: [] });
  });

  it('planted controls: each money shape is caught; labels and comments are not', () => {
    expect(offendersIn("const a = 'A failed call is recorded at USD 0 in both.';")).toHaveLength(1);
    expect(offendersIn('const a = `USD ${value}`;')).toHaveLength(1);
    expect(offendersIn("return 'USD ' + text;")).toHaveLength(1);
    expect(offendersIn("const fee = 'Assumed 2.9% + USD -0.30';")).toHaveLength(1);
    expect(offendersIn("export const ECON_COST = 'Charged AI cost (USD)';")).toEqual([]);
    expect(offendersIn("const label = 'Margin after Stripe fees (estimate, USD)';")).toEqual([]);
    expect(offendersIn(stripComments('// was "USD 12.50" before MK-5a\nconst a = 1;'))).toEqual([]);
  });
});
