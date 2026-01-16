/**
 * Unit Tests for EnhancedPromptToIRGenerator
 *
 * Tests IR generation from enhanced prompts using LLM.
 */

// @deprecated - Testing deprecated generator
import { createIRGenerator, EnhancedPromptToIRGenerator } from '../EnhancedPromptToIRGenerator_DEPRECATED'
import { validateIR } from '../../logical-ir/schemas/extended-ir-validation'
import type { EnhancedPrompt } from '../EnhancedPromptToIRGenerator_DEPRECATED'

// ============================================================================
// Test Configuration
// ============================================================================

const TEST_TIMEOUT = 30000 // 30 seconds for LLM calls

// ============================================================================
// Test Suite
// ============================================================================

describe('EnhancedPromptToIRGenerator', () => {
  let generator: EnhancedPromptToIRGenerator

  beforeEach(() => {
    generator = createIRGenerator('openai')
  })

  // ----------------------------------------------------------------------------
  // Basic Functionality Tests
  // ----------------------------------------------------------------------------

  describe('Basic Functionality', () => {
    it('should generate valid IR from simple enhanced prompt', async () => {
      const enhancedPrompt: EnhancedPrompt = {
        sections: {
          data: ['Read from Google Sheet MyLeads tab Leads'],
          actions: ['Filter rows where stage = 4'],
          output: ['Format as HTML table'],
          delivery: ['Email to meiribarak@gmail.com']
        }
      }

      const result = await generator.generate(enhancedPrompt)

      expect(result.success).toBe(true)
      expect(result.ir).toBeDefined()
      expect(result.errors).toBeUndefined()

      // Validate IR structure
      const ir = result.ir!
      expect(ir.ir_version).toBe('2.0')
      expect(ir.goal).toBeTruthy()
      expect(ir.data_sources).toHaveLength(1)
      expect(ir.data_sources[0].type).toBe('tabular')
      expect(ir.filters).toBeDefined()
      expect(ir.delivery).toHaveLength(1)
    }, TEST_TIMEOUT)

    it('should include metadata in successful result', async () => {
      const enhancedPrompt: EnhancedPrompt = {
        sections: {
          data: ['Read from Google Sheet Test'],
          delivery: ['Email to test@example.com']
        }
      }

      const result = await generator.generate(enhancedPrompt)

      expect(result.success).toBe(true)
      expect(result.metadata).toBeDefined()
      expect(result.metadata!.model).toBeTruthy()
      expect(result.metadata!.generation_time_ms).toBeGreaterThan(0)
    }, TEST_TIMEOUT)

    it('should generate IR that passes validation', async () => {
      const enhancedPrompt: EnhancedPrompt = {
        sections: {
          data: ['Read from Google Sheet Sales'],
          delivery: ['Send to Slack channel #sales']
        }
      }

      const result = await generator.generate(enhancedPrompt)

      expect(result.success).toBe(true)

      // Run validation on generated IR
      const validation = validateIR(result.ir!)
      expect(validation.valid).toBe(true)
      expect(validation.errors).toEqual([])
    }, TEST_TIMEOUT)
  })

  // ----------------------------------------------------------------------------
  // Data Source Categorization Tests
  // ----------------------------------------------------------------------------

  describe('Data Source Categorization', () => {
    it('should categorize tabular data sources', async () => {
      const enhancedPrompt: EnhancedPrompt = {
        sections: {
          data: ['Read from Google Sheet Employees tab Active'],
          delivery: ['Email to hr@example.com']
        }
      }

      const result = await generator.generate(enhancedPrompt)

      expect(result.success).toBe(true)
      expect(result.ir!.data_sources[0].type).toBe('tabular')
      expect(result.ir!.data_sources[0].source).toBe('googlesheets')
    }, TEST_TIMEOUT)

    it('should categorize API data sources', async () => {
      const enhancedPrompt: EnhancedPrompt = {
        sections: {
          data: ['Fetch data from API https://api.example.com/users'],
          delivery: ['Email to admin@example.com']
        }
      }

      const result = await generator.generate(enhancedPrompt)

      expect(result.success).toBe(true)
      expect(result.ir!.data_sources[0].type).toBe('api')
    }, TEST_TIMEOUT)

    it('should handle multiple data sources', async () => {
      const enhancedPrompt: EnhancedPrompt = {
        sections: {
          data: [
            'Read from Google Sheet Employees',
            'Read from Google Sheet Departments'
          ],
          delivery: ['Email to hr@example.com']
        }
      }

      const result = await generator.generate(enhancedPrompt)

      expect(result.success).toBe(true)
      expect(result.ir!.data_sources).toHaveLength(2)
    }, TEST_TIMEOUT)
  })

  // ----------------------------------------------------------------------------
  // Filter Detection Tests
  // ----------------------------------------------------------------------------

  describe('Filter Detection', () => {
    it('should detect equality filters', async () => {
      const enhancedPrompt: EnhancedPrompt = {
        sections: {
          data: ['Read from Google Sheet Tasks'],
          actions: ['Filter to rows where status = "open"'],
          delivery: ['Email to manager@example.com']
        }
      }

      const result = await generator.generate(enhancedPrompt)

      expect(result.success).toBe(true)
      expect(result.ir!.filters).toBeDefined()
      expect(result.ir!.filters!.length).toBeGreaterThan(0)

      const filter = result.ir!.filters![0]
      expect(filter.field).toBeTruthy()
      expect(filter.operator).toBe('equals')
      expect(filter.value).toBeTruthy()
    }, TEST_TIMEOUT)

    it('should detect comparison filters', async () => {
      const enhancedPrompt: EnhancedPrompt = {
        sections: {
          data: ['Read from Google Sheet Sales'],
          actions: ['Filter to rows where revenue > 1000'],
          delivery: ['Email to sales@example.com']
        }
      }

      const result = await generator.generate(enhancedPrompt)

      expect(result.success).toBe(true)
      expect(result.ir!.filters).toBeDefined()

      const filter = result.ir!.filters![0]
      expect(filter.operator).toBe('greater_than')
    }, TEST_TIMEOUT)

    it('should detect multiple filters', async () => {
      const enhancedPrompt: EnhancedPrompt = {
        sections: {
          data: ['Read from Google Sheet Leads'],
          actions: [
            'Filter to rows where stage = 4',
            'Filter to rows where country = "USA"'
          ],
          delivery: ['Email to sales@example.com']
        }
      }

      const result = await generator.generate(enhancedPrompt)

      expect(result.success).toBe(true)
      expect(result.ir!.filters).toBeDefined()
      expect(result.ir!.filters!.length).toBeGreaterThanOrEqual(2)
    }, TEST_TIMEOUT)
  })

  // ----------------------------------------------------------------------------
  // AI Operation Detection Tests
  // ----------------------------------------------------------------------------

  describe('AI Operation Detection', () => {
    it('should detect sentiment analysis operations', async () => {
      const enhancedPrompt: EnhancedPrompt = {
        sections: {
          data: ['Read from Google Sheet Feedback'],
          actions: ['Analyze sentiment of each comment'],
          delivery: ['Email to support@example.com']
        }
      }

      const result = await generator.generate(enhancedPrompt)

      expect(result.success).toBe(true)
      expect(result.ir!.ai_operations).toBeDefined()
      expect(result.ir!.ai_operations!.length).toBeGreaterThan(0)

      const aiOp = result.ir!.ai_operations![0]
      expect(aiOp.type).toBe('sentiment')
    }, TEST_TIMEOUT)

    it('should detect classification operations', async () => {
      const enhancedPrompt: EnhancedPrompt = {
        sections: {
          data: ['Read from Google Sheet SupportTickets'],
          actions: ['Classify each ticket into category: bug, feature, question'],
          delivery: ['Email to support@example.com']
        }
      }

      const result = await generator.generate(enhancedPrompt)

      expect(result.success).toBe(true)
      expect(result.ir!.ai_operations).toBeDefined()

      const classifyOp = result.ir!.ai_operations!.find(op => op.type === 'classify')
      expect(classifyOp).toBeDefined()
      expect(classifyOp!.output_schema.type).toBe('enum')
    }, TEST_TIMEOUT)

    it('should detect summarization operations', async () => {
      const enhancedPrompt: EnhancedPrompt = {
        sections: {
          data: ['Read from Google Sheet Articles'],
          actions: ['Summarize each article in 2 sentences'],
          delivery: ['Email to editor@example.com']
        }
      }

      const result = await generator.generate(enhancedPrompt)

      expect(result.success).toBe(true)
      expect(result.ir!.ai_operations).toBeDefined()

      const summarizeOp = result.ir!.ai_operations!.find(op => op.type === 'summarize')
      expect(summarizeOp).toBeDefined()
    }, TEST_TIMEOUT)

    it('should detect extraction operations', async () => {
      const enhancedPrompt: EnhancedPrompt = {
        sections: {
          data: ['Read from Google Sheet Contracts'],
          actions: ['Extract contract end date from each document'],
          delivery: ['Email to legal@example.com']
        }
      }

      const result = await generator.generate(enhancedPrompt)

      expect(result.success).toBe(true)
      expect(result.ir!.ai_operations).toBeDefined()

      const extractOp = result.ir!.ai_operations!.find(op => op.type === 'extract')
      expect(extractOp).toBeDefined()
    }, TEST_TIMEOUT)
  })

  // ----------------------------------------------------------------------------
  // Transform Detection Tests
  // ----------------------------------------------------------------------------

  describe('Transform Detection', () => {
    it('should detect sort transforms', async () => {
      const enhancedPrompt: EnhancedPrompt = {
        sections: {
          data: ['Read from Google Sheet Orders'],
          actions: ['Sort by date descending'],
          delivery: ['Email to admin@example.com']
        }
      }

      const result = await generator.generate(enhancedPrompt)

      expect(result.success).toBe(true)
      expect(result.ir!.transforms).toBeDefined()

      const sortTransform = result.ir!.transforms!.find(t => t.operation === 'sort')
      expect(sortTransform).toBeDefined()
    }, TEST_TIMEOUT)

    it('should detect join transforms', async () => {
      const enhancedPrompt: EnhancedPrompt = {
        sections: {
          data: [
            'Read from Google Sheet Employees',
            'Read from Google Sheet Departments'
          ],
          actions: ['Join employees with departments by department_id'],
          delivery: ['Email to hr@example.com']
        }
      }

      const result = await generator.generate(enhancedPrompt)

      expect(result.success).toBe(true)
      expect(result.ir!.transforms).toBeDefined()

      const joinTransform = result.ir!.transforms!.find(t => t.operation === 'join')
      expect(joinTransform).toBeDefined()
    }, TEST_TIMEOUT)

    it('should detect aggregation transforms', async () => {
      const enhancedPrompt: EnhancedPrompt = {
        sections: {
          data: ['Read from Google Sheet Sales'],
          actions: ['Calculate total revenue by region'],
          delivery: ['Email to cfo@example.com']
        }
      }

      const result = await generator.generate(enhancedPrompt)

      expect(result.success).toBe(true)
      expect(result.ir!.transforms).toBeDefined()

      const aggTransform = result.ir!.transforms!.find(t => t.operation === 'aggregate')
      expect(aggTransform).toBeDefined()
    }, TEST_TIMEOUT)
  })

  // ----------------------------------------------------------------------------
  // Grouping Detection Tests
  // ----------------------------------------------------------------------------

  describe('Grouping Detection', () => {
    it('should detect grouping with per-group delivery', async () => {
      const enhancedPrompt: EnhancedPrompt = {
        sections: {
          data: ['Read from Google Sheet Tasks'],
          actions: ['Group by assignee'],
          delivery: ['Email each assignee their tasks']
        }
      }

      const result = await generator.generate(enhancedPrompt)

      expect(result.success).toBe(true)
      expect(result.ir!.grouping).toBeDefined()
      expect(result.ir!.grouping!.group_by).toBeTruthy()
      expect(result.ir!.grouping!.emit_per_group).toBe(true)
    }, TEST_TIMEOUT)

    it('should detect grouping without per-group delivery', async () => {
      const enhancedPrompt: EnhancedPrompt = {
        sections: {
          data: ['Read from Google Sheet Orders'],
          actions: ['Group by customer'],
          delivery: ['Email summary to admin@example.com']
        }
      }

      const result = await generator.generate(enhancedPrompt)

      expect(result.success).toBe(true)
      expect(result.ir!.grouping).toBeDefined()
      expect(result.ir!.grouping!.emit_per_group).toBe(false)
    }, TEST_TIMEOUT)
  })

  // ----------------------------------------------------------------------------
  // Delivery Detection Tests
  // ----------------------------------------------------------------------------

  describe('Delivery Detection', () => {
    it('should detect email delivery', async () => {
      const enhancedPrompt: EnhancedPrompt = {
        sections: {
          data: ['Read from Google Sheet Reports'],
          delivery: ['Email to manager@example.com with subject "Weekly Report"']
        }
      }

      const result = await generator.generate(enhancedPrompt)

      expect(result.success).toBe(true)
      expect(result.ir!.delivery).toBeDefined()
      expect(result.ir!.delivery[0].method).toBe('email')
      expect(result.ir!.delivery[0].config.recipient).toBeTruthy()
      expect(result.ir!.delivery[0].config.subject).toBeTruthy()
    }, TEST_TIMEOUT)

    it('should detect Slack delivery', async () => {
      const enhancedPrompt: EnhancedPrompt = {
        sections: {
          data: ['Read from Google Sheet Alerts'],
          delivery: ['Send to Slack channel #engineering']
        }
      }

      const result = await generator.generate(enhancedPrompt)

      expect(result.success).toBe(true)
      expect(result.ir!.delivery[0].method).toBe('slack')
      expect(result.ir!.delivery[0].config.channel).toBeTruthy()
    }, TEST_TIMEOUT)

    it('should detect webhook delivery', async () => {
      const enhancedPrompt: EnhancedPrompt = {
        sections: {
          data: ['Read from Google Sheet Events'],
          delivery: ['POST to webhook https://api.example.com/webhook']
        }
      }

      const result = await generator.generate(enhancedPrompt)

      expect(result.success).toBe(true)
      expect(result.ir!.delivery[0].method).toBe('webhook')
      expect(result.ir!.delivery[0].config.url).toBeTruthy()
    }, TEST_TIMEOUT)
  })

  // ----------------------------------------------------------------------------
  // Edge Case Detection Tests
  // ----------------------------------------------------------------------------

  describe('Edge Case Detection', () => {
    it('should detect edge cases for empty results', async () => {
      const enhancedPrompt: EnhancedPrompt = {
        sections: {
          data: ['Read from Google Sheet Leads'],
          actions: ['Filter to rows where stage = 5'],
          delivery: ['Email to sales@example.com']
        }
      }

      const result = await generator.generate(enhancedPrompt)

      expect(result.success).toBe(true)

      // Should have edge case handling for empty results
      if (result.ir!.edge_cases && result.ir!.edge_cases.length > 0) {
        const emptyEdgeCase = result.ir!.edge_cases.find(ec =>
          ec.condition.includes('empty') || ec.condition.includes('no')
        )
        expect(emptyEdgeCase).toBeDefined()
      }
    }, TEST_TIMEOUT)
  })

  // ----------------------------------------------------------------------------
  // Error Handling Tests
  // ----------------------------------------------------------------------------

  describe('Error Handling', () => {
    it('should handle missing sections gracefully', async () => {
      const enhancedPrompt: EnhancedPrompt = {
        sections: {
          data: [],
          delivery: []
        } // Minimal sections
      }

      const result = await generator.generate(enhancedPrompt)

      // Should either succeed with clarifications or fail gracefully
      if (result.success) {
        expect(result.ir!.clarifications_required.length).toBeGreaterThan(0)
      } else {
        expect(result.errors).toBeDefined()
        expect(result.errors!.length).toBeGreaterThan(0)
      }
    }, TEST_TIMEOUT)

    it('should detect when clarifications are needed', async () => {
      const enhancedPrompt: EnhancedPrompt = {
        sections: {
          data: ['Read from some spreadsheet'], // Vague
          delivery: ['Send somewhere'] // Very vague
        }
      }

      const result = await generator.generate(enhancedPrompt)

      if (result.success) {
        // Should have clarifications required
        expect(result.ir!.clarifications_required.length).toBeGreaterThan(0)
      }
    }, TEST_TIMEOUT)
  })

  // ----------------------------------------------------------------------------
  // Model Provider Tests
  // ----------------------------------------------------------------------------

  describe('Model Provider Support', () => {
    it('should support OpenAI provider', async () => {
      const generator = createIRGenerator('openai')

      const enhancedPrompt: EnhancedPrompt = {
        sections: {
          data: ['Read from Google Sheet Test'],
          delivery: ['Email to test@example.com']
        }
      }

      const result = await generator.generate(enhancedPrompt)

      expect(result.success).toBe(true)
      expect(result.metadata!.model).toContain('gpt')
    }, TEST_TIMEOUT)

    it('should support Anthropic provider', async () => {
      const generator = createIRGenerator('anthropic')

      const enhancedPrompt: EnhancedPrompt = {
        sections: {
          data: ['Read from Google Sheet Test'],
          delivery: ['Email to test@example.com']
        }
      }

      const result = await generator.generate(enhancedPrompt)

      expect(result.success).toBe(true)
      expect(result.metadata!.model).toContain('claude')
    }, TEST_TIMEOUT)
  })
})
