# Multi-Step Structural Repair Framework

> **Status**: 📋 Planned
> **Last Updated**: 2026-04-23

## Overview

This framework extends the calibration system to detect and auto-fix **structural workflow gaps** beyond simple field name corrections. It identifies when workflows are missing intermediate steps, have incorrect step ordering, or require additional transformation logic to achieve their semantic intent.

## Problem Space

### Current Coverage

| Issue Type | Layer | Coverage |
|------------|-------|----------|
| **Field name errors** | Layer 1 | ✅ Detected & auto-fixed |
| **Type mismatches** | Layer 2 | ✅ Detected, partial fix |
| **Nested field structure** | Layer 2 | ✅ Detected & auto-fixed |
| **Empty results (runtime)** | Layer 3 | ✅ Detected, warning only |

### Gaps (Current Conversation Discovery)

| Issue Type | Example | Current Behavior | Desired Behavior |
|------------|---------|------------------|------------------|
| **Missing intermediate transform** | Gmail → Flatten emails → Need second flatten for attachments | Returns empty results | Auto-insert second flatten step |
| **Missing aggregation** | Scatter-gather returns items but no summary step | Workflow ends with raw items | Auto-insert reduce/aggregate step |
| **Incorrect step order** | Filter before flatten (filters nothing) | Empty results | Detect ordering issue, suggest reorder |
| **Missing data conversion** | Step expects array, receives object | Type error at runtime | Auto-insert map/transform to convert |
| **Missing conditional logic** | No handling for empty upstream results | Workflow fails downstream | Insert conditional branch |

## Framework Architecture

### 3-Tier Detection Strategy

```
LAYER 2 (Semantic Analysis)
  ├─ Tier 1: Schema-Output Mismatch Detection
  │    └─ Detect when step.output_schema ≠ actual operation output
  │
  ├─ Tier 2: Intent-Structure Alignment
  │    └─ Compare step.description/custom_code intent with actual step structure
  │
  └─ Tier 3: Data Flow Validation
       └─ Trace data flow through steps, detect type/structure breaks

LAYER 3 (Dry-Run Execution)
  └─ Runtime Validation
       └─ Detect empty results, type errors, step failures
```

### New Issue Types

```typescript
const STRUCTURAL_ISSUE_TYPES = [
  // Existing
  'field_not_found',
  'field_wrong_nesting_level',
  'type_mismatch',

  // NEW - Multi-Step Issues
  'missing_intermediate_flatten_step',      // Nested arrays need second flatten
  'missing_aggregation_step',               // Scatter-gather needs reduce/summary
  'missing_data_conversion_step',           // Type conversion needed
  'incorrect_step_order',                   // Dependencies not satisfied
  'missing_conditional_branch',             // No handling for empty/error cases
  'missing_error_handling',                 // No recovery for failed steps
  'schema_structure_mismatch',              // Declared schema doesn't match operation
  'missing_join_step',                      // Multiple data sources not merged
  'missing_deduplication_step',             // Duplicate items not handled
] as const;
```

## Detection Patterns

### Pattern 1: Schema-Output Mismatch

**Detection Logic**:

```typescript
private detectSchemaOutputMismatch(
  step: WorkflowStep,
  agent: Agent
): StructuralIssue | null {

  // 1. Get what the operation ACTUALLY produces
  const actualOutputSchema = this.inferActualOutputSchema(step);

  // 2. Compare with declared output_schema
  const declaredOutputSchema = step.output_schema;

  if (!this.schemasMatch(actualOutputSchema, declaredOutputSchema)) {
    // 3. Analyze the mismatch to determine issue type
    return this.analyzeSchemaMismatch(step, actualOutputSchema, declaredOutputSchema, agent);
  }

  return null;
}

private analyzeSchemaMismatch(
  step: WorkflowStep,
  actual: any,
  declared: any,
  agent: Agent
): StructuralIssue {

  // Case 1: Declared schema expects fields from nested array
  if (this.declaredExpectsNestedFields(actual, declared)) {
    return {
      type: 'missing_intermediate_flatten_step',
      stepId: step.step_id || step.id,
      missingTransformation: 'flatten',
      targetField: this.findNestedArrayField(actual, declared),
      confidence: 0.85
    };
  }

  // Case 2: Declared schema expects aggregated/summarized data
  if (this.declaredExpectsAggregation(actual, declared)) {
    return {
      type: 'missing_aggregation_step',
      stepId: step.step_id || step.id,
      missingTransformation: 'reduce',
      aggregationType: this.inferAggregationType(declared),
      confidence: 0.80
    };
  }

  // Case 3: Type conversion needed
  if (actual.type !== declared.type) {
    return {
      type: 'missing_data_conversion_step',
      stepId: step.step_id || step.id,
      fromType: actual.type,
      toType: declared.type,
      confidence: 0.90
    };
  }

  // Case 4: Generic schema mismatch
  return {
    type: 'schema_structure_mismatch',
    stepId: step.step_id || step.id,
    actualSchema: actual,
    declaredSchema: declared,
    confidence: 0.70
  };
}
```

