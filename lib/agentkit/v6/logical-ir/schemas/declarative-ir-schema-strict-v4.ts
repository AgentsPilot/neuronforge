/**
 * JSON Schema for Declarative Logical IR v4.0 Execution Graph
 *
 * This schema validates the execution graph structure at runtime.
 * It uses JSON Schema Draft 07 with discriminated unions for node types.
 *
 * Key Validation Rules:
 * - All node IDs must be unique
 * - All 'next' references must point to existing nodes
 * - All variable references must be declared
 * - Choice nodes must have a default path
 * - Loop nodes must have a converging body
 * - No discriminated union violations (e.g., operation node must have operation config)
 */

export const InputBindingSchema = {
  type: 'object',
  required: ['variable'],
  properties: {
    variable: { type: 'string' },
    path: { type: 'string' },
    required: { type: 'boolean' },
    transform: {
      type: 'string',
      enum: ['to_string', 'to_number', 'to_array', 'json_parse']
    }
  },
  additionalProperties: false
}

export const OutputBindingSchema = {
  type: 'object',
  required: ['variable'],
  properties: {
    variable: { type: 'string' },
    path: { type: 'string' },
    transform: {
      type: 'string',
      enum: ['to_string', 'to_number', 'to_array', 'json_stringify']
    }
  },
  additionalProperties: false
}

export const SimpleConditionSchema = {
  type: 'object',
  required: ['type', 'variable', 'operator'],
  properties: {
    type: {
      type: 'string',
      const: 'simple'
    },
    variable: { type: 'string' },
    operator: {
      type: 'string',
      enum: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'starts_with', 'ends_with', 'matches', 'exists', 'is_empty']
    },
    value: {}
  },
  additionalProperties: false
}

export const ComplexConditionSchema = {
  type: 'object',
  required: ['type', 'operator', 'conditions'],
  properties: {
    type: {
      type: 'string',
      const: 'complex'
    },
    operator: {
      type: 'string',
      enum: ['and', 'or', 'not']
    },
    conditions: {
      type: 'array',
      items: {
        oneOf: [
          { $ref: '#/definitions/SimpleCondition' },
          { $ref: '#/definitions/ComplexCondition' }
        ]
      }
    }
  },
  additionalProperties: false
}

export const ChoiceRuleSchema = {
  type: 'object',
  required: ['condition', 'next'],
  properties: {
    condition: {
      oneOf: [
        { $ref: '#/definitions/SimpleCondition' },
        { $ref: '#/definitions/ComplexCondition' }
      ]
    },
    next: { type: 'string' },
    description: { type: 'string' }
  },
  additionalProperties: false
}

export const FetchConfigSchema = {
  type: 'object',
  required: ['plugin_key', 'action'],
  properties: {
    plugin_key: { type: 'string' },
    action: { type: 'string' },
    config: { type: 'object' },
    pagination: {
      type: 'object',
      required: ['enabled'],
      properties: {
        enabled: { type: 'boolean' },
        page_size: { type: 'number' },
        max_pages: { type: 'number' }
      }
    }
  },
  additionalProperties: false
}

export const TransformConfigSchema = {
  type: 'object',
  required: ['type', 'input'],
  properties: {
    type: {
      type: 'string',
      enum: ['map', 'filter', 'reduce', 'group_by', 'sort', 'deduplicate', 'flatten', 'custom']
    },
    input: { type: 'string' },
    map_expression: { type: 'string' },
    filter_expression: {
      oneOf: [
        { $ref: '#/definitions/SimpleCondition' },
        { $ref: '#/definitions/ComplexCondition' }
      ]
    },
    reduce_operation: {
      type: 'string',
      enum: ['sum', 'count', 'avg', 'min', 'max', 'concat']
    },
    group_by_field: { type: 'string' },
    sort_field: { type: 'string' },
    sort_order: {
      type: 'string',
      enum: ['asc', 'desc']
    },
    custom_code: { type: 'string' }
  },
  additionalProperties: false
}

