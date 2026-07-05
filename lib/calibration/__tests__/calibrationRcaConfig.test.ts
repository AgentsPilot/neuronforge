/**
 * Unit tests for the DB-backed calibration RCA config accessor (FR-13, AC-6).
 * Proves the DEFAULT_CONFIG fallback (mid-tier model, no hardcoded literal in
 * the service) and DB override behaviour, without a real database.
 */

const mockLike = jest.fn();

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        like: mockLike,
      })),
    })),
  })),
}));

import {
  getCalibrationRcaConfig,
  refreshCalibrationRcaConfig,
  clearCalibrationRcaConfigCache,
  isCalibrationAutoRcaEnabled,
  DEFAULT_CONFIG,
} from '../calibrationRcaConfig';

describe('calibrationRcaConfig', () => {
  beforeEach(() => {
    clearCalibrationRcaConfigCache();
    mockLike.mockReset();
  });

  it('DEFAULT_CONFIG is the mid-tier reasoning default (anthropic / claude-sonnet-4-6 / temp 0)', () => {
    expect(DEFAULT_CONFIG.provider).toBe('anthropic');
    expect(DEFAULT_CONFIG.model).toBe('claude-sonnet-4-6');
    expect(DEFAULT_CONFIG.temperature).toBe(0);
    expect(DEFAULT_CONFIG.timeoutMs).toBe(25000);
  });

  it('falls back to defaults when the DB query errors', async () => {
    mockLike.mockResolvedValue({ data: null, error: new Error('db down') });
    const cfg = await getCalibrationRcaConfig();
    expect(cfg).toEqual(DEFAULT_CONFIG);
  });

  it('falls back to defaults when no config rows exist', async () => {
    mockLike.mockResolvedValue({ data: [], error: null });
    const cfg = await getCalibrationRcaConfig();
    expect(cfg).toEqual(DEFAULT_CONFIG);
  });

  it('applies DB overrides on top of defaults', async () => {
    mockLike.mockResolvedValue({
      data: [
        { key: 'calibration_rca_model', value: '"claude-opus-4-6"' },
        { key: 'calibration_rca_timeout_ms', value: '15000' },
        { key: 'calibration_rca_temperature', value: '0.2' },
      ],
      error: null,
    });
    await refreshCalibrationRcaConfig();
    const cfg = await getCalibrationRcaConfig();
    expect(cfg.model).toBe('claude-opus-4-6');
    expect(cfg.timeoutMs).toBe(15000);
    expect(cfg.temperature).toBe(0.2);
    // Untouched keys keep the default.
    expect(cfg.provider).toBe(DEFAULT_CONFIG.provider);
    expect(cfg.maxTokens).toBe(DEFAULT_CONFIG.maxTokens);
  });

  it('ignores an invalid provider override', async () => {
    mockLike.mockResolvedValue({
      data: [{ key: 'calibration_rca_provider', value: '"bogus"' }],
      error: null,
    });
    await refreshCalibrationRcaConfig();
    const cfg = await getCalibrationRcaConfig();
    expect(cfg.provider).toBe(DEFAULT_CONFIG.provider);
  });

  describe('isCalibrationAutoRcaEnabled (Item 1 / FR-19)', () => {
    const original = process.env.CALIBRATION_AUTO_RCA_ENABLED;
    afterEach(() => {
      if (original === undefined) delete process.env.CALIBRATION_AUTO_RCA_ENABLED;
      else process.env.CALIBRATION_AUTO_RCA_ENABLED = original;
    });

    it('returns true only when the flag is exactly "true"', () => {
      process.env.CALIBRATION_AUTO_RCA_ENABLED = 'true';
      expect(isCalibrationAutoRcaEnabled()).toBe(true);
    });

    it('returns false when the flag is "false"', () => {
      process.env.CALIBRATION_AUTO_RCA_ENABLED = 'false';
      expect(isCalibrationAutoRcaEnabled()).toBe(false);
    });

    it('returns false when the flag is unset', () => {
      delete process.env.CALIBRATION_AUTO_RCA_ENABLED;
      expect(isCalibrationAutoRcaEnabled()).toBe(false);
    });

    it('returns false for truthy-but-not-"true" values (e.g. "1", "yes")', () => {
      process.env.CALIBRATION_AUTO_RCA_ENABLED = '1';
      expect(isCalibrationAutoRcaEnabled()).toBe(false);
      process.env.CALIBRATION_AUTO_RCA_ENABLED = 'yes';
      expect(isCalibrationAutoRcaEnabled()).toBe(false);
    });
  });
});
