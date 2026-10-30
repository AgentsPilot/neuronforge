/**
 * The agent list is a ledger: one line per agent, under real column headers.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * It began as a stack of three paragraphs per agent, piled against the start
 * edge with the buttons alone at the far end — about seventy pixels a row,
 * which read fine at one agent and became a wall at six.
 *
 * A ledger was chosen over two alternatives because the times line up down the
 * page: the eye compares columns, not sentences, and "when does this next run"
 * is the question the card is opened with.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const card = readFileSync(
  join(root, 'components', 'business-os', 'insight', 'RunningAgentsCard.tsx'),
  'utf-8'
);

describe('the ledger', () => {
  it('has real column headers, not a stack', () => {
    expect(card).toContain('<thead>');
    for (const key of [
      'automation.col_agent',
      'automation.col_watches',
      'automation.col_every',
      'automation.col_last',
      'automation.col_next',
      'automation.col_stops',
    ]) {
      expect(card).toContain(key);
    }
  });

  it('scrolls sideways rather than dropping a column on a phone', () => {
    /*
     * These are six genuine facts. Squeezing would mean an owner cannot see
     * when something next runs on a phone, which is the one thing they came
     * for — so the table keeps its width and the card scrolls.
     */
    expect(card).toContain("overflowX: 'auto'");
    expect(card).toContain("minWidth: '680px'");
  });

  it('keeps the agent name on screen while the times scroll under it', () => {
    /*
     * The consequence of scrolling instead of squeezing, and the reason this is
     * not cosmetic: a phone shows roughly half the table, so an owner reading
     * the "next run" column has scrolled the names away — identical rows of
     * times with nothing saying which agent owns each one, and the pause and
     * remove buttons at the end of every one of them.
     */
    expect(card).toContain('const PINNED');
    expect(card).toContain("position: 'sticky'");

    /* A sticky cell with no fill lets the scrolling columns read straight
       through its text. */
    const pinned = card.slice(card.indexOf('const PINNED'), card.indexOf('function stateOf'));
    expect(pinned).toContain('background:');

    /* Applied to the header AND the body cell, or the two come apart as it
       scrolls. */
    expect(card).toContain('...(i === 0 ? PINNED : null)');
    expect(card).toContain("padding: '9px 10px', ...PINNED");
  });

  it('pins to the start edge, not the left one', () => {
    /* The Hebrew ledger scrolls the other way, and `left: 0` would pin the
       names to the far end of it — off screen, which is the bug this fixes. */
    expect(card).toContain('insetInlineStart: 0');
    expect(card).not.toMatch(/position: 'sticky',\s*left:/);
  });

  it('says plainly when an agent has never run', () => {
    /* An agent that has never run looks identical to one that runs silently,
       and the runner being parked is exactly the state this platform is in. */
    expect(card).toContain('automation.never_run');
  });
});

describe('one colour per state, and green belongs to running', () => {
  it('names the three states explicitly', () => {
    expect(card).toContain("type AgentState = 'running' | 'paused' | 'blocked';");
    expect(card).toContain('const STATE_COLOUR: Record<AgentState,');
  });

  it('gives green to running and to nothing else', () => {
    /*
     * The rule. Paused is a decision the owner made and blocked is something
     * they can fix; neither is success, and either of them in green makes the
     * only question this card answers — what is working for me right now —
     * unanswerable at a glance.
     */
    const table = card.slice(card.indexOf('const STATE_COLOUR'), card.indexOf('function stateOf'));

    expect(table).toMatch(/running: \{ fg: 'var\(--v2-success\)'/);
    expect(table).not.toMatch(/paused:[^}]*--v2-success/);
    expect(table).not.toMatch(/blocked:[^}]*--v2-success/);
  });

  it('keeps the next-run figure green only when something is coming', () => {
    /* A paused agent with a stale `next_run` in the column would read as
       running. */
    expect(card.replace(/\s+/g, ' ')).toContain(
      "{state === 'running' && when(agent.nextRun) ? ("
    );
  });

  it('lets blocked outrank paused', () => {
    /* Un-pausing a blocked agent still leaves an agent that cannot run, and the
       row has to keep saying so. */
    const fn = card.slice(card.indexOf('function stateOf'), card.indexOf('function stateOf') + 400);

    expect(fn.indexOf('blocked')).toBeLessThan(fn.indexOf("=== 'active'"));
  });
});

