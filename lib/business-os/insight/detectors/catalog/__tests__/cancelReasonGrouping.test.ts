/**
 * How the cancellation detectors group their reason breakdown.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 *
 * `RetCancellationSpikeDetector` and `OpsLastMinuteCancelsDetector` both built
 * their breakdown by using the free-text `cancellation_reason` AS THE KEY:
 *
 *     const reason = b.cancellation_reason || 'No reason provided';
 *     acc[reason] = (acc[reason] || 0) + 1;
 *
 * So the grouping key was the whole sentence. "Client is ill", "client ill",
 * "ill" and "sick" were four reasons in the report and one reason in life.
 *
 * And it got worse the moment the cancel surfaces became structured. A client who
 * picks a reason and types nothing leaves `cancellation_reason` holding just the
 * bare `CLIENT_CANCELLED_PREFIX` — so every client cancellation collapsed into
 * one bucket reading "Cancelled by client", which says nothing at all, while the
 * real answer sat unread in `cancel_reason`.
 *
 * WHAT THESE TESTS PIN
 *
 * The grouping RULE, not the detectors' thresholds or queries — those have their
 * own tests and need a full Supabase harness. The rule is three lines and every
 * one of them is a decision:
 *
 *   1. prefer the code                  countable
 *   2. fold equivalent spellings        `too_expensive` and `client_cost` are one
 *                                       reason, split across a rename that could
 *                                       not happen because rows already existed
 *   3. fall back to the prose           rows cancelled before the code existed
 *                                       still say something; dropping it erases
 *                                       what they say
 *
 * The rule now lives in ONE place — `cancelReasonBucket` — and both detectors
 * call it. These tests exercise that function directly, so a change to it shows
 * up here rather than silently in a cron nobody is watching. Both spellings of
 * the fallback label ('No reason provided' / 'No reason') are covered, because
 * the two detectors word it differently.
 */
import { canonicalReason, cancelReasonBucket } from '@/lib/business-os/cancellationReasons';

/*
 * The REAL function both detectors call, not a copy of it.
 *
 * An earlier version of this file reimplemented the three-line rule here. That
 * test could pass while the detectors drifted away from it — which is exactly the
 * failure it was meant to prevent. Only the reduce is local, because that part is
 * a loop and not a decision.
 */
const group = (
  rows: Array<{ cancel_reason?: string | null; cancellation_reason?: string | null }>,
  fallbackLabel: string
) =>
  rows.reduce((acc, b) => {
    const reason = cancelReasonBucket(b, fallbackLabel);
    acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

describe('the code wins over the prose', () => {
  it('groups by code, so one reason is one bucket', () => {
    const counts = group(
      [
        { cancel_reason: 'client_unwell', cancellation_reason: 'Cancelled by client: I am ill' },
        { cancel_reason: 'client_unwell', cancellation_reason: 'Cancelled by client: sick' },
        { cancel_reason: 'client_unwell', cancellation_reason: 'Cancelled by client' },
      ],
      'No reason provided'
    );

    // One bucket of 3. Grouping on the prose gave three buckets of 1.
    expect(counts).toEqual({ client_unwell: 3 });
  });

  it('no longer collapses every client cancellation into one meaningless bucket', () => {
    /*
     * The regression the structured picker would have caused on its own: three
     * clients each picked a different reason and typed nothing, so all three
     * carry the identical bare prefix.
     */
    const rows = [
      { cancel_reason: 'client_unwell', cancellation_reason: 'Cancelled by client' },
      { cancel_reason: 'client_cost', cancellation_reason: 'Cancelled by client' },
      { cancel_reason: 'client_rescheduling', cancellation_reason: 'Cancelled by client' },
    ];

    expect(group(rows, 'No reason provided')).toEqual({
      client_unwell: 1,
      client_cost: 1,
      client_rescheduling: 1,
    });

    // What the old rule produced from the same rows: one bucket, no information.
    const oldRule = rows.reduce((acc, b) => {
      const reason = b.cancellation_reason || 'No reason provided';
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    expect(oldRule).toEqual({ 'Cancelled by client': 3 });
  });
});

describe('equivalent spellings are folded', () => {
  it('counts too_expensive and client_cost as one reason', () => {
    /*
     * `too_expensive` is the live decline code and could not be renamed — rows
     * carry it, and a rename splits one stored reason into two. So the map folds
     * them on the way OUT instead.
     */
    expect(group([{ cancel_reason: 'too_expensive' }, { cancel_reason: 'client_cost' }], 'x')).toEqual(
      { client_cost: 2 }
    );
  });

  it('counts scope and scope_changed as one reason', () => {
    expect(group([{ cancel_reason: 'scope' }, { cancel_reason: 'scope_changed' }], 'x')).toEqual({
      scope_changed: 2,
    });
  });

  it('leaves a code with no equivalent exactly as stored', () => {
    // Folding must not rewrite codes that mean only themselves.
    expect(canonicalReason('client_no_show')).toBe('client_no_show');
    expect(canonicalReason('chose_other')).toBe('chose_other');
  });
});

describe('the prose is still the fallback', () => {
  it('uses the sentence for a row cancelled before the code existed', () => {
    // Dropping the fallback would erase what historical rows do say.
    expect(group([{ cancel_reason: null, cancellation_reason: 'client moved abroad' }], 'x')).toEqual({
      'client moved abroad': 1,
    });
  });

  it('falls back to the label when there is neither', () => {
    // Each detector spells this differently; both must reach it.
    expect(group([{}], 'No reason provided')).toEqual({ 'No reason provided': 1 });
    expect(group([{}], 'No reason')).toEqual({ 'No reason': 1 });
  });

  it('keeps coded and uncoded rows apart rather than merging them', () => {
    /*
     * A mixed period during the changeover. The coded rows group properly and the
     * old prose stays its own bucket — honest about the fact that those rows
     * cannot be grouped, instead of silently folding them into a code somebody
     * never chose.
     */
    expect(
      group(
        [
          { cancel_reason: 'client_unwell' },
          { cancel_reason: 'client_unwell' },
          { cancel_reason: null, cancellation_reason: 'Cancelled by client: ill' },
        ],
        'No reason'
      )
    ).toEqual({ client_unwell: 2, 'Cancelled by client: ill': 1 });
  });
});
