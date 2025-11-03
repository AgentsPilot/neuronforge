import React from 'react';

interface TextMessageProps {
  content: string;
}

export default function TextMessage({ content }: TextMessageProps) {
  return (
    <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap break-words">
      {content}
    </div>
  );
}
