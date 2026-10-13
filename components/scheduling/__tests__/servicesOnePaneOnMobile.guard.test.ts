/**
 * On a phone the services tab shows ONE pane, and on a desktop it shows two.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 *
 * The tab is a master/detail grid: a 300px list beside the editor from `md` up,
 * and one column below it. Stacked, the list took the screen and the editor sat
 * under it at whatever height its own content wanted — so tapping a service
 * changed something nobody could see, and Save was the last thing on a very
 * long page. An owner could not edit a service from their phone.
 *
 * Now the phone shows the list, or the service, and a back control returns.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD, AND WHAT IT IS REALLY PROTECTING
 *
 * jsdom has no viewport and does not evaluate media queries, so `hidden md:flex`
 * measures exactly the same there as `flex`. No render test can tell the two
 * layouts apart; the whole behaviour lives in classes.
 *
 * The thing most worth protecting is not the mobile layout, it is the DESKTOP
 * one: every rule below is paired with an `md:` counterpart precisely so that
 * nothing above 768px moves, and a future edit that drops one of those pairs
 * would silently change the screen most owners use.
 *
 * Comments are stripped before matching, because the notes beside each class
 * quote the arrangement they replaced.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';
import { dictionarySource } from '@/tests/helpers/dictionarySource';

const FILE = 'components/scheduling/SchedulingServicesList.tsx';
const source = fs.readFileSync(path.join(process.cwd(), FILE), 'utf8');
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const CONTEXT = dictionarySource();

describe('the desktop layout is untouched', () => {
  it('still puts the list beside the panel from md up', () => {
    expect(code).toContain('md:grid-cols-[300px_minmax(0,1fr)]');
  });

  it('shows both panes at md, whichever one the phone is on', () => {
    // Each mobile rule carries its own way back. Without the `md:` half, a
    // desktop would show one pane at a time too.
    expect(code).toContain("detailOpen ? 'hidden md:flex' : 'flex'");
    expect(code).toContain("detailOpen || hideServiceList ? 'flex' : 'hidden md:flex'");
  });

  it('returns row sizing to the browser default above md', () => {
    expect(code).toContain('grid-rows-[minmax(0,1fr)] md:grid-rows-none');
  });
});

describe('the phone shows one pane', () => {
  it('bounds that pane to the dialog instead of to its own content', () => {
    /*
     * Without a bounded row the panel grows to the height of the form: the
     * header scrolls away, Save lands at the bottom of a long page, and the
     * panel's own `overflow-y-auto` never scrolls because nothing constrains
     * it. This single class is what pins the header and the footer.
     */
    expect(code).toMatch(/grid-rows-\[minmax\(0,1fr\)\]/);
  });

  it('decides which pane from state that already existed', () => {
    // No new useState: `editingRowId` already means "this service is open", so
    // every existing entry point keeps working, the chat's autoEditServiceId
    // and autoStartNewRow included.
    expect(code).toMatch(/const detailOpen = isAddingNewRow \|\| selectedService !== null;/);
    expect(code).not.toMatch(/useState[^\n]*detailOpen/);
    expect(code).not.toMatch(/setDetailOpen/);
  });

  it('keeps the placeholder off the phone', () => {
    // "Pick a service" fills an empty half on a desktop. On a phone it would be
    // a whole screen telling the owner to choose from a list they cannot see,
    // which is why the panel is hidden rather than the placeholder restyled.
    expect(code).toContain("'hidden md:flex'");
  });

  it('takes the list away on a phone, and whatever travels with it', () => {
    /*
     * This counted TWO uses of the rule, because "Add a service" sat above both
     * panes and had to step aside with the list — on a phone it floated above
     * the service being edited and offered to start a different one.
     *
     * That button is gone: there were three ways to start the same thing, two
     * of them on screen at once, above a panel whose own heading already said
     * what it was for. The rule it shared is still what makes the phone show
     * one pane rather than one pane with a hole in it, so the rule is still
     * pinned — just once, by the thing that still exists.
     */
    const occurrences = code.match(/detailOpen \? 'hidden md:flex' : 'flex'/g) ?? [];
    expect(occurrences.length).toBe(1);
  });

  it('and there are two ways to add a service, not three', () => {
    /*
     * There were three entry points to one action, two of them on screen at
     * once, above a panel whose own heading already said what it was for. The
     * two that remain each have a reason: one sits with the list it adds to,
     * and one is the only way to make a FIRST service.
     *
     * Counted rather than named, because the comment explaining the removal is
     * stripped before this runs.
     */
    expect((code.match(/scheduling\.new_service/g) ?? []).length).toBe(2);
  });

  it('still shows the panel to callers that have no list', () => {
    // The landing-page wizard embeds the panel alone.
    expect(code).toContain('detailOpen || hideServiceList');
  });
});

