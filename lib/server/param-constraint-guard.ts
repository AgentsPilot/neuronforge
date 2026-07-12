// lib/server/param-constraint-guard.ts
//
// Item 4 (V6 Field-Fidelity & Calibration Hardening requirement) — runtime
// clamp-and-warn guard for out-of-range / invalid generated parameter values.
//
// Why this exists: agent 0ee53785 had `max_results: 500` baked into a Gmail
// search step, but the plugin declares `minimum:1, maximum:100, default:10`.
// Nothing validated the outgoing value against the plugin's OWN declared
// constraints. Per SA Round 2, an out-of-range value the connector tolerates is
// not execution-breaking, so this is a generic, self-healing runtime guard — it
// NEVER blocks and NEVER throws. It reads constraints from each action's own
// parameter schema, so it is fully generic across every plugin/action with ZERO
// plugin-name branches (honouring CLAUDE.md § No Hardcoding).

import type { ActionParameterSchema } from '@/lib/types/plugin-types';
import { createLogger } from '@/lib/logger';

const defaultLogger = createLogger({ module: 'ParamConstraintGuard' });

/** A single correction the guard applied to an outgoing parameter. */
export interface ParamCorrection {
  /** Parameter name that was corrected. */
  param: string;
  /** Which declared constraint was violated. */
  constraint: 'maximum' | 'minimum' | 'enum';
  /**
   * What the guard did:
   * - `clamp`       → numeric value snapped to the declared bound
   * - `default`     → invalid value replaced with the plugin's declared default
   * - `passthrough` → invalid value left UNCHANGED (no default to fall back to)
   */
  action: 'clamp' | 'default' | 'passthrough';
  /** The offending value as received. */
  originalValue: unknown;
  /** The value after correction (equals originalValue for `passthrough`). */
  correctedValue: unknown;
}

export interface ParamGuardContext {
  pluginName: string;
  actionName: string;
}

export interface ParamGuardResult {
  /** A shallow-cloned params object with corrections applied. */
  params: Record<string, unknown>;
  /** Every correction the guard made (empty when nothing was out of range). */
  corrections: ParamCorrection[];
}

/** Minimal logger surface so tests can inject a spy without the full Pino instance. */
interface WarnLogger {
  warn: (obj: object, msg: string) => void;
}

/**
 * Coerce a value to a finite number if it plausibly represents one.
 * Accepts real numbers and numeric strings (LLM/DSL emissions are often strings);
 * returns null for anything non-numeric so the caller can treat it as
 * "non-clampable" rather than guessing.
 */
function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Validate every outgoing parameter against the target action's own declared
 * constraints (`minimum` / `maximum` / `enum` / `default`) and self-heal
 * out-of-range or invalid values. Generic and schema-driven — no plugin-specific
 * logic. NEVER throws and NEVER blocks; the returned params are always safe to
 * forward to the plugin executor.
 */
