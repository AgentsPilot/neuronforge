/**
 * Unit tests for BasePluginExecutor.getCalibrationNotice — the Phase 4
 * calibration outbound-message marking + recipient-redirect helper.
 *
 * Covers: no-op outside calibration, round shown only from #2 onward, subject
 * prefix + banners, and the redirect target passthrough.
 */

import { BasePluginExecutor } from '@/lib/server/base-plugin-executor';

// Minimal concrete subclass to reach the protected helper without the full
// plugin runtime. The two deps are only stored, so casts are safe here.
class TestExecutor extends BasePluginExecutor {
  constructor() {
    super('test-plugin', {} as any, {} as any);
  }
  protected async executeSpecificAction(): Promise<any> {
    return null;
  }
  public notice(parameters: any) {
    return this.getCalibrationNotice(parameters);
  }
}

const exec = new TestExecutor();

describe('getCalibrationNotice', () => {
  it('returns isCalibration=false (empty) when no _calibration marker', () => {
    const n = exec.notice({ content: { subject: 'Hi' } });
    expect(n.isCalibration).toBe(false);
    expect(n.subjectPrefix).toBe('');
    expect(n.htmlBanner).toBe('');
    expect(n.textBanner).toBe('');
    expect(n.redirectTo).toBeUndefined();
  });

  it('marks calibration with no round number for round 1', () => {
    const n = exec.notice({ _calibration: { isCalibration: true, round: 1 } });
    expect(n.isCalibration).toBe(true);
    expect(n.subjectPrefix).toBe('[Calibration test] ');
    expect(n.subjectPrefix).not.toMatch(/round/);
    expect(n.textBanner).toContain('calibration test run');
    expect(n.textBanner).not.toMatch(/round/);
  });

  it('omits the round when round is undefined', () => {
    const n = exec.notice({ _calibration: { isCalibration: true } });
    expect(n.subjectPrefix).toBe('[Calibration test] ');
  });

  it('shows the round from #2 onward', () => {
    const n = exec.notice({ _calibration: { isCalibration: true, round: 2 } });
    expect(n.subjectPrefix).toBe('[Calibration test · round 2] ');
    expect(n.textBanner).toContain('(round 2)');
    expect(n.htmlBanner).toContain('round 2');
  });

  it('passes through a redirect target', () => {
    const n = exec.notice({ _calibration: { isCalibration: true, round: 3, redirectTo: 'owner@example.com' } });
    expect(n.redirectTo).toBe('owner@example.com');
  });

  it('treats an empty redirectTo as undefined', () => {
    const n = exec.notice({ _calibration: { isCalibration: true, round: 2, redirectTo: '' } });
    expect(n.redirectTo).toBeUndefined();
  });

  it('exposes suppressSend when the marker sets it (degraded run)', () => {
    const n = exec.notice({ _calibration: { isCalibration: true, round: 1, suppressSend: true } });
    expect(n.suppressSend).toBe(true);
  });

  it('defaults suppressSend to false when the marker omits it', () => {
    const n = exec.notice({ _calibration: { isCalibration: true, round: 1 } });
    expect(n.suppressSend).toBe(false);
  });

  it('reports suppressSend=false outside calibration', () => {
    const n = exec.notice({ content: { subject: 'Hi' } });
    expect(n.suppressSend).toBe(false);
  });
});
