/**
 * Declarative Logical IR Schema (V6 Pure)
 *
 * This schema is PURELY DECLARATIVE - it expresses WHAT the user wants,
 * NOT HOW to execute it.
 *
 * Design Philosophy:
 * - NO operation IDs (compiler generates them)
 * - NO loops (compiler infers from delivery_rules)
 * - NO execution details (compiler binds to plugins)
 * - ONLY business intent
 *
 * Inspired by OpenAI's approach but enhanced with:
 * - Richer AI operations structure
 * - Better edge case handling
 * - Support for both tabular and API workflows
 */

export const DECLARATIVE_IR_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: ['ir_version', 'goal', 'data_sources'],
  properties: {
    ir_version: {
      type: 'string',
      enum: ['2.0', '3.0'],
      description: 'Declarative IR version (accepts both 2.0 and 3.0 for backward compatibility)'
    },

    goal: {
      type: 'string',
      minLength: 10,
      description: 'Human-readable description of workflow intent'
    },

    // ========================================================================
    // RUNTIME INPUTS - What values does the user provide at execution time?
    // ========================================================================

    runtime_inputs: {
      type: ['array', 'null'],
      items: {
        type: 'object',
        required: ['name', 'type', 'label', 'description', 'required'],
        properties: {
          name: {
            type: 'string',
            description: 'Variable name (e.g., "topic", "search_query")'
          },
          type: {
            type: 'string',
            enum: ['text', 'number', 'email', 'date', 'select'],
            description: 'Input type'
          },
          label: {
            type: 'string',
            description: 'Human-readable label'
          },
          description: {
            type: 'string',
            description: 'Description of what this input is for'
          },
          required: {
            type: 'boolean',
            description: 'Whether this input is required'
          },
          placeholder: {
            type: 'string',
            description: 'Placeholder text (optional)'
          },
          options: {
            type: 'array',
            items: { type: 'string' },
            description: 'Options for select type (optional)'
          },
          default_value: {
            type: 'string',
            description: 'Default value if not provided (optional)'
          }
        }
      },
      description: 'Runtime inputs that user provides at execution time (optional, null if not needed)'
    },

    // ========================================================================
    // DATA LAYER - WHERE does data come from?
    // ========================================================================

    data_sources: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['type', 'source', 'location'],
        properties: {
          type: {
            type: 'string',
            enum: ['tabular', 'api', 'webhook', 'database', 'file', 'stream'],
            description: 'Type of data source'
          },
          source: {
            type: 'string',
            description: 'Source system (e.g., "google_sheets", "gmail", "airtable")'
          },
          location: {
            type: 'string',
            description: 'Location identifier (e.g., sheet name, API endpoint)'
          },
          role: {
            type: 'string',
            description: 'Human-readable description of what this data represents (optional)'
          },
          plugin_key: {
            type: 'string',
            description: 'Plugin identifier (e.g., "google-mail", "google-sheets") (optional)'
          },
          operation_type: {
            type: 'string',
            description: 'Type of operation (read, search, write, etc.) (optional)'
          },
          tab: {
            type: 'string',
            description: 'For tabular sources: specific tab/worksheet (optional)'
          },
          endpoint: {
            type: 'string',
            description: 'For API sources: endpoint path (optional)'
          },
          trigger: {
            type: 'string',
            description: 'For webhooks: event type that triggers workflow (optional)'
          },
          config: {
            type: 'object',
            description: 'Plugin-specific configuration parameters (optional)',
            additionalProperties: true
          }
        }
      }
    },

    // ========================================================================
    // VALIDATION - WHAT data quality rules apply?
    // ========================================================================

    normalization: {
      type: 'object',
      required: ['required_headers', 'case_sensitive', 'missing_header_action'],
      properties: {
        required_headers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Column names that must be present'
        },
        case_sensitive: {
          type: 'boolean',
          description: 'Whether header matching is case-sensitive'
        },
        missing_header_action: {
          type: 'string',
          enum: ['error', 'warn', 'ignore'],
          description: 'What to do if required headers are missing'
        }
      }
    },

    // ========================================================================
    // FILTERING - WHAT subset of data do we want?
    // ========================================================================

    filters: {
      type: 'object',
      properties: {
        combineWith: {
          type: 'string',
          enum: ['AND', 'OR'],
          description: 'How to combine multiple filter conditions (default: AND)'
        },
        conditions: {
          type: 'array',
          items: {
            type: 'object',
            required: ['field', 'operator'],
            properties: {
              field: {
                type: 'string',
                description: 'Field name to filter on'
              },
              operator: {
                type: 'string',
                enum: ['equals', 'not_equals', 'contains', 'greater_than', 'less_than', 'in', 'is_empty', 'is_not_empty', 'within_last_days', 'before', 'after'],
                description: 'Comparison operator'
              },
              value: {
                description: 'Value to compare against (optional for operators like is_empty)',
                oneOf: [
                  { type: 'string' },
                  { type: 'number' },
                  { type: 'boolean' }
                ]
              },
              description: {
                type: 'string',
                description: 'Human-readable description of filter purpose (optional)'
              }
            }
          }
        },
        groups: {
          type: 'array',
          description: 'For complex nested filter logic (e.g., (A AND B) OR (C AND D))',
          items: {
            type: 'object',
            required: ['combineWith', 'conditions'],
            properties: {
              combineWith: {
                type: 'string',
                enum: ['AND', 'OR']
              },
              conditions: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['field', 'operator'],
                  properties: {
                    field: { type: 'string' },
                    operator: {
                      type: 'string',
                      enum: ['equals', 'not_equals', 'contains', 'greater_than', 'less_than', 'in', 'is_empty', 'is_not_empty', 'within_last_days', 'before', 'after']
                    },
                    value: {
                      oneOf: [
                        { type: 'string' },
                        { type: 'number' },
                        { type: 'boolean' }
                      ]
                    },
                    description: { type: 'string' }
                  }
                }
              }
            }
          }
        }
      }
    },

    // ========================================================================
    // AI OPERATIONS - WHAT intelligent processing is needed?
    // ========================================================================

    ai_operations: {
      type: 'array',
      items: {
        type: 'object',
        required: ['type', 'instruction', 'output_schema'],
        properties: {
          type: {
            type: 'string',
            enum: ['summarize', 'extract', 'classify', 'sentiment', 'generate', 'decide'],
            description: 'Type of AI operation'
          },
          instruction: {
            type: 'string',
            minLength: 5,
            description: 'Clear business instruction in natural language'
          },
          context: {
            type: ['object', 'string', 'null'],
            description: 'Additional context for the AI operation (optional, can be object or string)'
          },
          output_schema: {
            type: 'object',
            required: ['type'],
            properties: {
              type: {
                type: 'string',
                enum: ['string', 'object', 'array', 'number', 'boolean'],
                description: 'Output type: object (single record), array (multiple items), string (summary/text)'
              },
              fields: {
                type: 'array',
                description: 'For object type: fields to extract',
                items: {
                  type: 'object',
                  required: ['name', 'type'],
                  properties: {
                    name: { type: 'string' },
                    type: { type: 'string' },
                    required: { type: 'boolean' },
                    description: { type: 'string' }
                  }
                }
              },
              items: {
                type: 'object',
                description: 'For array type: schema of each item in the array',
                properties: {
                  fields: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['name', 'type'],
                      properties: {
                        name: { type: 'string' },
                        type: { type: 'string' },
                        required: { type: 'boolean' },
                        description: { type: 'string' }
                      }
                    }
                  }
                }
              },
              description: {
                type: 'string',
                description: 'For string type or overall extraction description'
              },
              enum: {
                type: 'array',
                items: { type: 'string' }
              }
            }
          },
          constraints: {
            type: 'object',
            properties: {
              max_tokens: { type: 'number' },
              temperature: { type: 'number', minimum: 0, maximum: 1 },
              model_preference: { type: 'string', enum: ['fast', 'accurate', 'balanced'] }
            }
          }
        }
      }
    },

    // ========================================================================
    // PARTITIONING - HOW should data be grouped/split?
    // ========================================================================

    partitions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['field', 'split_by'],
        properties: {
          field: {
            type: 'string',
            description: 'Field to partition by'
          },
          split_by: {
            type: 'string',
            enum: ['value', 'condition'],
            description: 'Split by unique values or by condition'
          },
          handle_empty: {
            type: 'object',
            required: ['partition_name'],
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
      properties: {
        group_by: {
          type: ['string', 'null'],
          description: 'Field to group by (null if no grouping)'
        },
        emit_per_group: {
          type: 'boolean',
          description: 'Whether to emit output per group'
        }
      }
    },

    // ========================================================================
    // OUTPUT - HOW should results be formatted?
    // ========================================================================

    rendering: {
      type: 'object',
      required: ['type'],
      properties: {
        type: {
          type: 'string',
          enum: ['email_embedded_table', 'html_table', 'summary_block', 'alert', 'json', 'csv'],
          description: 'Output format type'
        },
        template: {
          type: 'string',
          description: 'Custom template for rendering (optional)'
        },
        engine: {
          type: 'string',
          enum: ['jinja', 'handlebars', 'mustache', 'none'],
          description: 'Template engine to use (optional)'
        },
        columns_in_order: {
          type: 'array',
          items: { type: 'string' },
          description: 'Column order for table output (optional)'
        },
        empty_message: {
          type: 'string',
          description: 'Message to show when no data (optional)'
        }
      }
    },

    // ========================================================================
    // DELIVERY - WHERE should results go?
    // THIS IS WHERE THE COMPILER INFERS LOOPS!
    // ========================================================================

    delivery_rules: {
      type: 'object',
      properties: {
        per_item_delivery: {
          type: 'object',
          description: 'Send one delivery per item (compiler creates loop)',
          properties: {
            recipient_source: {
              type: 'string',
              description: 'Field containing recipient (e.g., "email", "Sales Person")'
            },
            cc: {
              type: 'array',
              items: { type: 'string' }
            },
            subject: { type: 'string' },
            body_template: { type: 'string' }
          }
        },
        per_group_delivery: {
          type: 'object',
          description: 'Send one delivery per group (compiler creates grouping + loop)',
          properties: {
            recipient_source: {
              type: 'string',
              description: 'Field containing recipient for each group'
            },
            cc: {
              type: 'array',
              items: { type: 'string' }
            },
            subject: { type: 'string' },
            body_template: { type: 'string' }
          }
        },
        summary_delivery: {
          type: 'object',
          description: 'Send one summary of all results or write to destination',
          properties: {
            recipient: { type: 'string' },
            recipient_source: { type: 'string' },
            cc: { type: 'array', items: { type: 'string' } },
            subject: { type: 'string' },
            body_template: { type: 'string' },
            content: { type: ['string', 'object'] },
            include_missing_section: { type: 'boolean' },
            plugin_key: { type: 'string' },
            operation_type: { type: 'string' },
            config: { type: 'object' }  // Plugin-specific config (e.g., Google Sheets spreadsheet_id, range)
          }
        },
        send_when_no_results: {
          type: 'boolean',
          description: 'Whether to send delivery even if no data'
        }
      }
    },

    // ========================================================================
    // ERROR HANDLING - WHAT should happen in edge cases?
    // ========================================================================

    edge_cases: {
      type: 'array',
      items: {
        type: 'object',
        required: ['condition', 'action'],
        properties: {
          condition: {
            type: 'string',
            enum: [
              'no_rows_after_filter',
              'empty_data_source',
              'missing_required_field',
              'missing_required_headers',
              'duplicate_records',
              'rate_limit_exceeded',
              'api_error',
              'no_attachments_found',
              'ai_extraction_failed'
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
          message: { type: 'string', description: 'Message to display (optional)' },
          recipient: { type: 'string', description: 'Recipient to notify (optional)' }
        }
      }
    },

    clarifications_required: {
      type: 'array',
      items: { type: 'string' },
      description: 'Questions for the user if intent is ambiguous'
    }
  }
}

/**
 * FORBIDDEN TOKENS - Compiler will reject IR containing these
 */
export const FORBIDDEN_IR_TOKENS = [
  'plugin',
  'google-sheets',
  'google-mail',
  'gmail',
  'step_id',
  'action',
  'execute',
  'workflow_steps',
  'dag',
  'loop',
  'for_each',
  'do',
  'scatter_gather'
]
