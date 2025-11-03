/**
 * Confidence Score Calculator
 *
 * Calculates user understanding confidence score (0-100%) based on:
 * - Initial clarity analysis (45% base)
 * - Plugin connections (+10% each)
 * - Questions answered (+10% each)
 * - Enhanced prompt reviewed (+5%)
 * - Final acceptance (100%)
 */

import { ConversationalFlowState } from '../types';

export function calculateConfidence(state: ConversationalFlowState): number {
  // Base score from initial analysis
  let score = 45;

  // Plugins connected (+10% each, up to 20% total)
  const totalPluginsNeeded = state.missingPlugins.length + state.connectedPlugins.length;
  const pluginsConnected = state.connectedPlugins.length;
  if (totalPluginsNeeded > 0) {
    const pluginScore = (pluginsConnected / totalPluginsNeeded) * 20;
    score += pluginScore;
  }

  // Questions answered (+10% average each, up to 30% total)
  const questionsAnswered = Object.keys(state.clarificationAnswers).length;
  const totalQuestions = state.questionsSequence.length;
  if (totalQuestions > 0) {
    const questionScore = (questionsAnswered / totalQuestions) * 30;
    score += questionScore;
  }

  // Enhanced prompt reviewed (+5%)
  if (state.currentStage === 'review' && state.enhancedPrompt) {
    score += 5;
  }

  // Accepted → 100%
  if (state.currentStage === 'accepted') {
    return 100;
  }

  // Cap at 100 and round
  return Math.min(Math.round(score), 100);
}

export function getConfidenceColor(score: number): string {
  if (score < 50) return 'text-red-600';
  if (score < 70) return 'text-yellow-600';
  if (score < 90) return 'text-blue-600';
  return 'text-green-600';
}

export function getConfidenceGradient(score: number): string {
  if (score < 50) return 'from-red-500 via-orange-500 to-red-600';
  if (score < 70) return 'from-yellow-500 via-orange-500 to-yellow-600';
  if (score < 90) return 'from-blue-500 via-indigo-500 to-blue-600';
  return 'from-purple-500 via-pink-500 to-purple-600';
}
