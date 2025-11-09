import React from 'react';
import { Bot, Clock } from 'lucide-react';
import { AIMessageProps } from '../../types';
import { formatTime } from '../../utils/messageFormatter';
import TextMessage from './TextMessage';
import PluginConnectionCard from './PluginConnectionCard';
import QuestionCard from './QuestionCard';
import EnhancedPromptReview from './EnhancedPromptReview';
import SystemNotification from './SystemNotification';
import AnalysisInsightCard from './AnalysisInsightCard';

export default function AIMessage({
  message,
  onPluginConnect,
  onPluginSkip,
  onAnswerQuestion,
  onAcceptPrompt,
  onRevisePrompt
}: AIMessageProps) {
  const renderContent = () => {
    switch (message.messageType) {
      case 'plugin_warning':
      case 'plugin_connection':
        return (
          <PluginConnectionCard
            missingPlugins={message.data?.missingPlugins || message.missingPlugins || []}
            onConnect={onPluginConnect!}
            onSkip={onPluginSkip}
            connectingPlugin={message.data?.connectingPlugin}
          />
        );

      case 'clarification_question':
        return (
          <QuestionCard
            question={message.data?.question}
            questionNumber={message.data?.questionNumber || 1}
            totalQuestions={message.data?.totalQuestions || 1}
            onAnswer={onAnswerQuestion!}
            isProcessing={message.data?.isProcessing}
          />
        );

      case 'enhanced_prompt_review':
        return (
          <EnhancedPromptReview
            enhancedPrompt={message.data?.enhancedPrompt || {
              plan_title: '',
              plan_description: '',
              sections: {
                data: '',
                processing_steps: [],
                output: '',
                delivery: '',
                error_handling: ''
              },
              specifics: {
                services_involved: [],
                user_inputs_required: [],
                trigger_scope: ''
              }
            }}
            requiredServices={message.data?.requiredServices || []}
            connectedPlugins={message.data?.connectedPlugins || []}
            onAccept={onAcceptPrompt!}
            onRevise={onRevisePrompt!}
          />
        );

      case 'system_notification':
        return <SystemNotification content={message.content || ''} />;

      case 'analysis_insight':
        return (
          <AnalysisInsightCard
            insights={message.data?.insights || []}
            clarityScore={message.data?.clarityScore || 0}
          />
        );

      case 'transition':
        return (
          <div className="text-center py-6">
            <div className="inline-flex flex-col items-center gap-3 p-6 bg-gradient-to-br from-emerald-50 to-green-50 rounded-xl border border-emerald-200">
              <div className="text-2xl">🎉</div>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{message.content}</p>
            </div>
          </div>
        );

      case 'text':
      default:
        return <TextMessage content={message.content || ''} />;
    }
  };

  // System notification renders differently
  if (message.messageType === 'system_notification') {
    return (
      <div className="flex justify-center">
        {renderContent()}
      </div>
    );
  }

  // Transition message renders centered
  if (message.messageType === 'transition') {
    return renderContent();
  }

  // Regular AI message
  return (
    <div className="flex gap-3 justify-start">
      <div className="w-8 h-8 bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 rounded-lg flex items-center justify-center shadow-md flex-shrink-0">
        <Bot className="h-4 w-4 text-white" />
      </div>

      <div className="max-w-2xl flex-1">
        <div className="bg-white/80 backdrop-blur-sm border border-white/30 rounded-xl p-4 shadow-md">
          {renderContent()}
        </div>

        <div className="flex items-center gap-1 mt-1 ml-1 text-xs text-gray-500">
          <Clock className="h-3 w-3" />
          {formatTime(message.timestamp)}
        </div>
      </div>
    </div>
  );
}
