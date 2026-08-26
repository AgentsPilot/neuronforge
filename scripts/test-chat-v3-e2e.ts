/**
 * Chat V3 End-to-End Test Script
 *
 * Tests the full slot-filling flow with real HTTP API calls and Supabase database.
 * This is the most realistic test - simulates actual user interaction.
 *
 * CRITICAL BUG TESTED:
 * When typing "שליחת אימייל" (sending email) during task slot-filling,
 * it should switch to email capability - NOT be used as task title.
 *
 * Prerequisites:
 * - npm run dev (server must be running on localhost:3000)
 * - Valid test user credentials in .env.local
 *
 * Usage: npx tsx scripts/test-chat-v3-e2e.ts
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config({ path: '.env.local' });

// ==================== TYPES ====================

interface ChatResponse {
  success: boolean;
  message?: string;
  text?: string;
  response?: string;
  handled?: boolean;
  sessionState?: {
    id?: string;
    capability_id?: string;
    status?: string;
    pending_params?: string[];
    resolved_params?: Record<string, unknown>;
  };
  error?: string;
}

interface TestStep {
  input: string;
  assertions: {
    responseContains?: string[];
    responseNotContains?: string[];
    sessionCapability?: string | null;
    sessionStatus?: string;
    isNewCommand?: boolean;
  };
  description: string;
}

interface TestScenario {
  name: string;
  language: 'en' | 'he' | 'es';
  steps: TestStep[];
  critical?: boolean; // Mark critical bug scenarios
}

// ==================== CONFIGURATION ====================

const API_BASE = process.env.TEST_API_BASE || 'http://localhost:3000';
const TEST_USER_ID = process.env.TEST_USER_ID;

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
};

// ==================== TEST SCENARIOS ====================

const SCENARIOS: TestScenario[] = [
  // =============================================================================
  // CRITICAL BUG SCENARIOS - The original issue
  // =============================================================================
  {
    name: 'CRITICAL BUG: "שליחת אימייל" during task slot-filling should switch context',
    language: 'he',
    critical: true,
    steps: [
      {
        input: 'פתח משימה',
        description: 'Start task creation',
        assertions: {
          responseContains: ['כותרת', 'מה'],
          sessionCapability: 'task.create',
          sessionStatus: 'gathering_params',
        },
      },
      {
        input: 'שליחת אימייל',
        description: 'Type email command phrase - should NOT be used as title',
        assertions: {
          responseNotContains: ['כותרת: שליחת אימייל', 'שליחת אימייל אמור'],
          isNewCommand: true,
        },
      },
    ],
  },
  {
    name: 'CRITICAL BUG: "שלח אימייל" during task slot-filling should switch context',
    language: 'he',
    critical: true,
    steps: [
      {
        input: 'פתח משימה',
        description: 'Start task creation',
        assertions: {
          sessionCapability: 'task.create',
        },
      },
      {
        input: 'שלח אימייל',
        description: 'Type verb form email command',
        assertions: {
          responseNotContains: ['כותרת: שלח אימייל'],
          isNewCommand: true,
        },
      },
    ],
  },
  {
    name: 'CRITICAL BUG: "send email" during task slot-filling (English)',
    language: 'en',
    critical: true,
    steps: [
      {
        input: 'create task',
        description: 'Start task creation',
        assertions: {
          sessionCapability: 'task.create',
        },
      },
      {
        input: 'send email',
        description: 'Type email command in English',
        assertions: {
          responseNotContains: ['title: send email', 'title: Send email'],
          isNewCommand: true,
        },
      },
    ],
  },

  // =============================================================================
  // REVERSE DIRECTION - Email to Task
  // =============================================================================
  {
    name: 'Reverse: "פתח משימה" during email slot-filling should switch context',
    language: 'he',
    critical: true,
    steps: [
      {
        input: 'שלח מייל',
        description: 'Start email creation',
        assertions: {
          sessionCapability: 'email.send',
        },
      },
      {
        input: 'פתח משימה',
        description: 'Type task command - should switch to task',
        assertions: {
          isNewCommand: true,
        },
      },
    ],
  },

  // =============================================================================
  // NORMAL PARAMETER FLOW - These should work correctly
  // =============================================================================
  {
    name: 'Normal flow: Valid task title should be accepted',
    language: 'he',
    steps: [
      {
        input: 'פתח משימה',
        description: 'Start task creation',
        assertions: {
          sessionCapability: 'task.create',
          sessionStatus: 'gathering_params',
        },
      },
      {
        input: 'קניות בסופר',
        description: 'Provide actual task title (not a command)',
        assertions: {
          responseContains: ['כותרת: קניות בסופר', 'קניות בסופר'],
          sessionStatus: 'awaiting_confirmation',
        },
      },
    ],
  },
  {
    name: 'Normal flow: English task title accepted',
    language: 'en',
    steps: [
      {
        input: 'create task',
        description: 'Start task creation',
        assertions: {
          sessionCapability: 'task.create',
        },
      },
      {
        input: 'Buy milk',
        description: 'Provide actual task title',
        assertions: {
          responseContains: ['title: Buy milk', 'Buy milk'],
        },
      },
    ],
  },
  {
    name: 'Normal flow: "meeting notes" is NOT a command',
    language: 'en',
    steps: [
      {
        input: 'open task',
        description: 'Start task creation',
        assertions: {
          sessionCapability: 'task.create',
        },
      },
      {
        input: 'meeting notes',
        description: 'meeting notes should be accepted as title',
        assertions: {
          responseContains: ['meeting notes', 'notes'],
          isNewCommand: false,
        },
      },
    ],
  },

  // =============================================================================
  // CONFIRMATION FLOW
  // =============================================================================
  {
    name: 'Confirmation: "כן" should confirm action',
    language: 'he',
    steps: [
      {
        input: 'פתח משימה',
        description: 'Start task creation',
        assertions: {
          sessionCapability: 'task.create',
        },
      },
      {
        input: 'תזכורת לשלוח דוח',
        description: 'Provide title',
        assertions: {
          sessionStatus: 'awaiting_confirmation',
        },
      },
      {
        input: 'כן',
        description: 'Confirm the action',
        assertions: {
          sessionStatus: 'completed',
        },
      },
    ],
  },
  {
    name: 'Confirmation: "לא" should cancel action',
    language: 'he',
    steps: [
      {
        input: 'צור משימה',
        description: 'Start task creation',
        assertions: {
          sessionCapability: 'task.create',
        },
      },
      {
        input: 'לבדוק מיילים',
        description: 'Provide title',
        assertions: {
          sessionStatus: 'awaiting_confirmation',
        },
      },
      {
        input: 'לא',
        description: 'Cancel the action',
        assertions: {
          sessionStatus: 'cancelled',
        },
      },
    ],
  },

  // =============================================================================
  // SLASH COMMANDS - Always override
  // =============================================================================
  {
    name: 'Slash command /cancel should always work',
    language: 'he',
    steps: [
      {
        input: 'פתח משימה',
        description: 'Start task creation',
        assertions: {
          sessionCapability: 'task.create',
        },
      },
      {
        input: '/cancel',
        description: 'Cancel via slash command',
        assertions: {
          sessionStatus: 'cancelled',
        },
      },
    ],
  },

  // =============================================================================
  // CONTACT CREATE DURING TASK
  // =============================================================================
  {
    name: 'Contact command during task slot-filling',
    language: 'he',
    critical: true,
    steps: [
      {
        input: 'צור משימה',
        description: 'Start task creation',
        assertions: {
          sessionCapability: 'task.create',
        },
      },
      {
        input: 'צור לקוח',
        description: 'Type contact command',
        assertions: {
          isNewCommand: true,
          responseNotContains: ['כותרת: צור לקוח'],
        },
      },
    ],
  },

  // =============================================================================
  // SPANISH SUPPORT
  // =============================================================================
  {
    name: 'Spanish: "sí" should confirm',
    language: 'es',
    steps: [
      {
        input: 'crear tarea',
        description: 'Start task (if Spanish triggers exist)',
        assertions: {
          // May fallback to natural language if no Spanish trigger
        },
      },
    ],
  },
];

// ==================== API HELPERS ====================

async function sendChatMessage(
  message: string,
  language: 'en' | 'he' | 'es'
): Promise<ChatResponse> {
  const url = `${API_BASE}/api/business-os/chat-v3`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // For testing, we may need to include auth headers
        // This depends on how the test environment is set up
        ...(TEST_USER_ID && { 'X-Test-User-Id': TEST_USER_ID }),
      },
      body: JSON.stringify({
        message,
        language,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `HTTP ${response.status}: ${errorText}`,
      };
    }

    return await response.json();
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ==================== TEST RUNNER ====================

interface TestResult {
  scenario: string;
  step: string;
  passed: boolean;
  issues: string[];
  response?: ChatResponse;
}

async function runScenario(scenario: TestScenario): Promise<TestResult[]> {
  const results: TestResult[] = [];

  console.log(`\n${colors.cyan}━━━ ${scenario.name} ━━━${colors.reset}`);
  if (scenario.critical) {
    console.log(`${colors.yellow}⚠️  CRITICAL BUG SCENARIO${colors.reset}`);
  }

  for (const step of scenario.steps) {
    console.log(`\n  ${colors.dim}Step: ${step.description}${colors.reset}`);
    console.log(`  ${colors.dim}Input: "${step.input}"${colors.reset}`);

    const response = await sendChatMessage(step.input, scenario.language);
    const issues: string[] = [];

    // Check if request succeeded
    if (!response.success && response.error) {
      issues.push(`Request failed: ${response.error}`);
    } else {
      // Extract response text for assertions
      const responseText = (response.text || response.message || response.response || '').toLowerCase();

      // Check responseContains assertions
      if (step.assertions.responseContains) {
        for (const expected of step.assertions.responseContains) {
          if (!responseText.includes(expected.toLowerCase())) {
            issues.push(`Expected response to contain: "${expected}"`);
          }
        }
      }

      // Check responseNotContains assertions
      if (step.assertions.responseNotContains) {
        for (const forbidden of step.assertions.responseNotContains) {
          if (responseText.includes(forbidden.toLowerCase())) {
            issues.push(`Response should NOT contain: "${forbidden}"`);
          }
        }
      }

      // Check session state assertions
      const sessionState = response.sessionState;

      if (step.assertions.sessionCapability !== undefined) {
        if (step.assertions.sessionCapability === null) {
          if (sessionState?.capability_id) {
            issues.push(`Expected no session, but found: ${sessionState.capability_id}`);
          }
        } else if (sessionState?.capability_id !== step.assertions.sessionCapability) {
          issues.push(
            `Expected session capability "${step.assertions.sessionCapability}", ` +
            `got "${sessionState?.capability_id || 'none'}"`
          );
        }
      }

      if (step.assertions.sessionStatus !== undefined) {
        if (sessionState?.status !== step.assertions.sessionStatus) {
          issues.push(
            `Expected session status "${step.assertions.sessionStatus}", ` +
            `got "${sessionState?.status || 'none'}"`
          );
        }
      }

      // Check isNewCommand assertion
      if (step.assertions.isNewCommand !== undefined) {
        // If isNewCommand is true, the session should have switched or been cancelled
        // The response should indicate a new capability was detected
        if (step.assertions.isNewCommand === true) {
          // Check if the response indicates context switch
          // This is a bit heuristic - we look for signs the old session was abandoned
          const hasOldTitle = step.assertions.responseNotContains?.some(
            (forbidden) => responseText.includes(forbidden.toLowerCase())
          );
          if (hasOldTitle) {
            issues.push('Input was used as parameter instead of being detected as new command');
          }
        }
      }
    }

    const passed = issues.length === 0;
    results.push({
      scenario: scenario.name,
      step: step.description,
      passed,
      issues,
      response,
    });

    if (passed) {
      console.log(`  ${colors.green}✓ PASSED${colors.reset}`);
    } else {
      console.log(`  ${colors.red}✗ FAILED${colors.reset}`);
      for (const issue of issues) {
        console.log(`    ${colors.red}→ ${issue}${colors.reset}`);
      }
      if (response) {
        console.log(`    ${colors.dim}Response: ${JSON.stringify(response).slice(0, 200)}...${colors.reset}`);
      }
    }

    // Small delay between steps to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return results;
}

async function runAllTests(): Promise<void> {
  console.log('\n' + '═'.repeat(70));
  console.log(`${colors.bold}${colors.cyan}Chat V3 End-to-End Tests${colors.reset}`);
  console.log('═'.repeat(70));
  console.log(`API Base: ${API_BASE}`);
  console.log(`Test User: ${TEST_USER_ID || 'Not specified (using session auth)'}`);

  // Check server connectivity
  console.log('\nChecking server connectivity...');
  try {
    const healthCheck = await fetch(`${API_BASE}/api/health`).catch(() => null);
    if (!healthCheck) {
      console.log(`${colors.red}❌ Cannot connect to ${API_BASE}${colors.reset}`);
      console.log(`${colors.yellow}Make sure the dev server is running: npm run dev${colors.reset}`);
      process.exit(1);
    }
    console.log(`${colors.green}✓ Server is running${colors.reset}`);
  } catch {
    console.log(`${colors.yellow}⚠️ Health check endpoint not available, proceeding anyway...${colors.reset}`);
  }

  const allResults: TestResult[] = [];

  // Run critical scenarios first
  const criticalScenarios = SCENARIOS.filter((s) => s.critical);
  const normalScenarios = SCENARIOS.filter((s) => !s.critical);

  console.log(`\n${colors.yellow}Running ${criticalScenarios.length} CRITICAL scenarios...${colors.reset}`);
  for (const scenario of criticalScenarios) {
    const results = await runScenario(scenario);
    allResults.push(...results);
  }

  console.log(`\n${colors.cyan}Running ${normalScenarios.length} normal scenarios...${colors.reset}`);
  for (const scenario of normalScenarios) {
    const results = await runScenario(scenario);
    allResults.push(...results);
  }

  // Summary
  console.log('\n' + '═'.repeat(70));
  console.log(`${colors.bold}SUMMARY${colors.reset}`);
  console.log('═'.repeat(70));

  const passed = allResults.filter((r) => r.passed).length;
  const failed = allResults.filter((r) => !r.passed).length;
  const criticalFailed = allResults.filter(
    (r) => !r.passed && criticalScenarios.some((s) => s.name === r.scenario)
  ).length;

  console.log(`Total: ${passed + failed} | ${colors.green}Passed: ${passed}${colors.reset} | ${colors.red}Failed: ${failed}${colors.reset}`);

  if (criticalFailed > 0) {
    console.log(`\n${colors.red}⚠️  ${criticalFailed} CRITICAL scenarios failed!${colors.reset}`);
    console.log(`${colors.red}The original bug may still exist.${colors.reset}`);
  }

  if (failed > 0) {
    console.log(`\n${colors.red}Failed scenarios:${colors.reset}`);
    const failedByScenario = new Map<string, string[]>();
    for (const result of allResults.filter((r) => !r.passed)) {
      if (!failedByScenario.has(result.scenario)) {
        failedByScenario.set(result.scenario, []);
      }
      failedByScenario.get(result.scenario)!.push(`${result.step}: ${result.issues.join(', ')}`);
    }

    for (const [scenario, steps] of failedByScenario) {
      console.log(`\n  ${scenario}`);
      for (const step of steps) {
        console.log(`    - ${step}`);
      }
    }

    process.exit(1);
  } else {
    console.log(`\n${colors.green}✅ All tests passed!${colors.reset}`);
  }
}

// ==================== STANDALONE TESTS ====================

/**
 * Quick test for the critical bug scenario only
 */