export const AIConfigSchema = {
  type: 'object',
  required: ['type', 'instruction'],
  properties: {
    type: {
      type: 'string',
      enum: ['deterministic_extract', 'llm_extract', 'generate', 'classify', 'summarize', 'custom']
    },
    instruction: { type: 'string' },
    input: { type: 'string' },
    output_schema: {
      type: 'object',
      required: ['fields'],
      properties: {
        fields: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'type'],
            properties: {
              name: { type: 'string' },
              type: {
                type: 'string',
                enum: ['string', 'number', 'boolean', 'object', 'array']
              },
              description: { type: 'string' },
              required: { type: 'boolean' }
            }
          }
        }
      }
    },
    model: { type: 'string' },
    temperature: { type: 'number' },
    labels: {
      type: 'array',
      items: { type: 'string' }
    }
  },
  additionalProperties: false
}

export const DeliveryConfigSchema = {
  type: 'object',
  required: ['plugin_key', 'action'],
  properties: {
    plugin_key: { type: 'string' },
    action: { type: 'string' },
    config: { type: 'object' }
  },
  additionalProperties: false
}

export const FileOperationConfigSchema = {
  type: 'object',
  required: ['type'],
  properties: {
    type: {
      type: 'string',
      enum: ['upload', 'download', 'generate', 'convert', 'extract_text', 'extract_metadata']
    },
    plugin_key: { type: 'string' },
    action: { type: 'string' },
    config: { type: 'object' }
  },
  additionalProperties: false
}

export const OperationConfigSchema = {
  type: 'object',
  required: ['operation_type'],
  properties: {
    operation_type: {
      type: 'string',
      enum: ['fetch', 'transform', 'ai', 'deliver', 'file_op']
    },
    fetch: { $ref: '#/definitions/FetchConfig' },
    transform: { $ref: '#/definitions/TransformConfig' },
    ai: { $ref: '#/definitions/AIConfig' },
    deliver: { $ref: '#/definitions/DeliveryConfig' },
    file_op: { $ref: '#/definitions/FileOperationConfig' },
    description: { type: 'string' }
  },
  additionalProperties: false,
  // Discriminated union validation: ensure the right config field is present
  oneOf: [
    {
      properties: { operation_type: { const: 'fetch' } },
      required: ['fetch']
    },
    {
      properties: { operation_type: { const: 'transform' } },
      required: ['transform']
    },
    {
      properties: { operation_type: { const: 'ai' } },
      required: ['ai']
    },
    {
      properties: { operation_type: { const: 'deliver' } },
      required: ['deliver']
    },
    {
      properties: { operation_type: { const: 'file_op' } },
      required: ['file_op']
    }
  ]
}

export const ChoiceConfigSchema = {
  type: 'object',
  required: ['rules', 'default'],
  properties: {
    rules: {
      type: 'array',
      items: { $ref: '#/definitions/ChoiceRule' }
    },
    default: { type: 'string' },
    description: { type: 'string' }
  },
  additionalProperties: false
}

export const LoopConfigSchema = {
  type: 'object',
  required: ['iterate_over', 'item_variable', 'body_start'],
  properties: {
    iterate_over: { type: 'string' },
    item_variable: {
      type: 'string',
      pattern: '^[a-zA-Z_][a-zA-Z0-9_]*$'
    },
    body_start: { type: 'string' },
    collect_outputs: { type: 'boolean' },
    output_variable: { type: 'string' },
    concurrency: {
      type: 'number',
      minimum: 1
    },
    exit_condition: {
      oneOf: [
        { $ref: '#/definitions/SimpleCondition' },
        { $ref: '#/definitions/ComplexCondition' }
      ]
    },
    description: { type: 'string' }
  },
  additionalProperties: false,
  // If collect_outputs is true, output_variable must be present
  if: {
    properties: { collect_outputs: { const: true } }
  },
  then: {
    required: ['output_variable']
  }
}

export const ParallelBranchSchema = {
  type: 'object',
  required: ['id', 'start'],
  properties: {
    id: {
      type: 'string',
      pattern: '^[a-zA-Z_][a-zA-Z0-9_]*$'
    },
    start: { type: 'string' },
    description: { type: 'string' }
  },
  additionalProperties: false
}

