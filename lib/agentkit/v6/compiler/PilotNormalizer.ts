/**
 * PilotNormalizer - Utility class for normalizing and fixing PILOT DSL workflows
 *
 * Extracted from test-direct-generation route to be reusable across the V6 pipeline.
 *
 * Key functions:
 * - normalizePilot: Ensures sequential step IDs, removes illegal fields, enforces structure
 * - fixLoopItemReferences: Converts {{stepX.data.array.field}} to {{item.field}} inside loops
 */

export class PilotNormalizer {
  /**
   * Helper: Check if value is a plain object
   */
  private static isObject(v: any): boolean {
    return v && typeof v === 'object' && !Array.isArray(v);
  }

  /**
   * Helper: Safe array accessor
   */
  private static safeArray<T>(v: any): T[] {
    return Array.isArray(v) ? v : [];
  }

  /**
   * Helper: Deep clone
   */
  private static deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * Helper: Normalize plugin action name (remove plugin prefix if present)
   */
  private static normalizePluginAction(action: string): string {
    if (typeof action !== 'string') return '';
    return action.includes('.') ? action.split('.').pop() || '' : action;
  }

  /**
   * Helper: Escape regex special characters
   */
  private static escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Fix loop item references
   *
   * Converts references like {{step2.data.emails.subject}} to {{item.subject}}
   * inside loop/scatter blocks where step2.data.emails is the array being iterated.
   *
   * This is critical because the executor expects {{item.*}} for iteration variables.
   */
  static fixLoopItemReferences(pilot: any): any {
    const w = PilotNormalizer.deepClone(pilot);

    const parseIterateOver = (iterateOver: string) => {
      const m = iterateOver.match(/^\{\{(step\d+)\.data\.([a-zA-Z0-9_.]+)\}\}$/);
      if (!m) return null;
      return { stepId: m[1], arrayPath: m[2] };
    };

    const fixInString = (s: string, iterateOver: string) => {
      const info = parseIterateOver(iterateOver);
      if (!info) return s;

      const re = new RegExp(
        String.raw`\{\{${PilotNormalizer.escapeRegExp(info.stepId)}\.data\.${PilotNormalizer.escapeRegExp(info.arrayPath)}\.([a-zA-Z0-9_]+)\}\}`,
        'g'
      );
      return s.replace(re, '{{item.$1}}');
    };

    const fixObj = (obj: any, iterateOver: string): any => {
      if (typeof obj === 'string') return fixInString(obj, iterateOver);
      if (Array.isArray(obj)) return obj.map((v) => fixObj(v, iterateOver));
      if (PilotNormalizer.isObject(obj)) {
        const out: any = {};
        for (const [k, v] of Object.entries(obj)) out[k] = fixObj(v, iterateOver);
        return out;
      }
      return obj;
    };

    const walk = (step: any) => {
      if (!PilotNormalizer.isObject(step)) return;

      if (step.type === 'loop' && typeof step.iterateOver === 'string' && Array.isArray(step.loopSteps)) {
        step.loopSteps = step.loopSteps.map((ls: any) => fixObj(ls, step.iterateOver));
        step.loopSteps.forEach(walk);
        return;
      }

      if (Array.isArray(step.loopSteps)) step.loopSteps.forEach(walk);
      if (Array.isArray(step.steps)) step.steps.forEach(walk);
      if (PilotNormalizer.isObject(step.scatter) && Array.isArray(step.scatter.steps)) {
        step.scatter.steps.forEach(walk);
      }
    };

    PilotNormalizer.safeArray(w.workflow_steps).forEach(walk);
    return w;
  }