describe('it scrolls on a phone', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * STICKY CELLS AND `border-collapse: collapse` DO NOT WORK TOGETHER.
   *
   * It is a WebKit limitation, and on iOS every browser is WebKit — so this is
   * not an edge case, it is the phone. With `collapse` the pinned agent name
   * froze and the columns beside it would not scroll at all: "when does it next
   * run", the fact this card exists to answer, was unreachable on the device an
   * owner is most likely to be holding.
   *
   * `separate` with `border-spacing: 0` looks identical on a desktop and lets
   * sticky work. The cost is that a `<tr>` border is no longer painted, which
   * is why the dividers live on the cells — asserted below, because moving them
   * back would silently remove every line between rows.
   * ───────────────────────────────────────────────────────────────────────────
   */

  it('does not combine sticky cells with a collapsed border model', () => {
    const hasSticky = card.includes("position: 'sticky'");
    expect(hasSticky).toBe(true);
    expect(card).not.toMatch(/borderCollapse:\s*'collapse'/);
    expect(card).toMatch(/borderCollapse:\s*'separate'/);
    /* Without this the cells would gain default spacing and the table would
       look like a spreadsheet from 1998. */
    expect(card).toMatch(/borderSpacing:\s*0/);
  });

  it('draws the row dividers on the cells, where separate paints them', () => {
    /* A `<tr>` border is ignored under `separate`. Keeping the rule on the row
       would compile, pass a type check, and leave the list with no lines. */
    expect(card).not.toMatch(/<tr[^>]*\n?\s*style=\{\{[^}]*borderBottom/);
    expect(card).toMatch(/const rowRule = open \? 'none'/);
  });

  it('keeps the schedule editor on screen while the table scrolls', () => {
    /*
     * The editor is a cell spanning all seven columns, so it is as wide as the
     * TABLE — 680px — not as wide as the phone showing about 350 of them. Its
     * questions started at the left edge and Save sat off the right, reachable
     * only by noticing the table scrolls sideways and going to look.
     *
     * `flex-wrap` does not fix it: the panel wraps inside its cell, and the
     * cell is the one that is too wide. It has to follow the VIEWPORT.
     */
    const editor = card.slice(card.indexOf('function ScheduleEditorRow'));

    expect(editor).toMatch(/position: 'sticky'/);
    expect(editor).toMatch(/insetInlineStart: 0/);
    /* Capped to the visible width, or sticky only moves the overflow around. */
    expect(editor).toMatch(/width: 'calc\(100vw/);
    /* And `max-width: 100%` so a desktop, where the cap is wider than the card,
       is left exactly as it was. */
    expect(editor).toMatch(/maxWidth: '100%'/);
  });

  it('keeps the table wider than a phone, so there is something to scroll', () => {
    /* Six genuine facts per agent. The answer to a narrow screen is scrolling,
       not dropping the column that says when it runs next. */
    expect(card).toMatch(/minWidth: '680px'/);
    expect(card).toMatch(/overflowX: 'auto'/);
  });
});

describe('both themes', () => {
  it('every token the card spends is defined in BOTH blocks', () => {
    /*
     * The failure this catches is invisible in light mode: a token defined only
     * on `:root` renders correctly until somebody switches to dark, where it
     * falls back to `inherit` or disappears. `--v2-danger` was exactly that —
     * referenced here, defined nowhere, with a fallback hex doing all the work.
     */
    const css = readFileSync(join(root, 'app', 'v2', 'globals-v2.css'), 'utf-8');

    const used = new Set(
      [...card.matchAll(/var\((--v2-[a-z0-9-]+)/g)].map(m => m[1])
    );

    /*
     * ───────────────────────────────────────────────────────────────────────
     * THE BRAND COLOUR IS NOT A THEME TOKEN, AND MUST NOT BE DEFINED TWICE.
     *
     * Every token above is a pair — `--v2-surface` is #FFFFFF on light and
     * #1E293B on dark — and a single definition is the bug this test exists
     * for. `--v2-primary` is the opposite: ONE value that holds in both
     * themes, because it is the owner's brand colour and a white-labelled
     * account overrides it. Indigo on light and something else on dark would
     * mean the business had two brands.
     *
     * The card started spending it when the schedule editor arrived: the Save
     * button and the editor's tint both take the accent, matching the
     * Needs-you buttons an owner meets on the same screen.
     * ───────────────────────────────────────────────────────────────────────
     */
    used.delete('--v2-primary');

    expect(used.size).toBeGreaterThan(4);

    for (const token of used) {
      const definitions = (css.match(new RegExp(`${token}\\s*:`, 'g')) ?? []).length;

      /* Twice: once for light, once for dark. */
      expect(`${token} defined ${definitions >= 2 ? '2+' : definitions}×`).toBe(
        `${token} defined 2+×`
      );
    }
  });

  it('does not fill a chip with the colour of the card behind it', () => {
    /* `--v2-surface` IS the card. A paused chip filled with it is an invisible
       chip on both themes, so the state reads as unlabelled rather than quiet. */
    const table = card.slice(card.indexOf('const STATE_COLOUR'), card.indexOf('const PINNED'));
    expect(table).not.toMatch(/paused:[^}]*bg: 'var\(--v2-surface\)'/);
  });

  it('uses only tokens that exist in each theme block', () => {
    /* A fixed hex looks right on one ground and wrong on the other. The status
       family exists so a state does not have to guess. */
    expect(card).not.toMatch(/#[0-9A-Fa-f]{6}/);
    expect(card).toContain('var(--v2-status-error-bg)');
    expect(card).toContain('var(--v2-status-error-text)');
    expect(card).toContain('var(--v2-status-error-border)');
  });
});

describe('removing asks in the platform dialog', () => {
  it('uses the shared Dialog rather than buttons inside the row', () => {
    /*
     * Inline confirmation reflowed the row as it appeared, and on a
     * horizontally scrolling table the confirm could land off the side — a
     * destructive control the owner has to go looking for.
     */
    expect(card).toContain("from '@/components/ui/dialog'");
    expect(card).toContain('<Dialog open={removing !== null}');
    expect(card).toContain('<DialogFooter');
  });

  it('names the agent it is asking about', () => {
    expect(card).toContain('automation.remove_title');
    expect(card).toContain('removingName');
  });

  it('says what stopping actually means', () => {
    /* The thing an owner wants to know before pressing: what it already sent
       stays sent. A cell had no room to say it. */
    expect(card).toContain('automation.remove_body');
  });

  it('mirrors for RTL', () => {
    expect(card).toContain("direction: isRTL ? 'rtl' : 'ltr'");
  });

  it('says all of it in every language', () => {
    for (const lang of ['en', 'he', 'es']) {
      const dict = readFileSync(
        join(root, 'lib', 'business-os', 'translations', `${lang}.ts`),
        'utf-8'
      );
      for (const key of [
        'automation.col_agent', 'automation.col_next', 'automation.col_stops',
        'automation.blocked', 'automation.next_paused', 'automation.next_blocked',
        'automation.remove_title', 'automation.remove_body',
      ]) {
        expect(`${lang}:${key}:${dict.includes(`'${key}'`)}`).toBe(`${lang}:${key}:true`);
      }
    }
  });
});
