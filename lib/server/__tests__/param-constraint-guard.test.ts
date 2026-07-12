/**
 * Unit tests for applyParamConstraintGuard — Item 4 runtime clamp-and-warn guard.
 *
 * Covers the SA Round-2 behaviour contract:
 *  - numeric over-max clamps + warns + continues (the canonical 500 → 100 case)
 *  - numeric under-min clamps + warns
 *  - invalid enum falls back to the declared default
 *  - invalid enum with NO declared default warns and passes through unchanged
 *  - a valid in-range / valid enum value is untouched (no warning)
 *  - non-clampable numeric falls back to default / passes through
 *  - the guard is generic (no plugin-name branches — same schema, different plugins)
 *  - the guard never throws, even on malformed input
 */

import { applyParamConstraintGuard } from '@/lib/server/param-constraint-guard';
import type { ActionParameterSchema } from '@/lib/types/plugin-types';

function makeLogger() {
  const warn = jest.fn();
  return { logger: { warn }, warn };
}

// Mirrors google-mail search_emails: max_results (number 1..100, default 10) +
// content_level (enum, default 'snippet'). Deliberately generic — no plugin name
// appears anywhere in the guard.
const gmailSearchSchema: ActionParameterSchema = {
  type: 'object',
  properties: {
    query: { type: 'string' },
    max_results: { type: 'number', minimum: 1, maximum: 100, default: 10 },
    content_level: { type: 'string', enum: ['metadata', 'snippet', 'full'], default: 'snippet' },
  },
};

const ctx = { pluginName: 'google-mail', actionName: 'search_emails' };

