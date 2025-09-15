import React, { useState, useEffect, useRef, useCallback } from 'react';
import SmartAgentBuilder from './SmartAgentBuilder'; // Should point to index.tsx
import { useAuth } from '@/components/UserProvider';
import { 
  Send, 
  Bot, 
  User, 
  Sparkles, 
  CheckCircle, 
  Loader2, 
  Brain, 
  MessageSquare,
  ArrowRight,
  Settings,
  FileText,
  Lightbulb,
  Target,
  Clock,
  Zap,
  CheckSquare,
  AlertCircle,
  RefreshCw,
  ThumbsUp,
  ThumbsDown,
  Edit,
  ChevronRight,
  Save,
  X
} from 'lucide-react';

interface Message {
  id: string;
  type: 'user' | 'ai' | 'system';
  content: string;
  timestamp: Date;
  status?: 'sending' | 'sent' | 'error';
  questionId?: string;
  isQuestionAnswer?: boolean;
}

interface QuestionOption {
  value: string;
  label: string;
  description: string;
}

interface ClarificationQuestion {
  id: string;
  dimension: string;
  question: string;
  type: 'single_choice' | 'multiple_choice' | 'text' | 'textarea';
  options: QuestionOption[];
  allowCustom: boolean;
  placeholder?: string;
}

interface RequirementItem {
  id: string;
  label: string;
  status: 'missing' | 'partial' | 'clear';
  detected?: string;
}

interface PluginValidationError {
  pluginValidationError?: boolean;
  missingPlugins?: string[];
  requiredServices?: string[];
  suggestions?: string[];
}

interface PluginWarning {
  missingServices?: string[];
  message?: string;
}

interface ClarityAnalysis extends PluginValidationError {
  needsClarification: boolean;
  questionsSequence: ClarificationQuestion[];
  clarityScore: number;
  pluginWarning?: PluginWarning;
  analysis: {
    data: { status: 'clear' | 'partial' | 'missing'; detected: string };
    timing: { status: 'clear' | 'partial' | 'missing'; detected: string };
    output: { status: 'clear' | 'partial' | 'missing'; detected: string };
    actions: { status: 'clear' | 'partial' | 'missing'; detected: string };
    delivery: { status: 'clear' | 'partial' | 'missing'; detected: string };
    error_handling: { status: 'clear' | 'partial' | 'missing'; detected: string };
  };
}

interface ProjectState {
  originalPrompt: string;
  enhancedPrompt: string;
  requirements: RequirementItem[];
  clarityScore: number;
  isReadyToBuild: boolean;
  enhancementComplete: boolean;
  userApproved: boolean;
  questionsSequence: ClarificationQuestion[];
  currentQuestionIndex: number;
  clarificationAnswers: Record<string, string>;
  showingCustomInput: boolean;
  customInputValue: string;
  isInitialized: boolean;
  isProcessingQuestion: boolean;
  isEditingEnhanced: boolean;
  editedEnhancedPrompt: string;
  // Plugin validation fields
  pluginValidationError?: boolean;
  missingPlugins?: string[];
  requiredServices?: string[];
  suggestions?: string[];
  // NEW: Track which questions should show options
  questionsWithVisibleOptions: Set<string>;
}

interface ConversationalAgentBuilderProps {
  initialPrompt?: string;
  // NEW: Add integration props
  onPromptApproved?: (data: {
    prompt: string;
    promptType: 'original' | 'enhanced';
    clarificationAnswers: Record<string, string>;
  }) => void;
  onCancel?: () => void;
}

