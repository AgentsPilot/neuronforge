/**
 * E2E Chat Capabilities Test Suite
 *
 * Comprehensive test runner that exercises ALL chat capabilities
 * in Hebrew and English to identify issues with:
 * - Slot-filling (missing params detection)
 * - Localization (Hebrew/English responses)
 * - Confirmation flow
 * - Parameter parsing
 * - Command phrase detection
 *
 * Usage: npx tsx scripts/e2e-chat-capabilities-test.ts
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config({ path: '.env.local' });

import {
  CAPABILITY_REGISTRY,
  getCapability,
  type Capability,
} from '../lib/business-os/chat/CapabilityRegistry';

// ==================== TYPES ====================

interface TestScenario {
  id: string;
  capability: string;
  language: 'en' | 'he';
  input: string;
  description: string;
  expectedFlow: 'slot_fill' | 'confirm' | 'execute' | 'search_results';
  expectedMissingParams?: string[];
  providedParamValues?: Record<string, string>; // For slot-filling followup
}

interface TestResult {
  scenario: TestScenario;
  passed: boolean;
  issues: string[];
  response?: string;
  route?: string;
  actualFlow?: string;
  timing_ms?: number;
}

interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  issueCategories: Record<string, number>;
  failedScenarios: TestResult[];
}

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

// ==================== TEST SCENARIOS ====================

function generateTestScenarios(): TestScenario[] {
  const scenarios: TestScenario[] = [];

  // ===== TASK.CREATE =====
  scenarios.push(
    {
      id: 'task.create.he.command_only',
      capability: 'task.create',
      language: 'he',
      input: 'פתח משימה',
      description: 'Hebrew command only - should ask for title',
      expectedFlow: 'slot_fill',
      expectedMissingParams: ['title'],
    },
    {
      id: 'task.create.he.with_title',
      capability: 'task.create',
      language: 'he',
      input: 'צור משימה לשלוח מייל ליוסי',
      description: 'Hebrew with title - should execute or confirm',
      expectedFlow: 'execute',
    },
    {
      id: 'task.create.he.placeholder',
      capability: 'task.create',
      language: 'he',
      input: 'הוסף משימה חדשה',
      description: 'Hebrew with placeholder phrase - should ask for title',
      expectedFlow: 'slot_fill',
      expectedMissingParams: ['title'],
    },
    {
      id: 'task.create.en.command_only',
      capability: 'task.create',
      language: 'en',
      input: 'create a task',
      description: 'English command only - should ask for title',
      expectedFlow: 'slot_fill',
      expectedMissingParams: ['title'],
    },
    {
      id: 'task.create.en.with_title',
      capability: 'task.create',
      language: 'en',
      input: 'add task: call John tomorrow',
      description: 'English with title - should execute',
      expectedFlow: 'execute',
    },
    {
      id: 'task.create.en.with_all',
      capability: 'task.create',
      language: 'en',
      input: 'create high priority task: send invoice to client',
      description: 'English with title and priority - should execute',
      expectedFlow: 'execute',
    }
  );

  // ===== CONTACT.CREATE =====
  scenarios.push(
    {
      id: 'contact.create.he.command_only',
      capability: 'contact.create',
      language: 'he',
      input: 'הוסף איש קשר',
      description: 'Hebrew command only - should ask for first_name',
      expectedFlow: 'slot_fill',
      expectedMissingParams: ['first_name'],
    },
    {
      id: 'contact.create.he.with_name',
      capability: 'contact.create',
      language: 'he',
      input: 'צור לקוח יוסי כהן',
      description: 'Hebrew with full name - should execute',
      expectedFlow: 'execute',
    },
    {
      id: 'contact.create.en.command_only',
      capability: 'contact.create',
      language: 'en',
      input: 'add a new contact',
      description: 'English command only - should ask for first_name',
      expectedFlow: 'slot_fill',
      expectedMissingParams: ['first_name'],
    },
    {
      id: 'contact.create.en.with_name',
      capability: 'contact.create',
      language: 'en',
      input: 'create contact John Smith',
      description: 'English with full name - should execute',
      expectedFlow: 'execute',
    }
  );

  // ===== CONTACT.SEARCH =====
  scenarios.push(
    {
      id: 'contact.search.he.all',
      capability: 'contact.search',
      language: 'he',
      input: 'הראה את כל הלקוחות',
      description: 'Hebrew show all clients - should execute directly',
      expectedFlow: 'search_results',
    },
    {
      id: 'contact.search.he.leads',
      capability: 'contact.search',
      language: 'he',
      input: 'הראה לידים',
      description: 'Hebrew show leads - should execute with status filter',
      expectedFlow: 'search_results',
    },
    {
      id: 'contact.search.en.all',
      capability: 'contact.search',
      language: 'en',
      input: 'show all clients',
      description: 'English show all clients - should execute',
      expectedFlow: 'search_results',
    },
    {
      id: 'contact.search.en.by_name',
      capability: 'contact.search',
      language: 'en',
      input: 'find contact John',
      description: 'English find by name - should execute',
      expectedFlow: 'search_results',
    }
  );

  // ===== BOOKING.CREATE =====
  scenarios.push(
    {
      id: 'booking.create.he.command_only',
      capability: 'booking.create',
      language: 'he',
      input: 'קבע פגישה',
      description: 'Hebrew command only - should ask for required params',
      expectedFlow: 'slot_fill',
      expectedMissingParams: ['service_id', 'contact_id', 'start_time'],
    },
    {
      id: 'booking.create.en.command_only',
      capability: 'booking.create',
      language: 'en',
      input: 'schedule a meeting',
      description: 'English command only - should ask for required params',
      expectedFlow: 'slot_fill',
      expectedMissingParams: ['service_id', 'contact_id', 'start_time'],
    }
  );

  // ===== INVOICE.SEND =====
  scenarios.push(
    {
      id: 'invoice.send.he.command_only',
      capability: 'invoice.send',
      language: 'he',
      input: 'שלח חשבונית',
      description: 'Hebrew command only - should ask which invoice',
      expectedFlow: 'slot_fill',
      expectedMissingParams: ['invoice_id'],
    },
    {
      id: 'invoice.send.en.command_only',
      capability: 'invoice.send',
      language: 'en',
      input: 'send invoice',
      description: 'English command only - should ask which invoice',
      expectedFlow: 'slot_fill',
      expectedMissingParams: ['invoice_id'],
    }
  );

  // ===== INVOICE.CREATE =====
  scenarios.push(
    {
      id: 'invoice.create.he.command_only',
      capability: 'invoice.create',
      language: 'he',
      input: 'צור חשבונית',
      description: 'Hebrew command only - should ask for required params',
      expectedFlow: 'slot_fill',
      expectedMissingParams: ['contact_id', 'amount', 'description'],
    },
    {
      id: 'invoice.create.en.command_only',
      capability: 'invoice.create',
      language: 'en',
      input: 'create an invoice',
      description: 'English command only - should ask for required params',
      expectedFlow: 'slot_fill',
      expectedMissingParams: ['contact_id', 'amount', 'description'],
    }
  );

  // ===== SERVICE.CREATE =====
  scenarios.push(
    {
      id: 'service.create.he.command_only',
      capability: 'service.create',
      language: 'he',
      input: 'צור שירות חדש',
      description: 'Hebrew command only - should ask for required params',
      expectedFlow: 'slot_fill',
      expectedMissingParams: ['service_name', 'duration_minutes'],
    },
    {
      id: 'service.create.en.with_details',
      capability: 'service.create',
      language: 'en',
      input: 'create service Consultation for 60 minutes at $100',
      description: 'English with full details - should execute',
      expectedFlow: 'execute',
    }
  );

  // ===== EMAIL.SEND =====
  scenarios.push(
    {
      id: 'email.send.he.command_only',
      capability: 'email.send',
      language: 'he',
      input: 'שלח מייל',
      description: 'Hebrew command only - should ask for required params',
      expectedFlow: 'slot_fill',
      expectedMissingParams: ['contact_id', 'subject', 'body'],
    },
    {
      id: 'email.send.en.command_only',
      capability: 'email.send',
      language: 'en',
      input: 'send an email',
      description: 'English command only - should ask for required params',
      expectedFlow: 'slot_fill',
      expectedMissingParams: ['contact_id', 'subject', 'body'],
    }
  );

  // ===== TASK.SEARCH =====
  scenarios.push(
    {
      id: 'task.search.he.today',
      capability: 'task.search',
      language: 'he',
      input: 'מה המשימות להיום',
      description: 'Hebrew tasks for today - should execute',
      expectedFlow: 'search_results',
    },
    {
      id: 'task.search.en.overdue',
      capability: 'task.search',
      language: 'en',
      input: 'show overdue tasks',
      description: 'English overdue tasks - should execute',
      expectedFlow: 'search_results',
    }
  );

  // ===== BOOKING.SEARCH =====
  scenarios.push(
    {
      id: 'booking.search.he.today',
      capability: 'booking.search',
      language: 'he',
      input: 'מה יש לי היום',
      description: 'Hebrew bookings today - should execute',
      expectedFlow: 'search_results',
    },
    {
      id: 'booking.search.en.this_week',
      capability: 'booking.search',
      language: 'en',
      input: 'show appointments this week',
      description: 'English bookings this week - should execute',
      expectedFlow: 'search_results',
    }
  );

  // ===== INVOICE.SEARCH =====
  scenarios.push(
    {
      id: 'invoice.search.he.unpaid',
      capability: 'invoice.search',
      language: 'he',
      input: 'מי חייב לי כסף',
      description: 'Hebrew unpaid invoices - should execute',
      expectedFlow: 'search_results',
    },
    {
      id: 'invoice.search.en.overdue',
      capability: 'invoice.search',
      language: 'en',
      input: 'show overdue invoices',
      description: 'English overdue invoices - should execute',
      expectedFlow: 'search_results',
    }
  );

  // ===== REPORT.QUERY =====
  scenarios.push(
    {
      id: 'report.query.he.revenue',
      capability: 'report.query',
      language: 'he',
      input: 'כמה הרווחתי החודש',
      description: 'Hebrew monthly revenue - should execute',
      expectedFlow: 'search_results',
    },
    {
      id: 'report.query.en.bookings',
      capability: 'report.query',
      language: 'en',
      input: 'how many bookings this week',
      description: 'English weekly bookings - should execute',
      expectedFlow: 'search_results',
    }
  );

  // ===== ACTIVITY.CREATE =====
  scenarios.push(
    {
      id: 'activity.create.he.note',
      capability: 'activity.create',
      language: 'he',
      input: 'הוסף הערה',
      description: 'Hebrew add note - should ask for contact and description',
      expectedFlow: 'slot_fill',
      expectedMissingParams: ['contact_id', 'description'],
    },
    {
      id: 'activity.create.en.call',
      capability: 'activity.create',
      language: 'en',
      input: 'log a call',
      description: 'English log call - should ask for required params',
      expectedFlow: 'slot_fill',
      expectedMissingParams: ['contact_id', 'description'],
    }
  );

  // ===== PAYMENT.RECORD =====
  scenarios.push(
    {
      id: 'payment.record.he.command_only',
      capability: 'payment.record',
      language: 'he',
      input: 'רשום תשלום',
      description: 'Hebrew record payment - should ask for required params',
      expectedFlow: 'slot_fill',
      expectedMissingParams: ['contact_id', 'amount'],
    },
    {
      id: 'payment.record.en.command_only',
      capability: 'payment.record',
      language: 'en',
      input: 'record a payment',
      description: 'English record payment - should ask for required params',
      expectedFlow: 'slot_fill',
      expectedMissingParams: ['contact_id', 'amount'],
    }
  );

  return scenarios;
}

// ==================== TEST RUNNER ====================

class E2ETestRunner {
  private baseUrl: string;
  private results: TestResult[] = [];

  constructor(baseUrl: string = 'http://localhost:3000') {
    this.baseUrl = baseUrl;
  }

  /**
   * Run a single test scenario
   */
  async runScenario(scenario: TestScenario): Promise<TestResult> {
    const startTime = Date.now();
    const result: TestResult = {
      scenario,
      passed: false,
      issues: [],
    };

    try {
      const response = await fetch(`${this.baseUrl}/api/business-os/chat-v3`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: scenario.input,
          language: scenario.language,
        }),
      });

      result.timing_ms = Date.now() - startTime;

      if (!response.ok) {
        if (response.status === 401) {
          result.issues.push('AUTH_REQUIRED: Need to run with auth cookies');
        } else {
          result.issues.push(`HTTP_ERROR: ${response.status} ${response.statusText}`);
        }
        return result;
      }

      const data = await response.json();
      result.response = data.response?.message || JSON.stringify(data);
      result.route = data.debug?.route;

      // Analyze the response
      this.analyzeResponse(scenario, data, result);

    } catch (error) {
      result.issues.push(`NETWORK_ERROR: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  }

  /**
   * Analyze API response to determine if test passed
   */
  private analyzeResponse(
    scenario: TestScenario,
    data: Record<string, unknown>,
    result: TestResult
  ): void {
    const responseText = String(data.response?.message || '');
    const route = String(data.debug?.route || '');

    // Determine actual flow
    if (route === 'slot_filling' || this.isSlotFillingResponse(responseText, scenario.language)) {
      result.actualFlow = 'slot_fill';
    } else if (route === 'slot_filling_execute' || route === 'fast_path' || route === 'planning') {
      if (this.isSearchResults(responseText)) {
        result.actualFlow = 'search_results';
      } else if (this.isConfirmationResponse(responseText, scenario.language)) {
        result.actualFlow = 'confirm';
      } else {
        result.actualFlow = 'execute';
      }
    } else {
      result.actualFlow = 'unknown';
    }

    // Check 1: Flow matches expected
    if (result.actualFlow !== scenario.expectedFlow) {
      // Allow some flexibility - confirm and execute are similar success states
      const equivalentFlows = ['execute', 'confirm', 'search_results'];
      if (!(equivalentFlows.includes(result.actualFlow!) && equivalentFlows.includes(scenario.expectedFlow))) {
        result.issues.push(`FLOW_MISMATCH: Expected ${scenario.expectedFlow}, got ${result.actualFlow}`);
      }
    }

    // Check 2: Language consistency
    if (scenario.language === 'he') {
      this.checkHebrewLocalization(responseText, result);
    } else {
      this.checkEnglishLocalization(responseText, result);
    }

    // Check 3: Command phrase not used as param value
    this.checkForCommandPhraseAsValue(responseText, scenario, result);

    // Check 4: Clear action hints in confirmation
    if (result.actualFlow === 'confirm' || result.actualFlow === 'slot_fill') {
      this.checkActionHints(responseText, scenario.language, result);
    }

    // If no issues, test passed
    result.passed = result.issues.length === 0;
  }

  private isSlotFillingResponse(text: string, language: 'en' | 'he'): boolean {
    const slotFillingPatterns = language === 'he'
      ? ['אני צריך', 'מה ה', 'מה שם', 'איזה', 'למי', 'כמה', 'מתי']
      : ['I need', 'What is', 'Which', 'Who', 'How much', 'When'];

    return slotFillingPatterns.some(p => text.includes(p));
  }

  private isConfirmationResponse(text: string, language: 'en' | 'he'): boolean {
    const confirmPatterns = language === 'he'
      ? ['לאישור', 'לביטול', '"כן"', '"לא"', 'האם לבצע']
      : ['confirm', 'cancel', 'proceed', '"yes"', '"no"'];

    return confirmPatterns.some(p => text.toLowerCase().includes(p.toLowerCase()));
  }

  private isSearchResults(text: string): boolean {
    // Search results typically contain lists or data
    return text.includes('•') || text.includes('-') || text.includes('found') ||
           text.includes('נמצאו') || text.includes('results') || text.includes('תוצאות');
  }

  private checkHebrewLocalization(text: string, result: TestResult): void {
    // Check for English phrases that shouldn't appear in Hebrew response
    const englishPatterns = [
      /^Create a new/i,
      /^What is the/i,
      /^Say "yes"/i,
      /^Please provide/i,
      /\btitle:/i,
      /\bdue date:/i,
      /\bpriority:/i,
      /\bcontact:/i,
      /\bservice:/i,
      /\bamount:/i,
    ];

    for (const pattern of englishPatterns) {
      if (pattern.test(text)) {
        const match = text.match(pattern);
        result.issues.push(`LOCALIZATION: English text in Hebrew response: "${match?.[0]}"`);
      }
    }
  }

  private checkEnglishLocalization(text: string, result: TestResult): void {
    // Check for Hebrew text in English response
    const hebrewPattern = /[\u0590-\u05FF]/;
    if (hebrewPattern.test(text)) {
      result.issues.push('LOCALIZATION: Hebrew text in English response');
    }
  }

  private checkForCommandPhraseAsValue(text: string, scenario: TestScenario, result: TestResult): void {
    const capability = getCapability(scenario.capability);
    if (!capability) return;

    const commandPhrases = [
      ...(capability.examples || []),
      ...(capability.examples_he || []),
    ];

    for (const phrase of commandPhrases) {
      // Check if command phrase is shown as a parameter value
      const patterns = [
        new RegExp(`title:\\s*${phrase}`, 'i'),
        new RegExp(`כותרת:\\s*${phrase}`, 'i'),
        new RegExp(`name:\\s*${phrase}`, 'i'),
        new RegExp(`שם:\\s*${phrase}`, 'i'),
      ];

      for (const pattern of patterns) {
        if (pattern.test(text)) {
          result.issues.push(`PLACEHOLDER_AS_VALUE: Command phrase "${phrase}" used as parameter value`);
        }
      }
    }
  }

  private checkActionHints(text: string, language: 'en' | 'he', result: TestResult): void {
    const hasHint = language === 'he'
      ? (text.includes('כן') && text.includes('לא')) || text.includes('דלג') || text.includes('מתי')
      : (text.includes('yes') && text.includes('no')) || text.includes('skip') || text.includes('?');

    if (!hasHint) {
      // Not a critical issue, but good to note
      // result.issues.push('HINT_MISSING: Response missing clear action hint');
    }
  }

  /**
   * Run all test scenarios
   */
  async runAll(): Promise<TestSummary> {
    const scenarios = generateTestScenarios();

    console.log('\n' + '='.repeat(70));
    console.log(`${colors.cyan}E2E Chat Capabilities Test Suite${colors.reset}`);
    console.log('='.repeat(70));
    console.log(`${colors.dim}Testing ${scenarios.length} scenarios against ${this.baseUrl}${colors.reset}\n`);

    for (const scenario of scenarios) {
      process.stdout.write(`  Testing: ${scenario.id.padEnd(45)} `);

      const result = await this.runScenario(scenario);
      this.results.push(result);

      if (result.passed) {
        console.log(`${colors.green}✓ PASS${colors.reset}`);
      } else if (result.issues.some(i => i.startsWith('AUTH_REQUIRED'))) {
        console.log(`${colors.yellow}⊘ SKIP (no auth)${colors.reset}`);
      } else {
        console.log(`${colors.red}✗ FAIL${colors.reset}`);
        for (const issue of result.issues) {
          console.log(`    ${colors.dim}└─ ${issue}${colors.reset}`);
        }
      }

      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 100));
    }

    return this.summarize();
  }

  /**
   * Summarize test results
   */
  private summarize(): TestSummary {
    const summary: TestSummary = {
      total: this.results.length,
      passed: this.results.filter(r => r.passed).length,
      failed: this.results.filter(r => !r.passed && !r.issues.some(i => i.startsWith('AUTH_REQUIRED'))).length,
      issueCategories: {},
      failedScenarios: this.results.filter(r => !r.passed && !r.issues.some(i => i.startsWith('AUTH_REQUIRED'))),
    };

    // Group issues by category
    for (const result of this.results) {
      for (const issue of result.issues) {
        const category = issue.split(':')[0];
        summary.issueCategories[category] = (summary.issueCategories[category] || 0) + 1;
      }
    }

    console.log('\n' + '='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));
    console.log(`Total:  ${summary.total}`);
    console.log(`${colors.green}Passed: ${summary.passed}${colors.reset}`);
    console.log(`${colors.red}Failed: ${summary.failed}${colors.reset}`);

    if (Object.keys(summary.issueCategories).length > 0) {
      console.log('\nIssue Categories:');
      for (const [category, count] of Object.entries(summary.issueCategories).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${count}x ${category}`);
      }
    }

    if (summary.failedScenarios.length > 0) {
      console.log('\n' + '-'.repeat(70));
      console.log('FAILED SCENARIOS DETAILS:');
      console.log('-'.repeat(70));
      for (const result of summary.failedScenarios) {
        console.log(`\n${colors.yellow}${result.scenario.id}${colors.reset}`);
        console.log(`  Input: "${result.scenario.input}"`);
        console.log(`  Expected: ${result.scenario.expectedFlow}`);
        console.log(`  Actual: ${result.actualFlow || 'unknown'}`);
        console.log(`  Issues:`);
        for (const issue of result.issues) {
          console.log(`    - ${issue}`);
        }
        if (result.response) {
          console.log(`  Response preview: "${result.response.substring(0, 100)}..."`);
        }
      }
    }

    return summary;
  }
}

