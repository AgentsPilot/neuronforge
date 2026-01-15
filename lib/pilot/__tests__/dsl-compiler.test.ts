/**
 * Unit tests for DSL Compiler
 *
 * Tests DSL validation including:
 * - P10: Conditional lastBranchOutput validation
 * - P11: Loop item variable (item_name) scope tracking
 * - Step reference validation
 * - Output key validation
 * - Template syntax validation
 */

import { compileDsl, getErrorSummary, type DslStep } from '../dsl-compiler';

// Helper to create a basic action step
function createActionStep(id: string, outputs: Record<string, string> = {}): DslStep {
  return {
    id,
    name: `Step ${id}`,
    type: 'action',
    plugin: 'test-plugin',
    action: 'test_action',
    params: {},
    outputs,
  };
}

// Helper to create a transform step
function createTransformStep(
  id: string,
  input: string,
  outputs: Record<string, string> = {}
): DslStep {
  return {
    id,
    name: `Transform ${id}`,
    type: 'transform',
    operation: 'filter',
    input,
    config: { condition: { field: '{{item.active}}', operator: 'equals', value: true } },
    outputs,
  };
}

// Helper to create a conditional step
function createConditionalStep(
  id: string,
  thenSteps: DslStep[],
  elseSteps: DslStep[] = []
): DslStep {
  return {
    id,
    name: `Conditional ${id}`,
    type: 'conditional',
    condition: { field: '{{step1.data.count}}', operator: 'greater_than', value: 0 },
    then_steps: thenSteps,
    else_steps: elseSteps,
  };
}

// Helper to create a scatter_gather (loop) step
function createLoopStep(
  id: string,
  itemVariable: string,
  input: string,
  nestedSteps: DslStep[]
): DslStep {
  return {
    id,
    name: `Loop ${id}`,
    type: 'scatter_gather',
    scatter: {
      input,
      itemVariable,
      steps: nestedSteps,
    },
    gather: {
      operation: 'collect',
      outputKey: id,
    },
  };
}

