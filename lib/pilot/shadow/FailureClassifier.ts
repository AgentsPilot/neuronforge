// TODO: Implement failure classifier
export class FailureClassifier {
  classify(error: Error): {
    type: 'transient' | 'permanent' | 'configuration';
    retryable: boolean;
    suggestions: string[];
  } {
    // Stub implementation
    return {
      type: 'permanent',
      retryable: false,
      suggestions: []
    };
  }
}
