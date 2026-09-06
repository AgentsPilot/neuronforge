/**
 * Interaction Classifier Tests
 *
 * Tests the deterministic classification of user input based on session state.
 * Ensures confirmations, cancellations, choices, and parameter values are
 * correctly identified in Hebrew, English, and Spanish.
 *
 * Usage: npx tsx scripts/test-interaction-classifier.ts
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config({ path: '.env.local' });

// ==================== COLORS ====================

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

// ==================== INLINE CLASSIFIER IMPLEMENTATION ====================

// Confirmation patterns in multiple languages (EN, HE, ES)
const CONFIRM_PATTERNS =
  /^(yes|y|כן|אישור|ok|okay|confirm|sure|בטח|אוקיי|בסדר|מאשר|sí|si|vale|confirmar|claro|de acuerdo)$/i;

const CANCEL_PATTERNS =
  /^(no|n|לא|ביטול|cancel|נגמר|עזוב|תשכח|cancelar|no quiero|anular)$/i;

// Entity ID pattern: [ID: uuid] or just a UUID
const ENTITY_ID_PATTERN = /\[ID:\s*([a-f0-9-]{36})\]/i;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

// Slash command pattern
const SLASH_PATTERN = /^\/(\w+)(?:\s+(.*))?$/;

// =============================================================================
// CAPABILITY TRIGGER PHRASES (from CapabilityRegistry)
// In the real implementation, these are loaded from CAPABILITY_REGISTRY
// Here we include a subset for testing
// =============================================================================

const CAPABILITY_TRIGGER_PHRASES: Map<string, string> = new Map([
  // English examples
  ['send email', 'email.send'],
  ['email john', 'email.send'],
  ['compose email to client', 'email.send'],
  ['create task', 'task.create'],
  ['add task', 'task.create'],
  ['new task', 'task.create'],
  ['create reminder', 'task.create'],
  ['add contact', 'contact.create'],
  ['create contact', 'contact.create'],
  ['add client', 'contact.create'],
  ['schedule appointment', 'booking.create'],
  ['book appointment', 'booking.create'],
  ['send invoice', 'invoice.send'],
  ['show contacts', 'contact.list'],
  ['list clients', 'contact.list'],
  // Hebrew examples
  ['שלח מייל', 'email.send'],
  ['שלח אימייל', 'email.send'],
  ['שליחת אימייל', 'email.send'],
  ['שליחת מייל', 'email.send'],
  ['צור משימה', 'task.create'],
  ['פתח משימה', 'task.create'],
  ['הוסף משימה', 'task.create'],
  ['הוסף לקוח', 'contact.create'],
  ['צור לקוח', 'contact.create'],
  ['קבע פגישה', 'booking.create'],
  ['הזמן פגישה', 'booking.create'],
  ['הצג לקוחות', 'contact.list'],
  ['מחק משימה', 'task.delete'],
  ['שלח חשבונית', 'invoice.send'],
]);

/**
 * Check if input matches any capability trigger phrase
 */
function matchCapabilityTrigger(input: string): string | null {
  const normalized = input.toLowerCase().trim().replace(/\s+/g, ' ');

  // Exact match
  if (CAPABILITY_TRIGGER_PHRASES.has(normalized)) {
    return CAPABILITY_TRIGGER_PHRASES.get(normalized)!;
  }

  // Check if input starts with any trigger phrase
  for (const [trigger, capabilityId] of CAPABILITY_TRIGGER_PHRASES) {
    if (normalized.startsWith(trigger)) {
      return capabilityId;
    }
  }

  // Check prefix match (trigger starts with input)
  for (const [trigger, capabilityId] of CAPABILITY_TRIGGER_PHRASES) {
    if (trigger.startsWith(normalized) && normalized.length >= 4) {
      return capabilityId;
    }
  }

  return null;
}

