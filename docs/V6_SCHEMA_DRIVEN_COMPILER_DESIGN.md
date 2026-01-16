# V6 Schema-Driven Compiler Design

**Date:** 2025-12-31
**Status:** 📋 PROPOSAL
**Problem:** Compiler prompt too complex with scattered examples

---

## Current Problem

The IRToDSLCompiler system prompt has become very complicated:
- Multiple examples for each pattern
- Scattered rules (transform, scatter, variables, etc.)
- LLM must remember ~1000+ lines of instructions
- Easy to miss edge cases
- Hard to maintain as new patterns emerge

**Example of complexity:**
- Transform step examples (lines 732-755)
- Variable reference rules (lines 930-954)
- Transform before action pattern (lines 914-954)
- Deduplication patterns (lines 820-856)
- Plugin field names (lines 863-880)

---

## Root Insight

**We have all the information needed systematically:**

1. **DSL Schema** - Defines valid step structures
2. **Plugin Schemas** - Defines exact params for each action
3. **IR Structure** - Defines semantic intent
4. **Transform Operations** - Enumerated list with signatures

**Current approach:** Teach LLM by examples
**Better approach:** Derive rules from schemas

---

## Proposed Solution: Schema-Driven Compilation

Instead of prompt engineering, use **structured generation** with schema validation.

### Architecture

```
┌─────────────────┐
│ Declarative IR  │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────┐
│ IR → DSL Mapper                 │
│ (Rule-based, NOT LLM)           │
│                                  │
│ Rules derived from:              │
│ - DSL Schema                     │
│ - Plugin Schemas                 │
│ - Transform operation signatures │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────┐
│ PILOT DSL       │
│ (Validated)     │
└─────────────────┘
```

### Phase 1: Rule-Based Mapping (No LLM)

**IR Node Type** → **DSL Step Type** (deterministic)

```typescript
interface MappingRule {
  irNodeType: string;
  dslStepType: string;
  requiredFields: string[];
  paramMapping: Record<string, string>;
  validation: (irNode: any, plugins: any) => ValidationResult;
}

const MAPPING_RULES: MappingRule[] = [
  {
    irNodeType: 'data_source',
    dslStepType: 'action',
    requiredFields: ['plugin', 'action', 'params'],
    paramMapping: {
      'ir.config.query': 'params.query',
      'ir.config.max_results': 'params.max_results',
      // Auto-derive from plugin schema
    },
    validation: (ir, plugins) => validateAgainstPluginSchema(ir, plugins)
  },
  {
    irNodeType: 'filter',
    dslStepType: 'transform',
    requiredFields: ['operation', 'input', 'config'],
    paramMapping: {
      'operation': 'filter',  // constant
      'ir.condition': 'config.condition',
      'ir.source': 'input'
    },
    validation: (ir) => validateFilterCondition(ir.condition)
  },
  {
    irNodeType: 'rendering',
    dslStepType: 'transform',  // NOT action!
    requiredFields: ['operation', 'input', 'config'],
    paramMapping: {
      'operation': 'map',
      'ir.format': 'config.expression'
    },
    validation: (ir) => validateMapExpression(ir.format)
  },
  // ... more rules
];
```

### Phase 2: Plugin Schema Integration

**Auto-generate param mappings from plugin schemas:**

```typescript
function deriveParamMapping(
  irNode: any,
  pluginSchema: PluginSchema
): Record<string, any> {
  const action = pluginSchema.actions[irNode.operation_type];
  const params: Record<string, any> = {};

  // For each required param in plugin schema
  for (const [paramName, paramDef] of Object.entries(action.parameters)) {
    // Find matching field in IR
    const irValue = findMatchingIRField(irNode, paramName, paramDef);

    if (paramDef.type === 'variable_reference') {
      // Must be {{stepX}} reference
      params[paramName] = `{{${irValue}}}`;
    } else if (paramDef.type === 'object') {
      // Nested structure - recurse
      params[paramName] = deriveNestedParams(irValue, paramDef.properties);
    } else {
      // Literal value
      params[paramName] = irValue;
    }
  }

  return params;
}
```

### Phase 3: Transform Before Action Detection

**Automatically insert transform steps when needed:**

