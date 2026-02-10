import { useState, useCallback } from 'react';
import type {
  ClarificationAnswer,
  StructuredSelectAnswer,
  StructuredMultiSelectAnswer,
  ClarificationOption
} from '@/components/agent-creation/types/agent-prompt-threads';

// Simplified types for V2 agent builder
export interface RequirementItem {
  id: string;
  label: string;
  status: 'missing' | 'partial' | 'clear';
  detected?: string;
}

// V14: Updated to support hybrid question types
export interface ClarificationQuestion {
  id: string;
  question: string;
  dimension: string;
  theme?: string; // V14: theme for grouping
  type: 'select' | 'multi_select' | 'text' | 'email' | 'number'; // V14: strict typing
  options?: ClarificationOption[];
  placeholder?: string;
  required?: boolean;
  allowCustom?: boolean;
}

// Re-export for convenience
export type { ClarificationAnswer, StructuredSelectAnswer, StructuredMultiSelectAnswer };

/**
 * V14: Helper to check if an answer is valid (works with string or structured)
 */
function isAnswerValid(answer: ClarificationAnswer | undefined): boolean {
  if (!answer) return false;

  // Plain string (text questions)
  if (typeof answer === 'string') {
    return answer.trim().length > 0;
  }

  // Structured answer (select/multi_select)
  if (answer.mode === 'selected') {
    if (answer.answerType === 'select') {
      return !!answer.selected;
    }
    if (answer.answerType === 'multi_select') {
      return Array.isArray(answer.selected) && answer.selected.length > 0;
    }
  }

  if (answer.mode === 'custom') {
    return !!answer.custom?.trim();
  }

  return false;
}

export interface AgentBuilderState {
  // Core prompt data
  originalPrompt: string;
  enhancedPrompt: string;

  // Requirements tracking (for middle panel)
  requirements: RequirementItem[];

  // Clarity and phase tracking
  clarityScore: number;
  workflowPhase: 'initial' | 'analysis' | 'questions' | 'enhancement' | 'approval' | 'completed';

  // Questions state
  questionsSequence: ClarificationQuestion[];
  currentQuestionIndex: number;
  clarificationAnswers: Record<string, ClarificationAnswer>; // V14: supports structured answers
  questionsWithVisibleOptions: Set<string>;

  // V14: Multi-select tracking
  selectedMultiOptions: string[]; // Tracks checkbox selections for current multi_select question

  // Custom input state (V14: "Other" button toggle)
  showingCustomInput: boolean;
  customInputValue: string;
  customInputQuestionId: string | null;

  // Processing flags
  isProcessingQuestion: boolean;
  enhancementComplete: boolean;
  conversationCompleted: boolean;
  planApproved: boolean;

  // Editing state
  isEditingEnhanced: boolean;
  editedEnhancedPrompt: string;

  // Plugin data
  connectedPlugins: string[];
  missingPlugins: string[];

  // Agent preview data
  agentName: string;
  agentDescription: string;
  detectedSchedule: string;
}

/**
 * Hook to manage agent builder state
 * Simplified version of useProjectState for V2 UI
 */
