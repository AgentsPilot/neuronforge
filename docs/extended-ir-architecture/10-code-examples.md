# Code Examples

## Complete Component Implementations

### 1. WorkflowPlanPreview.tsx

```typescript
import { useState } from 'react'
import { Check, Edit, AlertCircle, Clock, DollarSign, Mail } from 'lucide-react'

interface PlanStep {
  icon: string
  title: string
  details: string[]
}

interface NaturalLanguagePlan {
  goal: string
  steps: PlanStep[]
  edgeCases: string[]
  estimation: {
    emails: string
    time: string
    cost: string
  }
  ir?: any  // Hidden from user
}

interface WorkflowPlanPreviewProps {
  plan: NaturalLanguagePlan
  onApprove: () => void
  onEdit: (correction: string) => Promise<void>
  loading?: boolean
}

export function WorkflowPlanPreview({
  plan,
  onApprove,
  onEdit,
  loading = false
}: WorkflowPlanPreviewProps) {
  const [editMode, setEditMode] = useState(false)
  const [correction, setCorrection] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleEdit = async () => {
    if (!correction.trim()) return
    
    setSubmitting(true)
    try {
      await onEdit(correction)
      setCorrection('')
      setEditMode(false)
    } catch (error) {
      console.error('Failed to apply correction:', error)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 bg-blue-100 rounded-full">
            <span className="text-3xl">🎯</span>
          </div>
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-gray-900">
              Your Workflow Plan
            </h2>
            <p className="text-gray-600 mt-1">{plan.goal}</p>
          </div>
        </div>

        {/* Steps */}
        <div className="space-y-4 mb-6">
          <p className="text-lg font-semibold text-gray-700">
            Here's what I'll do:
          </p>
          
          {plan.steps.map((step, i) => (
            <div
              key={i}
              className="border-l-4 border-blue-500 pl-4 py-3 bg-gray-50 rounded-r-lg"
            >
              <div className="flex items-start gap-3 mb-2">
                <span className="text-2xl flex-shrink-0">{step.icon}</span>
                <div className="flex-1">
                  <p className="font-semibold text-gray-900 text-lg">
                    {i + 1}. {step.title}
                  </p>
                  <ul className="mt-2 space-y-1">
                    {step.details.map((detail, j) => (
                      <li key={j} className="text-sm text-gray-700">
                        • {detail}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Edge Cases */}
        {plan.edgeCases.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="w-5 h-5 text-amber-600" />
              <p className="font-semibold text-amber-900">Edge cases handled:</p>
            </div>
            <ul className="ml-7 space-y-1">
              {plan.edgeCases.map((ec, i) => (
                <li key={i} className="text-sm text-amber-800">• {ec}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Estimation */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-5 h-5 text-gray-600" />
            <p className="font-semibold text-gray-900">Estimated execution:</p>
          </div>
          <div className="grid grid-cols-3 gap-4 ml-7">
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-gray-500" />
              <span className="text-sm text-gray-700">{plan.estimation.emails}</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-gray-500" />
              <span className="text-sm text-gray-700">{plan.estimation.time}</span>
            </div>
            <div className="flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-gray-500" />
              <span className="text-sm text-gray-700">{plan.estimation.cost}</span>
            </div>
          </div>
        </div>

        {/* Approval Message */}
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-2">
            <Check className="w-5 h-5 text-green-600" />
            <p className="text-green-800 font-semibold">
              This looks correct and ready to build.
            </p>
          </div>
        </div>

        {/* Actions */}
        {editMode ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                What would you like to change?
              </label>
              <textarea
                value={correction}
                onChange={(e) => setCorrection(e.target.value)}
                placeholder="Example: 'Actually filter stage 5 instead of 4'"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                rows={3}
                disabled={submitting}
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setEditMode(false)}
                disabled={submitting}
                className="px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={handleEdit}
                disabled={!correction.trim() || submitting}
                className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Updating...
                  </>
                ) : (
                  'Update Plan'
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-3">
            <button
              onClick={() => setEditMode(true)}
              disabled={loading}
              className="flex-1 px-6 py-3 border-2 border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Edit className="w-5 h-5" />
              <span className="font-semibold">Edit Request</span>
            </button>
            <button
              onClick={onApprove}
              disabled={loading}
              className="flex-1 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Check className="w-5 h-5" />
              <span className="font-semibold">Approve & Continue</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
```

### 2. LogicalIRCompiler.ts

