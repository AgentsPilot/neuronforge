# V6 Pure Declarative Architecture - Production Readiness Roadmap

**Date:** 2025-12-25
**Status:** ROADMAP DEFINED
**Goal:** Make V6 production-ready for ALL workflow patterns

---

## Executive Summary

Based on the comprehensive gap analysis, this roadmap outlines the path to production readiness across ALL future scenarios.

**Current State:**
- ✅ Excellent foundation for tabular + API + AI workflows
- ❌ Critical gaps prevent database, conditional, file, and webhook workflows

**Target State:**
- ✅ Support ALL workflow patterns listed in gap analysis
- ✅ Production-ready error handling and retry logic
- ✅ Comprehensive testing coverage
- ✅ Complete documentation

**Timeline:** 18-24 weeks (Phase 1-3)

---

## Phase 1: Production Essentials (4-6 weeks)

**Goal:** Enable critical workflows (database, conditionals, error handling, files, webhooks)

### 1.1 Conditional Branching (Week 1)

**Priority:** CRITICAL
**Complexity:** Medium
**Impact:** Enables if/then/else workflows

#### Schema Changes

**File:** `lib/agentkit/v6/logical-ir/schemas/declarative-ir-schema-strict.ts`

```typescript
conditionals: {
  type: ['array', 'null'],
  items: {
    type: 'object',
    required: ['condition', 'then_actions', 'else_actions'],
    additionalProperties: false,
    properties: {
      condition: {
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
                field: { type: 'string' },
                operator: {
                  type: 'string',
                  enum: [
                    'equals', 'not_equals', 'contains',
                    'greater_than', 'less_than', 'in',
                    'is_empty', 'is_not_empty'
                  ]
                },
                value: { type: ['string', 'number', 'boolean', 'null'] }
              }
            }
          }
        }
      },
      then_actions: {
        type: 'object',
        required: ['delivery_rules'],
        additionalProperties: false,
        properties: {
          delivery_rules: {
            // Same structure as main delivery_rules
          }
        }
      },
      else_actions: {
        type: ['object', 'null'],
        required: ['delivery_rules'],
        additionalProperties: false,
        properties: {
          delivery_rules: {
            // Same structure as main delivery_rules
          }
        }
      }
    }
  }
}
```

#### Compiler Changes

**File:** `lib/agentkit/v6/compiler/DeclarativeCompiler.ts`

```typescript
/**
 * Compile conditionals into PILOT conditional steps
 */
private compileConditionals(
  ir: DeclarativeLogicalIR,
  ctx: CompilerContext
): WorkflowStep[] {
  if (!ir.conditionals || ir.conditionals.length === 0) {
    return []
  }

  const steps: WorkflowStep[] = []

  ir.conditionals.forEach((conditional, idx) => {
    // Build condition
    const condition = this.buildConditionExpression(conditional.condition)

    // Compile then branch
    const thenSteps = this.compileDeliveryRules(
      conditional.then_actions.delivery_rules,
      ctx
    )

    // Compile else branch (if exists)
    const elseSteps = conditional.else_actions
      ? this.compileDeliveryRules(conditional.else_actions.delivery_rules, ctx)
      : []

    steps.push({
      step_id: this.generateStepId(`conditional_${idx}`, ctx),
      type: 'conditional',
      condition,
      then_steps: thenSteps,
      else_steps: elseSteps
    })
  })

  return steps
}

/**
 * Build condition expression from filter-style condition
 */
private buildConditionExpression(condition: any): string {
  const conditions = condition.conditions.map((c: any) => {
    const field = `{{${c.field}}}`
    const value = typeof c.value === 'string' ? `"${c.value}"` : c.value

    switch (c.operator) {
      case 'equals': return `${field} == ${value}`
      case 'not_equals': return `${field} != ${value}`
      case 'contains': return `${field}.includes(${value})`
      case 'greater_than': return `${field} > ${value}`
      case 'less_than': return `${field} < ${value}`
      case 'in': return `${value}.includes(${field})`
      case 'is_empty': return `!${field} || ${field} == ""`
      case 'is_not_empty': return `${field} && ${field} != ""`
      default: return `${field} == ${value}`
    }
  })

  return condition.combineWith === 'OR'
    ? conditions.join(' || ')
    : conditions.join(' && ')
}
```

#### Tests

**File:** `lib/agentkit/v6/compiler/__tests__/conditionals.test.ts`

