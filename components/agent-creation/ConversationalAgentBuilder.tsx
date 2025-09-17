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
  ArrowRight,
  Clock,
  Zap,
  Settings
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      {/* Modern Header with Glassmorphism */}
      <div className="sticky top-0 z-50 backdrop-blur-xl bg-white/80 border-b border-white/20 shadow-lg">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="w-12 h-12 bg-gradient-to-br from-blue-500 via-purple-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg">
                  <Bot className="h-7 w-7 text-white" />
                </div>
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-400 rounded-full border-2 border-white animate-pulse"></div>
              </div>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-gray-800 to-gray-600 bg-clip-text text-transparent">
                  AI Agent Builder
                </h1>
                <p className="text-sm text-gray-500 font-medium">Conversational Agent Creation</p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              {projectState.isReadyToBuild && (
                <div className="hidden md:flex items-center gap-2 px-4 py-2 bg-green-100 text-green-700 rounded-full text-sm font-medium">
                  <CheckCircle className="h-4 w-4" />
                  Ready to Build
                </div>
              )}
              {onReturnToSmartBuilder && projectState.allowNavigation && (
                <button 
                  onClick={onReturnToSmartBuilder} 
                  className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-2.5 rounded-xl hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 flex items-center gap-2 shadow-lg font-medium"
                >
                  <ArrowRight className="h-4 w-4" />
                  Continue to Builder
                </button>
              )}
              {onCancel && (
                <button 
                  onClick={onCancel} 
                  className="text-gray-500 hover:text-gray-700 transition-colors px-4 py-2 rounded-xl hover:bg-white/50"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 min-h-[calc(100vh-140px)]">
          {/* Main Chat Area - Enhanced */}
          <div className="lg:col-span-2 flex flex-col">
            <div className="bg-white/70 backdrop-blur-xl rounded-3xl shadow-xl border border-white/20 flex-1 flex flex-col overflow-hidden">
              
              {/* Enhanced Review Mode Banner */}
              {projectState.isInReviewMode && (
                <div className="m-6 p-6 bg-gradient-to-r from-blue-500/10 via-indigo-500/10 to-purple-500/10 border border-blue-200/50 rounded-2xl backdrop-blur-sm">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center">
                      <Eye className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <h4 className="text-lg font-semibold text-blue-900 mb-2">Review Mode</h4>
                      <p className="text-blue-800">
                        You're reviewing your completed conversation. Questions are read-only. 
                        {projectState.allowNavigation && ' You can navigate back to Smart Builder or create a new agent.'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Messages Area */}
              <div className="flex-1 overflow-y-auto p-6 space-y-8">
                {messages.map((message) => {
                  // System "question answered" chip
                  if (message.type === 'system' && message.content.startsWith('✅ Question')) {
                    return (
                      <div key={message.id} className="flex justify-center">
                        <div className="inline-flex items-center gap-3 bg-gradient-to-r from-emerald-500/20 to-green-500/20 text-emerald-700 px-6 py-3 rounded-2xl text-sm font-semibold border border-emerald-200/50 backdrop-blur-sm shadow-sm">
                          <div className="w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center">
                            <CheckCircle className="h-3 w-3 text-white" />
                          </div>
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
                          readOnly={projectState.isInReviewMode}
                        />
                      );
                    } catch (e) {
                      return (
                        <div key={message.id} className="flex gap-4 justify-start">
                          <div className="w-12 h-12 bg-gradient-to-br from-red-500 to-red-600 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-lg">
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
                        <div className="flex-shrink-0">
                          <div className="w-12 h-12 bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
                            <Bot className="h-6 w-6 text-white" />
                          </div>
                        </div>
                      )}

                      <div className={`max-w-2xl relative ${message.type === 'user' ? 'ml-16' : 'mr-16'}`}>
                        <div
                          className={`rounded-3xl px-6 py-4 shadow-lg backdrop-blur-sm relative border ${
                            message.type === 'user'
                              ? `bg-gradient-to-br from-blue-600 to-indigo-700 text-white border-blue-600 ${
                                  message.isQuestionAnswer ? 'ring-2 ring-green-300 ring-offset-2' : ''
                                }`
                              : message.content.includes('🚨 MISSING SERVICES:') ||
                                (message.content.includes('FYI:') &&
                                  (message.content.includes("service isn't connected") || message.content.includes("services aren't connected")))
                              ? 'bg-gradient-to-br from-yellow-50 to-orange-50 text-orange-900 border-2 border-orange-300 shadow-lg'
                              : 'bg-white/80 text-gray-800 border-white/30 hover:bg-white/90 transition-colors'
                          }`}
                        >
                          {message.isQuestionAnswer && (
                            <div className="absolute -top-2 -right-2 w-7 h-7 bg-gradient-to-br from-emerald-400 to-green-500 rounded-full flex items-center justify-center shadow-lg">
                              <CheckCircle className="h-4 w-4 text-white" />
                            </div>
                          )}

                          {(message.content.includes('🚨 MISSING SERVICES:') ||
                            (message.content.includes('FYI:') &&
                              (message.content.includes("service isn't connected") || message.content.includes("services aren't connected")))) && (
                            <div className="absolute -top-2 -right-2 w-7 h-7 bg-gradient-to-br from-orange-500 to-orange-600 rounded-full flex items-center justify-center shadow-lg animate-pulse">
                              <AlertCircle className="h-4 w-4 text-white" />
                            </div>
                          )}

                          <div
                            className={`whitespace-pre-wrap leading-relaxed ${
                              message.content.includes('🚨 MISSING SERVICES:') ||
                              (message.content.includes('FYI:') &&
                                (message.content.includes("service isn't connected") || message.content.includes("services aren't connected")))
                                ? 'font-medium'
                                : ''
                            }`}
                          >
                            {message.content}
                          </div>

                          <div className={`text-xs mt-3 flex items-center gap-2 ${message.type === 'user' ? 'text-blue-100' : 'text-gray-500'}`}>
                            <Clock className="h-3 w-3" />
                            {formatMessageTimestamp(message.timestamp)}
                          </div>

                          {/* Enhanced plan controls */}
                          {message.type === 'ai' &&
                            projectState.enhancementComplete &&
                            message.content.includes('Enhanced Plan:') &&
                            !projectState.planApproved &&
                            !projectState.isInReviewMode && (
                              <div className="mt-6 space-y-4">
                                {projectState.isEditingEnhanced ? (
                                  <div className="bg-gray-50/90 backdrop-blur-sm rounded-2xl p-5 space-y-4 border border-gray-200/50">
                                    <div className="flex items-center gap-2">
                                      <Edit className="h-4 w-4 text-gray-600" />
                                      <span className="text-sm font-medium text-gray-700">Edit your enhanced plan:</span>
                                    </div>
                                    <textarea
                                      value={projectState.editedEnhancedPrompt}
                                      onChange={(e) => setProjectState((prev) => ({ ...prev, editedEnhancedPrompt: e.target.value }))}
                                      className="w-full px-4 py-3 bg-white/90 text-gray-900 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-purple-500 focus:border-transparent min-h-[120px] resize-none text-sm leading-relaxed backdrop-blur-sm"
                                      placeholder="Edit your enhanced plan..."
                                      autoFocus
                                    />
                                    <div className="flex gap-3">
                                      <button
                                        onClick={handleSaveEnhancedEdit}
                                        disabled={!projectState.editedEnhancedPrompt.trim()}
                                        className="flex-1 bg-gradient-to-r from-purple-600 to-purple-700 text-white px-4 py-3 rounded-2xl hover:from-purple-700 hover:to-purple-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center gap-2 text-sm font-medium shadow-lg"
                                      >
                                        <Save className="h-4 w-4" />
                                        Save Changes
                                      </button>
                                      <button
                                        onClick={handleCancelEnhancedEdit}
                                        className="px-4 py-3 bg-gray-100/90 text-gray-700 rounded-2xl hover:bg-gray-200/90 transition-colors flex items-center justify-center border border-gray-200"
                                      >
                                        <X className="h-4 w-4" />
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="space-y-3">
                                    <button
                                      onClick={handleApproveEnhanced}
                                      className="w-full group bg-gradient-to-r from-emerald-500 to-green-600 text-white px-6 py-4 rounded-2xl hover:from-emerald-600 hover:to-green-700 transition-all duration-200 flex items-center justify-center gap-3 font-semibold shadow-lg transform hover:scale-[1.02]"
                                    >
                                      <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center">
                                        <CheckCircle className="h-5 w-5" />
                                      </div>
                                      Use Enhanced Plan
                                      <ChevronRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                                    </button>
                                    
                                    <div className="grid grid-cols-2 gap-3">
                                      <button
                                        onClick={handleEditEnhanced}
                                        className="bg-white/90 text-gray-700 px-4 py-3 rounded-2xl hover:bg-white transition-all duration-200 flex items-center justify-center gap-2 font-medium shadow-sm border border-gray-200"
                                      >
                                        <Edit className="h-4 w-4" />
                                        Edit Plan
                                      </button>
                                      <button
                                        onClick={handleUseOriginal}
                                        className="bg-gray-600/90 text-white px-4 py-3 rounded-2xl hover:bg-gray-700 transition-all duration-200 flex items-center justify-center gap-2 font-medium shadow-sm"
                                      >
                                        <MessageSquare className="h-4 w-4" />
                                        Use Original
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                        </div>
                      </div>

                      {message.type === 'user' && (
                        <div className="flex-shrink-0">
                          <div className="w-12 h-12 bg-gradient-to-br from-gray-400 to-gray-600 rounded-2xl flex items-center justify-center shadow-lg">
                            <User className="h-6 w-6 text-white" />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {isProcessing && (
                  <div className="flex gap-4 justify-start">
                    <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg">
                      <Bot className="h-6 w-6 text-white" />
                    </div>
                    <div className="bg-white/80 backdrop-blur-sm border border-white/30 rounded-3xl px-6 py-4 mr-16 shadow-lg">
                      <div className="flex items-center gap-4">
                        <div className="flex space-x-1">
                          <div className="w-3 h-3 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                          <div className="w-3 h-3 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                          <div className="w-3 h-3 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                        <span className="text-gray-700 font-medium">AI is thinking...</span>
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
          </div>

          {/* Enhanced Sidebar */}
          <div className="space-y-6">
            {/* Progress Card */}
            <div className="bg-white/70 backdrop-blur-xl rounded-3xl p-6 shadow-xl border border-white/20">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center">
                  <Brain className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-800">Understanding Progress</h3>
                  <p className="text-sm text-gray-500">AI comprehension level</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-gray-600 font-medium">Clarity Score</span>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
                      {projectState.clarityScore}%
                    </span>
                  </div>
                </div>

                <div className="w-full bg-gray-200/50 rounded-full h-3 overflow-hidden">
                  <div 
                    className="bg-gradient-to-r from-purple-500 via-pink-500 to-purple-600 h-full rounded-full transition-all duration-1000 ease-out shadow-sm"
                    style={{ width: `${projectState.clarityScore}%` }}
                  />
                </div>

                {projectState.questionsSequence.length > 0 && (
                  <div className="text-sm text-gray-600">
                    Question {Math.max(0, projectState.currentQuestionIndex + 1)} of {projectState.questionsSequence.length}
                    {projectState.isProcessingQuestion && <span className="ml-2 text-blue-600">(processing...)</span>}
                  </div>
                )}

                {projectState.isReadyToBuild && (
                  <div className="flex items-center gap-3 p-3 bg-green-50 rounded-2xl border border-green-200">
                    <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                      <CheckCircle className="h-3 w-3 text-white" />
                    </div>
                    <span className="text-green-700 font-medium">Ready to build!</span>
                  </div>
                )}
              </div>
            </div>

            {/* Requirements Card */}
            <div className="bg-white/70 backdrop-blur-xl rounded-3xl p-6 shadow-xl border border-white/20">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-xl flex items-center justify-center">
                    <CheckSquare className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800">Requirements</h3>
                    <p className="text-sm text-gray-500">
                      {projectState.requirements.filter((r) => r.status === 'clear').length} of {projectState.requirements.length} complete
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-blue-600">
                    {Math.round(
                      (projectState.requirements.filter((r) => r.status === 'clear').length / projectState.requirements.length) * 100
                    )}%
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                {projectState.requirements.map((req, index) => (
                  <div key={req.id} className="group relative">
                    <div
                      className={`rounded-2xl border-2 transition-all duration-300 ${
                        req.status === 'clear'
                          ? 'border-green-200 bg-green-50/80'
                          : req.status === 'partial'
                          ? 'border-yellow-200 bg-yellow-50/80'
                          : 'border-gray-200 bg-gray-50/50 group-hover:border-gray-300 group-hover:bg-gray-50/80'
                      }`}
                    >
                      <div className="flex items-center p-4">
                        <div
                          className={`flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all ${
                            req.status === 'clear'
                              ? 'bg-green-500'
                              : req.status === 'partial'
                              ? 'bg-yellow-500'
                              : 'bg-gray-300 group-hover:bg-gray-400'
                          }`}
                        >
                          {req.status === 'clear' && <CheckCircle className="h-4 w-4 text-white" />}
                          {req.status === 'partial' && <AlertCircle className="h-4 w-4 text-white" />}
                          {req.status === 'missing' && <div className="w-3 h-3 bg-white rounded-full" />}
                        </div>

                        <div className="ml-4 flex-1">
                          <div className="flex items-center justify-between mb-1">
                            <h4
                              className={`font-semibold ${
                                req.status === 'clear' ? 'text-green-800' : req.status === 'partial' ? 'text-yellow-800' : 'text-gray-700'
                              }`}
                            >
                              {req.label}
                            </h4>
                            <span
                              className={`px-2 py-1 rounded-full text-xs font-medium ${
                                req.status === 'clear'
                                  ? 'bg-green-100 text-green-700'
                                  : req.status === 'partial'
                                  ? 'bg-yellow-100 text-yellow-700'
                                  : 'bg-gray-100 text-gray-600'
                              }`}
                            >
                              {req.status === 'clear' ? 'Done' : req.status === 'partial' ? 'Partial' : 'Pending'}
                            </span>
                          </div>

                          {req.detected && (
                            <p className="text-xs text-gray-600 leading-relaxed">
                              {req.detected.length > 60 ? `${req.detected.slice(0, 60)}...` : req.detected}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 pt-4 border-t border-gray-100">
                <div className="flex items-center justify-between text-xs text-gray-600 mb-2">
                  <span>Overall Progress</span>
                  <span>
                    {Math.round(
                      (projectState.requirements.filter((r) => r.status === 'clear').length / projectState.requirements.length) * 100
                    )}
                    %
                  </span>
                </div>
                <div className="w-full bg-gray-200/50 rounded-full h-2">
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
              <div className="bg-white/70 backdrop-blur-xl rounded-3xl p-6 shadow-xl border border-red-200/50">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-gradient-to-br from-red-500 to-red-600 rounded-xl flex items-center justify-center">
                    <AlertCircle className="h-5 w-5 text-white" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-800">Missing Connections</h3>
                </div>

                <div className="space-y-4">
                  <p className="text-sm text-gray-700">Your automation requires these services:</p>

                  <div className="space-y-2">
                    {projectState.missingPlugins?.map((plugin) => (
                      <div key={plugin} className="flex items-center gap-3 p-3 bg-red-50/80 rounded-xl border border-red-200/50">
                        <div className="w-6 h-6 bg-red-500 rounded-lg flex items-center justify-center">
                          <AlertCircle className="h-3 w-3 text-white" />
                        </div>
                        <span className="text-sm font-medium text-red-800 capitalize">{plugin}</span>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2">
                    {projectState.suggestions?.map((suggestion, index) => (
                      <p key={index} className="text-xs text-gray-600 leading-relaxed">
                        • {suggestion}
                      </p>
                    ))}
                  </div>

                  <div className="grid gap-2">
                    <button
                      onClick={() => typeof window !== 'undefined' && window.open('/settings/integrations', '_blank')}
                      className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-4 py-3 rounded-2xl hover:from-blue-700 hover:to-indigo-700 transition-colors text-sm font-medium shadow-lg"
                    >
                      Connect Services
                    </button>

                    <button
                      onClick={clearPluginValidationError}
                      className="w-full bg-gray-600 text-white px-4 py-3 rounded-2xl hover:bg-gray-700 transition-colors text-sm font-medium"
                    >
                      Continue Anyway
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Original Request */}
            {projectState.originalPrompt && (
              <div className="bg-gradient-to-br from-emerald-50/50 to-green-50/50 backdrop-blur-xl rounded-3xl p-6 shadow-xl border border-emerald-200/30">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-green-500 rounded-xl flex items-center justify-center">
                    <MessageSquare className="h-4 w-4 text-white" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-800">Original Request</h3>
                </div>
                <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-4 border border-white/30">
                  <p className="text-gray-700 leading-relaxed">{projectState.originalPrompt}</p>
                </div>
              </div>
            )}

            {/* Enhanced Plan Preview */}
            {projectState.enhancedPrompt && (
              <div className="bg-gradient-to-br from-purple-50/50 to-indigo-50/50 backdrop-blur-xl rounded-3xl p-6 shadow-xl border border-purple-200/30">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-indigo-500 rounded-xl flex items-center justify-center">
                    <Sparkles className="h-4 w-4 text-white" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-800">Enhanced Plan</h3>
                </div>
                <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-4 border border-white/30">
                  <p className="text-gray-700 leading-relaxed whitespace-pre-wrap text-sm">{projectState.enhancedPrompt}</p>
                </div>
              </div>
            )}

            {/* Next Steps */}
            <div className="bg-white/70 backdrop-blur-xl rounded-3xl p-6 shadow-xl border border-white/20">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-red-500 rounded-xl flex items-center justify-center">
                  <Target className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-800">Next Steps</h3>
                  <p className="text-sm text-gray-500">What's coming up</p>
                </div>
              </div>

              <div className="space-y-3">
                {projectState.isInReviewMode ? (
                  <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-2xl border border-blue-200">
                    <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
                      <Eye className="h-3 w-3 text-white" />
                    </div>
                    <span className="text-blue-700 font-medium">Review your conversation and return to Smart Builder when ready</span>
                  </div>
                ) : (
                  <>
                    {!projectState.originalPrompt && (
                      <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-2xl border border-blue-200">
                        <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center animate-pulse">
                          <Settings className="h-3 w-3 text-white" />
                        </div>
                        <span className="text-blue-700 font-medium">Describe your automation need</span>
                      </div>
                    )}

                    {projectState.originalPrompt && projectState.currentQuestionIndex >= 0 && !projectState.conversationCompleted && (
                      <div className="flex items-center gap-3 p-4 bg-yellow-50 rounded-2xl border border-yellow-200">
                        <div className="w-6 h-6 bg-yellow-500 rounded-full flex items-center justify-center animate-pulse">
                          <MessageSquare className="h-3 w-3 text-white" />
                        </div>
                        <span className="text-yellow-700 font-medium">
                          Answer question {projectState.currentQuestionIndex + 1} of {projectState.questionsSequence.length}
                        </span>
                      </div>
                    )}

                    {projectState.originalPrompt && projectState.currentQuestionIndex < 0 && !projectState.conversationCompleted && !projectState.enhancementComplete && (
                      <div className="flex items-center gap-3 p-4 bg-yellow-50 rounded-2xl border border-yellow-200">
                        <div className="w-6 h-6 bg-yellow-500 rounded-full flex items-center justify-center animate-pulse">
                          <Settings className="h-3 w-3 text-white" />
                        </div>
                        <span className="text-yellow-700 font-medium">Analyzing your request...</span>
                      </div>
                    )}

                    {projectState.conversationCompleted && !projectState.enhancedPrompt && (
                      <div className="flex items-center gap-3 p-4 bg-purple-50 rounded-2xl border border-purple-200">
                        <div className="w-6 h-6 bg-purple-500 rounded-full flex items-center justify-center animate-pulse">
                          <Sparkles className="h-3 w-3 text-white" />
                        </div>
                        <span className="text-purple-700 font-medium">Creating enhanced plan...</span>
                      </div>
                    )}

                    {projectState.enhancedPrompt && !projectState.planApproved && !projectState.isEditingEnhanced && (
                      <div className="flex items-center gap-3 p-4 bg-purple-50 rounded-2xl border border-purple-200">
                        <div className="w-6 h-6 bg-purple-500 rounded-full flex items-center justify-center">
                          <Sparkles className="h-3 w-3 text-white" />
                        </div>
                        <span className="text-purple-700 font-medium">Review, edit, or approve your enhanced plan</span>
                      </div>
                    )}

                    {projectState.isEditingEnhanced && (
                      <div className="flex items-center gap-3 p-4 bg-purple-50 rounded-2xl border border-purple-200">
                        <div className="w-6 h-6 bg-purple-500 rounded-full flex items-center justify-center animate-pulse">
                          <Edit className="h-3 w-3 text-white" />
                        </div>
                        <span className="text-purple-700 font-medium">Editing your enhanced plan</span>
                      </div>
                    )}

                    {projectState.planApproved && projectState.isReadyToBuild && (
                      <div className="flex items-center gap-3 p-4 bg-green-50 rounded-2xl border border-green-200">
                        <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                          <Zap className="h-3 w-3 text-white" />
                        </div>
                        <span className="text-green-700 font-medium">Ready for smart build phase</span>
                      </div>
                    )}

                    {isProcessing && (
                      <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-2xl border border-blue-200">
                        <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center animate-pulse">
                          <Settings className="h-3 w-3 text-white" />
                        </div>
                        <span className="text-blue-700 font-medium">Processing...</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}