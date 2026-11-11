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
 *   · the row is present whenever the channel exists, with `completed` taken
 *     from the live answer rather than deciding whether it renders at all;
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

/** The `readinessItems` memo, where the row is assembled. */
const memo = DASHBOARD.slice(
  DASHBOARD.indexOf('const readinessItems = useMemo('),
  DASHBOARD.indexOf('}, [setupItems, inboxChannel, setupShape, t]);')
);

describe('the row', () => {
  it('is built whenever a channel exists, not only while replies are off', () => {
    expect(memo).toContain('if (inboxChannel.channels.length > 0) {');
    /* The old gate. Its return is what made the step vanish. */
    expect(memo).not.toContain('if (inboxChannel.channels.length > 0 && repliesOff) {');
  });

  it('reports completion from the live answer', () => {
    expect(memo).toContain('completed: !repliesOff,');
  });

  it('offers the fix action only while there is something to fix', () => {
    expect(memo).toContain("action: repliesOff ? 'enable_lead_replies' : undefined,");
  });

  it('stays required either way, so it keeps its place in the list', () => {
    expect(memo).toContain('required: true,');
  });
});

describe('the copy', () => {
  it('says its own state rather than wearing a tick next to a problem', () => {
    expect(memo).toContain("leads.inbox.readiness.replies_off_title");
    expect(memo).toContain("leads.inbox.readiness.replies_on_title");
    expect(memo).toContain("leads.inbox.readiness.replies_off_desc");
    expect(memo).toContain("leads.inbox.readiness.replies_on_desc");
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