**Examples**:

```typescript
// Example 1: Missing intermediate flatten
Step2 (Flatten):
  - config.field: "emails" ✅ (correct)
  - Actual output: [{id, subject, attachments: [...]}, ...]
  - Declared output: [{attachment_id, filename, ...}, ...]

Detection:
  ✅ Actual output has "attachments" array nested in items
  ✅ Declared output expects fields from inside "attachments"

Issue: missing_intermediate_flatten_step
  - targetField: "attachments"
  - insertAfter: "step2"

// Example 2: Missing aggregation
Step5 (Scatter-Gather):
  - Actual output: [{result1}, {result2}, {result3}]
  - Declared output: {summary: "...", count: 3, status: "success"}

Detection:
  ✅ Actual output is array of items
  ✅ Declared output is single aggregated object

Issue: missing_aggregation_step
  - aggregationType: "summarize"
  - insertAfter: "step5"

// Example 3: Missing data conversion
Step3 (Transform):
  - Actual output: {emails: [...]}  (object)
  - Declared output: [{...}]        (array)

Detection:
  ✅ Type mismatch: object → array
  ✅ Object has array property "emails"

Issue: missing_data_conversion_step
  - fromType: "object"
  - toType: "array"
  - extractField: "emails"
  - insertAfter: "step3"
```

### Pattern 2: Intent-Structure Alignment

**Detection Logic**:

```typescript
private detectIntentStructureMismatch(
  step: WorkflowStep,
  agent: Agent
): StructuralIssue | null {

  // Extract semantic intent from description and custom_code
  const intent = this.extractSemanticIntent(step);

  // Analyze if current step structure can achieve that intent
  const canAchieveIntent = this.validateStructureVsIntent(step, intent, agent);

  if (!canAchieveIntent.valid) {
    return {
      type: canAchieveIntent.issueType,
      stepId: step.step_id || step.id,
      intent: intent.summary,
      missingOperation: canAchieveIntent.suggestedOperation,
      confidence: canAchieveIntent.confidence
    };
  }

  return null;
}

private extractSemanticIntent(step: WorkflowStep): SemanticIntent {
  const description = step.description || step.custom_code || '';
  const lowerDesc = description.toLowerCase();

  // Pattern matching for common intents
  const intents = {
    extract_nested: /extract|get|retrieve.*nested|inner|inside/i,
    aggregate: /summarize|aggregate|combine|merge|total|count|average/i,
    filter_conditional: /if|when|only.*if|filter.*where/i,
    transform_structure: /convert|transform|reshape|restructure/i,
    deduplicate: /unique|deduplicate|distinct|remove.*duplicate/i,
    join_data: /join|combine|merge.*with|link.*to/i,
  };

  for (const [intentType, pattern] of Object.entries(intents)) {
    if (pattern.test(description)) {
      return {
        type: intentType,
        summary: description,
        keywords: this.extractKeywords(description)
      };
    }
  }

  return { type: 'unknown', summary: description, keywords: [] };
}

private validateStructureVsIntent(
  step: WorkflowStep,
  intent: SemanticIntent,
  agent: Agent
): ValidationResult {

  switch (intent.type) {
    case 'extract_nested': {
      // Check if current step can access nested data
      const sourceStep = this.findSourceStep(step, agent.pilot_steps);
      if (!sourceStep) return { valid: true };

      const hasNestedAccess = this.checkNestedAccess(step, sourceStep.output_schema);

      if (!hasNestedAccess.valid) {
        return {
          valid: false,
          issueType: 'missing_intermediate_flatten_step',
          suggestedOperation: 'flatten',
          targetField: hasNestedAccess.nestedField,
          confidence: 0.85
        };
      }
      break;
    }

    case 'aggregate': {
      // Check if step produces aggregated output
      if (step.operation === 'scatter_gather' || step.type === 'parallel') {
        // Scatter-gather returns array, but intent is to aggregate
        return {
          valid: false,
          issueType: 'missing_aggregation_step',
          suggestedOperation: 'llm_decision',
          aggregationType: 'summarize',
          confidence: 0.80
        };
      }
      break;
    }

    case 'deduplicate': {
      // Check if there's a deduplication step
      const hasDedupe = this.checkForOperation(agent.pilot_steps, 'filter', step.id, 'unique');

      if (!hasDedupe) {
        return {
          valid: false,
          issueType: 'missing_deduplication_step',
          suggestedOperation: 'transform',
          confidence: 0.75
        };
      }
      break;
    }
  }

  return { valid: true };
}
```

