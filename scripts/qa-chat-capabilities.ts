/**
 * QA Test Script for Chat V3 Capabilities
 *
 * Tests all capabilities with various inputs in multiple languages
 * to identify slot-filling and confirmation flow issues.
 *
 * Usage: npx ts-node scripts/qa-chat-capabilities.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

// Test scenarios for each capability
interface TestScenario {
  capability: string;
  description: string;
  tests: Array<{
    name: string;
    language: 'en' | 'he' | 'es';
    messages: string[];  // Conversation flow
    expectedFlow: 'direct_execute' | 'slot_fill' | 'confirm_then_execute';
    expectedParams?: Record<string, unknown>;
  }>;
}

const TEST_SCENARIOS: TestScenario[] = [
  // ==================== TASK ====================
  {
    capability: 'task.create',
    description: 'Create a new task',
    tests: [
      {
        name: 'Command only - should ask for title',
        language: 'he',
        messages: ['פתח משימה'],
        expectedFlow: 'slot_fill',
      },
      {
        name: 'Command with title - should confirm',
        language: 'he',
        messages: ['פתח משימה לשלוח מייל ליוסי'],
        expectedFlow: 'confirm_then_execute',
        expectedParams: { title: 'לשלוח מייל ליוסי' },
      },
      {
        name: 'Full details - should confirm',
        language: 'he',
        messages: ['צור משימה: להתקשר לדוד, עדיפות גבוהה, עד מחר'],
        expectedFlow: 'confirm_then_execute',
        expectedParams: { title: 'להתקשר לדוד', priority: 'high' },
      },
      {
        name: 'English - command only',
        language: 'en',
        messages: ['create a task'],
        expectedFlow: 'slot_fill',
      },
      {
        name: 'English - with title',
        language: 'en',
        messages: ['add task: call John tomorrow'],
        expectedFlow: 'confirm_then_execute',
        expectedParams: { title: 'call John tomorrow' },
      },
    ],
  },

  // ==================== CONTACT ====================
  {
    capability: 'contact.create',
    description: 'Create a new contact',
    tests: [
      {
        name: 'Command only - should ask for name',
        language: 'he',
        messages: ['הוסף איש קשר'],
        expectedFlow: 'slot_fill',
      },
      {
        name: 'With name - should confirm',
        language: 'he',
        messages: ['הוסף איש קשר יוסי כהן'],
        expectedFlow: 'confirm_then_execute',
        expectedParams: { first_name: 'יוסי', last_name: 'כהן' },
      },
      {
        name: 'With full details',
        language: 'he',
        messages: ['צור לקוח חדש: דוד לוי, טלפון 0501234567, מייל david@test.com'],
        expectedFlow: 'confirm_then_execute',
      },
    ],
  },

  // ==================== SEARCH ====================
  {
    capability: 'contact.search',
    description: 'Search contacts',
    tests: [
      {
        name: 'Search by name',
        language: 'he',
        messages: ['חפש את יוסי'],
        expectedFlow: 'direct_execute',
      },
      {
        name: 'Search leads',
        language: 'he',
        messages: ['הראה לי את הלידים'],
        expectedFlow: 'direct_execute',
        expectedParams: { status: 'lead' },
      },
      {
        name: 'Who owes money',
        language: 'he',
        messages: ['מי חייב לי כסף'],
        expectedFlow: 'direct_execute',
      },
    ],
  },

  // ==================== BOOKING ====================
  {
    capability: 'booking.create',
    description: 'Create a booking',
    tests: [
      {
        name: 'Command only - should ask for details',
        language: 'he',
        messages: ['קבע פגישה'],
        expectedFlow: 'slot_fill',
      },
      {
        name: 'With contact and service',
        language: 'he',
        messages: ['קבע פגישה ליוסי כהן, ייעוץ, מחר בשעה 10'],
        expectedFlow: 'confirm_then_execute',
      },
    ],
  },

  // ==================== INVOICE ====================
  {
    capability: 'invoice.search',
    description: 'Search invoices',
    tests: [
      {
        name: 'Unpaid invoices',
        language: 'he',
        messages: ['הראה חשבוניות שלא שולמו'],
        expectedFlow: 'direct_execute',
        expectedParams: { status: 'overdue' },
      },
      {
        name: 'All invoices',
        language: 'he',
        messages: ['הראה את כל החשבוניות'],
        expectedFlow: 'direct_execute',
      },
    ],
  },
];

// ==================== TEST RUNNER ====================

interface TestResult {
  scenario: string;
  testName: string;
  language: string;
  passed: boolean;
  expectedFlow: string;
  actualFlow: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  issues: string[];
}

async function runTest(
  scenario: TestScenario,
  test: TestScenario['tests'][0],
  baseUrl: string,
  authToken: string
): Promise<TestResult> {
  const result: TestResult = {
    scenario: scenario.capability,
    testName: test.name,
    language: test.language,
    passed: false,
    expectedFlow: test.expectedFlow,
    actualFlow: 'unknown',
    messages: [],
    issues: [],
  };

  try {
    // Send the first message
    const response = await fetch(`${baseUrl}/api/business-os/chat-v3`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `sb-access-token=${authToken}`,
      },
      body: JSON.stringify({
        message: test.messages[0],
        language: test.language,
      }),
    });

    if (!response.ok) {
      result.issues.push(`HTTP ${response.status}: ${response.statusText}`);
      return result;
    }

    const data = await response.json();
    result.messages.push({ role: 'user', content: test.messages[0] });
    result.messages.push({ role: 'assistant', content: data.message || data.response?.message || JSON.stringify(data) });

    // Analyze the response
    const responseText = (data.message || data.response?.message || '').toLowerCase();
    const hasConfirmation = data.response?.confirmationRequired ||
                           responseText.includes('האם לבצע') ||
                           responseText.includes('proceed?') ||
                           responseText.includes('כן') && responseText.includes('לא');

    const isSlotFilling = responseText.includes('מה ה') ||
                         responseText.includes('what is the') ||
                         responseText.includes('אני צריך') ||
                         responseText.includes('i need');

    const isDirectResult = data.results || data.data ||
                          (data.success && !hasConfirmation && !isSlotFilling);

    // Determine actual flow
    if (isSlotFilling) {
      result.actualFlow = 'slot_fill';
    } else if (hasConfirmation) {
      result.actualFlow = 'confirm_then_execute';
    } else if (isDirectResult) {
      result.actualFlow = 'direct_execute';
    } else {
      result.actualFlow = 'unknown';
      result.issues.push(`Could not determine flow from response: ${responseText.substring(0, 200)}`);
    }

    // Check if flow matches expected
    if (result.actualFlow === test.expectedFlow) {
      result.passed = true;
    } else {
      result.issues.push(`Expected ${test.expectedFlow} but got ${result.actualFlow}`);
    }

    // Check for common issues
    analyzeForIssues(result, data, test);

  } catch (error) {
    result.issues.push(`Error: ${error instanceof Error ? error.message : String(error)}`);
  }

  return result;
}

function analyzeForIssues(
  result: TestResult,
  data: Record<string, unknown>,
  test: TestScenario['tests'][0]
): void {
  const responseText = String(data.message || data.response?.message || '');

  // Issue: English response for Hebrew input
  if (test.language === 'he') {
    const englishPatterns = [
      'Create a new',
      'What is the',
      'Say "yes"',
      'Proceed?',
      'title:',
      'due date:',
      'priority:',
    ];
    for (const pattern of englishPatterns) {
      if (responseText.includes(pattern)) {
        result.issues.push(`English text in Hebrew response: "${pattern}"`);
        result.passed = false;
      }
    }
  }

  // Issue: Command phrase used as parameter value
  const commandPhrases = ['פתח משימה', 'צור משימה', 'הוסף משימה', 'create task', 'add task'];
  for (const phrase of commandPhrases) {
    if (responseText.toLowerCase().includes(`title: ${phrase}`) ||
        responseText.includes(`כותרת: ${phrase}`)) {
      result.issues.push(`Command phrase "${phrase}" used as parameter value`);
      result.passed = false;
    }
  }

  // Issue: Missing action hint in confirmation
  if (result.actualFlow === 'confirm_then_execute') {
    const hasActionHint = responseText.includes('כן') ||
                         responseText.includes('yes') ||
                         responseText.includes('confirm');
    if (!hasActionHint) {
      result.issues.push('Confirmation missing action hint (what to say next)');
    }
  }

  // Issue: Showing optional params that weren't provided
  if (result.actualFlow === 'confirm_then_execute') {
    const showsEmptyOptional = responseText.includes(': -') ||
                               responseText.includes(': \n');
    if (showsEmptyOptional) {
      result.issues.push('Confirmation shows empty optional parameters');
    }
  }
}

async function runAllTests(baseUrl: string, authToken: string): Promise<void> {
  console.log('='.repeat(60));
  console.log('Chat V3 Capability QA Tests');
  console.log('='.repeat(60));
  console.log();

  const allResults: TestResult[] = [];
  let passed = 0;
  let failed = 0;

  for (const scenario of TEST_SCENARIOS) {
    console.log(`\n## ${scenario.capability} - ${scenario.description}`);
    console.log('-'.repeat(40));

    for (const test of scenario.tests) {
      const result = await runTest(scenario, test, baseUrl, authToken);
      allResults.push(result);

      const status = result.passed ? '✅' : '❌';
      console.log(`${status} ${test.name} [${test.language}]`);

      if (!result.passed) {
        failed++;
        for (const issue of result.issues) {
          console.log(`   ⚠️  ${issue}`);
        }
        if (result.messages.length > 0) {
          console.log(`   Response: ${result.messages[1]?.content.substring(0, 100)}...`);
        }
      } else {
        passed++;
      }

      // Small delay between tests
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  console.log(`Pass rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);

  // Group issues
  const issueGroups: Record<string, number> = {};
  for (const result of allResults) {
    for (const issue of result.issues) {
      const key = issue.split(':')[0];
      issueGroups[key] = (issueGroups[key] || 0) + 1;
    }
  }

  if (Object.keys(issueGroups).length > 0) {
    console.log('\nIssue Categories:');
    for (const [issue, count] of Object.entries(issueGroups).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${count}x ${issue}`);
    }
  }
}

// ==================== MAIN ====================

async function main(): Promise<void> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  // You'll need to provide auth token
  const authToken = process.env.QA_AUTH_TOKEN || '';

  if (!authToken) {
    console.log('Running in dry-run mode (no auth token)');
    console.log('To run actual tests, set QA_AUTH_TOKEN env var');
    console.log('\nTest scenarios that would be run:');
    for (const scenario of TEST_SCENARIOS) {
      console.log(`\n${scenario.capability}:`);
      for (const test of scenario.tests) {
        console.log(`  - ${test.name} [${test.language}]: "${test.messages[0]}"`);
      }
    }
    return;
  }

  await runAllTests(baseUrl, authToken);
}

main().catch(console.error);
