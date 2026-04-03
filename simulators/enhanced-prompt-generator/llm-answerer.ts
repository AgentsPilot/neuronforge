/**
 * LLM-based answerer for Phase 2 clarification questions.
 *
 * Uses the ProviderFactory to generate contextually appropriate answers
 * for each question, respecting question types (text, select, multi_select)
 * and applying clarification_overrides where they match.
 */

import { ProviderFactory } from '@/lib/ai/providerFactory';
import type { ProviderName } from '@/lib/ai/providerFactory';
import type { SimulatorLogger } from '@/simulators/shared/types';
import type { ClarificationQuestion, ClarificationAnswer } from './types';

/**
 * Generate answers for a list of clarification questions using an LLM.
 *
 * @param originalPrompt - The user's original natural-language prompt
 * @param questions - Structured questions from Phase 2's questionsSequence
 * @param overrides - Optional map of partial question text to predetermined answers
 * @param providerName - LLM provider to use
 * @param modelName - LLM model to use (empty string means use provider default)
 * @param logger - Simulator logger instance
 */
export async function generateAnswers(
  originalPrompt: string,
  questions: ClarificationQuestion[],
  overrides: Record<string, string> | undefined,
  providerName: string,
  modelName: string,
  logger: SimulatorLogger,
): Promise<Record<string, ClarificationAnswer>> {
  const answers: Record<string, ClarificationAnswer> = {};

  if (questions.length === 0) {
    logger.info('No clarification questions to answer');
    return answers;
  }

  logger.info(`Generating answers for ${questions.length} questions`, {
    provider: providerName,
    model: modelName || '(provider default)',
    overrideCount: overrides ? Object.keys(overrides).length : 0,
  });

  for (const question of questions) {
    // Check if any override key partially matches this question's text
    const overrideAnswer = findOverride(question.question, overrides);

    if (overrideAnswer !== null) {
      logger.info(`Using override for question "${question.id}": "${question.question.substring(0, 60)}..."`);
      answers[question.id] = formatAnswer(question, overrideAnswer);
      continue;
    }

    // Generate answer via LLM
    const answer = await generateSingleAnswer(
      originalPrompt,
      question,
      providerName,
      modelName,
      logger,
    );
    answers[question.id] = answer;
  }

  return answers;
}

/**
 * Check if any override key is a substring of the question text (case-insensitive).
 */
function findOverride(
  questionText: string,
  overrides: Record<string, string> | undefined,
): string | null {
  if (!overrides) return null;

  const lowerQuestion = questionText.toLowerCase();
  for (const [key, value] of Object.entries(overrides)) {
    if (lowerQuestion.includes(key.toLowerCase())) {
      return value;
    }
  }
  return null;
}

/**
 * Format an override string into the correct answer type for the question.
 * For select/multi_select, the override value should match an option value.
 */
function formatAnswer(question: ClarificationQuestion, rawAnswer: string): ClarificationAnswer {
  if (question.type === 'select' && question.options) {
    // Try to match the override to an available option
    const matchedOption = question.options.find(
      (opt) => opt.value.toLowerCase() === rawAnswer.toLowerCase()
        || opt.label.toLowerCase() === rawAnswer.toLowerCase()
    );
    const selected = matchedOption ? matchedOption.value : rawAnswer;
    return { answerType: 'select', mode: 'selected', selected };
  }

  if (question.type === 'multi_select' && question.options) {
    // Split on comma for multi-select overrides
    const selections = rawAnswer.split(',').map((s) => s.trim());
    const matched = selections.map((sel) => {
      const opt = question.options!.find(
        (o) => o.value.toLowerCase() === sel.toLowerCase()
          || o.label.toLowerCase() === sel.toLowerCase()
      );
      return opt ? opt.value : sel;
    });
    return { answerType: 'multi_select', mode: 'selected', selected: matched };
  }

  // Plain text answer
  return rawAnswer;
}

/**
 * Generate a single answer for one clarification question using the LLM.
 */
async function generateSingleAnswer(
  originalPrompt: string,
  question: ClarificationQuestion,
  providerName: string,
  modelName: string,
  logger: SimulatorLogger,
): Promise<ClarificationAnswer> {
  const provider = ProviderFactory.getProvider(providerName as ProviderName);
  const model = modelName || provider.defaultModel;

  // Build a prompt appropriate for the question type
  let systemContent: string;
  if (question.type === 'select' && question.options) {
    const optionsList = question.options.map((o) => `- "${o.value}": ${o.label}`).join('\n');
    systemContent = [
      'You are a helpful assistant answering clarification questions for an automation setup.',
      'The user originally asked: "' + originalPrompt + '"',
      '',
      'You must answer the following question by choosing ONE of the available options.',
      'Respond with ONLY a JSON object in the format: { "selected": "<option_value>" }',
      'Choose the option that best aligns with the user\'s original intent.',
      '',
      'Available options:',
      optionsList,
    ].join('\n');
  } else if (question.type === 'multi_select' && question.options) {
    const optionsList = question.options.map((o) => `- "${o.value}": ${o.label}`).join('\n');
    systemContent = [
      'You are a helpful assistant answering clarification questions for an automation setup.',
      'The user originally asked: "' + originalPrompt + '"',
      '',
      'You must answer the following question by choosing one or more of the available options.',
      'Respond with ONLY a JSON object in the format: { "selected": ["<option1>", "<option2>"] }',
      'Choose the options that best align with the user\'s original intent.',
      '',
      'Available options:',
      optionsList,
    ].join('\n');
  } else {
    systemContent = [
      'You are a helpful assistant answering clarification questions for an automation setup.',
      'The user originally asked: "' + originalPrompt + '"',
      '',
      'Answer the following question concisely (1-2 sentences) in a way that is consistent',
      'with the user\'s original intent. Respond with ONLY a JSON object in the format:',
      '{ "answer": "<your answer>" }',
    ].join('\n');
  }

  const messages = [
    { role: 'system' as const, content: systemContent },
    { role: 'user' as const, content: question.question },
  ];

  logger.debug(`Asking LLM for question "${question.id}" (type: ${question.type})`);

  const completionParams: Record<string, unknown> = {
    model,
    messages,
    temperature: 0.3,
    max_tokens: 256,
  };

  if (provider.supportsResponseFormat) {
    completionParams.response_format = { type: 'json_object' };
  }

  const completion = await provider.chatCompletion(
    completionParams,
    {
      userId: 'simulator',
      feature: 'simulator',
      component: 'llm-answerer',
      category: 'simulator',
      activity_type: 'simulator',
      activity_name: 'Generate clarification answer',
    },
  );

  const text = completion.choices?.[0]?.message?.content || '';

  try {
    const parsed = JSON.parse(text);

    if (question.type === 'select') {
      const selected = parsed.selected || parsed.answer || '';
      logger.debug(`Answer for "${question.id}": select -> "${selected}"`);
      return { answerType: 'select', mode: 'selected', selected };
    }

    if (question.type === 'multi_select') {
      const selected = Array.isArray(parsed.selected) ? parsed.selected : [parsed.answer || ''];
      logger.debug(`Answer for "${question.id}": multi_select -> ${JSON.stringify(selected)}`);
      return { answerType: 'multi_select', mode: 'selected', selected };
    }

    // text type
    const answer = parsed.answer || text;
    logger.debug(`Answer for "${question.id}": text -> "${answer}"`);
    return answer;
  } catch {
    // If JSON parsing fails, use the raw text as a plain string answer
    logger.warn(`Failed to parse LLM response as JSON for question "${question.id}", using raw text`);
    return text.trim();
  }
}
