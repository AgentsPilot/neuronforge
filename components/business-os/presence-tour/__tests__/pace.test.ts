import { beatMs, timeChapter, beatAtU, MIN_MS, MAX_MS } from '../pace';

describe('pace', () => {
  /*
   * The bug this module exists to prevent: 59 seconds of narration in an
   * 18-second chapter, because the duration was guessed and the script was
   * written separately.
   */
  it('gives long text more time than short text', () => {
    const short = beatMs('Two words.', 'en');
    const long = beatMs('x'.repeat(400), 'en');
    expect(long).toBeGreaterThan(short);
  });

  it('gives Hebrew more time per character than English', () => {
    /* Short enough that neither language hits the 16s ceiling, or the cap
       would swallow the difference and the test would prove nothing. */
    const text = 'x'.repeat(100);
    expect(beatMs(text, 'he')).toBeGreaterThan(beatMs(text, 'en'));
  });

  it('never returns less than a readable minimum', () => {
    expect(beatMs('', 'en')).toBeGreaterThanOrEqual(MIN_MS);
    expect(beatMs('Hi.', 'en')).toBeGreaterThanOrEqual(MIN_MS);
  });

  it('caps a runaway caption rather than stalling the film', () => {
    expect(beatMs('x'.repeat(10_000), 'en')).toBeLessThanOrEqual(MAX_MS);
  });

  describe('timeChapter', () => {
    const texts = ['x'.repeat(100), 'x'.repeat(300), 'x'.repeat(50)];

    it('sums its beats', () => {
      const tc = timeChapter(texts, 'en');
      expect(tc.durMs).toBe(tc.beatMs.reduce((a, b) => a + b, 0));
    });

    it('starts the first beat at zero and keeps them in order', () => {
      const { beatAt } = timeChapter(texts, 'en');
      expect(beatAt[0]).toBe(0);
      for (let i = 1; i < beatAt.length; i += 1) {
        expect(beatAt[i]).toBeGreaterThan(beatAt[i - 1]);
      }
      expect(beatAt[beatAt.length - 1]).toBeLessThan(1);
    });

    it('survives a chapter with no beats', () => {
      const tc = timeChapter([], 'en');
      expect(tc.durMs).toBeGreaterThan(0);
      expect(tc.beatAt).toEqual([]);
    });
  });

  describe('beatAtU', () => {
    const beatAt = [0, 0.25, 0.6];

    it('maps the playhead onto the right beat', () => {
      expect(beatAtU(beatAt, 0)).toBe(0);
      expect(beatAtU(beatAt, 0.24)).toBe(0);
      expect(beatAtU(beatAt, 0.25)).toBe(1);
      expect(beatAtU(beatAt, 0.59)).toBe(1);
      expect(beatAtU(beatAt, 0.6)).toBe(2);
      expect(beatAtU(beatAt, 1)).toBe(2);
    });

    it('never indexes past the end', () => {
      expect(beatAtU([0], 0.9)).toBe(0);
      expect(beatAtU([], 0.5)).toBe(0);
    });
  });
});