type SessionStatus = 'gathering_params' | 'awaiting_confirmation' | 'awaiting_choice' | 'executing' | 'completed';

interface MockSession {
  status: SessionStatus;
  pending_choices?: Array<{ id: string; label: string }>;
  pending_params?: string[];
}

type InteractionType =
  | { type: 'CONFIRMATION'; value: 'confirm' | 'cancel' }
  | { type: 'CHOICE_SELECTION'; choiceId: string }
  | { type: 'PARAMETER_VALUE'; value: string }
  | { type: 'SLASH_COMMAND'; command: string; args: string }
  | { type: 'ENTITY_ID_REFERENCE'; entityId: string }
  | { type: 'NEW_COMMAND'; matchedCapabilityId?: string }
  | { type: 'NATURAL_LANGUAGE' };

function classifyInteraction(
  input: string,
  session: MockSession | null
): InteractionType {
  const trimmed = input.trim();

  // 1. Check for confirmation/cancellation when awaiting
  if (session?.status === 'awaiting_confirmation') {
    if (CONFIRM_PATTERNS.test(trimmed)) {
      return { type: 'CONFIRMATION', value: 'confirm' };
    }
    if (CANCEL_PATTERNS.test(trimmed)) {
      return { type: 'CONFIRMATION', value: 'cancel' };
    }
  }

  // 2. Check for choice selection when awaiting choice
  if (session?.status === 'awaiting_choice' && session.pending_choices) {
    const choiceResult = matchChoice(trimmed, session.pending_choices);
    if (choiceResult) {
      return { type: 'CHOICE_SELECTION', choiceId: choiceResult.id };
    }
  }

  // 3. Check for slash command (always takes priority)
  const slashMatch = SLASH_PATTERN.exec(trimmed);
  if (slashMatch) {
    return {
      type: 'SLASH_COMMAND',
      command: slashMatch[1],
      args: slashMatch[2] || '',
    };
  }

  // 4. Check for entity ID reference
  const idMatch = ENTITY_ID_PATTERN.exec(trimmed);
  if (idMatch) {
    return { type: 'ENTITY_ID_REFERENCE', entityId: idMatch[1] };
  }

  // 5. Check if input matches any capability trigger phrase
  // This uses CapabilityRegistry examples - scalable approach
  // Important: Check BEFORE treating as parameter value, even when gathering params
  const matchedCapabilityId = matchCapabilityTrigger(trimmed);
  if (matchedCapabilityId) {
    return { type: 'NEW_COMMAND', matchedCapabilityId };
  }

  // 6. If we're gathering params, treat remaining input as parameter value
  if (session?.status === 'gathering_params') {
    if (trimmed.length <= 200) {
      return { type: 'PARAMETER_VALUE', value: trimmed };
    }
  }

  // 7. Default: needs LLM planning
  return { type: 'NATURAL_LANGUAGE' };
}

function matchChoice(
  input: string,
  choices: Array<{ id: string; label: string }>
): { id: string; label: string } | null {
  const trimmedLower = input.toLowerCase().trim();

  // Direct ID match
  const directMatch = choices.find((c) => c.id === input);
  if (directMatch) return directMatch;

  // Label match (case-insensitive)
  const labelMatch = choices.find(
    (c) => c.label.toLowerCase() === trimmedLower
  );
  if (labelMatch) return labelMatch;

  // Partial label match (starts with)
  const partialMatch = choices.find((c) =>
    c.label.toLowerCase().startsWith(trimmedLower)
  );
  if (partialMatch && trimmedLower.length >= 2) return partialMatch;

  // Numeric selection (1, 2, 3...)
  const numMatch = /^(\d+)$/.exec(input);
  if (numMatch) {
    const index = parseInt(numMatch[1], 10) - 1;
    if (index >= 0 && index < choices.length) {
      return choices[index];
    }
  }

  // Ordinal selection
  const ordinalIndex = parseOrdinal(trimmedLower);
  if (ordinalIndex !== null && ordinalIndex < choices.length) {
    return choices[ordinalIndex];
  }

  return null;
}

