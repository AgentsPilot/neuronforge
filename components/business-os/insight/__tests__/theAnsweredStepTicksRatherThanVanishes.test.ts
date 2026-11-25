/**
 * The website-replies step ticks. It does not disappear.
 *
 * Reported 2026-11-10 by the owner: the readiness row "website leads are not
 * being answered" was there, the switch was turned on, and the row was simply
 * gone on the next load. Every other readiness step stays and shows a tick, so
 * the one that vanishes reads as "did my click do anything?", and an owner
 * checking later finds no trace of a step they remember answering.
 *
 * Two rules are pinned:
 *
 *   · the row is present whenever an enquiry can REACH this business — a
 *     connected mailbox or a live page of ours — with `completed` taken from
 *     the live answer rather than deciding whether it renders at all. It was
 *     first written as "whenever the channel exists", which turned out to be
 *     the second way this row went missing: see the test below;
 *   · it says its own state. "Website leads are not being answered" beside a
 *     tick is a sentence arguing with its own icon, so the done case has copy
 *     of its own, in all three languages.
 *
 * Source-level: the row is built inside a `useMemo` in a 3,000-line dashboard
 * that needs insights, capabilities, a funnel and a dozen other props to
 * render. What matters is the branch, and that is readable where it is written.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const DASHBOARD = readFileSync(
  join(ROOT, 'components', 'business-os', 'insight', 'LiveDashboard.tsx'),
  'utf8'
);
const PAGE = readFileSync(join(ROOT, 'app', 'business-os', 'page.tsx'), 'utf8');

/**
 * The `readinessItems` memo, where the row is assembled.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BOUNDS ARE ASSERTED, NOT ASSUMED.
 *
 * The end marker is the memo's dependency array, and a dependency added to it
 * turns `indexOf` into -1 — which `slice` reads as "one character from the
 * end", so `memo` silently becomes the whole file and every `toContain` below
 * passes for the wrong reason. That happened: `ownedSurfaces` was added as a
 * dependency when the row stopped being mailbox-only.
 *
 * A test that cannot fail is worse than no test, so the markers are checked.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const MEMO_START = 'const readinessItems = useMemo(';
const MEMO_END = '}, [setupItems, inboxChannel, setupShape, ownedSurfaces, t]);';

/* A function, not a module-scope constant: the bounds check belongs inside a
   test, where a failure is reported as one. */
function readMemo(): string {
  const from = DASHBOARD.indexOf(MEMO_START);
  const to = DASHBOARD.indexOf(MEMO_END);

  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);

  return DASHBOARD.slice(from, to);
}

describe('the row', () => {
  it('is built whenever an enquiry can arrive, not only while replies are off', () => {
    expect(readMemo()).toContain('if (enquiriesCanArrive) {');
    /* The old gate. Its return is what made the step vanish. */
    expect(readMemo()).not.toContain('if (inboxChannel.channels.length > 0 && repliesOff) {');
  });

  it('counts a live page of ours, not only a connected mailbox', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE SECOND WAY THIS ROW WENT MISSING, and the one the title did not cover.
     *
     * It was gated on `inboxChannel.channels.length > 0` — a connected mailbox,
     * which is one of the two ways an enquiry reaches a business. The other is
     * a form on a page of ours, which is how most accounts receive one, and
     * those owners could not see the row at all: enquiries filed, alert sent,
     * `lead_autosend_enabled` false by default, nobody answered, nothing said.
     *
     * `livePages`, deliberately, and not `isReachable`: that flag counts an
     * active smart link, and a booking or payment link captures a booking
     * rather than an enquiry — which would put "your leads are not being
     * answered" in front of a business no lead can reach.
     * ─────────────────────────────────────────────────────────────────────────
     */
    expect(readMemo()).toMatch(/const livePages =[\s\S]*ownedSurfaces\?\.website/);
    expect(readMemo()).toMatch(/const livePages =[\s\S]*ownedSurfaces\?\.landing/);
    expect(readMemo()).toContain('inboxChannel.channels.length > 0 || livePages > 0');
    /* The flag that must NOT be the gate. */
    expect(readMemo()).not.toContain('enquiriesCanArrive = isReachable');
  });

  it('reports completion from the live answer', () => {
    expect(readMemo()).toContain('completed: !repliesOff,');
  });

  it('offers the fix action only while there is something to fix', () => {
    expect(readMemo()).toContain("action: repliesOff ? 'enable_lead_replies' : undefined,");
  });

  it('stays required either way, so it keeps its place in the list', () => {
    expect(readMemo()).toContain('required: true,');
  });
});

describe('the copy', () => {
  it('says its own state rather than wearing a tick next to a problem', () => {
    expect(readMemo()).toContain("leads.inbox.readiness.replies_off_title");
    expect(readMemo()).toContain("leads.inbox.readiness.replies_on_title");
    expect(readMemo()).toContain("leads.inbox.readiness.replies_off_desc");
    expect(readMemo()).toContain("leads.inbox.readiness.replies_on_desc");
  });

  it.each(['en', 'he', 'es'])('exists in %s', locale => {
    const dictionary = readFileSync(
      join(ROOT, 'lib', 'business-os', 'translations', `${locale}.ts`),
      'utf8'
    );
    expect(dictionary).toContain("'leads.inbox.readiness.replies_on_title':");
    expect(dictionary).toContain("'leads.inbox.readiness.replies_on_desc':");
  });
});

describe('the answer is asked for again', () => {
  it('re-reads the channel status when the route changes', () => {
    expect(PAGE).toContain("import { useRouter, usePathname } from 'next/navigation';");
    expect(PAGE).toContain('}, [refreshInboxChannel, pathname]);');
  });

  it('still reads it without a cache, so a re-ask is a real one', () => {
    expect(PAGE).toContain(
      "fetch('/api/business-os/leads/inbox/status', { cache: 'no-store' })"
    );
  });
});
