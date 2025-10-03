import React from 'react';
import { ClarificationQuestion, ProjectState } from './types';
import { CheckCircle, ChevronRight, Edit, Send, Bot } from 'lucide-react';

interface QuestionRendererProps {
  question: ClarificationQuestion;
  state: ProjectState;
  onSelect: (questionId: string, value: string, label: string) => void;
  onCustomSubmit: () => void;
  onCustomChange: (questionId: string, value: string) => void; // FIXED: Added questionId parameter
  onChangeAnswer: (questionId: string) => void;
  isCurrent: boolean;
  isProcessing: boolean;
  readOnly?: boolean;
}

export default function QuestionRenderer({
  question,
  state,
  onSelect,
  onCustomSubmit,
  onCustomChange,
  onChangeAnswer,
  isCurrent,
  isProcessing,
  readOnly = false,
}: QuestionRendererProps) {
  const isAnswered = !!state.clarificationAnswers[question.id];
  const shouldShowOptions = state.questionsWithVisibleOptions.has(question.id);

  if (!shouldShowOptions) return null;

  return (
    <div className="flex gap-4 justify-start">
      <div
        className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm ${
          isAnswered ? 'bg-gradient-to-br from-green-500 to-emerald-600' : 'bg-gradient-to-br from-blue-500 to-indigo-600'
        }`}
      >
        {isAnswered ? <CheckCircle className="h-5 w-5 text-white" /> : <Bot className="h-5 w-5 text-white" />}
      </div>

      <div className="flex-1 max-w-2xl">
        <div
          className={`rounded-2xl shadow-sm border-2 transition-all duration-200 ${
            isAnswered ? 'bg-gradient-to-br from-green-50 to-emerald-50 border-green-200' : 'bg-white border-gray-200 hover:border-blue-200'
          }`}
        >
          {isAnswered ? (
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                </div>
                <span className="text-sm font-semibold text-green-800">Question Completed</span>
              </div>
              <p className="text-gray-700 mb-4 leading-relaxed">{question.question}</p>
              <div className="bg-white/60 backdrop-blur-sm px-4 py-3 rounded-xl border border-green-200 flex items-center justify-between">
                <p className="text-sm font-medium text-green-900">Your answer: {state.clarificationAnswers[question.id]}</p>
                {!readOnly && (
                  <button onClick={() => onChangeAnswer(question.id)} className="text-xs text-green-600 hover:text-green-800 underline ml-4">
                    Change
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Bot className="h-4 w-4 text-blue-600" />
                </div>
                <span className="text-sm font-semibold text-blue-800">
                  Question {state.questionsSequence.findIndex((q) => q.id === question.id) + 1} of {state.questionsSequence.length}
                </span>
              </div>
              <p className="text-gray-700 mb-4 leading-relaxed">{question.question}</p>
              <p className="text-sm text-gray-600 mb-4">Please select your answer:</p>

              {/* Options */}
              <div className="mt-4 space-y-2">
                {question.options.map((option, index) => {
                  const isSelected = state.clarificationAnswers[question.id] === option.label;
                  const disabled = isProcessing && isCurrent;
                  return (
                    <button
                      key={option.value}
                      onClick={() => onSelect(question.id, option.value, option.label)}
                      disabled={disabled || readOnly}
                      className={`w-full text-left p-4 border rounded-lg transition-all duration-200 group disabled:opacity-50 disabled:cursor-not-allowed ${
                        isSelected ? 'bg-green-50 border-green-300 hover:border-green-400' : 'bg-white border-gray-200 hover:border-blue-300 hover:bg-blue-50'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors ${
                            isSelected ? 'bg-green-500 text-white' : 'bg-blue-100 group-hover:bg-blue-200'
                          }`}
                        >
                          {isSelected ? (
                            <CheckCircle className="h-4 w-4" />
                          ) : (
                            <span className="text-blue-600 font-semibold text-sm">{index + 1}</span>
                          )}
                        </div>
                        <div className="flex-1">
                          <p className={`font-medium mb-1 ${isSelected ? 'text-green-900' : 'text-gray-900'}`}>{option.label}</p>
                          {option.description && (
                            <p className={`text-sm ${isSelected ? 'text-green-700' : 'text-gray-600'}`}>{option.description}</p>
                          )}
                        </div>
                        <ChevronRight className={`w-4 h-4 ${isSelected ? 'text-green-500' : 'text-gray-400 group-hover:text-blue-500'}`} />
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Custom answer */}
              {question.allowCustom && isCurrent && !readOnly && (
                <>
                  <button
                    onClick={() => {
                      // FIXED: Pass questionId to onCustomChange
                      console.log('Custom Answer button clicked for question:', question.id);
                      onCustomChange(question.id, ''); // Empty string triggers custom input mode
                    }}
                    disabled={isProcessing}
                    className="w-full text-left p-4 bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-all duration-200 group disabled:opacity-50 disabled:cursor-not-allowed mt-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center flex-shrink-0">
                        <Edit className="h-3 w-3 text-gray-500" />
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-gray-700">Custom Answer</p>
                        <p className="text-sm text-gray-500">Provide your own specific details</p>
                      </div>
                    </div>
                  </button>

                  {/* FIXED: Only show input for THIS specific question */}
                  {state.showingCustomInput && state.customInputQuestionId === question.id && (
                    <div className="mt-4 p-4 bg-gray-50 rounded-lg border-2 border-blue-200">
                      <p className="text-sm text-gray-700 mb-3">Please type your custom answer:</p>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={state.customInputValue}
                          onChange={(e) => {
                            console.log('Custom input onChange:', e.target.value, 'for question:', question.id);
                            onCustomChange(question.id, e.target.value);
                          }}
                          onKeyDown={(e) => e.key === 'Enter' && onCustomSubmit()}
                          placeholder="Type your answer..."
                          className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          autoFocus
                          disabled={isProcessing}
                        />
                        <button
                          onClick={onCustomSubmit}
                          disabled={!state.customInputValue.trim() || isProcessing}
                          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          <Send className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}