function parseOrdinal(input: string): number | null {
  const ordinals: Record<string, number> = {
    // English
    first: 0, second: 1, third: 2, fourth: 3, fifth: 4,
    // Hebrew
    ראשון: 0, שני: 1, שלישי: 2, רביעי: 3, חמישי: 4,
    הראשון: 0, השני: 1, השלישי: 2, הרביעי: 3, החמישי: 4,
    // Spanish
    primero: 0, segundo: 1, tercero: 2, cuarto: 3, quinto: 4,
    primera: 0, segunda: 1, tercera: 2, cuarta: 3, quinta: 4,
  };
  return ordinals[input] ?? null;
}

// ==================== TEST FRAMEWORK ====================

interface TestCase {
  name: string;
  category: string;
  test: () => boolean;
}

const testCases: TestCase[] = [];

function describe(category: string, fn: () => void) {
  const originalLength = testCases.length;
  fn();
  for (let i = originalLength; i < testCases.length; i++) {
    testCases[i].category = category;
  }
}

function it(name: string, test: () => boolean) {
  testCases.push({ name, category: '', test });
}

// ==================== TEST CASES ====================

// =============================================================================
// CONFIRMATION - HEBREW
// =============================================================================

describe('Confirmation - Hebrew', () => {
  const session: MockSession = { status: 'awaiting_confirmation' };

  it('"כן" → CONFIRMATION confirm', () => {
    const r = classifyInteraction('כן', session);
    return r.type === 'CONFIRMATION' && r.value === 'confirm';
  });

  it('"בסדר" → CONFIRMATION confirm', () => {
    const r = classifyInteraction('בסדר', session);
    return r.type === 'CONFIRMATION' && r.value === 'confirm';
  });

  it('"אישור" → CONFIRMATION confirm', () => {
    const r = classifyInteraction('אישור', session);
    return r.type === 'CONFIRMATION' && r.value === 'confirm';
  });

  it('"מאשר" → CONFIRMATION confirm', () => {
    const r = classifyInteraction('מאשר', session);
    return r.type === 'CONFIRMATION' && r.value === 'confirm';
  });

  it('"בטח" → CONFIRMATION confirm', () => {
    const r = classifyInteraction('בטח', session);
    return r.type === 'CONFIRMATION' && r.value === 'confirm';
  });

  it('"אוקיי" → CONFIRMATION confirm', () => {
    const r = classifyInteraction('אוקיי', session);
    return r.type === 'CONFIRMATION' && r.value === 'confirm';
  });

  it('"לא" → CONFIRMATION cancel', () => {
    const r = classifyInteraction('לא', session);
    return r.type === 'CONFIRMATION' && r.value === 'cancel';
  });

  it('"ביטול" → CONFIRMATION cancel', () => {
    const r = classifyInteraction('ביטול', session);
    return r.type === 'CONFIRMATION' && r.value === 'cancel';
  });

  it('"עזוב" → CONFIRMATION cancel', () => {
    const r = classifyInteraction('עזוב', session);
    return r.type === 'CONFIRMATION' && r.value === 'cancel';
  });

  it('"תשכח" → CONFIRMATION cancel', () => {
    const r = classifyInteraction('תשכח', session);
    return r.type === 'CONFIRMATION' && r.value === 'cancel';
  });
});

// =============================================================================
// CONFIRMATION - ENGLISH
// =============================================================================