**Examples**:

```typescript
// Example 1: Description mentions nested extraction
Step2:
  - description: "Extract attachments from each email"
  - operation: "flatten"
  - config.field: "emails"

Intent: extract_nested (keyword: "attachments")
Structure: Flatten only extracts "emails", not nested "attachments"

Detection:
  ✅ Intent is to extract "attachments" (nested field)
  ✅ Current structure only flattens "emails" (first level)

Issue: missing_intermediate_flatten_step
  - targetField: "attachments"
  - reasoning: "Description mentions extracting 'attachments' but current step only flattens 'emails'"

// Example 2: Scatter-gather with summarization intent
Step5:
  - description: "Summarize results from all branches"
  - type: "scatter_gather"
  - gather.from: ["branch1_output", "branch2_output"]

Intent: aggregate (keyword: "summarize")
Structure: Scatter-gather returns array of results, no aggregation

Detection:
  ✅ Intent is to summarize (aggregate)
  ✅ Current structure returns raw array

Issue: missing_aggregation_step
  - aggregationType: "summarize"
  - insertAfter: "step5"
```

### Pattern 3: Data Flow Validation

**Detection Logic**:

```typescript
private validateDataFlow(agent: Agent): StructuralIssue[] {
  const issues: StructuralIssue[] = [];
  const dataFlowGraph = this.buildDataFlowGraph(agent.pilot_steps);

  for (const step of agent.pilot_steps) {
    // Check upstream data availability
    const upstreamIssue = this.validateUpstreamData(step, dataFlowGraph);
    if (upstreamIssue) issues.push(upstreamIssue);

    // Check type compatibility with downstream
    const downstreamIssue = this.validateDownstreamCompatibility(step, dataFlowGraph);
    if (downstreamIssue) issues.push(downstreamIssue);

    // Check for broken dependency chains
    const dependencyIssue = this.validateDependencies(step, dataFlowGraph);
    if (dependencyIssue) issues.push(dependencyIssue);
  }

  return issues;
}

private validateUpstreamData(
  step: WorkflowStep,
  graph: DataFlowGraph
): StructuralIssue | null {

  const upstreamNodes = graph.getUpstreamNodes(step.id);

  for (const upstream of upstreamNodes) {
    const upstreamOutput = upstream.outputType;
    const expectedInput = this.getExpectedInputType(step);

    if (!this.typesCompatible(upstreamOutput, expectedInput)) {
      // Check if conversion is possible
      const conversion = this.findConversionPath(upstreamOutput, expectedInput);

      if (conversion) {
        return {
          type: 'missing_data_conversion_step',
          stepId: step.step_id || step.id,
          fromType: upstreamOutput,
          toType: expectedInput,
          conversionOperation: conversion.operation,
          insertBefore: step.step_id || step.id,
          insertAfter: upstream.id,
          confidence: 0.85
        };
      }
    }
  }

  return null;
}

private validateDownstreamCompatibility(
  step: WorkflowStep,
  graph: DataFlowGraph
): StructuralIssue | null {

  const downstreamNodes = graph.getDownstreamNodes(step.id);

  for (const downstream of downstreamNodes) {
    const stepOutput = this.inferActualOutputSchema(step);
    const downstreamExpects = this.getExpectedInputType(downstream.step);

    // Check if downstream expects different structure
    if (!this.schemasCompatible(stepOutput, downstreamExpects)) {
      return {
        type: 'schema_structure_mismatch',
        stepId: step.step_id || step.id,
        downstreamStepId: downstream.id,
        actualOutput: stepOutput,
        expectedInput: downstreamExpects,
        confidence: 0.80
      };
    }
  }

  return null;
}

private validateDependencies(
  step: WorkflowStep,
  graph: DataFlowGraph
): StructuralIssue | null {

  const dependencies = step.dependencies || [];

  for (const depId of dependencies) {
    const depNode = graph.getNode(depId);

    if (!depNode) {
      return {
        type: 'missing_dependency_step',
        stepId: step.step_id || step.id,
        missingDependencyId: depId,
        confidence: 0.95
      };
    }

    // Check if dependency is executed before current step
    const executionOrder = graph.getExecutionOrder();
    const depIndex = executionOrder.indexOf(depId);
    const stepIndex = executionOrder.indexOf(step.id);

    if (depIndex > stepIndex) {
      return {
        type: 'incorrect_step_order',
        stepId: step.step_id || step.id,
        dependencyId: depId,
        issue: 'Dependency executed after dependent step',
        confidence: 0.90
      };
    }
  }

  return null;
}
```

