/**
 * What the connector between two funnel stations is allowed to claim.
 *
 * Kept pure and outside the component because this is the decision that was
 * quietly wrong before: gaps were indexed off a different array than the
 * stations, so several branches could never be reached, and a conversion rate
 * was computed between two numbers counting different periods.
 *
 * Returns a verdict rather than a sentence — the component owns the wording.
 */

/** Which period a funnel number covers. */
export type FunnelWindow = 'visitors' | 'pipeline' | 'period';

export interface GapEnd {
  count: number;
  window: FunnelWindow;
}

export type GapVerdict =
  /** Not live yet: nothing has been measured, so nothing is claimed. */
  | { kind: 'setup' }
  /**
   * The two ends count different periods — 30 days of visitors against a
   * pipeline holding everyone ever added. A percentage here would look
   * authoritative and mean nothing.
   */
  | { kind: 'incomparable' }
  /** Nobody at the upstream station, so there is no flow to judge. */
  | { kind: 'empty' }
  /** Too few to read anything into. */
  | { kind: 'tooEarly' }
  | { kind: 'healthy' }
  | { kind: 'watching' }
  | { kind: 'leaking'; dropped: number };

/** Below this, a conversion rate is noise rather than a signal. */
export const MIN_TO_JUDGE = 5;

export function resolveGap(from: GapEnd, to: GapEnd, isLive: boolean): GapVerdict {
  if (!isLive) return { kind: 'setup' };
  if (from.window !== to.window) return { kind: 'incomparable' };
  if (from.count === 0) return { kind: 'empty' };
  if (from.count < MIN_TO_JUDGE) return { kind: 'tooEarly' };

  const rate = to.count / from.count;
  if (rate >= 0.5) return { kind: 'healthy' };
  if (rate >= 0.25) return { kind: 'watching' };
  return { kind: 'leaking', dropped: from.count - to.count };
}

/** A funnel station, as the leak picker needs to see it. */
export interface LeakNode extends GapEnd {
  label: string;
}

export interface Leak<T extends GapEnd> {
  /** Gap key, matching the map's `g1`, `g2`, … */
  key: string;
  from: T;
  to: T;
  dropped: number;
}

/**
 * Which leak the drawer should show, if any.
 *
 * Lives here rather than inside the dashboard's `useMemo` so it can be tested.
 * The rule it encodes is easy to state and easy to get subtly wrong:
 *
 *   1. A leak must OPEN the drawer whether or not anyone clicked it. A drop-off
 *      nobody has noticed is exactly the one worth surfacing.
 *   2. Clicking a leaking gap opens THAT one, so selection still steers.
 *   3. With several leaks, the worst one shows — picking the first would bury
 *      the biggest behind a click.
 *
 * `nodes` must be the same ordered array the stations are drawn from, so gap
 * `gN` always sits between `nodes[N-1]` and `nodes[N]` and the drawer can never
 * describe a gap the map does not show.
 */
export function pickLeak<T extends GapEnd>(
  nodes: T[],
  isLive: boolean,
  selectedKey?: string
): Leak<T> | null {
  const leaks: Leak<T>[] = [];

  for (let i = 0; i < nodes.length - 1; i++) {
    const from = nodes[i];
    const to = nodes[i + 1];
    const verdict = resolveGap(from, to, isLive);

    if (verdict.kind === 'leaking') {
      leaks.push({ key: `g${i + 1}`, from, to, dropped: verdict.dropped });
    }
  }

  if (leaks.length === 0) return null;

  return (
    leaks.find(leak => leak.key === selectedKey) ??
    leaks.reduce((worst, leak) => (leak.dropped > worst.dropped ? leak : worst))
  );
}

/** How the map draws each verdict. */
export function gapStateFor(verdict: GapVerdict): 'ok' | 'leak' | 'watch' | 'off' {
  switch (verdict.kind) {
    case 'healthy':
      return 'ok';
    case 'leaking':
      return 'leak';
    case 'watching':
    case 'tooEarly':
    case 'incomparable':
      return 'watch';
    case 'setup':
    case 'empty':
      return 'off';
  }
}
