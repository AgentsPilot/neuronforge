/**
 * Reading a quote back shows the expiry it was sent with.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * Opening an accepted or declined quote showed an EMPTY expiry, for a quote
 * that certainly had one — the field is mandatory to send.
 *
 * Two causes, and the second is the interesting one:
 *
 *   1. The drawer passes a whole `DrawerProposal` as `basedOn`, and that object
 *      has carried `valid_until` all along. The prop's type never declared it,
 *      so TypeScript discarded it at the boundary. Nothing errored; the field
 *      simply had nothing to read.
 *
 *   2. The hydrating effect deliberately BLANKS the expiry, and that is correct
 *      for the case it was written for. This one dialog is both the builder and
 *      the viewer, and the two want opposite things:
 *
 *        reading back   show what the quote said. The date is part of what the
 *                       client agreed to, and an empty field claims there was
 *                       none.
 *
 *        revising       leave it blank. By the time anyone is revising, the old
 *                       date is in the past, and inheriting it silently sends a
 *                       quote that expired before it arrived.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND THE TRAP IN FIXING IT
 *
 * Pressing "revise" does not remount the dialog: the parent flips `readOnly`
 * and nothing else. So `readOnly` must be a dependency of the effect, or the
 * expiry just read back off an accepted quote stays in the field and is sent as
 * the new one — reintroducing the exact bug the blank existed to prevent, by
 * way of its own fix.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

const modal = read('components/crm/contact-drawer/ProposalBuilderModal.tsx');
const drawer = read('components/crm/contact-drawer/CRMContactDrawerV2.tsx');

/** Comments quote the old behaviour; assertions about code must not read them. */
const code = modal.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the date survives the prop boundary', () => {
  it('basedOn declares it', () => {
    expect(code).toMatch(/valid_until\?: string \| null;/);
  });

  it('the drawer already had it to give', () => {
    /* `DrawerProposal` has carried it all along, which is why nothing had to
       change on the sending side. */
    expect(drawer).toMatch(/valid_until: string \| null;/);
  });
});

describe('the two modes want opposite things', () => {
  it('fills the field when reading back, and blanks it when revising', () => {
    expect(code).toMatch(
      /setValidUntil\(readOnly \? basedOn\.valid_until\?\.slice\(0, 10\) \?\? '' : ''\)/
    );
  });

  it('takes the date part only', () => {
    /* The column is a timestamp and the input is `type="date"`, which renders
       nothing at all for a value it cannot parse. */
    expect(code).toMatch(/\.slice\(0, 10\)/);
  });

  it('still refuses to carry an expiry into a revision', () => {
    /* The original rule, and it was right. A quote that expired before it
       arrived is worse than one with a date the owner had to retype. */
    expect(code).not.toMatch(/setValidUntil\(basedOn\.valid_until/);
  });
});

describe('leaving read-only re-runs the hydration', () => {
  it('lists readOnly as a dependency', () => {
    /*
     * The fix's own trap. The parent flips this one prop and keeps the dialog
     * mounted, so without it the stale expiry is carried into the revision and
     * sent.
     */
    expect(code).toMatch(/\}, \[isOpen, defaultTitle, contactId, supersedesId, readOnly\]\);/);
  });

  it('and the parent really does flip it in place', () => {
    /* If the parent ever remounts instead, the dependency is harmless; if it
       keeps flipping, the dependency is load-bearing. */
    /*
     * THE PARENT REMOUNTS RATHER THAN FLIPPING, which this test already
     * allowed for: "if the parent ever remounts instead, the dependency is
     * harmless". It now does exactly that — `onOpenProposalBuilder` sets a
     * fresh object to edit, and `onViewProposal` sets a separate one with
     * `readOnly: true` — so there is no in-place flip left to pin.
     *
     * What still has to hold is that the two entries are DISTINCT, or
     * viewing a sent quote would reopen the editor on it. The effect
     * dependency above stays pinned either way.
     */
    expect(drawer).toMatch(/setProposalBuilder\(\{ bookingId, \.\.\.context \}\)/);
    expect(drawer).toMatch(/readOnly: true,/);
  });
});

/**
 * And the blank that ran afterwards and undid it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The hydration above was correct and the field was still empty, because a
 * SECOND write sat below the `if/else` and ran unconditionally:
 *
 *     if (basedOn) { setValidUntil(readOnly ? … : ''); } else { … }
 *     setValidUntil('');          // ← always, two lines later
 *
 * Source order decided it and the later one always won. Every assertion in the
 * block above passed the whole time: they read the branch that was right, not
 * the line that overruled it.
 *
 * The lesson for this guard is that pinning the correct write is not enough —
 * what has to hold is that nothing else writes the same state unconditionally
 * in the same effect.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('nothing overwrites it afterwards', () => {
  const modalCode = read('components/crm/contact-drawer/ProposalBuilderModal.tsx')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('the reset is scoped to the cases that want a blank', () => {
    expect(modalCode).toMatch(/if \(!readOnly\) setValidUntil\(''\);/);
  });

  it('no unconditional blank survives in the effect', () => {
    /*
     * The exact line that undid the fix: `setValidUntil('')` with nothing
     * guarding it, at the effect's own indent level.
     */
    expect(modalCode).not.toMatch(/^\s{4}setValidUntil\(''\);/m);
  });

  it('every write to it is either guarded or inside a branch', () => {
    /*
     * Counted rather than described, so a third write added later has to be
     * looked at rather than silently joining the race.
     */
    const writes = modalCode.match(/setValidUntil\(/g) ?? [];

    /* The hydration, the guarded reset, and the input's onChange. The
       `useState` destructure is not a call and does not appear. */
    expect(writes).toHaveLength(3);
  });
});

/**
 * A failed send leaves ONE draft, however many times it is retried.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Sending is two calls on purpose — the quote is written as a draft before
 * anything is emailed, so a transport failure leaves something to retry rather
 * than a lost hour of typing. The modal says so and leaves the button live.
 *
 * It did not remember WHICH draft. Pressing send again started from the top,
 * so each attempt wrote another proposal: three tries at a flaky moment left
 * three orphans, and `quote_unsent` would raise three rows about one quote.
 *
 * There is no save-as-draft anywhere in the product — the modal offers send
 * and cancel — so every draft that exists at all got there this way.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('retrying a failed quote send', () => {
  /* `fs`/`path`, matching what this file already imports. */
  const modal = fs.readFileSync(
    path.join(process.cwd(), 'components', 'crm', 'contact-drawer', 'ProposalBuilderModal.tsx'),
    'utf-8'
  );

  it('remembers the draft it already wrote', () => {
    expect(modal).toMatch(/const \[draftId, setDraftId\]/);
    /* Stamped before the send is attempted: the draft exists from that moment
       and a retry has to resume at the send. */
    expect(modal).toMatch(/setDraftId\(proposalId\)/);
  });

  it('skips the create when one is already held', () => {
    expect(modal).toMatch(/const createRes = draftId\s*\n?\s*\? null/);
    expect(modal).toMatch(/proposals\/\$\{proposalId\}\/send/);
  });

  it('and throws it away the moment the content changes', () => {
    /*
     * The server sends the STORED row, not what is on screen. Without this, an
     * owner who hit a failure, fixed the price and pressed send again would
     * have mailed the old price from a form showing the new one.
     */
    expect(modal).toMatch(/setDraftId\(null\);/);
    for (const field of ['title', 'description', 'totalNumber', 'validUntil', 'termsDays']) {
      expect(`${field}:${modal.includes(field)}`).toBe(`${field}:true`);
    }
  });
});