```typescript
function compileIRNode(irNode: any, context: CompilationContext): Step[] {
  const steps: Step[] = [];

  // Check if this IR node requires data transformation
  if (requiresTransform(irNode)) {
    // Auto-insert transform step
    const transformStep = {
      id: `step${context.nextId++}`,
      name: `Format data for ${irNode.operation_type}`,
      type: 'transform',
      operation: detectTransformOp(irNode),
      input: irNode.source,
      config: extractTransformConfig(irNode),
      dependencies: [irNode.source]
    };
    steps.push(transformStep);

    // Update IR node to reference transform output
    irNode.source = transformStep.id;
  }

  // Now compile the main action step
  const actionStep = compileActionStep(irNode, context);
  steps.push(actionStep);

  return steps;
}

function requiresTransform(irNode: any): boolean {
  // Check if IR has formatting/rendering/mapping that needs separate step
  if (irNode.type === 'delivery' && irNode.rendering) {
    return true;  // Need to format before sending
  }
  if (irNode.type === 'data_write' && irNode.format) {
    return true;  // Need to format before writing
  }
  return false;
}
```

---

## Benefits of Schema-Driven Approach

### 1. Correctness by Construction
- **Before:** LLM might forget rules, generate invalid structures
- **After:** Impossible to generate invalid DSL (schema-validated)

### 2. Maintainability
- **Before:** Add examples for each new pattern
- **After:** Add rule to mapping table

### 3. Debuggability
- **Before:** "Why did LLM generate this?"
- **After:** "Which rule produced this step?" (traceable)

### 4. Performance
- **Before:** LLM inference for every compilation (slow, expensive)
- **After:** Rule-based transformation (fast, cheap)

### 5. Reliability
- **Before:** Non-deterministic (LLM might vary)
- **After:** Deterministic (same IR → same DSL always)

---

## Implementation Plan

### Step 1: Extract Current Implicit Rules

Analyze current prompt and extract all rules into structured format:

```typescript
// lib/agentkit/v6/compiler/compilation-rules.ts
export const IR_TO_DSL_RULES: CompilationRule[] = [
  {
    name: 'data_source_to_action',
    matches: (ir) => ir.type === 'data_source',
    compile: (ir, context) => ({
      id: context.nextStepId(),
      name: `Fetch data from ${ir.plugin_key}`,
      type: 'action',
      plugin: ir.plugin_key,
      action: ir.operation_type,
      params: mapParams(ir.config, context.getPluginSchema(ir.plugin_key)),
      dependencies: []
    })
  },
  // ... more rules
];
```

### Step 2: Build Rule Engine

```typescript
class RuleBasedCompiler {
  constructor(
    private rules: CompilationRule[],
    private pluginSchemas: Record<string, PluginSchema>
  ) {}

  compile(ir: DeclarativeIR): PILOTWorkflow {
    const context = new CompilationContext(this.pluginSchemas);
    const steps: Step[] = [];

    // Process each IR node
    for (const irNode of ir.nodes) {
      // Find matching rule
      const rule = this.rules.find(r => r.matches(irNode));
      if (!rule) {
        throw new Error(`No compilation rule for IR node type: ${irNode.type}`);
      }

      // Apply rule
      const compiledSteps = rule.compile(irNode, context);
      steps.push(...compiledSteps);
    }

    // Validate full workflow against DSL schema
    this.validate(steps);

    return { workflow: steps };
  }
}
```

### Step 3: Schema Validation

```typescript
class WorkflowValidator {
  validate(steps: Step[]): ValidationResult {
    const errors: string[] = [];

    for (const step of steps) {
      // Validate against DSL schema
      if (step.type === 'action') {
        this.validateActionStep(step, errors);
      } else if (step.type === 'transform') {
        this.validateTransformStep(step, errors);
      }
      // ... other types
    }

    return { valid: errors.length === 0, errors };
  }

  private validateActionStep(step: ActionStep, errors: string[]) {
    // Must have plugin + action + params
    if (!step.plugin || !step.action || !step.params) {
      errors.push(`Action step ${step.id} missing required fields`);
    }

    // Params must not contain config objects (transform before action pattern)
    if (hasConfigObject(step.params)) {
      errors.push(`Action step ${step.id} has config object in params. Use separate transform step.`);
    }

    // Validate against plugin schema
    const pluginSchema = this.getPluginSchema(step.plugin);
    const actionSchema = pluginSchema.actions[step.action];
    this.validateParams(step.params, actionSchema.parameters, errors);
  }
}
```

