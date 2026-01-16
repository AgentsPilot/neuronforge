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
});