export function useAgentBuilderState() {
  const [state, setState] = useState<AgentBuilderState>({
    originalPrompt: '',
    enhancedPrompt: '',
    requirements: [
      { id: 'data', label: 'Data Source', status: 'missing' },
      { id: 'processing', label: 'Processing Steps', status: 'missing' },
      { id: 'output', label: 'Output Format', status: 'missing' },
      { id: 'delivery', label: 'Delivery Method', status: 'missing' },
    ],
    clarityScore: 0,
    workflowPhase: 'initial',
    questionsSequence: [],
    currentQuestionIndex: -1,
    clarificationAnswers: {},
    questionsWithVisibleOptions: new Set(),
    selectedMultiOptions: [], // V14: multi-select tracking
    showingCustomInput: false,
    customInputValue: '',
    customInputQuestionId: null,
    isProcessingQuestion: false,
    enhancementComplete: false,
    conversationCompleted: false,
    planApproved: false,
    isEditingEnhanced: false,
    editedEnhancedPrompt: '',
    connectedPlugins: [],
    missingPlugins: [],
    agentName: '',
    agentDescription: '',
    detectedSchedule: 'Manual'
  });

  // Update requirements from Phase 1 analysis
  const updateRequirementsFromAnalysis = useCallback((analysis: any) => {
    setState(prev => {
      const updatedRequirements = prev.requirements.map(req => {
        // Extract relevant data from analysis
        if (req.id === 'data' && analysis.entities_detected?.length > 0) {
          return { ...req, status: 'partial' as const, detected: analysis.entities_detected.join(', ') };
        }
        if (req.id === 'processing' && analysis.operations_detected?.length > 0) {
          return { ...req, status: 'partial' as const, detected: analysis.operations_detected.join(', ') };
        }
        if (req.id === 'output' && analysis.output_format) {
          return { ...req, status: 'clear' as const, detected: analysis.output_format };
        }
        if (req.id === 'delivery' && analysis.delivery_method) {
          return { ...req, status: 'clear' as const, detected: analysis.delivery_method };
        }
        return req;
      });

      return { ...prev, requirements: updatedRequirements };
    });
  }, []);

  // Update requirements from clarification answers
  const updateRequirementsFromAnswers = useCallback((answers: Record<string, string>) => {
    setState(prev => {
      const updatedRequirements = prev.requirements.map(req => {
        // Mark as clear if user provided answer for this dimension
        const hasAnswer = Object.keys(answers).some(questionId => {
          const question = prev.questionsSequence.find(q => q.id === questionId);
          return question?.dimension?.toLowerCase() === req.id;
        });

        if (hasAnswer) {
          return { ...req, status: 'clear' as const };
        }
        return req;
      });

      return { ...prev, requirements: updatedRequirements };
    });
  }, []);

  // Set questions from Phase 2 response
  const setQuestionsSequence = useCallback((questions: ClarificationQuestion[]) => {
    setState(prev => {
      const firstId = questions[0]?.id;
      const initialVisible = new Set<string>();
      if (firstId) initialVisible.add(firstId);

      return {
        ...prev,
        questionsSequence: questions,
        currentQuestionIndex: 0,
        questionsWithVisibleOptions: initialVisible,
        workflowPhase: 'questions'
      };
    });
  }, []);

  // Move to next question
  const proceedToNextQuestion = useCallback(() => {
    setState(prev => {
      // Find next unanswered question (V14: use helper for structured answers)
      const nextUnansweredIndex = prev.questionsSequence.findIndex((q, idx) => {
        const isAfterCurrent = idx > prev.currentQuestionIndex;
        const isAnswered = isAnswerValid(prev.clarificationAnswers[q.id]);
        return isAfterCurrent && !isAnswered;
      });

      if (nextUnansweredIndex >= 0) {
        const nextId = prev.questionsSequence[nextUnansweredIndex].id;
        const newVisible = new Set(prev.questionsWithVisibleOptions);
        newVisible.add(nextId);

        return {
          ...prev,
          currentQuestionIndex: nextUnansweredIndex,
          isProcessingQuestion: false,
          questionsWithVisibleOptions: newVisible,
          selectedMultiOptions: [] // V14: reset multi-select for new question
        };
      }

      // Check for any remaining unanswered questions (V14: use helper)
      const unanswered = prev.questionsSequence.filter(
        q => !isAnswerValid(prev.clarificationAnswers[q.id])
      );

      if (unanswered.length > 0) {
        const firstIdx = prev.questionsSequence.findIndex(q => q.id === unanswered[0].id);
        const newVisible = new Set(prev.questionsWithVisibleOptions);
        newVisible.add(unanswered[0].id);

        return {
          ...prev,
          currentQuestionIndex: firstIdx,
          isProcessingQuestion: false,
          questionsWithVisibleOptions: newVisible,
          selectedMultiOptions: [] // V14: reset multi-select
        };
      }

      // All questions answered - ready for enhancement
      console.log('✅ All questions answered - ready for enhancement');
      return {
        ...prev,
        currentQuestionIndex: -1,
        isProcessingQuestion: false,
        workflowPhase: 'enhancement',
        selectedMultiOptions: [] // V14: reset multi-select
      };
    });
  }, []);

  // Answer a question (V14: supports both string and structured answers)
  const answerQuestion = useCallback((questionId: string, answer: ClarificationAnswer) => {
    setState(prev => ({
      ...prev,
      clarificationAnswers: {
        ...prev.clarificationAnswers,
        [questionId]: answer
      },
      isProcessingQuestion: true,
      selectedMultiOptions: [], // Reset multi-select after answering
      showingCustomInput: false // Reset custom input
    }));

    // Auto-proceed after a delay
    setTimeout(() => {
      setState(prev => ({ ...prev, isProcessingQuestion: false }));
      setTimeout(() => proceedToNextQuestion(), 200);
    }, 300);
  }, [proceedToNextQuestion]);

  // V14: Answer with structured select answer (single option click)
  const answerSelectOption = useCallback((questionId: string, value: string) => {
    const answer: StructuredSelectAnswer = {
      answerType: 'select',
      mode: 'selected',
      selected: value
    };
    answerQuestion(questionId, answer);
  }, [answerQuestion]);

  // V14: Toggle multi-select option (checkbox behavior)
  const toggleMultiSelectOption = useCallback((value: string) => {
    setState(prev => {
      const current = prev.selectedMultiOptions;
      const newSelected = current.includes(value)
        ? current.filter(v => v !== value)
        : [...current, value];
      return { ...prev, selectedMultiOptions: newSelected };
    });
  }, []);

  // V14: Submit multi-select answer
  const submitMultiSelectAnswer = useCallback((questionId: string) => {
    setState(prev => {
      if (prev.selectedMultiOptions.length === 0) return prev;

      const answer: StructuredMultiSelectAnswer = {
        answerType: 'multi_select',
        mode: 'selected',
        selected: [...prev.selectedMultiOptions]
      };

      return {
        ...prev,
        clarificationAnswers: {
          ...prev.clarificationAnswers,
          [questionId]: answer
        },
        isProcessingQuestion: true,
        selectedMultiOptions: [],
        showingCustomInput: false
      };
    });

    // Auto-proceed after a delay
    setTimeout(() => {
      setState(prev => ({ ...prev, isProcessingQuestion: false }));
      setTimeout(() => proceedToNextQuestion(), 200);
    }, 300);
  }, [proceedToNextQuestion]);

  // Set custom input mode
  const openCustomInput = useCallback((questionId: string) => {
    setState(prev => ({
      ...prev,
      showingCustomInput: true,
      customInputQuestionId: questionId,
      customInputValue: ''
    }));
  }, []);

  // Update custom input value
  const updateCustomInput = useCallback((value: string) => {
    setState(prev => ({ ...prev, customInputValue: value }));
  }, []);

  // Submit custom answer (V14: creates structured answer for select/multi_select, plain string for text)
  const submitCustomAnswer = useCallback(() => {
    setState(prev => {
      const questionId = prev.customInputQuestionId;
      if (!questionId || !prev.customInputValue.trim()) return prev;

      // Find the question to determine type
      const question = prev.questionsSequence.find(q => q.id === questionId);
      const customText = prev.customInputValue.trim();

      // V14: Create appropriate answer format based on question type
      let answer: ClarificationAnswer;
      if (question?.type === 'select') {
        answer = {
          answerType: 'select',
          mode: 'custom',
          custom: customText
        } as StructuredSelectAnswer;
      } else if (question?.type === 'multi_select') {
        answer = {
          answerType: 'multi_select',
          mode: 'custom',
          custom: customText
        } as StructuredMultiSelectAnswer;
      } else {
        // Plain text for text/email/number questions
        answer = customText;
      }

      return {
        ...prev,
        clarificationAnswers: {
          ...prev.clarificationAnswers,
          [questionId]: answer
        },
        showingCustomInput: false,
        customInputQuestionId: null,
        customInputValue: '',
        isProcessingQuestion: true,
        selectedMultiOptions: [] // Reset multi-select
      };
    });

    // Auto-proceed
    setTimeout(() => {
      setState(prev => ({ ...prev, isProcessingQuestion: false }));
      setTimeout(() => proceedToNextQuestion(), 200);
    }, 300);
  }, [proceedToNextQuestion]);

  // Change an answer
  const changeAnswer = useCallback((questionId: string) => {
    setState(prev => {
      const newAnswers = { ...prev.clarificationAnswers };
      delete newAnswers[questionId];

      const newVisible = new Set(prev.questionsWithVisibleOptions);
      newVisible.add(questionId);

      return {
        ...prev,
        clarificationAnswers: newAnswers,
        questionsWithVisibleOptions: newVisible,
        showingCustomInput: false,
        customInputQuestionId: null,
        customInputValue: '',
        selectedMultiOptions: [] // V14: reset multi-select
      };
    });
  }, []);

  // Set enhancement result
  const setEnhancement = useCallback((enhancedPrompt: string) => {
    setState(prev => ({
      ...prev,
      enhancedPrompt,
      enhancementComplete: true,
      conversationCompleted: true,
      workflowPhase: 'approval'
    }));
  }, []);

  // Edit enhanced prompt
  const startEditingEnhanced = useCallback(() => {
    setState(prev => ({
      ...prev,
      isEditingEnhanced: true,
      editedEnhancedPrompt: prev.enhancedPrompt
    }));
  }, []);

  const updateEditedEnhanced = useCallback((value: string) => {
    setState(prev => ({ ...prev, editedEnhancedPrompt: value }));
  }, []);

  const saveEditedEnhanced = useCallback(() => {
    setState(prev => ({
      ...prev,
      enhancedPrompt: prev.editedEnhancedPrompt.trim(),
      isEditingEnhanced: false
    }));
  }, []);

  const cancelEditedEnhanced = useCallback(() => {
    setState(prev => ({
      ...prev,
      isEditingEnhanced: false,
      editedEnhancedPrompt: ''
    }));
  }, []);

  // V10: Reset state for mini-cycle or edit flow refinement
  // This allows Phase 3 to be re-triggered after questions are answered
  const resetForRefinement = useCallback(() => {
    setState(prev => ({
      ...prev,
      enhancementComplete: false,  // Allow useEffect to trigger Phase 3 again
      // Keep workflowPhase as 'approval' during edit - will change to 'questions' if needed
      // Clear old mini-cycle questions to avoid conflicts
      questionsSequence: [],
      currentQuestionIndex: -1,
      // Don't clear clarificationAnswers - we want to keep previous answers
    }));
  }, []);

  // Approve plan
  const approvePlan = useCallback(() => {
    setState(prev => ({
      ...prev,
      planApproved: true,
      workflowPhase: 'completed'
    }));
  }, []);

  // Update agent preview data
  const updateAgentPreview = useCallback((data: { name?: string; description?: string; schedule?: string }) => {
    setState(prev => ({
      ...prev,
      agentName: data.name || prev.agentName,
      agentDescription: data.description || prev.agentDescription,
      detectedSchedule: data.schedule || prev.detectedSchedule
    }));
  }, []);

  return {
    state,
    setState,
    updateRequirementsFromAnalysis,
    updateRequirementsFromAnswers,
    setQuestionsSequence,
    proceedToNextQuestion,
    answerQuestion,
    answerSelectOption,       // V14: single-select option click
    toggleMultiSelectOption,  // V14: multi-select checkbox toggle
    submitMultiSelectAnswer,  // V14: submit multi-select selections
    openCustomInput,
    updateCustomInput,
    submitCustomAnswer,
    changeAnswer,
    setEnhancement,
    startEditingEnhanced,
    updateEditedEnhanced,
    saveEditedEnhanced,
    cancelEditedEnhanced,
    resetForRefinement,  // V10: Reset state for mini-cycle/edit flow
    approvePlan,
    updateAgentPreview
  };
}