  /**
   * Fix duplicate step IDs by renumbering nested steps
   *
   * OpenAI sometimes generates workflows where nested steps (inside scatter.steps or loopSteps)
   * have sequential IDs that conflict with top-level steps. For example:
   * - Top-level: step1, step2, step3, step4 (scatter), step5
   * - Nested in step4: step5, step6  ← DUPLICATE! step5 exists at top level too
   *
   * This function renumbers nested steps with unique IDs that won't conflict:
   * - Nested in step4: step4_nest1, step4_nest2
   */
  static fixDuplicateNestedStepIds(pilot: any): any {
    const w = PilotNormalizer.deepClone(pilot);

    // Build a map of old nested IDs → new unique IDs
    const idMap = new Map<string, string>();

    const renumberNestedSteps = (steps: any[], parentId: string, nestIndex: { value: number }) => {
      steps.forEach((step: any) => {
        if (!PilotNormalizer.isObject(step) || !step.id) return;

        // Generate unique ID for this nested step
        const newId = `${parentId}_nest${nestIndex.value++}`;
        if (step.id !== newId) {
          idMap.set(step.id, newId);
          step.id = newId;
        }

        // Recursively renumber deeply nested steps
        if (Array.isArray(step.loopSteps)) {
          renumberNestedSteps(step.loopSteps, newId, { value: 1 });
        }
        if (Array.isArray(step.steps)) {
          renumberNestedSteps(step.steps, newId, { value: 1 });
        }
        if (PilotNormalizer.isObject(step.scatter) && Array.isArray(step.scatter.steps)) {
          renumberNestedSteps(step.scatter.steps, newId, { value: 1 });
        }
      });
    };

    // Process each top-level step's nested steps
    PilotNormalizer.safeArray(w.workflow_steps).forEach((step: any) => {
      if (!PilotNormalizer.isObject(step)) return;

      const parentId = step.id || 'step_unknown';

      if (Array.isArray(step.loopSteps)) {
        renumberNestedSteps(step.loopSteps, parentId, { value: 1 });
      }
      if (Array.isArray(step.steps)) {
        renumberNestedSteps(step.steps, parentId, { value: 1 });
      }
      if (PilotNormalizer.isObject(step.scatter) && Array.isArray(step.scatter.steps)) {
        renumberNestedSteps(step.scatter.steps, parentId, { value: 1 });
      }
    });

    // Update all references to use new nested IDs
    if (idMap.size > 0) {
      const updateRefs = (obj: any): any => {
        if (typeof obj === 'string') {
          let result = obj;
          idMap.forEach((newId, oldId) => {
            const pattern = new RegExp(`\\{\\{${PilotNormalizer.escapeRegExp(oldId)}(\\.|\\})`, 'g');
            result = result.replace(pattern, `{{${newId}$1`);
          });
          return result;
        }
        if (Array.isArray(obj)) {
          return obj.map((item: any) => {
            if (typeof item === 'string' && idMap.has(item)) {
              return idMap.get(item);
            }
            return updateRefs(item);
          });
        }
        if (PilotNormalizer.isObject(obj)) {
          const result: any = {};
          for (const [key, value] of Object.entries(obj)) {
            result[key] = updateRefs(value);
          }
          return result;
        }
        return obj;
      };

      w.workflow_steps = w.workflow_steps.map((s: any) => updateRefs(s));
    }

    return w;
  }

  /**
   * Update step references after renumbering
   *
   * When we renumber steps (e.g., step10 → step9), we must update all references:
   * - {{step10.data.foo}} → {{step9.data.foo}}
   * - dependencies: ["step10"] → ["step9"]
   */
  private static updateStepReferences(obj: any, oldToNewIdMap: Map<string, string>): any {
    if (typeof obj === 'string') {
      // Replace {{stepX.data.*}} references
      let result = obj;
      oldToNewIdMap.forEach((newId, oldId) => {
        const pattern = new RegExp(`\\{\\{${PilotNormalizer.escapeRegExp(oldId)}(\\.|\\})`, 'g');
        result = result.replace(pattern, `{{${newId}$1`);
      });
      return result;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => {
        // Handle dependency arrays specially - they contain step IDs directly
        if (typeof item === 'string' && oldToNewIdMap.has(item)) {
          return oldToNewIdMap.get(item);
        }
        return PilotNormalizer.updateStepReferences(item, oldToNewIdMap);
      });
    }