export function applyParamConstraintGuard(
  schema: ActionParameterSchema | undefined,
  params: Record<string, unknown> | undefined | null,
  context: ParamGuardContext,
  logger: WarnLogger = defaultLogger,
): ParamGuardResult {
  const safeParams: Record<string, unknown> = { ...(params ?? {}) };
  const corrections: ParamCorrection[] = [];

  // The guard is the last line before the external API — under no circumstances
  // may our own logic error stop a live run. Anything unexpected returns the
  // params untouched.
  try {
    const properties = schema?.properties;
    if (!properties) {
      return { params: safeParams, corrections };
    }

    for (const key of Object.keys(safeParams)) {
      const propSchema = properties[key];
      // No declared constraint for this key (e.g. internal `_calibration`) → leave it.
      if (!propSchema) continue;

      const value = safeParams[key];
      if (value === undefined || value === null) continue;

      const hasMin = typeof propSchema.minimum === 'number';
      const hasMax = typeof propSchema.maximum === 'number';

      // --- Numeric range constraints -------------------------------------
      if (hasMin || hasMax) {
        const num = toFiniteNumber(value);

        if (num === null) {
          // Declared numeric but the value isn't a finite number → non-clampable.
          // Prefer the declared default; otherwise pass through unchanged. Never
          // drop, never invent.
          const constraint: ParamCorrection['constraint'] = hasMax ? 'maximum' : 'minimum';
          if (propSchema.default !== undefined) {
            const correction: ParamCorrection = {
              param: key, constraint, action: 'default',
              originalValue: value, correctedValue: propSchema.default,
            };
            safeParams[key] = propSchema.default;
            corrections.push(correction);
            warn(logger, context, correction, 'non-numeric value on a numeric param — replaced with declared default');
          } else {
            const correction: ParamCorrection = {
              param: key, constraint, action: 'passthrough',
              originalValue: value, correctedValue: value,
            };
            corrections.push(correction);
            warn(logger, context, correction, 'non-numeric value on a numeric param — no default, passed through unchanged');
          }
          continue;
        }

        let clamped = num;
        let violated: ParamCorrection['constraint'] | null = null;
        if (hasMax && num > (propSchema.maximum as number)) {
          clamped = propSchema.maximum as number;
          violated = 'maximum';
        } else if (hasMin && num < (propSchema.minimum as number)) {
          clamped = propSchema.minimum as number;
          violated = 'minimum';
        }

        if (violated) {
          // Preserve the caller's JS type: a numeric string stays a string.
          const correctedValue: unknown = typeof value === 'string' ? String(clamped) : clamped;
          const correction: ParamCorrection = {
            param: key, constraint: violated, action: 'clamp',
            originalValue: value, correctedValue,
          };
          safeParams[key] = correctedValue;
          corrections.push(correction);
          warn(logger, context, correction, `numeric value out of range — clamped to declared ${violated}`);
        }
        // A numeric param is not also an enum; done with this key.
        continue;
      }

      // --- Enum constraint -----------------------------------------------
      if (Array.isArray(propSchema.enum) && propSchema.enum.length > 0) {
        // Enums apply to scalar values; skip arrays/objects to avoid false positives.
        if (typeof value === 'object') continue;
        if (propSchema.enum.includes(value as string)) continue; // valid → untouched

        if (propSchema.default !== undefined) {
          const correction: ParamCorrection = {
            param: key, constraint: 'enum', action: 'default',
            originalValue: value, correctedValue: propSchema.default,
          };
          safeParams[key] = propSchema.default;
          corrections.push(correction);
          warn(logger, context, correction, 'invalid enum value — replaced with declared default');
        } else {
          const correction: ParamCorrection = {
            param: key, constraint: 'enum', action: 'passthrough',
            originalValue: value, correctedValue: value,
          };
          corrections.push(correction);
          warn(logger, context, correction, 'invalid enum value — no default, passed through unchanged');
        }
      }
    }
  } catch (err) {
    // Guard must never break a run. Swallow and continue with what we have.
    logger.warn(
      { err, plugin: context.pluginName, action: context.actionName },
      'Param-constraint guard errored internally — skipping, params forwarded unchanged',
    );
    return { params: safeParams, corrections };
  }

  return { params: safeParams, corrections };
}

/**
 * Loud, structured warn so the ORIGIN defect stays visible for later correction.
 * Carries param name, offending value, corrected value, and plugin/action context.
 */
function warn(
  logger: WarnLogger,
  context: ParamGuardContext,
  correction: ParamCorrection,
  message: string,
): void {
  logger.warn(
    {
      plugin: context.pluginName,
      action: context.actionName,
      param: correction.param,
      constraint: correction.constraint,
      correction: correction.action,
      offendingValue: correction.originalValue,
      correctedValue: correction.correctedValue,
    },
    `Runtime param-constraint guard: ${message}. Fix the value at its source.`,
  );
}
