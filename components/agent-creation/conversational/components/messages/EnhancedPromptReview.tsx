import React from 'react';
import { Sparkles, CheckCircle, Edit } from 'lucide-react';
import { EnhancedPromptReviewProps } from '../../types';

export default function EnhancedPromptReview({
  plan,
  onAccept,
  onRevise
}: EnhancedPromptReviewProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-6 h-6 bg-purple-500 rounded-lg flex items-center justify-center">
          <Sparkles className="h-4 w-4 text-white" />
        </div>
        <h4 className="font-semibold text-gray-800">Your Agent Plan</h4>
      </div>

      <div className="bg-gradient-to-br from-purple-50 to-indigo-50 border border-purple-200 rounded-lg p-4 max-h-96 overflow-y-auto">
        <div className="prose prose-sm max-w-none text-gray-700">
          <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">
            {plan}
          </div>
        </div>
      </div>

      <p className="text-sm text-gray-600 mt-4">Does this look right?</p>

      <div className="grid grid-cols-2 gap-3 mt-4">
        <button
          onClick={onAccept}
          className="px-6 py-3 bg-gradient-to-r from-emerald-500 to-green-600 text-white rounded-lg hover:from-emerald-600 hover:to-green-700 font-semibold flex items-center justify-center gap-2 transition-all shadow-md hover:shadow-lg"
        >
          <CheckCircle className="h-5 w-5" />
          Yes, perfect!
        </button>

        <button
          onClick={onRevise}
          className="px-6 py-3 bg-white border-2 border-gray-300 text-gray-700 rounded-lg hover:border-gray-400 hover:bg-gray-50 font-semibold flex items-center justify-center gap-2 transition-all"
        >
          <Edit className="h-5 w-5" />
          Need changes
        </button>
      </div>
    </div>
  );
}
