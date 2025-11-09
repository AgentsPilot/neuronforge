import React, { useState } from 'react';
import { Edit3 } from 'lucide-react';
import { QuestionCardProps } from '../../types';

export default function QuestionCard({
  question,
  questionNumber,
  totalQuestions,
  onAnswer,
  isProcessing = false
}: QuestionCardProps) {
  const [customValue, setCustomValue] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);

  const handleOptionSelect = (value: string, label: string) => {
    onAnswer(question.id, value, label);
  };

  const handleCustomSubmit = () => {
    if (customValue.trim()) {
      onAnswer(question.id, customValue.trim(), customValue.trim()); // For custom, value = label
      setCustomValue('');
      setShowCustomInput(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-blue-600 uppercase tracking-wide">
          Question {questionNumber} of {totalQuestions}
        </span>
      </div>

      <h4 className="text-base font-semibold text-gray-800 mb-4">
        {question.question}
      </h4>

      {question.type === 'select' && question.options && !showCustomInput && (
        <div className="grid grid-cols-2 gap-3">
          {question.options.map((option) => (
            <button
              key={option.value}
              onClick={() => handleOptionSelect(option.value, option.label)}
              disabled={isProcessing}
              className="px-4 py-3 bg-white border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-all text-sm font-medium text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {option.label}
            </button>
          ))}

          <button
            onClick={() => setShowCustomInput(true)}
            disabled={isProcessing}
            className="px-4 py-3 bg-white border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-all text-sm font-medium text-gray-600 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Edit3 className="h-4 w-4" />
            Custom answer
          </button>
        </div>
      )}

      {(question.type === 'text' || showCustomInput) && (
        <div className="space-y-2">
          <input
            type="text"
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
            placeholder="Type your answer..."
            disabled={isProcessing}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed text-sm"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCustomSubmit();
            }}
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={handleCustomSubmit}
              disabled={!customValue.trim() || isProcessing}
              className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm transition-all"
            >
              Submit Answer
            </button>
            {showCustomInput && (
              <button
                onClick={() => {
                  setShowCustomInput(false);
                  setCustomValue('');
                }}
                disabled={isProcessing}
                className="px-4 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm transition-all"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
