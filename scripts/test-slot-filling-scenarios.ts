/**
 * Direct Slot-Filling Scenarios Test
 *
 * Tests the slot-filling logic directly without HTTP calls
 * to quickly identify issues with the confirmation flow.
 *
 * Usage: npx tsx scripts/test-slot-filling-scenarios.ts
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config({ path: '.env.local' });

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getCapability, CAPABILITY_REGISTRY } = require('../lib/business-os/chat/CapabilityRegistry');

// ==================== TYPES ====================

interface TestCase {
  input: string;
  language: 'en' | 'he';
  capability: string;
  providedParams: Record<string, unknown>;
  expectedMissing: string[];  // Params that should be asked for
  description: string;
}

interface TestResult {
  testCase: TestCase;
  passed: boolean;
  actualMissing: string[];
  issues: string[];
}

// ==================== TEST CASES ====================

const TEST_CASES: TestCase[] = [
  // TASK.CREATE
  {
    input: 'פתח משימה',
    language: 'he',
    capability: 'task.create',
    providedParams: { title: 'פתח משימה' },  // LLM might pass command as title
    expectedMissing: ['title'],
    description: 'Command phrase should NOT be used as title',
  },
  {
    input: 'create task',
    language: 'en',
    capability: 'task.create',
    providedParams: { title: 'create task' },
    expectedMissing: ['title'],
    description: 'Command phrase should NOT be used as title (EN)',
  },
  {
    input: 'צור משימה לשלוח מייל',
    language: 'he',
    capability: 'task.create',
    providedParams: { title: 'לשלוח מייל' },
    expectedMissing: [],
    description: 'Real title should be accepted',
  },
  {
    input: 'add task: call John tomorrow',
    language: 'en',
    capability: 'task.create',
    providedParams: { title: 'call John tomorrow' },
    expectedMissing: [],
    description: 'Real title should be accepted (EN)',
  },
  {
    input: 'משימה חדשה',
    language: 'he',
    capability: 'task.create',
    providedParams: { title: 'משימה חדשה' },
    expectedMissing: ['title'],
    description: 'Generic placeholder should trigger slot-fill',
  },

  // CONTACT.CREATE
  {
    input: 'הוסף איש קשר',
    language: 'he',
    capability: 'contact.create',
    providedParams: {},
    expectedMissing: ['first_name'],
    description: 'Should ask for first_name',
  },
  {
    input: 'צור לקוח יוסי כהן',
    language: 'he',
    capability: 'contact.create',
    providedParams: { first_name: 'יוסי', last_name: 'כהן' },
    expectedMissing: [],
    description: 'Both names provided - no slot-fill needed',
  },

  // BOOKING.CREATE
  {
    input: 'קבע פגישה',
    language: 'he',
    capability: 'booking.create',
    providedParams: {},
    expectedMissing: ['service_id', 'contact_id', 'start_time'],
    description: 'Should ask for all required params',
  },

  // INVOICE.SEND
  {
    input: 'שלח חשבונית',
    language: 'he',
    capability: 'invoice.send',
    providedParams: {},
    expectedMissing: ['invoice_id'],
    description: 'Should ask which invoice to send',
  },

  // =========================================
  // EMAIL.SEND - Multiple required params
  // =========================================
  {
    input: 'שלח מייל',
    language: 'he',
    capability: 'email.send',
    providedParams: {},
    expectedMissing: ['contact_id', 'subject', 'body'],
    description: 'Email: Should ask for all 3 required params',
  },
  {
    input: 'send email',
    language: 'en',
    capability: 'email.send',
    providedParams: {},
    expectedMissing: ['contact_id', 'subject', 'body'],
    description: 'Email EN: Should ask for all 3 required params',
  },
  {
    input: 'שלח מייל לדוד',
    language: 'he',
    capability: 'email.send',
    providedParams: { contact_id: 'contact-123' },
    expectedMissing: ['subject', 'body'],
    description: 'Email: With contact, ask for subject and body',
  },

  // =========================================
  // INVOICE.CREATE - Multiple required params
  // =========================================
  {
    input: 'צור חשבונית',
    language: 'he',
    capability: 'invoice.create',
    providedParams: {},
    expectedMissing: ['contact_id', 'amount', 'description'],
    description: 'Invoice create: Should ask for all 3 required params',
  },
  {
    input: 'create invoice',
    language: 'en',
    capability: 'invoice.create',
    providedParams: {},
    expectedMissing: ['contact_id', 'amount', 'description'],
    description: 'Invoice create EN: Should ask for all 3 required params',
  },
  {
    input: 'צור חשבונית ל-150 שקל',
    language: 'he',
    capability: 'invoice.create',
    providedParams: { amount: 150 },
    expectedMissing: ['contact_id', 'description'],
    description: 'Invoice: With amount, ask for contact and description',
  },
  {
    input: 'create invoice for John',
    language: 'en',
    capability: 'invoice.create',
    providedParams: { contact_id: 'contact-123', amount: 200, description: 'Consulting' },
    expectedMissing: [],
    description: 'Invoice: With all params, no slot-fill needed',
  },

  // =========================================
  // SERVICE.CREATE - Multiple required params
  // =========================================
  {
    input: 'צור שירות',
    language: 'he',
    capability: 'service.create',
    providedParams: {},
    expectedMissing: ['service_name', 'duration_minutes'],
    description: 'Service create: Should ask for name and duration',
  },
  {
    input: 'create service Consultation',
    language: 'en',
    capability: 'service.create',
    providedParams: { service_name: 'Consultation' },
    expectedMissing: ['duration_minutes'],
    description: 'Service: With name, ask for duration',
  },
  {
    input: 'create service Consultation 60 minutes',
    language: 'en',
    capability: 'service.create',
    providedParams: { service_name: 'Consultation', duration_minutes: 60 },
    expectedMissing: [],
    description: 'Service: With all required, no slot-fill',
  },

  // =========================================
  // ACTIVITY.CREATE - Multiple required params
  // =========================================
  {
    input: 'הוסף הערה',
    language: 'he',
    capability: 'activity.create',
    providedParams: {},
    expectedMissing: ['contact_id', 'activity_type', 'description'],
    description: 'Activity: Should ask for all 3 required params',
  },
  {
    input: 'log a call with John',
    language: 'en',
    capability: 'activity.create',
    providedParams: { contact_id: 'contact-123', activity_type: 'call' },
    expectedMissing: ['description'],
    description: 'Activity: With contact and type, ask for description',
  },

  // =========================================
  // PAYMENT.RECORD - Multiple required params
  // =========================================
  {
    input: 'רשום תשלום',
    language: 'he',
    capability: 'payment.record',
    providedParams: {},
    expectedMissing: ['contact_id', 'amount'],
    description: 'Payment: Should ask for contact and amount',
  },
  {
    input: 'record payment from John',
    language: 'en',
    capability: 'payment.record',
    providedParams: { contact_id: 'contact-123' },
    expectedMissing: ['amount'],
    description: 'Payment: With contact, ask for amount',
  },
  {
    input: 'דוד שילם 500',
    language: 'he',
    capability: 'payment.record',
    providedParams: { contact_id: 'contact-123', amount: 500 },
    expectedMissing: [],
    description: 'Payment: With all params, no slot-fill',
  },

  // =========================================
  // BOOKING.RESCHEDULE
  // =========================================
  {
    input: 'הזז פגישה',
    language: 'he',
    capability: 'booking.reschedule',
    providedParams: {},
    expectedMissing: ['booking_id', 'new_start_time'],
    description: 'Reschedule: Should ask for booking and new time',
  },
  {
    input: 'reschedule meeting to tomorrow',
    language: 'en',
    capability: 'booking.reschedule',
    providedParams: { booking_id: 'booking-123', new_start_time: 'tomorrow 10am' },
    expectedMissing: [],
    description: 'Reschedule: With all params, no slot-fill',
  },

  // =========================================
  // NAVIGATE - Single required param
  // =========================================
  {
    input: 'עבור ל',
    language: 'he',
    capability: 'navigate',
    providedParams: {},
    expectedMissing: ['destination'],
    description: 'Navigate: Should ask for destination',
  },
  {
    input: 'go to contacts',
    language: 'en',
    capability: 'navigate',
    providedParams: { destination: 'contacts' },
    expectedMissing: [],
    description: 'Navigate: With destination, no slot-fill',
  },

  // =========================================
  // EDGE CASES - Placeholder variations
  // =========================================
  {
    input: 'NEW TASK',
    language: 'en',
    capability: 'task.create',
    providedParams: { title: 'NEW TASK' },
    expectedMissing: ['title'],
    description: 'Uppercase placeholder should be detected',
  },
  {
    input: 'New Task',
    language: 'en',
    capability: 'task.create',
    providedParams: { title: 'New Task' },
    expectedMissing: ['title'],
    description: 'Mixed case placeholder should be detected',
  },
  {
    input: 'untitled',
    language: 'en',
    capability: 'task.create',
    providedParams: { title: 'untitled' },
    expectedMissing: ['title'],
    description: '"untitled" should be detected as placeholder',
  },
  {
    input: 'placeholder',
    language: 'en',
    capability: 'task.create',
    providedParams: { title: 'placeholder' },
    expectedMissing: ['title'],
    description: '"placeholder" should be detected as placeholder',
  },

  // =========================================
  // EDGE CASES - Valid short inputs
  // =========================================
  {
    input: 'Buy milk',
    language: 'en',
    capability: 'task.create',
    providedParams: { title: 'Buy milk' },
    expectedMissing: [],
    description: 'Short but real title should be accepted',
  },
  {
    input: 'קניות',
    language: 'he',
    capability: 'task.create',
    providedParams: { title: 'קניות' },
    expectedMissing: [],
    description: 'Short Hebrew title should be accepted',
  },
  {
    input: 'X',
    language: 'en',
    capability: 'task.create',
    providedParams: { title: 'X' },
    expectedMissing: [],
    description: 'Single letter title should be accepted (edge case)',
  },

  // =========================================
  // SEARCH OPERATIONS - No required params
  // =========================================
  {
    input: 'הראה לקוחות',
    language: 'he',
    capability: 'contact.search',
    providedParams: {},
    expectedMissing: [],
    description: 'Contact search: No required params',
  },
  {
    input: 'show tasks',
    language: 'en',
    capability: 'task.search',
    providedParams: {},
    expectedMissing: [],
    description: 'Task search: No required params',
  },
  {
    input: 'הראה פגישות',
    language: 'he',
    capability: 'booking.search',
    providedParams: {},
    expectedMissing: [],
    description: 'Booking search: No required params',
  },
  {
    input: 'show invoices',
    language: 'en',
    capability: 'invoice.search',
    providedParams: {},
    expectedMissing: [],
    description: 'Invoice search: No required params',
  },

  // =========================================
  // DESTRUCTIVE OPERATIONS
  // =========================================
  {
    input: 'מחק איש קשר',
    language: 'he',
    capability: 'contact.delete',
    providedParams: {},
    expectedMissing: ['contact_id'],
    description: 'Contact delete: Should ask which contact',
  },
  {
    input: 'delete task',
    language: 'en',
    capability: 'task.delete',
    providedParams: {},
    expectedMissing: ['task_id'],
    description: 'Task delete: Should ask which task',
  },
  {
    input: 'בטל פגישה',
    language: 'he',
    capability: 'booking.cancel',
    providedParams: {},
    expectedMissing: ['booking_id'],
    description: 'Booking cancel: Should ask which booking',
  },
];

// ==================== SLOT FILLING LOGIC (copied for testing) ====================

function getMissingRequiredParams(
  capabilityId: string,
  providedParams: Record<string, unknown>
): string[] {
  const capability = getCapability(capabilityId);
  if (!capability) return [];

  // Only consider REQUIRED params
  const requiredParams = (capability.params || []).filter((p) => p.required);

  // Build placeholder list including capability examples
  const commandPhrases = [
    ...(capability.examples || []),
    ...(capability.examples_he || []),
  ].map((e) => e.toLowerCase().trim());

  const staticPlaceholders = [
    // English placeholders
    'new task', 'task', 'new', 'untitled', 'placeholder', 'default',
    'create task', 'add task', 'open task',
    // Hebrew placeholders
    'משימה חדשה', 'משימה', 'חדש', 'ללא כותרת',
    'פתח משימה', 'צור משימה', 'הוסף משימה',
    // Spanish placeholders
    'nueva tarea', 'tarea nueva', 'tarea', 'nuevo', 'sin título',
    'crear tarea', 'agregar tarea', 'abrir tarea',
  ];

  const allPlaceholders = [...staticPlaceholders, ...commandPhrases];

  return requiredParams
    .filter((p) => {
      const value = providedParams[p.name];

      // Skip if already provided with a real value
      if (value !== undefined && value !== null && value !== '') {
        // Check for placeholder values
        if (typeof value === 'string') {
          const normalized = value.toLowerCase().trim();
          if (!allPlaceholders.includes(normalized)) {
            return false;  // Real value provided
          }
        } else {
          return false;  // Non-string value provided
        }
      }

      return true;  // Missing or placeholder
    })
    .map(p => p.name);
}

// ==================== CONFIRMATION PREVIEW LOGIC ====================

function buildConfirmationPreview(
  capabilityId: string,
  resolvedParams: Record<string, unknown>,
  language: 'en' | 'he'
): string {
  const capability = getCapability(capabilityId);
  if (!capability) return '';

  // Use localized description
  const action = language === 'he' && capability.description_he
    ? capability.description_he
    : capability.description;

  // Only show filled params
  const paramSummary = Object.entries(resolvedParams)
    .filter(([key]) => !key.endsWith('_entity'))
    .map(([key, value]) => {
      const paramDef = capability.params?.find((p) => p.name === key);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const label = getLocalizedLabel(key, paramDef as any, language);
      const displayValue = value === null || value === undefined || value === ''
        ? '-'
        : String(value);
      return `• ${label}: ${displayValue}`;
    })
    .join('\n');

  const actionHint = language === 'he'
    ? 'אמור "כן" לאישור או "לא" לביטול'
    : 'Say "yes" to confirm or "no" to cancel';

  return `${action}\n\n${paramSummary}\n\n${actionHint}`;
}

function getLocalizedLabel(
  paramName: string,
  paramDef: { label?: string; label_he?: string } | null | undefined,
  language: 'en' | 'he'
): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const def = paramDef as any;
  if (language === 'he' && def?.label_he) return def.label_he;
  if (def?.label) return def.label;

  const hebrewLabels: Record<string, string> = {
    title: 'כותרת',
    description: 'תיאור',
    due_date: 'תאריך יעד',
    priority: 'עדיפות',
    contact_id: 'איש קשר',
    first_name: 'שם פרטי',
    last_name: 'שם משפחה',
    email: 'אימייל',
    phone: 'טלפון',
  };

  if (language === 'he' && hebrewLabels[paramName]) {
    return hebrewLabels[paramName];
  }

  return paramName.replace(/_/g, ' ');
}

// ==================== RUN TESTS ====================

function runTests(): void {
  console.log('='.repeat(60));
  console.log('Slot-Filling Scenarios Test');
  console.log('='.repeat(60));
  console.log();

  let passed = 0;
  let failed = 0;
  const issues: string[] = [];

  for (const testCase of TEST_CASES) {
    const actualMissing = getMissingRequiredParams(testCase.capability, testCase.providedParams);

    const expectedSet = new Set(testCase.expectedMissing);
    const actualSet = new Set(actualMissing);

    const isMatch = expectedSet.size === actualSet.size &&
                   [...expectedSet].every(p => actualSet.has(p));

    if (isMatch) {
      console.log(`✅ ${testCase.description}`);
      passed++;
    } else {
      console.log(`❌ ${testCase.description}`);
      console.log(`   Input: "${testCase.input}"`);
      console.log(`   Provided: ${JSON.stringify(testCase.providedParams)}`);
      console.log(`   Expected missing: [${testCase.expectedMissing.join(', ')}]`);
      console.log(`   Actual missing: [${actualMissing.join(', ')}]`);
      failed++;

      if (actualMissing.length === 0 && testCase.expectedMissing.length > 0) {
        issues.push(`${testCase.capability}: Placeholder not detected - "${Object.values(testCase.providedParams)[0]}"`);
      } else if (actualMissing.length > 0 && testCase.expectedMissing.length === 0) {
        issues.push(`${testCase.capability}: Real value incorrectly treated as placeholder`);
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);

  if (issues.length > 0) {
    console.log('\nUnique Issues:');
    [...new Set(issues)].forEach(issue => console.log(`  - ${issue}`));
  }

  // Test confirmation preview
  console.log('\n' + '='.repeat(60));
  console.log('Confirmation Preview Examples');
  console.log('='.repeat(60));

  const previewTests = [
    { capability: 'task.create', params: { title: 'לשלוח מייל ליוסי' }, language: 'he' as const },
    { capability: 'task.create', params: { title: 'Call John', priority: 'high' }, language: 'en' as const },
    { capability: 'contact.create', params: { first_name: 'יוסי', last_name: 'כהן' }, language: 'he' as const },
  ];

  for (const test of previewTests) {
    console.log(`\n${test.capability} [${test.language}]:`);
    console.log(buildConfirmationPreview(test.capability, test.params, test.language));
  }

  // List all capabilities and their required params
  console.log('\n' + '='.repeat(60));
  console.log('All Capabilities - Required Params');
  console.log('='.repeat(60));

  for (const cap of CAPABILITY_REGISTRY) {
    const required = cap.params.filter((p: { required: boolean }) => p.required).map((p: { name: string }) => p.name);
    if (required.length > 0) {
      console.log(`${cap.id}: [${required.join(', ')}]`);
    } else {
      console.log(`${cap.id}: (no required params)`);
    }
  }

  // Check for localization issues
  console.log('\n' + '='.repeat(60));
  console.log('Localization Check - Missing Hebrew Descriptions');
  console.log('='.repeat(60));

  let missingCount = 0;
  for (const cap of CAPABILITY_REGISTRY) {
    if (!cap.description_he) {
      console.log(`❌ ${cap.id}: Missing description_he`);
      missingCount++;
    }
  }
  if (missingCount === 0) {
    console.log('✅ All capabilities have Hebrew descriptions');
  }
}

runTests();