```typescript
describe('Conditional Compilation', () => {
  it('compiles simple if/then conditional', () => {
    const ir = {
      conditionals: [{
        condition: {
          combineWith: 'AND',
          conditions: [{
            field: 'amount',
            operator: 'greater_than',
            value: 1000
          }]
        },
        then_actions: {
          delivery_rules: {
            summary_delivery: {
              recipient: 'manager@company.com',
              subject: 'High-value lead alert'
            }
          }
        }
      }]
    }

    const result = compileDeclarativeIR(ir)
    expect(result.workflow.steps).toContainEqual(
      expect.objectContaining({
        type: 'conditional',
        condition: expect.stringContaining('> 1000')
      })
    )
  })
})
```

**Deliverables:**
- ✅ Schema updated with conditionals
- ✅ Compiler logic implemented
- ✅ Unit tests passing
- ✅ Integration test with real workflow

---

### 1.2 Execution Constraints (Retry, Timeout, Rate Limiting) (Week 2)

**Priority:** CRITICAL
**Complexity:** Medium-High
**Impact:** Production reliability and API quota management

#### Schema Changes

```typescript
execution_constraints: {
  type: ['object', 'null'],
  required: ['retry', 'timeout_ms', 'rate_limit'],
  additionalProperties: false,
  properties: {
    retry: {
      type: ['object', 'null'],
      required: ['max_attempts', 'backoff_strategy', 'initial_delay_ms', 'max_delay_ms'],
      additionalProperties: false,
      properties: {
        max_attempts: {
          type: 'number',
          description: 'Maximum retry attempts (1-10)'
        },
        backoff_strategy: {
          type: 'string',
          enum: ['fixed', 'linear', 'exponential'],
          description: 'Backoff strategy between retries'
        },
        initial_delay_ms: {
          type: 'number',
          description: 'Initial delay in milliseconds'
        },
        max_delay_ms: {
          type: 'number',
          description: 'Maximum delay in milliseconds'
        },
        retry_on_errors: {
          type: ['array', 'null'],
          items: {
            type: 'string',
            enum: [
              'rate_limit', 'timeout', 'network_error',
              'server_error', 'temporary_failure'
            ]
          }
        }
      }
    },
    timeout_ms: {
      type: ['number', 'null'],
      description: 'Maximum execution time in milliseconds'
    },
    rate_limit: {
      type: ['object', 'null'],
      required: ['max_per_second', 'max_per_minute', 'strategy'],
      additionalProperties: false,
      properties: {
        max_per_second: { type: ['number', 'null'] },
        max_per_minute: { type: ['number', 'null'] },
        max_per_hour: { type: ['number', 'null'] },
        strategy: {
          type: 'string',
          enum: ['token_bucket', 'sliding_window', 'fixed_window']
        }
      }
    }
  }
}
```

#### Compiler Changes

```typescript
/**
 * Wrap steps with retry logic
 */
private wrapWithRetry(
  step: WorkflowStep,
  retryConfig: RetryConfig
): WorkflowStep {
  return {
    step_id: `${step.step_id}_retry_wrapper`,
    type: 'retry_wrapper',
    config: {
      max_attempts: retryConfig.max_attempts,
      backoff_strategy: retryConfig.backoff_strategy,
      initial_delay_ms: retryConfig.initial_delay_ms,
      max_delay_ms: retryConfig.max_delay_ms,
      retry_on_errors: retryConfig.retry_on_errors
    },
    wrapped_step: step
  }
}

/**
 * Add rate limiter step before API calls
 */
private addRateLimiter(
  steps: WorkflowStep[],
  rateLimitConfig: RateLimitConfig
): WorkflowStep[] {
  return [{
    step_id: 'rate_limiter_init',
    type: 'rate_limiter',
    config: {
      max_per_second: rateLimitConfig.max_per_second,
      max_per_minute: rateLimitConfig.max_per_minute,
      max_per_hour: rateLimitConfig.max_per_hour,
      strategy: rateLimitConfig.strategy
    }
  }, ...steps]
}
```

**Deliverables:**
- ✅ Schema updated with execution constraints
- ✅ Retry wrapper compilation
- ✅ Rate limiter injection
- ✅ Timeout handling
- ✅ Tests for all constraints

---

### 1.3 Database Integration (Read/Write) (Weeks 3-4)

**Priority:** CRITICAL
**Complexity:** High
**Impact:** Enables database workflows

#### Schema Changes

