/**
 * Tests for the user-facing issue translator.
 *
 * The translator is the single boundary between technical issue payloads
 * and the UI shown to non-technical users. Every output must be plain
 * English with no step IDs, regex strings, schema paths, or jargon.
 */

import { toUserFacing, toUserFacingList } from '../userFacing';

describe('userFacing — toUserFacing()', () => {
  // ──────────────────────────────────────────────────────────────────────
  // Defensive: any input must produce a valid UserFacingIssue
  // ──────────────────────────────────────────────────────────────────────
  describe('defensive defaults', () => {
    it('handles null', () => {
      const out = toUserFacing(null);
      expect(out.title).toBeTruthy();
      expect(out.message).toBeTruthy();
      expect(out.severity).toBeDefined();
      expect(out._technical).toBeDefined();
    });

    it('handles undefined', () => {
      const out = toUserFacing(undefined);
      expect(out.title).toBeTruthy();
      expect(out.message).toBeTruthy();
    });

    it('handles empty object', () => {
      const out = toUserFacing({});
      expect(out.title).toBeTruthy();
      expect(out.message).toBeTruthy();
    });

    it('handles random shape', () => {
      const out = toUserFacing({ foo: 'bar', baz: 123 });
      expect(out.title).toBeTruthy();
      expect(out.message).toBeTruthy();
      expect(out._technical).toMatchObject({ foo: 'bar', baz: 123 });
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Field-reference message string (from WorkflowValidator)
  // ──────────────────────────────────────────────────────────────────────
  describe('field-reference messages', () => {
    it('translates a typical field-reference error into plain English', () => {
      const raw = `Step 'step2' references '{{step1.EMAIL}}' at parameter 'params.text' — Field 'EMAIL' not found in step1 output. Available fields: email, subject. Suggested fix: '{{step1.email}}' (confidence 95%).`;

      const out = toUserFacing(raw);

      // Title is short, message is non-technical
      expect(out.title.toLowerCase()).toContain('field');
      expect(out.message).toContain('"email"'); // The actual field name
      expect(out.message).toContain('Step 1'); // Friendly step
      // Must NOT contain raw template syntax
      expect(out.message).not.toContain('{{');
      expect(out.message).not.toContain('}}');
      // No raw step ID
      expect(out.message).not.toMatch(/\bstep1\b/);
      expect(out.severity).toBe('must_fix');
      expect(out.category).toBe('data_flow');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Dry-run issues
  // ──────────────────────────────────────────────────────────────────────
  describe('dry-run issues', () => {
    it('translates an empty_result issue', () => {
      const out = toUserFacing({
        source: 'dry_run',
        type: 'empty_result',
        severity: 'high',
        description: 'Workflow returned 0 results',
      });

      expect(out.title.toLowerCase()).toMatch(/return|nothing|empty/i);
      expect(out.severity).toBe('must_fix');
      expect(out.what_to_do).toBeTruthy();
      // No jargon
      expect(out.message.toLowerCase()).not.toContain('dry_run');
      expect(out.message.toLowerCase()).not.toContain('workflow_type');
    });

    it('translates an execution_failed issue', () => {
      const out = toUserFacing({
        source: 'dry_run',
        type: 'execution_failed',
        severity: 'critical',
        description: 'Step failed at step3',
      });
      expect(out.severity).toBe('must_fix');
      expect(out.message.toLowerCase()).toMatch(/finish|couldn/);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Calibration non-convergence
  // ──────────────────────────────────────────────────────────────────────
  describe('non-convergence', () => {
    it('translates the non_convergence issue into a friendly summary', () => {
      const out = toUserFacing({
        source: 'calibration_loop',
        type: 'non_convergence',
        severity: 'high',
        description: 'Auto-calibration did not converge after 10 iterations.',
        details: { totalIterations: 10, autoFixesApplied: 7, remainingIssueCount: 3 },
      });

      // Must not contain technical terms
      expect(out.message.toLowerCase()).not.toContain('iterations');
      expect(out.message.toLowerCase()).not.toContain('converge');
      expect(out.what_to_do).toBeTruthy();
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Structural validator messages
  // ──────────────────────────────────────────────────────────────────────
  describe('structural messages', () => {
    it('translates a missing-iterateOver structural error', () => {
      const out = toUserFacing(
        `[structural] workflow_steps[1]: Loop step missing required field "iterateOver"`,
      );

      expect(out.title.toLowerCase()).toMatch(/loop/);
      expect(out.message).not.toContain('iterateOver');
      expect(out.message).not.toContain('workflow_steps');
      expect(out.message).not.toContain('[structural]');
      expect(out.severity).toBe('must_fix');
      expect(out.category).toBe('workflow_structure');
    });

    it('translates a missing-gather structural error', () => {
      const out = toUserFacing(
        `[structural] workflow_steps[2]: Scatter-gather step missing required field "gather"`,
      );

      expect(out.title.toLowerCase()).toMatch(/parallel|combining/);
      expect(out.message).not.toContain('Scatter-gather');
      expect(out.message).not.toContain('gather');
    });

    it('translates a generic structural error to a friendly fallback', () => {
      const out = toUserFacing(`[structural] Some unrecognized error format`);
      expect(out.severity).toBe('must_fix');
      expect(out.category).toBe('workflow_structure');
      // No bracket-prefix leaks
      expect(out.message).not.toContain('[structural]');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Hardcoded values
  // ──────────────────────────────────────────────────────────────────────
  describe('hardcoded values', () => {
    it('translates a hardcoded-value detection', () => {
      const out = toUserFacing({
        source: 'hardcode',
        type: 'hardcoded_value',
        label: 'Email recipient',
        stepId: 'step3',
        value: 'someone@example.com',
      });

      expect(out.title).toContain('Email recipient');
      expect(out.severity).toBe('heads_up');
      expect(out.category).toBe('configuration');
      expect(out.what_to_do).toBeTruthy();
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Auth / connection
  // ──────────────────────────────────────────────────────────────────────
  describe('auth issues', () => {
    it('translates an auth issue with plugin friendly name', () => {
      const out = toUserFacing({
        source: 'auth',
        plugin: 'google-mail',
      });

      expect(out.title).toContain('Gmail'); // friendly plugin name
      expect(out.title.toLowerCase()).toContain('reconnect');
      expect(out.severity).toBe('must_fix');
      expect(out.category).toBe('connection');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Output schema
  // ──────────────────────────────────────────────────────────────────────
  describe('output schema issues', () => {
    it('translates an output_schema validation failure', () => {
      const out = toUserFacing({
        source: 'output_schema',
        description: 'details[0].subject: should be string',
      });

      expect(out.message).not.toContain('details[0]');
      expect(out.message).not.toContain('schema');
      expect(out.severity).toBe('must_fix');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Auto-repaired
  // ──────────────────────────────────────────────────────────────────────
  describe('auto-repaired', () => {
    it('translates an auto-repaired issue into informational tone', () => {
      const out = toUserFacing({
        source: 'auto_repaired',
        action: 'extract_array_field',
        description: 'Extracted array from envelope',
      });

      expect(out.severity).toBe('will_auto_fix');
      expect(out.category).toBe('auto_repaired');
      expect(out.title.toLowerCase()).toContain('fixed');
    });

    it('recognizes auto_fixed flag without explicit source', () => {
      const out = toUserFacing({
        auto_fixed: true,
        repair_type: 'wrap_in_array',
      });
      expect(out.severity).toBe('will_auto_fix');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // No jargon leaks
  // ──────────────────────────────────────────────────────────────────────
  describe('jargon leak guard', () => {
    const forbidden = [
      'VariableResolutionError',
      'NullPointerException',
      'workflow_steps[',
      'output_schema',
      'pilot_steps',
      'context.scope',
      'as any',
      '{{', // unresolved templates
    ];

    it('does NOT leak technical jargon from a complex raw payload', () => {
      const raw = {
        source: 'unknown',
        description: 'VariableResolutionError: workflow_steps[3].output_schema missing field {{step1.foo}}',
        stepId: 'step3',
      };
      const out = toUserFacing(raw);
      const combined = `${out.title} ${out.message} ${out.what_to_do ?? ''}`;
      for (const term of forbidden) {
        expect(combined).not.toContain(term);
      }
    });
  });
});

describe('userFacing — toUserFacingList()', () => {
  it('returns [] for non-array input', () => {
    expect(toUserFacingList(null as any)).toEqual([]);
    expect(toUserFacingList(undefined as any)).toEqual([]);
    expect(toUserFacingList('string' as any)).toEqual([]);
  });

  it('maps each item through toUserFacing', () => {
    const out = toUserFacingList([
      { source: 'dry_run', type: 'empty_result' },
      { source: 'auth', plugin: 'slack' },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].category).toBe('data_quality');
    expect(out[1].category).toBe('connection');
  });
});
