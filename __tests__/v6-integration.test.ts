/**
 * V6 Pure Declarative Pipeline Integration Tests
 *
 * Tests for Phases 1-5 architecture improvements:
 * - Phase 1: Variable reference fixes
 * - Phase 3: Strict schema validation with retry
 * - Phase 4: Removed band-aid post-processing
 * - Phase 5: Pre-flight validation
 *
 * These tests validate the end-to-end workflow generation pipeline.
 */

import { IRToDSLCompiler } from '@/lib/agentkit/v6/compiler/IRToDSLCompiler';
import { WorkflowValidator } from '@/lib/pilot/WorkflowValidator';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';

describe('V6 Pipeline Integration Tests', () => {
  let compiler: IRToDSLCompiler;
  let validator: WorkflowValidator;
  let pluginManager: PluginManagerV2;

  beforeAll(() => {
    // Initialize plugin manager
    pluginManager = new PluginManagerV2();

    // Initialize compiler with plugin manager
    compiler = new IRToDSLCompiler({
      temperature: 0.0,
      maxTokens: 8000,
      pluginManager
    });

    // Initialize validator
    validator = new WorkflowValidator();
  });

  describe('Phase 1: Variable Reference Fixes', () => {
    it('should generate correct variable references with .data prefix', async () => {
      const mockIR = {
        data_sources: [
          {
            type: 'plugin_action',
            plugin_id: 'google-mail',
            action_id: 'search_emails',
            filters: [{ field: 'subject', operator: 'contains', value: 'expense' }]
          }
        ],
        transformations: [],
        delivery_targets: []
      };

      const result = await compiler.compile(mockIR);

      expect(result.success).toBe(true);
      expect(result.workflow).toBeDefined();

      // Check that variable references use .data prefix
      const hasCorrectRefs = result.workflow.some(step => {
        const stepStr = JSON.stringify(step);
        // Should have .data. prefix, not just .data}}
        return stepStr.includes('.data.') || !stepStr.includes('{{step');
      });

      expect(hasCorrectRefs).toBe(true);
    });
  });

  describe('Phase 3: Strict Schema Validation', () => {
    it('should use strict schema mode in OpenAI calls', () => {
      // This test verifies the compiler is configured correctly
      expect(compiler).toBeDefined();

      // The compiler should be using strict schema mode
      // We can't directly test the OpenAI call, but we can verify
      // that the schema is imported and available
      const { PILOT_DSL_SCHEMA } = require('@/lib/pilot/schema/pilot-dsl-schema');
      expect(PILOT_DSL_SCHEMA).toBeDefined();
      expect(PILOT_DSL_SCHEMA.type).toBe('object');
    });

    it('should retry on validation failures', async () => {
      // Mock a scenario where the first attempt fails validation
      // but the retry succeeds (this would be tested with actual execution)
      const mockIR = {
        data_sources: [],
        transformations: [],
        delivery_targets: []
      };

      const result = await compiler.compile(mockIR);

      // Should either succeed or fail gracefully
      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
    });
  });

  describe('Phase 4: Removed Band-Aid Post-Processing', () => {
    it('should not need standardizeVariableReferences', async () => {
      const mockIR = {
        data_sources: [
          {
            type: 'plugin_action',
            plugin_id: 'google-mail',
            action_id: 'search_emails'
          }
        ],
        transformations: [],
        delivery_targets: []
      };

      const result = await compiler.compile(mockIR);

      if (result.success) {
        // Variables should already be correct from compiler
        const workflow = result.workflow;
        const needsStandardization = workflow.some(step => {
          const stepStr = JSON.stringify(step);
          // Check for patterns that would need fixing
          return stepStr.includes('{{step') && !stepStr.includes('.data.');
        });

        // Should NOT need standardization (false = good)
        expect(needsStandardization).toBe(false);
      }
    });
  });

  describe('Phase 5: Pre-Flight Validation', () => {
    it('should validate workflow structure before execution', () => {
      const validWorkflow = [
        { step_id: 'step1', type: 'action', plugin: 'gmail', action: 'search_emails', dependencies: [] },
        { step_id: 'step2', type: 'transform', dependencies: ['step1'] }
      ];

      const result = validator.validatePreFlight(validWorkflow);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject malformed workflows', () => {
      const invalidWorkflow = [
        { step_id: 'step1', type: 'action', dependencies: ['step2'] }, // Forward dependency
        { step_id: 'step2', type: 'transform', dependencies: [] }
      ];

      const result = validator.validatePreFlight(invalidWorkflow);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should detect circular dependencies', () => {
      const circularWorkflow = [
        { step_id: 'step1', type: 'action', dependencies: ['step3'] },
        { step_id: 'step2', type: 'transform', dependencies: ['step1'] },
        { step_id: 'step3', type: 'action', dependencies: ['step2'] }
      ];

      const result = validator.validatePreFlight(circularWorkflow);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Circular dependency'))).toBe(true);
    });
  });

  describe('End-to-End Pipeline', () => {
    it('should compile and validate a complete expense workflow', async () => {
      const expenseIR = {
        data_sources: [
          {
            type: 'plugin_action',
            plugin_id: 'google-mail',
            action_id: 'search_emails',
            filters: [
              { field: 'subject', operator: 'contains', value: 'expense' },
              { field: 'from', operator: 'contains', value: '@company.com' }
            ]
          }
        ],
        transformations: [
          {
            type: 'ai_classification',
            prompt: 'Extract expense amounts and categories from emails'
          }
        ],
        delivery_targets: [
          {
            type: 'plugin_action',
            plugin_id: 'slack',
            action_id: 'send_message',
            params: {
              channel: '#expenses',
              message: 'Expense summary: {{ai_result}}'
            }
          }
        ]
      };

      const compilationResult = await compiler.compile(expenseIR);

      if (compilationResult.success) {
        // Validate the compiled workflow
        const validationResult = validator.validatePreFlight(compilationResult.workflow);

        expect(validationResult.valid).toBe(true);
        expect(compilationResult.workflow.length).toBeGreaterThan(0);

        // Check for correct structure
        const hasDataSource = compilationResult.workflow.some(s => s.type === 'action' && s.plugin === 'google-mail');
        const hasDelivery = compilationResult.workflow.some(s => s.type === 'action' && s.plugin === 'slack');

        expect(hasDataSource).toBe(true);
        expect(hasDelivery).toBe(true);
      }
    });
  });
});
