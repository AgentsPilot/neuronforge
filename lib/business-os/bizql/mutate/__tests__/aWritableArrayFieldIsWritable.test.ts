/**
 * A field the catalogue declares writable must actually be writable.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE IMPORT THAT FILED NOBODY
 *
 * `contacts.tags` is `type: 'string[]'` and sits in `create_contacts`'s
 * `optionalFields`. `resolveWriteValue` had a case for a scalar and a case for
 * `{"$date":…}`, and threw for everything else — so an array, the only shape a
 * `string[]` column can take, was refused:
 *
 *     'contacts.tags' was given a value the compiler cannot store
 *     (["spreadsheet-import"]). Give a literal, or {"$date":"…"} …
 *
 * It survived because it failed INVISIBLY. `import_leads_from_sheet` tags every
 * contact it files, and its scatter sets `continueOnError` so that one bad row
 * cannot abort an import half way. So all 171 rows failed, every failure was
 * swallowed, and the run reported COMPLETED with `last_run` written. On a live
 * account the owner saw a healthy agent, a plausible 111-second duration, and
 * an empty CRM — and no error anywhere to explain it.
 *
 * The tag is also load-bearing rather than decorative: `follow_up_new_enquiries`
 * excludes it so that an import cannot arm the enquiry chaser against two
 * hundred old leads a week later. A tag that cannot be written is that guard
 * silently absent.
 * ─────────────────────────────────────────────────────────────────────────────
 */

jest.mock('@/lib/logger', () => {
  const logger = {
    error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), child: () => logger,
  };
  return { createLogger: () => logger };
});

import { readFileSync } from 'fs';
import { join } from 'path';
import { SEMANTIC_CATALOG } from '@/lib/business-os/catalog/catalog';

const EXECUTOR = join(process.cwd(), 'lib/business-os/bizql/mutate/MutateExecutor.ts');
const IMPORTER = join(
  process.cwd(),
  'lib/business-os/automations/agents/importLeadsFromSheet.steps.json'
);

describe('the catalogue and the compiler agree about arrays', () => {
  it('declares contacts.tags as an array', () => {
    /* If this ever becomes a plain string the test below is measuring the
       wrong thing, so the premise is asserted rather than assumed. */
    /* Entities sit at the top level of the catalogue, keyed by name. */
    const entities = SEMANTIC_CATALOG as unknown as Record<
      string,
      { fields?: Record<string, { type?: string; writable?: boolean }> }
    >;
    const tags = entities.contacts?.fields?.tags;

    expect(tags?.type).toBe('string[]');
    /* And advertised as writable, which is what made the refusal a defect
       rather than a design decision. */
    expect(tags?.writable).toBe(true);
  });

  it('the write compiler has a case for that type', () => {
    const src = readFileSync(EXECUTOR, 'utf-8');

    /* Inside `resolveWriteValue`, keyed on the declared type — not a blanket
       "arrays are fine", which would let one into a money column. */
    const fn = src.slice(src.indexOf('function resolveWriteValue'));

    expect(fn).toMatch(/Array\.isArray\(value\)[\s\S]{0,80}field\.type === 'string\[\]'/);
  });

  it('refuses an array of objects, which is the hazard one level down', () => {
    /*
     * The throw this sits in front of exists because `[object Object]` in a
     * user's data is worse than a failed write. An array of objects is the
     * same problem inside a list, so the guard checks the elements too.
     */
    const src = readFileSync(EXECUTOR, 'utf-8');
    const fn = src.slice(src.indexOf('function resolveWriteValue'));

    expect(fn).toMatch(/typeof item === 'object'/);
  });
});

describe('the importer depends on it', () => {
  it('writes the tag the enquiry chaser excludes', () => {
    /*
     * Named together, because the pairing is the guard: the importer writing
     * the tag and the chaser skipping it are one mechanism, and this file is
     * about the half that silently did not work.
     */
    const plan = readFileSync(IMPORTER, 'utf-8');

    expect(plan).toContain('"tags": ["spreadsheet-import"]');
  });

  it('still lets one bad row through without aborting the import', () => {
    /*
     * `continueOnError` is correct and stays — half an import with no way to
     * tell which half ran is worse. It is only dangerous when paired with a
     * write that can never succeed, which is what this fix removes.
     */
    const plan = JSON.parse(readFileSync(IMPORTER, 'utf-8')) as Array<Record<string, unknown>>;
    const scatter = plan.find(s => s.type === 'scatter_gather')?.scatter as
      | { continueOnError?: boolean }
      | undefined;

    expect(scatter?.continueOnError).toBe(true);
  });
});