describe('Confirmation - English', () => {
  const session: MockSession = { status: 'awaiting_confirmation' };

  it('"yes" → CONFIRMATION confirm', () => {
    const r = classifyInteraction('yes', session);
    return r.type === 'CONFIRMATION' && r.value === 'confirm';
  });

  it('"y" → CONFIRMATION confirm', () => {
    const r = classifyInteraction('y', session);
    return r.type === 'CONFIRMATION' && r.value === 'confirm';
  });

  it('"ok" → CONFIRMATION confirm', () => {
    const r = classifyInteraction('ok', session);
    return r.type === 'CONFIRMATION' && r.value === 'confirm';
  });

  it('"okay" → CONFIRMATION confirm', () => {
    const r = classifyInteraction('okay', session);
    return r.type === 'CONFIRMATION' && r.value === 'confirm';
  });

  it('"confirm" → CONFIRMATION confirm', () => {
    const r = classifyInteraction('confirm', session);
    return r.type === 'CONFIRMATION' && r.value === 'confirm';
  });

  it('"sure" → CONFIRMATION confirm', () => {
    const r = classifyInteraction('sure', session);
    return r.type === 'CONFIRMATION' && r.value === 'confirm';
  });

  it('"YES" (uppercase) → CONFIRMATION confirm', () => {
    const r = classifyInteraction('YES', session);
    return r.type === 'CONFIRMATION' && r.value === 'confirm';
  });

  it('"no" → CONFIRMATION cancel', () => {
    const r = classifyInteraction('no', session);
    return r.type === 'CONFIRMATION' && r.value === 'cancel';
  });

  it('"n" → CONFIRMATION cancel', () => {
    const r = classifyInteraction('n', session);
    return r.type === 'CONFIRMATION' && r.value === 'cancel';
  });

  it('"cancel" → CONFIRMATION cancel', () => {
    const r = classifyInteraction('cancel', session);
    return r.type === 'CONFIRMATION' && r.value === 'cancel';
  });
});

// =============================================================================
// CONFIRMATION - SPANISH
// =============================================================================

describe('Confirmation - Spanish', () => {
  const session: MockSession = { status: 'awaiting_confirmation' };

  it('"sí" → CONFIRMATION confirm', () => {
    const r = classifyInteraction('sí', session);
    return r.type === 'CONFIRMATION' && r.value === 'confirm';
  });

  it('"si" (no accent) → CONFIRMATION confirm', () => {
    const r = classifyInteraction('si', session);
    return r.type === 'CONFIRMATION' && r.value === 'confirm';
  });

  it('"vale" → CONFIRMATION confirm', () => {
    const r = classifyInteraction('vale', session);
    return r.type === 'CONFIRMATION' && r.value === 'confirm';
  });

  it('"confirmar" → CONFIRMATION confirm', () => {
    const r = classifyInteraction('confirmar', session);
    return r.type === 'CONFIRMATION' && r.value === 'confirm';
  });

  it('"claro" → CONFIRMATION confirm', () => {
    const r = classifyInteraction('claro', session);
    return r.type === 'CONFIRMATION' && r.value === 'confirm';
  });

  it('"de acuerdo" → CONFIRMATION confirm', () => {
    const r = classifyInteraction('de acuerdo', session);
    return r.type === 'CONFIRMATION' && r.value === 'confirm';
  });

  it('"cancelar" → CONFIRMATION cancel', () => {
    const r = classifyInteraction('cancelar', session);
    return r.type === 'CONFIRMATION' && r.value === 'cancel';
  });

  it('"no quiero" → CONFIRMATION cancel', () => {
    const r = classifyInteraction('no quiero', session);
    return r.type === 'CONFIRMATION' && r.value === 'cancel';
  });

  it('"anular" → CONFIRMATION cancel', () => {
    const r = classifyInteraction('anular', session);
    return r.type === 'CONFIRMATION' && r.value === 'cancel';
  });
});

// =============================================================================
// PARAMETER VALUES
// =============================================================================