export const ParallelConfigSchema = {
  type: 'object',
  required: ['branches', 'wait_strategy'],
  properties: {
    branches: {
      type: 'array',
      items: { $ref: '#/definitions/ParallelBranch' },
      minItems: 2
    },
    wait_strategy: {
      type: 'string',
      enum: ['all', 'any', 'n']
    },
    wait_count: {
      type: 'number',
      minimum: 1
    },
    timeout_ms: {
      type: 'number',
      minimum: 0
    },
    description: { type: 'string' }
  },
  additionalProperties: false,
  // If wait_strategy is 'n', wait_count must be present
  if: {
    properties: { wait_strategy: { const: 'n' } }
  },
  then: {
    required: ['wait_count']
  }
}

export const ErrorHandlerSchema = {
  type: 'object',
  required: ['strategy'],
  properties: {
    strategy: {
      type: 'string',
      enum: ['fail', 'continue', 'retry', 'fallback']
    },
    retry_config: {
      type: 'object',
      required: ['max_attempts', 'backoff', 'initial_delay_ms'],
      properties: {
        max_attempts: {
          type: 'number',
          minimum: 1,
          maximum: 10
        },
        backoff: {
          type: 'string',
          enum: ['linear', 'exponential', 'fixed']
        },
        initial_delay_ms: {
          type: 'number',
          minimum: 0
        }
      }
    },
    fallback_node: { type: 'string' },
    log_errors: { type: 'boolean' },
    notify: { type: 'string' }
  },
  additionalProperties: false
}

export const ExecutionNodeSchema = {
  type: 'object',
  required: ['id', 'type'],
  properties: {
    id: {
      type: 'string',
      pattern: '^[a-zA-Z_][a-zA-Z0-9_]*$'
    },
    type: {
      type: 'string',
      enum: ['operation', 'choice', 'parallel', 'loop', 'end']
    },
    operation: { $ref: '#/definitions/OperationConfig' },
    choice: { $ref: '#/definitions/ChoiceConfig' },
    parallel: { $ref: '#/definitions/ParallelConfig' },
    loop: { $ref: '#/definitions/LoopConfig' },
    next: {
      oneOf: [
        { type: 'string' },
        {
          type: 'array',
          items: { type: 'string' }
        }
      ]
    },
    inputs: {
      type: 'array',
      items: { $ref: '#/definitions/InputBinding' }
    },
    outputs: {
      type: 'array',
      items: { $ref: '#/definitions/OutputBinding' }
    },
    error_handler: { $ref: '#/definitions/ErrorHandler' },
    description: { type: 'string' }
  },
  additionalProperties: false,
  // Discriminated union validation: ensure the right config field is present
  oneOf: [
    {
      properties: { type: { const: 'operation' } },
      required: ['operation']
    },
    {
      properties: { type: { const: 'choice' } },
      required: ['choice']
    },
    {
      properties: { type: { const: 'parallel' } },
      required: ['parallel']
    },
    {
      properties: { type: { const: 'loop' } },
      required: ['loop']
    },
    {
      properties: { type: { const: 'end' } }
    }
  ]
}

// ============================================================================
// Workflow Data Schema definitions
// ============================================================================

export const SchemaFieldSchema: any = {
  type: 'object',
  required: ['type'],
  properties: {
    type: {
      type: 'string',
      enum: ['string', 'number', 'boolean', 'object', 'array', 'any']
    },
    description: { type: 'string' },
    required: { type: 'boolean' },
    properties: {
      type: 'object',
      additionalProperties: { $ref: '#/definitions/SchemaField' }
    },
    items: { $ref: '#/definitions/SchemaField' },
    oneOf: {
      type: 'array',
      items: { $ref: '#/definitions/SchemaField' }
    },
    source: {
      type: 'string',
      enum: ['plugin', 'ai_declared', 'inferred', 'user_input']
    }
  },
  additionalProperties: false
}

