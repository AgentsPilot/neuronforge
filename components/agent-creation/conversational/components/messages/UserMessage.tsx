import React from 'react';
import { User, Clock, CheckCircle } from 'lucide-react';
import { UserMessageProps } from '../../types';
import { formatTime } from '../../utils/messageFormatter';

export default function UserMessage({ message }: UserMessageProps) {
  return (
    <div className="flex gap-3 justify-end">
      <div className="max-w-2xl relative">
        <div
          className={`
            rounded-xl px-4 py-3 shadow-md backdrop-blur-sm relative
            bg-gradient-to-br from-blue-600 to-indigo-700 text-white
            ${message.isQuestionAnswer ? 'ring-2 ring-green-300 ring-offset-2' : ''}
          `}
        >
          {message.isQuestionAnswer && (
            <div className="absolute -top-1 -right-1 w-5 h-5 bg-gradient-to-br from-emerald-400 to-green-500 rounded-full flex items-center justify-center shadow-md">
              <CheckCircle className="h-3 w-3 text-white" />
            </div>
          )}

          <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">
            {message.content}
          </div>

          <div className="flex items-center gap-1 mt-2 text-xs text-blue-100">
            <Clock className="h-3 w-3" />
            {formatTime(message.timestamp)}
          </div>
        </div>
      </div>

      <div className="w-8 h-8 bg-gradient-to-br from-gray-400 to-gray-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-md">
        <User className="h-4 w-4 text-white" />
      </div>
    </div>
  );
}
