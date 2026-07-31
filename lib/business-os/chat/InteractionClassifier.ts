/**
 * InteractionClassifier
 *
 * Classifies user input deterministically BEFORE calling LLM.
 * This is the key optimization that allows us to skip LLM calls
 * for confirmations, choice selections, and parameter values.
 */

import type { CommandSession } from './CommandSessionRepository';

export type InteractionType =
  | { type: 'CONFIRMATION'; value: 'confirm' | 'cancel' }
  | { type: 'CHOICE_SELECTION'; choiceId: string; choiceLabel: string }
  | { type: 'PARAMETER_VALUE'; value: string }
  | { type: 'SLASH_COMMAND'; command: string; args: string }
  | { type: 'ENTITY_ID_REFERENCE'; entityId: string; fullMatch: string }
  | { type: 'CORRECTION'; field: string; value: string }
  | { type: 'NATURAL_LANGUAGE' };

// ============== PATTERNS ==============

// Confirmation patterns in multiple languages
const CONFIRM_PATTERNS = [
  // English
  /^(yes|y|ok|okay|confirm|sure|yep|yeah|yup|absolutely|definitely|go ahead|do it|proceed)$/i,
  // Hebrew
  /^(כן|אישור|בטח|אוקיי|בסדר|מאשר|מאשרת|קדימה|תעשה|תעשי|בבקשה|נכון)$/i
];

const CANCEL_PATTERNS = [
  // English
  /^(no|n|cancel|stop|nevermind|never mind|abort|quit|exit|forget it|nope|nah)$/i,
  // Hebrew
  /^(לא|ביטול|עזוב|תשכח|בטל|עצור|תעצור|לא רוצה|חזור|אל תעשה)$/i
];

// Entity ID pattern: [ID: uuid] or standalone UUID
const ENTITY_ID_PATTERN = /\[ID:\s*([a-f0-9-]{36})\]/i;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

// Slash command pattern: /command args
const SLASH_PATTERN = /^\/(\w+)(?:\s+(.*))?$/;

// Numeric selection pattern: "1", "2", "3", etc.
const NUMERIC_SELECTION_PATTERN = /^(\d+)$/;

// Short value pattern - likely a parameter value, not a new command
// Max 100 chars, doesn't look like a sentence
const SHORT_VALUE_PATTERN = /^[^.!?]{1,100}$/;

// New command indicators - words that likely start a new command
const NEW_COMMAND_PATTERNS = [
  // English action verbs
  /^(create|add|make|new|delete|remove|show|list|find|get|update|change|edit|modify|send|schedule|book|cancel|complete|finish|mark|set|open|view)/i,
  // Hebrew action verbs
  /^(צור|הוסף|מחק|הצג|שנה|עדכן|שלח|קבע|בטל|סיים|סמן|פתח|הראה|תן|עשה|בדוק)/i
];

// Correction patterns - user is correcting a value
const CORRECTION_PATTERNS = [
  // English
  /^(actually|no,?\s*|wait,?\s*|change\s+(?:the\s+)?(\w+)\s+to\s+(.+)|(?:the\s+)?(\w+)\s+(?:should be|is)\s+(.+))/i,
  // Hebrew
  /^(לא,?\s*|רגע,?\s*|שנה\s+(?:את\s+)?(?:ה)?(\w+)\s+ל(.+)|(?:ה)?(\w+)\s+(?:צריך להיות|הוא)\s+(.+))/i
];

// ============== MAIN CLASSIFIER ==============

export interface ClassifierContext {
  session: CommandSession | null;
  pendingChoices?: Array<{ id: string; label: string }>;
  activeEntityType?: string;
}

export function classifyInteraction(
  input: string,
  context: ClassifierContext
): InteractionType {
  const trimmed = input.trim();
  const { session, pendingChoices } = context;

  // 1. Empty input - treat as natural language
  if (!trimmed) {
    return { type: 'NATURAL_LANGUAGE' };
  }

  // 2. Check for slash commands (always takes priority)
  const slashResult = matchSlashCommand(trimmed);
  if (slashResult) {
    return slashResult;
  }

  // 3. Check for explicit entity ID reference
  const entityIdResult = matchEntityId(trimmed);
  if (entityIdResult) {
    return entityIdResult;
  }

  // 4. Check for confirmation/cancellation when awaiting
  if (session?.status === 'awaiting_confirmation') {
    const confirmResult = matchConfirmation(trimmed);
    if (confirmResult) {
      return confirmResult;
    }

    // Check for correction while awaiting confirmation
    const correctionResult = matchCorrection(trimmed);
    if (correctionResult) {
      return correctionResult;
    }
  }

  // 5. Check for choice selection when awaiting choice
  if (session?.status === 'awaiting_choice' && pendingChoices && pendingChoices.length > 0) {
    const choiceResult = matchChoiceSelection(trimmed, pendingChoices);
    if (choiceResult) {
      return choiceResult;
    }
  }

  // 6. Check for parameter value when gathering params
  if (session?.status === 'gathering_params') {
    // If it looks like a new command, let LLM handle it
    if (looksLikeNewCommand(trimmed)) {
      return { type: 'NATURAL_LANGUAGE' };
    }

    // Short input is likely a parameter value
    if (SHORT_VALUE_PATTERN.test(trimmed)) {
      return { type: 'PARAMETER_VALUE', value: trimmed };
    }
  }

  // 7. Default: needs LLM interpretation
  return { type: 'NATURAL_LANGUAGE' };
}

// ============== MATCHERS ==============

