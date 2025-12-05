/**
 * Pilot DSL JSON Schema for OpenAI Structured Outputs
 *
 * This schema defines the complete Pilot workflow DSL structure for use with
 * OpenAI's strict JSON schema mode. It enforces correct field names and types
 * at generation time, preventing LLM hallucinations.
 *
 * Design Approach:
 * - Flattened union: All 15 step types merged into single WorkflowStep object
 * - Recursive expansion: 5 levels of nesting for loops/scatter-gather/sub-workflows
 * - Condition merging: All 3 condition types (string, simple, complex) in one schema
 * - Type discrimination: 'type' field acts as discriminator (enum of 15 values)
 *
 * OpenAI Strict Mode Limitations:
 * - No oneOf/anyOf/allOf support → Using flattened union
 * - Bounded recursion only → Manually expanded 5 levels
 * - additionalProperties must be false → All fields explicitly defined
 *
 * @module lib/pilot/schema/pilot-dsl-schema
 */

export const PILOT_DSL_SCHEMA = {
  type: "object",
  properties: {
    agent_name: {
      type: "string",
      description: "Name of the agent"
    },
    description: {
      type: "string",
      description: "Description of what the agent does"
    },
    system_prompt: {
      type: "string",
      description: "System prompt for LLM execution"
    },
    workflow_type: {
      type: "string",
      enum: ["pure_ai", "data_retrieval_ai", "ai_external_actions"],
      description: "Type of workflow"
    },
    suggested_plugins: {
      type: "array",
      items: { type: "string" },
      description: "List of plugins used in the workflow"
    },
    required_inputs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          type: {
            type: "string",
            enum: ["text", "email", "number", "file", "select", "url", "date", "textarea"]
          },
          label: { type: "string" },
          required: { type: "boolean" },
          description: { type: "string" },
          placeholder: { type: "string" },
          reasoning: { type: "string" }
        },
        required: ["name", "type", "required", "description", "reasoning"],
        additionalProperties: false
      },
      description: "Input fields required by the workflow"
    },
    workflow_steps: {
      type: "array",
      items: { "$ref": "#/$defs/WorkflowStepLevel1" },
      description: "Array of workflow steps to execute"
    },
    suggested_outputs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          type: {
            type: "string",
            enum: ["SummaryBlock", "EmailDraft", "PluginAction", "Alert"]
          },
          category: {
            type: "string",
            enum: ["human-facing", "machine-facing"]
          },
          description: { type: "string" },
          format: {
            type: "string",
            enum: ["table", "list", "markdown", "html", "json", "text"]
          },
          plugin: { type: "string" },
          reasoning: { type: "string" }
        },
        required: ["name", "type", "category", "description", "reasoning"],
        additionalProperties: false
      },
      description: "Suggested output formats for the workflow"
    },
    reasoning: {
      type: "string",
      description: "Reasoning for the overall workflow design"
    },
    confidence: {
      type: "number",
      description: "Confidence score for the workflow design (0-1)",
      minimum: 0,
      maximum: 1
    }
  },
  required: [
    "agent_name",
    "description",
    "system_prompt",
    "workflow_type",
    "suggested_plugins",
    "required_inputs",
    "workflow_steps",
    "suggested_outputs",
    "reasoning",
    "confidence"
  ],
  additionalProperties: false,
  "$defs": {
    "Condition": {
      type: "object",
      description: "Condition for conditional execution with discriminator for strict mode compatibility",
      properties: {
        // Discriminator field (REQUIRED for strict mode)
        conditionType: {
          type: "string",
          enum: ["simple", "complex_and", "complex_or", "complex_not"],
          description: "Type of condition (discriminator for strict mode). Use 'simple' for field/operator/value comparisons, 'complex_and/or/not' for logical operations."
        },
        // Simple condition fields (used when conditionType="simple")
        field: {
          type: "string",
          description: "Field path to evaluate (e.g., 'step1.data.score'). Required for simple conditions."
        },
        operator: {
          type: "string",
          enum: [
            "==", "!=", ">", ">=", "<", "<=",
            "equals", "not_equals",
            "greater_than", "greater_than_or_equal",
            "less_than", "less_than_or_equal",
            "contains", "not_contains",
            "in", "not_in",
            "exists", "not_exists",
            "is_empty", "is_not_empty",
            "matches", "starts_with", "ends_with"
          ],
          description: "Comparison operator. Required for simple conditions."
        },
        value: {
          type: "string",
          description: "Value to compare against (use string representation for any type). Required for simple conditions."
        },
        // Complex condition fields (used when conditionType starts with "complex_")
        conditions: {
          type: "array",
          items: { "$ref": "#/$defs/Condition" },
          description: "Array of conditions for AND/OR operations. Required for complex_and and complex_or."
        },
        condition: {
          "$ref": "#/$defs/Condition",
          description: "Single condition for NOT operation. Required for complex_not."
        }
      },
      required: ["conditionType"],  // conditionType is REQUIRED for strict mode
      additionalProperties: false
    },
    "WorkflowStepLevel1": {
      type: "object",
      description: "Workflow step (Level 1 - can contain nested steps up to Level 5)",
      properties: {
        // Universal fields (all step types)
        id: {
          type: "string",
          description: "Unique identifier for this step"
        },
        name: {
          type: "string",
          description: "Human-readable name for this step"
        },
        type: {
          type: "string",
          enum: [
            "action",
            "ai_processing",
            "llm_decision",
            "conditional",
            "loop",
            "parallel_group",
            "switch",
            "scatter_gather",
            "transform",
            "delay",
            "enrichment",
            "validation",
            "comparison",
            "sub_workflow",
            "human_approval"
          ],
          description: "Type of step to execute"
        },
        description: {
          type: "string",
          description: "Optional description of what this step does"
        },
        dependencies: {
          type: "array",
          items: { type: "string" },
          description: "Array of step IDs that must complete before this step"
        },
        continueOnError: {
          type: "boolean",
          description: "Whether to continue workflow if this step fails"
        },

        // Action step fields
        plugin: {
          type: "string",
          description: "Plugin name (for action steps)"
        },
        action: {
          type: "string",
          description: "Action name within plugin (for action steps)"
        },
        params: {
          type: "object",
          description: "Parameters to pass to the action (for action and ai_processing steps)",
          additionalProperties: true
        },

        // AI Processing / LLM Decision fields
        prompt: {
          type: "string",
          description: "Prompt for AI processing or LLM decision steps"
        },

        // Conditional step fields
        condition: {
          "$ref": "#/$defs/Condition",
          description: "Condition to evaluate (for conditional steps)"
        },
        trueBranch: {
          type: "string",
          description: "Step ID to execute if condition is true"
        },
        falseBranch: {
          type: "string",
          description: "Step ID to execute if condition is false"
        },
        executeIf: {
          "$ref": "#/$defs/Condition",
          description: "Optional condition for conditional execution of any step"
        },

        // Loop step fields
        iterateOver: {
          type: "string",
          description: "Variable reference to array to iterate over (e.g., '{{step1.data.emails}}')"
        },
        loopSteps: {
          type: "array",
          items: { "$ref": "#/$defs/WorkflowStepLevel2" },
          description: "Steps to execute in each loop iteration"
        },
        maxIterations: {
          type: "number",
          description: "Maximum number of loop iterations (safety limit)",
          minimum: 1,
          maximum: 1000
        },
        parallel: {
          type: "boolean",
          description: "Whether to execute loop iterations in parallel"
        },

        // Parallel group fields
        steps: {
          type: "array",
          items: { "$ref": "#/$defs/WorkflowStepLevel2" },
          description: "Steps to execute in parallel (for parallel_group steps)"
        },
        maxConcurrency: {
          type: "number",
          description: "Maximum concurrent executions",
          minimum: 1,
          maximum: 10
        },

        // Switch step fields
        evaluate: {
          type: "string",
          description: "Expression to evaluate for switch statement"
        },
        cases: {
          type: "object",
          description: "Map of case values to step IDs to execute",
          additionalProperties: {
            type: "array",
            items: { type: "string" }
          }
        },
        default: {
          type: "array",
          items: { type: "string" },
          description: "Step IDs to execute if no case matches"
        },

        // Scatter-gather step fields
        scatter: {
          type: "object",
          description: "Scatter configuration for scatter-gather pattern",
          properties: {
            input: {
              type: "string",
              description: "Array to scatter over"
            },
            steps: {
              type: "array",
              items: { "$ref": "#/$defs/WorkflowStepLevel2" },
              description: "Steps to execute for each scattered item"
            },
            maxConcurrency: {
              type: "number",
              minimum: 1,
              maximum: 10
            },
            itemVariable: {
              type: "string",
              description: "Variable name for the item in each iteration (default: 'item')"
            }
          },
          required: [],
          additionalProperties: false
        },
        gather: {
          type: "object",
          description: "Gather configuration for aggregating scattered results",
          properties: {
            operation: {
              type: "string",
              enum: ["collect", "merge", "reduce"],
              description: "How to aggregate the results"
            },
            outputKey: {
              type: "string",
              description: "DEPRECATED: This field is ignored. Results are always stored in {{stepN.data}}"
            },
            reduceExpression: {
              type: "string",
              description: "Expression for custom reduce operation"
            }
          },
          required: ["operation"],
          additionalProperties: false
        },

        // Transform step fields
        operation: {
          type: "string",
          enum: ["map", "filter", "reduce", "sort", "group", "aggregate", "join", "match", "deduplicate"],
          description: "Transform operation type"
        },
        input: {
          type: "string",
          description: "Input data reference for transform operations"
        },
        config: {
          type: "object",
          description: "Configuration for transform operation",
          additionalProperties: true
        },

        // Delay step fields
        duration: {
          type: "number",
          description: "Duration to wait in milliseconds",
          minimum: 0
        },

        // Enrichment step fields
        sources: {
          type: "array",
          items: {
            type: "object",
            properties: {
              key: { type: "string" },
              from: { type: "string" }
            },
            required: ["key", "from"],
            additionalProperties: false
          },
          description: "Data sources to enrich from"
        },
        strategy: {
          type: "string",
          enum: ["merge", "deep_merge", "join"],
          description: "Enrichment strategy"
        },
        joinOn: {
          type: "string",
          description: "Field to join on for enrichment"
        },
        mergeArrays: {
          type: "boolean",
          description: "Whether to merge arrays during enrichment"
        },

        // Validation step fields
        schema: {
          type: "object",
          description: "JSON schema for validation",
          additionalProperties: true
        },
        rules: {
          type: "array",
          items: {
            type: "object",
            properties: {
              field: { type: "string" },
              condition: { "$ref": "#/$defs/Condition" },
              message: { type: "string" }
            },
            required: ["field", "condition"],
            additionalProperties: false
          },
          description: "Validation rules"
        },
        onValidationFail: {
          type: "string",
          enum: ["throw", "continue", "skip"],
          description: "Action to take on validation failure"
        },

        // Comparison step fields
        left: {
          type: "string",
          description: "Left value for comparison"
        },
        right: {
          type: "string",
          description: "Right value for comparison"
        },
        outputFormat: {
          type: "string",
          enum: ["boolean", "diff", "detailed"],
          description: "Format of comparison output"
        },

        // Sub-workflow step fields
        workflowId: {
          type: "string",
          description: "ID of workflow to execute as sub-workflow"
        },
        workflowSteps: {
          type: "array",
          items: { "$ref": "#/$defs/WorkflowStepLevel2" },
          description: "Inline workflow steps for sub-workflow"
        },
        inputs: {
          type: "object",
          description: "Input mapping for sub-workflow",
          additionalProperties: true
        },
        outputMapping: {
          type: "object",
          description: "Output mapping from sub-workflow",
          additionalProperties: true
        },
        timeout: {
          type: "number",
          description: "Timeout for sub-workflow in milliseconds",
          minimum: 0
        },
        inheritContext: {
          type: "boolean",
          description: "Whether sub-workflow inherits parent context"
        },
        onError: {
          type: "string",
          enum: ["throw", "continue", "return_error"],
          description: "Action on sub-workflow error"
        },

        // Human approval step fields
        approvers: {
          type: "array",
          items: { type: "string" },
          description: "List of user IDs who can approve"
        },
        approvalType: {
          type: "string",
          enum: ["any", "all", "majority"],
          description: "Approval requirement type"
        },
        notificationChannels: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: ["email", "webhook", "slack", "teams"]
              },
              config: {
                type: "object",
                additionalProperties: true
              }
            },
            required: ["type", "config"],
            additionalProperties: false
          },
          description: "Notification channels for approval request"
        },
        title: {
          type: "string",
          description: "Title of approval request"
        },
        message: {
          type: "string",
          description: "Message for approval request"
        },
        context: {
          type: "object",
          description: "Context data for approval decision",
          additionalProperties: true
        },
        onTimeout: {
          type: "string",
          enum: ["approve", "reject", "escalate"],
          description: "Action on approval timeout"
        },
        escalateTo: {
          type: "array",
          items: { type: "string" },
          description: "User IDs to escalate to on timeout"
        },
        requireComment: {
          type: "boolean",
          description: "Whether comment is required for approval"
        },
        allowDelegate: {
          type: "boolean",
          description: "Whether approver can delegate to another user"
        }
      },
      required: ["id", "name", "type"],
      additionalProperties: false
    },
    "WorkflowStepLevel2": {
      type: "object",
      description: "Workflow step (Level 2 - can contain nested steps up to Level 5)",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        type: {
          type: "string",
          enum: [
            "action", "ai_processing", "llm_decision", "conditional", "loop",
            "parallel_group", "switch", "scatter_gather", "transform", "delay",
            "enrichment", "validation", "comparison", "sub_workflow", "human_approval"
          ]
        },
        description: { type: "string" },
        dependencies: { type: "array", items: { type: "string" } },
        continueOnError: { type: "boolean" },
        plugin: { type: "string" },
        action: { type: "string" },
        params: { type: "object", additionalProperties: true },
        prompt: { type: "string" },
        condition: { "$ref": "#/$defs/Condition" },
        trueBranch: { type: "string" },
        falseBranch: { type: "string" },
        executeIf: { "$ref": "#/$defs/Condition" },
        iterateOver: { type: "string" },
        loopSteps: {
          type: "array",
          items: { "$ref": "#/$defs/WorkflowStepLevel3" }
        },
        maxIterations: { type: "number", minimum: 1, maximum: 1000 },
        parallel: { type: "boolean" },
        steps: {
          type: "array",
          items: { "$ref": "#/$defs/WorkflowStepLevel3" }
        },
        maxConcurrency: { type: "number", minimum: 1, maximum: 10 },
        evaluate: { type: "string" },
        cases: {
          type: "object",
          additionalProperties: { type: "array", items: { type: "string" } }
        },
        default: { type: "array", items: { type: "string" } },
        scatter: {
          type: "object",
          properties: {
            input: { type: "string" },
            steps: {
              type: "array",
              items: { "$ref": "#/$defs/WorkflowStepLevel3" }
            },
            maxConcurrency: { type: "number", minimum: 1, maximum: 10 },
            itemVariable: { type: "string" }
          },
          required: [],
          additionalProperties: false
        },
        gather: {
          type: "object",
          properties: {
            operation: { type: "string", enum: ["collect", "merge", "reduce"] },
            outputKey: { type: "string" },
            reduceExpression: { type: "string" }
          },
          required: ["operation"],
          additionalProperties: false
        },
        operation: {
          type: "string",
          enum: ["map", "filter", "reduce", "sort", "group", "aggregate", "join", "match", "deduplicate", "equals", "deep_equals", "diff", "contains", "subset"]
        },
        input: { type: "string" },
        config: { type: "object", additionalProperties: true },
        duration: { type: "number", minimum: 0 },
        sources: {
          type: "array",
          items: {
            type: "object",
            properties: {
              key: { type: "string" },
              from: { type: "string" }
            },
            required: ["key", "from"],
            additionalProperties: false
          }
        },
        strategy: { type: "string", enum: ["merge", "deep_merge", "join"] },
        joinOn: { type: "string" },
        mergeArrays: { type: "boolean" },
        schema: { type: "object", additionalProperties: true },
        rules: {
          type: "array",
          items: {
            type: "object",
            properties: {
              field: { type: "string" },
              condition: { "$ref": "#/$defs/Condition" },
              message: { type: "string" }
            },
            required: ["field", "condition"],
            additionalProperties: false
          }
        },
        onValidationFail: { type: "string", enum: ["throw", "continue", "skip"] },
        left: { type: "string" },
        right: { type: "string" },
        outputFormat: { type: "string", enum: ["boolean", "diff", "detailed"] },
        workflowId: { type: "string" },
        workflowSteps: {
          type: "array",
          items: { "$ref": "#/$defs/WorkflowStepLevel3" }
        },
        inputs: { type: "object", additionalProperties: true },
        outputMapping: { type: "object", additionalProperties: true },
        timeout: { type: "number", minimum: 0 },
        inheritContext: { type: "boolean" },
        onError: { type: "string", enum: ["throw", "continue", "return_error"] },
        approvers: { type: "array", items: { type: "string" } },
        approvalType: { type: "string", enum: ["any", "all", "majority"] },
        notificationChannels: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["email", "webhook", "slack", "teams"] },
              config: { type: "object", additionalProperties: true }
            },
            required: ["type", "config"],
            additionalProperties: false
          }
        },
        title: { type: "string" },
        message: { type: "string" },
        context: { type: "object", additionalProperties: true },
        onTimeout: { type: "string", enum: ["approve", "reject", "escalate"] },
        escalateTo: { type: "array", items: { type: "string" } },
        requireComment: { type: "boolean" },
        allowDelegate: { type: "boolean" }
      },
      required: ["id", "name", "type"],
      additionalProperties: false
    },
    "WorkflowStepLevel3": {
      type: "object",
      description: "Workflow step (Level 3 - can contain nested steps up to Level 5)",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        type: {
          type: "string",
          enum: [
            "action", "ai_processing", "llm_decision", "conditional", "loop",
            "parallel_group", "switch", "scatter_gather", "transform", "delay",
            "enrichment", "validation", "comparison", "sub_workflow", "human_approval"
          ]
        },
        description: { type: "string" },
        dependencies: { type: "array", items: { type: "string" } },
        continueOnError: { type: "boolean" },
        plugin: { type: "string" },
        action: { type: "string" },
        params: { type: "object", additionalProperties: true },
        prompt: { type: "string" },
        condition: { "$ref": "#/$defs/Condition" },
        trueBranch: { type: "string" },
        falseBranch: { type: "string" },
        executeIf: { "$ref": "#/$defs/Condition" },
        iterateOver: { type: "string" },
        loopSteps: {
          type: "array",
          items: { "$ref": "#/$defs/WorkflowStepLevel4" }
        },
        maxIterations: { type: "number", minimum: 1, maximum: 1000 },
        parallel: { type: "boolean" },
        steps: {
          type: "array",
          items: { "$ref": "#/$defs/WorkflowStepLevel4" }
        },
        maxConcurrency: { type: "number", minimum: 1, maximum: 10 },
        evaluate: { type: "string" },
        cases: {
          type: "object",
          additionalProperties: { type: "array", items: { type: "string" } }
        },
        default: { type: "array", items: { type: "string" } },
        scatter: {
          type: "object",
          properties: {
            input: { type: "string" },
            steps: {
              type: "array",
              items: { "$ref": "#/$defs/WorkflowStepLevel4" }
            },
            maxConcurrency: { type: "number", minimum: 1, maximum: 10 },
            itemVariable: { type: "string" }
          },
          required: [],
          additionalProperties: false
        },
        gather: {
          type: "object",
          properties: {
            operation: { type: "string", enum: ["collect", "merge", "reduce"] },
            outputKey: { type: "string" },
            reduceExpression: { type: "string" }
          },
          required: ["operation"],
          additionalProperties: false
        },
        operation: {
          type: "string",
          enum: ["map", "filter", "reduce", "sort", "group", "aggregate", "join", "match", "deduplicate", "equals", "deep_equals", "diff", "contains", "subset"]
        },
        input: { type: "string" },
        config: { type: "object", additionalProperties: true },
        duration: { type: "number", minimum: 0 },
        sources: {
          type: "array",
          items: {
            type: "object",
            properties: {
              key: { type: "string" },
              from: { type: "string" }
            },
            required: ["key", "from"],
            additionalProperties: false
          }
        },
        strategy: { type: "string", enum: ["merge", "deep_merge", "join"] },
        joinOn: { type: "string" },
        mergeArrays: { type: "boolean" },
        schema: { type: "object", additionalProperties: true },
        rules: {
          type: "array",
          items: {
            type: "object",
            properties: {
              field: { type: "string" },
              condition: { "$ref": "#/$defs/Condition" },
              message: { type: "string" }
            },
            required: ["field", "condition"],
            additionalProperties: false
          }
        },
        onValidationFail: { type: "string", enum: ["throw", "continue", "skip"] },
        left: { type: "string" },
        right: { type: "string" },
        outputFormat: { type: "string", enum: ["boolean", "diff", "detailed"] },
        workflowId: { type: "string" },
        workflowSteps: {
          type: "array",
          items: { "$ref": "#/$defs/WorkflowStepLevel4" }
        },
        inputs: { type: "object", additionalProperties: true },
        outputMapping: { type: "object", additionalProperties: true },
        timeout: { type: "number", minimum: 0 },
        inheritContext: { type: "boolean" },
        onError: { type: "string", enum: ["throw", "continue", "return_error"] },
        approvers: { type: "array", items: { type: "string" } },
        approvalType: { type: "string", enum: ["any", "all", "majority"] },
        notificationChannels: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["email", "webhook", "slack", "teams"] },
              config: { type: "object", additionalProperties: true }
            },
            required: ["type", "config"],
            additionalProperties: false
          }
        },
        title: { type: "string" },
        message: { type: "string" },
        context: { type: "object", additionalProperties: true },
        onTimeout: { type: "string", enum: ["approve", "reject", "escalate"] },
        escalateTo: { type: "array", items: { type: "string" } },
        requireComment: { type: "boolean" },
        allowDelegate: { type: "boolean" }
      },
      required: ["id", "name", "type"],
      additionalProperties: false
    },
    "WorkflowStepLevel4": {
      type: "object",
      description: "Workflow step (Level 4 - can contain nested steps up to Level 5)",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        type: {
          type: "string",
          enum: [
            "action", "ai_processing", "llm_decision", "conditional", "loop",
            "parallel_group", "switch", "scatter_gather", "transform", "delay",
            "enrichment", "validation", "comparison", "sub_workflow", "human_approval"
          ]
        },
        description: { type: "string" },
        dependencies: { type: "array", items: { type: "string" } },
        continueOnError: { type: "boolean" },
        plugin: { type: "string" },
        action: { type: "string" },
        params: { type: "object", additionalProperties: true },
        prompt: { type: "string" },
        condition: { "$ref": "#/$defs/Condition" },
        trueBranch: { type: "string" },
        falseBranch: { type: "string" },
        executeIf: { "$ref": "#/$defs/Condition" },
        iterateOver: { type: "string" },
        loopSteps: {
          type: "array",
          items: { "$ref": "#/$defs/WorkflowStepLevel5" }
        },
        maxIterations: { type: "number", minimum: 1, maximum: 1000 },
        parallel: { type: "boolean" },
        steps: {
          type: "array",
          items: { "$ref": "#/$defs/WorkflowStepLevel5" }
        },
        maxConcurrency: { type: "number", minimum: 1, maximum: 10 },
        evaluate: { type: "string" },
        cases: {
          type: "object",
          additionalProperties: { type: "array", items: { type: "string" } }
        },
        default: { type: "array", items: { type: "string" } },
        scatter: {
          type: "object",
          properties: {
            input: { type: "string" },
            steps: {
              type: "array",
              items: { "$ref": "#/$defs/WorkflowStepLevel5" }
            },
            maxConcurrency: { type: "number", minimum: 1, maximum: 10 },
            itemVariable: { type: "string" }
          },
          required: [],
          additionalProperties: false
        },
        gather: {
          type: "object",
          properties: {
            operation: { type: "string", enum: ["collect", "merge", "reduce"] },
            outputKey: { type: "string" },
            reduceExpression: { type: "string" }
          },
          required: ["operation"],
          additionalProperties: false
        },
        operation: {
          type: "string",
          enum: ["map", "filter", "reduce", "sort", "group", "aggregate", "join", "match", "deduplicate", "equals", "deep_equals", "diff", "contains", "subset"]
        },
        input: { type: "string" },
        config: { type: "object", additionalProperties: true },
        duration: { type: "number", minimum: 0 },
        sources: {
          type: "array",
          items: {
            type: "object",
            properties: {
              key: { type: "string" },
              from: { type: "string" }
            },
            required: ["key", "from"],
            additionalProperties: false
          }
        },
        strategy: { type: "string", enum: ["merge", "deep_merge", "join"] },
        joinOn: { type: "string" },
        mergeArrays: { type: "boolean" },
        schema: { type: "object", additionalProperties: true },
        rules: {
          type: "array",
          items: {
            type: "object",
            properties: {
              field: { type: "string" },
              condition: { "$ref": "#/$defs/Condition" },
              message: { type: "string" }
            },
            required: ["field", "condition"],
            additionalProperties: false
          }
        },
        onValidationFail: { type: "string", enum: ["throw", "continue", "skip"] },
        left: { type: "string" },
        right: { type: "string" },
        outputFormat: { type: "string", enum: ["boolean", "diff", "detailed"] },
        workflowId: { type: "string" },
        workflowSteps: {
          type: "array",
          items: { "$ref": "#/$defs/WorkflowStepLevel5" }
        },
        inputs: { type: "object", additionalProperties: true },
        outputMapping: { type: "object", additionalProperties: true },
        timeout: { type: "number", minimum: 0 },
        inheritContext: { type: "boolean" },
        onError: { type: "string", enum: ["throw", "continue", "return_error"] },
        approvers: { type: "array", items: { type: "string" } },
        approvalType: { type: "string", enum: ["any", "all", "majority"] },
        notificationChannels: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["email", "webhook", "slack", "teams"] },
              config: { type: "object", additionalProperties: true }
            },
            required: ["type", "config"],
            additionalProperties: false
          }
        },
        title: { type: "string" },
        message: { type: "string" },
        context: { type: "object", additionalProperties: true },
        onTimeout: { type: "string", enum: ["approve", "reject", "escalate"] },
        escalateTo: { type: "array", items: { type: "string" } },
        requireComment: { type: "boolean" },
        allowDelegate: { type: "boolean" }
      },
      required: ["id", "name", "type"],
      additionalProperties: false
    },
    "WorkflowStepLevel5": {
      type: "object",
      description: "Workflow step (Level 5 - MAXIMUM DEPTH, no further nesting allowed)",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        type: {
          type: "string",
          enum: [
            "action", "ai_processing", "llm_decision", "conditional", "delay",
            "transform", "enrichment", "validation", "comparison", "human_approval"
          ]
        },
        description: { type: "string" },
        dependencies: { type: "array", items: { type: "string" } },
        continueOnError: { type: "boolean" },
        plugin: { type: "string" },
        action: { type: "string" },
        params: { type: "object", additionalProperties: true },
        prompt: { type: "string" },
        condition: { "$ref": "#/$defs/Condition" },
        trueBranch: { type: "string" },
        falseBranch: { type: "string" },
        executeIf: { "$ref": "#/$defs/Condition" },
        evaluate: { type: "string" },
        cases: {
          type: "object",
          additionalProperties: { type: "array", items: { type: "string" } }
        },
        default: { type: "array", items: { type: "string" } },
        operation: {
          type: "string",
          enum: ["map", "filter", "reduce", "sort", "group", "aggregate", "join", "match", "deduplicate", "equals", "deep_equals", "diff", "contains", "subset"]
        },
        input: { type: "string" },
        config: { type: "object", additionalProperties: true },
        duration: { type: "number", minimum: 0 },
        sources: {
          type: "array",
          items: {
            type: "object",
            properties: {
              key: { type: "string" },
              from: { type: "string" }
            },
            required: ["key", "from"],
            additionalProperties: false
          }
        },
        strategy: { type: "string", enum: ["merge", "deep_merge", "join"] },
        joinOn: { type: "string" },
        mergeArrays: { type: "boolean" },
        schema: { type: "object", additionalProperties: true },
        rules: {
          type: "array",
          items: {
            type: "object",
            properties: {
              field: { type: "string" },
              condition: { "$ref": "#/$defs/Condition" },
              message: { type: "string" }
            },
            required: ["field", "condition"],
            additionalProperties: false
          }
        },
        onValidationFail: { type: "string", enum: ["throw", "continue", "skip"] },
        left: { type: "string" },
        right: { type: "string" },
        outputFormat: { type: "string", enum: ["boolean", "diff", "detailed"] },
        workflowId: { type: "string" },
        inputs: { type: "object", additionalProperties: true },
        outputMapping: { type: "object", additionalProperties: true },
        timeout: { type: "number", minimum: 0 },
        inheritContext: { type: "boolean" },
        onError: { type: "string", enum: ["throw", "continue", "return_error"] },
        approvers: { type: "array", items: { type: "string" } },
        approvalType: { type: "string", enum: ["any", "all", "majority"] },
        notificationChannels: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["email", "webhook", "slack", "teams"] },
              config: { type: "object", additionalProperties: true }
            },
            required: ["type", "config"],
            additionalProperties: false
          }
        },
        title: { type: "string" },
        message: { type: "string" },
        context: { type: "object", additionalProperties: true },
        onTimeout: { type: "string", enum: ["approve", "reject", "escalate"] },
        escalateTo: { type: "array", items: { type: "string" } },
        requireComment: { type: "boolean" },
        allowDelegate: { type: "boolean" }
      },
      required: ["id", "name", "type"],
      additionalProperties: false
    }
  }
};

/**
 * Estimate schema size in bytes
 * Used to verify we're under OpenAI's 100KB limit
 */
export function getSchemaSize(): number {
  return JSON.stringify(PILOT_DSL_SCHEMA).length;
}

/**
 * Get schema statistics for monitoring
 */
export function getSchemaStats() {
  const schemaStr = JSON.stringify(PILOT_DSL_SCHEMA);
  return {
    sizeBytes: schemaStr.length,
    sizeKB: (schemaStr.length / 1024).toFixed(2),
    isUnderLimit: schemaStr.length < 100000,
    stepTypes: 15,
    nestingLevels: 5,
    conditionOperators: 23
  };
}
