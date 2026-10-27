import { clamp01, lerp, seg, at, fade, press, clock, easeOutCubic, easeInOutCubic } from '../timing';

/**
 * The helpers that replace `@keyframes`.
 *
 * Worth real tests because the whole tour is scrubbable ONLY if these are
 * pure and total. A helper that returns NaN at one input is a frame somebody
 * can drag the playhead onto.
 */
describe('timing', () => {
  describe('seg', () => {
    it('ramps 0 to 1 across the window and holds either side', () => {
      expect(seg(0.0, 0.2, 0.6)).toBe(0);
      expect(seg(0.2, 0.2, 0.6)).toBe(0);
      expect(seg(0.4, 0.2, 0.6)).toBeCloseTo(0.5);
      expect(seg(0.6, 0.2, 0.6)).toBe(1);
      expect(seg(1.0, 0.2, 0.6)).toBe(1);
    });

    /* A zero-width window is authored by accident the moment two beats are
       given the same number. It must step, not divide by zero. */
    it('treats a zero-width window as a step, never NaN', () => {
      expect(seg(0.3, 0.5, 0.5)).toBe(0);
      expect(seg(0.5, 0.5, 0.5)).toBe(1);
      expect(Number.isNaN(seg(0.5, 0.5, 0.5))).toBe(false);
    });

    it('survives an inverted window', () => {
      expect(Number.isNaN(seg(0.4, 0.8, 0.2))).toBe(false);
    });
  });

  describe('fade', () => {
    it('is invisible before, full during, invisible after', () => {
      expect(fade(0.0, 0.1, 0.2, 0.8, 0.9)).toBe(0);
      expect(fade(0.5, 0.1, 0.2, 0.8, 0.9)).toBe(1);
      expect(fade(1.0, 0.1, 0.2, 0.8, 0.9)).toBe(0);
    });

    it('never leaves the 0..1 range', () => {
      for (let u = 0; u <= 1.0001; u += 0.01) {
        const v = fade(u, 0.1, 0.2, 0.8, 0.9);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('press', () => {
    /* A press is a scale. Resting at anything but 1 would leave a button
       permanently shrunk at every `u` outside the window. */
    it('rests at exactly 1 either side of the window', () => {
      expect(press(0.1, 0.4, 0.6)).toBe(1);
      expect(press(0.9, 0.4, 0.6)).toBe(1);
    });

    it('dips below 1 inside the window', () => {
      expect(press(0.45, 0.4, 0.6)).toBeLessThan(1);
    });
  });

  describe('clamp01 and lerp', () => {
    it('clamps rather than extrapolating', () => {
      expect(clamp01(-3)).toBe(0);
      expect(clamp01(7)).toBe(1);
      expect(lerp(10, 20, -1)).toBe(10);
      expect(lerp(10, 20, 2)).toBe(20);
    });
  });

  describe('at', () => {
    it('is half-open, so neighbouring beats cannot both be true', () => {
      expect(at(0.3, 0.3, 0.6)).toBe(true);
      expect(at(0.6, 0.3, 0.6)).toBe(false);
      expect(at(0.6, 0.6, 0.9)).toBe(true);
    });
  });

  describe('eases', () => {
    it('are anchored at both ends', () => {
      expect(easeOutCubic(0)).toBeCloseTo(0);
      expect(easeOutCubic(1)).toBeCloseTo(1);
      expect(easeInOutCubic(0)).toBeCloseTo(0);
      expect(easeInOutCubic(1)).toBeCloseTo(1);
      expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
    });
  });

  describe('clock', () => {
    /* ASCII and zero-padded, in every language. `toLocaleString` would give a
       Hebrew owner Hebrew-Indic digits in a media transport. */
    it('formats m:ss', () => {
      expect(clock(0)).toBe('0:00');
      expect(clock(9_000)).toBe('0:09');
      expect(clock(45_000)).toBe('0:45');
      expect(clock(61_000)).toBe('1:01');
    });

    it('never renders a negative time', () => {
      expect(clock(-5_000)).toBe('0:00');
    });

    /* The transport printed `NaN:NaN / 2:04` when a chapter lost its authored
       duration and the elapsed sum became NaN. The clock should degrade to
       zero rather than put that on screen. */
    it('never prints NaN', () => {
      expect(clock(NaN)).toBe('0:00');
      expect(clock(Infinity)).toBe('0:00');
      expect(clock(undefined as unknown as number)).toBe('0:00');
    });
  });
});