```typescript
import type {
  ExtendedLogicalIR,
  PilotWorkflow,
  WorkflowStep,
  PluginDefinition
} from './types'

export interface CompilerRule {
  name: string
  priority: number
  supports(ir: ExtendedLogicalIR): boolean
  compile(ir: ExtendedLogicalIR, context: CompilerContext): CompilerResult
}

export interface CompilerContext {
  plugins: PluginDefinition[]
  availableActions: Map<string, any>
}

export interface CompilerResult {
  success: boolean
  workflow?: PilotWorkflow
  errors?: string[]
  warnings?: string[]
  metadata?: {
    compiler_rule: string
    optimizations: string[]
  }
}

export class LogicalIRCompiler {
  private rules: CompilerRule[] = []

  constructor(private plugins: PluginDefinition[]) {
    this.registerDefaultRules()
  }

  private registerDefaultRules() {
    // Register rules in priority order
    this.addRule(new TabularGroupedDeliveryRule())
    this.addRule(new EventTriggeredRule())
    this.addRule(new ConditionalBranchRule())
    this.addRule(new AgentChainRule())
    this.addRule(new SingleActionRule())
  }

  addRule(rule: CompilerRule) {
    this.rules.push(rule)
    this.rules.sort((a, b) => b.priority - a.priority)
  }

  compile(ir: ExtendedLogicalIR): CompilerResult {
    // 1. Validate IR
    const validation = this.validateIR(ir)
    if (!validation.valid) {
      return {
        success: false,
        errors: validation.errors
      }
    }

    // 2. Find matching rule
    for (const rule of this.rules) {
      if (rule.supports(ir)) {
        try {
          const context = this.buildContext()
          return rule.compile(ir, context)
        } catch (error) {
          return {
            success: false,
            errors: [`Compilation failed: ${error.message}`]
          }
        }
      }
    }

    // 3. No rule found
    return {
      success: false,
      errors: [
        'No compiler rule supports this workflow pattern.',
        'Supported patterns:',
        ...this.rules.map(r => `- ${r.name}`)
      ]
    }
  }

  private validateIR(ir: ExtendedLogicalIR): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    if (!ir.goal) errors.push('Missing required field: goal')
    if (!ir.data_sources?.length) errors.push('Missing required field: data_sources')
    if (!ir.delivery?.length) errors.push('Missing required field: delivery')

    return { valid: errors.length === 0, errors }
  }

  private buildContext(): CompilerContext {
    const availableActions = new Map()
    this.plugins.forEach(plugin => {
      plugin.actions.forEach(action => {
        availableActions.set(`${plugin.id}.${action.id}`, action)
      })
    })

    return {
      plugins: this.plugins,
      availableActions
    }
  }
}
```

### 3. TabularGroupedDeliveryRule.ts

```typescript
import { CompilerRule, CompilerContext, CompilerResult } from '../LogicalIRCompiler'
import type { ExtendedLogicalIR, WorkflowStep } from '../types'
import {
  DataSourceResolver,
  TransformResolver,
  LoopResolver,
  DeliveryResolver
} from '../resolvers'

export class TabularGroupedDeliveryRule implements CompilerRule {
  name = 'TabularGroupedDeliveryRule'
  priority = 100

  supports(ir: ExtendedLogicalIR): boolean {
    return (
      ir.data_sources?.[0]?.type === 'tabular' &&
      ir.grouping !== undefined &&
      ir.delivery?.[0]?.method !== undefined
    )
  }

  compile(ir: ExtendedLogicalIR, context: CompilerContext): CompilerResult {
    const steps: WorkflowStep[] = []
    const warnings: string[] = []

    try {
      const dataResolver = new DataSourceResolver(context.plugins)
      const transformResolver = new TransformResolver()
      const loopResolver = new LoopResolver()
      const deliveryResolver = new DeliveryResolver(context.plugins)

      // 1. Data source → action step
      const readStep = dataResolver.resolve(ir.data_sources[0])
      steps.push(readStep)

      // 2. Normalization → validation step (if present)
      if (ir.normalization) {
        steps.push({
          step_id: 'validate_headers',
          type: 'validation',
          operation: 'check_headers',
          config: {
            source: `{{${readStep.step_id}.output}}`,
            required: ir.normalization.required_headers
          }
        })
      }

      // 3. Filters → transform steps
      if (ir.filters) {
        for (const filter of ir.filters) {
          const filterStep = transformResolver.resolveFilter(filter)
          steps.push(filterStep)
        }
      }

      // 4. Check for edge case: zero results
      if (ir.edge_cases?.some(ec => ec.condition === 'no_rows_after_filter')) {
        const edgeCase = ir.edge_cases.find(ec => ec.condition === 'no_rows_after_filter')
        steps.push({
          step_id: 'check_empty',
          type: 'conditional',
          condition: {
            type: 'simple',
            field: `{{${steps[steps.length - 1].step_id}.output}}`,
            operator: 'array_length_equals',
            value: 0
          },
          then_steps: [{
            step_id: 'empty_notification',
            type: 'action',
            plugin: 'gmail',
            action: 'send_email',
            params: {
              to: edgeCase.recipient,
              subject: 'Workflow Results',
              body: edgeCase.message
            }
          }],
          else_steps: []  // Continue to next steps
        })
      }

      // 5. Partitions → transform step
      if (ir.partitions) {
        const partitionStep = transformResolver.resolvePartition(ir.partitions[0])
        steps.push(partitionStep)
      }

      // 6. Grouping + Delivery → scatter_gather
      if (ir.grouping && ir.delivery) {
        const scatterStep = loopResolver.resolveGroupedDelivery(
          ir.grouping,
          ir.rendering,
          ir.delivery,
          ir.partitions?.[0]
        )
        steps.push(scatterStep)
      }

      return {
        success: true,
        workflow: {
          workflow_steps: steps
        },
        warnings,
        metadata: {
          compiler_rule: this.name,
          optimizations: ['zero_ai_processing_steps']
        }
      }
    } catch (error) {
      return {
        success: false,
        errors: [`TabularGroupedDeliveryRule compilation failed: ${error.message}`]
      }
    }
  }
}
```

---

See full documentation for more examples of resolvers, API endpoints, and UI components.

Next: [Testing Strategy](./11-testing-strategy.md)
