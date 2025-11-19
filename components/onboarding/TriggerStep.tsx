'use client';

import React from 'react';
import { Clock, Zap, Calendar, PlayCircle } from 'lucide-react';

interface TriggerStepProps {
  data: string | null; // 'on_demand' | 'scheduled' | 'monitor' | 'guided' | null
  onChange: (mode: string) => void;
}

const TriggerStep: React.FC<TriggerStepProps> = ({ data, onChange }) => {
  const modeOptions = [
    {
      value: 'on_demand',
      title: 'Help me only when I ask',
      description: "I'll start it manually when I need it",
      icon: <PlayCircle className="w-6 h-6" />
    },
    {
      value: 'scheduled',
      title: 'Do things automatically for me',
      description: 'Run tasks on a schedule without me asking',
      icon: <Calendar className="w-6 h-6" />
    },
    {
      value: 'monitor',
      title: 'Watch things and alert me',
      description: 'Monitor for changes and notify me when important',
      icon: <Zap className="w-6 h-6" />
    },
    {
      value: 'guided',
      title: 'Not sure yet',
      description: "I'll decide as I go",
      icon: <Clock className="w-6 h-6" />
    }
  ];

  return (
    <div className="space-y-4">
      {/* Header - Compact */}
      <div className="text-center">
        <h3 className="text-lg font-semibold text-slate-100 mb-1">
          How should your AI work?
        </h3>
        <p className="text-xs text-slate-400">
          Choose the approach that fits your needs best
        </p>
      </div>

      {/* Mode Selection Cards - Grid for larger screens */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {modeOptions.map((option) => (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            className={`group relative p-4 border rounded-xl text-left transition-all duration-200 hover:scale-[1.01] ${
              data === option.value
                ? 'bg-gradient-to-br from-purple-500/20 to-pink-500/20 border-purple-400/50 ring-2 ring-purple-400/30 shadow-xl shadow-purple-500/20'
                : 'bg-white/5 border-white/10 hover:bg-purple-500/5 hover:border-purple-500/20'
            }`}
          >
            <div className="flex items-start gap-3">
              {/* Icon */}
              <div className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center transition-all ${
                data === option.value
                  ? 'bg-gradient-to-br from-purple-500/40 to-pink-500/40 text-purple-200'
                  : 'bg-white/10 text-slate-400 group-hover:bg-purple-500/20 group-hover:text-purple-300'
              }`}>
                {option.icon}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <h4 className={`text-sm font-bold mb-1 transition-colors ${
                  data === option.value ? 'text-purple-100' : 'text-slate-100 group-hover:text-purple-200'
                }`}>
                  {option.title}
                </h4>
                <p className={`text-xs transition-colors ${
                  data === option.value ? 'text-slate-200' : 'text-slate-400 group-hover:text-slate-300'
                }`}>
                  {option.description}
                </p>
              </div>

              {/* Selection Indicator */}
              {data === option.value && (
                <div className="flex-shrink-0">
                  <div className="w-5 h-5 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center">
                    <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default TriggerStep;