```typescript
// Data source enhancement
data_sources: {
  // ... existing fields ...
  database_config: {
    type: ['object', 'null'],
    required: ['connection', 'query', 'table'],
    additionalProperties: false,
    properties: {
      connection: {
        type: 'object',
        required: ['plugin_key', 'credentials_ref'],
        properties: {
          plugin_key: {
            type: 'string',
            enum: ['postgres', 'mysql', 'mongodb', 'supabase', 'sqlite']
          },
          credentials_ref: { type: 'string' }
        }
      },
      query: { type: ['string', 'null'] },
      table: { type: ['string', 'null'] },
      limit: { type: ['number', 'null'] },
      offset: { type: ['number', 'null'] }
    }
  }
}

// Delivery enhancement
delivery_rules: {
  // ... existing fields ...
  database_delivery: {
    type: ['object', 'null'],
    required: ['plugin_key', 'table', 'operation', 'key_fields', 'conflict_strategy'],
    additionalProperties: false,
    properties: {
      plugin_key: {
        type: 'string',
        enum: ['postgres', 'mysql', 'mongodb', 'supabase', 'sqlite']
      },
      table: { type: 'string' },
      operation: {
        type: 'string',
        enum: ['insert', 'update', 'upsert', 'delete']
      },
      key_fields: {
        type: ['array', 'null'],
        items: { type: 'string' }
      },
      conflict_strategy: {
        type: 'string',
        enum: ['replace', 'skip', 'error', 'merge']
      },
      credentials_ref: { type: 'string' }
    }
  }
}
```

#### Plugin Integration

**File:** `lib/agentkit/v6/plugins/database/postgres-plugin.json`

```json
{
  "plugin_name": "postgres",
  "display_name": "PostgreSQL",
  "description": "PostgreSQL database integration",
  "version": "1.0.0",
  "actions": {
    "query": {
      "description": "Execute SQL query",
      "parameters": {
        "type": "object",
        "required": ["query"],
        "properties": {
          "query": { "type": "string" },
          "params": { "type": "array" }
        }
      },
      "output_schema": {
        "type": "array",
        "items": { "type": "object" }
      }
    },
    "insert": {
      "description": "Insert rows",
      "parameters": {
        "type": "object",
        "required": ["table", "data"],
        "properties": {
          "table": { "type": "string" },
          "data": { "type": "array" }
        }
      }
    }
  }
}
```

**Deliverables:**
- ✅ Database config in schema
- ✅ PostgreSQL plugin integration
- ✅ MySQL plugin integration
- ✅ Compiler logic for database read/write
- ✅ Connection pooling
- ✅ Transaction support
- ✅ Tests with real databases (using test containers)

---

### 1.4 File Operations (Upload/Download) (Week 5)

**Priority:** CRITICAL
**Complexity:** Medium
**Impact:** Report generation and file processing

#### Schema Changes

```typescript
// Delivery enhancement
delivery_rules: {
  // ... existing fields ...
  file_delivery: {
    type: ['object', 'null'],
    required: ['format', 'destination', 'filename_template', 'options'],
    additionalProperties: false,
    properties: {
      format: {
        type: 'string',
        enum: ['csv', 'json', 'pdf', 'xlsx', 'txt']
      },
      destination: {
        type: 'object',
        required: ['plugin_key', 'path'],
        properties: {
          plugin_key: {
            type: 'string',
            enum: ['google-drive', 's3', 'dropbox', 'local']
          },
          path: { type: 'string' },
          credentials_ref: { type: ['string', 'null'] }
        }
      },
      filename_template: {
        type: 'string',
        description: 'Filename with variable interpolation, e.g., "report_{{date}}.csv"'
      },
      options: {
        type: 'object',
        required: ['overwrite', 'public'],
        properties: {
          overwrite: { type: 'boolean' },
          public: { type: 'boolean' },
          content_type: { type: ['string', 'null'] }
        }
      }
    }
  }
}
```

#### Compiler Changes

```typescript
/**
 * Compile file delivery
 */
private compileFileDelivery(
  ir: DeclarativeLogicalIR,
  ctx: CompilerContext
): WorkflowStep[] {
  const fileDelivery = ir.delivery_rules.file_delivery
  if (!fileDelivery) return []

  const steps: WorkflowStep[] = []

  // Step 1: Format conversion
  steps.push({
    step_id: this.generateStepId('format_data', ctx),
    type: 'transform',
    operation: `to_${fileDelivery.format}`,
    config: {
      data: `{{${ctx.currentVariable}}}`,
      format: fileDelivery.format
    },
    output_variable: 'formatted_data'
  })

  // Step 2: Upload to destination
  const pluginResolution = this.pluginResolver.resolveFileUpload(
    fileDelivery.destination.plugin_key
  )

  steps.push({
    step_id: this.generateStepId('upload_file', ctx),
    type: 'plugin',
    plugin: pluginResolution.plugin_name,
    operation: pluginResolution.operation,
    config: {
      data: '{{formatted_data}}',
      path: fileDelivery.destination.path,
      filename: fileDelivery.filename_template,
      overwrite: fileDelivery.options.overwrite,
      public: fileDelivery.options.public
    },
    output_variable: 'file_upload_result'
  })

  return steps
}
```

