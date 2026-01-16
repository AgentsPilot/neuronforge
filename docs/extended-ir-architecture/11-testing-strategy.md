# Testing Strategy

## Test Pyramid

```
        /\
       /  \        E2E Tests (5%)
      /    \       - Full workflow creation → execution
     /      \      - User journey tests
    /--------\     
   /          \    Integration Tests (25%)
  /            \   - IR generation → compilation
 /              \  - Compiler rules → DSL output
/----------------\ 
|                | Unit Tests (70%)
|                | - Schema validation
|                | - Resolvers
|                | - Translators
------------------
```

## Unit Tests (70%)

### Schema Validation Tests

```typescript
// lib/agentkit/v6/logical-ir/schemas/__tests__/validation.test.ts

describe('Extended IR Schema Validation', () => {
  it('validates valid IR', () => {
    const ir = {
      ir_version: '2.0',
      goal: 'Test workflow',
      data_sources: [{ id: 'test', type: 'tabular', location: 'Sheet1' }],
      delivery: [{ id: 'email1', method: 'email', config: {} }],
      clarifications_required: []
    }

    const result = validateIR(ir)
    expect(result.valid).toBe(true)
  })

  it('rejects IR with missing required fields', () => {
    const ir = { ir_version: '2.0' }
    const result = validateIR(ir)
    
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Missing required field: goal')
  })

  it('rejects IR with execution tokens', () => {
    const ir = {
      ir_version: '2.0',
      goal: 'Test',
      data_sources: [{ type: 'tabular', plugin: 'google-sheets' }],  // ❌ "plugin" not allowed
      delivery: [],
      clarifications_required: []
    }

    const result = validateIR(ir)
    expect(result.valid).toBe(false)
  })
})
```

### Compiler Rule Tests

```typescript
// lib/agentkit/v6/compiler/rules/__tests__/TabularGroupedDeliveryRule.test.ts

describe('TabularGroupedDeliveryRule', () => {
  let rule: TabularGroupedDeliveryRule
  let context: CompilerContext

  beforeEach(() => {
    rule = new TabularGroupedDeliveryRule()
    context = mockCompilerContext()
  })

  it('supports tabular grouped delivery pattern', () => {
    const ir = {
      data_sources: [{ type: 'tabular', location: 'Leads' }],
      grouping: { group_by: 'Sales Person' },
      delivery: [{ method: 'email' }]
    }

    expect(rule.supports(ir)).toBe(true)
  })

  it('compiles to correct workflow steps', () => {
    const ir = createTabularIR()
    const result = rule.compile(ir, context)

    expect(result.success).toBe(true)
    expect(result.workflow.workflow_steps).toHaveLength(4)
    expect(result.workflow.workflow_steps[0].type).toBe('action')  // Read
    expect(result.workflow.workflow_steps[1].type).toBe('transform')  // Filter
    expect(result.workflow.workflow_steps[2].type).toBe('transform')  // Partition
    expect(result.workflow.workflow_steps[3].type).toBe('scatter_gather')  // Loop
  })

  it('generates zero ai_processing steps for deterministic operations', () => {
    const ir = createTabularIR()
    const result = rule.compile(ir, context)

    const aiSteps = result.workflow.workflow_steps.filter(s => s.type === 'ai_processing')
    expect(aiSteps).toHaveLength(0)
  })
})
```

### Resolver Tests

```typescript
// lib/agentkit/v6/compiler/resolvers/__tests__/TransformResolver.test.ts

describe('TransformResolver', () => {
  let resolver: TransformResolver

  beforeEach(() => {
    resolver = new TransformResolver()
  })

  it('resolves filter to transform step', () => {
    const filter = {
      id: 'stage_filter',
      field: 'stage',
      operator: 'equals',
      value: 4
    }

    const step = resolver.resolveFilter(filter)

    expect(step.type).toBe('transform')
    expect(step.operation).toBe('filter')
    expect(step.config.condition.field).toBe('stage')
    expect(step.config.condition.value).toBe(4)
  })

  it('resolves grouping to transform step', () => {
    const grouping = {
      group_by: 'Sales Person'
    }

    const step = resolver.resolveGrouping(grouping)

    expect(step.type).toBe('transform')
    expect(step.operation).toBe('group')
    expect(step.config.group_by).toBe('Sales Person')
  })
})
```

