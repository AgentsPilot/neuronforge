/**
 * The leak drawer's appearance rule, asserted rather than assumed.
 *
 * The requirement is one sentence — "the drawer appears once there is a leak" —
 * and it has three failure modes that all look fine on a dashboard that happens
 * to have no leaks: it only opens on click, it opens for something that is not a
 * leak, or with several leaks it shows the smallest.
 */

import { pickLeak, MIN_TO_JUDGE, type FunnelWindow } from '../funnelGap';

const node = (count: number, window: FunnelWindow = 'pipeline') => ({ count, window });

describe('pickLeak', () => {
  it('opens on a leak with nothing selected — the whole point', () => {
    // 20 → 2 is 10%, well under the 25% floor.
    const leak = pickLeak([node(20), node(2)], true);

    expect(leak).not.toBeNull();
    expect(leak!.key).toBe('g1');
    expect(leak!.dropped).toBe(18);
  });

  it('opens the leak that was clicked, not the worst one', () => {
    // Both gaps leak: g1 is 100→10 (drops 90), g2 is 10→1 (drops 9). g2 is the
    // smaller leak, and must still win when it is the one selected.
    const nodes = [node(100), node(10), node(1)];

    expect(pickLeak(nodes, true, 'g2')!.key).toBe('g2');
    expect(pickLeak(nodes, true, 'g1')!.key).toBe('g1');
  });

  it('shows the WORST leak when the selection is not a leak', () => {
    // Selecting a station, or a gap that does not exist, must not hide a leak.
    const nodes = [node(100), node(10), node(1)];

    expect(pickLeak(nodes, true, 'lead')!.key).toBe('g1');
    expect(pickLeak(nodes, true, 'g9')!.key).toBe('g1');
  });

  it('stays shut when nothing is leaking', () => {
    expect(pickLeak([node(20), node(18)], true)).toBeNull();   // healthy, 90%
    expect(pickLeak([node(20), node(8)], true)).toBeNull();    // watching, 40%
    expect(pickLeak([node(0), node(0)], true)).toBeNull();     // empty
    expect(pickLeak([node(20)], true)).toBeNull();             // one station, no gap
    expect(pickLeak([], true)).toBeNull();
  });

  it('stays shut before the business is live', () => {
    // Nothing has been measured, so a "leak" would be an artefact of zeros.
    expect(pickLeak([node(20), node(0)], false)).toBeNull();
  });

  it('stays shut below the judging threshold', () => {
    // The account this was built against has 3 leads. Four contacts dropping to
    // zero is a 100% drop-off and still not evidence of anything.
    expect(pickLeak([node(MIN_TO_JUDGE - 1), node(0)], true)).toBeNull();
    expect(pickLeak([node(MIN_TO_JUDGE), node(0)], true)).not.toBeNull();
  });

  it('never compares two different periods', () => {
    // 600 visitors in 30 days against 3 contacts ever is not a 99% drop-off,
    // and reporting it as one would be the loudest wrong number on the page.
    const leak = pickLeak([node(600, 'visitors'), node(3, 'pipeline')], true);

    expect(leak).toBeNull();
  });

  it('keys gaps off the same array the stations come from', () => {
    // g2 must sit between nodes[1] and nodes[2]. If this drifts, the drawer
    // describes one gap while the map highlights another.
    const nodes = [node(100), node(90), node(5)];
    const leak = pickLeak(nodes, true);

    expect(leak!.key).toBe('g2');
    expect(leak!.from).toBe(nodes[1]);
    expect(leak!.to).toBe(nodes[2]);
  });
});