**Deliverables:**
- ✅ File delivery in schema
- ✅ CSV/JSON/PDF/XLSX format converters
- ✅ Google Drive plugin
- ✅ S3 plugin
- ✅ Compiler logic
- ✅ Tests with mocked file storage

---

### 1.5 Webhook Support (Week 6)

**Priority:** CRITICAL
**Complexity:** High
**Impact:** Event-driven workflows

#### Schema Changes

```typescript
data_sources: {
  // ... existing fields ...
  webhook_config: {
    type: ['object', 'null'],
    required: ['event_type', 'validation', 'payload_schema', 'response'],
    additionalProperties: false,
    properties: {
      event_type: {
        type: 'string',
        description: 'Type of webhook event to listen for'
      },
      validation: {
        type: 'object',
        required: ['method', 'secret_ref', 'signature_header'],
        properties: {
          method: {
            type: 'string',
            enum: ['hmac-sha256', 'token', 'basic-auth', 'none']
          },
          secret_ref: { type: ['string', 'null'] },
          signature_header: { type: ['string', 'null'] }
        }
      },
      payload_schema: {
        // Output schema structure
      },
      response: {
        type: 'object',
        required: ['status_code', 'body'],
        properties: {
          status_code: { type: 'number' },
          body: { type: 'string' }
        }
      }
    }
  }
}
```

#### Webhook Registration

**File:** `lib/agentkit/v6/webhooks/WebhookManager.ts`

```typescript
export class WebhookManager {
  async registerWebhook(
    workflowId: string,
    webhookConfig: WebhookConfig
  ): Promise<{ webhook_url: string }> {
    // Generate unique webhook URL
    const webhookUrl = `/webhooks/${workflowId}/${generateId()}`

    // Register webhook endpoint
    await this.db.webhooks.insert({
      workflow_id: workflowId,
      path: webhookUrl,
      event_type: webhookConfig.event_type,
      validation_method: webhookConfig.validation.method,
      secret_ref: webhookConfig.validation.secret_ref,
      signature_header: webhookConfig.validation.signature_header,
      payload_schema: webhookConfig.payload_schema
    })

    return { webhook_url: `${this.baseUrl}${webhookUrl}` }
  }

  async validateWebhookSignature(
    webhookId: string,
    payload: any,
    headers: Record<string, string>
  ): Promise<boolean> {
    const webhook = await this.db.webhooks.findById(webhookId)

    switch (webhook.validation_method) {
      case 'hmac-sha256':
        return this.validateHMAC(payload, headers, webhook.secret_ref)
      case 'token':
        return this.validateToken(headers, webhook.secret_ref)
      default:
        return true
    }
  }
}
```

**Deliverables:**
- ✅ Webhook config in schema
- ✅ Webhook registration system
- ✅ Payload validation (HMAC, token, basic auth)
- ✅ Webhook endpoint handler
- ✅ Response template system
- ✅ Tests with mocked webhook calls

---

## Phase 2: Advanced Features (6-8 weeks)

**Goal:** Support complex workflows and scaling

### 2.1 Multi-Source Merge (Weeks 7-8)

**Schema Changes:**
```typescript
data_merge: {
  type: ['object', 'null'],
  required: ['strategy', 'sources', 'join_config'],
  properties: {
    strategy: {
      type: 'string',
      enum: ['union', 'join', 'left_join', 'merge']
    },
    sources: {
      type: 'array',
      items: {
        type: 'object',
        required: ['source_index', 'alias'],
        properties: {
          source_index: { type: 'number' },
          alias: { type: 'string' }
        }
      }
    },
    join_config: {
      type: ['object', 'null'],
      required: ['left_key', 'right_key'],
      properties: {
        left_key: { type: 'string' },
        right_key: { type: 'string' }
      }
    }
  }
}
```

### 2.2 Custom Transformations (Weeks 9-10)

