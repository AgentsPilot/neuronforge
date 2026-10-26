/**
 * The conversation scrolls; the page does not.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Reported as "when selecting the chips or typing the chat jumps all over and
 * back". Three causes, and each is easy to reintroduce because each looks
 * correct in isolation:
 *
 *  1. `scrollIntoView` CANNOT be scoped. It walks up and scrolls every
 *     scrollable ancestor until the target is in view, and this page's root is
 *     `min-h-screen`, so the window was one of them. Every new message moved
 *     the whole page.
 *
 *  2. `focus()` scrolls its element into view INSTANTLY, and it ran on the same
 *     tick as a `behavior: 'smooth'` scroll. So each turn started an animation
 *     and then yanked it: the jump out, and the jump back.
 *
 *  3. `height: calc(100vh - …)`. On mobile `100vh` is the viewport with the
 *     browser chrome HIDDEN, so the column was taller than the visible area and
 *     the page scrolled regardless of the two above.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const page = fs.readFileSync(
  path.join(process.cwd(), 'app/onboarding-chat/page.tsx'),
  'utf8'
);

/** The file necessarily names what it forbids, in comments. */
const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the scroll is scoped to the message list', () => {
  it('scrolls the list element itself, not an ancestor chain', () => {
    expect(code).toMatch(/const list = messagesScrollRef\.current;/);
    expect(code).toMatch(/list\.scrollTo\(\{\s*top: list\.scrollHeight/);
  });

  it('never calls scrollIntoView, which cannot leave the window alone', () => {
    expect(code).not.toMatch(/scrollIntoView/);
  });

  it('carries the ref on the scrolling container', () => {
    expect(page).toMatch(/ref=\{messagesScrollRef\} className="flex-1 overflow-y-auto/);
  });

  it('lands at the bottom on first paint instead of animating to it', () => {
    expect(code).toMatch(/hasScrolledOnce\.current \? 'smooth' : 'auto'/);
  });
});

describe('focus does not fight the scroll', () => {
  it('focuses without scrolling', () => {
    // An instant focus scroll on the same tick as a smooth scroll IS the
    // "jumps back" half of the report.
    expect(code).toMatch(/inputRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  });
});

/**
 * A FOURTH CAUSE, and the one that replaced the measurements below.
 *
 * Reported as "the scroller gets doubled when the AI thinks, it jumps all
 * over, and I need to scroll for any new question". The header was frozen by
 * giving the page a `100dvh` flex column with the body as `overflow-y-auto` —
 * which left the chat screen with TWO nested scrollers, the body and the
 * message list inside the card.
 *
 * The third symptom is the one that gives it away. The effect above calls
 * `scrollTo` on the MESSAGE LIST, and that does nothing unless the list is the
 * element that actually overflows. Once the overflow had moved out to the
 * body, `scrollHeight === clientHeight` on the list, the call was a no-op, and
 * every new question had to be scrolled to by hand.
 *
 * So the body is a SIZED REGION (`flex-1 min-h-0`) and not a scroller, and
 * each screen scrolls inside it. The two tests this replaces pinned the old
 * mechanism — `height: calc(100dvh - 150px)` and a `minHeight` floor — and
 * both are now gone, because a fixed height and a floor are exactly how
 * overflow escapes to an ancestor. The page can no longer scroll at all, which
 * is a stronger guarantee than any measurement.
 *
 * One of those two tests, note, passed after the code it pinned was deleted:
 * it searched `page` rather than `code`, and found the string in the comment
 * recording the removal. A guard that reads comments guards nothing.
 */
describe('the column fits the visible viewport', () => {
  it('measures in dvh, never vh', () => {
    expect(code).not.toMatch(/100vh/);
  });

  it('gives the page a fixed height it cannot scroll past', () => {
    expect(code).toMatch(/h-\[100dvh\][^"]*overflow-hidden|overflow-hidden[^"]*h-\[100dvh\]/);
  });

  it('sizes the conversation by flex rather than by measuring the chrome', () => {
    /*
     * No `calc` against the viewport, and no floor. Both put a height on the
     * column that the space below the header may not have, and the overflow
     * then escapes upward and becomes a second scrollbar.
     */
    expect(code).not.toMatch(/calc\(100dvh - \d+px\)/);
    expect(code).not.toMatch(/minHeight: '\d+px'/);
    expect(code).toMatch(/'flex flex-1 min-h-0 flex-col gap-4'/);
  });
});

describe('exactly one thing scrolls on the chat screen', () => {
  /**
   * Scrollers outside the fixed-position dialogs.
   *
   * A modal is its own world: it is `fixed`, it is one at a time, and the chat
   * is not scrollable behind it. What must not happen is two live scrollers in
   * the page flow, which is what produced the doubled scrollbar.
   */
  const bodyScrollers = () => {
    /*
     * Split on `fixed inset-0`, which is what every dialog on this page opens
     * with. Splitting on `planEditor` was the first attempt and undercounted:
     * the pipeline editor is a dialog too and is keyed on its own state, so a
     * scroller inside it was being counted as part of the page flow.
     */
    const inFlow = code.split(/fixed inset-0/)[0];
    return (inFlow.match(/overflow-y-auto/g) || []).length;
  };

  it('has one scroller for the conversation and one for the plan, never a third', () => {
    /*
     * Two, because the two screens are mutually exclusive: the conversation's
     * message list, and the page scroll the plan uses. Only ever one of them
     * is live. A third means something in the flow above them scrolls too.
     */
    expect(bodyScrollers()).toBe(2);
  });

  it('scrolls the page for the plan and nothing for the conversation', () => {
    /*
     * THE INVARIANT, NOT THE MARKUP. This pinned the wrapper's exact class
     * string and broke the moment the rule became conditional — which it had
     * to, because the two screens want opposite things:
     *
     *   plan          the WRAPPER scrolls, so the bar sits at the window edge.
     *                 Giving the plan block its own scroller put the bar at
     *                 the edge of the centred column, floating beside the
     *                 cards in the middle of the screen.
     *   conversation  nothing in the flow scrolls, so the message list is the
     *                 only scroller and `scrollTo` on it still does something.
     *
     * What must stay true is that the wrapper's overflow is decided BY THE
     * SCREEN, and that the conversation's half of it is `overflow-hidden`.
     */
    expect(code).toMatch(
      /showPlanScreen \? 'overflow-y-auto' : 'overflow-hidden'/
    );
  });

  it('leaves the side of the scrollbar to the direction, not to a class', () => {
    /*
     * Reported alongside it: the bar should sit left or right depending on
     * RTL. It does, because the root carries `dir` and the browser places the
     * bar from that. A hand-rolled `isRTL &&` on the scroller would be the
     * thing that eventually disagrees with the document.
     */
    expect(code).toMatch(/dir=\{isRTL \? 'rtl' : 'ltr'\}/);
    expect(code).not.toMatch(/direction:\s*isRTL/);
  });

  it('lets the list be the overflow container by allowing it to shrink', () => {
    /*
     * `min-h-0` is what makes this work. Without it a flex item will not
     * shrink below its content, the column grows instead, and the overflow
     * lands on whichever ancestor can take it.
     */
    expect(code).toMatch(/shadow-lg flex-1 min-h-0/);
    expect(code).toMatch(/ref=\{messagesScrollRef\} className="flex-1 overflow-y-auto/);
  });
});
