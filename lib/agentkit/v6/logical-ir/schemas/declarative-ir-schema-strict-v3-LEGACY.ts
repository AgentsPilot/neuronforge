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
    // ENRICHMENTS (Phase 2 Task 2.5 - JOIN Operations)
    // ========================================================================

    enrichments: {
      type: ['array', 'null'],
      items: {
        type: 'object',
        required: ['id', 'type', 'primary_source', 'enrichment_source', 'join_config'],
        additionalProperties: false,
        properties: {
          id: {
            type: 'string',
            description: 'Unique identifier for this enrichment'
          },
          type: {
            type: 'string',
            enum: ['join', 'lookup', 'merge', 'cross_reference'],
            description: 'Type of enrichment operation'
          },
          primary_source: {
            type: 'string',
            description: 'Reference to primary data source (by source name)'
          },
          enrichment_source: {
            type: 'string',
            description: 'Reference to enrichment data source (by source name)'
          },
          join_config: {
            type: 'object',
            required: ['join_type', 'primary_key', 'foreign_key'],
            additionalProperties: false,
            properties: {
              join_type: {
                type: 'string',
                enum: ['left', 'inner', 'right', 'full', 'lookup']
              },
              primary_key: {
                type: 'string',
                description: 'Field in primary data to match on'
              },
              foreign_key: {
                type: 'string',
                description: 'Field in enrichment data to match on'
              },
              match_strategy: {
                type: ['string', 'null'],
                enum: ['exact', 'fuzzy', 'contains', 'regex', null],
                description: 'Match strategy (default: exact)'
              },
              fuzzy_threshold: {
                type: ['number', 'null'],
                description: 'For fuzzy matching (0.0 - 1.0)'
              },
              handle_multiple_matches: {
                type: ['string', 'null'],
                enum: ['first', 'last', 'all', 'error', null],
                description: 'How to handle multiple matches (default: first)'
              },
              handle_no_match: {
                type: ['string', 'null'],
                enum: ['keep_null', 'skip_row', 'default_value', null],
                description: 'How to handle no match (default: keep_null)'
              },
              default_values: {
                type: ['object', 'null'],
                additionalProperties: true,
                description: 'Default values for enrichment fields if no match'
              }
            }
          },
          output_fields: {
            type: ['array', 'null'],
            items: { type: 'string' },
            description: 'Specific fields to pull from enrichment source (default: all)'
          },
          description: {
            type: ['string', 'null'],
            description: 'Human-readable description of this enrichment'
          }
        }
      },
      description: 'Multi-source enrichment (JOIN operations) - Phase 2 Task 2.5'
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
                  'is_not_empty',
                  'is_null',
                  'is_not_null'
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
                        'is_not_empty',
                        'is_null',
                        'is_not_null'
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
    // FILE OPERATIONS (Phase 2 Task 2.1)
    // ========================================================================

    file_operations: {
      type: ['array', 'null'],
      items: {
        type: 'object',
        required: ['type', 'output_config'],
        additionalProperties: false,
        properties: {
          type: {
            type: 'string',
            enum: ['upload_file', 'generate_pdf', 'generate_csv', 'generate_excel']
          },
          source_data: {
            type: ['string', 'null'],
            description: 'Source data variable or content'
          },
          output_config: {
            type: 'object',
            required: ['format'],
            additionalProperties: false,
            properties: {
              filename: { type: ['string', 'null'] },
              format: {
                type: 'string',
                enum: ['pdf', 'csv', 'excel', 'txt', 'json']
              },
              columns: {
                type: ['array', 'null'],
                items: { type: 'string' }
              },
              template: { type: ['string', 'null'] }
            }
          },
          upload_destination: {
            type: ['object', 'null'],
            required: ['plugin_key', 'operation_type', 'location'],
            additionalProperties: false,
            properties: {
              plugin_key: {
                type: 'string',
                enum: ['google-drive', 'aws-s3', 'dropbox', 'onedrive']
              },
              operation_type: {
                type: 'string',
                enum: ['upload']
              },
              location: { type: 'string' },
              overwrite: { type: ['boolean', 'null'] },
              permissions: { type: ['string', 'null'] }
            }
          }
        }
      }
    },

    // ========================================================================
    // CONDITIONALS (Phase 2 Task 2.3)
    // ========================================================================

    conditionals: {
      type: ['array', 'null'],
      items: {
        type: 'object',
        required: ['condition', 'then_actions'],
        additionalProperties: false,
        properties: {
          id: { type: ['string', 'null'] },
          description: { type: ['string', 'null'] },
          condition: {
            type: 'object',
            required: ['type'],
            additionalProperties: false,
            properties: {
              type: {
                type: 'string',
                enum: ['simple', 'complex']
              },
              field: { type: ['string', 'null'] },
              operator: {
                type: ['string', 'null'],
                enum: ['equals', 'not_equals', 'contains', 'greater_than', 'less_than', 'is_empty', 'is_not_empty', 'in', null]
              },
              value: { type: ['string', 'number', 'boolean', 'null'] },
              combineWith: {
                type: ['string', 'null'],
                enum: ['AND', 'OR', null]
              },
              conditions: {
                type: ['array', 'null'],
                items: { type: 'object' }
              }
            }
          },
          then_actions: {
            type: 'array',
            items: {
              type: 'object',
              required: ['type'],
              additionalProperties: false,
              properties: {
                type: {
                  type: 'string',
                  enum: ['set_field', 'skip_delivery', 'use_template', 'send_to_recipient', 'abort', 'continue']
                },
                field: { type: ['string', 'null'] },
                value: { type: ['string', 'number', 'boolean', 'null'] },
                params: { type: ['object', 'null'] },
                description: { type: ['string', 'null'] }
              }
            }
          },
          elif_branches: {
            type: ['array', 'null'],
            items: {
              type: 'object',
              required: ['condition', 'actions'],
              additionalProperties: false,
              properties: {
                condition: { type: 'object' },
                actions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['type'],
                    additionalProperties: false,
                    properties: {
                      type: {
                        type: 'string',
                        enum: ['set_field', 'skip_delivery', 'use_template', 'send_to_recipient', 'abort', 'continue']
                      },
                      field: { type: ['string', 'null'] },
                      value: { type: ['string', 'number', 'boolean', 'null'] },
                      params: { type: ['object', 'null'] },
                      description: { type: ['string', 'null'] }
                    }
                  }
                }
              }
            }
          },
          else_actions: {
            type: ['array', 'null'],
            items: {
              type: 'object',
              required: ['type'],
              additionalProperties: false,
              properties: {
                type: {
                  type: 'string',
                  enum: ['set_field', 'skip_delivery', 'use_template', 'send_to_recipient', 'abort', 'continue']
                },
                field: { type: ['string', 'null'] },
                value: { type: ['string', 'number', 'boolean', 'null'] },
                params: { type: ['object', 'null'] },
                description: { type: ['string', 'null'] }
              }
            }
          }
        }
      }
    },

    // ========================================================================
    // NESTED LOOPS (Phase 2 Task 2.7)
    // ========================================================================

    loops: {
      type: ['array', 'null'],
      items: {
        type: 'object',
        required: ['id', 'loop_type', 'loop_over', 'steps'],
        additionalProperties: false,
        properties: {
          id: {
            type: 'string',
            description: 'Unique identifier for this loop'
          },
          loop_type: {
            type: 'string',
            enum: ['for_each', 'while', 'range', 'nested_items'],
            description: 'Type of loop'
          },
          loop_over: {
            type: 'string',
            description: 'Variable or field to loop over (e.g., "items", "attachments")'
          },
          item_variable: {
            type: ['string', 'null'],
            description: 'Variable name for current item (default: "item")'
          },
          depth: {
            type: ['number', 'null'],
            description: 'Nesting depth (1 = outer loop, 2 = nested once, etc.)'
          },
          max_iterations: {
            type: ['number', 'null'],
            description: 'Safety limit (default: 1000)'
          },
          steps: {
            type: 'array',
            items: {
              type: 'object',
              required: ['type'],
              additionalProperties: false,
              properties: {
                type: {
                  type: 'string',
                  enum: ['ai_operation', 'filter', 'transform', 'action', 'conditional']
                },
                operation: { type: ['object', 'null'] },
                filter: { type: ['object', 'null'] },
                transform: { type: ['object', 'null'] },
                action: { type: ['object', 'null'] },
                conditional: { type: ['object', 'null'] },
                description: { type: ['string', 'null'] }
              }
            }
          },
          nested_loops: {
            type: ['array', 'null'],
            items: { type: 'object' },
            description: 'Child loops (for 2-3 level nesting)'
          },
          break_condition: {
            type: ['object', 'null'],
            description: 'Optional early exit condition'
          },
          description: {
            type: ['string', 'null'],
            description: 'Human-readable description of this loop'
          }
        }
      },
      description: 'Explicit nested loop support (2-3 levels) - Phase 2 Task 2.7'
    },

    // ========================================================================
    // EXECUTION CONSTRAINTS (Retry, Timeout, Rate Limiting, Concurrency)
    // ========================================================================

    execution_constraints: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        retry: {
          type: ['object', 'null'],
          additionalProperties: false,
          properties: {
            max_attempts: {
              type: 'number',
              minimum: 1,
              maximum: 10,
              description: 'Maximum number of retry attempts'
            },
            backoff_strategy: {
              type: 'string',
              enum: ['linear', 'exponential', 'fixed'],
              description: 'Backoff strategy for retries'
            },
            initial_delay_ms: {
              type: 'number',
              minimum: 0,
              description: 'Initial delay in milliseconds before first retry'
            },
            max_delay_ms: {
              type: ['number', 'null'],
              description: 'Maximum delay in milliseconds between retries'
            },
            retry_on_errors: {
              type: ['array', 'null'],
              items: { type: 'string' },
              description: 'Error codes to retry on (e.g., rate_limit, timeout, server_error)'
            }
          },
          required: ['max_attempts', 'backoff_strategy', 'initial_delay_ms']
        },
        timeout: {
          type: ['object', 'null'],
          additionalProperties: false,
          properties: {
            total_workflow_timeout_ms: {
              type: ['number', 'null'],
              description: 'Maximum time for entire workflow execution'
            },
            step_timeout_ms: {
              type: ['number', 'null'],
              description: 'Maximum time per workflow step'
            },
            data_fetch_timeout_ms: {
              type: ['number', 'null'],
              description: 'Maximum time for data source fetches'
            }
          }
        },
        rate_limiting: {
          type: ['object', 'null'],
          additionalProperties: false,
          properties: {
            strategy: {
              type: 'string',
              enum: ['token_bucket', 'sliding_window', 'fixed_window'],
              description: 'Rate limiting strategy'
            },
            max_requests_per_window: {
              type: 'number',
              description: 'Maximum requests allowed per window'
            },
            window_duration_ms: {
              type: 'number',
              description: 'Duration of rate limit window in milliseconds'
            },
            burst_allowance: {
              type: ['number', 'null'],
              description: 'Allow bursts up to this limit'
            }
          }
        },
        concurrency: {
          type: ['object', 'null'],
          additionalProperties: false,
          properties: {
            max_concurrent_operations: {
              type: 'number',
              minimum: 1,
              description: 'Maximum concurrent operations (e.g., parallel API calls)'
            },
            max_concurrent_deliveries: {
              type: 'number',
              minimum: 1,
              description: 'Maximum concurrent deliveries (e.g., parallel emails)'
            },
            per_recipient_delay_ms: {
              type: ['number', 'null'],
              description: 'Delay between deliveries to same recipient'
            }
          }
        }
      },
      description: 'Execution constraints for reliability and performance - retry, timeout, rate limiting, concurrency'
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
          },
          preserve_fields: {
            type: ['array', 'null'],
            items: { type: 'string' },
            description: 'Fields to preserve from parent context (added by WorkflowPatternValidator Pattern 1)'
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
        },
        preserve_fields: {
          type: ['array', 'null'],
          items: { type: 'string' },
          description: 'Fields to preserve from parent context when processing nested data (added by pattern validator)'
        },
        preserve_parent_fields: {
          type: ['boolean', 'null'],
          description: 'Whether to preserve parent fields when flattening nested data (added by WorkflowPatternValidator Pattern 1)'
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
            },
            // Plugin-specific configuration (e.g., for Google Sheets append_rows)
            config: {
              type: ['object', 'null'],
              additionalProperties: true
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
              config: { type: ['object', 'null'] },
              // Execution scope - specifies when this operation runs
              execution_scope: {
                type: ['string', 'null'],
                enum: ['summary', 'per_item', 'per_group', null]
              }
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
    },

    // ========================================================================
    // CROSS-STEP VARIABLES (Phase 2 Task 2.6)
    // ========================================================================

    cross_step_variables: {
      type: ['array', 'null'],
      items: {
        type: 'object',
        required: ['name', 'scope'],
        additionalProperties: false,
        properties: {
          name: {
            type: 'string',
            description: 'Variable name (e.g., "uploaded_file_url", "total_count")'
          },
          source_step: {
            type: ['string', 'null'],
            description: 'Step that produces this variable (optional, compiler can infer)'
          },
          source_field: {
            type: ['string', 'null'],
            description: 'Field or expression to extract (e.g., "step_3.fileUrl", "items.length")'
          },
          type: {
            type: ['string', 'null'],
            enum: ['string', 'number', 'boolean', 'object', 'array', null],
            description: 'Data type (optional)'
          },
          scope: {
            type: 'string',
            enum: ['workflow', 'loop', 'branch'],
            description: 'Where this variable is accessible'
          },
          description: {
            type: ['string', 'null'],
            description: 'What this variable represents'
          },
          initial_value: {
            type: ['string', 'number', 'boolean', 'object', 'array', 'null'],
            description: 'Initial/default value'
          },
          persist_across_iterations: {
            type: ['boolean', 'null'],
            description: 'For loop-scoped variables (default: false)'
          }
        }
      },
      description: 'Cross-step variable tracking - Phase 2 Task 2.6'
    }
  }
}