describe('Parameter Values - When Gathering', () => {
  const session: MockSession = { status: 'gathering_params', pending_params: ['title'] };

  it('Short non-command text → PARAMETER_VALUE', () => {
    const r = classifyInteraction('לקנות חלב', session);  // "buy milk" - not a capability trigger
    return r.type === 'PARAMETER_VALUE';
  });

  it('Capability trigger → NEW_COMMAND (even when gathering)', () => {
    // "send email to John" starts with "send email" which is a capability trigger
    const r = classifyInteraction('send email to John', session);
    return r.type === 'NEW_COMMAND';
  });

  it('Number → PARAMETER_VALUE', () => {
    const r = classifyInteraction('150', session);
    return r.type === 'PARAMETER_VALUE';
  });

  it('Email address → PARAMETER_VALUE', () => {
    const r = classifyInteraction('john@example.com', session);
    return r.type === 'PARAMETER_VALUE';
  });

  it('Phone number → PARAMETER_VALUE', () => {
    const r = classifyInteraction('+1-555-123-4567', session);
    return r.type === 'PARAMETER_VALUE';
  });

  it('Date → PARAMETER_VALUE', () => {
    const r = classifyInteraction('tomorrow at 3pm', session);
    return r.type === 'PARAMETER_VALUE';
  });

  it('Hebrew date → PARAMETER_VALUE', () => {
    const r = classifyInteraction('מחר בשעה 3', session);
    return r.type === 'PARAMETER_VALUE';
  });

  it('"yes" → PARAMETER_VALUE when NOT awaiting confirmation', () => {
    // When gathering params, "yes" should be treated as a param value, not confirmation
    const r = classifyInteraction('yes', session);
    return r.type === 'PARAMETER_VALUE';
  });
});

// =============================================================================
// CHOICE SELECTION
// =============================================================================

describe('Choice Selection', () => {
  const session: MockSession = {
    status: 'awaiting_choice',
    pending_choices: [
      { id: 'c1', label: 'יוסי כהן' },
      { id: 'c2', label: 'דוד לוי' },
      { id: 'c3', label: 'משה ישראלי' },
    ],
  };

  it('"1" → selects first choice', () => {
    const r = classifyInteraction('1', session);
    return r.type === 'CHOICE_SELECTION' && r.choiceId === 'c1';
  });

  it('"2" → selects second choice', () => {
    const r = classifyInteraction('2', session);
    return r.type === 'CHOICE_SELECTION' && r.choiceId === 'c2';
  });

  it('"3" → selects third choice', () => {
    const r = classifyInteraction('3', session);
    return r.type === 'CHOICE_SELECTION' && r.choiceId === 'c3';
  });

  it('"יוסי כהן" → selects by label', () => {
    const r = classifyInteraction('יוסי כהן', session);
    return r.type === 'CHOICE_SELECTION' && r.choiceId === 'c1';
  });

  it('"יוסי" → selects by partial label', () => {
    const r = classifyInteraction('יוסי', session);
    return r.type === 'CHOICE_SELECTION' && r.choiceId === 'c1';
  });

  it('"first" → selects by ordinal (EN)', () => {
    const r = classifyInteraction('first', session);
    return r.type === 'CHOICE_SELECTION' && r.choiceId === 'c1';
  });

  it('"second" → selects by ordinal (EN)', () => {
    const r = classifyInteraction('second', session);
    return r.type === 'CHOICE_SELECTION' && r.choiceId === 'c2';
  });

  it('"הראשון" → selects by ordinal (HE)', () => {
    const r = classifyInteraction('הראשון', session);
    return r.type === 'CHOICE_SELECTION' && r.choiceId === 'c1';
  });

  it('"השני" → selects by ordinal (HE)', () => {
    const r = classifyInteraction('השני', session);
    return r.type === 'CHOICE_SELECTION' && r.choiceId === 'c2';
  });

  it('"primero" → selects by ordinal (ES)', () => {
    const r = classifyInteraction('primero', session);
    return r.type === 'CHOICE_SELECTION' && r.choiceId === 'c1';
  });

  it('"0" → invalid, falls through to NATURAL_LANGUAGE', () => {
    const r = classifyInteraction('0', session);
    return r.type === 'NATURAL_LANGUAGE';
  });

  it('"4" → out of range, falls through to NATURAL_LANGUAGE', () => {
    const r = classifyInteraction('4', session);
    return r.type === 'NATURAL_LANGUAGE';
  });
});

