/**
 * OpenAI-Compatible Strict JSON Schema for Declarative IR
 *
 * This schema is designed for OpenAI's Structured Outputs with strict: true
 *
 * Requirements for strict mode:
 * - additionalProperties: false on all objects
 * - All properties explicitly defined
 * - No oneOf/anyOf (use explicit types)
 * - All required arrays must be defined
 *
 * With strict: true, the LLM CANNOT generate values outside the schema.
 * This prevents the "new prompt, new error" problem.
 */

export const DECLARATIVE_IR_SCHEMA_STRICT = {
  type: 'object',
  required: [
    'ir_version',
    'goal',
    'data_sources'
  ],
  additionalProperties: false,
  properties: {
    ir_version: {
      type: 'string',
      enum: ['2.0', '3.0'],
      description: 'Declarative IR version (accepts both 2.0 and 3.0 for backward compatibility)'
    },

    goal: {
      type: 'string',
      description: 'Human-readable description of workflow intent'
    },

    // ========================================================================
    // RUNTIME INPUTS
    // ========================================================================

    runtime_inputs: {
      type: ['array', 'null'],
      items: {
        type: 'object',
        required: ['name', 'type', 'label', 'description', 'required'],
        additionalProperties: false,
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
            type: ['string', 'null'],
            description: 'Placeholder text (null if not provided)'
          },
          options: {
            type: ['array', 'null'],
            items: { type: 'string' },
            description: 'Options for select type (null if not applicable)'
          },
          default_value: {
            type: ['string', 'null'],
            description: 'Default value if not provided (null if none)'
          }
        }
      },
      description: 'Runtime inputs that user provides at execution time (null if not needed)'
    },

    // ========================================================================
    // DATA LAYER
    // ========================================================================

    data_sources: {
      type: 'array',
      items: {
        type: 'object',
        required: ['type', 'source', 'location'],
        additionalProperties: false,
        properties: {
          type: {
            type: 'string',
            enum: ['tabular', 'api', 'webhook', 'database', 'file', 'stream']
          },
          source: {
            type: 'string'
          },
          location: {
            type: 'string'
          },
          role: {
            type: 'string'
          },
          tab: {
            type: ['string', 'null'],
            description: 'For tabular sources: specific tab/worksheet (null if not applicable)'
          },
          endpoint: {
            type: ['string', 'null'],
            description: 'For API sources: endpoint path (null if not applicable)'
          },
          trigger: {
            type: ['string', 'null'],
            description: 'For webhooks: event type (null if not applicable)'
          },
          plugin_key: {
            type: ['string', 'null'],
            description: 'Plugin key for resolution (null if using legacy source field)'
          },
          operation_type: {
            type: ['string', 'null'],
            // Note: operation_type must match an action name from the plugin definition
            // This is validated semantically via plugin manager, not via static enum
            description: 'Plugin action name (e.g., read_range, append_rows, search, send). Must match an action from the plugin definition.'
          },
          config: {
            type: ['object', 'null'],
            description: 'Plugin-specific configuration parameters. Structure varies by plugin and action. Common fields: query (string), max_results (number), spreadsheet_id (string), range (string), folder (string), include_attachments (boolean).',
            additionalProperties: true
            // Note: config structure is plugin-specific and validated at execution time
            // Each plugin action defines its own required/optional parameters
          }
        }
      }
    },

    // ========================================================================
    // VALIDATION
    // ========================================================================

    normalization: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        required_headers: {
          type: ['array', 'null'],
          items: { type: 'string' }
        },
        case_sensitive: {
          type: ['boolean', 'null']
        },
        missing_header_action: {
          type: ['string', 'null'],
          enum: ['error', 'warn', 'ignore', null]
        },
        // Additional normalization options for field transformations
        description: {
          type: ['string', 'null'],
          description: 'Description of normalization logic'
        },
        fields: {
          type: ['array', 'null'],
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              operation: { type: 'string' },
              on_failure: { type: ['string', 'null'] }
            }
          }
        },
        // Grounded facts from semantic plan
        grounded_facts: {
          type: ['array', 'null'],
          items: { type: 'string' }
        }
      }
    },

    // ========================================================================
    // FILTERING
    // ========================================================================

    filters: {
      type: ['object', 'null'],
      required: ['combineWith'],
      additionalProperties: false,
      properties: {
        combineWith: {
          type: ['string', 'null'],
          enum: ['AND', 'OR', null],
          description: 'How to combine conditions (null defaults to AND)'
        },
        conditions: {
          type: ['array', 'null'],
          items: {
            type: 'object',
            required: ['field', 'operator', 'value'],
            additionalProperties: false,
            properties: {
              field: {
                type: 'string',
                description: 'Field name to filter on. Wave 8: Made non-nullable - validation must fail if field cannot be grounded.'
              },
              operator: {
                type: 'string',
                enum: [
                  'equals',
                  'not_equals',
                  'contains',
                  'not_contains',      // ADDED: Missing operator from formalization prompt
                  'starts_with',       // ADDED: Missing operator from formalization prompt
                  'ends_with',         // ADDED: Missing operator from formalization prompt
                  'matches_regex',     // ADDED: Missing operator from formalization prompt
                  'greater_than',
                  'less_than',
                  'greater_than_or_equals',  // ADDED: Common operator
                  'less_than_or_equals',     // ADDED: Common operator
                  'in',
                  'not_in',            // ADDED: Common operator
                  'is_empty',
                  'is_not_empty',
                  'within_last_days',
                  'before',
                  'after'
                ]
              },
              value: {
                type: ['string', 'number', 'boolean', 'null'],
                description: 'Value to compare (null for operators like is_empty, number for numeric comparisons, boolean for true/false checks)'
              },
              description: {
                type: ['string', 'null']
              }
            }
          }
        },
        groups: {
          type: ['array', 'null'],
          items: {
            type: 'object',
            required: ['combineWith', 'conditions'],
            additionalProperties: false,
            properties: {
              combineWith: {
                type: 'string',
                enum: ['AND', 'OR']
              },
              conditions: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['field', 'operator', 'value'],
                  additionalProperties: false,
                  properties: {
                    field: {
                      type: 'string',
                      description: 'Field name to filter on. Wave 8: Made non-nullable - validation must fail if field cannot be grounded.'
                    },
                    operator: {
                      type: 'string',
                      enum: [
                        'equals',
                        'not_equals',
                        'contains',
                        'not_contains',
                        'starts_with',
                        'ends_with',
                        'matches_regex',
                        'greater_than',
                        'less_than',
                        'greater_than_or_equals',
                        'less_than_or_equals',
                        'in',
                        'not_in',
                        'is_empty',
                        'is_not_empty',
                        'within_last_days',
                        'before',
                        'after'
                      ]
                    },
                    value: {
                      type: ['string', 'number', 'boolean', 'null']
                    },
                    description: {
                      type: ['string', 'null']
                    }
                  }
                }
              }
            }
          }
        }
      }
    },

    // ========================================================================
    // POST-AI FILTERS (applied after AI operations, on AI output fields)
    // ========================================================================

    post_ai_filters: {
      type: ['object', 'null'],
      required: ['combineWith'],
      additionalProperties: false,
      description: 'Filters applied AFTER AI operations on AI-generated output fields. Derived from semantic context when user wants to filter results based on AI classifications/extractions.',
      properties: {
        combineWith: {
          type: ['string', 'null'],
          enum: ['AND', 'OR', null],
          description: 'How to combine conditions (null defaults to AND)'
        },
        conditions: {
          type: ['array', 'null'],
          items: {
            type: 'object',
            required: ['field', 'operator', 'value'],
            additionalProperties: false,
            properties: {
              field: {
                type: 'string',
                description: 'AI output field name to filter on (e.g., action_required, Priority, sentiment)'
              },
              operator: {
                type: 'string',
                enum: [
                  'equals',
                  'not_equals',
                  'contains',
                  'not_contains',
                  'starts_with',
                  'ends_with',
                  'matches_regex',
                  'greater_than',
                  'less_than',
                  'greater_than_or_equals',
                  'less_than_or_equals',
                  'in',
                  'not_in',
                  'is_empty',
                  'is_not_empty'
                ]
              },
              value: {
                type: ['string', 'number', 'boolean', 'null'],
                description: 'Value to compare against (supports boolean for AI classification fields)'
              },
              description: {
                type: ['string', 'null']
              }
            }
          }
        },
        groups: {
          type: ['array', 'null'],
          items: {
            type: 'object',
            required: ['combineWith', 'conditions'],
            additionalProperties: false,
            properties: {
              combineWith: {
                type: 'string',
                enum: ['AND', 'OR']
              },
              conditions: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['field', 'operator', 'value'],
                  additionalProperties: false,
                  properties: {
                    field: {
                      type: 'string',
                      description: 'AI output field name to filter on'
                    },
                    operator: {
                      type: 'string',
                      enum: [
                        'equals',
                        'not_equals',
                        'contains',
                        'not_contains',
                        'starts_with',
                        'ends_with',
                        'matches_regex',
                        'greater_than',
                        'less_than',
                        'greater_than_or_equals',
                        'less_than_or_equals',
                        'in',
                        'not_in',
                        'is_empty',
                        'is_not_empty'
                      ]
                    },
                    value: {
                      type: ['string', 'number', 'boolean', 'null']
                    },
                    description: {
                      type: ['string', 'null']
                    }
                  }
                }
              }
            }
          }
        }
      }
    },

    // ========================================================================
    // AI OPERATIONS
    // ========================================================================

    ai_operations: {
      type: ['array', 'null'],
      items: {
        type: 'object',
        required: ['type', 'instruction', 'output_schema', 'context', 'constraints'],
        additionalProperties: false,
        properties: {
          type: {
            type: 'string',
            enum: ['summarize', 'extract', 'classify', 'sentiment', 'generate', 'decide', 'normalize', 'transform', 'validate', 'enrich', 'deterministic_extract']
          },
          // Deterministic extraction specific fields
          document_type: {
            type: 'string',
            enum: ['invoice', 'receipt', 'form', 'contract', 'auto']
          },
          ocr_fallback: {
            type: 'boolean'
          },
          instruction: {
            type: 'string'
          },
          context: {
            type: ['object', 'string', 'null']
          },
          output_schema: {
            type: 'object',
            required: ['type'],  // Only type is required - fields/items/description depend on type value
            additionalProperties: false,
            properties: {
              type: {
                type: 'string',
                enum: ['string', 'object', 'array', 'number', 'boolean']
              },
              // For object type: list of fields to extract
              fields: {
                type: ['array', 'null'],
                items: {
                  type: 'object',
                  required: ['name', 'type', 'required', 'description'],
                  additionalProperties: false,
                  properties: {
                    name: { type: 'string' },
                    type: { type: 'string' },
                    required: { type: 'boolean' },
                    description: { type: ['string', 'null'] },
                    inference: { type: ['boolean', 'null'] },
                    inferenceSource: {
                      type: ['string', 'null'],
                      enum: ['raw_text', 'extracted_fields', null]
                    }
                  }
                }
              },
              // For array type: schema of each item in the array
              items: {
                type: ['object', 'null'],
                additionalProperties: false,
                properties: {
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
                        description: { type: ['string', 'null'] },
                        inference: { type: ['boolean', 'null'] },
                        inferenceSource: {
                          type: ['string', 'null'],
                          enum: ['raw_text', 'extracted_fields', null]
                        }
                      }
                    }
                  }
                }
              },
              // For string type: description of output
              description: {
                type: ['string', 'null']
              },
              // For classification: allowed values
              enum: {
                type: ['array', 'null'],
                items: { type: 'string' }
              }
            }
          },
          constraints: {
            type: ['object', 'null'],
            required: ['max_tokens', 'temperature', 'model_preference'],
            additionalProperties: false,
            properties: {
              max_tokens: { type: ['number', 'null'] },
              temperature: { type: ['number', 'null'] },
              model_preference: {
                type: ['string', 'null'],
                enum: ['fast', 'accurate', 'balanced', null]
              }
            }
          }
        }
      }
    },

    // ========================================================================
    // PARTITIONING
    // ========================================================================

    partitions: {
      type: ['array', 'null'],
      items: {
        type: 'object',
        required: ['field', 'split_by'],  // handle_empty is optional
        additionalProperties: false,
        properties: {
          field: {
            type: 'string'
          },
          split_by: {
            type: 'string',
            enum: ['value', 'condition']
          },
          handle_empty: {
            type: ['object', 'null'],
            additionalProperties: false,
            properties: {
              partition_name: { type: 'string' },
              description: { type: ['string', 'null'] }
            }
          }
        }
      }
    },

    grouping: {
      type: ['object', 'null'],
      required: ['group_by'],
      additionalProperties: false,
      properties: {
        group_by: {
          type: ['string', 'null'],
          description: 'Field to group by, or null/"none" for no grouping'
        },
        emit_per_group: {
          type: ['boolean', 'null']
        }
      }
    },

    // ========================================================================
    // OUTPUT
    // ========================================================================

    rendering: {
      type: ['object', 'null'],
      required: ['type'],  // columns_in_order not required for all render types (e.g., summary_block, alert)
      additionalProperties: false,
      properties: {
        type: {
          type: 'string',
          enum: ['email_embedded_table', 'html_table', 'summary_block', 'alert', 'json', 'csv']
        },
        template: {
          type: ['string', 'null']
        },
        engine: {
          type: ['string', 'null'],
          enum: ['jinja', 'handlebars', 'mustache', 'none', null]
        },
        columns_in_order: {
          type: ['array', 'null'],
          items: { type: 'string' }
        },
        empty_message: {
          type: ['string', 'null']
        },
        summary_stats: {
          type: ['array', 'null'],
          description: 'Summary statistics to calculate (e.g., total_amount, count, average_amount)',
          items: { type: 'string' }
        },
        sort_order: {
          type: ['array', 'null'],
          description: 'Sorting specification derived from semantic context. Defines how output data should be ordered before rendering/delivery.',
          items: {
            type: 'object',
            required: ['field', 'direction'],
            additionalProperties: false,
            properties: {
              field: {
                type: 'string',
                description: 'Field name to sort by (can be source field or AI output field like Priority, sentiment)'
              },
              direction: {
                type: 'string',
                enum: ['asc', 'desc'],
                description: 'Sort direction: asc (ascending) or desc (descending)'
              },
              priority: {
                type: ['number', 'null'],
                description: 'Sort priority (1 = primary sort, 2 = secondary, etc.). Null defaults to order in array.'
              }
            }
          }
        }
      }
    },

    // ========================================================================
    // DELIVERY
    // ========================================================================

    delivery_rules: {
      type: 'object',
      required: ['send_when_no_results'],  // At minimum, must specify behavior for empty results
      additionalProperties: false,
      properties: {
        per_item_delivery: {
          type: ['object', 'null'],
          additionalProperties: false,
          properties: {
            recipient_source: {
              type: ['string', 'null']
            },
            cc: {
              type: ['array', 'null'],
              items: { type: 'string' }
            },
            subject: { type: ['string', 'null'] },
            body_template: { type: ['string', 'null'] },
            plugin_key: { type: ['string', 'null'] },
            operation_type: {
              type: ['string', 'null']
              // Note: operation_type must match an action name from the plugin definition
              // This is validated semantically via plugin manager, not via static enum
            }
          }
        },
        per_group_delivery: {
          type: ['object', 'null'],
          additionalProperties: false,
          properties: {
            recipient_source: {
              type: ['string', 'null']
            },
            cc: {
              type: ['array', 'null'],
              items: { type: 'string' }
            },
            subject: { type: ['string', 'null'] },
            body_template: { type: ['string', 'null'] },
            plugin_key: { type: ['string', 'null'] },
            operation_type: {
              type: ['string', 'null']
              // Note: operation_type must match an action name from the plugin definition
              // This is validated semantically via plugin manager, not via static enum
            },
            // Plugin-specific configuration (e.g., email recipients, content format)
            config: {
              type: ['object', 'null'],
              additionalProperties: true
            }
          }
        },
        summary_delivery: {
          type: ['object', 'null'],
          additionalProperties: false,
          properties: {
            recipient: { type: ['string', 'null'] },
            recipient_source: { type: ['string', 'null'] },
            cc: { type: ['array', 'null'], items: { type: 'string' } },
            subject: { type: ['string', 'null'] },
            body_template: { type: ['string', 'null'] },
            content: { type: ['string', 'object', 'null'] },  // Email body content (string or {format, body} object)
            include_missing_section: { type: ['boolean', 'null'] },
            plugin_key: { type: ['string', 'null'] },
            operation_type: {
              type: ['string', 'null']
              // Note: operation_type must match an action name from the plugin definition
              // This is validated semantically via plugin manager, not via static enum
            },
            // Plugin-specific configuration (for non-email plugins like Google Sheets)
            config: { type: ['object', 'null'] }
          }
        },
        multiple_destinations: {
          type: ['array', 'null'],
          items: {
            type: 'object',
            // ✅ FIX: Allow either 'recipient' (static) OR 'recipient_source' (dynamic from data field)
            // Per-group delivery uses recipient_source to get recipient from each group's key
            required: ['plugin_key', 'operation_type'],
            additionalProperties: false,
            properties: {
              name: { type: ['string', 'null'] },
              recipient: { type: ['string', 'null'] },  // Static recipient
              recipient_source: { type: ['string', 'null'] },  // Dynamic: field name containing recipient
              cc: { type: ['array', 'null'], items: { type: 'string' } },
              subject: { type: ['string', 'null'] },
              body_template: { type: ['string', 'null'] },
              include_missing_section: { type: ['boolean', 'null'] },
              plugin_key: { type: 'string' },
              operation_type: { type: 'string' },
              // Plugin-specific configuration (for non-email plugins like Google Sheets)
              config: { type: ['object', 'null'] }
            }
          }
        },
        send_when_no_results: {
          type: 'boolean'
        }
      }
    },

    // ========================================================================
    // ERROR HANDLING
    // ========================================================================

    edge_cases: {
      type: ['array', 'null'],
      items: {
        type: 'object',
        required: ['condition', 'action'],  // message/recipient only required for actions that notify
        additionalProperties: false,
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
          message: { type: ['string', 'null'] },
          recipient: { type: ['string', 'null'] }
        }
      }
    },

    clarifications_required: {
      type: ['array', 'null'],
      items: { type: 'string' }
    }
  }
}
