/**
 * A plan we have since corrected must reach the agents already running it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `refreshPlan` existed, was correct, and ran on the INSTALL path only. An
 * owner installs an automation once and never again, so an agent installed in
 * September kept its September plan for ever — and the only way to pick up a
 * fix was to re-install, which nothing in the product suggests doing.
 *
 * Its own comment names the cost: "the first version of the invoice chaser
 * would have emailed the same client every morning; an install made before
 * that fix would still be doing it."
 *
 * Found on 2026-11-10. The reply-drafting agent checks the drafts folder so it
 * does not write the same answer twice, and the check had no date bound — so a
 * draft written in September silenced a live reschedule request in November.
 * Correcting the catalogue would not have reached one running install.
 *
 * The repair rides the list read, which is the only thing that runs when an
 * owner is looking at their agents, and is where this file already repairs a
 * mispointed mailbox for exactly the same reason.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const INSTALL = strip(read('lib/business-os/automations/install.ts'));

describe('the plan is brought up to date where an owner will actually be', () => {
  it('refreshPlan runs on the list read, not only on install', () => {
    /* Two call sites: the install path, and the read every dashboard load
       performs. One of them is reached in normal use. */
    expect(INSTALL.match(/await refreshPlan\(/g) ?? []).toHaveLength(2);
  });

  it('and it is cheap when nothing has changed', () => {
    /* A fingerprint compare that returns before any query — otherwise this is
       a write on every row of every dashboard load. */
    expect(INSTALL).toMatch(/installed\.planVersion === current\s*\)?\s*return/);
  });

  it('touching only the steps, never the owner\'s own choices', () => {
    /* Bounded to THIS function: the next top-level declaration ends it. A
       fixed character window swept in neighbouring code and tested the wrong
       thing — the same trap this file's siblings record. */
    const from = INSTALL.indexOf('async function refreshPlan(');
    const rest = INSTALL.slice(from + 1);
    const next = rest.search(/\n(?:export )?(?:async )?function /);
    const body = rest.slice(0, next === -1 ? undefined : next);
    expect(body).toMatch(/updatePilotSteps\(/);
    for (const owned of ['schedule_cron', 'stop_after_days', 'status', 'schedule_enabled']) {
      expect(body).not.toContain(owned);
    }
  });
});

describe('the drafts check is bounded in time', () => {
  const gmail = read('lib/business-os/automations/agents/draftClientReplies.steps.json');
  const outlook = read('lib/business-os/automations/agents/draftClientRepliesOutlook.steps.json');

  it('gmail looks only at recent drafts', () => {
    /*
     * Unbounded, this means "never write to this person again while anything
     * of ours sits in drafts". A September draft blocked a November reply on a
     * live account. The window matches the Outlook sibling's stated intent:
     * two days, so a run that failed loses nothing.
     */
    expect(gmail).toContain('to:{{current_reply.from_email}} newer_than:2d');
  });

  it('outlook does too, through the parameter its plugin actually has', () => {
    expect(outlook).toMatch(/"within_days":\s*2/);
  });

  it('but the SENT search stays unbounded', () => {
    /* That one answers "what was the last thing we ever said to them", which
       has no business being limited to two days. */
    expect(gmail).toMatch(/"query":\s*"to:\{\{current_reply\.from_email\}\}"[\s\S]{0,200}"folder":\s*"sent"/);
  });
});
