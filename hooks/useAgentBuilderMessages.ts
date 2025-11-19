import { useState, useRef, useCallback } from 'react';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'typing';
  content: string;
  timestamp: Date;
  questionId?: string;
  isQuestionAnswer?: boolean;
  isTemporary?: boolean; // For typing indicators that will be removed
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

  // Add a typing indicator (temporary message that gets replaced)
  const addTypingIndicator = useCallback((text: string = 'Thinking...') => {
    const typingMessage: Message = {
      id: 'typing-indicator',
      role: 'typing',
      content: text,
      timestamp: new Date(),
      isTemporary: true
    };

    setMessages(prev => [...prev, typingMessage]);
    return typingMessage.id;
  }, []);

  // Remove typing indicator
  const removeTypingIndicator = useCallback(() => {
    setMessages(prev => prev.filter(msg => msg.id !== 'typing-indicator'));
  }, []);

  // Remove last message if it's a temporary one (like static thinking messages)
  const removeLastIfTemporary = useCallback(() => {
    setMessages(prev => {
      if (prev.length === 0) return prev;
      const lastMessage = prev[prev.length - 1];
      // Remove if it's a typing indicator OR a static "thinking" message
      if (lastMessage.isTemporary ||
          (lastMessage.role === 'assistant' &&
           (lastMessage.content.includes('Let me analyze') ||
            lastMessage.content.includes('Let me create')))) {
        return prev.slice(0, -1);
      }
      return prev;
    });
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
    clearMessages,
    addTypingIndicator,
    removeTypingIndicator,
    removeLastIfTemporary
  };
}
