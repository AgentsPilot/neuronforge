import type { FailureClassification, StepFailureContext } from './types';

export class FailureClassifier {
  classify(
    _error: { message: string; code?: string } | Error,
    _context?: StepFailureContext
  ): FailureClassification {
    return {
      category: 'execution_error',
      sub_type: undefined,
      is_auto_retryable: false,
      severity: 'medium',
    };
  }
}
