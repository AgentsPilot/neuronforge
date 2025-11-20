'use client';

import React from 'react';
import { Sparkles } from 'lucide-react';

interface GoalStepProps {
  data: string;
  onChange: (goal: string) => void;
}

const GoalStep: React.FC<GoalStepProps> = ({ data, onChange }) => {
  const [charCount, setCharCount] = React.useState(data.length);
  const MAX_CHARS = 300;
  const MIN_CHARS = 10;

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    if (value.length <= MAX_CHARS) {
      onChange(value);
      setCharCount(value.length);
    }
  };

  const examples = [
    "Get a summary of my last 10 emails every morning",
    "Track client follow-ups and remind me when to reach out",
    "Summarize my daily meetings and action items",
    "Monitor competitor mentions and send me weekly updates",
    "Create weekly sales reports from my CRM data",
    "Alert me when important customers reach out",
    "Organize meeting notes and share with my team",
    "Track project deadlines and send me reminders"
  ];

  const handleExampleClick = (example: string) => {
    onChange(example);
    setCharCount(example.length);
  };

  return (
    <div className="space-y-4">
      {/* Header - Compact */}
      <div className="text-center">
        <h3 className="text-lg font-semibold text-slate-100 mb-1">
          What do you want your AI to help you with first?
        </h3>
        <p className="text-xs text-slate-400">
          Describe your goal in 1-2 sentences
        </p>
      </div>

      {/* Goal Text Area - Compact */}
      <div className="space-y-2">
        <textarea
          value={data}
          onChange={handleChange}
          placeholder="Example: I want to get a summary of my last 10 emails every morning and highlights urgent messages..."
          className="w-full h-24 px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all resize-none text-sm leading-relaxed"
          autoFocus
        />
        <div className="flex items-center justify-between text-xs">
          <span className={`${
            charCount >= MIN_CHARS ? 'text-slate-500' : 'text-orange-400'
          }`}>
            {charCount < MIN_CHARS
              ? `Add ${MIN_CHARS - charCount} more characters`
              : `${charCount} / ${MAX_CHARS}`
            }
          </span>
        </div>
      </div>

      {/* Example Goals - Compact Grid */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-purple-300 flex items-center gap-1.5">
          <Sparkles className="w-3 h-3" />
          Quick examples:
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {examples.map((example, index) => (
            <button
              key={index}
              onClick={() => handleExampleClick(example)}
              className="group text-left px-3 py-2 bg-white/5 hover:bg-purple-500/10 border border-white/10 hover:border-purple-500/30 rounded-lg transition-all duration-200 hover:scale-[1.01] active:scale-[0.98]"
            >
              <p className="text-xs text-slate-300 group-hover:text-purple-200 transition-colors leading-snug">
                {example}
              </p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default GoalStep;
