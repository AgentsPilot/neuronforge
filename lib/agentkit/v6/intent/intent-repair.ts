/* lib/intent/intent-repair.ts */
import type { IntentContract, Step } from "./intent-schema-types";

function ensureId(prefix: string, n: number) {
  return `${prefix}_${n}`;
}

function normalizeSteps(steps: Step[], prefix = "step"): Step[] {
  return steps.map((s, idx) => {
    const id = (s as any).id || ensureId(prefix, idx + 1);
    const name = (s as any).name || id;
    const base = { ...s, id, name };

    if (base.kind === "decide") {
      return {
        ...(base as any),
        then: normalizeSteps((base as any).then ?? [], `${id}_then`),
        else: normalizeSteps((base as any).else ?? [], `${id}_else`),
      } as Step;
    }
    if (base.kind === "loop") {
      return {
        ...(base as any),
        do: normalizeSteps((base as any).do ?? [], `${id}_do`),
      } as Step;
    }
    if (base.kind === "parallel") {
      const branches = ((base as any).branches ?? []).map((b: any, bi: number) => ({
        id: b.id || ensureId(`${id}_branch`, bi + 1),
        name: b.name || `Branch ${bi + 1}`,
        steps: normalizeSteps(b.steps ?? [], `${id}_b${bi + 1}`),
      }));
      return { ...(base as any), branches } as Step;
    }
    return base as Step;
  });
}

/**
 * Normalize plugin field names from LLM output to schema-compliant format
 */
function normalizePlugins(plugins: any[]): any[] {
  return plugins.map((p: any) => {
    const normalized: any = { ...p };

    // Handle field name variations
    if (p.purpose && !p.reason) {
      normalized.reason = p.purpose;
      delete normalized.purpose;
    }

    // Ensure reason field exists (required by schema)
    if (!normalized.reason) {
      // Generate default reason from capabilities
      const caps = Array.isArray(normalized.capabilities) ? normalized.capabilities : [];
      if (caps.length > 0) {
        normalized.reason = `Provides ${caps.slice(0, 3).join(', ')}${caps.length > 3 ? ', ...' : ''}`;
      } else {
        normalized.reason = `Required for workflow execution`;
      }
    }

    // Normalize role field
    // LLM might use "primary" or other values, but schema only allows: "input" | "output" | "both"
    // Map common variations:
    if (!normalized.role || !['input', 'output', 'both'].includes(normalized.role)) {
      if (normalized.role === 'primary' || normalized.role === 'main' || normalized.role === 'core') {
        normalized.role = 'both'; // Most plugins do both input and output
      } else {
        normalized.role = 'both'; // Default to 'both' if unclear
      }
    }

    // Ensure required field exists (default to true if missing)
    if (normalized.required === undefined) {
      normalized.required = true;
    }

    // Ensure capabilities is an array
    if (!Array.isArray(normalized.capabilities)) {
      normalized.capabilities = [];
    }

    return normalized;
  });
}

/**
 * Normalize risks array (ensure all items are strings, not objects)
 */
function normalizeRisks(risks: any): string[] {
  if (!Array.isArray(risks)) {
    return [];
  }

  return risks.map((r: any) => {
    if (typeof r === 'string') {
      return r;
    }
    // If it's an object with a 'risk' or 'description' field, extract that
    if (typeof r === 'object' && r !== null) {
      return r.risk || r.description || JSON.stringify(r);
    }
    return String(r);
  });
}

/**
 * Deterministic normalization + minimal safety rules.
 * Add your own constraints here (e.g., forbid account identifiers if plugin selected).
 */
export function repairIntentContract(intent: IntentContract): IntentContract {
  // Remove any additional properties that aren't in the schema
  const {
    version,
    created_at,
    goal,
    summary,
    unit_of_work,
    plugins,
    data_sources,
    steps,
    outputs,
    constraints,
    questions,
    risks,
    confidence,
  } = intent as any;

  const repaired: IntentContract = {
    version,
    created_at,
    goal,
    summary,
    unit_of_work,
    plugins: normalizePlugins(Array.isArray(plugins) ? plugins : []),
    data_sources: Array.isArray(data_sources) ? data_sources : [],
    outputs: Array.isArray(outputs) ? outputs : [],
    constraints: Array.isArray(constraints) ? constraints : [],
    steps: normalizeSteps(Array.isArray(steps) ? steps : []),
    questions: questions || undefined,
    risks: risks ? normalizeRisks(risks) : undefined,
    confidence: confidence || undefined,
  };

  // Guarantee at least one constraint for unit_of_work (compiler likes explicitness)
  const hasUow = repaired.constraints.some((c: any) => c?.kind === "unit_of_work");
  if (!hasUow) {
    repaired.constraints = [
      ...repaired.constraints,
      { id: "C_uow", kind: "unit_of_work", value: repaired.unit_of_work, notes: "Normalized from top-level unit_of_work" } as any,
    ];
  }

  // Basic sanity: if no plugins, keep empty list (compiler will ask questions)
  if (!repaired.plugins) repaired.plugins = [];

  return repaired;
}
