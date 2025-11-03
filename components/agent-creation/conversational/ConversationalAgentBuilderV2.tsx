/**
 * Conversational Agent Builder V2
 *
 * Modern ChatGPT/Claude-style interface for agent creation.
 * Integrates with thread-based API for optimal token usage.
 */

import React from 'react';
import { ConversationalAgentBuilderProps } from './types';
import { useConversationalFlow } from './hooks/useConversationalFlow';
import { getPlaceholderText } from './utils/messageFormatter';

// Components
import ChatHeader from './components/ChatHeader';
import ChatMessages from './components/ChatMessages';
import ChatInput from './components/ChatInput';
import ConfidenceBar from './components/ConfidenceBar';
import TypingIndicator from './components/TypingIndicator';
import UserMessage from './components/messages/UserMessage';
import AIMessage from './components/messages/AIMessage';

export default function ConversationalAgentBuilderV2({
  initialPrompt,
  onPromptApproved,
  onCancel,
  restoredState,
  onStateChange
}: ConversationalAgentBuilderProps) {

  const {
    messages,
    confidenceScore,
    currentStage,
    isProcessing,
    missingPlugins,
    handlePluginConnected,
    handleAnswerQuestion,
    handleAcceptPrompt,
    handleRevisePrompt,
    handleSendMessage,
  } = useConversationalFlow({
    initialPrompt,
    restoredState,
    onStateChange,
    onComplete: onPromptApproved
  });

  const waitingForPlugins = currentStage === 'plugins' && missingPlugins.length > 0;

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      {/* Header */}
      <ChatHeader onCancel={onCancel} />

      {/* Messages Area */}
      <ChatMessages messages={messages}>
        {messages.map((message) => {
          if (message.type === 'user') {
            return <UserMessage key={message.id} message={message} />;
          }

          if (message.type === 'ai' || message.type === 'system') {
            return (
              <AIMessage
                key={message.id}
                message={message}
                onPluginConnect={handlePluginConnected}
                onAnswerQuestion={handleAnswerQuestion}
                onAcceptPrompt={handleAcceptPrompt}
                onRevisePrompt={handleRevisePrompt}
              />
            );
          }

          return null;
        })}

        {isProcessing && <TypingIndicator />}
      </ChatMessages>

      {/* Confidence Bar */}
      <ConfidenceBar score={confidenceScore} />

      {/* Input */}
      <ChatInput
        onSubmit={handleSendMessage}
        disabled={isProcessing || waitingForPlugins}
        placeholder={getPlaceholderText(currentStage, waitingForPlugins, isProcessing)}
      />
    </div>
  );
}