**Schema Changes:**
```typescript
transforms: {
  type: ['array', 'null'],
  items: {
    type: 'object',
    required: ['type', 'config'],
    properties: {
      type: {
        type: 'string',
        enum: [
          'map', 'filter', 'reduce', 'sort',
          'deduplicate', 'enrich', 'aggregate',
          'pivot', 'unpivot', 'format'
        ]
      },
      config: {
        // Type-specific configuration
      }
    }
  }
}
```

### 2.3 Multi-Stage AI Pipelines (Weeks 11-12)

**Schema Changes:**
```typescript
ai_operations: {
  items: {
    // ... existing fields ...
    stage: { type: 'number' },
    depends_on: {
      type: ['array', 'null'],
      items: { type: 'string' }
    },
    input_source: { type: ['string', 'null'] },
    output_variable: { type: 'string' }
  }
}
```

### 2.4 Rate Limiting (Week 13)

Already covered in Phase 1.2 execution constraints.

### 2.5 Scheduled Execution (Week 14)

**Schema Changes:**
```typescript
schedule: {
  type: ['object', 'null'],
  required: ['type', 'enabled'],
  properties: {
    type: {
      type: 'string',
      enum: ['cron', 'interval', 'event']
    },
    cron_expression: { type: ['string', 'null'] },
    interval_minutes: { type: ['number', 'null'] },
    timezone: { type: ['string', 'null'] },
    enabled: { type: 'boolean' },
    start_date: { type: ['string', 'null'] },
    end_date: { type: ['string', 'null'] }
  }
}
```

---

## Phase 3: Enterprise Features (8-10 weeks)

**Goal:** Enable enterprise deployment

### 3.1 Stream Processing (Weeks 15-17)
### 3.2 Advanced Validation (Weeks 18-19)
### 3.3 Concurrency Control (Weeks 20-21)
### 3.4 Plugin Versioning (Week 22)
### 3.5 Multi-Tenant Support (Weeks 23-24)

---

## Testing Strategy

### Unit Tests
- Schema validation for all new fields
- Compiler logic for each feature
- Plugin resolution for new operation types

### Integration Tests
- End-to-end workflow tests
- Real plugin integration (mocked OAuth)
- Error scenario testing

### Performance Tests
- Large datasets (10,000+ rows)
- Concurrent workflow execution
- API rate limiting scenarios

---

## Documentation Requirements

### For Each Feature:
1. IR Schema reference with examples
2. Compilation behavior explanation
3. Best practices guide
4. Troubleshooting section

### Overall Documentation:
1. Migration guide from V2/V5 to V6
2. Plugin development guide
3. Performance optimization guide
4. Security best practices

---

## Success Criteria

### Phase 1 Complete When:
- ✅ All 5 critical features implemented
- ✅ 90%+ test coverage
- ✅ Documentation complete
- ✅ Production deployment successful for pilot customers

### Phase 2 Complete When:
- ✅ All 5 advanced features implemented
- ✅ Performance benchmarks met (1000+ rows, 100+ concurrent workflows)
- ✅ Customer feedback incorporated

### Phase 3 Complete When:
- ✅ Enterprise features deployed
- ✅ Multi-tenant isolation verified
- ✅ Security audit passed
- ✅ Scalability benchmarks met (10,000+ rows, 1000+ concurrent workflows)

---

## Risk Mitigation

### Technical Risks:
1. **Complex compilation logic** → Incremental implementation with extensive tests
2. **Plugin compatibility** → Plugin versioning system
3. **Performance degradation** → Continuous benchmarking
4. **Breaking changes** → Semantic versioning + migration guides

### Schedule Risks:
1. **Feature scope creep** → Strict adherence to roadmap
2. **Dependency delays** → Parallel work streams where possible
3. **Testing bottlenecks** → Automated testing infrastructure

---

## Next Steps

1. **Week 1:** Start Phase 1.1 (Conditional Branching)
2. **Week 2:** Complete Phase 1.1, start Phase 1.2 (Execution Constraints)
3. **Week 3-4:** Phase 1.3 (Database Integration)
4. **Week 5:** Phase 1.4 (File Operations)
5. **Week 6:** Phase 1.5 (Webhook Support)
6. **Week 7:** Phase 1 review, start Phase 2

**Deployment Strategy:**
- Deploy Phase 1 features to staging after Week 6
- Pilot with 3-5 customers for 2 weeks
- Collect feedback and iterate
- Production deployment after successful pilot

---

**Status:** READY TO BEGIN IMPLEMENTATION
**Next Review:** After Phase 1 completion (Week 6)
**Owner:** V6 Development Team
