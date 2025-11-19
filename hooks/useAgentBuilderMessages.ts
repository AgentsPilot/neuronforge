import { useState, useRef, useCallback } from 'react';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  questionId?: string;
  isQuestionAnswer?: boolean;
}

/**
 * Hook to manage agent builder messages
 * Simplified version of useMessageHandlers for V2 UI
 */
export function useAgentBuilderMessages() {
  const [messages, setMessages] = useState<Message[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Add a message to the conversation
  const addMessage = useCallback((
    content: string,
    role: 'user' | 'assistant' | 'system' = 'assistant',
    questionId?: string,
    isQuestionAnswer?: boolean
  ) => {
    const newMessage: Message = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      role,
      content,
      timestamp: new Date(),
      questionId,
      isQuestionAnswer
    };

    setMessages(prev => [...prev, newMessage]);
  }, []);

  // Add a user message
  const addUserMessage = useCallback((content: string) => {
    addMessage(content, 'user');
  }, [addMessage]);

  // Add an AI message
  const addAIMessage = useCallback((content: string) => {
    addMessage(content, 'assistant');
  }, [addMessage]);

  // Add a system message (for status updates)
  const addSystemMessage = useCallback((content: string) => {
    addMessage(content, 'system');
  }, [addMessage]);

  // Add a question answer pair
  const addQuestionAnswer = useCallback((questionId: string, answer: string) => {
    // Add user's answer
    addMessage(answer, 'user', questionId, true);

    // Add system confirmation
    setTimeout(() => {
      addMessage('Question answered', 'system', questionId);
    }, 300);
  }, [addMessage]);

  // Clear all messages
  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  return {
    messages,
    setMessages,
    messagesEndRef,
    addMessage,
    addUserMessage,
    addAIMessage,
    addSystemMessage,
    addQuestionAnswer,
    clearMessages
  };
}
