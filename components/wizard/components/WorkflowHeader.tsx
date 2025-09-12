import React, { useState } from 'react';
import { 
  Brain, 
  Sparkles, 
  CheckCircle, 
  ChevronDown, 
  ChevronUp,
  FileText,
  Zap,
  Target,
  Activity
} from 'lucide-react';
import type { GeneratedPlan } from '../workflowAnalysis';

interface WorkflowHeaderProps {
  generatedPlan: GeneratedPlan;
  showAnalysisDetails: boolean;
  onToggleAnalysisDetails: () => void;
  userPrompt: string;
  isEditing?: boolean;
}

export function WorkflowHeader({ 
  generatedPlan, 
  showAnalysisDetails, 
  onToggleAnalysisDetails,
  userPrompt,
  isEditing = false
}: WorkflowHeaderProps) {
  
  // Only show details when user explicitly toggles (not auto in edit mode)
  const shouldShowDetails = showAnalysisDetails;
  
  // Structure the user prompt into meaningful sections
  const structurePrompt = (prompt: string) => {
    if (!prompt || prompt.trim() === '') {
      return { type: 'simple', content: 'No prompt provided.' };
    }
    
    const sentences = prompt.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    if (sentences.length <= 2) {
      return { type: 'simple', content: prompt };
    }
    
    // Try to identify different parts of the prompt
    const structured = {
      objective: '',
      context: '',
      requirements: '',
      remaining: [] // Changed to array for proper structuring
    };
    
    // Keywords that might indicate different sections
    const objectiveKeywords = ['want', 'need', 'create', 'build', 'make', 'develop', 'generate', 'design'];
    const contextKeywords = ['currently', 'existing', 'have', 'working with', 'using', 'background', 'situation'];
    const requirementKeywords = ['must', 'should', 'require', 'need to', 'important', 'ensure', 'criteria', 'specifications'];
    
    sentences.forEach((sentence, index) => {
      const lowerSentence = sentence.toLowerCase();
      const trimmedSentence = sentence.trim();
      
      if (index === 0 || objectiveKeywords.some(keyword => lowerSentence.includes(keyword))) {
        if (!structured.objective) {
          structured.objective = trimmedSentence;
        } else {
          structured.remaining.push(trimmedSentence);
        }
      } else if (contextKeywords.some(keyword => lowerSentence.includes(keyword))) {
        structured.context += trimmedSentence + '. ';
      } else if (requirementKeywords.some(keyword => lowerSentence.includes(keyword))) {
        structured.requirements += trimmedSentence + '. ';
      } else {
        structured.remaining.push(trimmedSentence);
      }
    });
    
    // Clean up context and requirements
    structured.context = structured.context.replace(/\.\s*\.$/, '.').trim();
    structured.requirements = structured.requirements.replace(/\.\s*\.$/, '.').trim();
    
    return { type: 'structured', sections: structured };
  };
  
  // Format reasoning text into paragraphs
  const formatReasoning = (reasoning: string) => {
    if (!reasoning || reasoning.trim() === '') {
      return 'No AI reasoning provided.';
    }
    
    const sentences = reasoning.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const paragraphs = [];
    
    for (let i = 0; i < sentences.length; i += 2) {
      const paragraph = sentences.slice(i, i + 2).join('. ').trim();
      if (paragraph) {
        paragraphs.push(paragraph + (paragraph.endsWith('.') ? '' : '.'));
      }
    }
    
    return paragraphs;
  };
  
  // Structure additional details into logical groups
  const structureAdditionalDetails = (details: string[]) => {
    if (!details || details.length === 0) return [];
    
    const groups = [];
    let currentGroup = [];
    
    details.forEach((detail, index) => {
      const trimmed = detail.trim();
      if (!trimmed) return;
      
      // Check if this detail seems to start a new topic/concept
      const startsNewTopic = trimmed.match(/^(also|additionally|furthermore|moreover|in addition|another|next|finally)/i) ||
                            (index > 0 && trimmed.length > 50 && !trimmed.toLowerCase().includes('and')) ||
                            (currentGroup.length >= 2);
      
      if (startsNewTopic && currentGroup.length > 0) {
        groups.push(currentGroup);
        currentGroup = [trimmed];
      } else {
        currentGroup.push(trimmed);
      }
    });
    
    // Add the last group
    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }
    
    return groups;
  };

  const promptStructure = structurePrompt(userPrompt);
  const reasoningParagraphs = formatReasoning(generatedPlan.reasoning || '');
  const structuredDetails = promptStructure.type === 'structured' && Array.isArray(promptStructure.sections.remaining) 
    ? structureAdditionalDetails(promptStructure.sections.remaining) 
    : [];
  const isLongReasoning = Array.isArray(reasoningParagraphs) && reasoningParagraphs.length > 2;
  const isLongPrompt = userPrompt && userPrompt.length > 300;
  
  // State for expandable content
  const [isReasoningExpanded, setIsReasoningExpanded] = useState(!isLongReasoning);
  const [isPromptExpanded, setIsPromptExpanded] = useState(!isLongPrompt);
  
  return (
    <>
      {/* Clean Header Section */}
      <div className="text-center py-8 px-6">
        {/* Modern Icon */}
        <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
          <Sparkles className="h-8 w-8 text-white" />
        </div>
        
        <h1 className="text-3xl font-bold text-gray-900 mb-3">
          AI-Generated Workflow
        </h1>
        <p className="text-gray-600 text-lg mb-6 max-w-2xl mx-auto leading-relaxed">
          ChatGPT analyzed your requirements and designed {generatedPlan.steps.length} intelligent workflow steps
        </p>
        
        {/* Modern Stats Cards */}
        <div className="flex items-center justify-center gap-4 flex-wrap">
          <div className="bg-white border border-gray-200 px-6 py-3 rounded-2xl shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
                <CheckCircle className="h-4 w-4 text-emerald-600" />
              </div>
              <div className="text-left">
                <div className="text-gray-900 font-semibold">{generatedPlan.confidence}%</div>
                <div className="text-gray-500 text-sm">Confidence</div>
              </div>
            </div>
          </div>
          
          <div className="bg-white border border-gray-200 px-6 py-3 rounded-2xl shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                <Activity className="h-4 w-4 text-blue-600" />
              </div>
              <div className="text-left">
                <div className="text-gray-900 font-semibold">{generatedPlan.steps.length}</div>
                <div className="text-gray-500 text-sm">Steps</div>
              </div>
            </div>
          </div>
          
          <div className="bg-white border border-gray-200 px-6 py-3 rounded-2xl shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
                <Zap className="h-4 w-4 text-purple-600" />
              </div>
              <div className="text-left">
                <div className="text-gray-900 font-semibold">{generatedPlan.detectedCategories?.length || 0}</div>
                <div className="text-gray-500 text-sm">Categories</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modern Analysis Card */}
      <div className="bg-white border border-gray-100 rounded-3xl shadow-xl overflow-hidden">
        {/* Card Header */}
        <div className="bg-gradient-to-r from-gray-50 to-blue-50 p-6 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
                <Brain className="h-6 w-6 text-white" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-gray-900">Analysis & Details</h3>
                <p className="text-gray-600 text-sm">
                  View the AI's reasoning and your original requirements
                </p>
              </div>
            </div>
            
            {/* Always show toggle button - user controls visibility */}
            <button
              onClick={onToggleAnalysisDetails}
              className="group flex items-center gap-3 bg-white hover:bg-gray-50 border border-gray-200 hover:border-blue-300 px-4 py-2.5 rounded-xl transition-all duration-200 shadow-sm hover:shadow-md"
            >
              <span className="text-gray-700 group-hover:text-blue-600 font-medium">
                {shouldShowDetails ? 'Hide Details' : 'Show Details'}
              </span>
              <div className="w-6 h-6 bg-gray-100 group-hover:bg-blue-100 rounded-lg flex items-center justify-center transition-colors">
                {shouldShowDetails ? 
                  <ChevronUp className="h-4 w-4 text-gray-600 group-hover:text-blue-600" /> : 
                  <ChevronDown className="h-4 w-4 text-gray-600 group-hover:text-blue-600" />
                }
              </div>
            </button>
          </div>
        </div>

        {shouldShowDetails && (
          <div className="p-6 space-y-8">
            
            {/* Structured Original Prompt Section */}
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-6 border border-blue-100">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center">
                    <Target className="h-5 w-5 text-white" />
                  </div>
                  <h4 className="text-lg font-semibold text-gray-900">Your Requirements</h4>
                </div>
                
                {isLongPrompt && (
                  <button
                    onClick={() => setIsPromptExpanded(!isPromptExpanded)}
                    className="flex items-center gap-2 text-blue-600 hover:text-blue-700 text-sm font-medium transition-colors"
                  >
                    {isPromptExpanded ? 'Show Less' : 'Show More'}
                    {isPromptExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                )}
              </div>
              
              {promptStructure.type === 'structured' ? (
                <div className="space-y-4">
                  {promptStructure.sections.objective && (
                    <div className="bg-white rounded-xl p-4 border border-blue-200">
                      <div className="flex items-center gap-2 mb-2">
                        <Target className="h-4 w-4 text-blue-600" />
                        <span className="font-medium text-blue-900 text-sm">Objective</span>
                      </div>
                      <p className="text-gray-700 leading-relaxed">{promptStructure.sections.objective}</p>
                    </div>
                  )}
                  
                  {promptStructure.sections.context && (!isLongPrompt || isPromptExpanded) ? (
                    <div className="bg-white rounded-xl p-4 border border-blue-200">
                      <div className="flex items-center gap-2 mb-2">
                        <FileText className="h-4 w-4 text-blue-600" />
                        <span className="font-medium text-blue-900 text-sm">Context</span>
                      </div>
                      <p className="text-gray-700 leading-relaxed">{promptStructure.sections.context}</p>
                    </div>
                  ) : null}
                  
                  {promptStructure.sections.requirements && (!isLongPrompt || isPromptExpanded) ? (
                    <div className="bg-white rounded-xl p-4 border border-blue-200">
                      <div className="flex items-center gap-2 mb-2">
                        <CheckCircle className="h-4 w-4 text-blue-600" />
                        <span className="font-medium text-blue-900 text-sm">Requirements</span>
                      </div>
                      <p className="text-gray-700 leading-relaxed">{promptStructure.sections.requirements}</p>
                    </div>
                  ) : null}
                  
                  {/* Simple Additional Details Section */}
                  {promptStructure.sections.remaining && Array.isArray(promptStructure.sections.remaining) && promptStructure.sections.remaining.length > 0 && (!isLongPrompt || isPromptExpanded) ? (
                    <div className="bg-white rounded-xl p-4 border border-blue-200">
                      <div className="flex items-center gap-2 mb-3">
                        <Activity className="h-4 w-4 text-blue-600" />
                        <span className="font-medium text-blue-900 text-sm">Additional Details</span>
                      </div>
                      <div className="text-gray-700 leading-relaxed">
                        {promptStructure.sections.remaining.join('. ')}{promptStructure.sections.remaining.join('.').endsWith('.') ? '' : '.'}
                      </div>
                    </div>
                  ) : null}
                  
                  {isLongPrompt && !isPromptExpanded && (
                    <div className="text-center py-2">
                      <span className="text-sm text-blue-600 font-medium">
                        {userPrompt.length - 300} more characters in additional sections
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-white rounded-xl p-4 border border-blue-200">
                  <p className="text-gray-700 leading-relaxed italic">"{promptStructure.content}"</p>
                </div>
              )}
            </div>
            
            {/* AI Reasoning Section */}
            <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-2xl p-6 border border-purple-100">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center">
                    <Brain className="h-5 w-5 text-white" />
                  </div>
                  <h4 className="text-lg font-semibold text-gray-900">AI Reasoning & Analysis</h4>
                </div>
                
                {isLongReasoning && (
                  <button
                    onClick={() => setIsReasoningExpanded(!isReasoningExpanded)}
                    className="flex items-center gap-2 text-purple-600 hover:text-purple-700 text-sm font-medium transition-colors"
                  >
                    {isReasoningExpanded ? 'Show Less' : 'Show More'}
                    {isReasoningExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                )}
              </div>
              
              <div className="bg-white rounded-xl p-4 border border-purple-200">
                {Array.isArray(reasoningParagraphs) ? (
                  <div className="space-y-4">
                    <p className="text-gray-700 leading-relaxed">
                      {reasoningParagraphs[0]}
                    </p>
                    
                    {reasoningParagraphs.length > 1 && (
                      <div className={`space-y-4 ${isReasoningExpanded ? '' : 'hidden'}`}>
                        {reasoningParagraphs.slice(1).map((paragraph, index) => (
                          <p key={index + 1} className="text-gray-700 leading-relaxed">
                            {paragraph}
                          </p>
                        ))}
                      </div>
                    )}
                    
                    {isLongReasoning && !isReasoningExpanded && (
                      <div className="pt-3 text-center">
                        <span className="text-sm text-purple-600 font-medium">
                          {reasoningParagraphs.length - 1} more analysis section{reasoningParagraphs.length > 2 ? 's' : ''} available
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-gray-700 leading-relaxed">
                    {reasoningParagraphs}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}