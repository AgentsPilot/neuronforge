import React from 'react';
import { Target } from 'lucide-react';
import { ConfidenceBarProps } from '../types';
import { getConfidenceGradient } from '../utils/confidenceCalculator';

export default function ConfidenceBar({ score }: ConfidenceBarProps) {
  return (
    <div className="fixed bottom-20 left-0 right-0 z-30 bg-white/90 backdrop-blur-xl border-t border-white/20 shadow-lg">
      <div className="max-w-4xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-purple-600" />
            <span className="text-sm font-semibold text-gray-700">
              Understanding Your Request
            </span>
          </div>
          <span className="text-sm font-bold text-purple-600">{score}%</span>
        </div>

        <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
          <div
            className={`bg-gradient-to-r ${getConfidenceGradient(score)} h-full rounded-full transition-all duration-500 ease-out`}
            style={{ width: `${score}%` }}
          />
        </div>
      </div>
    </div>
  );
}
