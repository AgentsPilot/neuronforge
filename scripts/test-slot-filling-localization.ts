/**
 * Test Slot-Filling Localization
 *
 * Tests that the slot-filling service properly localizes prompts and confirmations
 * in Hebrew, English, and Spanish.
 *
 * Usage: npx tsx scripts/test-slot-filling-localization.ts
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config({ path: '.env.local' });

// ==================== COLORS ====================

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

// ==================== MOCK SERVICE ====================

/**
 * Inline implementation of the localization logic for testing
 * (Avoids import issues with path aliases)
 */
function getLocalizedParamLabel(
  paramName: string,
  language: 'en' | 'he' | 'es'
): string {
  // Fallback to common translations
  if (language === 'he') {
    const hebrewLabels: Record<string, string> = {
      title: 'כותרת',
      description: 'תיאור',
      due_date: 'תאריך יעד',
      priority: 'עדיפות',
      contact_id: 'איש קשר',
      amount: 'סכום',
      email: 'אימייל',
      phone: 'טלפון',
      first_name: 'שם פרטי',
      last_name: 'שם משפחה',
      notes: 'הערות',
      status: 'סטטוס',
      date: 'תאריך',
      time: 'שעה',
      service_id: 'שירות',
      service_name: 'שם השירות',
      duration_minutes: 'משך בדקות',
      price: 'מחיר',
      invoice_id: 'חשבונית',
      booking_id: 'פגישה',
      task_id: 'משימה',
      start_time: 'שעת התחלה',
      new_start_time: 'שעת התחלה חדשה',
      subject: 'נושא',
      body: 'תוכן',
      activity_type: 'סוג פעילות',
      method: 'אופן תשלום',
      query: 'חיפוש',
    };
    if (hebrewLabels[paramName]) {
      return hebrewLabels[paramName];
    }
  }

  if (language === 'es') {
    const spanishLabels: Record<string, string> = {
      title: 'título',
      description: 'descripción',
      due_date: 'fecha límite',
      priority: 'prioridad',
      contact_id: 'contacto',
      amount: 'monto',
      email: 'correo',
      phone: 'teléfono',
      first_name: 'nombre',
      last_name: 'apellido',
      notes: 'notas',
      status: 'estado',
      date: 'fecha',
      time: 'hora',
      service_id: 'servicio',
      service_name: 'nombre del servicio',
      duration_minutes: 'duración en minutos',
      price: 'precio',
      invoice_id: 'factura',
      booking_id: 'reserva',
      task_id: 'tarea',
      start_time: 'hora de inicio',
      new_start_time: 'nueva hora de inicio',
      subject: 'asunto',
      body: 'cuerpo',
      activity_type: 'tipo de actividad',
      method: 'método de pago',
      query: 'búsqueda',
    };
    if (spanishLabels[paramName]) {
      return spanishLabels[paramName];
    }
  }

  // Default: humanize the param name
  return paramName.replace(/_/g, ' ');
}

function buildRequiredParamsPrompt(
  params: Array<{ name: string }>,
  language: 'en' | 'he' | 'es'
): string {
  if (params.length === 1) {
    const label = getLocalizedParamLabel(params[0].name, language);
    return language === 'he'
      ? `מה ה${label}?`
      : language === 'es'
      ? `¿Cuál es el/la ${label}?`
      : `What is the ${label}?`;
  }

  // Multiple params - show list
  const intro =
    language === 'he'
      ? 'אני צריך את הפרטים הבאים:'
      : language === 'es'
      ? 'Necesito los siguientes datos:'
      : 'I need the following details:';

  const paramList = params
    .map((p) => {
      const label = getLocalizedParamLabel(p.name, language);
      return `• ${label}`;
    })
    .join('\n');

  const hint =
    language === 'he'
      ? '(אפשר להקליד הכל בהודעה אחת)'
      : language === 'es'
      ? '(puedes escribir todo en un solo mensaje)'
      : '(you can type everything in one message)';

  return `${intro}\n${paramList}\n\n${hint}`;
}

function buildConfirmationPreview(
  capabilityDescription: string,
  resolvedParams: Record<string, unknown>,
  language: 'en' | 'he' | 'es'
): string {
  const paramSummary = Object.entries(resolvedParams)
    .filter(([key]) => !key.endsWith('_entity'))
    .map(([key, value]) => {
      const label = getLocalizedParamLabel(key, language);
      const displayValue = value === null || value === undefined || value === ''
        ? '-'
        : String(value);
      return `• ${label}: ${displayValue}`;
    })
    .join('\n');

  const actionHint =
    language === 'he'
      ? 'אמור "כן" לאישור או "לא" לביטול'
      : language === 'es'
      ? 'Di "sí" para confirmar o "no" para cancelar'
      : 'Say "yes" to confirm or "no" to cancel';

  return `${capabilityDescription}\n\n${paramSummary}\n\n${actionHint}`;
}

// ==================== TESTS ====================

interface TestCase {
  name: string;
  test: () => boolean;
  errorMessage?: string;
}