### Natural Language Translator Tests

```typescript
// lib/agentkit/v6/translation/__tests__/IRToNaturalLanguageTranslator.test.ts

describe('IRToNaturalLanguageTranslator', () => {
  let translator: IRToNaturalLanguageTranslator

  beforeEach(() => {
    translator = new IRToNaturalLanguageTranslator()
  })

  it('translates data sources correctly', () => {
    const ir = {
      data_sources: [{ type: 'tabular', location: 'MyLeads', tab: 'Sheet1' }]
    }

    const plan = translator.translate(ir)

    expect(plan.steps[0].icon).toBe('📊')
    expect(plan.steps[0].title).toBe('Read data')
    expect(plan.steps[0].details).toContain('From Google Sheet: "MyLeads"')
  })

  it('translates filters to plain English', () => {
    const ir = {
      filters: [{ field: 'stage', operator: 'equals', value: 4 }]
    }

    const plan = translator.translate(ir)

    expect(plan.steps).toContainEqual(
      expect.objectContaining({
        icon: '🔍',
        details: expect.arrayContaining([
          'Keep only rows where stage = 4'
        ])
      })
    )
  })
})
```

## Integration Tests (25%)

### IR Generation → Compilation

```typescript
// __tests__/integration/ir-to-dsl.test.ts

describe('IR to DSL Integration', () => {
  it('generates and compiles tabular workflow end-to-end', async () => {
    const enhancedPrompt = createEnhancedPrompt()

    // 1. Generate IR
    const irGenerator = new EnhancedPromptToIRGenerator()
    const ir = await irGenerator.generateIR(enhancedPrompt)

    // 2. Validate IR
    const validation = validateIR(ir)
    expect(validation.valid).toBe(true)

    // 3. Compile IR
    const compiler = new LogicalIRCompiler(mockPlugins)
    const result = compiler.compile(ir)

    // 4. Assert compilation success
    expect(result.success).toBe(true)
    expect(result.workflow.workflow_steps.length).toBeGreaterThan(0)
    expect(result.metadata.compiler_rule).toBeDefined()
  })

  it('handles correction and recompilation', async () => {
    const ir = createValidIR()
    const correction = "Actually filter stage 5 instead"

    // 1. Apply correction
    const correctionHandler = new NaturalLanguageCorrectionHandler()
    const updatedIR = await correctionHandler.handleCorrection(ir, correction)

    // 2. Verify IR updated
    expect(updatedIR.filters[0].value).toBe(5)

    // 3. Recompile
    const compiler = new LogicalIRCompiler(mockPlugins)
    const result = compiler.compile(updatedIR)

    // 4. Assert recompilation success
    expect(result.success).toBe(true)
  })
})
```

### API Endpoint Tests

```typescript
// app/api/generate-workflow-plan/__tests__/route.test.ts

describe('POST /api/generate-workflow-plan', () => {
  it('generates valid plan from enhanced prompt', async () => {
    const response = await POST(
      new Request('http://localhost/api/generate-workflow-plan', {
        method: 'POST',
        body: JSON.stringify({ enhancedPrompt: mockEnhancedPrompt })
      })
    )

    const data = await response.json()

    expect(data.plan).toBeDefined()
    expect(data.plan.goal).toBeDefined()
    expect(data.plan.steps).toBeInstanceOf(Array)
    expect(data.ir).toBeDefined()
  })

  it('returns 400 for invalid enhanced prompt', async () => {
    const response = await POST(
      new Request('http://localhost/api/generate-workflow-plan', {
        method: 'POST',
        body: JSON.stringify({ enhancedPrompt: {} })
      })
    )

    expect(response.status).toBe(400)
  })
})
```