describe('the way back', () => {
  it('exists on the phone only', () => {
    /*
     * Anchored on the control itself rather than on a slice of the function:
     * the panel declares its field classes long before it renders its header,
     * so "between renderServicePanel and const field" is the wrong window and
     * was the first thing this guard got wrong.
     */
    const first = code.indexOf('onClick={isNew ? cancelNewRow : cancelRowEdit}');
    expect(first).toBeGreaterThan(-1);
    const control = code.slice(Math.max(0, first - 200), first + 600);
    expect(control).toContain('md:hidden');
  });

  it('does exactly what Cancel does, and nothing more', () => {
    // Same handlers, so it carries no consequence the owner has not already
    // met — including that leaving a service drops unsaved edits, which is
    // true of Cancel today on every screen size.
    const backCalls = code.match(/onClick=\{isNew \? cancelNewRow : cancelRowEdit\}/g) ?? [];
    expect(backCalls.length).toBe(2);
  });

  it('points the right way in both directions', () => {
    // `ms`/`me` flip with direction; a chevron does not, so this one glyph is
    // chosen rather than mirrored.
    expect(code).toMatch(/isRTL \? <ChevronRight[^>]*\/> : <ChevronLeft[^>]*\/>/);
    expect(code).toMatch(/import \{[^}]*ChevronLeft[^}]*\} from 'lucide-react'/);
  });

  it('is labelled in every language the dialog speaks', () => {
    expect(CONTEXT.match(/'config\.services\.all':/g) ?? []).toHaveLength(3);
    expect(CONTEXT).toContain("'config.services.all': 'All services'");
    expect(CONTEXT).toContain("'config.services.all': 'כל השירותים'");
  });
});

/**
 * The flow runs down the inside of the editor, with the stacked account kept
 * underneath for a panel too narrow to carry it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The account of what a service does used to sit at the FOOT of the panel, so
 * an owner changing a control had to scroll to learn what they had just done --
 * and by then the control was off screen and the connection was theirs to make.
 *
 * Each consequence now sits level with the section that causes it. The stacked
 * version is kept and shown below `md:`, where there is one column and no room
 * for a spine, so nothing is lost on a phone.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('the flow along the card', () => {
  it('pairs every section with its own stop', () => {
    // Three sections, three stops: what they read, what it does to the diary,
    // how the money arrives.
    expect((code.match(/<FlowPair/g) ?? []).length).toBe(3);
    expect((code.match(/<\/FlowPair>/g) ?? []).length).toBe(3);
  });

  it('each stop is fed from the resolvers, not from prose', () => {
    expect(code).toContain('lines={identityStop}');
    expect(code).toContain('lines={diaryStop}');
    expect(code).toContain('lines={moneyStop}');
    // The diary stop IS the journey, rendered through the same translator.
    expect(code).toContain('const diaryStop = journeySteps.map(journeyText)');
  });

  it('a stop with nothing to say renders nothing', () => {
    // An empty stop is a finding, not a blank box: it says that part of the
    // service has not been answered yet.
    expect(code).toContain('if (!lines.length) return');
  });

  it('the spine is desktop only', () => {
    // Below `md:` the panel is one column; a second would have nowhere to go.
    const stop = code.slice(code.indexOf('function FlowStop'), code.indexOf('function FlowPair'));
    expect(stop).toContain('hidden md:block');
  });

  it('and the stacked account is kept for exactly that case', () => {
    // Deleting it would leave a phone with no account at all.
    expect(code).toContain("md:hidden border-t border-[var(--v2-border)] pt-2.5");
    expect(code).toContain("t('scheduling.modal.how_it_works')");
  });

  it('only one of the two is ever on screen', () => {
    // Said twice at once, an owner learns to read neither.
    const stop = code.slice(code.indexOf('function FlowStop'), code.indexOf('function FlowPair'));
    expect(stop).toContain('hidden md:block');
    expect(code).toContain('md:hidden');
  });
});
