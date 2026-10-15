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

describe('the column fits the visible viewport', () => {
  it('measures in dvh, never vh', () => {
    expect(code).not.toMatch(/100vh/);
    expect(page).toMatch(/calc\(100dvh - 150px\)/);
  });

  it('keeps a floor low enough for a small phone', () => {
    /*
     * 560px plus the header exceeded the usable height of a small phone, which
     * forced the page to scroll from the other direction. The floor exists only
     * to stop the thread collapsing to nothing on a short window.
     */
    const floor = Number(/minHeight: '(\d+)px'/.exec(page)?.[1] ?? 0);
    expect(floor).toBeGreaterThan(0);
    expect(floor).toBeLessThanOrEqual(440);
  });
});