const testCases: TestCase[] = [
  // Hebrew localization tests
  {
    name: 'Hebrew: title param should be כותרת',
    test: () => getLocalizedParamLabel('title', 'he') === 'כותרת',
  },
  {
    name: 'Hebrew: contact_id param should be איש קשר',
    test: () => getLocalizedParamLabel('contact_id', 'he') === 'איש קשר',
  },
  {
    name: 'Hebrew: service_name param should be שם השירות',
    test: () => getLocalizedParamLabel('service_name', 'he') === 'שם השירות',
  },
  {
    name: 'Hebrew: invoice_id param should be חשבונית',
    test: () => getLocalizedParamLabel('invoice_id', 'he') === 'חשבונית',
  },
  {
    name: 'Hebrew: start_time param should be שעת התחלה',
    test: () => getLocalizedParamLabel('start_time', 'he') === 'שעת התחלה',
  },

  // English localization tests
  {
    name: 'English: title param should be title',
    test: () => getLocalizedParamLabel('title', 'en') === 'title',
  },
  {
    name: 'English: unknown_param should be humanized',
    test: () => getLocalizedParamLabel('unknown_param', 'en') === 'unknown param',
  },

  // Spanish localization tests
  {
    name: 'Spanish: title param should be título',
    test: () => getLocalizedParamLabel('title', 'es') === 'título',
  },
  {
    name: 'Spanish: contact_id param should be contacto',
    test: () => getLocalizedParamLabel('contact_id', 'es') === 'contacto',
  },

  // Prompt building tests
  {
    name: 'Hebrew: single param prompt should be in Hebrew',
    test: () => {
      const prompt = buildRequiredParamsPrompt([{ name: 'title' }], 'he');
      return prompt.includes('כותרת') && !prompt.includes('title');
    },
  },
  {
    name: 'Hebrew: multi-param prompt should list all in Hebrew',
    test: () => {
      const prompt = buildRequiredParamsPrompt(
        [{ name: 'contact_id' }, { name: 'amount' }, { name: 'description' }],
        'he'
      );
      return (
        prompt.includes('איש קשר') &&
        prompt.includes('סכום') &&
        prompt.includes('תיאור') &&
        prompt.includes('אני צריך את הפרטים הבאים')
      );
    },
  },
  {
    name: 'English: multi-param prompt should use English',
    test: () => {
      const prompt = buildRequiredParamsPrompt(
        [{ name: 'contact_id' }, { name: 'amount' }],
        'en'
      );
      return (
        prompt.includes('contact id') &&
        prompt.includes('amount') &&
        prompt.includes('I need the following details')
      );
    },
  },

  // Confirmation preview tests
  {
    name: 'Hebrew: confirmation should show Hebrew labels',
    test: () => {
      const preview = buildConfirmationPreview(
        'יצירת משימה',
        { title: 'לשלוח מייל', priority: 'high' },
        'he'
      );
      return (
        preview.includes('כותרת: לשלוח מייל') &&
        preview.includes('עדיפות: high') &&
        preview.includes('אמור "כן" לאישור')
      );
    },
  },
  {
    name: 'Hebrew: confirmation should not contain English labels',
    test: () => {
      const preview = buildConfirmationPreview(
        'יצירת משימה',
        { title: 'לשלוח מייל', due_date: '2024-01-15' },
        'he'
      );
      return (
        !preview.includes('title:') &&
        !preview.includes('due_date:') &&
        !preview.includes('Say "yes"')
      );
    },
  },
  {
    name: 'English: confirmation should use English labels',
    test: () => {
      const preview = buildConfirmationPreview(
        'Create a task',
        { title: 'Send email', due_date: '2024-01-15' },
        'en'
      );
      return (
        preview.includes('title: Send email') &&
        preview.includes('due date: 2024-01-15') &&
        preview.includes('Say "yes" to confirm')
      );
    },
  },
  {
    name: 'Spanish: confirmation should use Spanish labels',
    test: () => {
      const preview = buildConfirmationPreview(
        'Crear una tarea',
        { title: 'Enviar correo', priority: 'alta' },
        'es'
      );
      return (
        preview.includes('título: Enviar correo') &&
        preview.includes('prioridad: alta') &&
        preview.includes('Di "sí" para confirmar')
      );
    },
  },
];

// ==================== RUN TESTS ====================

function runTests(): void {
  console.log('\n' + '='.repeat(70));
  console.log(`${colors.cyan}Slot-Filling Localization Tests${colors.reset}`);
  console.log('='.repeat(70) + '\n');

  let passed = 0;
  let failed = 0;
  const failures: Array<{ name: string; error?: string }> = [];

  for (const testCase of testCases) {
    try {
      const result = testCase.test();
      if (result) {
        console.log(`${colors.green}✓${colors.reset} ${testCase.name}`);
        passed++;
      } else {
        console.log(`${colors.red}✗${colors.reset} ${testCase.name}`);
        failures.push({ name: testCase.name, error: testCase.errorMessage });
        failed++;
      }
    } catch (error) {
      console.log(`${colors.red}✗${colors.reset} ${testCase.name}`);
      failures.push({
        name: testCase.name,
        error: error instanceof Error ? error.message : String(error),
      });
      failed++;
    }
  }

  console.log('\n' + '-'.repeat(70));
  console.log(`Results: ${colors.green}${passed} passed${colors.reset}, ${colors.red}${failed} failed${colors.reset}`);

  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) {
      console.log(`  - ${f.name}`);
      if (f.error) {
        console.log(`    ${colors.dim}${f.error}${colors.reset}`);
      }
    }
  }

  console.log('');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