// =============================================================================
// SLASH COMMANDS
// =============================================================================

describe('Slash Commands', () => {
  it('"/help" → SLASH_COMMAND', () => {
    const r = classifyInteraction('/help', null);
    return r.type === 'SLASH_COMMAND' && r.command === 'help';
  });

  it('"/cancel" → SLASH_COMMAND', () => {
    const r = classifyInteraction('/cancel', null);
    return r.type === 'SLASH_COMMAND' && r.command === 'cancel';
  });

  it('"/task create" → SLASH_COMMAND with args', () => {
    const r = classifyInteraction('/task create something', null);
    return r.type === 'SLASH_COMMAND' && r.command === 'task' && r.args === 'create something';
  });

  // Slash commands should work even when gathering params
  it('"/cancel" works during gathering_params', () => {
    const session: MockSession = { status: 'gathering_params' };
    const r = classifyInteraction('/cancel', session);
    return r.type === 'SLASH_COMMAND' && r.command === 'cancel';
  });
});

// =============================================================================
// NEW COMMANDS
// =============================================================================

describe('New Command Detection', () => {
  // Hebrew
  it('"צור משימה" → NEW_COMMAND (HE)', () => {
    const r = classifyInteraction('צור משימה חדשה', null);
    return r.type === 'NEW_COMMAND';
  });

  it('"הוסף לקוח" → NEW_COMMAND (HE)', () => {
    const r = classifyInteraction('הוסף לקוח חדש', null);
    return r.type === 'NEW_COMMAND';
  });

  it('"מחק משימה" → NEW_COMMAND (HE)', () => {
    const r = classifyInteraction('מחק משימה', null);
    return r.type === 'NEW_COMMAND';
  });

  it('"שלח חשבונית" → NEW_COMMAND (HE)', () => {
    const r = classifyInteraction('שלח חשבונית ללקוח', null);
    return r.type === 'NEW_COMMAND';
  });

  it('"הצג לקוחות" → NEW_COMMAND (HE)', () => {
    const r = classifyInteraction('הצג לקוחות', null);
    return r.type === 'NEW_COMMAND';
  });

  // English - using exact trigger phrases from CapabilityRegistry
  it('"create task" → NEW_COMMAND (EN)', () => {
    const r = classifyInteraction('create task', null);
    return r.type === 'NEW_COMMAND';
  });

  it('"add contact" → NEW_COMMAND (EN)', () => {
    const r = classifyInteraction('add contact', null);
    return r.type === 'NEW_COMMAND';
  });

  it('"add client" → NEW_COMMAND (EN)', () => {
    const r = classifyInteraction('add client', null);
    return r.type === 'NEW_COMMAND';
  });

  it('"send invoice" → NEW_COMMAND (EN)', () => {
    const r = classifyInteraction('send invoice', null);
    return r.type === 'NEW_COMMAND';
  });

  it('"send email" → NEW_COMMAND (EN)', () => {
    const r = classifyInteraction('send email', null);
    return r.type === 'NEW_COMMAND';
  });

  it('"schedule appointment" → NEW_COMMAND (EN)', () => {
    const r = classifyInteraction('schedule appointment', null);
    return r.type === 'NEW_COMMAND';
  });

  it('"book appointment" → NEW_COMMAND (EN)', () => {
    const r = classifyInteraction('book appointment', null);
    return r.type === 'NEW_COMMAND';
  });

  // Phrases that are NOT capability triggers - should fallback to NATURAL_LANGUAGE
  it('"delete task 123" → NATURAL_LANGUAGE (no exact trigger match)', () => {
    // "delete task" is not in our test trigger map
    const r = classifyInteraction('delete task 123', null);
    return r.type === 'NATURAL_LANGUAGE';
  });
});