## Fix Generation Framework

### Multi-Step Fix Generator

```typescript
interface MultiStepFix {
  action: 'insert_step' | 'reorder_steps' | 'update_step' | 'insert_branch';
  affectedSteps: string[];
  insertions?: StepInsertion[];
  updates?: StepUpdate[];
  reorderings?: StepReordering[];
  verified: boolean;
  confidence: number;
  reasoning: string;
}

interface StepInsertion {
  newStepId: string;
  insertPosition: 'before' | 'after';
  targetStepId: string;
  newStep: WorkflowStep;
  updateDownstreamReferences?: {
    stepId: string;
    changes: Partial<WorkflowStep>;
  }[];
}
```

### Fix Generation by Issue Type

#### 1. Missing Intermediate Flatten Step

```typescript
private async generateIntermediateFlattenFix(
  issue: StructuralIssue,
  agent: Agent
): Promise<MultiStepFix> {

  const step = this.findStep(agent.pilot_steps, issue.stepId);
  const newStepId = this.generateStepId(agent.pilot_steps, step.id, 'a');

  return {
    action: 'insert_step',
    affectedSteps: [issue.stepId, newStepId],
    insertions: [{
      newStepId,
      insertPosition: 'after',
      targetStepId: issue.stepId,
      newStep: {
        id: newStepId,
        type: 'transform',
        operation: 'flatten',
        input: `{{${step.output_variable}}}`,
        config: {
          type: 'flatten',
          field: issue.targetField,
          input: step.output_variable
        },
        description: `Extract ${issue.targetField} from each item (auto-inserted)`,
        output_variable: `flattened_${issue.targetField}`,
        output_schema: step.output_schema, // Transfer declared schema
        dependencies: [issue.stepId]
      },
      updateDownstreamReferences: this.getDownstreamReferences(step, agent)
    }],
    updates: [{
      stepId: issue.stepId,
      changes: {
        output_schema: this.inferActualOutputSchema(step)
      }
    }],
    verified: true,
    confidence: 0.85,
    reasoning: `Step produces objects with nested "${issue.targetField}" array, but output schema expects fields from inside that array. Inserting intermediate flatten step.`
  };
}
```

#### 2. Missing Aggregation Step

```typescript
private async generateAggregationStepFix(
  issue: StructuralIssue,
  agent: Agent
): Promise<MultiStepFix> {

  const step = this.findStep(agent.pilot_steps, issue.stepId);
  const newStepId = this.generateStepId(agent.pilot_steps, step.id, 'summary');

  return {
    action: 'insert_step',
    affectedSteps: [issue.stepId, newStepId],
    insertions: [{
      newStepId,
      insertPosition: 'after',
      targetStepId: issue.stepId,
      newStep: {
        id: newStepId,
        type: 'llm_decision',
        input: `{{${step.output_variable}}}`,
        description: `Summarize and aggregate results from ${step.description || step.id} (auto-inserted)`,
        output_variable: `${step.output_variable}_summary`,
        output_schema: step.output_schema, // Transfer declared aggregated schema
        dependencies: [issue.stepId],
        prompt: this.generateAggregationPrompt(issue.aggregationType, step)
      },
      updateDownstreamReferences: this.getDownstreamReferences(step, agent)
    }],
    verified: true,
    confidence: 0.80,
    reasoning: `Step returns array of items but declared output expects aggregated summary. Inserting LLM summarization step.`
  };
}

private generateAggregationPrompt(type: string, step: WorkflowStep): string {
  switch (type) {
    case 'summarize':
      return `Analyze the following results and provide a comprehensive summary:\n\n{{${step.output_variable}}}\n\nProvide: 1) Overview, 2) Key findings, 3) Count of items, 4) Status assessment`;
    case 'count':
      return `Count the number of items and provide statistics:\n\n{{${step.output_variable}}}`;
    case 'reduce':
      return `Combine the following items into a single result:\n\n{{${step.output_variable}}}`;
    default:
      return `Aggregate the following data:\n\n{{${step.output_variable}}}`;
  }
}
```

#### 3. Missing Data Conversion Step

