/**
 * The chips and the rows answer the same question.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The field draws chips by parsing the search string. The route decides which
 * contacts come back by parsing the search string. If those are ever two
 * different readings, the screen shows a filter it has not applied — the worst
 * failure available here, because a filtered list looks exactly like a correct
 * one and nothing on screen says otherwise.
 *
 * So: one function, called by both. This pins that, and the handful of
 * decisions around it that are easy to undo by accident.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

const field = read('components/crm/ContactSearchField.tsx');
const route = read('app/api/crm/contacts/route.ts');
const repository = read('lib/repositories/CRMContactRepository.ts');
const page = read('app/business-os/crm/page.tsx');

describe('one string, one reader', () => {
  it('the field and the route call the same parser', () => {
    expect(field).toMatch(/parseContactSearch/);
    expect(route).toMatch(/parseContactSearch\(rawSearch \?\? '', businessDayFor\(/);
  });

  it('the field keeps no chip array of its own', () => {
    /*
     * The text is the only state. A parallel list of chips is a second place
     * for the filter to live, and the two drift the first time one is updated
     * without the other.
     */
    expect(field).not.toMatch(/useState<[^>]*Term\[\]>/);
    expect(field).toMatch(/const terms = useMemo\(\(\) => parseContactSearch\(value, today\)/);
  });

  it('the dates are the orders parser\'s, not a second implementation', () => {
    // "this month" must mean the same thing on both pages.
    const parser = read('lib/crm/contactSearchTerms.ts');
    expect(parser).toMatch(/from '@\/lib\/payments\/moneySearchTerms'/);
    expect(parser).toMatch(/parseMoneySearch\(leftovers\.join\(' '\)/);
  });
});

