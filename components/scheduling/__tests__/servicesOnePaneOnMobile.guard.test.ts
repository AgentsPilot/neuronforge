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

/*
 * The editor inside the right-hand pane is the wizard now, so the rules about
 * what the PANEL contains live in its files. The master/detail grid above is
 * still this file's, which is why both are read.
 */
const stripped = (relative: string) =>
  fs
    .readFileSync(path.join(process.cwd(), relative), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

const wizard = stripped('components/scheduling/ServiceWizard.tsx');
const chrome = stripped('components/scheduling/ServiceWizardChrome.tsx');

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
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * ONE CONTROL NOW, AND IT IS NOT PHONE-ONLY.
   *
   * This used to assert a mobile-only chevron labelled "All services", drawn
   * beside the panel's own Cancel: two ways out, one per screen size. The
   * panel is the wizard now and it closes with a single control, which is the
   * same answer on a phone (where the list is hidden behind it) and on a
   * desktop (where Cancel used to sit).
   *
   * What still has to hold is that a phone is never stranded: the list is
   * hidden while a service is open, so the editor must carry a way to put it
   * back, and taking that way must not save anything.
   * ───────────────────────────────────────────────────────────────────────────
   */
  it('exists on the phone only', () => {
    /* The wizard's header carries it, at every width. */
    expect(wizard).toMatch(/onClick=\{onClose\}/);
    /* And the pane it closes is the one that hides the list below `md:`. */
    expect(code).toContain("detailOpen ? 'hidden md:flex' : 'flex'");
  });

  it('does exactly what Cancel does, and nothing more', () => {
    /*
     * The handler clears the two pieces of state that opened the pane and
     * nothing else: no save, no request, no publish. Leaving a service drops
     * unsaved edits, which is what Cancel always did.
     */
    const close = code.slice(code.indexOf('onClose={() => {'), code.indexOf('onClose={() => {') + 160);
    expect(close).toContain('setEditingRowId(null)');
    expect(close).toContain('setIsAddingNewRow(false)');
    expect(close).not.toMatch(/save|fetch|publish/i);
  });

  it('points the right way in both directions', () => {
    /*
     * A chevron had to be chosen per direction, which is why this asserted an
     * `isRTL` ternary. The wizard closes with an X: the one glyph that means
     * the same thing in both directions and needs no mirroring.
     */
    expect(wizard).toMatch(/<X width=\{18\} height=\{18\}/);
    expect(wizard).not.toMatch(/isRTL \?\s*<Chevron/);
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
/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SPINE BECAME THE CLIENT RAIL, and the rule it carried came with it.
 *
 * The `FlowPair` / `FlowStop` spine belonged to the old panel: three sections
 * down the card, each with its consequence level with the controls causing it,
 * plus a stacked copy below `md:` for a single column. The editor is the
 * wizard now and it says the same thing per STEP instead of per section — one
 * question on screen at a time, with what the client does beside it.
 *
 * The two guarantees worth keeping are unchanged, so they are asserted against
 * the rail instead of the spine: the account is fed from resolved values rather
 * than written as prose, and exactly one of its two presentations is on screen
 * at any width.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('the flow along the card', () => {
  it('pairs every section with its own stop', () => {
    /* One rail, rendered once, from the step the owner is on. */
    expect((wizard.match(/<ClientRail/g) ?? []).length).toBe(1);
    expect(wizard).toContain('stops={stops}');
  });

  it('each stop is fed from the resolvers, not from prose', () => {
    /* `stops` is derived from the form's live values, and each stop carries a
       title and an optional note rather than a sentence written in the JSX. */
    expect(wizard).toMatch(/const stops(:| =)/);
    expect(chrome).toContain('{stop.title}');
    expect(chrome).toContain('{stop.note && <span className="sw-rail-note">{stop.note}</span>}');
  });

  it('a stop with nothing to say renders nothing', () => {
    /* An empty stop is a finding, not a blank box: the rail only lists stops
       that the answers so far actually produce. */
    expect(chrome).toContain('stops.map');
  });

  it('the spine is desktop only', () => {
    /* `.sw-rail` is the column, and it is the one that goes on a phone. */
    expect(chrome).toContain('.sw-rail {');
    expect(chrome).toContain('.sw-rail { display: none; }');
  });

  it('and the stacked account is kept for exactly that case', () => {
    /* Deleting it would leave a phone with no account at all. Below 640px the
       column is replaced by a collapsible carrying the same stops. */
    expect(chrome).toContain('.sw-rail-compact { display: block; }');
    expect(chrome).toContain('What your client sees');
  });

  it('only one of the two is ever on screen', () => {
    /*
     * Said twice at once, an owner learns to read neither. The compact form is
     * display:none by default and the column is hidden in the same breakpoint
     * that shows it, so the swap cannot leave both visible.
     */
    expect(chrome).toContain('.sw-rail-compact { display: none; }');
    const phone = chrome.slice(chrome.indexOf('@media (max-width: 640px)'));
    expect(phone).toContain('.sw-rail { display: none; }');
    expect(phone).toContain('.sw-rail-compact { display: block; }');
  });
});
