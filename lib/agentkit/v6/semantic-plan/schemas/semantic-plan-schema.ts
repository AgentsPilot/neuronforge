/**
 * Semantic Plan JSON Schema
 *
 * This schema is FLEXIBLE and PERMISSIVE - unlike the strict IR schema.
 *
 * Key Differences from IR Schema:
 * - Allows additional properties (extensible)
 * - Many fields are optional (ambiguity-tolerant)
 * - No enum enforcement (can use free-form text)
 * - Focuses on validation, not constraint
 *
 * Philosophy: The Semantic Plan is a space for the LLM to think freely.
 * We validate structure but don't force precision.
 */

export const SEMANTIC_PLAN_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: ['plan_version', 'goal', 'understanding'],
  properties: {
    plan_version: {
      type: 'string',
      enum: ['1.0'],
      description: 'Semantic plan schema version'
    },

    goal: {
      type: 'string',
      minLength: 10,
      description: 'High-level understanding of user\'s goal'
    },

    // ========================================================================
    // UNDERSTANDING - Structured but flexible
    // ========================================================================

    understanding: {
      type: 'object',
      required: ['data_sources'],  // Made delivery optional - LLM struggles to always provide it
      additionalProperties: true, // Allow extensions
      properties: {
        data_sources: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['type', 'source_description', 'location', 'role'],
            additionalProperties: true,
            properties: {
              type: {
                type: 'string',
                // Flexible types - can be user's words
              },
              source_description: { type: 'string' },
              location: { type: 'string' },
              role: { type: 'string' },
              expected_fields: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['semantic_name', 'field_name_candidates'],
                  properties: {
                    semantic_name: { type: 'string' },
                    field_name_candidates: {
                      type: 'array',
                      items: { type: 'string' }
                    },
                    expected_type: { type: 'string' },
                    required: { type: 'boolean' },
                    reasoning: { type: 'string' }
                  }
                }
              }
            }
          }
        },

        // Runtime inputs - user provides values at execution time
        runtime_inputs: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'type', 'label', 'description', 'required'],
            additionalProperties: true,
            properties: {
              name: { type: 'string' },
              type: {
                type: 'string',
                enum: ['text', 'number', 'email', 'date', 'select']
              },
              label: { type: 'string' },
              description: { type: 'string' },
              required: { type: 'boolean' },
              placeholder: { type: 'string' },
              options: {
                type: 'array',
                items: { type: 'string' }
              }
            }
          }
        },

        filtering: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            conditions: {
              type: 'array',
              items: {
                type: 'object',
                required: ['field', 'operation', 'value'],
                properties: {
                  field: { type: 'string' },
                  operation: { type: 'string' }, // Free-form
                  value: {}, // Any type
                  confidence: {
                    type: 'string',
                    enum: ['high', 'medium', 'low']
                  },
                  alternatives: {
                    type: 'array',
                    items: { type: 'string' }
                  }
                }
              }
            },
            combination_logic: {
              type: 'string',
              enum: ['AND', 'OR', 'complex']
            },
            complex_logic_explanation: { type: 'string' }
          }
        },

        ai_processing: {
          type: 'array',
          items: {
            type: 'object',
            required: ['type', 'instruction', 'input_description', 'output_description'],
            properties: {
              type: { type: 'string' },
              instruction: { type: 'string' },
              input_description: { type: 'string' },
              output_description: { type: 'string' },
              field_mappings: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    output_field: { type: 'string' },
                    source_field_candidates: {
                      type: 'array',
                      items: { type: 'string' }
                    },
                    extraction_strategy: { type: 'string' },
                    format: { type: 'string' }
                  }
                }
              }
            }
          }
        },

        grouping: {
          type: 'object',
          properties: {
            needs_grouping: { type: 'boolean' },
            group_by_field: { type: 'string' },
            strategy_description: { type: 'string' },
            per_group_action: { type: 'string' }
          }
        },

        rendering: {
          type: 'object',
          properties: {
            format: { type: 'string' },
            columns_to_include: {
              type: 'array',
              items: { type: 'string' }
            },
            column_order_preference: { type: 'string' },
            empty_message: { type: 'string' }
          }
        },

        delivery: {
          type: 'object',
          required: [],  // Made all fields optional - LLM may not always provide delivery details
          properties: {
            pattern: { type: 'string' },
            recipients_description: { type: 'string' },
            recipient_resolution_strategy: { type: 'string' },
            subject_template: { type: 'string' },
            body_description: { type: 'string' },
            cc_recipients: {
              type: 'array',
              items: { type: 'string' }
            },
            conditions: { type: 'string' }
          }
        },

        edge_cases: {
          type: 'array',
          items: {
            type: 'object',
            required: ['scenario', 'handling_strategy'],
            properties: {
              scenario: { type: 'string' },
              handling_strategy: { type: 'string' },
              notify_who: { type: 'string' }
            }
          }
        }
      }
    },

    // ========================================================================
    // ASSUMPTIONS - Critical for grounding
    // ========================================================================

    assumptions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'category', 'description', 'validation_strategy', 'impact_if_wrong'],
        properties: {
          id: { type: 'string' },
          category: {
            type: 'string',
            enum: ['field_name', 'data_type', 'value_format', 'structure', 'behavior']
          },
          description: { type: 'string' },
          confidence: {
            type: 'string',
            enum: ['high', 'medium', 'low']
          },
          validation_strategy: {
            type: 'object',
            required: ['method'],
            properties: {
              method: {
                type: 'string',
                enum: ['exact_match', 'fuzzy_match', 'data_sample', 'user_confirmation', 'heuristic']
              },
              parameters: { type: 'object' },
              threshold: { type: 'number' }
            }
          },
          impact_if_wrong: {
            type: 'string',
            enum: ['critical', 'major', 'minor']
          },
          fallback: { type: 'string' }
        }
      }
    },

    // ========================================================================
    // INFERENCES - What the LLM filled in
    // ========================================================================

    inferences: {
      type: 'array',
      items: {
        type: 'object',
        required: ['field', 'value', 'reasoning'],
        properties: {
          field: { type: 'string' },
          value: {}, // Any type
          reasoning: { type: 'string' },
          confidence: {
            type: 'string',
            enum: ['high', 'medium', 'low']
          },
          user_overridable: { type: 'boolean' }
        }
      }
    },

    // ========================================================================
    // AMBIGUITIES - Unresolved questions
    // ========================================================================

    ambiguities: {
      type: 'array',
      items: {
        type: 'object',
        required: ['field', 'question', 'possible_resolutions', 'resolution_strategy'],
        properties: {
          field: { type: 'string' },
          question: { type: 'string' },
          possible_resolutions: {
            type: 'array',
            items: { type: 'string' }
          },
          recommended_resolution: { type: 'string' },
          resolution_strategy: { type: 'string' },
          requires_user_input: { type: 'boolean' }
        }
      }
    },

    // ========================================================================
    // REASONING TRACE - Why decisions were made
    // ========================================================================

    reasoning_trace: {
      type: 'array',
      items: {
        type: 'object',
        required: ['step', 'decision', 'choice_made', 'reasoning'],
        properties: {
          step: { type: 'number' },
          decision: { type: 'string' },
          options_considered: {
            type: 'array',
            items: { type: 'string' }
          },
          choice_made: { type: 'string' },
          reasoning: { type: 'string' },
          confidence: {
            type: 'string',
            enum: ['high', 'medium', 'low']
          }
        }
      }
    },

    // ========================================================================
    // CLARIFICATIONS - Questions for the user
    // ========================================================================

    clarifications_needed: {
      type: 'array',
      items: { type: 'string' }
    }
  }
}

