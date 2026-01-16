/**
 * Extended Logical IR JSON Schema
 *
 * This schema is used for OpenAI Structured Outputs to ensure the LLM
 * generates valid IR that conforms to our specification.
 *
 * NOTE: OpenAI strict mode doesn't support oneOf/anyOf/allOf,
 * so we use flattened union patterns similar to pilot-dsl-schema.ts
 */

export const EXTENDED_IR_JSON_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'ExtendedLogicalIR',
  type: 'object',
  required: ['ir_version', 'goal', 'data_sources', 'normalization', 'filters', 'transforms', 'ai_operations', 'conditionals', 'loops', 'partitions', 'grouping', 'rendering', 'delivery', 'edge_cases', 'clarifications_required'],
  additionalProperties: false,
  properties: {
    ir_version: {
      type: 'string',
      enum: ['2.0'],
      description: 'IR schema version'
    },

    goal: {
      type: 'string',
      minLength: 5,
      description: 'Human-readable workflow goal (what the user wants to achieve)'
    },

    // ============================================================================
    // Data Layer
    // ============================================================================

    data_sources: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['id', 'type', 'location', 'source', 'tab', 'endpoint', 'trigger', 'role'],
        additionalProperties: false,
        properties: {
          id: {
            type: 'string',
            description: 'Unique identifier for this data source'
          },
          type: {
            type: 'string',
            enum: ['tabular', 'api', 'webhook', 'database', 'file', 'stream'],
            description: 'Type of data source'
          },
          source: {
            type: 'string',
            description: 'Plugin to use (e.g., "googlesheets", "rest_api")'
          },
          location: {
            type: 'string',
            description: 'Business identifier for data location (e.g., spreadsheet name, API endpoint)'
          },
          tab: {
            type: 'string',
            description: 'Tab/sheet name for tabular data'
          },
          endpoint: {
            type: 'string',
            description: 'API endpoint path'
          },
          trigger: {
            type: 'string',
            description: 'Webhook trigger name'
          },
          role: {
            type: 'string',
            description: 'Business description of this data (e.g., "customer data", "lead list")'
          }
        }
      }
    },

    normalization: {
      type: 'object',
      required: ['required_headers', 'case_sensitive', 'missing_header_action'],
      additionalProperties: false,
      properties: {
        required_headers: {
          type: 'array',
          minItems: 1,
          items: { type: 'string' },
          description: 'Headers that must be present in the data'
        },
        case_sensitive: {
          type: 'boolean',
          description: 'Whether header names are case-sensitive'
        },
        missing_header_action: {
          type: 'string',
          enum: ['error', 'warn', 'ignore'],
          description: 'What to do if a required header is missing'
        }
      }
    },

    // ============================================================================
    // Processing Layer
    // ============================================================================

    filters: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'field', 'operator', 'value', 'description'],
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          field: {
            type: 'string',
            description: 'Field name to filter on'
          },
          operator: {
            type: 'string',
            enum: [
              'equals',
              'not_equals',
              'contains',
              'not_contains',
              'greater_than',
              'less_than',
              'greater_than_or_equal',
              'less_than_or_equal',
              'in',
              'not_in',
              'is_empty',
              'is_not_empty'
            ]
          },
          value: {
            type: 'string',
            description: 'Value to filter by (type depends on operator)'
          },
          description: {
            type: 'string',
            description: 'Human-readable description of this filter'
          }
        }
      }
    },

    transforms: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'operation', 'config'],
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          operation: {
            type: 'string',
            enum: ['map', 'filter', 'reduce', 'sort', 'group', 'aggregate', 'join', 'deduplicate', 'flatten']
          },
          config: {
            type: 'object',
            required: ['source', 'field', 'group_by', 'sort_by', 'order', 'aggregation', 'join_key', 'mapping'],
            additionalProperties: false,
            properties: {
              source: { type: 'string' },
              field: { type: 'string' },
              group_by: { type: 'string' },
              sort_by: { type: 'string' },
              order: { type: 'string', enum: ['asc', 'desc'] },
              aggregation: { type: 'string', enum: ['sum', 'count', 'average', 'min', 'max'] },
              join_key: { type: 'string' },
              mapping: { type: 'string' }
            }
          }
        }
      }
    },

    ai_operations: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'type', 'instruction', 'input_source', 'output_schema', 'constraints'],
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          type: {
            type: 'string',
            enum: ['summarize', 'extract', 'classify', 'sentiment', 'generate', 'decide'],
            description: 'Type of AI operation to perform'
          },
          instruction: {
            type: 'string',
            minLength: 5,
            description: 'Clear instruction for what the AI should do (in business language)'
          },
          input_source: {
            type: 'string',
            description: 'Where to get input data (use {{variable}} syntax)'
          },
          output_schema: {
            type: 'object',
            required: ['type', 'fields', 'enum'],
            additionalProperties: false,
            properties: {
              type: {
                type: 'string',
                enum: ['string', 'object', 'array', 'number', 'boolean']
              },
              fields: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['name', 'type', 'required', 'description'],
                  additionalProperties: false,
                  properties: {
                    name: { type: 'string' },
                    type: { type: 'string' },
                    required: { type: 'boolean' },
                    description: { type: 'string' }
                  }
                }
              },
              enum: {
                type: 'array',
                items: { type: 'string' },
                description: 'Valid values for classification tasks'
              }
            }
          },
          constraints: {
            type: 'object',
            required: ['max_tokens', 'temperature', 'model_preference'],
            additionalProperties: false,
            properties: {
              max_tokens: { type: 'number' },
              temperature: { type: 'number', minimum: 0, maximum: 1 },
              model_preference: { type: 'string', enum: ['fast', 'accurate', 'balanced'] }
            }
          }
        }
      }
    },

    // ============================================================================
    // Control Flow
    // ============================================================================

    conditionals: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'when', 'then', 'else'],
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          when: {
            type: 'object',
            required: ['type', 'field', 'operator', 'value'],
            additionalProperties: false,
            properties: {
              type: {
                type: 'string',
                enum: ['simple', 'complex_and', 'complex_or', 'complex_not']
              },
              field: { type: 'string' },
              operator: {
                type: 'string',
                enum: ['equals', 'not_equals', 'contains', 'greater_than', 'less_than', 'in', 'is_empty', 'is_not_empty']
              },
              value: { type: 'string' }
            }
          },
          then: {
            type: 'array',
            items: { type: 'string' }
          },
          else: {
            type: 'array',
            items: { type: 'string' }
          }
        }
      }
    },

    loops: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'for_each', 'item_variable', 'do', 'max_iterations', 'max_concurrency'],
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          for_each: {
            type: 'string',
            description: 'Source data to iterate over (use {{variable}} syntax)'
          },
          item_variable: {
            type: 'string',
            description: 'Name to reference current item in loop (e.g., "customer", "lead")'
          },
          do: {
            type: 'array',
            items: { type: 'string' },
            description: 'Actions to perform for each item'
          },
          max_iterations: { type: 'number' },
          max_concurrency: { type: 'number' }
        }
      }
    },

    partitions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'field', 'split_by', 'handle_empty'],
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          field: {
            type: 'string',
            description: 'Field to partition by'
          },
          split_by: {
            type: 'string',
            enum: ['value', 'condition'],
            description: 'How to split: by unique values or by condition'
          },
          handle_empty: {
            type: 'object',
            required: ['partition_name', 'description'],
            additionalProperties: false,
            properties: {
              partition_name: { type: 'string' },
              description: { type: 'string' }
            }
          }
        }
      }
    },

    grouping: {
      type: 'object',
      required: ['input_partition', 'group_by', 'emit_per_group'],
      additionalProperties: false,
      properties: {
        input_partition: {
          type: 'string',
          description: 'Which partition to group (use "all" for no partitioning)'
        },
        group_by: {
          type: 'string',
          description: 'Field to group by'
        },
        emit_per_group: {
          type: 'boolean',
          description: 'Whether to process each group separately (true) or combine (false)'
        }
      }
    },

    // ============================================================================
    // Output Layer
    // ============================================================================

    rendering: {
      type: 'object',
      required: ['type', 'template', 'engine', 'columns_in_order', 'empty_message'],
      additionalProperties: false,
      properties: {
        type: {
          type: 'string',
          enum: ['html_table', 'email_embedded_table', 'json', 'csv', 'template', 'summary_block', 'alert', 'none']
        },
        template: { type: 'string' },
        engine: { type: 'string', enum: ['jinja', 'handlebars', 'mustache'] },
        columns_in_order: {
          type: 'array',
          items: { type: 'string' }
        },
        empty_message: { type: 'string' }
      }
    },

    delivery: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['id', 'method', 'config'],
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          method: {
            type: 'string',
            enum: ['email', 'slack', 'webhook', 'database', 'api_call', 'file', 'sms']
          },
          config: {
            type: 'object',
            required: ['recipient', 'recipient_source', 'cc', 'bcc', 'subject', 'body', 'channel', 'message', 'url', 'endpoint', 'method', 'headers', 'payload', 'table', 'operation', 'path', 'format'],
            additionalProperties: false,
            properties: {
              recipient: {
                type: 'string',
                description: 'Email recipient (string or array of strings)'
              },
              recipient_source: { type: 'string' },
              cc: { type: 'array', items: { type: 'string' } },
              bcc: { type: 'array', items: { type: 'string' } },
              subject: { type: 'string' },
              body: { type: 'string' },
              channel: { type: 'string' },
              message: { type: 'string' },
              url: { type: 'string' },
              endpoint: { type: 'string' },
              method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'] },
              headers: { type: 'string' },
              payload: { type: 'string' },
              table: { type: 'string' },
              operation: { type: 'string', enum: ['insert', 'update', 'delete'] },
              path: { type: 'string' },
              format: { type: 'string', enum: ['json', 'csv', 'txt'] }
            }
          }
        }
      }
    },

    // ============================================================================
    // Error Handling
    // ============================================================================

    edge_cases: {
      type: 'array',
      items: {
        type: 'object',
        required: ['condition', 'action', 'message', 'recipient'],
        additionalProperties: false,
        properties: {
          condition: {
            type: 'string',
            enum: [
              'no_rows_after_filter',
              'empty_data_source',
              'missing_required_field',
              'duplicate_records',
              'rate_limit_exceeded',
              'api_error'
            ]
          },
          action: {
            type: 'string',
            enum: [
              'send_empty_result_message',
              'skip_execution',
              'use_default_value',
              'retry',
              'alert_admin'
            ]
          },
          message: { type: 'string' },
          recipient: { type: 'string' }
        }
      }
    },

    clarifications_required: {
      type: 'array',
      items: { type: 'string' },
      description: 'List of clarifications needed from user (empty if none needed)'
    }
  }
} as const

/**
 * Helper to get the schema for LLM structured outputs
 */
export function getExtendedIRSchema() {
  return EXTENDED_IR_JSON_SCHEMA
}
