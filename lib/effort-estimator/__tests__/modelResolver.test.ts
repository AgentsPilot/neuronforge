/**
 * Effort Estimator — modelResolver tests.
 *
 * Dedicated AC-7 row (per SA observation #2): asserts the default fallback
 * to `gpt-4o-mini` on OpenAI when the `system_settings_config` row is
 * missing, plus the various accepted value shapes.
 *
 * NOTE: 2026-06-10 — mocks the `systemConfigRepository` singleton instead of
 * `supabaseServer` directly, after the user code review caught a CLAUDE.md
 * mandatory rule #1 violation in the first pass.
 */

// Mock the SystemConfigRepository singleton before importing modelResolver.
const getByKey = jest.fn();

jest.mock('@/lib/repositories', () => ({
  systemConfigRepository: {
    getByKey: (key: string) => getByKey(key),
  },
}));

import { resolveEffortEstimatorModel, clearModelCache, DEFAULT_MODEL } from '../modelResolver';

describe('resolveEffortEstimatorModel', () => {
  beforeEach(() => {
    clearModelCache();
    jest.clearAllMocks();
  });

  it('AC-7: falls back to gpt-4o-mini on OpenAI when the row is missing', async () => {
    getByKey.mockResolvedValue({ data: null, error: null });

    const result = await resolveEffortEstimatorModel();

    expect(result).toEqual({ provider: 'openai', model: 'gpt-4o-mini' });
    expect(result).toEqual(DEFAULT_MODEL);
    expect(getByKey).toHaveBeenCalledWith('effort_estimator_model');
  });

  it('AC-7: falls back when the repository call errors', async () => {
    getByKey.mockResolvedValue({ data: null, error: new Error('pg down') });

    const result = await resolveEffortEstimatorModel();

    expect(result).toEqual(DEFAULT_MODEL);
  });

  it('parses an object value { provider, model } correctly', async () => {
    getByKey.mockResolvedValue({
      data: {
        id: 'x',
        key: 'effort_estimator_model',
        value: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
        category: 'general',
        description: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      error: null,
    });

    const result = await resolveEffortEstimatorModel();

    expect(result).toEqual({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001' });
  });

  it('parses a JSON-encoded string value (provider defaults to openai)', async () => {
    getByKey.mockResolvedValue({
      data: {
        id: 'x',
        key: 'effort_estimator_model',
        value: '"gpt-4o-mini"',
        category: 'general',
        description: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      error: null,
    });

    const result = await resolveEffortEstimatorModel();

    expect(result).toEqual({ provider: 'openai', model: 'gpt-4o-mini' });
  });

  it('parses a bare string value (provider defaults to openai)', async () => {
    getByKey.mockResolvedValue({
      data: {
        id: 'x',
        key: 'effort_estimator_model',
        value: 'gpt-4o',
        category: 'general',
        description: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      error: null,
    });

    const result = await resolveEffortEstimatorModel();

    expect(result).toEqual({ provider: 'openai', model: 'gpt-4o' });
  });

  it('falls back to default when the value shape is unrecognised', async () => {
    getByKey.mockResolvedValue({
      data: {
        id: 'x',
        key: 'effort_estimator_model',
        value: 12345,
        category: 'general',
        description: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      error: null,
    });

    const result = await resolveEffortEstimatorModel();

    expect(result).toEqual(DEFAULT_MODEL);
  });

  it('caches the resolved value for subsequent calls within the TTL', async () => {
    getByKey.mockResolvedValue({
      data: {
        id: 'x',
        key: 'effort_estimator_model',
        value: { provider: 'openai', model: 'gpt-4o' },
        category: 'general',
        description: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      error: null,
    });

    await resolveEffortEstimatorModel();
    await resolveEffortEstimatorModel();
    await resolveEffortEstimatorModel();

    // Should only hit the repository once thanks to the cache.
    expect(getByKey).toHaveBeenCalledTimes(1);
  });

  it('clearModelCache invalidates the cache', async () => {
    getByKey.mockResolvedValue({
      data: {
        id: 'x',
        key: 'effort_estimator_model',
        value: { provider: 'openai', model: 'gpt-4o' },
        category: 'general',
        description: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      error: null,
    });

    await resolveEffortEstimatorModel();
    clearModelCache();
    await resolveEffortEstimatorModel();

    expect(getByKey).toHaveBeenCalledTimes(2);
  });
});