function matchSlashCommand(input: string): InteractionType | null {
  const match = SLASH_PATTERN.exec(input);
  if (match) {
    return {
      type: 'SLASH_COMMAND',
      command: match[1].toLowerCase(),
      args: (match[2] || '').trim()
    };
  }
  return null;
}

function matchEntityId(input: string): InteractionType | null {
  // Check for [ID: uuid] format
  const bracketMatch = ENTITY_ID_PATTERN.exec(input);
  if (bracketMatch) {
    return {
      type: 'ENTITY_ID_REFERENCE',
      entityId: bracketMatch[1],
      fullMatch: bracketMatch[0]
    };
  }

  // Check for standalone UUID
  if (UUID_PATTERN.test(input.trim())) {
    return {
      type: 'ENTITY_ID_REFERENCE',
      entityId: input.trim(),
      fullMatch: input.trim()
    };
  }

  return null;
}

function matchConfirmation(input: string): InteractionType | null {
  // Check confirm patterns
  for (const pattern of CONFIRM_PATTERNS) {
    if (pattern.test(input)) {
      return { type: 'CONFIRMATION', value: 'confirm' };
    }
  }

  // Check cancel patterns
  for (const pattern of CANCEL_PATTERNS) {
    if (pattern.test(input)) {
      return { type: 'CONFIRMATION', value: 'cancel' };
    }
  }

  return null;
}

function matchChoiceSelection(
  input: string,
  choices: Array<{ id: string; label: string }>
): InteractionType | null {
  const inputLower = input.toLowerCase().trim();

  // 1. Direct ID match
  const idMatch = choices.find(c => c.id === input.trim());
  if (idMatch) {
    return {
      type: 'CHOICE_SELECTION',
      choiceId: idMatch.id,
      choiceLabel: idMatch.label
    };
  }

  // 2. Exact label match (case-insensitive)
  const labelMatch = choices.find(c =>
    c.label.toLowerCase() === inputLower
  );
  if (labelMatch) {
    return {
      type: 'CHOICE_SELECTION',
      choiceId: labelMatch.id,
      choiceLabel: labelMatch.label
    };
  }

  // 3. Numeric selection (1, 2, 3...)
  const numMatch = NUMERIC_SELECTION_PATTERN.exec(input);
  if (numMatch) {
    const index = parseInt(numMatch[1], 10) - 1; // 1-based to 0-based
    if (index >= 0 && index < choices.length) {
      return {
        type: 'CHOICE_SELECTION',
        choiceId: choices[index].id,
        choiceLabel: choices[index].label
      };
    }
  }

  // 4. Partial label match (if unambiguous)
  const partialMatches = choices.filter(c =>
    c.label.toLowerCase().includes(inputLower) ||
    inputLower.includes(c.label.toLowerCase())
  );
  if (partialMatches.length === 1) {
    return {
      type: 'CHOICE_SELECTION',
      choiceId: partialMatches[0].id,
      choiceLabel: partialMatches[0].label
    };
  }

  return null;
}

function matchCorrection(input: string): InteractionType | null {
  for (const pattern of CORRECTION_PATTERNS) {
    const match = pattern.exec(input);
    if (match) {
      // Extract field and value from the match
      const field = match[2] || match[4] || '';
      const value = match[3] || match[5] || '';
      if (field && value) {
        return {
          type: 'CORRECTION',
          field: field.toLowerCase(),
          value: value.trim()
        };
      }
    }
  }
  return null;
}

function looksLikeNewCommand(input: string): boolean {
  for (const pattern of NEW_COMMAND_PATTERNS) {
    if (pattern.test(input)) {
      return true;
    }
  }
  return false;
}

// ============== UTILITIES ==============

/**
 * Get confidence score for classification (0-1)
 * Useful for hybrid approaches where low confidence falls back to LLM
 */
export function getClassificationConfidence(
  input: string,
  result: InteractionType
): number {
  switch (result.type) {
    case 'SLASH_COMMAND':
      return 1.0; // Slash commands are unambiguous

    case 'ENTITY_ID_REFERENCE':
      return 1.0; // UUID patterns are unambiguous

    case 'CONFIRMATION':
      // Exact matches are high confidence
      return 0.95;

    case 'CHOICE_SELECTION':
      // Exact matches are high confidence
      return 0.9;

    case 'PARAMETER_VALUE':
      // Medium confidence - could be wrong
      return 0.7;

    case 'CORRECTION':
      // Medium confidence - pattern might mismatch
      return 0.75;

    case 'NATURAL_LANGUAGE':
    default:
      return 0.0; // No classification made
  }
}

/**
 * Check if input might be ambiguous and should use LLM
 */
export function isAmbiguous(input: string, context: ClassifierContext): boolean {
  const result = classifyInteraction(input, context);
  const confidence = getClassificationConfidence(input, result);

  // If we couldn't classify or low confidence, it's ambiguous
  if (result.type === 'NATURAL_LANGUAGE' || confidence < 0.7) {
    return true;
  }

  // Parameter values can be ambiguous
  if (result.type === 'PARAMETER_VALUE' && input.split(' ').length > 5) {
    return true; // Long input might be a new command
  }

  return false;
}

/**
 * Extract all entity IDs from a message
 */
export function extractEntityIds(input: string): string[] {
  const ids: string[] = [];

  // Find all [ID: uuid] patterns
  const bracketPattern = /\[ID:\s*([a-f0-9-]{36})\]/gi;
  let match;
  while ((match = bracketPattern.exec(input)) !== null) {
    ids.push(match[1]);
  }

  return ids;
}

/**
 * Clean input by removing entity ID annotations
 */
export function cleanInput(input: string): string {
  return input
    .replace(/\[ID:\s*[a-f0-9-]{36}\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}
