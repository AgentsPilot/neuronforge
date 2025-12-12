# V4 Intent-Based Architecture Implementation Plan

**Status**: Design Phase
**Goal**: Achieve 98%+ workflow generation success rate by shifting complexity from LLM to deterministic engines
**Approach**: LLM describes intent → Deterministic engine builds perfect structure
**Preservation**: Keep all v2/v3 code intact, create parallel v4 system

---

## 1. Architecture Overview

### Current v3 Architecture (Two-Stage)
```
User Prompt → [LLM: Stage 1 - Structure] → [Deterministic: Stage 2 - Fill Params] → PILOT_DSL_SCHEMA
              └─ Claude Sonnet 4               └─ No LLM, template-based
              └─ 90% failure rate              └─ Works when structure is correct
```

**Problems**:
- LLM generates invalid structures (wrong operators, nested loops, hallucinated actions)
- Schema complexity causes LLM to make mistakes
- 90% failure rate despite extensive prompt engineering

### Proposed v4 Architecture (Intent-Based)
```
User Prompt → [LLM: Intent Parser] → Intent Object → [Deterministic Engine] → PILOT_DSL_SCHEMA
              └─ Claude Sonnet 4                     └─ 5 specialized engines
              └─ Simple, high-level                  └─ Perfect structure guaranteed
              └─ No schema knowledge needed          └─ Schema-aware, validated
```

**Advantages**:
- LLM only describes intent in natural language (simple task)
- All structural complexity handled by deterministic engines
- Perfect schema compliance guaranteed
- Expected success rate: 98%+

---

## 2. Intent Schema Design

### 2.1 Intent Object Format

The LLM will output a simple, natural language intent description:

```typescript
// lib/agentkit/v4/schemas/intent-schema.ts

export interface WorkflowIntent {
  goal: string;                    // High-level goal in natural language
  data_sources: DataSourceIntent[];
  processing_steps: ProcessingIntent[];
  output_destination?: OutputIntent;
  constraints?: ConstraintIntent[];
}

export interface DataSourceIntent {
  what: string;                    // "emails with subject containing 'expense'"
  from: string;                    // "gmail", "google-sheets", "hubspot"
  filters?: string[];              // ["unread emails", "from last 7 days"]
  include?: string[];              // ["attachments", "full body text"]
}

export interface ProcessingIntent {
  action: string;                  // "extract expenses from attachments"
  on_data: string;                 // "email attachments"
  method?: string;                 // "use AI to analyze", "filter by field"
  batch_or_individual?: "batch" | "individual";
}

export interface OutputIntent {
  format: string;                  // "detailed table", "summary report"
  destination?: string;            // "google-sheets", "slack channel"
  fields?: string[];               // ["date", "vendor", "amount"]
}

export interface ConstraintIntent {
  type: "limit" | "filter" | "condition";
  description: string;             // "only expenses over $100"
}
```

### 2.2 Example Intent for Expense Workflow

**User Prompt**: "check my gmail for expenses subject, scan expenses attachments and create detailed table for each expenses with - date&time, vendor, amount, expenses type"

**LLM Output (Intent)**:
```json
{
  "goal": "Extract expense details from Gmail attachments and create a structured table",
  "data_sources": [
    {
      "what": "emails with 'expense' in subject",
      "from": "gmail",
      "filters": ["inbox folder"],
      "include": ["attachments", "attachment content"]
    }
  ],
  "processing_steps": [
    {
      "action": "extract structured data from attachments",
      "on_data": "email attachments",
      "method": "use AI to analyze",
      "batch_or_individual": "batch"
    }
  ],
  "output_destination": {
    "format": "detailed table",
    "fields": ["date_time", "vendor", "amount", "expense_type"]
  }
}
```

**Key Difference from v3**:
- No mention of "scatter_gather", "loop", "condition" operators
- No schema knowledge required
- No parameter structure decisions
- Simple, high-level description only

---

## 3. Deterministic Engine Components

### 3.1 Component Architecture

```typescript
// lib/agentkit/v4/v4-generator.ts

export class V4WorkflowGenerator {
  private intentParser: IntentParser;
  private actionResolver: ActionResolver;
  private parameterMapper: ParameterMapper;
  private referenceBuilder: ReferenceBuilder;
  private patternDetector: PatternDetector;
  private schemaValidator: SchemaValidator;

  async generateWorkflow(userPrompt: string): Promise<PilotDSLSchema> {
    // Step 1: LLM generates intent (only LLM involvement)
    const intent = await this.intentParser.parseIntent(userPrompt);

    // Step 2-6: All deterministic processing
    const actions = this.actionResolver.resolveActions(intent);
    const parameters = this.parameterMapper.mapParameters(actions, intent);
    const references = this.referenceBuilder.buildReferences(actions);
    const workflow = this.patternDetector.detectAndApplyPatterns(actions, parameters, references);
    const validated = this.schemaValidator.validate(workflow);

    return validated;
  }
}
```

### 3.2 Engine #1: Intent Parser (LLM-Powered)

**File**: `lib/agentkit/v4/core/intent-parser.ts`

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { WorkflowIntent } from '../schemas/intent-schema';