// =============================================================================
// COMMAND DETECTION DURING SLOT-FILLING (Critical fix)
// =============================================================================

describe('Command Detection During Slot-Filling', () => {
  const gatheringSession: MockSession = { status: 'gathering_params', pending_params: ['title'] };

  // Hebrew - these should trigger NEW_COMMAND even during slot-filling
  it('"שליחת אימייל" during slot-filling → NEW_COMMAND (not PARAMETER_VALUE)', () => {
    const r = classifyInteraction('שליחת אימייל', gatheringSession);
    return r.type === 'NEW_COMMAND' && r.matchedCapabilityId === 'email.send';
  });

  it('"שלח אימייל" during slot-filling → NEW_COMMAND', () => {
    const r = classifyInteraction('שלח אימייל', gatheringSession);
    return r.type === 'NEW_COMMAND' && r.matchedCapabilityId === 'email.send';
  });

  it('"צור משימה" during slot-filling → NEW_COMMAND', () => {
    const r = classifyInteraction('צור משימה', gatheringSession);
    return r.type === 'NEW_COMMAND' && r.matchedCapabilityId === 'task.create';
  });

  it('"הוסף לקוח" during slot-filling → NEW_COMMAND', () => {
    const r = classifyInteraction('הוסף לקוח', gatheringSession);
    return r.type === 'NEW_COMMAND' && r.matchedCapabilityId === 'contact.create';
  });

  // English - these should trigger NEW_COMMAND even during slot-filling
  it('"send email" during slot-filling → NEW_COMMAND', () => {
    const r = classifyInteraction('send email', gatheringSession);
    return r.type === 'NEW_COMMAND' && r.matchedCapabilityId === 'email.send';
  });

  it('"create task" during slot-filling → NEW_COMMAND', () => {
    const r = classifyInteraction('create task', gatheringSession);
    return r.type === 'NEW_COMMAND' && r.matchedCapabilityId === 'task.create';
  });

  it('"add contact" during slot-filling → NEW_COMMAND', () => {
    const r = classifyInteraction('add contact', gatheringSession);
    return r.type === 'NEW_COMMAND' && r.matchedCapabilityId === 'contact.create';
  });

  // These should still be PARAMETER_VALUE (not matching any capability trigger)
  it('"call John tomorrow" → PARAMETER_VALUE (not a capability trigger)', () => {
    const r = classifyInteraction('call John tomorrow', gatheringSession);
    return r.type === 'PARAMETER_VALUE';
  });

  it('"קניות בסופר" → PARAMETER_VALUE (grocery shopping - not a command)', () => {
    const r = classifyInteraction('קניות בסופר', gatheringSession);
    return r.type === 'PARAMETER_VALUE';
  });

  it('"meeting notes" → PARAMETER_VALUE (not a capability trigger)', () => {
    const r = classifyInteraction('meeting notes', gatheringSession);
    return r.type === 'PARAMETER_VALUE';
  });
});

// =============================================================================
// NATURAL LANGUAGE
// =============================================================================

describe('Natural Language Fallback', () => {
  it('Question → NATURAL_LANGUAGE', () => {
    const r = classifyInteraction('how many clients do I have', null);
    return r.type === 'NATURAL_LANGUAGE';
  });

  it('Hebrew question → NATURAL_LANGUAGE', () => {
    const r = classifyInteraction('כמה לקוחות יש לי', null);
    return r.type === 'NATURAL_LANGUAGE';
  });

  it('Greeting → NATURAL_LANGUAGE', () => {
    const r = classifyInteraction('hello', null);
    return r.type === 'NATURAL_LANGUAGE';
  });

  it('Hebrew greeting → NATURAL_LANGUAGE', () => {
    const r = classifyInteraction('שלום', null);
    return r.type === 'NATURAL_LANGUAGE';
  });

  it('Random text → NATURAL_LANGUAGE', () => {
    const r = classifyInteraction('I need help with something', null);
    return r.type === 'NATURAL_LANGUAGE';
  });
});

