/**
 * E2E Tests for V6 API Endpoints
 *
 * Tests all three V6 API routes:
 * - POST /api/v6/generate-workflow-plan
 * - POST /api/v6/update-workflow-plan
 * - POST /api/v6/compile-workflow
 */

import { POST as generatePlanPOST } from '../generate-workflow-plan/route'
import { POST as updatePlanPOST } from '../update-workflow-plan/route'
import { POST as compilePOST } from '../compile-workflow/route'
import { NextRequest } from 'next/server'
import type { EnhancedPrompt } from '@/lib/agentkit/v6/generation/EnhancedPromptToIRGenerator'
import type { ExtendedLogicalIR } from '@/lib/agentkit/v6/logical-ir/schemas/extended-ir-types'

// ============================================================================
// Test Helpers
// ============================================================================

function createMockRequest(body: any): NextRequest {
  return new NextRequest('http://localhost:3000/api/test', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
}

// ============================================================================
// Test Configuration
// ============================================================================

const TEST_TIMEOUT = 60000 // 60 seconds for LLM calls

// ============================================================================
// Test Suite
// ============================================================================

describe('V6 API Endpoints', () => {
  // ----------------------------------------------------------------------------
  // Generate Workflow Plan Endpoint Tests
  // ----------------------------------------------------------------------------

  describe('POST /api/v6/generate-workflow-plan', () => {
    it('should generate workflow plan from enhanced prompt', async () => {
      const enhancedPrompt: EnhancedPrompt = {
        sections: {
          data: ['Read from Google Sheet MyLeads tab Leads'],
          actions: ['Filter rows where stage = 4'],
          output: ['Format as HTML table'],
          delivery: ['Email to meiribarak@gmail.com']
        }
      }

      const request = createMockRequest({ enhancedPrompt })
      const response = await generatePlanPOST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.plan).toBeDefined()
      expect(data.ir).toBeDefined()
      expect(data.metadata).toBeDefined()
    }, TEST_TIMEOUT)

    it('should return validation error for missing enhanced prompt', async () => {
      const request = createMockRequest({})
      const response = await generatePlanPOST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.success).toBe(false)
      expect(data.errors).toBeDefined()
      expect(data.errors).toContain('Enhanced prompt is required')
    })

    it('should return validation error for invalid enhanced prompt structure', async () => {
      const request = createMockRequest({
        enhancedPrompt: { invalid: 'structure' }
      })
      const response = await generatePlanPOST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.success).toBe(false)
      expect(data.errors).toBeDefined()
    })

    it('should support OpenAI model provider', async () => {
      const enhancedPrompt: EnhancedPrompt = {
        sections: {
          data: ['Read from Google Sheet Test'],
          delivery: ['Email to test@example.com']
        }
      }

      const request = createMockRequest({
        enhancedPrompt,
        modelProvider: 'openai'
      })
      const response = await generatePlanPOST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.metadata.model_used).toContain('gpt')
    }, TEST_TIMEOUT)

    it('should support Anthropic model provider', async () => {
      const enhancedPrompt: EnhancedPrompt = {
        sections: {
          data: ['Read from Google Sheet Test'],
          delivery: ['Email to test@example.com']
        }
      }

      const request = createMockRequest({
        enhancedPrompt,
        modelProvider: 'anthropic'
      })
      const response = await generatePlanPOST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.metadata.model_used).toContain('claude')
    }, TEST_TIMEOUT)

    it('should include IR in response', async () => {
      const enhancedPrompt: EnhancedPrompt = {
        sections: {
          data: ['Read from Google Sheet Sales'],
          delivery: ['Email to admin@example.com']
        }
      }

      const request = createMockRequest({ enhancedPrompt })
      const response = await generatePlanPOST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.ir).toBeDefined()
      expect(data.ir.ir_version).toBe('2.0')
      expect(data.ir.goal).toBeTruthy()
      expect(data.ir.data_sources).toBeDefined()
      expect(data.ir.delivery).toBeDefined()
    }, TEST_TIMEOUT)

    it('should include natural language plan in response', async () => {
      const enhancedPrompt: EnhancedPrompt = {
        sections: {
          data: ['Read from Google Sheet Tasks'],
          delivery: ['Email to manager@example.com']
        }
      }

      const request = createMockRequest({ enhancedPrompt })
      const response = await generatePlanPOST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.plan).toBeDefined()
      expect(data.plan.goal).toBeTruthy()
      expect(data.plan.steps).toBeDefined()
      expect(data.plan.steps.length).toBeGreaterThan(0)
      expect(data.plan.estimation).toBeDefined()
    }, TEST_TIMEOUT)
  })

  // ----------------------------------------------------------------------------
  // Update Workflow Plan Endpoint Tests
  // ----------------------------------------------------------------------------

  describe('POST /api/v6/update-workflow-plan', () => {
    it('should update workflow plan based on correction', async () => {
      // First generate initial plan
      const initialPrompt: EnhancedPrompt = {
        sections: {
          data: ['Read from Google Sheet Leads'],
          actions: ['Filter rows where status = "active"'],
          delivery: ['Email to sales@example.com']
        }
      }

      const generateRequest = createMockRequest({ enhancedPrompt: initialPrompt })
      const generateResponse = await generatePlanPOST(generateRequest)
      const generateData = await generateResponse.json()

      expect(generateData.success).toBe(true)
      const currentIR = generateData.ir

      // Then update the plan
      const updateRequest = createMockRequest({
        correctionMessage: 'Change filter to use stage column equals 4 instead of status',
        currentIR
      })

      const updateResponse = await updatePlanPOST(updateRequest)
      const updateData = await updateResponse.json()

      expect(updateResponse.status).toBe(200)
      expect(updateData.success).toBe(true)
      expect(updateData.plan).toBeDefined()
      expect(updateData.ir).toBeDefined()
      expect(updateData.changes).toBeDefined()
      expect(updateData.changes.length).toBeGreaterThan(0)
    }, TEST_TIMEOUT)

    it('should return validation error for missing correction message', async () => {
      const ir: ExtendedLogicalIR = {
        ir_version: '2.0',
        goal: 'Test',
        data_sources: [{
          id: 'data',
          type: 'tabular',
          source: 'googlesheets',
          location: 'Test'
        }],
        delivery: [{
          method: 'email',
          config: {
            recipient: ['test@example.com']
          }
        }],
        clarifications_required: []
      }

      const request = createMockRequest({ currentIR: ir })
      const response = await updatePlanPOST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.success).toBe(false)
      expect(data.errors).toContain('Correction message is required')
    })

    it('should return validation error for missing current IR', async () => {
      const request = createMockRequest({
        correctionMessage: 'Change something'
      })
      const response = await updatePlanPOST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.success).toBe(false)
      expect(data.errors).toContain('Current IR is required')
    })

    it('should include updated plan in response', async () => {
      // Generate initial plan
      const initialPrompt: EnhancedPrompt = {
        sections: {
          data: ['Read from Google Sheet Tasks'],
          delivery: ['Email to admin@example.com']
        }
      }

      const generateRequest = createMockRequest({ enhancedPrompt: initialPrompt })
      const generateResponse = await generatePlanPOST(generateRequest)
      const generateData = await generateResponse.json()
      const currentIR = generateData.ir

      // Update plan
      const updateRequest = createMockRequest({
        correctionMessage: 'Change email subject to "Daily Tasks Report"',
        currentIR
      })

      const updateResponse = await updatePlanPOST(updateRequest)
      const updateData = await updateResponse.json()

      expect(updateResponse.status).toBe(200)
      expect(updateData.plan).toBeDefined()
      expect(updateData.plan.steps).toBeDefined()
    }, TEST_TIMEOUT)
  })

  // ----------------------------------------------------------------------------
  // Compile Workflow Endpoint Tests
  // ----------------------------------------------------------------------------

  describe('POST /api/v6/compile-workflow', () => {
    it('should compile IR to PILOT_DSL workflow', async () => {
      const ir: ExtendedLogicalIR = {
        ir_version: '2.0',
        goal: 'Send weekly report',
        data_sources: [{
          id: 'data',
          type: 'tabular',
          source: 'googlesheets',
          location: 'WeeklyData',
          tab: 'Report'
        }],
        delivery: [{
          method: 'email',
          config: {
            recipient: ['manager@example.com'],
            subject: 'Weekly Report'
          }
        }],
        clarifications_required: []
      }

      const request = createMockRequest({ ir })
      const response = await compilePOST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.workflow).toBeDefined()
      expect(data.workflow.workflow_steps).toBeDefined()
      expect(data.workflow.workflow_steps.length).toBeGreaterThan(0)
      expect(data.metadata).toBeDefined()
    })

    it('should return validation error for missing IR', async () => {
      const request = createMockRequest({})
      const response = await compilePOST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.success).toBe(false)
      expect(data.errors).toContain('Logical IR is required')
    })

    it('should return validation error for invalid IR structure', async () => {
      const invalidIR = {
        ir_version: '2.0',
        goal: 'Test'
        // Missing required fields
      }

      const request = createMockRequest({ ir: invalidIR })
      const response = await compilePOST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.success).toBe(false)
      expect(data.errors).toBeDefined()
    })

    it('should include compilation metadata', async () => {
      const ir: ExtendedLogicalIR = {
        ir_version: '2.0',
        goal: 'Test compilation',
        data_sources: [{
          id: 'data',
          type: 'tabular',
          source: 'googlesheets',
          location: 'Test'
        }],
        delivery: [{
          method: 'email',
          config: {
            recipient: ['test@example.com']
          }
        }],
        clarifications_required: []
      }

      const request = createMockRequest({ ir })
      const response = await compilePOST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.metadata).toBeDefined()
      expect(data.metadata.rule_used).toBeTruthy()
      expect(data.metadata.step_count).toBeGreaterThan(0)
      expect(data.metadata.compilation_time_ms).toBeGreaterThan(0)
      expect(data.metadata.deterministic_step_percentage).toBeGreaterThanOrEqual(0)
    })

    it('should compile within performance target', async () => {
      const ir: ExtendedLogicalIR = {
        ir_version: '2.0',
        goal: 'Performance test',
        data_sources: [{
          id: 'data',
          type: 'tabular',
          source: 'googlesheets',
          location: 'Test'
        }],
        delivery: [{
          method: 'email',
          config: {
            recipient: ['test@example.com']
          }
        }],
        clarifications_required: []
      }

      const request = createMockRequest({ ir })
      const response = await compilePOST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.metadata.compilation_time_ms).toBeLessThan(100)
    })

    it('should handle grouped delivery workflows', async () => {
      const ir: ExtendedLogicalIR = {
        ir_version: '2.0',
        goal: 'Email per sales rep',
        data_sources: [{
          id: 'data',
          type: 'tabular',
          source: 'googlesheets',
          location: 'Opportunities'
        }],
        grouping: {
          group_by: 'sales_rep',
          emit_per_group: true
        },
        delivery: [{
          method: 'email',
          config: {
            recipient_source: 'email',
            subject: 'Your Opportunities'
          }
        }],
        clarifications_required: []
      }

      const request = createMockRequest({ ir })
      const response = await compilePOST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.metadata.rule_used).toBe('TabularGroupedDeliveryRule')
    })

    it('should handle workflows with AI operations', async () => {
      const ir: ExtendedLogicalIR = {
        ir_version: '2.0',
        goal: 'Analyze sentiment',
        data_sources: [{
          id: 'data',
          type: 'tabular',
          source: 'googlesheets',
          location: 'Feedback'
        }],
        ai_operations: [{
          type: 'sentiment',
          instruction: 'Analyze sentiment',
          input_source: '{{data.comment}}',
          output_schema: {
            type: 'enum',
            enum: ['positive', 'neutral', 'negative']
          }
        }],
        delivery: [{
          method: 'email',
          config: {
            recipient: ['support@example.com']
          }
        }],
        clarifications_required: []
      }

      const request = createMockRequest({ ir })
      const response = await compilePOST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)

      const aiStep = data.workflow.workflow_steps.find((s: any) => s.type === 'ai_processing')
      expect(aiStep).toBeDefined()
    })
  })

  // ----------------------------------------------------------------------------
  // Full Workflow Tests (Multiple Endpoints)
  // ----------------------------------------------------------------------------

  describe('Full V6 Workflow (Multiple Endpoints)', () => {
    it('should complete full workflow: generate → update → compile', async () => {
      console.log('[Full Workflow Test] Step 1: Generate initial plan...')

      // STEP 1: Generate plan
      const initialPrompt: EnhancedPrompt = {
        sections: {
          data: ['Read from Google Sheet Leads tab Active'],
          actions: ['Filter rows where status = "qualified"'],
          delivery: ['Email to sales@example.com with subject "Qualified Leads"']
        }
      }

      const generateRequest = createMockRequest({ enhancedPrompt: initialPrompt })
      const generateResponse = await generatePlanPOST(generateRequest)
      const generateData = await generateResponse.json()

      expect(generateResponse.status).toBe(200)
      expect(generateData.success).toBe(true)

      console.log('[Full Workflow Test] ✓ Plan generated')

      // STEP 2: Update plan
      console.log('[Full Workflow Test] Step 2: Update plan with correction...')

      const updateRequest = createMockRequest({
        correctionMessage: 'Change filter to use stage column equals 4 instead',
        currentIR: generateData.ir
      })

      const updateResponse = await updatePlanPOST(updateRequest)
      const updateData = await updateResponse.json()

      expect(updateResponse.status).toBe(200)
      expect(updateData.success).toBe(true)

      console.log('[Full Workflow Test] ✓ Plan updated')

      // STEP 3: Compile workflow
      console.log('[Full Workflow Test] Step 3: Compile to PILOT_DSL...')

      const compileRequest = createMockRequest({
        ir: updateData.ir,
        userId: 'test-user-001',
        availablePlugins: ['googlesheets', 'email']
      })

      const compileResponse = await compilePOST(compileRequest)
      const compileData = await compileResponse.json()

      expect(compileResponse.status).toBe(200)
      expect(compileData.success).toBe(true)
      expect(compileData.workflow).toBeDefined()

      console.log('[Full Workflow Test] ✓ Workflow compiled')
      console.log('[Full Workflow Test] ✅ Full workflow completed successfully')
    }, TEST_TIMEOUT)
  })
})