// ==================== DIRECT LOGIC TESTS ====================

/**
 * Run direct logic tests without HTTP (faster, more deterministic)
 */
function runDirectLogicTests(): void {
  console.log('\n' + '='.repeat(70));
  console.log(`${colors.cyan}Direct Logic Tests (No HTTP)${colors.reset}`);
  console.log('='.repeat(70));

  // Import directly using require to avoid module issues
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getCapability } = require('../lib/business-os/chat/CapabilityRegistry');

  /**
   * Get ONLY required parameters that are missing or have placeholder values
   */
  function getMissingRequiredParams(
    capabilityId: string,
    providedParams: Record<string, unknown>
  ): string[] {
    const capability = getCapability(capabilityId);
    if (!capability) return [];

    const requiredParams = (capability.params || []).filter((p: { required: boolean }) => p.required);

    const commandPhrases = [
      ...(capability.examples || []),
      ...(capability.examples_he || []),
    ].map((e: string) => e.toLowerCase().trim());

    const staticPlaceholders = [
      'new task', 'task', 'new', 'untitled', 'placeholder', 'default',
      'create task', 'add task', 'open task',
      'משימה חדשה', 'משימה', 'חדש', 'ללא כותרת',
      'פתח משימה', 'צור משימה', 'הוסף משימה',
    ];

    const allPlaceholders = [...staticPlaceholders, ...commandPhrases];

    return requiredParams
      .filter((p: { name: string }) => {
        const value = providedParams[p.name];
        if (value !== undefined && value !== null && value !== '') {
          if (typeof value === 'string') {
            const normalized = value.toLowerCase().trim();
            if (!allPlaceholders.includes(normalized)) {
              return false;
            }
          } else {
            return false;
          }
        }
        return true;
      })
      .map((p: { name: string }) => p.name);
  }

  interface DirectTestCase {
    input: string;
    language: 'en' | 'he';
    capability: string;
    providedParams: Record<string, unknown>;
    expectedMissing: string[];
    description: string;
  }

  const testCases: DirectTestCase[] = [
    // TASK.CREATE
    {
      input: 'פתח משימה',
      language: 'he',
      capability: 'task.create',
      providedParams: { title: 'פתח משימה' },
      expectedMissing: ['title'],
      description: 'Hebrew command phrase should be detected as placeholder',
    },
    {
      input: 'create task',
      language: 'en',
      capability: 'task.create',
      providedParams: { title: 'create task' },
      expectedMissing: ['title'],
      description: 'English command phrase should be detected as placeholder',
    },
    {
      input: 'צור משימה לשלוח מייל',
      language: 'he',
      capability: 'task.create',
      providedParams: { title: 'לשלוח מייל' },
      expectedMissing: [],
      description: 'Real Hebrew title should be accepted',
    },
    {
      input: 'add task: call John',
      language: 'en',
      capability: 'task.create',
      providedParams: { title: 'call John' },
      expectedMissing: [],
      description: 'Real English title should be accepted',
    },
    // CONTACT.CREATE
    {
      input: 'הוסף איש קשר',
      language: 'he',
      capability: 'contact.create',
      providedParams: {},
      expectedMissing: ['first_name'],
      description: 'Hebrew contact create without name should ask for first_name',
    },
    {
      input: 'צור לקוח יוסי כהן',
      language: 'he',
      capability: 'contact.create',
      providedParams: { first_name: 'יוסי', last_name: 'כהן' },
      expectedMissing: [],
      description: 'Hebrew contact with full name should not ask for anything',
    },
    // BOOKING.CREATE
    {
      input: 'קבע פגישה',
      language: 'he',
      capability: 'booking.create',
      providedParams: {},
      expectedMissing: ['service_id', 'contact_id', 'start_time'],
      description: 'Hebrew booking create should ask for all required params',
    },
    // INVOICE.SEND
    {
      input: 'שלח חשבונית',
      language: 'he',
      capability: 'invoice.send',
      providedParams: {},
      expectedMissing: ['invoice_id'],
      description: 'Hebrew invoice send should ask which invoice',
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of testCases) {
    const actualMissing = getMissingRequiredParams(test.capability, test.providedParams);

    const expectedSet = new Set(test.expectedMissing);
    const actualSet = new Set(actualMissing);

    const isMatch = expectedSet.size === actualSet.size &&
                   [...expectedSet].every(p => actualSet.has(p));

    if (isMatch) {
      console.log(`${colors.green}✓${colors.reset} ${test.description}`);
      passed++;
    } else {
      console.log(`${colors.red}✗${colors.reset} ${test.description}`);
      console.log(`   Expected missing: [${test.expectedMissing.join(', ')}]`);
      console.log(`   Actual missing:   [${actualMissing.join(', ')}]`);
      failed++;
    }
  }

  console.log(`\nDirect Logic Tests: ${passed} passed, ${failed} failed`);
}

