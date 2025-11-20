'use client';

import React from 'react';
import { Sparkles, TrendingUp, Clock, Database, MessageCircle, BarChart3 } from 'lucide-react';

interface PromptIdea {
  title: string;
  description: string;
  prompt: string;
  category: 'analytics' | 'automation' | 'communication' | 'data' | 'scheduling';
  estimatedTokens: number;
  complexity: 'simple' | 'moderate' | 'advanced';
}

interface PromptIdeaCardProps {
  idea: PromptIdea;
  index: number;
  onClick: () => void;
}

const PromptIdeaCard: React.FC<PromptIdeaCardProps> = ({ idea, index, onClick }) => {
  const getCategoryIcon = () => {
    switch (idea.category) {
      case 'analytics':
        return <BarChart3 className="w-5 h-5" />;
      case 'automation':
        return <Sparkles className="w-5 h-5" />;
      case 'communication':
        return <MessageCircle className="w-5 h-5" />;
      case 'data':
        return <Database className="w-5 h-5" />;
      case 'scheduling':
        return <Clock className="w-5 h-5" />;
      default:
        return <Sparkles className="w-5 h-5" />;
    }
  };

  const getCategoryColor = () => {
    switch (idea.category) {
      case 'analytics':
        return 'from-blue-500/20 to-cyan-500/20 border-blue-500/30 text-blue-400';
      case 'automation':
        return 'from-purple-500/20 to-pink-500/20 border-purple-500/30 text-purple-400';
      case 'communication':
        return 'from-green-500/20 to-emerald-500/20 border-green-500/30 text-green-400';
      case 'data':
        return 'from-orange-500/20 to-yellow-500/20 border-orange-500/30 text-orange-400';
      case 'scheduling':
        return 'from-indigo-500/20 to-violet-500/20 border-indigo-500/30 text-indigo-400';
      default:
        return 'from-gray-500/20 to-slate-500/20 border-gray-500/30 text-gray-400';
    }
  };

  const getComplexityBadge = () => {
    switch (idea.complexity) {
      case 'simple':
        return <span className="px-2 py-0.5 bg-green-500/20 border border-green-500/30 rounded-full text-xs text-green-400 font-medium">Simple</span>;
      case 'moderate':
        return <span className="px-2 py-0.5 bg-yellow-500/20 border border-yellow-500/30 rounded-full text-xs text-yellow-400 font-medium">Moderate</span>;
      case 'advanced':
        return <span className="px-2 py-0.5 bg-red-500/20 border border-red-500/30 rounded-full text-xs text-red-400 font-medium">Advanced</span>;
      default:
        return null;
    }
  };

  return (
    <div className="relative w-full text-left p-5 bg-white/5 border border-white/10 rounded-xl">
      {/* Card Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-start gap-3 flex-1">
          {/* Category Icon */}
          <div className={`flex-shrink-0 w-12 h-12 rounded-lg bg-gradient-to-br ${getCategoryColor()} flex items-center justify-center border shadow-lg`}>
            {getCategoryIcon()}
          </div>

          {/* Title and Category */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-base font-bold text-slate-100 line-clamp-1">
                {idea.title}
              </h3>
            </div>
            <p className="text-xs text-slate-400 capitalize">{idea.category}</p>
          </div>
        </div>
      </div>

      {/* Description */}
      <p className="text-sm text-slate-300 leading-relaxed mb-4 line-clamp-2">
        {idea.description}
      </p>

      {/* Metadata Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-white/10">
        <div className="flex items-center gap-3">
          {getComplexityBadge()}
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <TrendingUp className="w-3.5 h-3.5" />
            <span>~{(idea.estimatedTokens / 1000).toFixed(1)}k tokens</span>
          </div>
        </div>
      </div>

      {/* Number Badge */}
      <div className="absolute -top-2 -left-2 w-7 h-7 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-lg border-2 border-black">
        {index + 1}
      </div>
    </div>
  );
};

export default PromptIdeaCard;