## E2E Tests (5%)

### Full Workflow Creation Flow

```typescript
// e2e/workflow-creation.spec.ts

describe('Workflow Creation (Extended IR)', () => {
  it('creates workflow from conversational UI to execution', async () => {
    // 1. Start conversational builder
    await page.goto('/agents/new/chat')

    // 2. Answer clarification questions
    await answerQuestions(page)

    // 3. Approve enhanced prompt
    await page.click('[data-testid="approve-enhanced-prompt"]')

    // 4. Wait for plan preview
    await page.waitForSelector('[data-testid="workflow-plan-preview"]')

    // 5. Verify plan is shown
    const planText = await page.textContent('[data-testid="plan-steps"]')
    expect(planText).toContain('Read data')
    expect(planText).toContain('Filter')

    // 6. Approve plan
    await page.click('[data-testid="approve-plan"]')

    // 7. Wait for Smart Builder
    await page.waitForSelector('[data-testid="smart-agent-builder"]')

    // 8. Create agent
    await page.click('[data-testid="create-agent"]')

    // 9. Verify agent created
    await expect(page).toHaveURL(/\/agents\/[a-z0-9-]+/)
  })

  it('handles plan corrections', async () => {
    // ... navigate to plan preview
    await navigateToPlanPreview(page)

    // 1. Click edit
    await page.click('[data-testid="edit-plan"]')

    // 2. Enter correction
    await page.fill('textarea[placeholder*="change"]', 'Actually filter stage 5')

    // 3. Submit correction
    await page.click('[data-testid="update-plan"]')

    // 4. Verify plan updated
    await page.waitForSelector('text=stage = 5')
    expect(await page.textContent('[data-testid="plan-steps"]')).toContain('stage = 5')
  })
})
```

## Performance Tests

```typescript
describe('Performance Benchmarks', () => {
  it('compiles IR in under 100ms', async () => {
    const ir = createComplexIR()
    const compiler = new LogicalIRCompiler(plugins)

    const start = Date.now()
    const result = compiler.compile(ir)
    const duration = Date.now() - start

    expect(result.success).toBe(true)
    expect(duration).toBeLessThan(100)
  })

  it('translates IR to English in under 50ms', () => {
    const ir = createComplexIR()
    const translator = new IRToNaturalLanguageTranslator()

    const start = Date.now()
    const plan = translator.translate(ir)
    const duration = Date.now() - start

    expect(plan.steps.length).toBeGreaterThan(0)
    expect(duration).toBeLessThan(50)
  })
})
```

## Regression Tests

```typescript
describe('Regression Tests', () => {
  it('V6 generates same DSL as V4 for simple workflows', async () => {
    const enhancedPrompt = createSimplePrompt()

    // V4 path
    const v4Generator = new V4WorkflowGenerator(...)
    const v4Result = await v4Generator.generate(enhancedPrompt)

    // V6 path
    const v6Generator = new V6WorkflowGenerator(...)
    const v6Result = await v6Generator.generate(enhancedPrompt)

    // Compare workflow steps (order-agnostic)
    expect(normalizeWorkflow(v6Result.workflow)).toEqual(
      normalizeWorkflow(v4Result.workflow)
    )
  })
})
```

## Test Coverage Goals

- **Unit Tests:** 90%+ coverage
- **Integration Tests:** 80%+ coverage
- **E2E Tests:** Critical paths only

## CI/CD Integration

```yaml
# .github/workflows/test.yml

name: Test Extended IR Architecture

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
      
      - name: Install dependencies
        run: npm install
      
      - name: Run unit tests
        run: npm test -- --coverage
      
      - name: Run integration tests
        run: npm run test:integration
      
      - name: Run E2E tests
        run: npm run test:e2e
      
      - name: Upload coverage
        uses: codecov/codecov-action@v2
```

---

Next: [Rollout Strategy](./12-rollout-strategy.md)