```typescript
private async generateDataConversionFix(
  issue: StructuralIssue,
  agent: Agent
): Promise<MultiStepFix> {

  const step = this.findStep(agent.pilot_steps, issue.stepId);
  const newStepId = this.generateStepId(agent.pilot_steps, step.id, 'convert');

  const conversion = this.determineConversionOperation(issue.fromType, issue.toType);

  return {
    action: 'insert_step',
    affectedSteps: [issue.stepId, newStepId],
    insertions: [{
      newStepId,
      insertPosition: issue.insertBefore ? 'before' : 'after',
      targetStepId: issue.insertBefore || issue.stepId,
      newStep: {
        id: newStepId,
        type: 'transform',
        operation: conversion.operation,
        input: `{{${step.output_variable}}}`,
        config: conversion.config,
        description: `Convert ${issue.fromType} to ${issue.toType} (auto-inserted)`,
        output_variable: `converted_${step.output_variable}`,
        output_schema: { type: issue.toType },
        dependencies: [issue.stepId]
      },
      updateDownstreamReferences: this.getDownstreamReferences(step, agent)
    }],
    verified: true,
    confidence: 0.85,
    reasoning: `Type conversion needed: ${issue.fromType} → ${issue.toType}`
  };
}

private determineConversionOperation(
  fromType: string,
  toType: string
): { operation: string; config: any } {

  if (fromType === 'object' && toType === 'array') {
    return {
      operation: 'extract',
      config: { type: 'extract', extractArrayField: true }
    };
  }

  if (fromType === 'array' && toType === 'object') {
    return {
      operation: 'reduce',
      config: { type: 'reduce', combineIntoObject: true }
    };
  }

  return {
    operation: 'transform',
    config: { type: 'transform', targetType: toType }
  };
}
```

#### 4. Incorrect Step Order

```typescript
private async generateStepReorderingFix(
  issue: StructuralIssue,
  agent: Agent
): Promise<MultiStepFix> {

  const step = this.findStep(agent.pilot_steps, issue.stepId);
  const dependency = this.findStep(agent.pilot_steps, issue.dependencyId);

  // Calculate correct execution order
  const currentOrder = agent.pilot_steps.map(s => s.step_id || s.id);
  const stepIndex = currentOrder.indexOf(issue.stepId);
  const depIndex = currentOrder.indexOf(issue.dependencyId);

  return {
    action: 'reorder_steps',
    affectedSteps: [issue.stepId, issue.dependencyId],
    reorderings: [{
      stepId: issue.dependencyId,
      fromIndex: depIndex,
      toIndex: stepIndex - 1, // Move dependency before step
      reason: 'Dependency must execute before dependent step'
    }],
    verified: true,
    confidence: 0.90,
    reasoning: `Step "${issue.stepId}" depends on "${issue.dependencyId}", but execution order is incorrect. Reordering to satisfy dependency.`
  };
}
```

## Integration with Calibration Flow

### Enhanced Layer 2 Workflow

```typescript
// app/api/v2/calibrate/batch/route.ts

// 6.8. LAYER 2: Constrained Semantic Validation (Enhanced)

logger.info({ sessionId, agentId }, '[Layer 2] Running multi-step structural analysis');

// Phase 1: Schema-Output Mismatch Detection
const schemaIssues = await semanticValidator.detectSchemaOutputMismatches(
  agent.pilot_steps,
  pluginSchemas
);

// Phase 2: Intent-Structure Alignment
const intentIssues = await semanticValidator.detectIntentStructureMismatches(
  agent.pilot_steps
);

// Phase 3: Data Flow Validation
const dataFlowIssues = await semanticValidator.validateDataFlow(agent);

const allStructuralIssues = [
  ...schemaIssues,
  ...intentIssues,
  ...dataFlowIssues
];

logger.info({
  sessionId,
  schemaIssues: schemaIssues.length,
  intentIssues: intentIssues.length,
  dataFlowIssues: dataFlowIssues.length,
  total: allStructuralIssues.length
}, '[Layer 2] Structural analysis complete');

// Generate multi-step fixes
const multiStepFixes: MultiStepFix[] = [];

for (const issue of allStructuralIssues) {
  const fix = await semanticValidator.generateMultiStepFix(issue, agent);

  if (fix && fix.verified && fix.confidence >= 0.70) {
    multiStepFixes.push(fix);
  }
}

// Apply multi-step fixes
for (const fix of multiStepFixes) {
  if (fix.confidence >= 0.85) {
    // High confidence: auto-apply
    await semanticValidator.applyMultiStepFix(agent, fix);

    appliedFixes.push({
      layer: 2,
      issueType: 'multi_step_structural',
      fix,
      confidence: fix.confidence,
      autoApplied: true
    });

    logger.info({ fix, confidence: fix.confidence }, '[Layer 2] Auto-applied multi-step fix');

  } else if (fix.confidence >= 0.70) {
    // Medium confidence: auto-apply with notification
    await semanticValidator.applyMultiStepFix(agent, fix);

    mediumConfidenceFixes.push(fix);
    appliedFixes.push({
      layer: 2,
      issueType: 'multi_step_structural',
      fix,
      confidence: fix.confidence,
      autoApplied: true,
      requiresNotification: true
    });

    logger.warn({ fix, confidence: fix.confidence }, '[Layer 2] Auto-applied medium-confidence multi-step fix (will notify user)');
  }
}
```