describe('the filter narrows the QUERY, not the page', () => {
  it('the route hands the parts to the repository', () => {
    /*
     * The board pages twenty contacts per stage column. A filter applied to a
     * page after it arrives would show three of twenty and hide every match
     * sitting on page two — the list would be wrong and look complete.
     */
    expect(route).toMatch(/stages: of\('stage'\)/);
    expect(route).toMatch(/sources: of\('source'\)/);
    expect(route).toMatch(/allTags: of\('tag'\)/);
    expect(route).toMatch(/createdFromUtc/);
  });

  it('the repository turns them into SQL', () => {
    expect(repository).toMatch(/query\.in\('stage', wantedStages\)/);
    expect(repository).toMatch(/query\.in\('source', wantedSources\)/);
    expect(repository).toMatch(/query\.contains\('tags', wantedTags\)/);
    expect(repository).toMatch(/query\.gte\('created_at', createdFromUtc\)/);
  });

  it('drops blank values before they reach the query', () => {
    /*
     * Measured, not guessed: `.contains('tags', [undefined])` returned every
     * contact. A filter that silently matches all is worse than one that
     * errors, because the screen looks like an unfiltered list.
     */
    expect(repository).toMatch(/value\.trim\(\)\.length > 0/);
  });

  it('only free text reaches the name matcher', () => {
    // A chip's own characters would never match a name, so leaving them in
    // would make every filtered search return nothing.
    expect(route).toMatch(/search: of\('text'\)\.map\(term => term\.raw\)\.join\(' '\)/);
  });

  it('resolves the period on the business clock, not in UTC', () => {
    /*
     * A contact added at 23:00 in New York on the last day of September is
     * 03:00 UTC on 1 October. Bounding a UTC day drops them out of the month
     * they were added in.
     */
    expect(route).toMatch(/fromBusinessLocalInput\(/);
    expect(repository).toMatch(/createdFromUtc\?: string/);
  });
});

describe('the vocabulary belongs to the account', () => {
  it('stages come from the account\'s own pipeline', () => {
    expect(page).toMatch(/pipelineStages\.map\(stage => \(\{ value: stage\.stage_key/);
  });

  it('sources and tags are what this business has actually recorded', () => {
    // Offering `source:newsletter` to somebody who has never run one is a
    // filter that can only return nothing.
    expect(page).toMatch(/const sourceOptions = useMemo/);
    expect(page).toMatch(/const tagOptions = useMemo/);
  });

  it('both search boxes are the same field', () => {
    // The phone had its own bare input. Two boxes, one of which understands
    // filters, is a worse answer than one that works everywhere.
    expect(page.match(/<ContactSearchField/g) ?? []).toHaveLength(2);
  });
});

describe('the focus ring is not clipped', () => {
  it('the toolbar stops scrolling where the box exists', () => {
    /*
     * `overflow-x-auto` cannot clip one axis alone — CSS promotes the other
     * from `visible` — so the focus ring, drawn outside the border box, was
     * sliced top and bottom the moment the field was focused.
     */
    expect(page).toMatch(/overflow-x-auto md:overflow-visible/);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * AN AGGREGATE EMBED DOES NOT FILTER.
 *
 * `crm_tasks!inner(count)` returned EVERY contact while
 * `crm_tasks!inner(id)` returned the one with an open task. An embed that
 * selects only an aggregate does not constrain the join, so the `!inner` on it
 * is silently inert — and reported as exactly that: "open tasks shows all
 * contacts".
 *
 * It is the worst shape a filter can take. The list looks unfiltered rather
 * than wrong, so nothing on screen says the filter did nothing, and a probe
 * that checked `(id)` while the code shipped `(count)` passed happily.
 *
 * The counting embeds are therefore left alone and a SECOND, aliased embed
 * selecting a real column does the narrowing.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('the join that filters is not the one that counts', () => {
  it('never puts !inner or !left on an aggregate embed', () => {
    const code = repository
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    expect(code).not.toMatch(/!inner\(count\)/);
    expect(code).not.toMatch(/!left\(count\)/);
  });

  it('narrows through an aliased embed selecting a real column', () => {
    expect(repository).toMatch(/purchases:scheduling_bookings!inner\(id\)/);
    expect(repository).toMatch(/no_bookings:scheduling_bookings!left\(id\)/);
    expect(repository).toMatch(/open_tasks:crm_tasks!inner\(id\)/);
    expect(repository).toMatch(/no_tasks:crm_tasks!left\(id\)/);
  });

  it('keeps the counting embeds exactly as they were', () => {
    // The count is what the pipeline card reads. It must survive the filter.
    expect(repository).toMatch(/'scheduling_bookings\(count\)'/);
    expect(repository).toMatch(/'crm_tasks\(count\)'/);
  });

  it('predicates name the alias, not the relation', () => {
    // Pointing at the relation would filter the COUNT instead of the join —
    // the same silent-nothing failure wearing a different hat.
    expect(repository).toMatch(/query\.is\('purchases\.parent_booking_id', null\)/);
    expect(repository).toMatch(/query\.neq\('open_tasks\.status', 'completed'\)/);
  });

  it('"has bookings" means has a PURCHASE', () => {
    // A package is one booking containing its sessions, so a client who bought
    // a six-session block has one purchase and not six.
    expect(repository).toMatch(/no_bookings\.parent_booking_id/);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * THE EXPORT IS READ BY A PERSON, NOT BY THIS PRODUCT.
 *
 * Reported from a real export:
 *
 *     טלפון          שלב                  מקור
 *     2013643030     family_enrolled      website_form
 *     +972543254785  family_enrolled      booking
 *
 * Two of those columns were printing DATABASE KEYS. `family_enrolled` is an
 * implementation detail of this product; the accountant opening the file has
 * never seen it and cannot look it up.
 *
 * And a phone is text that a spreadsheet insists is a number: CSV quoting is
 * syntax, not type, so Excel reads `"0543254785"` as 543254785 and the leading
 * zero is gone — an Israeli mobile one digit short, silently.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('the exported file says what a person can read', () => {
  it('exports the stage LABEL, not the column value', () => {
    expect(page).toMatch(
      /stageOptions\.find\(option => option\.value === contact\.stage\)\?\.label/
    );
  });

  it('exports the source label through the same reading as the filter panel', () => {
    // Two readings would drift, and the export is where that shows up as
    // `website_booking` in a column somebody sends on.
    expect(page).toMatch(/sourceLabel\(contact\.source\)/);
    expect(page).toMatch(/const sourceLabel = useMemo/);
  });

  it('writes the phone as text a spreadsheet cannot renumber', () => {
    expect(page).toMatch(/const asText = \(value: string\)/);
    expect(page).toMatch(/asText\(contact\.phone \|\| ''\)/);
  });

  it('does not quote an already-quoted cell twice', () => {
    // `"=""0543..."""` reaches the reader as literal characters.
    expect(page).toMatch(/text\.startsWith\('="'\) \? text :/);
  });
});

describe('the CSV escaping rule itself', () => {
  /** The page's rule, restated — the two lines that decide every cell. */
  const asText = (value: string) => (value ? `="${value.replace(/"/g, '""')}"` : '');
  const cell = (value: string) => {
    const text = String(value);
    return text.startsWith('="') ? text : `"${text.replace(/"/g, '""')}"`;
  };

  it('keeps a leading zero, which is the whole point', () => {
    // Plain quoting loses it in Excel; this is what a reader gets back.
    expect(cell(asText('0543254785'))).toBe('="0543254785"');
  });

  it('keeps a plus, so an international number stays dialable', () => {
    expect(cell(asText('+972543254785'))).toBe('="+972543254785"');
  });

  it('leaves an empty phone empty rather than printing =""', () => {
    expect(cell(asText(''))).toBe('""');
  });

  it('still escapes an ordinary cell the ordinary way', () => {
    expect(cell('Dana "Dee" Cohen')).toBe('"Dana ""Dee"" Cohen"');
  });

  it('escapes a quote inside a phone, absurd as that is', () => {
    // It costs one `replace` to not produce a broken file for a junk value.
    expect(cell(asText('05"4'))).toBe('="05""4"');
  });
});
