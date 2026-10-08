/**
 * Three things wrong with one client is one story.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The hardcoded pattern layer has never matched anything: each of its ten
 * patterns names two specific detectors that must fire together, and on the
 * reporting account the three that fire appear in none of them. This groups on
 * what the findings are ABOUT instead, which nobody has to anticipate.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { groupBySharedSubject, subjectImpact } from '../sharedSubjects';

const finding = (
  detectorId: string,
  ids: string[],
  entityType = 'contact',
  estimatedImpactUsd?: number | null
) => ({ detectorId, affectedEntityType: entityType, affectedEntityIds: ids, estimatedImpactUsd });

const DAVID = 'c-david';
const SARAH = 'c-sarah';

describe('grouping by subject', () => {
  it('turns three findings about one client into one story', () => {
    const groups = groupBySharedSubject([
      finding('cash_ar_overdue', [DAVID, SARAH]),
      finding('ret_cancel_pattern', [DAVID]),
      finding('conv_pipeline_stuck', [DAVID]),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].entityId).toBe(DAVID);
    expect(groups[0].findings.map(f => f.detectorId)).toEqual([
      'cash_ar_overdue',
      'ret_cancel_pattern',
      'conv_pipeline_stuck',
    ]);
  });

  it('leaves a client with one finding alone', () => {
    // Sarah appears once. Calling that "a story about Sarah" would be dressing
    // a single fact in bigger clothes.
    const groups = groupBySharedSubject([
      finding('cash_ar_overdue', [DAVID, SARAH]),
      finding('ret_cancel_pattern', [DAVID]),
    ]);

    expect(groups.map(g => g.entityId)).toEqual([DAVID]);
  });

  it('ranks the client with most going wrong first', () => {
    const groups = groupBySharedSubject([
      finding('a', [DAVID, SARAH]),
      finding('b', [DAVID, SARAH]),
      finding('c', [DAVID]),
    ]);

    expect(groups.map(g => g.entityId)).toEqual([DAVID, SARAH]);
  });
});

describe('what it refuses to group', () => {
  it('ignores entity types that are not subjects', () => {
    /*
     * Two findings about one INVOICE are usually the same problem described
     * twice. Merging them would hide a duplicate rather than reveal a link.
     */
    const groups = groupBySharedSubject([
      finding('a', ['inv-1'], 'invoice'),
      finding('b', ['inv-1'], 'invoice'),
    ]);

    expect(groups).toEqual([]);
  });

  it('cannot be fooled by one detector naming a client twice', () => {
    // A detector repeating an id is a bug, and it must not be able to
    // manufacture a story on its own.
    const groups = groupBySharedSubject([finding('cash_ar_overdue', [DAVID, DAVID])]);

    expect(groups).toEqual([]);
  });

  it('ignores findings with no entity ids at all', () => {
    const groups = groupBySharedSubject([
      finding('a', []),
      finding('b', undefined as never),
    ]);

    expect(groups).toEqual([]);
  });
});

describe('what a story is worth', () => {
  it('sums only the findings that carry money', () => {
    const [group] = groupBySharedSubject([
      finding('a', [DAVID], 'contact', 300),
      finding('b', [DAVID], 'contact', 150),
      finding('c', [DAVID], 'contact', null),
    ]);

    expect(subjectImpact(group)).toBe(450);
  });

  it('returns null when nothing in the group carries money', () => {
    /*
     * So a caller renders no figure rather than "£0 at stake". Absent and zero
     * are different claims -- the distinction this module has had to restate
     * more than once.
     */
    const [group] = groupBySharedSubject([
      finding('a', [DAVID], 'contact', null),
      finding('b', [DAVID], 'contact', undefined),
    ]);

    expect(subjectImpact(group)).toBeNull();
  });
});