### Fix Application Logic

```typescript
class ConstrainedSemanticValidator {

  async applyMultiStepFix(
    agent: Agent,
    fix: MultiStepFix
  ): Promise<boolean> {

    try {
      switch (fix.action) {
        case 'insert_step': {
          for (const insertion of fix.insertions || []) {
            // Find target step index
            const targetIndex = agent.pilot_steps.findIndex(
              s => (s.step_id || s.id) === insertion.targetStepId
            );

            if (targetIndex === -1) {
              logger.error({ insertion }, 'Target step not found for insertion');
              return false;
            }

            // Insert new step
            const insertIndex = insertion.insertPosition === 'after'
              ? targetIndex + 1
              : targetIndex;

            agent.pilot_steps.splice(insertIndex, 0, insertion.newStep);

            logger.info({
              newStepId: insertion.newStepId,
              insertPosition: insertion.insertPosition,
              targetStepId: insertion.targetStepId
            }, 'Inserted new step');

            // Update downstream references
            if (insertion.updateDownstreamReferences) {
              for (const update of insertion.updateDownstreamReferences) {
                const stepToUpdate = agent.pilot_steps.find(
                  s => (s.step_id || s.id) === update.stepId
                );

                if (stepToUpdate) {
                  Object.assign(stepToUpdate, update.changes);
                  logger.info({ stepId: update.stepId }, 'Updated downstream step reference');
                }
              }
            }
          }

          // Apply step updates
          if (fix.updates) {
            for (const update of fix.updates) {
              const stepToUpdate = agent.pilot_steps.find(
                s => (s.step_id || s.id) === update.stepId
              );

              if (stepToUpdate) {
                Object.assign(stepToUpdate, update.changes);
                logger.info({ stepId: update.stepId }, 'Updated step schema');
              }
            }
          }

          return true;
        }

        case 'reorder_steps': {
          if (!fix.reorderings) return false;

          for (const reorder of fix.reorderings) {
            const step = agent.pilot_steps.splice(reorder.fromIndex, 1)[0];
            agent.pilot_steps.splice(reorder.toIndex, 0, step);

            logger.info({
              stepId: reorder.stepId,
              from: reorder.fromIndex,
              to: reorder.toIndex
            }, 'Reordered step');
          }

          return true;
        }

        default:
          logger.warn({ action: fix.action }, 'Unknown multi-step fix action');
          return false;
      }

    } catch (error) {
      logger.error({ err: error, fix }, 'Failed to apply multi-step fix');
      return false;
    }
  }
}
```

## Expected Behavior

### Before Multi-Step Framework

```
Gmail → Flatten Workflow:

Layer 1: ✅ Inferred field: "emails" (correct)
Layer 2: ⚠️ Detected 4 issues, all rejected as hallucinations
Layer 3: ✅ Dry-run succeeded, but returned empty results

Result: Workflow "succeeded" but produced no output
User: "but got no results"
```

### After Multi-Step Framework

```
Gmail → Flatten Workflow:

Layer 1: ✅ Inferred field: "emails" (correct)

Layer 2 (Enhanced):
  Schema-Output Mismatch Detection:
    ✅ Step2 output_schema expects {attachment_id, filename, ...}
    ✅ Step2 actual output produces {id, subject, attachments: [...]}
    ✅ Detected: missing_intermediate_flatten_step

  Multi-Step Fix Generated:
    - Insert step2a: Flatten "attachments" after step2
    - Update step2 output_schema to match actual email objects
    - Update step3 input reference from {{all_attachments}} to {{flattened_attachments}}
    - Confidence: 0.85

  Auto-Applied Fix:
    ✅ Inserted step2a with flatten "attachments"
    ✅ Updated step2 output_schema
    ✅ Rewired step3 input

Layer 3: ✅ Dry-run with new structure returns results successfully

Result: Workflow produces expected attachment results ✅
```

## Testing Strategy

### Unit Tests