---

## Hybrid Approach (Recommended)

Instead of pure rule-based OR pure LLM, use **hybrid**:

### For Deterministic Mappings: Use Rules
- Data source → action step
- Filter → transform (filter operation)
- Rendering → transform (map operation) + action step
- Plugin params mapping

### For Complex Logic: Use LLM with Constraints
- AI operation message construction
- Complex conditional branching
- Deduplication strategies

### Architecture:

```
┌─────────────────┐
│ Declarative IR  │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────┐
│ Rule Engine                 │
│ - Simple mappings           │
│ - Plugin param resolution   │
│ - Transform insertion       │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│ LLM (Constrained)           │
│ - Only for complex logic    │
│ - Structured output format  │
│ - Validated against schema  │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────┐
│ Schema Validator│
│ - DSL compliance│
│ - Param types   │
│ - Dependencies  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ PILOT DSL       │
└─────────────────┘
```

---

## Migration Path

### Phase 1: Keep Current LLM, Add Validation
- Keep IRToDSLCompiler as-is
- Add comprehensive schema validation AFTER LLM generation
- Catch common errors and provide corrections

### Phase 2: Extract Simple Rules
- Move deterministic mappings to rule engine
- Data sources, filters, transforms
- Reduce LLM prompt complexity

### Phase 3: Plugin Schema Integration
- Auto-generate param mappings from plugin schemas
- Remove plugin-specific examples from prompt

### Phase 4: LLM for Complex Logic Only
- Use LLM only where needed
- Structured output with schema constraints
- Full validation pipeline

---

## Immediate Action (Quick Win)

**Add post-compilation validation to catch common errors:**

```typescript
class PostCompilationValidator {
  validate(workflow: PILOTWorkflow): ValidationResult {
    const errors: string[] = [];

    for (const step of workflow.steps) {
      // Check: Transform before action pattern
      if (step.type === 'action' && hasConfigInParams(step.params)) {
        errors.push({
          step: step.id,
          error: 'TRANSFORM_BEFORE_ACTION',
          suggestion: 'Create separate transform step for data formatting',
          autoFix: () => this.splitTransformAndAction(step)
        });
      }

      // Check: Transform has input field
      if (step.type === 'transform' && !step.input) {
        errors.push({
          step: step.id,
          error: 'MISSING_TRANSFORM_INPUT',
          suggestion: 'Add input field with variable reference'
        });
      }

      // Check: Variable references are valid
      const refs = extractVariableReferences(step);
      for (const ref of refs) {
        if (!isValidReference(ref, workflow.steps)) {
          errors.push({
            step: step.id,
            error: 'INVALID_VARIABLE_REFERENCE',
            reference: ref
          });
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  // Auto-fix: Split action step with config into transform + action
  private splitTransformAndAction(step: ActionStep): [TransformStep, ActionStep] {
    const transformStep = {
      id: `${step.id}_format`,
      name: `Format data for ${step.name}`,
      type: 'transform' as const,
      operation: 'map',
      input: detectInputSource(step),
      config: extractConfigFromParams(step.params),
      dependencies: step.dependencies
    };

    const actionStep = {
      ...step,
      params: replaceConfigWithReference(step.params, transformStep.id),
      dependencies: [...step.dependencies, transformStep.id]
    };

    return [transformStep, actionStep];
  }
}
```

---

## Recommendation

1. **Short-term (this week):**
   - Add post-compilation validation with auto-fix suggestions
   - Catch transform-before-action pattern violations
   - Validate transform steps have input fields

2. **Medium-term (next sprint):**
   - Extract simple IR→DSL rules to rule engine
   - Auto-generate plugin param mappings from schemas
   - Reduce LLM prompt to complex logic only

3. **Long-term (next quarter):**
   - Full hybrid architecture
   - LLM only for non-deterministic tasks
   - Schema-driven everything else

---

**This approach:**
- ✅ Reduces prompt complexity
- ✅ Leverages schemas we already have
- ✅ Provides deterministic, correct-by-construction compilation
- ✅ Easy to maintain and extend
- ✅ Catches errors automatically

Would you like me to implement Phase 1 (validation with auto-fix)?
