/**
 * Conversational Agent Builder V2 - Main Exports
 */

export { default as ConversationalAgentBuilderV2 } from './ConversationalAgentBuilderV2';

// Export types
export type {
  Message,
  MessageType,
  ConversationalStage,
  ConversationalFlowState,
  ClarificationQuestion,
  ConversationalAgentBuilderProps,
} from './types';

// Export hooks
export { useConversationalFlow } from './hooks/useConversationalFlow';
export { useThreadManagement } from './hooks/useThreadManagement';

// Export utilities
export {
  calculateConfidence,
  getConfidenceColor,
  getConfidenceGradient
} from './utils/confidenceCalculator';

export {
  formatTime,
  getPlaceholderText,
  getPluginDisplayName,
  getPluginDescription
} from './utils/messageFormatter';
