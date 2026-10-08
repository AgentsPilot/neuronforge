/**
 * A quote request is visible in the contact drawer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG
 *
 * `/api/website/proposal-request` records a client's ask as a `quote_requested`
 * activity, and deliberately writes nothing else: there is no booking, because
 * no time has been agreed, and no invoice, because nobody has said what the
 * work costs. The timeline entry IS the request.
 *
 * It was written to a drawer that had never heard of the type. No icon, so it
 * drew under the generic fallback; no translation, so its label was the raw
 * string `quote_requested`; and no filter category, so pressing any chip made
 * it disappear. The owner's report was "the client booked the quote and it is
 * not in the drawer".
 *
 * The file already carried a development-time warning for exactly this class of
 * mistake — types present in `ACTIVITY_ICONS` that no filter can reach. It
 * could not catch this one, because the type was in neither place.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS SHAPE
 *
 * Three facts have to agree across three files: the icon map, the filter
 * categories, and the translations in every language the drawer speaks. A
 * render test would assert one of them against a component it had to mount with
 * a fixture; the invariant is the agreement.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

const SECTION = 'components/crm/contact-drawer/ActivitySection.tsx';
const ROUTE = 'app/api/website/proposal-request/route.ts';
const CONTEXT = 'lib/business-os/LanguageContext.tsx';

const section = read(SECTION);
const route = read(ROUTE);
const context = read(CONTEXT);

describe('the type the quote request actually writes', () => {
  it('is the one the drawer draws', () => {
    // Pinned against the route, so renaming it in one place fails here rather
    // than silently emptying the timeline.
    expect(route).toContain("activity_type: 'quote_requested'");
    expect(section).toContain('quote_requested: Quote');
  });

  it('can be reached by a filter chip', () => {
    // Without a category it is visible under "all" and nowhere else, which is
    // the trap the file's own development warning describes.
    expect(section).toMatch(/types: \['quote_requested'\]/);
    expect(section).toContain("labelKey: 'crm.activity.filter.quotes'");
  });

  it('reads as words in every language the drawer speaks', () => {
    expect(context.match(/'crm\.activity\.type\.quote_requested':/g) ?? []).toHaveLength(3);
    expect(context.match(/'crm\.activity\.filter\.quotes':/g) ?? []).toHaveLength(3);
    expect(context).toContain("'crm.activity.type.quote_requested': 'Quote Requested'");
    expect(context).toContain("'crm.activity.type.quote_requested': 'התקבלה בקשה להצעת מחיר'");
  });
});

describe('the drawer keeps its own rule', () => {
  it('leaves no icon unreachable by a filter', () => {
    /*
     * The same check the component runs in development, run here so it fails a
     * test rather than a console nobody is reading. Every type that can be
     * drawn must be findable.
     */
    const iconBlock = section.slice(
      section.indexOf('const ACTIVITY_ICONS'),
      section.indexOf('}', section.indexOf('const ACTIVITY_ICONS'))
    );
    const icons = [...iconBlock.matchAll(/^\s{2}([a-z_]+):/gm)].map(match => match[1]);

    const filterBlock = section.slice(
      section.indexOf('const FILTER_CATEGORIES'),
      section.indexOf('const ACTIVITY_ICONS')
    );
    const covered = new Set([...filterBlock.matchAll(/'([a-z_]+)'/g)].map(match => match[1]));

    const orphaned = icons.filter(type => !covered.has(type));
    expect(orphaned).toEqual([]);
  });
});
