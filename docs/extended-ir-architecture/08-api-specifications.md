# API Specifications

## New API Endpoints

### 1. POST /api/generate-workflow-plan

**Purpose:** Generate Logical IR from enhanced prompt and translate to natural language plan

**Request:**
```typescript
{
  enhancedPrompt: EnhancedPrompt
}
```

**Response:**
```typescript
{
  plan: NaturalLanguagePlan {
    goal: string
    steps: PlanStep[]
    edgeCases: string[]
    estimation: {
      emails: string
      time: string
      cost: string
    }
  },
  ir: ExtendedLogicalIR  // Hidden from user, used for compilation
}
```

**Implementation:**
```typescript
// /app/api/generate-workflow-plan/route.ts
export async function POST(req: Request) {
  const { enhancedPrompt } = await req.json()
  
  // 1. Generate IR
  const irGenerator = new EnhancedPromptToIRGenerator()
  const ir = await irGenerator.generateIR(enhancedPrompt)
  
  // 2. Validate IR
  const validation = validateIR(ir)
  if (!validation.valid) {
    return Response.json({ error: validation.errors }, { status: 400 })
  }
  
  // 3. Translate to natural language
  const translator = new IRToNaturalLanguageTranslator()
  const plan = translator.translate(ir)
  
  return Response.json({ plan, ir })
}
```

---

### 2. POST /api/compile-workflow

**Purpose:** Compile Logical IR to PILOT_DSL workflow

**Request:**
```typescript
{
  logicalIR: ExtendedLogicalIR
}
```

**Response:**
```typescript
{
  workflow: PilotWorkflow {
    workflow_steps: WorkflowStep[]
    // ... other DSL fields
  },
  metadata: {
    compiler_rule: string
    optimizations: string[]
    warnings?: string[]
  }
}
```

**Implementation:**
```typescript
// /app/api/compile-workflow/route.ts
export async function POST(req: Request) {
  const { logicalIR } = await req.json()
  
  // 1. Load plugin context
  const pluginManager = new PluginManagerV2()
  const plugins = await pluginManager.loadAll()
  
  // 2. Compile IR
  const compiler = new LogicalIRCompiler(plugins)
  const result = compiler.compile(logicalIR)
  
  if (!result.success) {
    return Response.json({ error: result.errors }, { status: 400 })
  }
  
  // 3. Validate compiled workflow
  const validation = validateWorkflow(result.workflow)
  if (!validation.valid) {
    return Response.json({ error: validation.errors }, { status: 500 })
  }
  
  return Response.json({
    workflow: result.workflow,
    metadata: result.metadata
  })
}
```

---

### 3. POST /api/update-workflow-plan

**Purpose:** Handle user corrections to workflow plan

**Request:**
```typescript
{
  logicalIR: ExtendedLogicalIR,
  correction: string  // Natural language correction
}
```

**Response:**
```typescript
{
  updatedPlan: NaturalLanguagePlan,
  updatedIR: ExtendedLogicalIR
}
```

**Implementation:**
```typescript
// /app/api/update-workflow-plan/route.ts
export async function POST(req: Request) {
  const { logicalIR, correction } = await req.json()
  
  // 1. Handle correction
  const correctionHandler = new NaturalLanguageCorrectionHandler()
  const updatedIR = await correctionHandler.handleCorrection(
    logicalIR,
    correction
  )
  
  // 2. Validate updated IR
  const validation = validateIR(updatedIR)
  if (!validation.valid) {
    return Response.json({ error: validation.errors }, { status: 400 })
  }
  
  // 3. Re-translate to English
  const translator = new IRToNaturalLanguageTranslator()
  const updatedPlan = translator.translate(updatedIR)
  
  return Response.json({ updatedPlan, updatedIR })
}
```

---

## Modified Endpoint: POST /app/api/generate-agent-v4

**Add V6 routing:**

```typescript
export async function POST(req: Request) {
  const body = await req.json()
  
  // Determine which generator to use
  const useIR = body.useIRArchitecture || false
  
  if (useIR && body.logicalIR) {
    // V6 Path: Compile IR
    const compiler = new LogicalIRCompiler(plugins)
    const result = compiler.compile(body.logicalIR)
    
    if (!result.success) {
      return Response.json({ error: result.errors }, { status: 400 })
    }
    
    // Save agent with compiled workflow
    const agent = await saveAgent({
      ...body,
      workflow_steps: result.workflow.workflow_steps,
      metadata: {
        generator_version: 'v6',
        architecture: 'logical-ir',
        compiler_rule: result.metadata.compiler_rule
      }
    })
    
    return Response.json({ success: true, agent })
  }
  
  // V4 Path (existing)
  const v4Generator = new V4WorkflowGenerator(...)
  // ... existing V4 logic
}
```

---

## Error Responses

All endpoints return consistent error format:

```typescript
{
  error: string | string[],
  code?: string,
  details?: any
}
```

**Common Error Codes:**
- `INVALID_IR` - IR validation failed
- `COMPILATION_ERROR` - Compiler couldn't generate workflow
- `NO_MATCHING_RULE` - No compiler rule supports IR pattern
- `PLUGIN_NOT_FOUND` - Required plugin not available
- `CORRECTION_FAILED` - Couldn't apply user correction

---

Next: [Implementation Plan](./09-implementation-plan.md)
