/**
 * Two cards about the same thing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The case this was built from, taken from a live account:
 *
 *   2026-09-29  conv_no_next_step    named contact 96b4cd
 *   2026-09-30  conv_pipeline_stuck  named contact 96b4cd
 *
 * One person, one problem, two cards a day apart. The tests below are mostly
 * about what must NOT be suppressed, because an over-eager deduper loses real
 * findings silently and nobody notices a card that never appeared.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  dedupeOverlapping,
  OVERLAP_GROUPS,
  DELIBERATELY_SEPARATE,
} from '../overlappingInsights';

const card = (detector_id: string, ids: string[] = []) => ({
  detector_id,
  affected_entity_ids: ids,
});

describe('two detectors naming one contact', () => {
  it('keeps the more specific card', () => {
    const { kept, suppressed } = dedupeOverlapping([
      card('conv_pipeline_stuck', ['96b4cd']),
      card('conv_no_next_step', ['96b4cd']),
    ]);

    expect(kept.map(k => k.detector_id)).toEqual(['conv_pipeline_stuck']);
    expect(suppressed[0]).toMatchObject({
      detectorId: 'conv_no_next_step',
      coveredBy: 'conv_pipeline_stuck',
      entityId: '96b4cd',
    });
  });

  it('decides the same way whichever order they arrive in', () => {
    /*
     * The point of ranking inside the group. Otherwise whichever detector
     * scored higher that morning would win, and the same two cards would
     * resolve differently from one day to the next for no visible reason.
     */
    const { kept } = dedupeOverlapping([
      card('conv_no_next_step', ['96b4cd']),
      card('conv_pipeline_stuck', ['96b4cd']),
    ]);

    expect(kept.map(k => k.detector_id)).toEqual(['conv_pipeline_stuck']);
  });

  it('preserves the order the dashboard asked for', () => {
    /*
     * Precedence decides WHAT survives, never what order it is shown in.
     * Re-sorting would hand the dashboard a list ranked by this module's
     * opinion of specificity instead of by priority.
     */
    const { kept } = dedupeOverlapping([
      card('cash_ar_overdue', ['inv1']),
      card('conv_no_next_step', ['96b4cd']),
      card('web_link_dead_destination', ['page1']),
      card('conv_pipeline_stuck', ['96b4cd']),
    ]);

    expect(kept.map(k => k.detector_id)).toEqual([
      'cash_ar_overdue',
      'web_link_dead_destination',
      'conv_pipeline_stuck',
    ]);
  });
});

describe('what it must not suppress', () => {
  it('leaves both standing when they name different people', () => {
    const { kept, suppressed } = dedupeOverlapping([
      card('conv_pipeline_stuck', ['alice']),
      card('conv_no_next_step', ['bob']),
    ]);

    expect(kept).toHaveLength(2);
    expect(suppressed).toEqual([]);
  });

  it('keeps the lower card for the people the higher one did not name', () => {
    /*
     * Partial overlap is the common case: three contacts have no next step and
     * one of them is also stuck. Dropping the whole card would lose two real
     * findings to silence one.
     *
     * The card survives whole — this module decides which CARDS show, and
     * rewriting their contents is not its business.
     */
    const { kept, suppressed } = dedupeOverlapping([
      card('conv_pipeline_stuck', ['alice']),
      card('conv_no_next_step', ['alice', 'bob', 'carol']),
    ]);

    expect(kept).toHaveLength(2);
    expect(suppressed).toEqual([]);
  });

  it('suppresses only once every name on it is covered', () => {
    // The other side of the same rule: nothing new left to say.
    const { kept } = dedupeOverlapping([
      card('conv_pipeline_stuck', ['alice', 'bob']),
      card('conv_no_next_step', ['alice', 'bob']),
    ]);

    expect(kept.map(k => k.detector_id)).toEqual(['conv_pipeline_stuck']);
  });

  it('leaves detectors from different groups alone', () => {
    /*
     * Money owed and a stalled pipeline are different problems that happen to
     * share a person. Suppressing one would hide a debt because somebody is
     * also slow to reply.
     */
    const { kept } = dedupeOverlapping([
      card('cash_ar_overdue', ['8742fc']),
      card('conv_pipeline_stuck', ['8742fc']),
    ]);

    expect(kept).toHaveLength(2);
  });

  it('never touches a card about the business rather than a person', () => {
    // `ops_utilization_low` names nobody. It cannot duplicate anything.
    const { kept } = dedupeOverlapping([
      card('conv_pipeline_stuck', ['96b4cd']),
      card('ops_utilization_low', []),
      card('conv_no_next_step', ['96b4cd']),
    ]);

    expect(kept.map(k => k.detector_id)).toEqual(['conv_pipeline_stuck', 'ops_utilization_low']);
  });

  it('leaves a detector in no group entirely alone', () => {
    const { kept, suppressed } = dedupeOverlapping([
      card('cash_refund_pattern', ['t1']),
      card('ops_service_performance', ['t1']),
    ]);

    expect(kept).toHaveLength(2);
    expect(suppressed).toEqual([]);
  });

  it('keeps every card about cancellations, which are not duplicates', () => {
    /*
     * Three angles with three different answers: money still held (refund or
     * keep it), a recurring cause (change something), last-minute notice (a
     * policy question). Declared in DELIBERATELY_SEPARATE for this reason.
     */
    const { kept } = dedupeOverlapping([
      card('cash_cancelled_unrefunded', ['bk1']),
      card('ret_cancel_pattern', ['bk1']),
      card('ops_last_minute_cancels', ['bk1']),
    ]);

    expect(kept).toHaveLength(3);
  });
});

describe('the three-way at-risk group', () => {
  it('lets the most concrete reason win', () => {
    const { kept } = dedupeOverlapping([
      card('crm_engagement_decay', ['8742fc']),
      card('ret_reschedule_churn', ['8742fc']),
      card('ret_package_ending', ['8742fc']),
    ]);

    expect(kept.map(k => k.detector_id)).toEqual(['ret_package_ending']);
  });

  it('falls through to the next one down when the first is absent', () => {
    const { kept } = dedupeOverlapping([
      card('crm_engagement_decay', ['8742fc']),
      card('ret_reschedule_churn', ['8742fc']),
    ]);

    expect(kept.map(k => k.detector_id)).toEqual(['ret_reschedule_churn']);
  });
});

describe('the declarations themselves', () => {
  it('never puts one detector in two groups', () => {
    // It would make precedence depend on which group was scanned first.
    const seen = new Set<string>();
    for (const group of OVERLAP_GROUPS) {
      for (const id of group) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
  });

  it('never calls a pair both overlapping and deliberately separate', () => {
    const suppressedPairs = new Set<string>();
    for (const group of OVERLAP_GROUPS) {
      for (const a of group) for (const b of group) if (a !== b) suppressedPairs.add([a, b].sort().join('|'));
    }

    for (const group of DELIBERATELY_SEPARATE) {
      for (const a of group) {
        for (const b of group) {
          if (a === b) continue;
          expect(suppressedPairs.has([a, b].sort().join('|'))).toBe(false);
        }
      }
    }
  });

  it('gives every group at least two detectors', () => {
    // A group of one suppresses nothing and is a leftover from an edit.
    for (const group of [...OVERLAP_GROUPS, ...DELIBERATELY_SEPARATE]) {
      expect(group.length).toBeGreaterThan(1);
    }
  });
});
