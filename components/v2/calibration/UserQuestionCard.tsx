'use client';

// components/v2/calibration/UserQuestionCard.tsx
// Simple, non-technical question UI for users

import { useState } from 'react';
import { HelpCircle } from 'lucide-react';

interface UserQuestionCardProps {
  question: string;
  description?: string;
  options: Array<{ label: string; value: string }>;
  onAnswer: (answer: string) => void;
}

export function UserQuestionCard({
  question,
  description,
  options,
  onAnswer
}: UserQuestionCardProps) {
  const [selected, setSelected] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    if (!selected) return;

    setIsSubmitting(true);
    try {
      await onAnswer(selected);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="border-2 border-blue-400 rounded-lg p-4 bg-blue-50">
      <div className="flex items-start gap-3">
        <HelpCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-1" />

        <div className="flex-1">
          <p className="font-medium text-gray-900">{question}</p>

          {description && (
            <p className="text-sm text-gray-600 mt-1">{description}</p>
          )}

          {/* Options (radio buttons or text input) */}
          {options.length > 0 ? (
            <div className="mt-3 space-y-2">
              {options.map((opt) => (
                <label
                  key={opt.value}
                  className="flex items-center gap-2 cursor-pointer p-2 rounded hover:bg-blue-100 transition-colors"
                >
                  <input
                    type="radio"
                    value={opt.value}
                    checked={selected === opt.value}
                    onChange={(e) => setSelected(e.target.value)}
                    className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">{opt.label}</span>
                </label>
              ))}
            </div>
          ) : (
            <textarea
              className="mt-3 w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              rows={3}
              placeholder="Type your answer here..."
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            />
          )}

          <button
            onClick={handleSubmit}
            disabled={!selected || isSubmitting}
            className="mt-3 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSubmitting ? 'Processing...' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