export default function ConversationalAgentBuilder({ 
  initialPrompt,
  onPromptApproved, // NEW: Integration prop
  onCancel         // NEW: Integration prop
}: ConversationalAgentBuilderProps) {
  const { user } = useAuth();
  
  useEffect(() => {
    console.log('ConversationalAgentBuilder user state:', { user, userId: user?.id, email: user?.email })
  }, [user]);
  
  const initialMessageId = useRef(`initial-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
  const isProcessingInitial = useRef(false);
  
  const [messages, setMessages] = useState<Message[]>([
    {
      id: initialMessageId.current,
      type: 'ai',
      content: initialPrompt 
        ? `Hello, I see you want to: "${initialPrompt}". Let me help you build an agent for this! I'll analyze your request and ask any clarifying questions needed.`
        : "Hello! I'm here to help you build a custom AI agent. What kind of automation or task would you like your agent to handle? Just describe it in your own words.",
      timestamp: new Date()
    }
  ]);
  
  const [inputValue, setInputValue] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [projectState, setProjectState] = useState<ProjectState>({
    originalPrompt: '',
    enhancedPrompt: '',
    requirements: [
      { id: 'data', label: 'Data & Tools', status: 'missing' },
      { id: 'timing', label: 'When to Run', status: 'missing' },
      { id: 'output', label: 'What to Create', status: 'missing' },
      { id: 'actions', label: 'Specific Actions', status: 'missing' },
      { id: 'delivery', label: 'How to Deliver', status: 'missing' },
      { id: 'error_handling', label: 'Error Handling', status: 'missing' }
    ],
    clarityScore: 0,
    isReadyToBuild: false,
    enhancementComplete: false,
    userApproved: false,
    questionsSequence: [],
    currentQuestionIndex: -1,
    clarificationAnswers: {},
    showingCustomInput: false,
    customInputValue: '',
    isInitialized: false,
    isProcessingQuestion: false,
    isEditingEnhanced: false,
    editedEnhancedPrompt: '',
    pluginValidationError: false,
    missingPlugins: [],
    requiredServices: [],
    suggestions: [],
    questionsWithVisibleOptions: new Set()
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const messageCounter = useRef(0);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Function to recalculate clarity score based on requirements status
  const recalculateClarityScore = useCallback((requirements: RequirementItem[]) => {
    const totalRequirements = requirements.length;
    let score = 0;

    requirements.forEach(req => {
      switch (req.status) {
        case 'clear':
          score += 100;
          break;
        case 'partial':
          score += 60;
          break;
        case 'missing':
          score += 0;
          break;
      }
    });

    const clarityScore = Math.round(score / totalRequirements);
    console.log(`📊 Recalculated clarity score: ${clarityScore}% (${score}/${totalRequirements * 100})`);
    
    return clarityScore;
  }, []);

  // Helper function to add messages with tracking
  const addMessage = useCallback((content: string, type: 'user' | 'ai' | 'system', status?: 'sending' | 'sent' | 'error', questionId?: string, isQuestionAnswer?: boolean) => {
    messageCounter.current += 1;
    const newMessage: Message = {
      id: `msg-${messageCounter.current}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      content,
      timestamp: new Date(),
      status,
      questionId,
      isQuestionAnswer
    };
    setMessages(prev => [...prev, newMessage]);
    return newMessage.id;
  }, []);

  // Helper function to clear plugin validation errors
  const clearPluginValidationError = useCallback(() => {
    setProjectState(prev => ({
      ...prev,
      pluginValidationError: false,
      missingPlugins: [],
      requiredServices: [],
      suggestions: []
    }));
  }, []);

  // Enhanced requirements update function
  const updateRequirementsFromAnswers = useCallback((answers: Record<string, string>, questionsSequence: ClarificationQuestion[]) => {
    console.log('🔄 Updating requirements from answers:', answers);
    console.log('📋 Using questions sequence:', questionsSequence.length, 'questions');
    
    setProjectState(prev => {
      const updatedRequirements = prev.requirements.map(req => {
        // PRIMARY: Check for direct dimension matches
        const directAnswers = Object.entries(answers).filter(([questionId, answer]) => {
          const question = questionsSequence.find(q => q.id === questionId);
          const dimensionMatch = question?.dimension === req.id;
          if (dimensionMatch) {
            console.log(`✅ Direct match for ${req.id}: Q="${question.question.slice(0, 40)}..." A="${answer}"`);
          }
          return dimensionMatch;
        });

        if (directAnswers.length > 0) {
          const answerText = directAnswers.map(([_, answer]) => answer).join(', ');
          return {
            ...req,
            status: 'clear' as const,
            detected: answerText
          };
        }

        // ENHANCED: Content-based detection for timing
        if (req.id === 'timing') {
          console.log('🕐 Checking for timing-related content...');
          
          const timingAnswers = Object.entries(answers).filter(([questionId, answer]) => {
            const question = questionsSequence.find(q => q.id === questionId);
            
            const timingKeywords = ['daily', 'weekly', 'monthly', 'hourly', 'every', 'once', 'regularly', 'schedule', 'time', 'frequency', 'often'];
            const questionHasTiming = question && timingKeywords.some(keyword => 
              question.question.toLowerCase().includes(keyword) || 
              question.id.toLowerCase().includes(keyword)
            );
            const answerHasTiming = timingKeywords.some(keyword => 
              answer.toLowerCase().includes(keyword)
            );
            
            const isTimingRelated = questionHasTiming || answerHasTiming;
            
            if (isTimingRelated) {
              console.log(`🎯 Found timing content: Q:"${question?.question.slice(0, 40)}..." A:"${answer}"`);
            }
            
            return isTimingRelated;
          });
          
          if (timingAnswers.length > 0) {
            const timingText = timingAnswers.map(([_, answer]) => answer).join(', ');
            console.log(`✅ Timing detected for ${req.id}: ${timingText}`);
            return {
              ...req,
              status: 'clear' as const,
              detected: timingText
            };
          }
        }

        // Keep existing status if no matches found
        console.log(`⚠️ No matches found for ${req.id}, keeping status: ${req.status}`);
        return req;
      });

      const newClarityScore = recalculateClarityScore(updatedRequirements);

      return {
        ...prev,
        requirements: updatedRequirements,
        clarityScore: newClarityScore,
        isReadyToBuild: newClarityScore >= 80
      };
    });
  }, [recalculateClarityScore]);

  // Enhanced enhancement function with better error handling and plugin information
  const startEnhancement = useCallback(async (prompt: string, finalAnswers: Record<string, string>) => {
    // CRITICAL: Additional safeguard - check questions are answered before enhancement
    if (projectState.questionsSequence.length > 0) {
      const totalQuestions = projectState.questionsSequence.length;
      const answeredQuestions = Object.keys(finalAnswers).length;
      
      console.log(`startEnhancement validation: ${answeredQuestions}/${totalQuestions}`);
      console.log('Question IDs expected:', projectState.questionsSequence.map(q => q.id));
      console.log('Answer IDs received:', Object.keys(finalAnswers));
      
      // Check that every question has a corresponding answer, not just count
      const unansweredQuestions = projectState.questionsSequence.filter(question => 
        !finalAnswers.hasOwnProperty(question.id) ||
        !finalAnswers[question.id] ||
        finalAnswers[question.id].trim() === ''
      );
      
      if (unansweredQuestions.length > 0) {
        console.error('❌ CRITICAL: startEnhancement called but some questions missing answers:', 
          unansweredQuestions.map(q => q.id));
        addMessage("Error: I cannot enhance the prompt because some questions haven't been answered. Please complete all questions first.", 'ai');
        return;
      }
      
      console.log('✅ startEnhancement validation passed');
    }
    
    // Validate inputs before proceeding
    if (!prompt || !prompt.trim()) {
      console.error('❌ Cannot enhance empty prompt');
      addMessage("I encountered an error - the prompt is empty. Please try again.", 'ai');
      return;
    }

    if (!user?.id) {
      console.error('❌ User not authenticated');
      addMessage("Authentication error. Please refresh and try again.", 'ai');
      return;
    }

    addMessage("Let me enhance your prompt with simple, clear details based on your answers...", 'ai');
    setIsProcessing(true);
    
    try {
      console.log('🚀 Starting enhancement with answers:', finalAnswers);
      console.log('📦 Missing plugins info:', projectState.missingPlugins);
      
      // FIXED: Include missing plugin information in the enhancement request
      const enhancementPayload = {
        prompt: prompt.trim(),
        clarificationAnswers: finalAnswers,
        userId: user.id,
        // Include plugin validation information
        missingPlugins: projectState.missingPlugins || [],
        pluginValidationError: projectState.pluginValidationError || false,
        suggestions: projectState.suggestions || []
      };
      
      console.log('📡 Enhancement payload:', enhancementPayload);
      
      const response = await fetch('/api/enhance-prompt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
        body: JSON.stringify(enhancementPayload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Enhancement API error:', errorText);
        throw new Error(`Failed to enhance prompt: ${response.status}`);
      }

      const result = await response.json();
      console.log('✅ Enhancement result:', result);
      
      setProjectState(prev => ({
        ...prev,
        enhancedPrompt: result.enhancedPrompt,
        enhancementComplete: true,
        clarificationAnswers: finalAnswers
      }));
      
      // FIXED: Show appropriate message based on whether missing plugins were excluded
      let enhancementMessage = `Here's your enhanced automation plan in simple terms:

**Enhanced Plan:**
${result.enhancedPrompt}`;

      if (projectState.missingPlugins && projectState.missingPlugins.length > 0) {
        enhancementMessage += `

💡 **Note:** I've designed this plan to work with your currently connected services. The original request mentioned ${projectState.missingPlugins.join(', ')}, but since these aren't connected, I've suggested alternative approaches that use available tools instead.`;
      }

      enhancementMessage += `

This breaks down exactly what your agent will do in everyday language. Would you like to use this enhanced version, edit it, or stick with your original request?`;
      
      addMessage(enhancementMessage, 'ai');
    } catch (error) {
      console.error('❌ Enhancement error:', error);
      addMessage("I encountered an error enhancing your prompt. Please try again.", 'ai');
    } finally {
      setIsProcessing(false);
    }
  }, [user?.id, addMessage, projectState.missingPlugins, projectState.pluginValidationError, projectState.suggestions, projectState.questionsSequence]);

  // FIXED: More flexible question progression that handles answer changes
  const proceedToNextQuestion = useCallback(() => {
    setProjectState(current => {
      console.log('🔄 Question progression check:', {
        currentIndex: current.currentQuestionIndex,
        totalQuestions: current.questionsSequence.length,
        answersCount: Object.keys(current.clarificationAnswers).length,
        allAnsweredQuestionIds: Object.keys(current.clarificationAnswers),
        allQuestionIds: current.questionsSequence.map(q => q.id)
      });
      
      // Find the next unanswered question (skip current question validation since user might be changing previous answers)
      const nextUnansweredIndex = current.questionsSequence.findIndex((question, index) => {
        const isAfterCurrent = index > current.currentQuestionIndex;
        const hasAnswer = current.clarificationAnswers.hasOwnProperty(question.id) && 
                         current.clarificationAnswers[question.id] && 
                         current.clarificationAnswers[question.id].trim() !== '';
        return isAfterCurrent && !hasAnswer;
      });
      
      if (nextUnansweredIndex >= 0) {
        console.log(`📋 Moving to next unanswered question at index ${nextUnansweredIndex} (ID: ${current.questionsSequence[nextUnansweredIndex].id})`);
        
        const nextQuestionId = current.questionsSequence[nextUnansweredIndex].id;
        const newVisibleOptions = new Set(current.questionsWithVisibleOptions);
        newVisibleOptions.add(nextQuestionId);
        
        return {
          ...current,
          currentQuestionIndex: nextUnansweredIndex,
          isProcessingQuestion: false,
          questionsWithVisibleOptions: newVisibleOptions
        };
      }
      
      // If no unanswered questions found after current, check if ALL questions are answered
      console.log('🎯 No more unanswered questions found, validating completion...');
      
      const unansweredQuestions = current.questionsSequence.filter(question => 
        !current.clarificationAnswers.hasOwnProperty(question.id) ||
        !current.clarificationAnswers[question.id] ||
        current.clarificationAnswers[question.id].trim() === ''
      );
      
      if (unansweredQuestions.length > 0) {
        console.log('⚠️ Found unanswered questions, going to first one:', 
          unansweredQuestions.map(q => ({ id: q.id, question: q.question.slice(0, 50) })));
        
        // Go to the first unanswered question
        const firstUnansweredIndex = current.questionsSequence.findIndex(q => q.id === unansweredQuestions[0].id);
        console.log(`Going to unanswered question at index ${firstUnansweredIndex}`);
        
        const newVisibleOptions = new Set(current.questionsWithVisibleOptions);
        newVisibleOptions.add(unansweredQuestions[0].id);
        
        return {
          ...current,
          currentQuestionIndex: firstUnansweredIndex,
          isProcessingQuestion: false,
          questionsWithVisibleOptions: newVisibleOptions
        };
      }
      
      console.log('✅ ALL questions verified as answered - marking completion');
      console.log('📝 Final answers:', current.clarificationAnswers);
      
      // Mark completion
      return {
        ...current,
        currentQuestionIndex: -1, // Reset to indicate completion
        isProcessingQuestion: false,
        enhancementComplete: false // Will trigger enhancement
      };
    });
  }, []);

  // FIXED: Separate useEffect for handling question progression
  useEffect(() => {
    const currentQuestion = projectState.questionsSequence[projectState.currentQuestionIndex];
    
    if (currentQuestion && projectState.currentQuestionIndex >= 0) {
      // Add delay to prevent rapid-fire
      const timer = setTimeout(() => {
        console.log('❓ Asking question:', currentQuestion.question.slice(0, 50) + '...');
        askCurrentQuestion(currentQuestion);
      }, 500);
      
      return () => clearTimeout(timer);
    }
  }, [projectState.currentQuestionIndex, projectState.questionsSequence]);

  // FIXED: Handle completion in separate useEffect
  useEffect(() => {
    if (projectState.currentQuestionIndex === -1 && 
        Object.keys(projectState.clarificationAnswers).length > 0 && 
        !projectState.enhancementComplete) {
      
      console.log('🎯 Processing completion...');
      
      // Update requirements immediately
      updateRequirementsFromAnswers(projectState.clarificationAnswers, projectState.questionsSequence);
      
      addMessage("Perfect! I now have everything I need. Let me enhance your prompt with all these details...", 'ai');
      
      // Build enhanced prompt
      const fullPrompt = `${projectState.originalPrompt}\n\nAdditional details:\n${Object.entries(projectState.clarificationAnswers).map(([questionId, answer]) => {
        const question = projectState.questionsSequence.find(q => q.id === questionId);
        const dimension = question?.dimension || questionId;
        return `${dimension}: ${answer}`;
      }).join('\n')}`;
      
      // Start enhancement
      setTimeout(() => {
        startEnhancement(fullPrompt, projectState.clarificationAnswers);
      }, 1000);
      
      // Mark as starting enhancement
      setProjectState(prev => ({
        ...prev,
        enhancementComplete: true
      }));
    }
  }, [projectState.currentQuestionIndex, projectState.clarificationAnswers, projectState.enhancementComplete]);

  // Fixed auto-process initial prompt with proper guards
  useEffect(() => {
    if (initialPrompt && 
        !projectState.isInitialized && 
        !isProcessingInitial.current && 
        !projectState.originalPrompt) {
      
      console.log('🎯 Starting initial prompt processing:', initialPrompt);
      isProcessingInitial.current = true;
      
      setProjectState(prev => ({
        ...prev,
        isInitialized: true
      }));
      
      setTimeout(() => {
        processInitialPrompt(initialPrompt);
      }, 1000);
    }
  }, [initialPrompt, projectState.isInitialized, projectState.originalPrompt]);

  const processInitialPrompt = async (prompt: string) => {
    if (isProcessing || projectState.originalPrompt) {
      console.log('⚠️ Skipping duplicate initial prompt processing');
      return;
    }

    // FIXED: Validate prompt before processing
    if (!prompt || !prompt.trim()) {
      console.error('❌ Cannot process empty prompt');
      addMessage("I need a description of what you'd like your agent to do. Please provide more details.", 'ai');
      return;
    }

    console.log('🚀 Processing initial prompt:', prompt);
    setIsProcessing(true);
    
    addMessage(prompt, 'user');
    
    setProjectState(prev => ({
      ...prev,
      originalPrompt: prompt.trim()
    }));

    try {
      const analysis = await analyzePromptClarity(prompt.trim());
      updateRequirementsFromAnalysis(analysis);

      // FIXED: Don't proceed if there are plugin validation errors
      if (analysis.pluginValidationError) {
        console.log('❌ Plugin validation error detected, stopping flow');
        return;
      }

      if (analysis.needsClarification && analysis.questionsSequence?.length > 0) {
        console.log('📋 Starting clarification sequence:', analysis.questionsSequence.length, 'questions');
        
        // Validate questions structure
        const validQuestions = analysis.questionsSequence.filter(q => 
          q && q.id && q.question && q.options && Array.isArray(q.options)
        );
        
        if (validQuestions.length === 0) {
          console.error('❌ No valid questions received');
          addMessage("I need more information to help you effectively. Could you provide more details about what you'd like your agent to do?", 'ai');
          return;
        }
        
        console.log('✅ Valid questions:', validQuestions.length);
        
        // Set up questions sequence and make first question visible
        const firstQuestionId = validQuestions[0]?.id;
        const initialVisibleOptions = new Set<string>();
        if (firstQuestionId) {
          initialVisibleOptions.add(firstQuestionId);
        }
        
        setProjectState(prev => ({
          ...prev,
          questionsSequence: validQuestions,
          currentQuestionIndex: 0,
          isProcessingQuestion: false,
          questionsWithVisibleOptions: initialVisibleOptions
        }));
      } else if (analysis.clarityScore >= 90) {
        addMessage("Perfect! Your request is very clear. Let me enhance it with simple, clear details...", 'ai');
        await startEnhancement(prompt.trim(), {});
      } else {
        addMessage("I need a bit more information to help you effectively. Could you provide more details about what you'd like your agent to do?", 'ai');
      }
    } catch (error) {
      console.error('❌ Error in processInitialPrompt:', error);
      addMessage("I encountered an error analyzing your request. Please try again.", 'ai');
    } finally {
      setIsProcessing(false);
      isProcessingInitial.current = false;
    }
  };

  // Enhanced API call - let backend handle plugin fetching from database
  const analyzePromptClarity = async (prompt: string, bypassPluginValidation: boolean = false): Promise<ClarityAnalysis> => {
    console.log('🔍 Analyzing prompt clarity for:', prompt.slice(0, 50));
    
    if (!user?.id) {
      throw new Error('User not authenticated');
    }

    // FIXED: Validate prompt before API call
    if (!prompt || !prompt.trim()) {
      throw new Error('Cannot analyze empty prompt');
    }
    
    try {
      console.log('📡 Sending request to analyze-prompt-clarity API');
      
      const response = await fetch('/api/analyze-prompt-clarity', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id,
        },
        body: JSON.stringify({
          prompt: prompt.trim(), // FIXED: Always trim the prompt
          userId: user.id,
          bypassPluginValidation: bypassPluginValidation
          // Let backend fetch connected plugins from database
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ API response error:', errorText);
        throw new Error(`Failed to analyze prompt clarity: ${response.status}`);
      }

      const result = await response.json();
      console.log('✅ Clarity analysis complete:', result);
      
      if (!result || typeof result.clarityScore !== 'number') {
        console.error('❌ Invalid API response structure:', result);
        throw new Error('Invalid response from clarity analysis API');
      }
      
      return result;
    } catch (error) {
      console.error('❌ Error in analyzePromptClarity:', error);
      throw error;
    }
  };

  const updateRequirementsFromAnalysis = (analysis: ClarityAnalysis) => {
    console.log('📊 Full analysis received:', analysis); // Debug log
    console.log('📊 Plugin warning check:', analysis.pluginWarning); // Debug log
    
    // Handle plugin warning (simple FYI notification)
    if (analysis.pluginWarning) {
      console.log('⚠️ Plugin warning detected:', analysis.pluginWarning);
      addMessage(
        `💡 FYI: ${analysis.pluginWarning.message}`,
        'ai'
      );
    }
    
    const updatedRequirements = projectState.requirements.map(req => {
      const analysisData = analysis.analysis?.[req.id as keyof typeof analysis.analysis];
      return {
        ...req,
        status: analysisData?.status || 'missing',
        detected: analysisData?.detected || ''
      };
    });

    const newClarityScore = recalculateClarityScore(updatedRequirements);

    setProjectState(prev => ({
      ...prev,
      requirements: updatedRequirements,
      clarityScore: newClarityScore
    }));
  };

  const askCurrentQuestion = (question: ClarificationQuestion) => {
    console.log('❓ Asking question:', {
      id: question.id,
      dimension: question.dimension,
      question: question.question.slice(0, 50) + '...',
      optionsCount: question.options?.length || 0
    });
    
    if (!question.id || !question.question || !question.options) {
      console.error('❌ Invalid question structure:', question);
      addMessage("I encountered an error with the question format. Please try again.", 'ai');
      return;
    }
    
    const questionMessage = question.question;
    addMessage(questionMessage, 'ai');
    
    addQuestionMessage(question);
  };

  const addQuestionMessage = (question: ClarificationQuestion) => {
    messageCounter.current += 1;
    const questionMessage: Message = {
      id: `question-${messageCounter.current}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'system',
      content: JSON.stringify(question),
      timestamp: new Date(),
      questionId: question.id
    };
    setMessages(prev => [...prev, questionMessage]);
  };

  // FIXED: Option selection handler - removed blocking for already answered questions
  const handleOptionSelect = useCallback((questionId: string, selectedValue: string, selectedLabel: string) => {
    console.log('User selected option:', { questionId, selectedValue, selectedLabel });
    
    // FIXED: Remove the blocking check for already answered questions
    // Only check if currently processing
    if (projectState.isProcessingQuestion) {
      console.log('Currently processing a question');
      return;
    }
    
    // Handle custom option
    if (selectedValue === 'custom') {
      setProjectState(prev => ({
        ...prev,
        showingCustomInput: true
      }));
      return;
    }

    console.log('Processing selection:', selectedLabel);

    // FIXED: Update state with answer (will overwrite if already exists)
    setProjectState(current => ({
      ...current,
      clarificationAnswers: {
        ...current.clarificationAnswers,
        [questionId]: selectedLabel
      },
      isProcessingQuestion: true // Block further clicks
    }));

    // Add user message
    addMessage(selectedLabel, 'user', 'sent', questionId, true);
    
    // Process after delay
    setTimeout(() => {
      addMessage(`Question answered`, 'system', 'sent', questionId);
      
      // Reset processing flag first, then proceed
      setProjectState(prev => ({
        ...prev,
        isProcessingQuestion: false
      }));
      
      // Proceed to next question
      setTimeout(() => {
        proceedToNextQuestion();
      }, 200);
    }, 300);
  }, [projectState.isProcessingQuestion, proceedToNextQuestion, addMessage]); // FIXED: Remove clarificationAnswers from dependency

  // FIXED: Custom answer handler - removed blocking for already answered questions
  const handleCustomAnswer = useCallback(() => {
    const currentQuestion = projectState.questionsSequence[projectState.currentQuestionIndex];
    if (!currentQuestion) {
      console.error('❌ No current question found');
      return;
    }

    const questionId = currentQuestion.id;
    
    // FIXED: Remove the blocking check for already answered questions
    if (projectState.isProcessingQuestion) {
      console.log('⚠️ Currently processing');
      return;
    }
    
    if (!projectState.customInputValue.trim()) {
      console.log('⚠️ Empty input');
      return;
    }

    const customAnswer = projectState.customInputValue.trim();
    console.log('✅ Processing custom answer:', customAnswer);

    // FIXED: Update state (will overwrite if already exists)
    setProjectState(current => ({
      ...current,
      clarificationAnswers: {
        ...current.clarificationAnswers,
        [questionId]: customAnswer
      },
      showingCustomInput: false,
      customInputValue: '',
      isProcessingQuestion: true
    }));

    // Add messages
    addMessage(customAnswer, 'user', 'sent', questionId, true);
    
    setTimeout(() => {
      addMessage(`✅ Question answered`, 'system', 'sent', questionId);
      
      // Reset processing flag first
      setProjectState(prev => ({
        ...prev,
        isProcessingQuestion: false
      }));
      
      // Then proceed
      setTimeout(() => {
        proceedToNextQuestion();
      }, 200);
    }, 300);
  }, [projectState.questionsSequence, projectState.currentQuestionIndex, projectState.customInputValue, projectState.isProcessingQuestion, proceedToNextQuestion, addMessage]); // FIXED: Remove clarificationAnswers from dependency

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isProcessing) return;

    const userMessage = inputValue.trim();
    setInputValue('');
    
    addMessage(userMessage, 'user');
    setIsProcessing(true);

    try {
      if (!projectState.originalPrompt && userMessage.length > 10) {
        await processInitialPrompt(userMessage);
      } else {
        addMessage("I'm here to help you build your agent. What would you like to know?", 'ai');
      }
    } catch (error) {
      addMessage("I encountered an error processing your message. Please try again.", 'ai');
    } finally {
      setIsProcessing(false);
    }
  };

  // UPDATED: Enhanced prompt handling functions with Smart Agent Builder integration
  const handleApproveEnhanced = () => {
    console.log('✅ User approved enhanced plan');
    
    setProjectState(prev => ({
      ...prev,
      userApproved: true,
      isReadyToBuild: true
    }));
    
    addMessage("Excellent! I'll use the enhanced plan. Now let's move to the smart build phase.", 'ai');
    
    // NEW: Trigger transition to Smart Agent Builder
    if (onPromptApproved) {
      console.log('🚀 Triggering Smart Agent Builder with enhanced prompt');
      onPromptApproved({
        prompt: projectState.enhancedPrompt,
        promptType: 'enhanced',
        clarificationAnswers: projectState.clarificationAnswers
      });
    }
  };

  const handleUseOriginal = () => {
    console.log('✅ User chose to use original prompt');
    
    setProjectState(prev => ({
      ...prev,
      userApproved: true,
      isReadyToBuild: true
    }));
    
    addMessage("No problem! I'll use your original request. Let's proceed to build your agent.", 'ai');
    
    // NEW: Trigger transition to Smart Agent Builder
    if (onPromptApproved) {
      console.log('🚀 Triggering Smart Agent Builder with original prompt');
      onPromptApproved({
        prompt: projectState.originalPrompt,
        promptType: 'original',
        clarificationAnswers: projectState.clarificationAnswers
      });
    }
  };

  const handleEditEnhanced = () => {
    setProjectState(prev => ({
      ...prev,
      isEditingEnhanced: true,
      editedEnhancedPrompt: prev.enhancedPrompt
    }));
  };

  const handleSaveEnhancedEdit = () => {
    if (!projectState.editedEnhancedPrompt.trim()) {
      return;
    }

    setProjectState(prev => ({
      ...prev,
      enhancedPrompt: prev.editedEnhancedPrompt.trim(),
      isEditingEnhanced: false,
      // Don't set userApproved to true - let them approve the edited version
      // userApproved: true,
      // isReadyToBuild: true
    }));
    
    addMessage("I've updated the enhanced plan with your changes. Please review the updated version and let me know if you'd like to use it or make further changes.", 'ai');
  };

  const handleCancelEnhancedEdit = () => {
    setProjectState(prev => ({
      ...prev,
      isEditingEnhanced: false,
      editedEnhancedPrompt: ''
    }));
  };

  // NEW: Handle cancellation
  const handleCancel = () => {
    console.log('❌ User cancelled agent builder');
    if (onCancel) {
      onCancel();
    }
  };

  // FIXED: Function to clear an answer and make options visible again
  const handleChangeAnswer = useCallback((questionId: string) => {
    console.log('🔄 Changing answer for question:', questionId);
    
    setProjectState(prev => {
      const newAnswers = { ...prev.clarificationAnswers };
      delete newAnswers[questionId];
      
      // Make this question's options visible again
      const newVisibleOptions = new Set(prev.questionsWithVisibleOptions);
      newVisibleOptions.add(questionId);
      
      console.log('Updated visible options:', Array.from(newVisibleOptions));
      
      return {
        ...prev,
        clarificationAnswers: newAnswers,
        questionsWithVisibleOptions: newVisibleOptions
      };
    });
  }, []);

  // FIXED: Question rendering - check if options should be visible
  const renderQuestionOptions = (question: ClarificationQuestion) => {
    if (!question || !question.options) {
      console.error('❌ Invalid question data for rendering:', question);
      return (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-600">Error loading question options. Please try again.</p>
        </div>
      );
    }

    const isAnswered = projectState.clarificationAnswers[question.id];
    const isCurrentQuestion = projectState.questionsSequence[projectState.currentQuestionIndex]?.id === question.id;
    const isProcessing = projectState.isProcessingQuestion;
    const shouldShowOptions = projectState.questionsWithVisibleOptions.has(question.id);

    console.log('renderQuestionOptions called:', {
      questionId: question.id,
      isAnswered: !!isAnswered,
      answerValue: isAnswered,
      isCurrentQuestion,
      shouldShowOptions,
      visibleOptions: Array.from(projectState.questionsWithVisibleOptions)
    });

    // Only show options if this question is marked as having visible options
    if (!shouldShowOptions) {
      console.log('Not showing options for question:', question.id, 'not in visible options set');
      return null;
    }

    console.log('Showing options for question:', question.id);

    // For choice questions, always show the options when they should be visible
    return (
      <div className="mt-4 space-y-2">
        {isAnswered && (
          <div className="mb-3 p-3 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <span className="text-sm font-medium text-green-800">
                Your Answer:
              </span>
            </div>
            <p className="text-sm text-green-700 mb-2">{isAnswered}</p>
            <button
              onClick={() => handleChangeAnswer(question.id)}
              className="text-xs text-green-600 hover:text-green-800 underline hover:no-underline transition-colors"
            >
              Change answer
            </button>
          </div>
        )}
        
        {!isAnswered && (
          <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-blue-400 rounded-full animate-pulse" />
              <span className="text-sm font-medium text-blue-800">
                Select your answer:
              </span>
            </div>
          </div>
        )}
        
        {question.options.map((option, index) => {
          const isSelected = isAnswered === option.label;
          // Disable during processing only for current question
          const isDisabled = isProcessing && isCurrentQuestion;
          
          return (
            <button
              key={option.value}
              onClick={() => {
                console.log('Option clicked:', option.label, 'for question:', question.id);
                handleOptionSelect(question.id, option.value, option.label);
              }}
              disabled={isDisabled}
              className={`w-full text-left p-4 border rounded-lg transition-all duration-200 group disabled:opacity-50 disabled:cursor-not-allowed ${
                isSelected 
                  ? 'bg-green-50 border-green-300 hover:border-green-400' 
                  : 'bg-white border-gray-200 hover:border-blue-300 hover:bg-blue-50'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors ${
                  isSelected
                    ? 'bg-green-500 text-white'
                    : 'bg-blue-100 group-hover:bg-blue-200'
                }`}>
                  {isSelected ? (
                    <CheckCircle className="h-4 w-4" />
                  ) : (
                    <span className="text-blue-600 font-semibold text-sm">{index + 1}</span>
                  )}
                </div>
                <div className="flex-1">
                  <p className={`font-medium mb-1 ${
                    isSelected ? 'text-green-900' : 'text-gray-900'
                  }`}>
                    {option.label}
                  </p>
                  {option.description && (
                    <p className={`text-sm ${
                      isSelected ? 'text-green-700' : 'text-gray-600'
                    }`}>
                      {option.description}
                    </p>
                  )}
                </div>
                <ChevronRight className={`w-4 h-4 transition-colors ${
                  isSelected 
                    ? 'text-green-500' 
                    : 'text-gray-400 group-hover:text-blue-500'
                }`} />
              </div>
            </button>
          );
        })}
        
        {question.allowCustom && isCurrentQuestion && (
          <button
            onClick={() => setProjectState(prev => ({ ...prev, showingCustomInput: true }))}
            disabled={isProcessing}
            className="w-full text-left p-4 bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-all duration-200 group disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center flex-shrink-0 group-hover:bg-blue-200">
                <Edit className="h-3 w-3 text-gray-500 group-hover:text-blue-600" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-gray-700 group-hover:text-blue-900">Custom Answer</p>
                <p className="text-sm text-gray-500">Provide your own specific details</p>
              </div>
            </div>
          </button>
        )}

        {projectState.showingCustomInput && isCurrentQuestion && (
          <div className="mt-4 p-4 bg-gray-50 rounded-lg border-2 border-blue-200">
            <p className="text-sm text-gray-700 mb-3">Please type your custom answer:</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={projectState.customInputValue}
                onChange={(e) => setProjectState(prev => ({ ...prev, customInputValue: e.target.value }))}
                onKeyPress={(e) => e.key === 'Enter' && !isProcessing && handleCustomAnswer()}
                placeholder="Type your answer..."
                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                autoFocus
                disabled={isProcessing}
              />
              <button
                onClick={handleCustomAnswer}
                disabled={!projectState.customInputValue.trim() || isProcessing}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'clear':
        return 'text-green-600 bg-green-50';
      case 'partial':
        return 'text-yellow-600 bg-yellow-50';
      default:
        return 'text-gray-600 bg-gray-50';
    }
  };

  return (
    <div className="h-screen flex bg-gray-100">
      {/* Left Side - Chat */}
      <div className="flex-1 flex flex-col bg-white border-r border-gray-200">
        {/* Chat Header */}
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
            {/* NEW: Add cancel button if onCancel prop provided */}
            {onCancel && (
              <button
                onClick={handleCancel}
                className="text-gray-500 hover:text-gray-700 transition-colors px-3 py-1 rounded"
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        {/* Chat Messages */}
        <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-6 space-y-6">
          {messages.map((message) => {
            // Handle system messages for question tracking
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

            if (message.type === 'system' && message.content.startsWith('{')) {
              try {
                const question = JSON.parse(message.content) as ClarificationQuestion;
                const isAnswered = projectState.clarificationAnswers[question.id];
                
                return (
                  <div key={message.id} className="flex gap-4 justify-start">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm ${
                      isAnswered 
                        ? 'bg-gradient-to-br from-green-500 to-emerald-600' 
                        : 'bg-gradient-to-br from-blue-500 to-indigo-600'
                    }`}>
                      {isAnswered ? (
                        <CheckCircle className="h-5 w-5 text-white" />
                      ) : (
                        <Bot className="h-5 w-5 text-white" />
                      )}
                    </div>
                    <div className="flex-1 max-w-2xl">
                      <div className={`rounded-2xl shadow-sm border-2 transition-all duration-200 ${
                        isAnswered 
                          ? 'bg-gradient-to-br from-green-50 to-emerald-50 border-green-200' 
                          : 'bg-white border-gray-200 hover:border-blue-200'
                      }`}>
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
                              <p className="text-sm font-medium text-green-900">
                                Your answer: {projectState.clarificationAnswers[question.id]}
                              </p>
                              <button
                                onClick={() => handleChangeAnswer(question.id)}
                                className="text-xs text-green-600 hover:text-green-800 underline ml-4"
                              >
                                Change
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="p-6">
                            <div className="flex items-center gap-3 mb-4">
                              <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                                <Bot className="h-4 w-4 text-blue-600" />
                              </div>
                              <span className="text-sm font-semibold text-blue-800">
                                Question {projectState.questionsSequence.findIndex(q => q.id === question.id) + 1} of {projectState.questionsSequence.length}
                              </span>
                            </div>
                            <p className="text-gray-700 mb-4 leading-relaxed">{question.question}</p>
                            <p className="text-sm text-gray-600 mb-4">Please select your answer:</p>
                            {renderQuestionOptions(question)}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              } catch (e) {
                console.error('❌ Error parsing question JSON:', e);
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

            return (
              <div
                key={message.id}
                className={`flex gap-4 ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {message.type === 'ai' && (
                  <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm">
                    <Bot className="h-5 w-5 text-white" />
                  </div>
                )}
                
                <div
                  className={`max-w-2xl relative ${
                    message.type === 'user'
                      ? 'ml-12'
                      : 'mr-12'
                  }`}
                >
                  <div className={`rounded-2xl px-6 py-4 shadow-sm border relative ${
                    message.type === 'user'
                      ? `bg-gradient-to-br from-blue-600 to-indigo-700 text-white border-blue-600 ${
                          message.isQuestionAnswer ? 'ring-2 ring-green-300 ring-offset-2' : ''
                        }`
                      : (message.content.includes('🚨 MISSING SERVICES:') || 
                         message.content.includes('FYI:') && (message.content.includes('service isn\'t connected') || message.content.includes('services aren\'t connected')))
                      ? 'bg-gradient-to-br from-yellow-50 to-orange-50 text-orange-900 border-2 border-orange-300 shadow-lg'
                      : 'bg-white text-gray-800 border-gray-200 hover:border-gray-300 transition-colors'
                  }`}>
                    {message.isQuestionAnswer && (
                      <div className="absolute -top-2 -right-2 w-6 h-6 bg-gradient-to-br from-green-500 to-emerald-600 rounded-full flex items-center justify-center shadow-sm">
                        <CheckCircle className="h-3 w-3 text-white" />
                      </div>
                    )}
                    
                    {/* Special warning icon for missing services */}
                    {(message.content.includes('🚨 MISSING SERVICES:') || 
                      (message.content.includes('FYI:') && (message.content.includes('service isn\'t connected') || message.content.includes('services aren\'t connected')))) && (
                      <div className="absolute -top-2 -right-2 w-6 h-6 bg-gradient-to-br from-orange-500 to-orange-600 rounded-full flex items-center justify-center shadow-sm animate-pulse">
                        <AlertCircle className="h-3 w-3 text-white" />
                      </div>
                    )}
                    
                    <div className={`whitespace-pre-wrap leading-relaxed text-sm ${
                      (message.content.includes('🚨 MISSING SERVICES:') || 
                       (message.content.includes('FYI:') && (message.content.includes('service isn\'t connected') || message.content.includes('services aren\'t connected')))) 
                      ? 'font-medium' : ''
                    }`}>
                      {message.content}
                    </div>
                    
                    {/* Timestamp */}
                    <div className={`text-xs mt-2 opacity-70 ${
                      message.type === 'user' ? 'text-blue-100' : 'text-gray-500'
                    }`}>
                      {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    
                    {message.type === 'ai' && projectState.enhancementComplete && message.content.includes('Enhanced Plan:') && !projectState.userApproved && (
                      <div className="mt-6 space-y-3">
                        {/* Enhanced Plan Edit Section */}
                        {projectState.isEditingEnhanced ? (
                          <div className="bg-gray-50 rounded-xl p-4 space-y-4 border border-gray-200">
                            <div className="flex items-center gap-2">
                              <Edit className="h-4 w-4 text-gray-600" />
                              <span className="text-sm font-medium text-gray-700">Edit your enhanced plan:</span>
                            </div>
                            <textarea
                              value={projectState.editedEnhancedPrompt}
                              onChange={(e) => {
                                console.log('Textarea onChange:', e.target.value);
                                setProjectState(prev => ({ ...prev, editedEnhancedPrompt: e.target.value }));
                              }}
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
                              onClick={() => {
                                console.log('✅ Use Enhanced button clicked!');
                                handleApproveEnhanced();
                              }}
                              className="w-full bg-gradient-to-r from-green-600 to-emerald-700 text-white px-4 py-3 rounded-xl hover:from-green-700 hover:to-emerald-800 transition-all duration-200 flex items-center justify-center gap-2 font-medium shadow-sm"
                            >
                              <ThumbsUp className="h-4 w-4" />
                              Use Enhanced Plan
                            </button>
                            <button
                              onClick={() => {
                                console.log('🔧 Edit button clicked!');
                                console.log('Current state:', {
                                  isEditingEnhanced: projectState.isEditingEnhanced,
                                  enhancedPrompt: projectState.enhancedPrompt,
                                  userApproved: projectState.userApproved
                                });
                                handleEditEnhanced();
                              }}
                              className="w-full bg-gradient-to-r from-purple-600 to-purple-700 text-white px-4 py-3 rounded-xl hover:from-purple-700 hover:to-purple-800 transition-all duration-200 flex items-center justify-center gap-2 font-medium shadow-sm"
                            >
                              <Edit className="h-4 w-4" />
                              Edit Enhanced Plan
                            </button>
                            <button
                              onClick={() => {
                                console.log('📝 Use Original button clicked!');
                                handleUseOriginal();
                              }}
                              className="w-full bg-gradient-to-r from-gray-600 to-gray-700 text-white px-4 py-3 rounded-xl hover:from-gray-700 hover:to-gray-800 transition-all duration-200 flex items-center justify-center gap-2 font-medium shadow-sm"
                            >
                              <FileText className="h-4 w-4" />
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
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                  </div>
                  <span className="text-sm text-gray-600 font-medium">AI is thinking...</span>
                </div>
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>

        {/* Chat Input - Hidden for this workflow */}
        {false && (
          <div className="border-t border-gray-200 p-4">
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
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

      {/* Right Side - Action Panel */}
      <div className="w-96 bg-gray-50 border-l border-gray-200 p-6 space-y-6">
        {/* Project Progress */}
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
              <div
                className="bg-gradient-to-r from-blue-500 to-purple-500 h-2 rounded-full transition-all duration-500"
                style={{ width: `${projectState.clarityScore}%` }}
              />
            </div>

            {projectState.questionsSequence.length > 0 && (
              <div className="text-sm text-gray-600">
                Question {Math.max(0, projectState.currentQuestionIndex + 1)} of {projectState.questionsSequence.length}
                {projectState.isProcessingQuestion && (
                  <span className="ml-2 text-blue-600">(processing...)</span>
                )}
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

        {/* Requirements Progress */}
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
              <CheckSquare className="h-4 w-4 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Requirements</h3>
              <p className="text-xs text-gray-500">
                {projectState.requirements.filter(r => r.status === 'clear').length} of {projectState.requirements.length} complete
              </p>
            </div>
          </div>
          
          <div className="space-y-2">
            {projectState.requirements.map((req, index) => (
              <div key={req.id} className="group">
                <div className={`relative rounded-lg border-2 transition-all duration-200 ${
                  req.status === 'clear' 
                    ? 'border-green-200 bg-green-50' 
                    : req.status === 'partial'
                    ? 'border-yellow-200 bg-yellow-50'
                    : 'border-gray-200 bg-gray-50 group-hover:border-gray-300'
                }`}>
                  <div className="flex items-center p-3">
                    <div className={`flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                      req.status === 'clear'
                        ? 'bg-green-500 border-green-500'
                        : req.status === 'partial'
                        ? 'bg-yellow-500 border-yellow-500'
                        : 'bg-white border-gray-300 group-hover:border-gray-400'
                    }`}>
                      {req.status === 'clear' && (
                        <CheckCircle className="h-3 w-3 text-white" />
                      )}
                      {req.status === 'partial' && (
                        <AlertCircle className="h-3 w-3 text-white" />
                      )}
                      {req.status === 'missing' && (
                        <div className="w-2 h-2 bg-gray-300 rounded-full group-hover:bg-gray-400 transition-colors" />
                      )}
                    </div>
                    
                    <div className="ml-3 flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <h4 className={`text-sm font-medium truncate ${
                          req.status === 'clear' 
                            ? 'text-green-900' 
                            : req.status === 'partial'
                            ? 'text-yellow-900'
                            : 'text-gray-700'
                        }`}>
                          {req.label}
                        </h4>
                        <div className={`ml-2 px-2 py-0.5 rounded-full text-xs font-medium ${
                          req.status === 'clear'
                            ? 'bg-green-100 text-green-700'
                            : req.status === 'partial'
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}>
                          {req.status === 'clear' ? 'Done' : req.status === 'partial' ? 'Partial' : 'Pending'}
                        </div>
                      </div>
                      
                      {req.detected && (
                        <p className={`text-xs mt-1 ${
                          req.status === 'clear' 
                            ? 'text-green-600' 
                            : req.status === 'partial'
                            ? 'text-yellow-600'
                            : 'text-gray-500'
                        }`}>
                          {req.detected.length > 60 ? `${req.detected.slice(0, 60)}...` : req.detected}
                        </p>
                      )}
                    </div>
                  </div>
                  
                  {/* Progress indicator line */}
                  {index < projectState.requirements.length - 1 && (
                    <div className="absolute left-6 -bottom-2 w-0.5 h-4 bg-gray-200"></div>
                  )}
                </div>
              </div>
            ))}
          </div>
          
          {/* Overall progress bar */}
          <div className="mt-4 pt-3 border-t border-gray-100">
            <div className="flex items-center justify-between text-xs text-gray-600 mb-2">
              <span>Overall Progress</span>
              <span>
                {Math.round((projectState.requirements.filter(r => r.status === 'clear').length / projectState.requirements.length) * 100)}%
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-gradient-to-r from-blue-500 to-green-500 h-2 rounded-full transition-all duration-500"
                style={{ 
                  width: `${(projectState.requirements.filter(r => r.status === 'clear').length / projectState.requirements.length) * 100}%` 
                }}
              />
            </div>
          </div>
        </div>

        {/* Plugin Validation Error */}
        {projectState.pluginValidationError && (
          <div className="bg-white rounded-xl p-4 border border-red-200">
            <div className="flex items-center gap-3 mb-4">
              <AlertCircle className="h-5 w-5 text-red-600" />
              <h3 className="font-semibold text-gray-900">Missing Connections</h3>
            </div>
            
            <div className="space-y-3">
              <p className="text-sm text-gray-700">
                Your automation requires these services:
              </p>
              
              <div className="space-y-2">
                {projectState.missingPlugins?.map((plugin) => (
                  <div key={plugin} className="flex items-center gap-2 p-2 bg-red-50 rounded-lg">
                    <AlertCircle className="h-4 w-4 text-red-500" />
                    <span className="text-sm font-medium text-red-800 capitalize">
                      {plugin}
                    </span>
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
                  onClick={() => {
                    // Navigate to settings or show connection modal
                    if (typeof window !== 'undefined') {
                      window.open('/settings/integrations', '_blank');
                    }
                  }}
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

        {/* Current Prompt */}
        {projectState.originalPrompt && (
          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="flex items-center gap-3 mb-4">
              <MessageSquare className="h-5 w-5 text-green-600" />
              <h3 className="font-semibold text-gray-900">Original Request</h3>
            </div>
            
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-sm text-gray-700">
                {projectState.originalPrompt}
              </p>
            </div>
          </div>
        )}

        {/* Enhanced Prompt Preview - Display only */}
        {projectState.enhancedPrompt && (
          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <div className="flex items-center gap-3 mb-4">
              <Sparkles className="h-5 w-5 text-purple-600" />
              <h3 className="font-semibold text-gray-900">Enhanced Plan</h3>
            </div>
            
            <div className="bg-purple-50 rounded-lg p-3">
              <p className="text-sm text-gray-700">
                {projectState.enhancedPrompt}
              </p>
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
            {/* Step 1: Initial prompt */}
            {!projectState.originalPrompt && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                <span>Describe your automation need</span>
              </div>
            )}
            
            {/* Step 2: Answering questions */}
            {projectState.originalPrompt && projectState.currentQuestionIndex >= 0 && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></div>
                <span>Answer question {projectState.currentQuestionIndex + 1} of {projectState.questionsSequence.length}</span>
              </div>
            )}
            
            {/* Step 3: Processing/generating questions */}
            {projectState.originalPrompt && 
             projectState.currentQuestionIndex < 0 && 
             projectState.clarityScore < 80 && 
             !projectState.enhancementComplete && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></div>
                <span>Analyzing your request...</span>
              </div>
            )}
            
            {/* Step 4: Enhancement in progress */}
            {projectState.enhancementComplete && 
             !projectState.enhancedPrompt && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse"></div>
                <span>Creating enhanced plan...</span>
              </div>
            )}
            
            {/* Step 5: Review/Edit enhanced plan */}
            {projectState.enhancedPrompt && 
             !projectState.userApproved && 
             !projectState.isEditingEnhanced && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                <span>Review, edit, or approve your enhanced plan</span>
              </div>
            )}
            
            {/* Step 6: Editing enhanced plan */}
            {projectState.isEditingEnhanced && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse"></div>
                <span>Editing your enhanced plan</span>
              </div>
            )}
            
            {/* Step 7: Ready to build */}
            {projectState.userApproved && projectState.isReadyToBuild && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                <span>Ready for smart build phase</span>
              </div>
            )}
            
            {/* Fallback: Processing */}
            {isProcessing && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                <span>Processing...</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}