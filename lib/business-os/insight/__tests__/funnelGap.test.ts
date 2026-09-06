import { resolveGap, gapStateFor, MIN_TO_JUDGE, type GapEnd } from '../funnelGap';

const pipeline = (count: number): GapEnd => ({ count, window: 'pipeline' });
const visitors = (count: number): GapEnd => ({ count, window: 'visitors' });

describe('[smoke] resolveGap', () => {
  it('claims nothing before the business is live', () => {
    expect(resolveGap(pipeline(40), pipeline(2), false)).toEqual({ kind: 'setup' });
  });

  it('refuses to compare two different periods', () => {
    // 30 days of visitors against a pipeline holding everyone ever added. The
    // arithmetic works and the answer is meaningless, which is the dangerous
    // combination — it renders as a confident percentage.
    expect(resolveGap(visitors(200), pipeline(10), true)).toEqual({ kind: 'incomparable' });
    expect(resolveGap(pipeline(10), visitors(200), true)).toEqual({ kind: 'incomparable' });
  });

  it('says nothing about a gap with nobody upstream', () => {
    expect(resolveGap(pipeline(0), pipeline(0), true)).toEqual({ kind: 'empty' });
  });

  it('holds off until there are enough to read', () => {
    expect(resolveGap(pipeline(MIN_TO_JUDGE - 1), pipeline(0), true)).toEqual({ kind: 'tooEarly' });
    // At the threshold it will judge — and 0 of 5 is a leak, not silence.
    expect(resolveGap(pipeline(MIN_TO_JUDGE), pipeline(0), true)).toEqual({
      kind: 'leaking',
      dropped: 5,
    });
  });

  it('grades conversion once there is enough to grade', () => {
    expect(resolveGap(pipeline(10), pipeline(8), true)).toEqual({ kind: 'healthy' });
    expect(resolveGap(pipeline(10), pipeline(5), true)).toEqual({ kind: 'healthy' });
    expect(resolveGap(pipeline(10), pipeline(3), true)).toEqual({ kind: 'watching' });
    expect(resolveGap(pipeline(10), pipeline(2), true)).toEqual({ kind: 'leaking', dropped: 8 });
  });

  it('counts the drop, not the rate, when it reports a leak', () => {
    // The label says "N dropped off", so N has to be people rather than a
    // percentage of them.
    expect(resolveGap(pipeline(100), pipeline(9), true)).toEqual({ kind: 'leaking', dropped: 91 });
  });

  it('does not report a leak when the next stage is larger', () => {
    // Stages are a snapshot, so downstream can legitimately hold more people
    // than upstream. That is not a leak and must not be drawn as one.
    expect(resolveGap(pipeline(5), pipeline(20), true)).toEqual({ kind: 'healthy' });
  });

  it('checks liveness before anything else', () => {
    // A setup-mode map is dashes end to end; no verdict may leak through it.
    expect(resolveGap(visitors(0), pipeline(0), false)).toEqual({ kind: 'setup' });
  });
});

describe('[smoke] gapStateFor', () => {
  it('draws a judgement only where one was made', () => {
    expect(gapStateFor({ kind: 'healthy' })).toBe('ok');
    expect(gapStateFor({ kind: 'leaking', dropped: 3 })).toBe('leak');
  });

  it('never draws an unjudged gap as good or bad', () => {
    // These three mean "I am not saying". Rendering any of them as ok or leak
    // would put a verdict on the map that resolveGap declined to give.
    for (const kind of ['incomparable', 'tooEarly', 'watching'] as const) {
      expect(gapStateFor({ kind })).toBe('watch');
    }
    for (const kind of ['setup', 'empty'] as const) {
      expect(gapStateFor({ kind })).toBe('off');
    }
  });
});