    if (PilotNormalizer.isObject(obj)) {
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = PilotNormalizer.updateStepReferences(value, oldToNewIdMap);
      }
      return result;
    }

    return obj;
  }

  /**
   * Remove invalid nested step references from top-level steps
   *
   * CRITICAL BUG FIX: OpenAI generates workflows where top-level steps try to reference
   * nested steps inside scatter-gather/loop blocks. This is architecturally invalid because:
   * - Nested steps are scoped inside their parent step
   * - Nested steps execute in parallel for each item (not individually addressable)
   * - gather/collect operations aggregate nested outputs into parent's output
   *
   * This method:
   * 1. Builds map of nested step IDs → parent step IDs
   * 2. Detects top-level steps referencing nested steps
   * 3. Replaces nested step references with parent step references
   *
   * Example fix:
   *   BEFORE: step6 depends on ["step4_nest1"], input: "{{step4_nest1.data.rows}}"
   *   AFTER:  step6 depends on ["step4"], input: "{{step4.data}}"
   */
  static removeInvalidNestedStepReferences(pilot: any): any {
    const w = PilotNormalizer.deepClone(pilot);

    // Build map: nested step ID → parent step ID
    const nestedToParentMap = new Map<string, string>();

    const collectNestedSteps = (steps: any[], parentId: string) => {
      steps.forEach((step: any) => {
        if (!PilotNormalizer.isObject(step) || !step.id) return;

        // Record this as a nested step
        nestedToParentMap.set(step.id, parentId);

        // Recursively collect deeply nested steps
        if (Array.isArray(step.loopSteps)) {
          collectNestedSteps(step.loopSteps, step.id);
        }
        if (Array.isArray(step.steps)) {
          collectNestedSteps(step.steps, step.id);
        }
        if (PilotNormalizer.isObject(step.scatter) && Array.isArray(step.scatter.steps)) {
          collectNestedSteps(step.scatter.steps, step.id);
        }
      });
    };

    // Collect all nested step IDs from scatter-gather and loop structures
    PilotNormalizer.safeArray(w.workflow_steps).forEach((step: any) => {
      if (!PilotNormalizer.isObject(step)) return;

      const parentId = step.id || 'step_unknown';

      if (Array.isArray(step.loopSteps)) {
        collectNestedSteps(step.loopSteps, parentId);
      }
      if (Array.isArray(step.steps)) {
        collectNestedSteps(step.steps, parentId);
      }
      if (PilotNormalizer.isObject(step.scatter) && Array.isArray(step.scatter.steps)) {
        collectNestedSteps(step.scatter.steps, parentId);
      }
    });

    // If no nested steps found, nothing to fix
    if (nestedToParentMap.size === 0) {
      return w;
    }

    console.log('[PilotNormalizer] Found', nestedToParentMap.size, 'nested steps that should not be referenced from top-level');
    console.log('[PilotNormalizer] Nested step → parent map:', Array.from(nestedToParentMap.entries()));

    // Helper: Find the top-level parent of a nested step
    // If step4_nest1_nest1 exists, we need to find step4 (not step4_nest1)
    const findTopLevelParent = (nestedId: string): string => {
      let current = nestedId;
      let parent = nestedToParentMap.get(current);

      while (parent && nestedToParentMap.has(parent)) {
        current = parent;
        parent = nestedToParentMap.get(current);
      }

      return parent || current;
    };

    // Fix references in top-level steps only
    const fixReferences = (obj: any): any => {
      if (typeof obj === 'string') {
        let result = obj;

        // Replace {{nestedStepId.*}} with {{parentStepId.data}}
        nestedToParentMap.forEach((_parentId, nestedId) => {
          const topLevelParent = findTopLevelParent(nestedId);

          // Pattern: {{step4_nest1.data.anything}} → {{step4.data}}
          // Note: We use .data because gather/collect operations put results in parent's data
          const nestedPattern = new RegExp(
            `\\{\\{${PilotNormalizer.escapeRegExp(nestedId)}\\.data(?:\\.[a-zA-Z0-9_]+)*\\}\\}`,
            'g'
          );
          result = result.replace(nestedPattern, `{{${topLevelParent}.data}}`);

          // Pattern: {{step4_nest1}} → {{step4.data}}
          const directPattern = new RegExp(
            `\\{\\{${PilotNormalizer.escapeRegExp(nestedId)}\\}\\}`,
            'g'
          );
          result = result.replace(directPattern, `{{${topLevelParent}.data}}`);
        });

        return result;
      }

      if (Array.isArray(obj)) {
        return obj.map(item => {
          // Handle dependency arrays - replace nested step IDs with parent IDs
          if (typeof item === 'string' && nestedToParentMap.has(item)) {
            const topLevelParent = findTopLevelParent(item);
            console.log(`[PilotNormalizer] Replacing dependency "${item}" with "${topLevelParent}"`);
            return topLevelParent;
          }
          return fixReferences(item);
        });
      }

      if (PilotNormalizer.isObject(obj)) {
        const result: any = {};
        for (const [key, value] of Object.entries(obj)) {
          result[key] = fixReferences(value);
        }
        return result;
      }

      return obj;
    };

    // Apply fixes only to top-level workflow steps
    // Do NOT fix references inside nested steps (they may legitimately reference siblings)
    w.workflow_steps = w.workflow_steps.map((step: any) => {
      if (!PilotNormalizer.isObject(step)) return step;

      // Only fix if this is a top-level step (not a nested step)
      if (!nestedToParentMap.has(step.id)) {
        return fixReferences(step);
      }

      return step;
    });

    console.log('[PilotNormalizer] ✓ Removed invalid nested step references from top-level steps');
    return w;
  }

  /**
   * Normalize PILOT DSL workflow
   *
   * Critical normalization steps:
   * 1. Force sequential top-level step IDs (step1, step2, step3...)
   * 2. UPDATE ALL REFERENCES to match new step IDs
   * 3. Remove plugin/action/params from non-action steps
   * 4. Ensure required arrays/objects exist for loop/scatter steps
   * 5. Normalize action names (remove plugin prefix)
   * 6. Set default values for missing fields
   *
   * This function is CRITICAL - without it, workflows have:
   * - Non-sequential IDs that break execution
   * - Illegal fields that break validation
   * - Missing required structures that cause runtime errors
   */
  static normalizePilot(pilot: any, services: string[]): any {
    // STEP 0: Fix duplicate nested step IDs FIRST (before any other normalization)
    // OpenAI may generate nested steps with IDs that conflict with top-level steps
    let w = PilotNormalizer.fixDuplicateNestedStepIds(pilot);

    // STEP 0.5: Remove invalid nested step references
    // CRITICAL FIX: OpenAI generates top-level steps that reference nested steps
    // This is architecturally invalid - nested steps are scoped inside their parents
    w = PilotNormalizer.removeInvalidNestedStepReferences(w);

    if (!Array.isArray(w.suggested_plugins) || w.suggested_plugins.length === 0) {
      w.suggested_plugins = services;
    }
    if (!Array.isArray(w.workflow_steps)) w.workflow_steps = [];

    // CRITICAL: Build old ID → new ID mapping BEFORE renumbering
    // MUST add ALL mappings, even if ID is already correct, to ensure references are updated
    const oldToNewIdMap = new Map<string, string>();
    w.workflow_steps.forEach((s: any, idx: number) => {
      if (PilotNormalizer.isObject(s) && s.id) {
        const newId = `step${idx + 1}`;
        // Always add to map, even if ID matches - other steps may reference this ID
        oldToNewIdMap.set(s.id, newId);
      }
    });

    w.workflow_steps = w.workflow_steps.map((s: any, idx: number) => {
      if (!PilotNormalizer.isObject(s)) return s;

      // Force sequential IDs
      s.id = `step${idx + 1}`;

      // Ensure required fields exist
      if (!Array.isArray(s.dependencies)) s.dependencies = [];
      if (typeof s.name !== 'string' || !s.name.trim()) s.name = s.id;
      if (typeof s.type !== 'string' || !s.type.trim()) s.type = 'ai_processing';
      if (typeof s.description !== 'string') s.description = '';
      if (typeof s.continueOnError !== 'boolean') s.continueOnError = false;

      // Type-specific normalization
      if (s.type === 'action') {
        s.action = PilotNormalizer.normalizePluginAction(s.action);
        if (typeof s.plugin !== 'string') s.plugin = '';
        if (!PilotNormalizer.isObject(s.params)) s.params = {};
        // Remove illegal AI keys if present
        if ('prompt' in s) delete s.prompt;
      } else {
        // Non-action steps: remove plugin/action/params
        if ('plugin' in s) delete s.plugin;
        if ('action' in s) delete s.action;
        if ('params' in s) delete s.params;

        if (s.type === 'ai_processing') {
          if (typeof s.prompt !== 'string') s.prompt = '';
        }
      }

      // Loop-specific normalization
      if (s.type === 'loop') {
        if (typeof s.iterateOver !== 'string') s.iterateOver = '';
        if (!Array.isArray(s.loopSteps)) s.loopSteps = [];
      }

      // Scatter-gather specific normalization
      if (s.type === 'scatter_gather') {
        if (!PilotNormalizer.isObject(s.scatter)) {
          s.scatter = { input: '', itemVariable: 'item', steps: [] };
        }
        if (typeof s.scatter.input !== 'string') s.scatter.input = '';
        if (typeof s.scatter.itemVariable !== 'string') s.scatter.itemVariable = 'item';
        if (!Array.isArray(s.scatter.steps)) s.scatter.steps = [];
        if (!PilotNormalizer.isObject(s.gather)) s.gather = { operation: 'collect' };
        if (typeof s.gather.operation !== 'string') s.gather.operation = 'collect';
      }

      return s;
    });

    // CRITICAL: Update all step references to match new IDs
    if (oldToNewIdMap.size > 0) {
      w.workflow_steps = w.workflow_steps.map((s: any) =>
        PilotNormalizer.updateStepReferences(s, oldToNewIdMap)
      );
    }

    return PilotNormalizer.fixLoopItemReferences(w);
  }

  /**
   * Stable response envelope
   *
   * Ensures consistent response structure for UI compatibility.
   * ALWAYS returns workflow.workflow as an iterable array.
   */
  static stableResponseEnvelope(partial?: any): any {
    const workflow_steps = PilotNormalizer.safeArray(partial?.workflow?.workflow_steps);
    return {
      success: Boolean(partial?.success),
      workflow: {
        ...(partial?.workflow || {}),
        workflow_steps,
        workflow: workflow_steps, // legacy compatibility: ALWAYS iterable
      },
      validation:
        partial?.validation || { valid: false, issues: [], autoFixed: false, issueCount: 0 },
      semantic_plan: partial?.semantic_plan,
      method: partial?.method,
      model: partial?.model,
      services_used: partial?.services_used,
      prompt_length: partial?.prompt_length,
      error: partial?.error,
      debug: partial?.debug,
    };
  }
}