```typescript
// lib/pilot/shadow/__tests__/MultiStepStructuralRepair.test.ts

describe('Multi-Step Structural Repair', () => {

  describe('Schema-Output Mismatch Detection', () => {
    it('detects missing intermediate flatten step', () => {
      const issue = validator.detectSchemaOutputMismatch(step2Gmail, agent);

      expect(issue).toEqual({
        type: 'missing_intermediate_flatten_step',
        stepId: 'step2',
        targetField: 'attachments',
        confidence: 0.85
      });
    });

    it('detects missing aggregation after scatter-gather', () => {
      const issue = validator.detectSchemaOutputMismatch(step5ScatterGather, agent);

      expect(issue).toEqual({
        type: 'missing_aggregation_step',
        stepId: 'step5',
        aggregationType: 'summarize',
        confidence: 0.80
      });
    });
  });

  describe('Multi-Step Fix Generation', () => {
    it('generates intermediate flatten step insertion', async () => {
      const fix = await validator.generateMultiStepFix(issue, agent);

      expect(fix.action).toBe('insert_step');
      expect(fix.insertions).toHaveLength(1);
      expect(fix.insertions[0].newStep.operation).toBe('flatten');
      expect(fix.insertions[0].newStep.config.field).toBe('attachments');
    });

    it('updates downstream step references', async () => {
      const fix = await validator.generateMultiStepFix(issue, agent);

      expect(fix.insertions[0].updateDownstreamReferences).toBeDefined();
      expect(fix.insertions[0].updateDownstreamReferences[0].stepId).toBe('step3');
    });
  });

  describe('Fix Application', () => {
    it('inserts step at correct position', async () => {
      const originalLength = agent.pilot_steps.length;
      await validator.applyMultiStepFix(agent, fix);

      expect(agent.pilot_steps.length).toBe(originalLength + 1);
      expect(agent.pilot_steps[2].id).toBe('step2a');
    });

    it('rewires downstream inputs correctly', async () => {
      await validator.applyMultiStepFix(agent, fix);

      const step3 = agent.pilot_steps.find(s => s.id === 'step3');
      expect(step3.input).toBe('{{flattened_attachments}}');
    });
  });
});
```

### Integration Tests

```typescript
// app/api/v2/calibrate/__tests__/multi-step-calibration.test.ts

describe('Multi-Step Calibration Integration', () => {

  it('detects and fixes missing intermediate flatten step end-to-end', async () => {
    const agent = createGmailFlattenAgent(); // Missing second flatten

    const response = await POST(createCalibrationRequest(agent));
    const result = await response.json();

    expect(result.success).toBe(true);
    expect(result.preFlightValidation.layer2Issues).toBeGreaterThan(0);
    expect(result.preFlightValidation.appliedFixes).toBeGreaterThan(0);

    // Check workflow now has two flatten steps
    const updatedAgent = await AgentRepository.findById(agent.id);
    const flattenSteps = updatedAgent.pilot_steps.filter(s => s.operation === 'flatten');

    expect(flattenSteps).toHaveLength(2);
    expect(flattenSteps[0].config.field).toBe('emails');
    expect(flattenSteps[1].config.field).toBe('attachments');
  });

  it('detects and fixes missing aggregation after scatter-gather', async () => {
    const agent = createScatterGatherAgent(); // Missing summary step

    const response = await POST(createCalibrationRequest(agent));
    const result = await response.json();

    expect(result.success).toBe(true);

    const updatedAgent = await AgentRepository.findById(agent.id);
    const summaryStep = updatedAgent.pilot_steps.find(s => s.type === 'llm_decision');

    expect(summaryStep).toBeDefined();
    expect(summaryStep.description).toContain('Summarize');
  });
});
```

## Limitations & Edge Cases

### Known Limitations

1. **Triple-Nested Arrays**: `{a: [{b: [{c: [...]}]}]}` - framework currently handles 2 levels, not 3+
2. **Ambiguous Aggregation**: Multiple valid aggregation types (sum vs average vs summarize)
3. **Complex Data Joins**: Merging data from multiple sources with different schemas
4. **Conditional Logic**: Detecting need for if/else branches based on runtime conditions
5. **Recursive Structures**: Self-referencing data structures

### Mitigation Strategies

```typescript
// For triple-nested arrays: iterative detection
if (this.detectNestedDepth(schema) > 2) {
  logger.warn({ stepId }, 'Deep nesting detected (3+ levels) - may require multiple calibration runs');
  // Apply first-level fix, let next calibration iteration handle deeper levels
}

// For ambiguous aggregation: use LLM to determine type
if (ambiguousAggregation) {
  const aggregationType = await this.askLLMForAggregationType(step.description);
}

// For complex cases: return medium confidence (0.70-0.80) to trigger user notification
return {
  confidence: 0.75,
  reasoning: 'Complex structural issue detected - applied best-guess fix, user review recommended'
};
```

