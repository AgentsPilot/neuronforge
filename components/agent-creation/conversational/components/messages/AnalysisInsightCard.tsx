import React from 'react';
import { CheckCircle2, AlertCircle, Info } from 'lucide-react';

interface AnalysisInsight {
  label: string;
  value: string;
  status: 'detected' | 'partial' | 'missing';
}

interface AnalysisInsightCardProps {
  insights: AnalysisInsight[];
  clarityScore: number;
}

export default function AnalysisInsightCard({ insights, clarityScore }: AnalysisInsightCardProps) {
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'detected':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'partial':
        return <Info className="h-4 w-4 text-yellow-500" />;
      case 'missing':
        return <AlertCircle className="h-4 w-4 text-orange-500" />;
      default:
        return null;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'detected':
        return 'text-green-700';
      case 'partial':
        return 'text-yellow-700';
      case 'missing':
        return 'text-orange-700';
      default:
        return 'text-gray-700';
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-6 h-6 bg-blue-500 rounded-lg flex items-center justify-center">
          <span className="text-white text-xs font-bold">✓</span>
        </div>
        <h4 className="font-semibold text-gray-800 text-sm">Here's what I found:</h4>
      </div>

      {/* Analysis Breakdown */}
      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-4 space-y-3">
        {insights.map((insight, index) => (
          <div key={index} className="flex items-start gap-3">
            {getStatusIcon(insight.status)}
            <div className="flex-1">
              <span className="text-xs font-medium text-gray-600">{insight.label}:</span>
              <p className={`text-sm font-medium ${getStatusColor(insight.status)}`}>
                {insight.value}
              </p>
            </div>
          </div>
        ))}

        {/* Clarity Score */}
        <div className="mt-4 pt-3 border-t border-blue-200">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-gray-600">Clarity</span>
            <span className="text-xs font-bold text-purple-600">{clarityScore}%</span>
          </div>
          <div className="w-full bg-white/50 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-gradient-to-r from-purple-500 to-pink-500 h-full rounded-full transition-all duration-500"
              style={{ width: `${clarityScore}%` }}
            />
          </div>
        </div>
      </div>

      {clarityScore < 70 && (
        <p className="text-xs text-gray-600 mt-2">
          💡 I'll ask a few questions to get to 100% clarity
        </p>
      )}
    </div>
  );
}
