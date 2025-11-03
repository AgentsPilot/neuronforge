import React, { useRef, useEffect } from 'react';
import { Message } from '../types';

interface ChatMessagesProps {
  messages: Message[];
  children: React.ReactNode;
}

export default function ChatMessages({ messages, children }: ChatMessagesProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastMessageCount = useRef(messages.length);

  // Auto-scroll on new messages
  useEffect(() => {
    if (messages.length > lastMessageCount.current) {
      lastMessageCount.current = messages.length;

      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }, 100);
    }
  }, [messages.length]);

  return (
    <div className="flex-1 overflow-y-auto pb-32">
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
        {children}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