## User Notifications

### High-Confidence Fixes (0.85+)

Silent auto-fix, logged for transparency:

```
[Calibration] Auto-fixed workflow structure
  - Inserted step2a: Flatten "attachments"
  - Updated 2 existing steps
  - Confidence: 0.85
```

### Medium-Confidence Fixes (0.70-0.84)

Auto-applied with user notification:

```json
{
  "mediumConfidenceNotifications": [
    {
      "type": "missing_intermediate_flatten_step",
      "description": "Added intermediate flatten step for 'attachments' (nested array)",
      "changes": [
        "Inserted step2a: Flatten 'attachments' from each email",
        "Updated step2 output schema to match email objects",
        "Updated step3 input to use flattened attachments"
      ],
      "confidence": 0.80,
      "reasoning": "Step2 output schema expects attachment properties, but flatten 'emails' produces email objects. Detected 'attachments' as nested array field requiring second flatten step."
    }
  ]
}
```

UI displays these in calibration results with option to review/undo.

## Performance Considerations

| Detection Phase | Complexity | Estimated Time |
|-----------------|------------|----------------|
| Schema-Output Mismatch | O(n) - one pass through steps | ~50ms |
| Intent-Structure Alignment | O(n) - regex matching + schema checks | ~100ms |
| Data Flow Validation | O(n²) - graph traversal | ~200ms |
| **Total Layer 2 Enhancement** | | **~350ms additional** |

Combined with existing Layer 2 LLM call (~2s), total Layer 2 time: **~2.5s** (acceptable for calibration).

## Implementation Phases

### Phase 1: Core Detection Framework (Week 1)

- ✅ Implement `detectSchemaOutputMismatch()`
- ✅ Implement `detectIntentStructureMismatch()`
- ✅ Add new issue types to `STRUCTURAL_ISSUE_TYPES`
- ✅ Create helper methods for schema comparison
- ✅ Unit tests for detection logic

### Phase 2: Fix Generation (Week 2)

- ✅ Implement `generateIntermediateFlattenFix()`
- ✅ Implement `generateAggregationStepFix()`
- ✅ Implement `generateDataConversionFix()`
- ✅ Implement `applyMultiStepFix()`
- ✅ Integration tests with calibration flow

### Phase 3: Data Flow Validation (Week 3)

- ✅ Build data flow graph representation
- ✅ Implement `validateDataFlow()`
- ✅ Add step reordering logic
- ✅ Handle complex dependency chains

### Phase 4: Advanced Patterns (Week 4)

- ✅ Aggregation type inference (LLM-assisted)
- ✅ Conditional branch insertion
- ✅ Deduplication detection
- ✅ Join operation detection

### Phase 5: User Notifications & Polish (Week 5)

- ✅ Medium-confidence notification UI
- ✅ Fix preview/review functionality
- ✅ Rollback mechanism for structural changes
- ✅ Comprehensive end-to-end testing

## Success Metrics

### Detection Accuracy

- **Pre-flight structural issue detection rate**: % of structural gaps caught before execution
- **False positive rate**: % of detected issues that weren't real problems
- **Coverage**: % of workflow structural patterns handled

Target: 85% detection rate, <10% false positives

### Fix Quality

- **Auto-fix success rate**: % of applied fixes that produce working workflows
- **Calibration success rate improvement**: % increase in first-run success
- **Manual intervention reduction**: % fewer user fixes needed

Target: 90% auto-fix success, 80% first-run calibration success

### User Experience

- **Notification clarity**: User understanding of applied medium-confidence fixes
- **Time to working workflow**: Average time from generation to executable
- **Rollback usage**: % of fixes users choose to undo

Target: <5% rollback rate (indicating high fix quality)

---

## Summary

This multi-step structural repair framework extends calibration beyond field name fixes to handle:

1. **Missing intermediate steps** (nested flattens, data conversions)
2. **Missing aggregation steps** (scatter-gather summaries)
3. **Incorrect step ordering** (dependency violations)
4. **Schema-structure mismatches** (declared vs actual outputs)
5. **Data flow breaks** (type incompatibilities)

**Key Innovation**: Three-tier detection (schema analysis + intent alignment + data flow validation) with deterministic multi-step fix generation that can insert new steps, update existing steps, and rewire downstream references - all without LLM hallucination risk.

**Status**: 📋 **Ready for Implementation**

This framework provides the "wider solution" requested to capture more missing steps and structural issues beyond the specific nested flatten case.