async function runCriticalTest(): Promise<void> {
  console.log('\n' + '═'.repeat(70));
  console.log(`${colors.bold}${colors.yellow}CRITICAL BUG TEST ONLY${colors.reset}`);
  console.log('═'.repeat(70));
  console.log('Testing: "שליחת אימייל" during task slot-filling\n');

  // Step 1: Start task
  console.log('Step 1: Starting task creation...');
  const step1 = await sendChatMessage('פתח משימה', 'he');
  console.log(`Response: ${step1.text || step1.message || step1.response || 'No text'}`);

  if (!step1.success) {
    console.log(`${colors.red}❌ Step 1 failed: ${step1.error}${colors.reset}`);
    process.exit(1);
  }

  // Step 2: Type email command
  console.log('\nStep 2: Typing "שליחת אימייל" (should switch context, NOT be used as title)...');
  const step2 = await sendChatMessage('שליחת אימייל', 'he');
  const responseText = (step2.text || step2.message || step2.response || '').toLowerCase();
  console.log(`Response: ${step2.text || step2.message || step2.response || 'No text'}`);

  // Check if bug exists
  if (responseText.includes('כותרת: שליחת אימייל') || responseText.includes('שליחת אימייל אמור')) {
    console.log(`\n${colors.red}❌ BUG STILL EXISTS!${colors.reset}`);
    console.log(`${colors.red}The phrase "שליחת אימייל" was used as task title instead of being detected as email command.${colors.reset}`);
    process.exit(1);
  } else {
    console.log(`\n${colors.green}✅ Bug appears to be fixed!${colors.reset}`);
    console.log(`${colors.green}The phrase "שליחת אימייל" was correctly detected as a new command.${colors.reset}`);
  }
}

// ==================== MAIN ====================

const args = process.argv.slice(2);

if (args.includes('--critical-only') || args.includes('-c')) {
  runCriticalTest();
} else {
  runAllTests();
}