/**
 * Validation notes for Semantic Plans:
 *
 * Unlike IR validation (which is strict), Semantic Plan validation is permissive:
 * - We validate structure, not precision
 * - Additional properties are allowed (extensibility)
 * - Many fields are optional (ambiguity tolerance)
 * - Free-form text is accepted where appropriate
 *
 * The goal is to capture the LLM's understanding, not enforce correctness.
 * Correctness comes later, during grounding and formalization.
 */

/**
 * Strict version of SEMANTIC_PLAN_SCHEMA for OpenAI strict mode
 *
 * OpenAI's strict mode requires:
 * - additionalProperties: false on ALL objects
 * - All properties must be explicitly defined
 * - No minLength constraints (not supported in strict mode)
 *
 * This is a simplified version that enforces structure while allowing flexibility in content.
 */
export const SEMANTIC_PLAN_SCHEMA_STRICT = {
  type: 'object',
  required: ['plan_version', 'goal', 'understanding', 'assumptions', 'inferences', 'ambiguities', 'reasoning_trace', 'clarifications_needed'],
  additionalProperties: false,
  properties: {
    plan_version: {
      type: 'string',
      description: 'Semantic plan schema version (must be "1.0")'
    },
    goal: {
      type: 'string',
      description: 'High-level understanding of user\'s goal (at least 10 characters)'
    },
    understanding: {
      type: 'object',
      required: ['data_sources', 'filtering', 'ai_processing', 'grouping', 'rendering', 'delivery', 'edge_cases'],
      additionalProperties: false,
      properties: {
        data_sources: {
          type: 'array',
          items: {
            type: 'object',
            required: ['type', 'source_description', 'location', 'role'],
            additionalProperties: false,
            properties: {
              type: { type: 'string' },
              source_description: { type: 'string' },
              location: { type: 'string' },
              role: { type: 'string' }
            }
          }
        },
        filtering: {
          type: ['object', 'null'],
          required: ['description', 'conditions', 'combination_logic', 'complex_logic_explanation'],
          additionalProperties: false,
          properties: {
            description: { type: 'string' },
            conditions: {
              type: 'array',
              items: {
                type: 'object',
                required: ['field', 'operation', 'value'],
                additionalProperties: false,
                properties: {
                  field: { type: 'string' },
                  operation: { type: 'string' },
                  value: { type: 'string' }
                }
              }
            },
            combination_logic: { type: 'string' },
            complex_logic_explanation: { type: 'string' }
          }
        },
        ai_processing: {
          type: 'array',
          items: {
            type: 'object',
            required: ['type', 'instruction', 'input_description', 'output_description'],
            additionalProperties: false,
            properties: {
              type: { type: 'string' },
              instruction: { type: 'string' },
              input_description: { type: 'string' },
              output_description: { type: 'string' }
            }
          }
        },
        grouping: {
          type: ['object', 'null'],
          required: ['needs_grouping', 'group_by_field', 'strategy_description', 'per_group_action'],
          additionalProperties: false,
          properties: {
            needs_grouping: { type: 'boolean' },
            group_by_field: { type: 'string' },
            strategy_description: { type: 'string' },
            per_group_action: { type: 'string' }
          }
        },
        rendering: {
          type: ['object', 'null'],
          required: ['format', 'columns_to_include', 'column_order_preference', 'empty_message'],
          additionalProperties: false,
          properties: {
            format: { type: 'string' },
            columns_to_include: {
              type: 'array',
              items: { type: 'string' }
            },
            column_order_preference: { type: 'string' },
            empty_message: { type: 'string' }
          }
        },
        delivery: {
          type: ['object', 'null'],
          required: ['pattern', 'recipients_description', 'recipient_resolution_strategy', 'subject_template', 'body_description', 'cc_recipients', 'conditions'],
          additionalProperties: false,
          properties: {
            pattern: { type: 'string' },
            recipients_description: { type: 'string' },
            recipient_resolution_strategy: { type: 'string' },
            subject_template: { type: 'string' },
            body_description: { type: 'string' },
            cc_recipients: {
              type: 'array',
              items: { type: 'string' }
            },
            conditions: { type: 'string' }
          }
        },
        edge_cases: {
          type: ['array', 'null'],
          items: {
            type: 'object',
            required: ['scenario', 'handling_strategy', 'notify_who'],
            additionalProperties: false,
            properties: {
              scenario: { type: 'string' },
              handling_strategy: { type: 'string' },
              notify_who: { type: 'string' }
            }
          }
        }
      }
    },
    assumptions: {
      type: ['array', 'null'],
      items: {
        type: 'object',
        required: ['id', 'category', 'description', 'validation_strategy', 'impact_if_wrong', 'confidence', 'fallback'],
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          category: { type: 'string' },
          description: { type: 'string' },
          confidence: { type: 'string' },
          validation_strategy: {
            type: 'object',
            required: ['method', 'threshold'],
            additionalProperties: false,
            properties: {
              method: { type: 'string' },
              threshold: { type: 'number' }
            }
          },
          impact_if_wrong: { type: 'string' },
          fallback: { type: 'string' }
        }
      }
    },
    inferences: {
      type: ['array', 'null'],
      items: {
        type: 'object',
        required: ['field', 'value', 'reasoning', 'confidence', 'user_overridable'],
        additionalProperties: false,
        properties: {
          field: { type: 'string' },
          value: { type: 'string' },
          reasoning: { type: 'string' },
          confidence: { type: 'string' },
          user_overridable: { type: 'boolean' }
        }
      }
    },
    ambiguities: {
      type: ['array', 'null'],
      items: {
        type: 'object',
        required: ['field', 'question', 'possible_resolutions', 'resolution_strategy', 'recommended_resolution', 'requires_user_input'],
        additionalProperties: false,
        properties: {
          field: { type: 'string' },
          question: { type: 'string' },
          possible_resolutions: {
            type: 'array',
            items: { type: 'string' }
          },
          recommended_resolution: { type: 'string' },
          resolution_strategy: { type: 'string' },
          requires_user_input: { type: 'boolean' }
        }
      }
    },
    reasoning_trace: {
      type: ['array', 'null'],
      items: {
        type: 'object',
        required: ['step', 'decision', 'choice_made', 'reasoning', 'options_considered', 'confidence'],
        additionalProperties: false,
        properties: {
          step: { type: 'number' },
          decision: { type: 'string' },
          options_considered: {
            type: 'array',
            items: { type: 'string' }
          },
          choice_made: { type: 'string' },
          reasoning: { type: 'string' },
          confidence: { type: 'string' }
        }
      }
    },
    clarifications_needed: {
      type: ['array', 'null'],
      items: { type: 'string' }
    }
  }
}