export class IntentParser {
  private anthropic: Anthropic;

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  async parseIntent(userPrompt: string): Promise<WorkflowIntent> {
    const systemPrompt = `You are an intent parser for workflow automation. Your ONLY job is to understand what the user wants and describe it in simple, natural language.

DO NOT:
- Generate workflow structures
- Mention technical terms like "scatter_gather", "loop", "condition"
- Worry about plugin schemas or parameter formats
- Make implementation decisions

DO:
- Describe WHAT data the user wants (e.g., "emails about expenses")
- Describe WHERE to get it from (e.g., "gmail")
- Describe WHAT to do with it (e.g., "extract expense details using AI")
- Describe HOW to output it (e.g., "create a table with date, vendor, amount")

Output valid JSON matching the WorkflowIntent schema.`;

    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Parse this workflow request into an intent object:\n\n${userPrompt}`,
        },
      ],
    });

    const intentText = response.content[0].type === 'text'
      ? response.content[0].text
      : '';

    // Extract JSON from response
    const jsonMatch = intentText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Failed to parse intent JSON from LLM response');
    }

    const intent: WorkflowIntent = JSON.parse(jsonMatch[0]);
    return intent;
  }
}
```

**Prompt Engineering Notes**:
- Keep system prompt under 500 tokens (vs. 15,000+ in v3)
- Focus on intent understanding, not structure generation
- No schema examples needed
- Much simpler task = higher success rate

### 3.3 Engine #2: Action Resolver (Deterministic)

**File**: `lib/agentkit/v4/core/action-resolver.ts`

```typescript
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { WorkflowIntent, DataSourceIntent, ProcessingIntent } from '../schemas/intent-schema';

export interface ResolvedAction {
  stepId: string;
  pluginName: string;
  actionName: string;
  intent: DataSourceIntent | ProcessingIntent;
  requiredParams: string[];
  optionalParams: string[];
  outputSchema: any;
}

export class ActionResolver {
  private pluginManager: PluginManagerV2;

  constructor() {
    this.pluginManager = new PluginManagerV2();
  }

  resolveActions(intent: WorkflowIntent): ResolvedAction[] {
    const resolved: ResolvedAction[] = [];
    let stepCounter = 1;

    // Resolve data source actions
    for (const dataSource of intent.data_sources) {
      const action = this.resolveDataSourceAction(dataSource, stepCounter);
      resolved.push(action);
      stepCounter++;

      // If includes attachments, add attachment download action
      if (dataSource.include?.includes('attachments') ||
          dataSource.include?.includes('attachment content')) {
        const attachmentAction = this.resolveAttachmentAction(dataSource, stepCounter);
        if (attachmentAction) {
          resolved.push(attachmentAction);
          stepCounter++;
        }
      }
    }

    // Resolve processing actions
    for (const processing of intent.processing_steps) {
      const action = this.resolveProcessingAction(processing, stepCounter);
      resolved.push(action);
      stepCounter++;
    }

    // Resolve output action
    if (intent.output_destination) {
      const action = this.resolveOutputAction(intent.output_destination, stepCounter);
      if (action) {
        resolved.push(action);
        stepCounter++;
      }
    }

    return resolved;
  }

  private resolveDataSourceAction(
    dataSource: DataSourceIntent,
    stepId: number
  ): ResolvedAction {
    const pluginName = this.normalizePluginName(dataSource.from);

    // Determine action based on plugin and intent
    let actionName: string;

    if (pluginName === 'google-mail') {
      actionName = 'search_emails';
    } else if (pluginName === 'google-sheets') {
      actionName = 'read_sheet';
    } else if (pluginName === 'hubspot') {
      if (dataSource.what.includes('contact')) {
        actionName = 'search_contacts';
      } else if (dataSource.what.includes('deal')) {
        actionName = 'search_deals';
      } else {
        actionName = 'search_contacts'; // default
      }
    } else if (pluginName === 'slack') {
      actionName = 'search_messages';
    } else {
      throw new Error(`Unknown data source plugin: ${pluginName}`);
    }

    const actionSchema = this.pluginManager.getActionSchema(pluginName, actionName);

    return {
      stepId: `step${stepId}`,
      pluginName,
      actionName,
      intent: dataSource,
      requiredParams: this.extractRequiredParams(actionSchema),
      optionalParams: this.extractOptionalParams(actionSchema),
      outputSchema: actionSchema.output_schema,
    };
  }

  private resolveAttachmentAction(
    dataSource: DataSourceIntent,
    stepId: number
  ): ResolvedAction | null {
    const pluginName = this.normalizePluginName(dataSource.from);

    if (pluginName === 'google-mail') {
      const actionSchema = this.pluginManager.getActionSchema('google-mail', 'get_email_attachment');

      return {
        stepId: `step${stepId}`,
        pluginName: 'google-mail',
        actionName: 'get_email_attachment',
        intent: dataSource,
        requiredParams: this.extractRequiredParams(actionSchema),
        optionalParams: this.extractOptionalParams(actionSchema),
        outputSchema: actionSchema.output_schema,
      };
    }

    return null;
  }

  private resolveProcessingAction(
    processing: ProcessingIntent,
    stepId: number
  ): ResolvedAction {
    // Determine if this is AI processing, transform, or plugin action
    if (processing.method?.includes('AI') || processing.action.includes('extract') ||
        processing.action.includes('analyze') || processing.action.includes('summarize')) {
      return {
        stepId: `step${stepId}`,
        pluginName: 'ai_processing',
        actionName: 'ai_processing',
        intent: processing,
        requiredParams: ['prompt', 'data'],
        optionalParams: ['model', 'output_schema'],
        outputSchema: { type: 'object' },
      };
    }

    // Check if it's a transform operation
    const transformOp = this.detectTransformOperation(processing.action);
    if (transformOp) {
      return {
        stepId: `step${stepId}`,
        pluginName: 'transform',
        actionName: transformOp,
        intent: processing,
        requiredParams: ['data'],
        optionalParams: ['config'],
        outputSchema: { type: 'object' },
      };
    }

    // Otherwise, try to resolve as plugin action
    const { pluginName, actionName } = this.inferPluginAction(processing.action);
    const actionSchema = this.pluginManager.getActionSchema(pluginName, actionName);

    return {
      stepId: `step${stepId}`,
      pluginName,
      actionName,
      intent: processing,
      requiredParams: this.extractRequiredParams(actionSchema),
      optionalParams: this.extractOptionalParams(actionSchema),
      outputSchema: actionSchema.output_schema,
    };
  }

  private resolveOutputAction(
    output: any,
    stepId: number
  ): ResolvedAction | null {
    if (!output.destination) {
      return null; // No output action needed, will use ai_processing output directly
    }

    const pluginName = this.normalizePluginName(output.destination);

    let actionName: string;
    if (pluginName === 'google-sheets') {
      actionName = 'write_to_sheet';
    } else if (pluginName === 'slack') {
      actionName = 'send_message';
    } else if (pluginName === 'google-mail') {
      actionName = 'send_email';
    } else {
      throw new Error(`Unknown output destination: ${pluginName}`);
    }

    const actionSchema = this.pluginManager.getActionSchema(pluginName, actionName);

    return {
      stepId: `step${stepId}`,
      pluginName,
      actionName,
      intent: output,
      requiredParams: this.extractRequiredParams(actionSchema),
      optionalParams: this.extractOptionalParams(actionSchema),
      outputSchema: actionSchema.output_schema,
    };
  }

  private normalizePluginName(source: string): string {
    const normalized = source.toLowerCase().replace(/\s+/g, '-');

    // Common aliases
    const aliases: Record<string, string> = {
      'gmail': 'google-mail',
      'sheets': 'google-sheets',
      'google-sheet': 'google-sheets',
      'hubspot-crm': 'hubspot',
    };

    return aliases[normalized] || normalized;
  }

  private detectTransformOperation(action: string): string | null {
    const lowerAction = action.toLowerCase();

    const transformKeywords: Record<string, string> = {
      'flatten': 'flatten',
      'join': 'join',
      'merge': 'join',
      'combine': 'join',
      'pivot': 'pivot',
      'split': 'split',
      'expand': 'expand',
      'filter': 'filter',
      'sort': 'sort',
      'group': 'group',
      'aggregate': 'aggregate',
      'deduplicate': 'deduplicate',
      'unique': 'deduplicate',
    };

    for (const [keyword, operation] of Object.entries(transformKeywords)) {
      if (lowerAction.includes(keyword)) {
        return operation;
      }
    }

    return null;
  }

  private inferPluginAction(action: string): { pluginName: string; actionName: string } {
    // Simple heuristic-based inference
    // In production, this would use more sophisticated NLP or keyword matching
    const lowerAction = action.toLowerCase();

    if (lowerAction.includes('send') && lowerAction.includes('email')) {
      return { pluginName: 'google-mail', actionName: 'send_email' };
    }
    if (lowerAction.includes('send') && lowerAction.includes('slack')) {
      return { pluginName: 'slack', actionName: 'send_message' };
    }
    if (lowerAction.includes('write') && lowerAction.includes('sheet')) {
      return { pluginName: 'google-sheets', actionName: 'write_to_sheet' };
    }

    throw new Error(`Cannot infer plugin action from: ${action}`);
  }

  private extractRequiredParams(actionSchema: any): string[] {
    return actionSchema.parameters?.required || [];
  }

  private extractOptionalParams(actionSchema: any): string[] {
    const allParams = Object.keys(actionSchema.parameters?.properties || {});
    const required = actionSchema.parameters?.required || [];
    return allParams.filter(p => !required.includes(p));
  }
}
```

**Key Features**:
- No LLM calls - pure deterministic logic
- Uses PluginManagerV2 for schema information
- Smart plugin name normalization (aliases)
- Detects attachment download needs automatically
- Infers transform operations from keywords
- Falls back to heuristics for ambiguous cases

### 3.4 Engine #3: Parameter Mapper (Deterministic)

**File**: `lib/agentkit/v4/core/parameter-mapper.ts`

```typescript
import { WorkflowIntent } from '../schemas/intent-schema';
import { ResolvedAction } from './action-resolver';

export interface MappedParameter {
  name: string;
  value: string | number | boolean | object | null;
  isReference: boolean;
  referenceStep?: string;
  referencePath?: string;
}

export class ParameterMapper {
  mapParameters(
    actions: ResolvedAction[],
    intent: WorkflowIntent
  ): Map<string, MappedParameter[]> {
    const parameterMap = new Map<string, MappedParameter[]>();

    for (const action of actions) {
      const params = this.mapActionParameters(action, intent, actions);
      parameterMap.set(action.stepId, params);
    }

    return parameterMap;
  }

  private mapActionParameters(
    action: ResolvedAction,
    intent: WorkflowIntent,
    allActions: ResolvedAction[]
  ): MappedParameter[] {
    const params: MappedParameter[] = [];

    if (action.actionName === 'search_emails') {
      params.push(...this.mapSearchEmailsParams(action, intent));
    } else if (action.actionName === 'get_email_attachment') {
      params.push(...this.mapAttachmentParams(action, allActions));
    } else if (action.actionName === 'ai_processing') {
      params.push(...this.mapAIProcessingParams(action, intent, allActions));
    } else if (action.actionName === 'write_to_sheet') {
      params.push(...this.mapWriteSheetParams(action, intent, allActions));
    }
    // Add more action-specific mappers as needed

    return params;
  }

  private mapSearchEmailsParams(
    action: ResolvedAction,
    intent: WorkflowIntent
  ): MappedParameter[] {
    const dataSource = action.intent as any;
    const params: MappedParameter[] = [];

    // Build search query from "what" field
    const query = this.buildGmailQuery(dataSource.what, dataSource.filters);
    params.push({
      name: 'query',
      value: query,
      isReference: false,
    });

    // Set max_results
    params.push({
      name: 'max_results',
      value: 10,
      isReference: false,
    });

    // Include attachments if requested
    if (dataSource.include?.includes('attachments')) {
      params.push({
        name: 'include_attachments',
        value: true,
        isReference: false,
      });
    }

    return params;
  }

  private mapAttachmentParams(
    action: ResolvedAction,
    allActions: ResolvedAction[]
  ): MappedParameter[] {
    // Find the previous search_emails step
    const searchStep = allActions.find(a =>
      a.actionName === 'search_emails' &&
      parseInt(a.stepId.replace('step', '')) < parseInt(action.stepId.replace('step', ''))
    );

    if (!searchStep) {
      throw new Error('get_email_attachment requires a prior search_emails step');
    }

    // These will be array references - need scatter_gather pattern
    return [
      {
        name: 'message_id',
        value: `{{${searchStep.stepId}.data.emails[].id}}`,
        isReference: true,
        referenceStep: searchStep.stepId,
        referencePath: 'data.emails[].id',
      },
      {
        name: 'attachment_id',
        value: `{{${searchStep.stepId}.data.emails[].attachments[].id}}`,
        isReference: true,
        referenceStep: searchStep.stepId,
        referencePath: 'data.emails[].attachments[].id',
      },
      {
        name: 'filename',
        value: `{{${searchStep.stepId}.data.emails[].attachments[].filename}}`,
        isReference: true,
        referenceStep: searchStep.stepId,
        referencePath: 'data.emails[].attachments[].filename',
      },
    ];
  }

  private mapAIProcessingParams(
    action: ResolvedAction,
    intent: WorkflowIntent,
    allActions: ResolvedAction[]
  ): MappedParameter[] {
    const processing = action.intent as any;
    const params: MappedParameter[] = [];

    // Build prompt from processing intent
    const prompt = this.buildAIPrompt(processing, intent);
    params.push({
      name: 'prompt',
      value: prompt,
      isReference: false,
    });

    // Find data source (previous step output)
    const previousStep = allActions[allActions.indexOf(action) - 1];
    if (previousStep) {
      params.push({
        name: 'data',
        value: `{{${previousStep.stepId}.data}}`,
        isReference: true,
        referenceStep: previousStep.stepId,
        referencePath: 'data',
      });
    }

    // Add output schema if output fields specified
    if (intent.output_destination?.fields) {
      const outputSchema = this.buildOutputSchema(intent.output_destination.fields);
      params.push({
        name: 'output_schema',
        value: outputSchema,
        isReference: false,
      });
    }

    return params;
  }

  private mapWriteSheetParams(
    action: ResolvedAction,
    intent: WorkflowIntent,
    allActions: ResolvedAction[]
  ): MappedParameter[] {
    const params: MappedParameter[] = [];

    // Find the AI processing step output
    const aiStep = allActions.find(a => a.actionName === 'ai_processing');

    if (aiStep) {
      params.push({
        name: 'data',
        value: `{{${aiStep.stepId}.data}}`,
        isReference: true,
        referenceStep: aiStep.stepId,
        referencePath: 'data',
      });
    }

    // Add spreadsheet_id (would come from user input or config)
    params.push({
      name: 'spreadsheet_id',
      value: '{{input.spreadsheet_id}}',
      isReference: true,
    });

    params.push({
      name: 'range',
      value: 'Sheet1!A1',
      isReference: false,
    });

    return params;
  }

  private buildGmailQuery(what: string, filters?: string[]): string {
    let query = '';

    // Extract keywords from "what" description
    if (what.includes('subject')) {
      const subjectMatch = what.match(/subject[:\s]+['"]?([^'"]+)['"]?/i);
      if (subjectMatch) {
        query = `subject:${subjectMatch[1]}`;
      }
    } else if (what.includes('from')) {
      const fromMatch = what.match(/from[:\s]+['"]?([^'"]+)['"]?/i);
      if (fromMatch) {
        query = `from:${fromMatch[1]}`;
      }
    } else {
      // Generic search - extract key terms
      const terms = what.replace(/emails?\s+(with|containing|about)/gi, '').trim();
      query = terms;
    }

    // Add filters
    if (filters) {
      for (const filter of filters) {
        if (filter.includes('unread')) {
          query += ' is:unread';
        } else if (filter.includes('inbox')) {
          query += ' in:inbox';
        } else if (filter.match(/last\s+(\d+)\s+days?/i)) {
          const match = filter.match(/last\s+(\d+)\s+days?/i);
          if (match) {
            query += ` newer_than:${match[1]}d`;
          }
        }
      }
    }

    return query.trim();
  }

  private buildAIPrompt(processing: any, intent: WorkflowIntent): string {
    let prompt = `${processing.action}.\n\n`;

    if (intent.output_destination?.fields) {
      prompt += `Extract the following fields:\n`;
      for (const field of intent.output_destination.fields) {
        prompt += `- ${field}\n`;
      }
    }

    if (intent.output_destination?.format) {
      prompt += `\nFormat the output as: ${intent.output_destination.format}\n`;
    }

    return prompt;
  }

  private buildOutputSchema(fields: string[]): object {
    const properties: Record<string, any> = {};

    for (const field of fields) {
      // Infer type from field name
      if (field.includes('date') || field.includes('time')) {
        properties[field] = { type: 'string', format: 'date-time' };
      } else if (field.includes('amount') || field.includes('price') || field.includes('cost')) {
        properties[field] = { type: 'number' };
      } else {
        properties[field] = { type: 'string' };
      }
    }

    return {
      type: 'object',
      properties,
      required: fields,
    };
  }
}
```

**Key Features**:
- Builds parameters from intent descriptions
- Constructs Gmail queries from natural language
- Generates AI prompts automatically
- Infers output schemas from field names
- Handles cross-step references deterministically

### 3.5 Engine #4: Reference Builder (Deterministic)

**File**: `lib/agentkit/v4/core/reference-builder.ts`

```typescript
import { ResolvedAction } from './action-resolver';
import { MappedParameter } from './parameter-mapper';

export interface VariableReference {
  stepId: string;
  path: string;
  isArray: boolean;
  arrayDepth: number;
}

export class ReferenceBuilder {
  buildReferences(
    actions: ResolvedAction[],
    parameterMap: Map<string, MappedParameter[]>
  ): Map<string, VariableReference[]> {
    const referenceMap = new Map<string, VariableReference[]>();

    for (const action of actions) {
      const params = parameterMap.get(action.stepId) || [];
      const refs = this.extractReferences(params);
      referenceMap.set(action.stepId, refs);
    }

    return referenceMap;
  }

  private extractReferences(params: MappedParameter[]): VariableReference[] {
    const references: VariableReference[] = [];

    for (const param of params) {
      if (param.isReference && param.referenceStep) {
        references.push({
          stepId: param.referenceStep,
          path: param.referencePath || '',
          isArray: this.isArrayReference(param.referencePath || ''),
          arrayDepth: this.calculateArrayDepth(param.referencePath || ''),
        });
      }
    }

    return references;
  }

  private isArrayReference(path: string): boolean {
    return path.includes('[]');
  }

  private calculateArrayDepth(path: string): number {
    const matches = path.match(/\[\]/g);
    return matches ? matches.length : 0;
  }

  /**
   * Validates that all references point to valid steps
   */
  validateReferences(
    referenceMap: Map<string, VariableReference[]>,
    actions: ResolvedAction[]
  ): string[] {
    const errors: string[] = [];
    const stepIds = new Set(actions.map(a => a.stepId));

    for (const [stepId, refs] of referenceMap.entries()) {
      for (const ref of refs) {
        if (!stepIds.has(ref.stepId)) {
          errors.push(`Step ${stepId} references non-existent step ${ref.stepId}`);
        }

        // Check if referenced step comes before current step
        const refIndex = actions.findIndex(a => a.stepId === ref.stepId);
        const currentIndex = actions.findIndex(a => a.stepId === stepId);

        if (refIndex >= currentIndex) {
          errors.push(`Step ${stepId} references future step ${ref.stepId} (forward references not allowed)`);
        }
      }
    }

    return errors;
  }
}
```

### 3.6 Engine #5: Pattern Detector (Deterministic)

**File**: `lib/agentkit/v4/core/pattern-detector.ts`

```typescript
import { ResolvedAction } from './action-resolver';
import { MappedParameter } from './parameter-mapper';
import { VariableReference } from './reference-builder';

export type WorkflowPattern =
  | 'sequential'
  | 'scatter_gather'
  | 'conditional'
  | 'loop'
  | 'parallel';

export interface PatternDetectionResult {
  pattern: WorkflowPattern;
  affectedSteps: string[];
  scatterConfig?: any;
  conditionConfig?: any;
}

export class PatternDetector {
  detectAndApplyPatterns(
    actions: ResolvedAction[],
    parameterMap: Map<string, MappedParameter[]>,
    referenceMap: Map<string, VariableReference[]>
  ): any {
    const patterns = this.detectPatterns(actions, parameterMap, referenceMap);

    // Build PILOT_DSL_SCHEMA workflow based on detected patterns
    return this.buildWorkflow(actions, parameterMap, patterns);
  }

  private detectPatterns(
    actions: ResolvedAction[],
    parameterMap: Map<string, MappedParameter[]>,
    referenceMap: Map<string, VariableReference[]>
  ): PatternDetectionResult[] {
    const patterns: PatternDetectionResult[] = [];

    // Detect scatter-gather pattern
    const scatterPattern = this.detectScatterGather(actions, parameterMap, referenceMap);
    if (scatterPattern) {
      patterns.push(scatterPattern);
    }

    // Detect conditional patterns
    const conditionalPatterns = this.detectConditionals(actions, parameterMap);
    patterns.push(...conditionalPatterns);

    return patterns;
  }

  private detectScatterGather(
    actions: ResolvedAction[],
    parameterMap: Map<string, MappedParameter[]>,
    referenceMap: Map<string, VariableReference[]>
  ): PatternDetectionResult | null {
    // Look for array references in parameters
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      const params = parameterMap.get(action.stepId) || [];

      // Check if any parameter references an array with []
      const hasArrayRef = params.some(p =>
        p.isReference && p.referencePath?.includes('[]')
      );

      if (hasArrayRef) {
        // This step needs scatter-gather
        return {
          pattern: 'scatter_gather',
          affectedSteps: [action.stepId],
          scatterConfig: {
            over: this.extractArraySource(params),
            steps: [action.stepId],
          },
        };
      }
    }

    return null;
  }

  private detectConditionals(
    actions: ResolvedAction[],
    parameterMap: Map<string, MappedParameter[]>
  ): PatternDetectionResult[] {
    // For v1, we'll skip conditional detection
    // Can be added later based on intent constraints
    return [];
  }

  private extractArraySource(params: MappedParameter[]): string {
    const arrayParam = params.find(p =>
      p.isReference && p.referencePath?.includes('[]')
    );

    if (!arrayParam || !arrayParam.referencePath) {
      return '';
    }

    // Convert "step1.data.emails[].id" to "step1.data.emails"
    return arrayParam.referencePath.replace(/\[\].*$/, '').replace(/\.$/, '');
  }

  private buildWorkflow(
    actions: ResolvedAction[],
    parameterMap: Map<string, MappedParameter[]>,
    patterns: PatternDetectionResult[]
  ): any {
    const workflow: any = {
      steps: [],
    };

    const scatterPattern = patterns.find(p => p.pattern === 'scatter_gather');

    if (scatterPattern) {
      // Build scatter-gather structure
      workflow.steps = this.buildScatterGatherWorkflow(actions, parameterMap, scatterPattern);
    } else {
      // Build sequential workflow
      workflow.steps = this.buildSequentialWorkflow(actions, parameterMap);
    }

    return workflow;
  }

  private buildScatterGatherWorkflow(
    actions: ResolvedAction[],
    parameterMap: Map<string, MappedParameter[]>,
    scatterPattern: PatternDetectionResult
  ): any[] {
    const steps: any[] = [];
    const scatterStepIds = new Set(scatterPattern.affectedSteps);

    let insideScatter = false;
    let scatterStep: any = null;

    for (const action of actions) {
      if (scatterStepIds.has(action.stepId)) {
        // Start scatter-gather
        if (!insideScatter) {
          insideScatter = true;
          scatterStep = {
            id: `scatter_${action.stepId}`,
            type: 'scatter_gather',
            scatter: {
              over: scatterPattern.scatterConfig?.over || '',
              mode: 'parallel',
            },
            steps: [],
            gather: {
              collect: 'results',
              combine_mode: 'array',
            },
          };
          steps.push(scatterStep);
        }

        // Add step to scatter
        scatterStep.steps.push(this.buildStep(action, parameterMap, true));
      } else {
        // Regular sequential step
        steps.push(this.buildStep(action, parameterMap, false));
      }
    }

    return steps;
  }

  private buildSequentialWorkflow(
    actions: ResolvedAction[],
    parameterMap: Map<string, MappedParameter[]>
  ): any[] {
    return actions.map(action => this.buildStep(action, parameterMap, false));
  }

  private buildStep(
    action: ResolvedAction,
    parameterMap: Map<string, MappedParameter[]>,
    insideScatter: boolean
  ): any {
    const params = parameterMap.get(action.stepId) || [];

    if (action.actionName === 'ai_processing') {
      return this.buildAIStep(action, params, insideScatter);
    } else {
      return this.buildPluginStep(action, params, insideScatter);
    }
  }

  private buildPluginStep(
    action: ResolvedAction,
    params: MappedParameter[],
    insideScatter: boolean
  ): any {
    const parameters: Record<string, any> = {};

    for (const param of params) {
      if (param.isReference) {
        // Use variable reference syntax
        let refValue = param.value as string;

        // If inside scatter and referencing array items, use loop.item
        if (insideScatter && refValue.includes('[]')) {
          refValue = refValue.replace(/\[\]/g, '').replace(/{{.*?\.data\./, '{{loop.item.');
        }

        parameters[param.name] = refValue;
      } else {
        parameters[param.name] = param.value;
      }
    }

    return {
      id: action.stepId,
      type: 'plugin_action',
      plugin: action.pluginName,
      action: action.actionName,
      parameters,
    };
  }

  private buildAIStep(
    action: ResolvedAction,
    params: MappedParameter[],
    insideScatter: boolean
  ): any {
    const promptParam = params.find(p => p.name === 'prompt');
    const dataParam = params.find(p => p.name === 'data');
    const schemaParam = params.find(p => p.name === 'output_schema');

    let dataRef = dataParam?.value as string || '';

    // Adjust reference for scatter context
    if (insideScatter && dataRef.includes('[]')) {
      dataRef = dataRef.replace(/\[\]/g, '').replace(/{{.*?\.data\./, '{{loop.item.');
    }

    const step: any = {
      id: action.stepId,
      type: 'ai_processing',
      prompt: promptParam?.value || '',
      data: dataRef,
    };

    if (schemaParam) {
      step.output_schema = schemaParam.value;
    }

    return step;
  }
}
```

**Key Features**:
- Detects scatter-gather need from array references
- Automatically builds correct PILOT_DSL_SCHEMA structure
- Handles loop.item reference conversion
- Supports sequential and parallel patterns
- Extensible for future pattern types (conditional, parallel)

### 3.7 Schema Validator (Reuse Existing)

**File**: Reuse `lib/pilot/schema/runtime-validator.ts`

No changes needed - existing validator already validates PILOT_DSL_SCHEMA compliance.

---

## 4. File Structure

```
/lib/agentkit/v4/
├── core/
│   ├── intent-parser.ts           # Engine #1: LLM-powered intent parsing
│   ├── action-resolver.ts         # Engine #2: Action resolution
│   ├── parameter-mapper.ts        # Engine #3: Parameter mapping
│   ├── reference-builder.ts       # Engine #4: Reference building
│   └── pattern-detector.ts        # Engine #5: Pattern detection
├── schemas/
│   └── intent-schema.ts           # Intent object TypeScript types
├── utils/
│   ├── plugin-helpers.ts          # Plugin name normalization, etc.
│   └── reference-helpers.ts       # Variable reference utilities
├── v4-generator.ts                # Main orchestrator
└── README.md                      # v4 architecture documentation

/app/api/generate-agent-v4/
└── route.ts                       # v4 API endpoint

/lib/agentkit/
├── v2/                            # Keep existing v2 (preserved)
├── v3/                            # Keep existing v3 (preserved)
│   ├── stage1-workflow-designer.ts
│   ├── stage2-parameter-filler.ts
│   └── twostage-agent-generator.ts
└── v4/                            # New v4 architecture
    └── [files listed above]
```

---

## 5. Implementation Phases

### Phase 1: Core Parsers and Resolvers (6-8 hours)

**Tasks**:
1. Create intent schema types (`intent-schema.ts`)
2. Implement Intent Parser with LLM (`intent-parser.ts`)
3. Implement Action Resolver (`action-resolver.ts`)
4. Write unit tests for Action Resolver

**Deliverables**:
- Intent schema defined
- LLM can parse user prompts to intent objects
- Actions correctly resolved from intent
- 20+ unit tests passing

**Testing**:
```typescript
// Test case: Expense workflow
const intent = await intentParser.parseIntent(
  "check my gmail for expenses subject, scan expenses attachments and create detailed table"
);

const actions = actionResolver.resolveActions(intent);

expect(actions).toHaveLength(3);
expect(actions[0].actionName).toBe('search_emails');
expect(actions[1].actionName).toBe('get_email_attachment');
expect(actions[2].actionName).toBe('ai_processing');
```

### Phase 2: Parameter and Reference Engines (4-6 hours)

**Tasks**:
1. Implement Parameter Mapper (`parameter-mapper.ts`)
2. Implement Reference Builder (`reference-builder.ts`)
3. Create helper utilities (`plugin-helpers.ts`, `reference-helpers.ts`)
4. Write unit tests

**Deliverables**:
- Parameters correctly mapped for all action types
- References validated and built
- 15+ unit tests passing

**Testing**:
```typescript
// Test case: Attachment parameter mapping
const params = parameterMapper.mapActionParameters(attachmentAction, intent, allActions);

expect(params).toContainEqual({
  name: 'message_id',
  value: '{{step1.data.emails[].id}}',
  isReference: true,
  referenceStep: 'step1',
  referencePath: 'data.emails[].id'
});
```

### Phase 3: Pattern Detection and Workflow Generation (3-4 hours)

**Tasks**:
1. Implement Pattern Detector (`pattern-detector.ts`)
2. Implement V4 Generator orchestrator (`v4-generator.ts`)
3. Write integration tests
4. Test with real workflows

**Deliverables**:
- Scatter-gather patterns correctly detected
- Complete PILOT_DSL_SCHEMA workflows generated
- 10+ integration tests passing
- Successfully generates expense workflow

**Testing**:
```typescript
// Test case: Full expense workflow generation
const generator = new V4WorkflowGenerator();
const workflow = await generator.generateWorkflow(
  "check my gmail for expenses subject, scan expenses attachments and create detailed table"
);

expect(workflow.steps).toHaveLength(2);
expect(workflow.steps[0].type).toBe('plugin_action');
expect(workflow.steps[1].type).toBe('scatter_gather');
expect(workflow.steps[1].steps[0].type).toBe('plugin_action');
expect(workflow.steps[1].steps[1].type).toBe('ai_processing');
```

### Phase 4: API Integration and Testing (2-3 hours)

**Tasks**:
1. Create v4 API endpoint (`app/api/generate-agent-v4/route.ts`)
2. Add error handling and logging
3. Test via frontend
4. Compare v3 vs v4 success rates

**Deliverables**:
- API endpoint functional
- Error handling robust
- Logging comprehensive
- Success rate comparison data

**API Endpoint**:
```typescript
// app/api/generate-agent-v4/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { V4WorkflowGenerator } from '@/lib/agentkit/v4/v4-generator';

export async function POST(request: NextRequest) {
  try {
    const { userPrompt, selectedPlugins } = await request.json();

    const generator = new V4WorkflowGenerator();
    const workflow = await generator.generateWorkflow(userPrompt);

    return NextResponse.json({
      success: true,
      workflow,
      version: 'v4',
    });
  } catch (error: any) {
    console.error('[V4 Generation Error]', error);

    return NextResponse.json({
      success: false,
      error: error.message,
      version: 'v4',
    }, { status: 500 });
  }
}
```

---

## 6. Migration and Rollout Strategy

### 6.1 Parallel Deployment

**Stage 1: Internal Testing (Week 1)**
- Deploy v4 alongside v3
- Use feature flag to control which version is used
- Test team uses v4 exclusively
- Collect metrics: success rate, latency, token usage

**Stage 2: A/B Testing (Week 2-3)**
- 10% of production traffic → v4
- 90% of production traffic → v3 (existing)
- Monitor error rates, user feedback
- Gradually increase v4 traffic if metrics are good

**Stage 3: Full Rollout (Week 4)**
- 100% traffic → v4
- Keep v3 as fallback for 1 week
- Monitor for regressions
- Decommission v3 after confidence established

### 6.2 Feature Flag Implementation

```typescript
// lib/agentkit/feature-flags.ts

export function shouldUseV4(userId?: string): boolean {
  // Check environment variable
  if (process.env.FORCE_V4 === 'true') {
    return true;
  }

  // Check A/B test bucket
  if (userId) {
    const bucket = hashUserId(userId) % 100;
    const v4Percentage = parseInt(process.env.V4_ROLLOUT_PERCENTAGE || '0');
    return bucket < v4Percentage;
  }

  return false;
}

function hashUserId(userId: string): number {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash) + userId.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}
```

Usage in frontend:
```typescript
// components/agent-creation/SmartAgentBuilder/hooks/useAgentGeneration.ts

const generateWorkflow = async () => {
  const useV4 = shouldUseV4(user?.id);

  const endpoint = useV4
    ? '/api/generate-agent-v4'
    : '/api/generate-agent-v3';

  const response = await fetch(endpoint, {
    method: 'POST',
    body: JSON.stringify({ userPrompt, selectedPlugins }),
  });

  // ... handle response
};
```

### 6.3 Rollback Procedures

**If v4 fails catastrophically**:
1. Set `FORCE_V4=false` environment variable
2. Set `V4_ROLLOUT_PERCENTAGE=0`
3. Deploy immediately (< 5 minutes)
4. All traffic reverts to v3
5. Investigate v4 issues offline

**If v4 has higher error rate than v3**:
1. Reduce `V4_ROLLOUT_PERCENTAGE` to lower value (e.g., 5%)
2. Collect more diagnostic data
3. Fix issues in v4
4. Gradually re-increase percentage

### 6.4 Metrics to Monitor

**Success Rate**:
- v3 baseline: ~10% (current)
- v4 target: >95%
- Alert if v4 < 90%

**Latency**:
- v3 baseline: ~8-12 seconds (2 LLM calls)
- v4 target: ~4-6 seconds (1 LLM call)
- Alert if v4 > 15 seconds

**Token Usage**:
- v3 baseline: ~18,000 tokens (15K prompt + 3K response)
- v4 target: ~2,000 tokens (500 prompt + 1,500 response)
- Alert if v4 > 5,000 tokens

**Error Types**:
- Track: schema validation errors, LLM parsing errors, plugin resolution errors
- Alert if any error type > 5% of requests

---

## 7. Testing Strategy

### 7.1 Unit Tests

**Files to Test**:
- `action-resolver.ts`: 20 test cases
- `parameter-mapper.ts`: 15 test cases
- `reference-builder.ts`: 10 test cases
- `pattern-detector.ts`: 15 test cases

**Example Test**:
```typescript
// __tests__/v4/action-resolver.test.ts

describe('ActionResolver', () => {
  let resolver: ActionResolver;

  beforeEach(() => {
    resolver = new ActionResolver();
  });

  test('resolves gmail search action from intent', () => {
    const intent: WorkflowIntent = {
      goal: 'Find expense emails',
      data_sources: [
        {
          what: 'emails with expense in subject',
          from: 'gmail',
          filters: ['inbox'],
        },
      ],
      processing_steps: [],
    };

    const actions = resolver.resolveActions(intent);

    expect(actions).toHaveLength(1);
    expect(actions[0].pluginName).toBe('google-mail');
    expect(actions[0].actionName).toBe('search_emails');
  });

  test('detects attachment download need', () => {
    const intent: WorkflowIntent = {
      goal: 'Download email attachments',
      data_sources: [
        {
          what: 'emails with expense in subject',
          from: 'gmail',
          include: ['attachments', 'attachment content'],
        },
      ],
      processing_steps: [],
    };

    const actions = resolver.resolveActions(intent);

    expect(actions).toHaveLength(2);
    expect(actions[0].actionName).toBe('search_emails');
    expect(actions[1].actionName).toBe('get_email_attachment');
  });
});
```

### 7.2 Integration Tests

**Test Workflows**:
1. Expense workflow (current failure case)
2. Simple email search
3. Sheet read + AI analysis
4. Multi-step with conditionals
5. Hubspot contact enrichment

**Example Integration Test**:
```typescript
// __tests__/v4/integration.test.ts

describe('V4 Full Workflow Generation', () => {
  let generator: V4WorkflowGenerator;

  beforeEach(() => {
    generator = new V4WorkflowGenerator();
  });

  test('generates expense workflow correctly', async () => {
    const workflow = await generator.generateWorkflow(
      'check my gmail for expenses subject, scan expenses attachments and create detailed table for each expenses with - date&time, vendor, amount, expenses type'
    );

    // Verify structure
    expect(workflow.steps).toHaveLength(2);

    // Step 1: search_emails
    expect(workflow.steps[0].type).toBe('plugin_action');
    expect(workflow.steps[0].plugin).toBe('google-mail');
    expect(workflow.steps[0].action).toBe('search_emails');
    expect(workflow.steps[0].parameters.query).toContain('expense');
    expect(workflow.steps[0].parameters.include_attachments).toBe(true);

    // Step 2: scatter-gather with attachment download + AI processing
    expect(workflow.steps[1].type).toBe('scatter_gather');
    expect(workflow.steps[1].scatter.over).toContain('step1.data.emails');
    expect(workflow.steps[1].steps).toHaveLength(2);

    // Inside scatter: get_email_attachment
    expect(workflow.steps[1].steps[0].type).toBe('plugin_action');
    expect(workflow.steps[1].steps[0].action).toBe('get_email_attachment');
    expect(workflow.steps[1].steps[0].parameters.message_id).toContain('loop.item');

    // Inside scatter: ai_processing
    expect(workflow.steps[1].steps[1].type).toBe('ai_processing');
    expect(workflow.steps[1].steps[1].prompt).toContain('date_time');
    expect(workflow.steps[1].steps[1].prompt).toContain('vendor');
    expect(workflow.steps[1].steps[1].output_schema).toBeDefined();
  }, 30000); // 30s timeout for LLM call
});
```

### 7.3 Comparison Tests (v3 vs v4)

**Test Suite**:
- Run same 50 user prompts through v3 and v4
- Compare success rates
- Compare generated workflows
- Compare execution results

**Metrics**:
- Success rate improvement
- Token usage reduction
- Latency improvement
- Structural correctness

---

## 8. Code Examples

### 8.1 Using V4 Generator

```typescript
import { V4WorkflowGenerator } from '@/lib/agentkit/v4/v4-generator';

const generator = new V4WorkflowGenerator();

const workflow = await generator.generateWorkflow(
  "Send weekly summary email of all completed Hubspot deals to sales team on Slack"
);

console.log(JSON.stringify(workflow, null, 2));
```

**Expected Output**:
```json
{
  "steps": [
    {
      "id": "step1",
      "type": "plugin_action",
      "plugin": "hubspot",
      "action": "search_deals",
      "parameters": {
        "filters": {
          "status": "completed",
          "updated_within_days": 7
        }
      }
    },
    {
      "id": "step2",
      "type": "ai_processing",
      "prompt": "Create a weekly summary of completed deals...",
      "data": "{{step1.data}}",
      "output_schema": {
        "type": "object",
        "properties": {
          "summary": { "type": "string" },
          "total_deals": { "type": "number" },
          "total_value": { "type": "number" }
        }
      }
    },
    {
      "id": "step3",
      "type": "plugin_action",
      "plugin": "slack",
      "action": "send_message",
      "parameters": {
        "channel": "{{input.sales_channel}}",
        "message": "{{step2.data.summary}}"
      }
    }
  ]
}
```

### 8.2 Frontend Integration

```typescript
// components/agent-creation/SmartAgentBuilder/hooks/useAgentGeneration.ts

import { shouldUseV4 } from '@/lib/agentkit/feature-flags';

export function useAgentGeneration() {
  const { user } = useUser();

  const generateAgent = async (userPrompt: string, selectedPlugins: string[]) => {
    setIsGenerating(true);

    try {
      const useV4 = shouldUseV4(user?.id);
      const endpoint = useV4 ? '/api/generate-agent-v4' : '/api/generate-agent-v3';

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userPrompt, selectedPlugins }),
      });

      const result = await response.json();

      if (result.success) {
        setGeneratedWorkflow(result.workflow);
        trackEvent('workflow_generated', { version: result.version });
      } else {
        setError(result.error);
        trackEvent('workflow_generation_failed', {
          version: result.version,
          error: result.error
        });
      }
    } catch (error) {
      setError('Failed to generate workflow');
    } finally {
      setIsGenerating(false);
    }
  };

  return { generateAgent, isGenerating, generatedWorkflow, error };
}
```

---

## 9. Estimated Timeline

### Total: 15-20 hours (2-3 days of focused work)

**Day 1** (6-8 hours):
- Morning: Phase 1 - Core parsers (intent-parser, action-resolver)
- Afternoon: Unit tests for Phase 1
- Evening: Phase 2 start (parameter-mapper)

**Day 2** (6-8 hours):
- Morning: Phase 2 complete (reference-builder, helpers)
- Afternoon: Phase 3 - Pattern detector and workflow builder
- Evening: Integration tests

**Day 3** (3-4 hours):
- Morning: Phase 4 - API endpoint and frontend integration
- Afternoon: Testing, bug fixes, documentation
- Evening: Deploy to staging, A/B test setup

---

## 10. Success Criteria

### Minimum Success (Launch-Ready)
- [ ] v4 achieves >90% success rate (vs 10% in v3)
- [ ] Expense workflow generates correctly 100% of time
- [ ] No regression in execution (workflows run correctly)
- [ ] Latency < 10 seconds per generation
- [ ] All unit tests passing (60+)
- [ ] Integration tests passing (10+)

### Target Success (Excellent)
- [ ] v4 achieves >95% success rate
- [ ] Token usage < 3,000 per generation (vs 18,000 in v3)
- [ ] Latency < 6 seconds per generation
- [ ] Zero schema validation errors
- [ ] Handles 20+ different workflow patterns
- [ ] User feedback positive (NPS >8)

### Stretch Goals (Outstanding)
- [ ] v4 achieves >98% success rate
- [ ] Supports conditional workflows
- [ ] Supports parallel execution patterns
- [ ] Self-healing for edge cases
- [ ] Explainability (shows why it chose each action)
- [ ] Token usage < 2,000 per generation

---

## 11. Risk Mitigation

### Risk 1: Intent Parser LLM Fails
**Mitigation**:
- Provide fallback examples in prompt
- Retry with rephrased prompt
- Fallback to v3 if 3 attempts fail

### Risk 2: Action Resolution Ambiguous
**Mitigation**:
- Build comprehensive keyword dictionary
- Add fuzzy matching for plugin names
- Log ambiguous cases for manual review

### Risk 3: Parameter Mapping Incomplete
**Mitigation**:
- Start with supported plugins only (11 plugins)
- Add parameter templates for each action type
- Validate parameters against schema before returning

### Risk 4: Pattern Detection Misses Cases
**Mitigation**:
- Start with scatter-gather only (most common)
- Add conditional/parallel in Phase 2 (post-launch)
- Validate with existing workflow test suite

### Risk 5: v4 Worse Than v3
**Mitigation**:
- A/B test with 5% traffic first
- Monitor success rates hourly
- Instant rollback capability via feature flag
- Keep v3 code intact for 1 month after v4 launch

---

## 12. Post-Launch Improvements

### Phase 2 Enhancements (After v4 Launch)
1. **Conditional workflows**: Detect "if/else" patterns from intent
2. **Parallel execution**: Detect independent actions that can run in parallel
3. **Multi-model support**: Use GPT-4o for intent parsing as alternative
4. **Caching**: Cache intent parsing for similar prompts
5. **Explainability**: Show user why each action was chosen

### Phase 3 Enhancements (Long-term)
1. **Learning**: Use execution success/failure to improve action resolution
2. **Custom plugins**: Auto-generate resolvers for new plugins
3. **Voice input**: Support voice-to-intent parsing
4. **Multi-language**: Support non-English prompts
5. **Workflow templates**: Pre-built intents for common patterns

---

## 13. Questions for User

Before starting implementation, please confirm:

1. **Scope**: Should we implement all 5 engines in first version, or start with core 3 (Intent Parser, Action Resolver, Parameter Mapper) and add Pattern Detector later?

2. **Plugins**: Should v4 support all 11 existing plugins from day 1, or start with subset (e.g., gmail, sheets, slack, hubspot)?

3. **Testing**: Do you have existing test workflows we should use, or should we create new test suite from scratch?

4. **Timeline**: Is 2-3 day timeline acceptable, or is there a hard deadline?

5. **Deployment**: Do you have staging environment for testing before production, or should we use feature flags in production directly?

---

## Appendix A: File Checklist

**New Files to Create** (11 files):
- [ ] lib/agentkit/v4/schemas/intent-schema.ts
- [ ] lib/agentkit/v4/core/intent-parser.ts
- [ ] lib/agentkit/v4/core/action-resolver.ts
- [ ] lib/agentkit/v4/core/parameter-mapper.ts
- [ ] lib/agentkit/v4/core/reference-builder.ts
- [ ] lib/agentkit/v4/core/pattern-detector.ts
- [ ] lib/agentkit/v4/utils/plugin-helpers.ts
- [ ] lib/agentkit/v4/utils/reference-helpers.ts
- [ ] lib/agentkit/v4/v4-generator.ts
- [ ] lib/agentkit/v4/README.md
- [ ] app/api/generate-agent-v4/route.ts

**Files to Modify** (2 files):
- [ ] lib/agentkit/feature-flags.ts (create)
- [ ] components/agent-creation/SmartAgentBuilder/hooks/useAgentGeneration.ts (modify to add v4 support)

**Files to Preserve** (no changes):
- All existing v2/ and v3/ files remain untouched
- All plugin executors remain untouched
- All execution engine (WorkflowPilot, StepExecutor) remains untouched

---

**Ready to start implementation?**

Let me know which phase you'd like to begin with, or if you need any clarification on the design!
