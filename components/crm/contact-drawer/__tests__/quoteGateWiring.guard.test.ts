/**
 * The quote step must ask, not assume — and a no-show must not close the job.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The rules themselves are tested in `lib/business-os/__tests__/quoteGate.test.ts`.
 * What this guards is the WIRING, which is where both defects lived:
 *
 *   · the drawer derived "your move" from the clock with a boolean, so a
 *     consultation nobody attended produced a step naming a price the owner may
 *     not have been owed;
 *   · `no_show` was folded into `isCancelled`, so a missed meeting closed the
 *     job and took the quote button with it — contradicting the comment forty
 *     lines below, which said only cancelling ends a job.
 *
 * A source-level guard because these two components need a contact, a booking,
 * a proposal and a journey to say anything at all, and what went wrong was one
 * word in a condition — exactly what a reader can check.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const drawer = readFileSync(
  join(process.cwd(), 'components', 'crm', 'contact-drawer', 'CRMContactDrawerV2.tsx'),
  'utf8'
);

const tab = readFileSync(
  join(process.cwd(), 'components', 'crm', 'contact-drawer', 'BookingsTab.tsx'),
  'utf8'
);

describe('the drawer asks the gate', () => {
  it('builds the quote step from quoteGate, not from a boolean on the clock', () => {
    expect(drawer).toContain("from '@/lib/business-os/quoteGate'");
    expect(drawer).toContain('const gate = quoteGate({');
  });

  it('takes `waitingOn` from the same state as the step status', () => {
    // The label and the "Send a quote" button both read `waitingOn`, so a second
    // derivation is how they came to describe different situations.
    expect(drawer).toContain('waitingOn: quoteWaitingOn(gate');
  });

  it('never closes the job on isCancelled again', () => {
    // `isCancelled` includes `no_show` and is read by the payment and intake
    // steps, where it means "the job is off". The quote step must not use it.
    expect(drawer).not.toContain('const jobClosed = isCancelled');
    expect(drawer).toContain("const jobClosed = gate === 'closed'");
  });
});

describe('the strip renders the two new states', () => {
  it('asks when the meeting is unmarked', () => {
    expect(tab).toContain("waitingOn === 'unmarked'");
    expect(tab).toContain('crm.proposal.ask_happened');
  });

  it('says a missed meeting was missed, and offers a new time', () => {
    expect(tab).toContain("waitingOn === 'noshow'");
    expect(tab).toContain('crm.proposal.after_missed');
    expect(tab).toContain('crm.proposal.book_new_meeting');
  });

  it('keeps Send a quote reachable in both of them', () => {
    // The point of the gate: it asks instead of taking the action away.
    const button = tab.slice(tab.indexOf('onOpenProposalBuilder\n'));
    expect(tab).toMatch(/waitingOn === 'owner'\s*\n\s*\|\| step\.metadata\?\.waitingOn === 'unmarked'/);
    expect(button.length).toBeGreaterThan(0);
  });

  it('gives the badge three states rather than ahead-or-not', () => {
    expect(tab).toContain("meetingState: 'ahead' | 'unmarked' | 'settled'");
    expect(tab).toContain('crm.booking.quoted.not_marked');
    expect(tab).toContain('crm.booking.quoted.meeting_missed');
  });
});