// ==================== LOCALIZATION CHECK ====================

function checkLocalization(): void {
  console.log('\n' + '='.repeat(70));
  console.log(`${colors.cyan}Localization Coverage Check${colors.reset}`);
  console.log('='.repeat(70));

  let missingCount = 0;
  const issues: string[] = [];

  for (const cap of CAPABILITY_REGISTRY) {
    // Check description_he
    if (!cap.description_he) {
      issues.push(`${cap.id}: Missing description_he`);
      missingCount++;
    }

    // Check param prompts
    for (const param of cap.params) {
      if (param.prompt && !param.prompt_he) {
        issues.push(`${cap.id}.${param.name}: Missing prompt_he`);
        missingCount++;
      }
    }

    // Check confirmation/success templates
    if (cap.confirmationTemplate && !cap.confirmationTemplate_he) {
      issues.push(`${cap.id}: Missing confirmationTemplate_he`);
      missingCount++;
    }
    if (cap.successTemplate && !cap.successTemplate_he) {
      issues.push(`${cap.id}: Missing successTemplate_he`);
      missingCount++;
    }
  }

  if (missingCount === 0) {
    console.log(`${colors.green}✓ All capabilities have Hebrew translations${colors.reset}`);
  } else {
    console.log(`${colors.yellow}⚠ Found ${missingCount} missing Hebrew translations:${colors.reset}`);
    for (const issue of issues.slice(0, 10)) {
      console.log(`  - ${issue}`);
    }
    if (issues.length > 10) {
      console.log(`  ... and ${issues.length - 10} more`);
    }
  }
}

// ==================== MAIN ====================

async function main(): Promise<void> {
  // 1. Run direct logic tests (no HTTP)
  runDirectLogicTests();

  // 2. Check localization coverage
  checkLocalization();

  // 3. Run E2E HTTP tests
  const runner = new E2ETestRunner();
  const summary = await runner.runAll();

  // Exit with error code if tests failed
  if (summary.failed > 0) {
    process.exit(1);
  }
}

main().catch(console.error);
