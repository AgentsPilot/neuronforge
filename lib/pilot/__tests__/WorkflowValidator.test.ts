/**
 * WorkflowValidator Tests
 *
 * Tests for Phase 5: Pre-flight workflow validation
 * Validates step IDs, dependencies, and DAG structure
 */

import { WorkflowValidator } from '../WorkflowValidator';

describe('WorkflowValidator', () => {
  let validator: WorkflowValidator;

  beforeEach(() => {
    validator = new WorkflowValidator();
  });

  describe('validatePreFlight', () => {
    it('should validate a simple valid workflow', () => {
      const workflow = [
        { step_id: 'step1', type: 'action', plugin: 'gmail', action: 'search_emails', dependencies: [] },
        { step_id: 'step2', type: 'transform', dependencies: ['step1'] },
        { step_id: 'step3', type: 'action', plugin: 'slack', action: 'send_message', dependencies: ['step2'] }
      ];

      const result = validator.validatePreFlight(workflow);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should allow non-sequential step IDs (due to nested steps in scatter_gather, loops, etc.)', () => {
      const workflow = [
        { step_id: 'step1', type: 'action', plugin: 'gmail', action: 'search_emails' },
        { step_id: 'step3', type: 'transform' }, // step2 might be nested elsewhere
        { step_id: 'step4', type: 'action', plugin: 'slack', action: 'send_message' }
      ];

      const result = validator.validatePreFlight(workflow);

      // Should be valid - non-sequential IDs are allowed now
      expect(result.valid).toBe(true);
    });

    it('should detect dependencies on non-existent steps', () => {
      const workflow = [
        { step_id: 'step1', type: 'action', plugin: 'gmail', action: 'search_emails' },
        { step_id: 'step2', type: 'transform', dependencies: ['step99'] } // step99 doesn't exist!
      ];

      const result = validator.validatePreFlight(workflow);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Step 'step2' depends on non-existent step 'step99'"
      );
    });

    it('should detect forward dependencies (depending on later steps)', () => {
      const workflow = [
        { step_id: 'step1', type: 'action', plugin: 'gmail', action: 'search_emails', dependencies: ['step2'] }, // Forward dependency!
        { step_id: 'step2', type: 'transform' }
      ];

      const result = validator.validatePreFlight(workflow);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('depends on later step'))).toBe(true);
    });

    it('should detect circular dependencies', () => {
      const workflow = [
        { step_id: 'step1', type: 'action', dependencies: ['step2'] },
        { step_id: 'step2', type: 'transform', dependencies: ['step1'] } // Circular!
      ];

      const result = validator.validatePreFlight(workflow);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Circular dependency'))).toBe(true);
    });

    it('should detect missing type field', () => {
      const workflow = [
        { step_id: 'step1', plugin: 'gmail', action: 'search_emails' } // Missing type!
      ];

      const result = validator.validatePreFlight(workflow);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Step 'step1' is missing 'type' field"
      );
    });

    it('should detect missing plugin field for action steps', () => {
      const workflow = [
        { step_id: 'step1', type: 'action', action: 'search_emails' } // Missing plugin!
      ];

      const result = validator.validatePreFlight(workflow);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Action step 'step1' is missing 'plugin' field"
      );
    });

    it('should detect missing action field for action steps', () => {
      const workflow = [
        { step_id: 'step1', type: 'action', plugin: 'gmail' } // Missing action!
      ];

      const result = validator.validatePreFlight(workflow);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Action step 'step1' is missing 'action' field"
      );
    });

    it('should warn about unknown step types', () => {
      const workflow = [
        { step_id: 'step1', type: 'unknown_type' } // Unknown type
      ];

      const result = validator.validatePreFlight(workflow);

      expect(result.valid).toBe(true); // Valid, but with warning
      expect(result.warnings).toBeDefined();
      expect(result.warnings).toContain(
        "Step 'step1' has unknown type 'unknown_type'"
      );
    });

    it('should reject empty workflow', () => {
      const result = validator.validatePreFlight([]);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Workflow cannot be empty');
    });

    it('should reject non-array workflow', () => {
      const result = validator.validatePreFlight(null as any);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Workflow must be an array');
    });

    it('should validate complex workflow with parallel steps', () => {
      const workflow = [
        { step_id: 'step1', type: 'action', plugin: 'gmail', action: 'search_emails', dependencies: [] },
        { step_id: 'step2', type: 'transform', dependencies: ['step1'] },
        { step_id: 'step3', type: 'scatter_gather', dependencies: ['step2'] },
        { step_id: 'step4', type: 'action', plugin: 'slack', action: 'send_message', dependencies: ['step3'] }
      ];

      const result = validator.validatePreFlight(workflow);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should allow steps with no dependencies', () => {
      const workflow = [
        { step_id: 'step1', type: 'action', plugin: 'gmail', action: 'search_emails' },
        { step_id: 'step2', type: 'action', plugin: 'slack', action: 'send_message' }
      ];

      const result = validator.validatePreFlight(workflow);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  // ============================================================================
  // Phase 6 — Field-reference validation
  // See workplan: docs/workplans/wire-field-reference-validation-into-preflight.md
  // ============================================================================
  describe('validatePreFlight — field-reference validation', () => {
    // Reusable producer step that emits a sender/subject schema
    const producerWithEmailSchema = {
      step_id: 'step1',
      type: 'action',
      plugin: 'gmail',
      action: 'search_emails',
      output_schema: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          subject: { type: 'string' },
          sender: { type: 'string' },
        },
      },
    };

    // T1 — valid reference, no warnings
    it('T1: passes a workflow whose refs match the producer schema', () => {
      const workflow = [
        producerWithEmailSchema,
        {
          step_id: 'step2',
          type: 'action',
          plugin: 'slack',
          action: 'send_message',
          dependencies: ['step1'],
          params: { text: '{{step1.email}}' },
        },
      ];

      const result = validator.validatePreFlight(workflow, {
        runMode: 'production',
        strictFieldValidation: true,
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      // Should not produce a field-ref warning for valid refs
      const fieldRefWarning = (result.warnings || []).find(w => w.includes("'{{step1.email}}'"));
      expect(fieldRefWarning).toBeUndefined();
    });

    // T2 — high-confidence case-mismatch (LLMs do this often:
    // referencing {{step1.EMAIL}} when the schema declares 'email').
    // The existing findSimilarField returns confidence 1.0 for case-only
    // mismatches, which sits above the 0.95 block threshold.
    it('T2: blocks high-confidence case-mismatch refs in strict+production mode', () => {
      const workflow = [
        producerWithEmailSchema,
        {
          step_id: 'step2',
          type: 'action',
          plugin: 'slack',
          action: 'send_message',
          dependencies: ['step1'],
          params: { text: '{{step1.EMAIL}}' }, // schema declares 'email' (lowercase)
        },
      ];

      const result = validator.validatePreFlight(workflow, {
        runMode: 'production',
        strictFieldValidation: true,
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("'{{step1.EMAIL}}'") && e.includes('email'))).toBe(true);
    });

    // T3 — same case-mismatch, strictFieldValidation=false → warning only
    it('T3: same case-mismatch is a warning only when strict flag is off', () => {
      const workflow = [
        producerWithEmailSchema,
        {
          step_id: 'step2',
          type: 'action',
          plugin: 'slack',
          action: 'send_message',
          dependencies: ['step1'],
          params: { text: '{{step1.EMAIL}}' },
        },
      ];

      const result = validator.validatePreFlight(workflow, {
        runMode: 'production',
        strictFieldValidation: false,
      });

      expect(result.valid).toBe(true);
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.some(w => w.includes("'{{step1.EMAIL}}'"))).toBe(true);
    });

    // T4 — same case-mismatch, runMode=calibration → warning only
    it('T4: high-confidence issue stays a warning in calibration mode', () => {
      const workflow = [
        producerWithEmailSchema,
        {
          step_id: 'step2',
          type: 'action',
          plugin: 'slack',
          action: 'send_message',
          dependencies: ['step1'],
          params: { text: '{{step1.EMAIL}}' },
        },
      ];

      const result = validator.validatePreFlight(workflow, {
        runMode: 'calibration',
        strictFieldValidation: true,
      });

      expect(result.valid).toBe(true);
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.some(w => w.includes("'{{step1.EMAIL}}'"))).toBe(true);
    });

    // T6 — filter operation with item. prefix bug (operation_field validator)
    it('T6: blocks filter ops with the item.* prefix bug at high confidence', () => {
      const workflow = [
        {
          step_id: 'step1',
          type: 'action',
          plugin: 'gmail',
          action: 'search_emails',
          output_schema: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                sender: { type: 'string' },
                subject: { type: 'string' },
              },
            },
          },
        },
        {
          step_id: 'step2',
          type: 'transform',
          operation: 'filter',
          input: '{{step1}}',
          dependencies: ['step1'],
          config: {
            condition: { field: 'item.sender', operator: 'eq', value: 'x@y.com' },
          },
        },
      ];

      const result = validator.validatePreFlight(workflow, {
        runMode: 'production',
        strictFieldValidation: true,
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('item.sender') && e.includes('sender'))).toBe(true);
    });

    // T8 — producer without output_schema produces aggregated warning
    it('T8: aggregates an unverifiable-producer warning when output_schema is missing', () => {
      const workflow = [
        {
          step_id: 'step1',
          type: 'action',
          plugin: 'gmail',
          action: 'search_emails',
          // NOTE: no output_schema
        },
        {
          step_id: 'step2',
          type: 'action',
          plugin: 'slack',
          action: 'send_message',
          dependencies: ['step1'],
          params: { text: '{{step1.email}}' },
        },
      ];

      const result = validator.validatePreFlight(workflow, {
        runMode: 'production',
        strictFieldValidation: true,
      });

      // Cannot validate refs, so should not block.
      expect(result.valid).toBe(true);
      expect(result.warnings).toBeDefined();
      const aggWarning = result.warnings!.find(w =>
        w.includes('could not be validated') && w.includes('step1')
      );
      expect(aggWarning).toBeDefined();
    });

    // T10 — refs inside nested loop / scatter steps are still checked
    it('T10: validates references inside nested scatter_gather steps', () => {
      const workflow = [
        producerWithEmailSchema,
        {
          step_id: 'step2',
          type: 'scatter_gather',
          dependencies: ['step1'],
          scatter: {
            input: '{{step1}}',
            itemVariable: 'email',
            steps: [
              {
                step_id: 'step2a',
                type: 'action',
                plugin: 'slack',
                action: 'send_message',
                // High-confidence case-mismatch nested two levels deep
                params: { text: '{{step1.EMAIL}}' },
              },
            ],
          },
        },
      ];

      const result = validator.validatePreFlight(workflow, {
        runMode: 'production',
        strictFieldValidation: true,
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('step2a') && e.includes('EMAIL'))).toBe(true);
    });

    // Backward compatibility — calling without options behaves like before for valid refs
    it('is backward-compatible when called without options', () => {
      const workflow = [
        producerWithEmailSchema,
        {
          step_id: 'step2',
          type: 'action',
          plugin: 'slack',
          action: 'send_message',
          dependencies: ['step1'],
          params: { text: '{{step1.email}}' },
        },
      ];

      // Old-style call (no options arg)
      const result = validator.validatePreFlight(workflow);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  // ============================================================================
  // Phase 6 — Tier 3 Fix #11 — Structural validation wired into pre-flight
  // See workplan: docs/workplans/output-validation-as-real-gate.md
  // (the rename and wire of `workflow-structure-validator.ts`)
  // ============================================================================
  describe('validatePreFlight — structural validation (Tier 3 Fix #11)', () => {
    // ST1 — loop missing iterateOver: caught only when structuralValidation is on
    it('ST1: loop missing iterateOver → no error when flag is off', () => {
      const workflow = [
        {
          step_id: 'step1',
          id: 'step1',
          name: 'fetch',
          type: 'action',
          plugin: 'gmail',
          action: 'search_emails',
        },
        {
          step_id: 'step2',
          id: 'step2',
          name: 'loop',
          type: 'loop',
          // iterateOver intentionally missing
          loopSteps: [],
          dependencies: ['step1'],
        },
      ];

      const result = validator.validatePreFlight(workflow);
      // The base validator passes — the missing-iterateOver check is
      // exclusively in the structural validator, which is off here.
      expect(result.valid).toBe(true);
    });

    it('ST2: loop missing iterateOver → blocking error in strict+production', () => {
      const workflow = [
        {
          step_id: 'step1',
          id: 'step1',
          name: 'fetch',
          type: 'action',
          plugin: 'gmail',
          action: 'search_emails',
        },
        {
          step_id: 'step2',
          id: 'step2',
          name: 'loop',
          type: 'loop',
          // iterateOver intentionally missing
          loopSteps: [],
          dependencies: ['step1'],
        },
      ];

      const result = validator.validatePreFlight(workflow, {
        runMode: 'production',
        structuralValidation: true,
      });

      expect(result.valid).toBe(false);
      expect(
        result.errors.some(e => e.includes('iterateOver') && e.includes('[structural]'))
      ).toBe(true);
    });

    it('ST3: loop missing iterateOver → warning only in calibration', () => {
      const workflow = [
        {
          step_id: 'step1',
          id: 'step1',
          name: 'fetch',
          type: 'action',
          plugin: 'gmail',
          action: 'search_emails',
        },
        {
          step_id: 'step2',
          id: 'step2',
          name: 'loop',
          type: 'loop',
          loopSteps: [],
          dependencies: ['step1'],
        },
      ];

      const result = validator.validatePreFlight(workflow, {
        runMode: 'calibration',
        structuralValidation: true,
      });

      // Calibration: errors degrade to warnings; workflow stays valid.
      expect(result.valid).toBe(true);
      expect(result.warnings).toBeDefined();
      expect(
        result.warnings!.some(w => w.includes('iterateOver') && w.includes('[structural]'))
      ).toBe(true);
    });

    it('ST4: scatter_gather missing gather → blocking error in strict+production', () => {
      const workflow = [
        {
          step_id: 'step1',
          id: 'step1',
          name: 'fetch',
          type: 'action',
          plugin: 'gmail',
          action: 'search_emails',
        },
        {
          step_id: 'step2',
          id: 'step2',
          name: 'scatter',
          type: 'scatter_gather',
          scatter: { input: '{{step1.data}}', steps: [] },
          // gather intentionally missing
          dependencies: ['step1'],
        },
      ];

      const result = validator.validatePreFlight(workflow, {
        runMode: 'production',
        structuralValidation: true,
      });

      expect(result.valid).toBe(false);
      expect(
        result.errors.some(e => e.includes('gather') && e.includes('[structural]'))
      ).toBe(true);
    });

    it('ST5: a well-formed workflow passes structural validation', () => {
      const workflow = [
        {
          step_id: 'step1',
          id: 'step1',
          name: 'fetch',
          type: 'action',
          plugin: 'gmail',
          action: 'search_emails',
        },
        {
          step_id: 'step2',
          id: 'step2',
          name: 'loop',
          type: 'loop',
          iterateOver: '{{step1.data}}',
          loopSteps: [
            {
              id: 'step2a',
              name: 'inner',
              type: 'action',
              plugin: 'slack',
              action: 'send_message',
              params: {},
            },
          ],
          dependencies: ['step1'],
        },
      ];

      const result = validator.validatePreFlight(workflow, {
        runMode: 'production',
        structuralValidation: true,
      });

      // Should be valid — no structural errors. Some structural warnings
      // (AI-pattern hints, etc.) may still appear, that's fine.
      expect(result.valid).toBe(true);
      const structuralErrors = (result.errors || []).filter(e => e.includes('[structural]'));
      expect(structuralErrors).toEqual([]);
    });
  });
});