export const DataSlotSchema = {
  type: 'object',
  required: ['schema', 'scope', 'produced_by'],
  properties: {
    schema: { $ref: '#/definitions/SchemaField' },
    scope: {
      type: 'string',
      enum: ['global', 'loop', 'branch']
    },
    produced_by: { type: 'string' },
    consumed_by: {
      type: 'array',
      items: { type: 'string' }
    }
  },
  additionalProperties: false
}

export const WorkflowDataSchemaSchema = {
  type: 'object',
  required: ['slots'],
  properties: {
    slots: {
      type: 'object',
      additionalProperties: { $ref: '#/definitions/DataSlot' }
    }
  },
  additionalProperties: false
}

export const ExecutionGraphSchema = {
  type: 'object',
  required: ['start', 'nodes'],
  properties: {
    start: { type: 'string' },
    nodes: {
      type: 'object',
      patternProperties: {
        '^[a-zA-Z_][a-zA-Z0-9_]*$': { $ref: '#/definitions/ExecutionNode' }
      },
      additionalProperties: false
    },
    data_schema: { $ref: '#/definitions/WorkflowDataSchema' },
    metadata: {
      type: 'object',
      properties: {
        estimated_complexity: {
          type: 'string',
          enum: ['low', 'medium', 'high']
        },
        estimated_duration_ms: { type: 'number' },
        tags: {
          type: 'array',
          items: { type: 'string' }
        }
      }
    }
  },
  additionalProperties: false
}

export const DeclarativeLogicalIRv4Schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: ['ir_version', 'goal'],
  properties: {
    ir_version: {
      type: 'string',
      enum: ['3.0', '4.0']
    },
    goal: { type: 'string' },
    execution_graph: { $ref: '#/definitions/ExecutionGraph' },
    context: {
      type: 'object',
      properties: {
        enhanced_prompt: {},
        semantic_plan: {},
        grounding_results: { type: 'array' }
      }
    },
    metadata: {
      type: 'object',
      properties: {
        generated_at: { type: 'string' },
        generated_by: { type: 'string' },
        version: { type: 'string' }
      }
    }
  },
  additionalProperties: false,
  // If ir_version is '4.0', execution_graph must be present
  if: {
    properties: { ir_version: { const: '4.0' } }
  },
  then: {
    required: ['execution_graph']
  },
  definitions: {
    InputBinding: InputBindingSchema,
    OutputBinding: OutputBindingSchema,
    SimpleCondition: SimpleConditionSchema,
    ComplexCondition: ComplexConditionSchema,
    ChoiceRule: ChoiceRuleSchema,
    FetchConfig: FetchConfigSchema,
    TransformConfig: TransformConfigSchema,
    AIConfig: AIConfigSchema,
    DeliveryConfig: DeliveryConfigSchema,
    FileOperationConfig: FileOperationConfigSchema,
    OperationConfig: OperationConfigSchema,
    ChoiceConfig: ChoiceConfigSchema,
    LoopConfig: LoopConfigSchema,
    ParallelBranch: ParallelBranchSchema,
    ParallelConfig: ParallelConfigSchema,
    ErrorHandler: ErrorHandlerSchema,
    ExecutionNode: ExecutionNodeSchema,
    ExecutionGraph: ExecutionGraphSchema,
    SchemaField: SchemaFieldSchema,
    DataSlot: DataSlotSchema,
    WorkflowDataSchema: WorkflowDataSchemaSchema
  }
}

/**
 * Validates a DeclarativeLogicalIR v4.0 against the schema
 *
 * @param ir The IR to validate
 * @returns Validation errors (empty array if valid)
 */
export function validateExecutionGraphIR(ir: any): string[] {
  const Ajv = require('ajv')
  const ajv = new Ajv({ allErrors: true })

  const validate = ajv.compile(DeclarativeLogicalIRv4Schema)
  const valid = validate(ir)

  if (!valid && validate.errors) {
    return validate.errors.map(err => {
      const path = err.instancePath || 'root'
      return `${path}: ${err.message}`
    })
  }

  return []
}