describe('applyParamConstraintGuard', () => {
  it('clamps a numeric value above the declared maximum (500 → 100), warns, and continues', () => {
    const { logger, warn } = makeLogger();
    const { params, corrections } = applyParamConstraintGuard(
      gmailSearchSchema, { query: 'in:inbox', max_results: 500 }, ctx, logger,
    );

    expect(params.max_results).toBe(100);
    expect(params.query).toBe('in:inbox'); // untouched
    expect(corrections).toEqual([
      expect.objectContaining({
        param: 'max_results', constraint: 'maximum', action: 'clamp',
        originalValue: 500, correctedValue: 100,
      }),
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    const [logObj] = warn.mock.calls[0];
    expect(logObj).toMatchObject({ param: 'max_results', offendingValue: 500, correctedValue: 100 });
  });

  it('clamps a numeric value below the declared minimum (0 → 1) and warns', () => {
    const { logger, warn } = makeLogger();
    const { params, corrections } = applyParamConstraintGuard(
      gmailSearchSchema, { max_results: 0 }, ctx, logger,
    );

    expect(params.max_results).toBe(1);
    expect(corrections[0]).toMatchObject({ constraint: 'minimum', action: 'clamp', correctedValue: 1 });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('preserves the JS type when clamping a numeric STRING (LLM emissions)', () => {
    const { logger } = makeLogger();
    const { params } = applyParamConstraintGuard(
      gmailSearchSchema, { max_results: '500' }, ctx, logger,
    );
    expect(params.max_results).toBe('100');
  });

  it('leaves a valid in-range numeric untouched and does NOT warn', () => {
    const { logger, warn } = makeLogger();
    const { params, corrections } = applyParamConstraintGuard(
      gmailSearchSchema, { max_results: 25 }, ctx, logger,
    );
    expect(params.max_results).toBe(25);
    expect(corrections).toHaveLength(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it('falls back an invalid enum to the declared default and warns', () => {
    const { logger, warn } = makeLogger();
    const { params, corrections } = applyParamConstraintGuard(
      gmailSearchSchema, { content_level: 'everything' }, ctx, logger,
    );
    expect(params.content_level).toBe('snippet');
    expect(corrections[0]).toMatchObject({
      param: 'content_level', constraint: 'enum', action: 'default',
      originalValue: 'everything', correctedValue: 'snippet',
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('leaves a valid enum value untouched and does NOT warn', () => {
    const { logger, warn } = makeLogger();
    const { params, corrections } = applyParamConstraintGuard(
      gmailSearchSchema, { content_level: 'full' }, ctx, logger,
    );
    expect(params.content_level).toBe('full');
    expect(corrections).toHaveLength(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it('passes an invalid enum through unchanged when there is NO declared default (never drops, never invents)', () => {
    const { logger, warn } = makeLogger();
    const noDefaultSchema: ActionParameterSchema = {
      type: 'object',
      properties: { mode: { type: 'string', enum: ['a', 'b'] } }, // no default
    };
    const { params, corrections } = applyParamConstraintGuard(
      noDefaultSchema, { mode: 'zzz' }, { pluginName: 'anyplugin', actionName: 'anyaction' }, logger,
    );
    expect(params.mode).toBe('zzz'); // unchanged, not dropped, not invented
    expect(corrections[0]).toMatchObject({ constraint: 'enum', action: 'passthrough', correctedValue: 'zzz' });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('falls back a non-clampable (non-numeric) value on a numeric param to the declared default', () => {
    const { logger } = makeLogger();
    const { params, corrections } = applyParamConstraintGuard(
      gmailSearchSchema, { max_results: 'lots' }, ctx, logger,
    );
    expect(params.max_results).toBe(10); // the declared default
    expect(corrections[0]).toMatchObject({ action: 'default', correctedValue: 10 });
  });

  it('leaves params with no declared schema entry untouched (e.g. internal _calibration)', () => {
    const { logger, warn } = makeLogger();
    const cal = { isCalibration: true };
    const { params, corrections } = applyParamConstraintGuard(
      gmailSearchSchema, { max_results: 25, _calibration: cal }, ctx, logger,
    );
    expect(params._calibration).toBe(cal);
    expect(corrections).toHaveLength(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it('is generic — the SAME schema drives corrections regardless of plugin/action name', () => {
    const { logger } = makeLogger();
    const a = applyParamConstraintGuard(gmailSearchSchema, { max_results: 500 }, { pluginName: 'plugin-x', actionName: 'op-x' }, logger);
    const b = applyParamConstraintGuard(gmailSearchSchema, { max_results: 500 }, { pluginName: 'plugin-y', actionName: 'op-y' }, logger);
    expect(a.params.max_results).toBe(100);
    expect(b.params.max_results).toBe(100);
  });

  it('does not mutate the caller-supplied params object', () => {
    const { logger } = makeLogger();
    const original = { max_results: 500 };
    const { params } = applyParamConstraintGuard(gmailSearchSchema, original, ctx, logger);
    expect(original.max_results).toBe(500); // caller object intact
    expect(params.max_results).toBe(100);
  });

  it('QA: a numeric value exactly equal to the bound is NOT clamped and does NOT warn (boundary)', () => {
    const { logger, warn } = makeLogger();
    // exactly the maximum
    const atMax = applyParamConstraintGuard(gmailSearchSchema, { max_results: 100 }, ctx, logger);
    expect(atMax.params.max_results).toBe(100);
    expect(atMax.corrections).toHaveLength(0);
    // exactly the minimum
    const atMin = applyParamConstraintGuard(gmailSearchSchema, { max_results: 1 }, ctx, logger);
    expect(atMin.params.max_results).toBe(1);
    expect(atMin.corrections).toHaveLength(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it('QA: a param present in params but ABSENT from the schema is left untouched', () => {
    const { logger, warn } = makeLogger();
    const { params, corrections } = applyParamConstraintGuard(
      gmailSearchSchema, { max_results: 25, undeclared_param: 999999 }, ctx, logger,
    );
    expect(params.undeclared_param).toBe(999999); // no schema entry → not touched
    expect(corrections).toHaveLength(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it('never throws on undefined schema / null params / malformed input', () => {
    const { logger } = makeLogger();
    expect(() => applyParamConstraintGuard(undefined, { max_results: 500 }, ctx, logger)).not.toThrow();
    expect(() => applyParamConstraintGuard(gmailSearchSchema, null, ctx, logger)).not.toThrow();
    expect(() => applyParamConstraintGuard(gmailSearchSchema, undefined, ctx, logger)).not.toThrow();

    // undefined schema → params returned unchanged
    const r = applyParamConstraintGuard(undefined, { max_results: 500 }, ctx, logger);
    expect(r.params.max_results).toBe(500);
    expect(r.corrections).toHaveLength(0);
  });
});
