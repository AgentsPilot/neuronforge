/**
 * Calibration Metrics Utilities
 *
 * Functions for calculating calibration quality scores, workflow complexity,
 * and extracting metadata for analytics.
 */

/**
 * Calculate calibration quality score (0-100)
 *
 * Scoring:
 * - 100: Perfect (0 issues found, 0 failures)
 * - 95: Excellent (all issues auto-fixed, 0 failures)
 * - 75: Good (only minor warnings remain, 0 failures)
 * - 40: Needs review (critical issues or failures)
 * - 0: Failed
 */
export function calculateCalibrationQualityScore(result: {
  status: string;
  issues_found: any[];
  issues_remaining: any[];
  steps_failed: number;
}): number {
  // Failed calibration
  if (result.status === 'failed') {
    return 0;
  }

  // Perfect - no issues found at all
  if (result.status === 'success' &&
      result.issues_found.length === 0 &&
      result.steps_failed === 0) {
    return 100;
  }

  // Excellent - all issues auto-fixed
  if (result.status === 'success' &&
      result.issues_remaining.length === 0 &&
      result.steps_failed === 0) {
    return 95;
  }

  // Good - only minor warnings remain
  const criticalRemaining = result.issues_remaining.filter(
    (i: any) => i.severity === 'high' || i.severity === 'critical'
  ).length;

  if (result.status === 'success' &&
      criticalRemaining === 0 &&
      result.steps_failed === 0) {
    return 75;
  }

  // Needs review - has critical issues or failed steps
  if (result.status === 'needs_review' || criticalRemaining > 0) {
    return 40;
  }

  // Default for any other "success" with issues
  return 50;
}

/**
 * Extract unique plugin names from workflow steps
 *
 * Recursively traverses workflow structure to find all plugins used.
 * Returns unique plugin names as an array.
 */
export function extractPluginsFromWorkflow(steps: any[]): string[] {
  const plugins = new Set<string>();

  function extractFromStep(step: any) {
    // Add plugin if present
    if (step.plugin) {
      plugins.add(step.plugin);
    }

    // Check nested steps (parallel)
    if (step.steps && Array.isArray(step.steps)) {
      step.steps.forEach(extractFromStep);
    }

    // Check branches (conditional)
    if (step.branches) {
      Object.values(step.branches).forEach((branch: any) => {
        if (branch.steps && Array.isArray(branch.steps)) {
          branch.steps.forEach(extractFromStep);
        }
      });
    }
  }

  steps.forEach(extractFromStep);
  return Array.from(plugins).sort(); // Sort for consistency
}

/**
 * Calculate workflow complexity score (1-10)
 *
 * Factors:
 * - Step count (max 3 points)
 * - Nested steps: parallel/conditional (1.5 points each)
 * - Transform steps (1 point each)
 * - LLM decision steps (1.5 points each)
 *
 * Higher scores predict more difficult calibration.
 */
export function calculateWorkflowComplexity(steps: any[]): number {
  let score = 0;

  // Base: step count (max 3 points)
  score += Math.min(steps.length * 0.5, 3);

  // Count different step types
  let nestedCount = 0;
  let transformCount = 0;
  let llmCount = 0;

  function countStepTypes(stepArray: any[]) {
    stepArray.forEach(step => {
      // Nested steps (parallel, conditional)
      if (step.type === 'parallel' || step.branches) {
        nestedCount++;
      }

      // Transforms
      if (step.type === 'transform') {
        transformCount++;
      }

      // LLM decisions
      if (step.type === 'llm_decision') {
        llmCount++;
      }

      // Recurse into nested steps
      if (step.steps && Array.isArray(step.steps)) {
        countStepTypes(step.steps);
      }

      // Recurse into branches
      if (step.branches) {
        Object.values(step.branches).forEach((branch: any) => {
          if (branch.steps && Array.isArray(branch.steps)) {
            countStepTypes(branch.steps);
          }
        });
      }
    });
  }

  countStepTypes(steps);

  // Add points for complexity factors
  score += nestedCount * 1.5; // Parallel/conditional adds complexity
  score += transformCount * 1; // Transforms add moderate complexity
  score += llmCount * 1.5; // LLM decisions add significant complexity

  // Cap at 10 and round
  return Math.min(Math.round(score), 10);
}

/**
 * Extract V6 version from environment or package.json
 *
 * Tries to determine V6 version for quality tracking.
 * Returns null if not available.
 */
export function getV6Version(): string | null {
  // Try environment variable first
  if (process.env.V6_VERSION) {
    return process.env.V6_VERSION;
  }

  // TODO: Could also read from package.json if versioned there
  // For now, return null - can be set manually in environment

  return null;
}

/**
 * Determine if calibration was successful on first execution
 *
 * Returns true if no auto-fixes were applied (iterations === 1 and no fixes)
 */
export function wasFirstExecutionSuccessful(
  iterations: number,
  autoFixesApplied: number
): boolean {
  return iterations === 1 && autoFixesApplied === 0;
}
