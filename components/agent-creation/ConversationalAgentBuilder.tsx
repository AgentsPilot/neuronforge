import React from 'react';
import {
  Bot,
  User,
  Sparkles,
  CheckCircle,
  AlertCircle,
  ChevronRight,
  Edit,
  Save,
  X,
  MessageSquare,
  Target,
  CheckSquare,
  Brain,
  Send,
  Eye,
  ArrowRight
} from 'lucide-react';
import QuestionRenderer from './QuestionRenderer';
import { useConversationalBuilder } from './useConversationalBuilder';
import { ClarificationQuestion, ConversationalAgentBuilderProps } from './types';

// Enhanced props interface with navigation support
interface EnhancedConversationalAgentBuilderProps extends ConversationalAgentBuilderProps {
  onReturnToSmartBuilder?: () => void;
}

// Helper function to safely format timestamps
const formatMessageTimestamp = (timestamp: any) => {
  try {
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    if (isNaN(date.getTime())) {
      return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (error) {
    console.warn('Error formatting timestamp:', error);
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
};

export default function ConversationalAgentBuilder(props: EnhancedConversationalAgentBuilderProps) {
  const {
    initialPrompt,
    onPromptApproved,
    onCancel,
    restoredState,
    onStateChange,
    onReturnToSmartBuilder,
  } = props;

  const {
    user,
    projectState,
    messages,
    inputValue,
    isProcessing,
    setInputValue,
    setProjectState,
    addMessage,
    clearPluginValidationError,

    handleSendMessage,
    handleOptionSelect,
    handleCustomAnswer,
    handleChangeAnswer,

    handleApproveEnhanced,
    handleUseOriginal,
    handleEditEnhanced,
    handleSaveEnhancedEdit,
    handleCancelEnhancedEdit,

    messagesEndRef,
  } = useConversationalBuilder({
    initialPrompt,
    restoredState,
    onStateChange,
    onPromptApproved,
    onCancel,
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'clear':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'partial':
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      default:
        return <div className="h-4 w-4 border-2 border-gray-300 rounded-full" />;
    }
  };

  return (
    <div className="h-screen flex bg-gray-100">
      {/* Left: Chat */}
      <div className="flex-1 flex flex-col bg-white border-r border-gray-200">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                <Bot className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-gray-900">AI Agent Builder</h1>
                <p className="text-sm text-gray-500">Conversational Agent Creation</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {onReturnToSmartBuilder && projectState.allowNavigation && (
                <button 
                  onClick={onReturnToSmartBuilder} 
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
                >
                  <ArrowRight className="h-4 w-4" />
                  Back to Smart Builder
                </button>
              )}
              {onCancel && (
                <button onClick={onCancel} className="text-gray-500 hover:text-gray-700 transition-colors px-3 py-1 rounded">
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Enhanced Review Mode Indicator */}
        {projectState.isInReviewMode && (
          <div className="mx-6 mt-4 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg">
            <div className="flex items-start gap-3">
              <Eye className="h-5 w-5 text-blue-600 mt-0.5" />
              <div>
                <h4 className="text-sm font-semibold text-blue-900 mb-1">Review Mode</h4>
                <p className="text-sm text-blue-800">
                  You're reviewing your completed conversation. Questions are read-only. 
                  {projectState.allowNavigation && 'You can navigate back to Smart Builder or create a new agent.'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {messages.map((message) => {
            // System "question answered" chip
            if (message.type === 'system' && message.content.startsWith('✅ Question')) {
              return (
                <div key={message.id} className="flex justify-center">
                  <div className="inline-flex items-center gap-2 bg-gradient-to-r from-green-50 to-emerald-50 text-green-800 px-4 py-2 rounded-full text-sm font-medium border border-green-200 shadow-sm">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    Question Completed
                  </div>
                </div>
              );
            }

            // System question payload -> render interactive block (WITH READ-ONLY SUPPORT)
            if (message.type === 'system' && message.content.startsWith('{')) {
              try {
                const question = JSON.parse(message.content) as ClarificationQuestion;
                return (
                  <QuestionRenderer
                    key={message.id}
                    question={question}
                    state={projectState}
                    isCurrent={projectState.questionsSequence[projectState.currentQuestionIndex]?.id === question.id}
                    isProcessing={projectState.isProcessingQuestion}
                    onSelect={handleOptionSelect}
                    onCustomSubmit={handleCustomAnswer}
                    onCustomChange={(val) => setProjectState((prev) => ({ ...prev, customInputValue: val, showingCustomInput: true }))}
                    onChangeAnswer={handleChangeAnswer}
                    // CRITICAL: Make questions read-only in review mode
                    readOnly={projectState.isInReviewMode}
                  />
                );
              } catch (e) {
                return (
                  <div key={message.id} className="flex gap-4 justify-start">
                    <div className="w-10 h-10 bg-gradient-to-br from-red-500 to-red-600 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm">
                      <AlertCircle className="h-5 w-5 text-white" />
                    </div>
                    <div className="flex-1 max-w-2xl">
                      <div className="bg-gradient-to-br from-red-50 to-red-50 border-2 border-red-200 rounded-2xl p-6 shadow-sm">
                        <p className="text-red-800 font-medium">Error loading question. Please try again.</p>
                      </div>
                    </div>
                  </div>
                );
              }
            }

            // Regular AI/User message bubble
            return (
              <div key={message.id} className={`flex gap-4 ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                {message.type === 'ai' && (
                  <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm">
                    <Bot className="h-5 w-5 text-white" />
                  </div>
                )}

                <div className={`max-w-2xl relative ${message.type === 'user' ? 'ml-12' : 'mr-12'}`}>
                  <div
                    className={`rounded-2xl px-6 py-4 shadow-sm border relative ${
                      message.type === 'user'
                        ? `bg-gradient-to-br from-blue-600 to-indigo-700 text-white border-blue-600 ${
                            message.isQuestionAnswer ? 'ring-2 ring-green-300 ring-offset-2' : ''
                          }`
                        : message.content.includes('🚨 MISSING SERVICES:') ||
                          (message.content.includes('FYI:') &&
                            (message.content.includes("service isn't connected") || message.content.includes("services aren't connected")))
                        ? 'bg-gradient-to-br from-yellow-50 to-orange-50 text-orange-900 border-2 border-orange-300 shadow-lg'
                        : 'bg-white text-gray-800 border-gray-200 hover:border-gray-300 transition-colors'
                    }`}
                  >
                    {message.isQuestionAnswer && (
                      <div className="absolute -top-2 -right-2 w-6 h-6 bg-gradient-to-br from-green-500 to-emerald-600 rounded-full flex items-center justify-center shadow-sm">
                        <CheckCircle className="h-3 w-3 text-white" />
                      </div>
                    )}

                    {(message.content.includes('🚨 MISSING SERVICES:') ||
                      (message.content.includes('FYI:') &&
                        (message.content.includes("service isn't connected") || message.content.includes("services aren't connected")))) && (
                      <div className="absolute -top-2 -right-2 w-6 h-6 bg-gradient-to-br from-orange-500 to-orange-600 rounded-full flex items-center justify-center shadow-sm animate-pulse">
                        <AlertCircle className="h-3 w-3 text-white" />
                      </div>
                    )}

                    <div
                      className={`whitespace-pre-wrap leading-relaxed text-sm ${
                        message.content.includes('🚨 MISSING SERVICES:') ||
                        (message.content.includes('FYI:') &&
                          (message.content.includes("service isn't connected") || message.content.includes("services aren't connected")))
                          ? 'font-medium'
                          : ''
                      }`}
                    >
                      {message.content}
                    </div>

                    <div className={`text-xs mt-2 opacity-70 ${message.type === 'user' ? 'text-blue-100' : 'text-gray-500'}`}>
                      {formatMessageTimestamp(message.timestamp)}
                    </div>

                    {/* Enhanced plan controls */}
                    {message.type === 'ai' &&
                      projectState.enhancementComplete &&
                      message.content.includes('Enhanced Plan:') &&
                      !projectState.planApproved &&
                      !projectState.isInReviewMode && (
                        <div className="mt-6 space-y-3">
                          {projectState.isEditingEnhanced ? (
                            <div className="bg-gray-50 rounded-xl p-4 space-y-4 border border-gray-200">
                              <div className="flex items-center gap-2">
                                <Edit className="h-4 w-4 text-gray-600" />
                                <span className="text-sm font-medium text-gray-700">Edit your enhanced plan:</span>
                              </div>
                              <textarea
                                value={projectState.editedEnhancedPrompt}
                                onChange={(e) => setProjectState((prev) => ({ ...prev, editedEnhancedPrompt: e.target.value }))}
                                className="w-full px-4 py-3 bg-white text-gray-900 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent min-h-[120px] resize-none text-sm leading-relaxed"
                                placeholder="Edit your enhanced plan..."
                                autoFocus
                              />
                              <div className="flex gap-3">
                                <button
                                  onClick={handleSaveEnhancedEdit}
                                  disabled={!projectState.editedEnhancedPrompt.trim()}
                                  className="flex-1 bg-gradient-to-r from-purple-600 to-purple-700 text-white px-4 py-3 rounded-xl hover:from-purple-700 hover:to-purple-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center gap-2 text-sm font-medium shadow-sm"
                                >
                                  <Save className="h-4 w-4" />
                                  Save Changes
                                </button>
                                <button
                                  onClick={handleCancelEnhancedEdit}
                                  className="px-4 py-3 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-colors flex items-center justify-center border border-gray-200"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              <button
                                onClick={handleApproveEnhanced}
                                className="w-full bg-gradient-to-r from-green-600 to-emerald-700 text-white px-4 py-3 rounded-xl hover:from-green-700 hover:to-emerald-800 transition-all duration-200 flex items-center justify-center gap-2 font-medium shadow-sm"
                              >
                                <CheckCircle className="h-4 w-4" />
                                Use Enhanced Plan
                              </button>
                              <button
                                onClick={handleEditEnhanced}
                                className="w-full bg-gradient-to-r from-purple-600 to-purple-700 text-white px-4 py-3 rounded-xl hover:from-purple-700 hover:to-purple-800 transition-all duration-200 flex items-center justify-center gap-2 font-medium shadow-sm"
                              >
                                <Edit className="h-4 w-4" />
                                Edit Enhanced Plan
                              </button>
                              <button
                                onClick={handleUseOriginal}
                                className="w-full bg-gradient-to-r from-gray-600 to-gray-700 text-white px-4 py-3 rounded-xl hover:from-gray-700 hover:to-gray-800 transition-all duration-200 flex items-center justify-center gap-2 font-medium shadow-sm"
                              >
                                <MessageSquare className="h-4 w-4" />
                                Use Original Request
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                  </div>
                </div>

                {message.type === 'user' && (
                  <div className="w-10 h-10 bg-gradient-to-br from-gray-400 to-gray-500 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm">
                    <User className="h-5 w-5 text-white" />
                  </div>
                )}
              </div>
            );
          })}

          {isProcessing && (
            <div className="flex gap-4 justify-start">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm">
                <Bot className="h-5 w-5 text-white" />
              </div>
              <div className="bg-white border border-gray-200 rounded-2xl px-6 py-4 mr-12 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="flex space-x-1">
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="text-sm text-gray-600 font-medium">AI is thinking...</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input (kept hidden like original) */}
        {false && (
          <div className="border-t border-gray-200 p-4">
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                  placeholder="Describe what you want your agent to do..."
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent pr-12"
                  disabled={isProcessing || projectState.currentQuestionIndex >= 0}
                />
              </div>
              <button
                onClick={handleSendMessage}
                disabled={!inputValue.trim() || isProcessing || projectState.currentQuestionIndex >= 0}
                className="bg-blue-600 text-white p-3 rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Send className="h-5 w-5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Right: Action/Status panel */}
      <div className="w-96 bg-gray-50 border-l border-gray-200 p-6 space-y-6">
        {/* Understanding Progress */}
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <div className="flex items-center gap-3 mb-4">
            <Brain className="h-5 w-5 text-purple-600" />
            <h3 className="font-semibold text-gray-900">Understanding Progress</h3>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Clarity Score</span>
              <span className="text-sm font-medium text-gray-900">{projectState.clarityScore}%</span>
            </div>

            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="bg-gradient-to-r from-blue-500 to-purple-500 h-2 rounded-full transition-all duration-500" style={{ width: `${projectState.clarityScore}%` }} />
            </div>

            {projectState.questionsSequence.length > 0 && (
              <div className="text-sm text-gray-600">
                Question {Math.max(0, projectState.currentQuestionIndex + 1)} of {projectState.questionsSequence.length}
                {projectState.isProcessingQuestion && <span className="ml-2 text-blue-600">(processing...)</span>}
              </div>
            )}

            {projectState.isReadyToBuild && (
              <div className="flex items-center gap-2 text-green-600 text-sm font-medium">
                <CheckCircle className="h-4 w-4" />
                Ready to build!
              </div>
            )}
          </div>
        </div>

        {/* Requirements */}
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
              <CheckSquare className="h-4 w-4 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Requirements</h3>
              <p className="text-xs text-gray-500">
                {projectState.requirements.filter((r) => r.status === 'clear').length} of {projectState.requirements.length} complete
              </p>
            </div>
          </div>

          <div className="space-y-2">
            {projectState.requirements.map((req, index) => (
              <div key={req.id} className="group">
                <div
                  className={`relative rounded-lg border-2 transition-all duration-200 ${
                    req.status === 'clear'
                      ? 'border-green-200 bg-green-50'
                      : req.status === 'partial'
                      ? 'border-yellow-200 bg-yellow-50'
                      : 'border-gray-200 bg-gray-50 group-hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center p-3">
                    <div
                      className={`flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                        req.status === 'clear'
                          ? 'bg-green-500 border-green-500'
                          : req.status === 'partial'
                          ? 'bg-yellow-500 border-yellow-500'
                          : 'bg-white border-gray-300 group-hover:border-gray-400'
                      }`}
                    >
                      {req.status === 'clear' && <CheckCircle className="h-3 w-3 text-white" />}
                      {req.status === 'partial' && <AlertCircle className="h-3 w-3 text-white" />}
                      {req.status === 'missing' && <div className="w-2 h-2 bg-gray-300 rounded-full group-hover:bg-gray-400 transition-colors" />}
                    </div>

                    <div className="ml-3 flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <h4
                          className={`text-sm font-medium truncate ${
                            req.status === 'clear' ? 'text-green-900' : req.status === 'partial' ? 'text-yellow-900' : 'text-gray-700'
                          }`}
                        >
                          {req.label}
                        </h4>
                        <div
                          className={`ml-2 px-2 py-0.5 rounded-full text-xs font-medium ${
                            req.status === 'clear'
                              ? 'bg-green-100 text-green-700'
                              : req.status === 'partial'
                              ? 'bg-yellow-100 text-yellow-700'
                              : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {req.status === 'clear' ? 'Done' : req.status === 'partial' ? 'Partial' : 'Pending'}
                        </div>
                      </div>

                      {req.detected && (
                        <p
                          className={`text-xs mt-1 ${req.status === 'clear' ? 'text-green-600' : req.status === 'partial' ? 'text-yellow-600' : 'text-gray-500'}`}
                        >
                          {req.detected.length > 60 ? `${req.detected.slice(0, 60)}...` : req.detected}
                        </p>
                      )}
                    </div>
                  </div>

                  {index < projectState.requirements.length - 1 && <div className="absolute left-6 -bottom-2 w-0.5 h-4 bg-gray-200" />}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 pt-3 border-t border-gray-100">
            <div className="flex items-center justify-between text-xs text-gray-600 mb-2">
              <span>Overall Progress</span>
              <span>
                {Math.round(
                  (projectState.requirements.filter((r) => r.status === 'clear').length / projectState.requirements.length) * 100
                )}
                %
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-gradient-to-r from-blue-500 to-green-500 h-2 rounded-full transition-all duration-500"
                style={{
                  width: `${
                    (projectState.requirements.filter((r) => r.status === 'clear').length / projectState.requirements.length) * 100
                  }%`,
                }}
              />
            </div>
          </div>
        </div>

        {/* Plugin validation error */}
        {projectState.pluginValidationError && (
          <div className="bg-white rounded-xl p-4 border border-red-200">
            <div className="flex items-center gap-3 mb-4">
              <AlertCircle className="h-5 w-5 text-red-600" />
              <h3 className="font-semibold text-gray-900">Missing Connections</h3>
            </div>

            <div className="space-y-3">
              <p className="text-sm text-gray-700">Your automation requires these services:</p>

              <div className="space-y-2">
                {projectState.missingPlugins?.map((plugin) => (
                  <div key={plugin} className="flex items-center gap-2 p-2 bg-red-50 rounded-lg">
                    <AlertCircle className="h-4 w-4 text-red-500" />
                    <span className="text-sm font-medium text-red-800 capitalize">{plugin}</span>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                {projectState.suggestions?.map((suggestion, index) => (
                  <p key={index} className="text-xs text-gray-600">
                    • {suggestion}
                  </p>
                ))}
              </div>

              <div className="space-y-2">
                <button
                  onClick={() => typeof window !== 'undefined' && window.open('/settings/integrations', '_blank')}
                  className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm"
                >
                  Connect Services
                </button>

                <button
                  onClick={clearPluginValidationError}
                  className="w-full bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors text-sm"
                >
                  Continue Anyway
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Original Request */}
        {projectState.originalPrompt && (
          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="flex items-center gap-3 mb-4">
              <MessageSquare className="h-5 w-5 text-green-600" />
              <h3 className="font-semibold text-gray-900">Original Request</h3>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-sm text-gray-700">{projectState.originalPrompt}</p>
            </div>
          </div>
        )}

        {/* Enhanced Plan Preview */}
        {projectState.enhancedPrompt && (
          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="flex items-center gap-3 mb-4">
              <Sparkles className="h-5 w-5 text-purple-600" />
              <h3 className="font-semibold text-gray-900">Enhanced Plan</h3>
            </div>
            <div className="bg-purple-50 rounded-lg p-3">
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{projectState.enhancedPrompt}</p>
            </div>
          </div>
        )}

        {/* Next Steps */}
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <div className="flex items-center gap-3 mb-4">
            <Target className="h-5 w-5 text-orange-600" />
            <h3 className="font-semibold text-gray-900">Next Steps</h3>
          </div>

          <div className="space-y-2 text-sm text-gray-600">
            {projectState.isInReviewMode ? (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-blue-500 rounded-full" />
                <span>Review your conversation and return to Smart Builder when ready</span>
              </div>
            ) : (
              <>
                {!projectState.originalPrompt && (
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                    <span>Describe your automation need</span>
                  </div>
                )}

                {projectState.originalPrompt && projectState.currentQuestionIndex >= 0 && !projectState.conversationCompleted && (
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />
                    <span>
                      Answer question {projectState.currentQuestionIndex + 1} of {projectState.questionsSequence.length}
                    </span>
                  </div>
                )}

                {projectState.originalPrompt && projectState.currentQuestionIndex < 0 && !projectState.conversationCompleted && !projectState.enhancementComplete && (
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />
                    <span>Analyzing your request...</span>
                  </div>
                )}

                {projectState.conversationCompleted && !projectState.enhancedPrompt && (
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse" />
                    <span>Creating enhanced plan...</span>
                  </div>
                )}

                {projectState.enhancedPrompt && !projectState.planApproved && !projectState.isEditingEnhanced && (
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-purple-500 rounded-full" />
                    <span>Review, edit, or approve your enhanced plan</span>
                  </div>
                )}

                {projectState.isEditingEnhanced && (
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse" />
                    <span>Editing your enhanced plan</span>
                  </div>
                )}

                {projectState.planApproved && projectState.isReadyToBuild && (
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-green-500 rounded-full" />
                    <span>Ready for smart build phase</span>
                  </div>
                )}

                {isProcessing && (
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                    <span>Processing...</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}