// =============================================================================
// EDGE CASES
// =============================================================================

describe('Edge Cases', () => {
  const gatheringSession: MockSession = { status: 'gathering_params' };
  const confirmSession: MockSession = { status: 'awaiting_confirmation' };

  it('Whitespace trimmed: "  yes  " → CONFIRMATION', () => {
    const r = classifyInteraction('  yes  ', confirmSession);
    return r.type === 'CONFIRMATION' && r.value === 'confirm';
  });

  it('Empty string → NATURAL_LANGUAGE', () => {
    const r = classifyInteraction('', null);
    return r.type === 'NATURAL_LANGUAGE';
  });

  it('Only whitespace → NATURAL_LANGUAGE', () => {
    const r = classifyInteraction('   ', null);
    return r.type === 'NATURAL_LANGUAGE';
  });

  it('Very long text (>200 chars) when gathering → NEW_COMMAND check', () => {
    const longText = 'a'.repeat(250);
    const r = classifyInteraction(longText, gatheringSession);
    // Should NOT be PARAMETER_VALUE due to length limit
    return r.type !== 'PARAMETER_VALUE';
  });

  it('Entity ID reference', () => {
    const r = classifyInteraction('[ID: 12345678-1234-1234-1234-123456789abc]', null);
    return r.type === 'ENTITY_ID_REFERENCE' && r.entityId === '12345678-1234-1234-1234-123456789abc';
  });
});

// ==================== RUN TESTS ====================

function runTests(): void {
  console.log('\n' + '='.repeat(70));
  console.log(`${colors.cyan}Interaction Classifier Tests${colors.reset}`);
  console.log('='.repeat(70) + '\n');

  let totalPassed = 0;
  let totalFailed = 0;
  const categoryResults: Record<string, { passed: number; failed: number }> = {};
  const failures: Array<{ category: string; name: string }> = [];

  const categories = [...new Set(testCases.map((t) => t.category))];

  for (const category of categories) {
    const categoryTests = testCases.filter((t) => t.category === category);
    console.log(`${colors.blue}▸ ${category}${colors.reset}`);

    let categoryPassed = 0;
    let categoryFailed = 0;

    for (const testCase of categoryTests) {
      try {
        const result = testCase.test();
        if (result) {
          console.log(`  ${colors.green}✓${colors.reset} ${testCase.name}`);
          categoryPassed++;
          totalPassed++;
        } else {
          console.log(`  ${colors.red}✗${colors.reset} ${testCase.name}`);
          failures.push({ category, name: testCase.name });
          categoryFailed++;
          totalFailed++;
        }
      } catch (error) {
        console.log(`  ${colors.red}✗${colors.reset} ${testCase.name} (${error})`);
        failures.push({ category, name: testCase.name });
        categoryFailed++;
        totalFailed++;
      }
    }

    categoryResults[category] = { passed: categoryPassed, failed: categoryFailed };
    console.log(
      `  ${colors.dim}Category: ${categoryPassed}/${categoryTests.length} passed${colors.reset}\n`
    );
  }

  // Summary
  console.log('='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total: ${totalPassed + totalFailed} tests`);
  console.log(`${colors.green}Passed: ${totalPassed}${colors.reset}`);
  console.log(`${colors.red}Failed: ${totalFailed}${colors.reset}`);

  if (failures.length > 0) {
    console.log('\nFailed Tests:');
    for (const f of failures) {
      console.log(`  ${colors.red}✗${colors.reset} [${f.category}] ${f.name}`);
    }
  }

  console.log('');

  if (totalFailed > 0) {
    process.exit(1);
  }
}

runTests();