describe('DslCompiler', () => {
  describe('Basic Step Reference Validation', () => {
    test('should pass validation for valid step references', () => {
      const steps: DslStep[] = [
        createActionStep('step1', { emails: 'array' }),
        {
          ...createTransformStep('step2', '{{step1.data.emails}}'),
          outputs: { filtered: 'array' },
        },
      ];

      const result = compileDsl({ steps });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('should fail validation for reference to non-existent step', () => {
      const steps: DslStep[] = [
        createActionStep('step1', { emails: 'array' }),
        {
          ...createTransformStep('step2', '{{step99.data.emails}}'),
          outputs: { filtered: 'array' },
        },
      ];

      const result = compileDsl({ steps });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.type === 'STEP_NOT_FOUND')).toBe(true);
    });

    test('should fail validation for reference to undeclared output key', () => {
      const steps: DslStep[] = [
        createActionStep('step1', { emails: 'array' }), // declares 'emails'
        {
          ...createTransformStep('step2', '{{step1.messages}}'), // references 'messages' (not 'emails')
          outputs: { filtered: 'array' },
        },
      ];

      const result = compileDsl({ steps });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.type === 'OUTPUT_KEY_NOT_FOUND')).toBe(true);
    });
  });

  describe('P10: Conditional lastBranchOutput Validation', () => {
    test('should allow lastBranchOutput reference for conditional steps', () => {
      const steps: DslStep[] = [
        createActionStep('step1', { data: 'array' }),
        createConditionalStep(
          'step2',
          [{ ...createActionStep('step2_1', { result: 'object' }) }],
          [{ ...createActionStep('step2_2', { result: 'object' }) }]
        ),
        {
          id: 'step3',
          name: 'Use branch output',
          type: 'ai_processing',
          prompt: 'Process the result',
          params: { data: '{{step2.lastBranchOutput.result}}' },
        },
      ];

      const result = compileDsl({ steps });

      // Should not have errors about lastBranchOutput
      const lastBranchErrors = result.errors.filter(
        e => e.message?.includes('lastBranchOutput')
      );
      expect(lastBranchErrors).toHaveLength(0);
    });

    test('should allow lastBranchOutput in template strings', () => {
      const steps: DslStep[] = [
        createActionStep('step1', { items: 'array' }),
        createConditionalStep(
          'step2',
          [{ ...createActionStep('step2_1', { content: 'string' }) }]
        ),
        {
          id: 'step3',
          name: 'Format output',
          type: 'transform',
          operation: 'format',
          input: '{{step1.data.items}}',
          config: {
            mapping: {
              template: 'Result: {{step2.lastBranchOutput.content}}',
            },
          },
        },
      ];

      const result = compileDsl({ steps });

      // Should not flag lastBranchOutput as invalid
      const outputKeyErrors = result.errors.filter(
        e => e.type === 'OUTPUT_KEY_NOT_FOUND' && e.message?.includes('lastBranchOutput')
      );
      expect(outputKeyErrors).toHaveLength(0);
    });

    test('should error when lastBranchOutput used on non-conditional step', () => {
      const steps: DslStep[] = [
        createActionStep('step1', { emails: 'array' }), // Not a conditional
        {
          id: 'step2',
          name: 'Try to use lastBranchOutput',
          type: 'ai_processing',
          prompt: 'Process',
          params: { data: '{{step1.lastBranchOutput.emails}}' },
        },
      ];

      const result = compileDsl({ steps });

      // Should have an error since step1 is not a conditional
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          e => e.type === 'OUTPUT_KEY_NOT_FOUND' && e.message?.includes('lastBranchOutput')
        )
      ).toBe(true);
    });
  });

  describe('P11: Loop Item Variable Scope Tracking', () => {
    test('should allow custom item_name references inside loop', () => {
      const steps: DslStep[] = [
        createActionStep('step1', { emails: 'array' }),
        createLoopStep('step2', 'email_item', '{{step1.data.emails}}', [
          {
            id: 'step2_1',
            name: 'Process email',
            type: 'ai_processing',
            prompt: 'Summarize email',
            params: {
              subject: '{{email_item.subject}}',
              body: '{{email_item.body}}',
            },
          },
        ]),
      ];

      const result = compileDsl({ steps });

      // Should not have errors about email_item
      const itemErrors = result.errors.filter(
        e => e.message?.includes('email_item')
      );
      expect(itemErrors).toHaveLength(0);
    });

    test('should allow default "item" references inside loop', () => {
      const steps: DslStep[] = [
        createActionStep('step1', { records: 'array' }),
        createLoopStep('step2', 'item', '{{step1.data.records}}', [
          {
            id: 'step2_1',
            name: 'Process item',
            type: 'transform',
            operation: 'map',
            input: '{{item}}',
            config: { mapping: { id: '{{item.id}}', name: '{{item.name}}' } },
          },
        ]),
      ];

      const result = compileDsl({ steps });

      // item. references should be valid inside loop
      const itemErrors = result.errors.filter(
        e => e.message?.includes('item.') && e.type === 'STEP_NOT_FOUND'
      );
      expect(itemErrors).toHaveLength(0);
    });

    test('should error when loop item variable used outside loop scope', () => {
      const steps: DslStep[] = [
        createActionStep('step1', { emails: 'array' }),
        createLoopStep('step2', 'email_item', '{{step1.data.emails}}', [
          {
            id: 'step2_1',
            name: 'Inside loop',
            type: 'ai_processing',
            prompt: 'Process',
            params: { data: '{{email_item.body}}' }, // Valid inside loop
          },
        ]),
        {
          id: 'step3',
          name: 'Outside loop',
          type: 'ai_processing',
          prompt: 'Process',
          params: { data: '{{email_item.body}}' }, // Invalid - outside loop
        },
      ];

      const result = compileDsl({ steps });

      // Should have error for step3 using email_item outside loop
      const step3Errors = result.errors.filter(e => e.stepId === 'step3');
      expect(step3Errors.length).toBeGreaterThan(0);
    });

    test('should handle nested loops with different item variables', () => {
      const steps: DslStep[] = [
        createActionStep('step1', { groups: 'array' }),
        createLoopStep('step2', 'group', '{{step1.data.groups}}', [
          createLoopStep('step2_1', 'member', '{{group.members}}', [
            {
              id: 'step2_1_1',
              name: 'Process member',
              type: 'ai_processing',
              prompt: 'Process',
              params: {
                groupName: '{{group.name}}', // Outer loop variable
                memberName: '{{member.name}}', // Inner loop variable
              },
            },
          ]),
        ]),
      ];

      const result = compileDsl({ steps });

      // Both group and member should be valid in innermost step
      const innerStepErrors = result.errors.filter(e => e.stepId === 'step2_1_1');
      expect(innerStepErrors).toHaveLength(0);
    });

    test('should isolate loop scope - inner variable not available in outer loop', () => {
      const steps: DslStep[] = [
        createActionStep('step1', { groups: 'array' }),
        createLoopStep('step2', 'group', '{{step1.data.groups}}', [
          createLoopStep('step2_1', 'member', '{{group.members}}', [
            {
              id: 'step2_1_1',
              name: 'Inner step',
              type: 'ai_processing',
              prompt: 'Process',
              params: { name: '{{member.name}}' },
            },
          ]),
          {
            id: 'step2_2',
            name: 'After inner loop',
            type: 'ai_processing',
            prompt: 'Process',
            params: { name: '{{member.name}}' }, // Invalid - member not in scope
          },
        ]),
      ];

      const result = compileDsl({ steps });

      // step2_2 should have error for using 'member' outside inner loop
      const step2_2Errors = result.errors.filter(e => e.stepId === 'step2_2');
      expect(step2_2Errors.length).toBeGreaterThan(0);
    });
  });

  describe('Template Validation', () => {
    test('should validate Handlebars template syntax', () => {
      const steps: DslStep[] = [
        createActionStep('step1', { items: 'array' }),
        {
          id: 'step2',
          name: 'Format',
          type: 'transform',
          operation: 'format',
          input: '{{step1.data.items}}',
          config: {
            mapping: {
              template: '{{#each items}}{{this.name}}{{/each}}',
            },
          },
        },
      ];

      const result = compileDsl({ steps });

      // Valid Handlebars should not cause errors
      expect(result.errors.filter(e => e.type === 'TEMPLATE_SYNTAX_ERROR')).toHaveLength(0);
    });

    test('should allow special prefixes in templates', () => {
      const steps: DslStep[] = [
        createActionStep('step1', { data: 'object' }),
        {
          id: 'step2',
          name: 'Use special refs',
          type: 'action',
          plugin: 'test',
          action: 'test',
          params: {
            fromInput: '{{input.user_value}}',
            fromEnv: '{{env.API_KEY}}',
            fromConfig: '{{config.test.setting}}',
          },
        },
      ];

      const result = compileDsl({ steps });

      // Special prefixes (input., env., config.) should not cause errors
      const specialRefErrors = result.errors.filter(
        e =>
          e.message?.includes('input.') ||
          e.message?.includes('env.') ||
          e.message?.includes('config.')
      );
      expect(specialRefErrors).toHaveLength(0);
    });

    test('should allow simple property references inside Handlebars #each blocks', () => {
      const steps: DslStep[] = [
        createActionStep('step1', { emails: 'array' }),
        {
          id: 'step2',
          name: 'Format HTML table',
          type: 'transform',
          operation: 'format',
          input: '{{step1.data.emails}}',
          config: {
            mapping: {
              // Template with {{#each}} and simple property references like {{sender}}, {{subject}}
              template: `<table border="1">
{{#each rows}}
<tr>
  <td>{{sender}}</td>
  <td>{{subject}}</td>
  <td>{{received_time}}</td>
  <td>{{priority}}</td>
</tr>
{{/each}}
</table>`,
            },
          },
          outputs: { html_body: 'string' },
        },
      ];

      const result = compileDsl({ steps });

      // Should NOT have errors for {{sender}}, {{subject}}, etc. inside {{#each}} block
      const unknownRefErrors = result.errors.filter(e => e.type === 'UNKNOWN_REFERENCE');
      expect(unknownRefErrors).toHaveLength(0);
    });

    test('should still error on unknown references outside Handlebars blocks', () => {
      const steps: DslStep[] = [
        createActionStep('step1', { data: 'object' }),
        {
          id: 'step2',
          name: 'Bad template',
          type: 'transform',
          operation: 'format',
          input: '{{step1.data}}',
          config: {
            mapping: {
              // No {{#each}} block, so {{unknown_field}} should be flagged
              template: 'Hello {{unknown_field}}',
            },
          },
        },
      ];

      const result = compileDsl({ steps });

      // Should have error for {{unknown_field}} since it's not inside a Handlebars block
      expect(result.errors.some(e =>
        e.type === 'UNKNOWN_REFERENCE' && e.message?.includes('unknown_field')
      )).toBe(true);
    });
  });

  describe('Error Summary', () => {
    test('should generate readable error summary', () => {
      const steps: DslStep[] = [
        createActionStep('step1', { emails: 'array' }),
        {
          ...createTransformStep('step2', '{{step99.data.missing}}'),
        },
      ];

      const result = compileDsl({ steps });
      const summary = getErrorSummary(result);

      expect(summary).toContain('step99');
      expect(summary).toContain('STEP_NOT_FOUND');
    });
  });

  describe('Mixed Workflow Validation', () => {
    test('should validate complex workflow with conditionals and loops', () => {
      const steps: DslStep[] = [
        createActionStep('step1', { data: 'object' }),
        createConditionalStep('step2', [createActionStep('step2_1', { result: 'string' })]),
        createLoopStep('step3', 'item', '{{step1.data}}', [
          createActionStep('step3_1', {}),
        ]),
      ];

      const result = compileDsl({ steps });

      // Complex workflow should compile without errors (only warnings for missing outputs)
      expect(result.errors).toHaveLength(0);
    });
  });
});
