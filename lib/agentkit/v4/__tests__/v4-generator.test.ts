/**
 * V4 Workflow Generator - Comprehensive Test Suite
 *
 * Tests all patterns, edge cases, and failure modes to ensure production readiness.
 */

import { V4WorkflowGenerator } from '../v4-generator';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { IPluginContext } from '@/lib/types/plugin-definition-context';

describe('V4 Workflow Generator - Production Readiness Tests', () => {
  let generator: V4WorkflowGenerator;
  let mockPluginManager: PluginManagerV2;
  let mockPlugins: IPluginContext[];

  beforeEach(() => {
    // Mock plugin manager and plugins
    mockPlugins = [
      {
        key: 'google-mail',
        displayName: 'Gmail',
        context: 'Email management',
        category: 'Communication',
        capabilities: ['send_email', 'fetch_emails'],
        actions: {
          send_email: {
            name: 'send_email',
            description: 'Send an email',
            parameters: {
              to: { type: 'string', required: true },
              subject: { type: 'string', required: true },
              body: { type: 'string', required: true },
            },
          },
          fetch_recent_emails: {
            name: 'fetch_recent_emails',
            description: 'Fetch recent emails',
            parameters: {
              limit: { type: 'number', required: false },
            },
          },
        },
        plugin: {} as any,
      },
      {
        key: 'hubspot',
        displayName: 'HubSpot',
        context: 'CRM management',
        category: 'CRM',
        capabilities: ['contacts', 'deals'],
        actions: {
          search_contacts: {
            name: 'search_contacts',
            description: 'Search contacts',
            parameters: {
              query: { type: 'string', required: false },
            },
          },
          get_contact_deals: {
            name: 'get_contact_deals',
            description: 'Get contact deals',
            parameters: {
              contact_id: { type: 'string', required: true },
            },
          },
          create_contact: {
            name: 'create_contact',
            description: 'Create a contact',
            parameters: {
              email: { type: 'string', required: true },
              firstname: { type: 'string', required: false },
              lastname: { type: 'string', required: false },
            },
          },
        },
        plugin: {} as any,
      },
    ];

    mockPluginManager = {
      getPluginDefinition: jest.fn((key: string) => {
        const plugin = mockPlugins.find(p => p.key === key);
        return plugin ? { ...plugin, actions: plugin.actions } : null;
      }),
    } as any;

    generator = new V4WorkflowGenerator(mockPluginManager, {
      connectedPlugins: mockPlugins,
      userId: 'test-user',
      anthropicApiKey: process.env.ANTHROPIC_API_KEY || 'test-key',
    });
  });

  describe('Pattern 1: Simple Sequential Workflows', () => {
    it('should generate simple 3-step workflow with AI processing', async () => {
      const enhancedPrompt = `
GOAL: Fetch recent emails and summarize them

EXECUTION PLAN:
1. Fetch 10 recent emails from Gmail
2. Summarize the emails using AI
3. Send summary email
`;

      const result = await generator.generateWorkflow(enhancedPrompt);

      expect(result.success).toBe(true);
      expect(result.workflow.workflow_steps).toHaveLength(3);
      expect(result.workflow.workflow_steps[0].type).toBe('action');
      expect(result.workflow.workflow_steps[0].plugin).toBe('google-mail');
      expect(result.workflow.workflow_steps[1].type).toBe('ai_processing');
      expect(result.workflow.workflow_steps[2].type).toBe('action');
    });

    it('should handle plugin-only workflow without AI', async () => {
      const enhancedPrompt = `
GOAL: Fetch emails and send them

EXECUTION PLAN:
1. Fetch recent emails from Gmail
2. Send email with the results
`;

      const result = await generator.generateWorkflow(enhancedPrompt);

      expect(result.success).toBe(true);
      expect(result.workflow.workflow_steps).toHaveLength(2);
      expect(result.workflow.workflow_steps.every((s: any) => s.type === 'action')).toBe(true);
    });
  });

  describe('Pattern 2: Conditional Workflows (If/Otherwise)', () => {
    it('should generate if/otherwise with correct operators', async () => {
      const enhancedPrompt = `
GOAL: Process emails based on urgency

EXECUTION PLAN:
1. Fetch recent emails
2. For each email:
  3. If subject contains 'urgent':
    4. Send immediate notification
  5. Otherwise:
    6. Archive email
`;

      const result = await generator.generateWorkflow(enhancedPrompt);

      expect(result.success).toBe(true);

      const loopStep = result.workflow.workflow_steps[1];
      expect(loopStep.type).toBe('scatter_gather');
      expect(loopStep.steps).toHaveLength(1);

      const conditionalStep = loopStep.steps[0];
      expect(conditionalStep.type).toBe('conditional');
      expect(conditionalStep.condition.operator).toBe('contains');
      expect(conditionalStep.condition.field).toBe('{{email.subject}}');
      expect(conditionalStep.condition.value).toBe('urgent');
      expect(conditionalStep.then_steps).toHaveLength(1);
      expect(conditionalStep.else_steps).toHaveLength(1);
    });

    it('should detect "has [items]" pattern correctly', async () => {
      const enhancedPrompt = `
GOAL: Check contacts for open deals

EXECUTION PLAN:
1. Search contacts in HubSpot
2. For each contact:
  3. Get contact deals
  4. If contact has open deals:
    5. Send notification
  6. Otherwise:
    7. Skip contact
`;

      const result = await generator.generateWorkflow(enhancedPrompt);

      expect(result.success).toBe(true);

      const loopStep = result.workflow.workflow_steps[1];
      const conditionalStep = loopStep.steps[1];

      expect(conditionalStep.type).toBe('conditional');
      expect(conditionalStep.condition.operator).toBe('is_not_null');
      expect(conditionalStep.condition.field).toMatch(/^{{step\d+\.data}}$/);
    });

    it('should handle success/failure patterns', async () => {
      const enhancedPrompt = `
GOAL: Extract data with error handling

EXECUTION PLAN:
1. Fetch emails
2. Extract invoice details using AI
3. If details extracted successfully:
  4. Create contact
5. Otherwise:
  6. Send error notification
`;

      const result = await generator.generateWorkflow(enhancedPrompt);

      expect(result.success).toBe(true);

      const conditionalStep = result.workflow.workflow_steps[2];
      expect(conditionalStep.type).toBe('conditional');
      expect(conditionalStep.condition.operator).toBe('is_not_null');
    });
  });

  describe('Pattern 3: Loop Workflows (For Each)', () => {
    it('should generate scatter_gather with correct loop variable', async () => {
      const enhancedPrompt = `
GOAL: Process multiple contacts

EXECUTION PLAN:
1. Search contacts
2. For each contact:
  3. Create deal for contact
`;

      const result = await generator.generateWorkflow(enhancedPrompt);

      expect(result.success).toBe(true);

      const loopStep = result.workflow.workflow_steps[1];
      expect(loopStep.type).toBe('scatter_gather');
      expect(loopStep.scatter.item_name).toBe('contact');
      expect(loopStep.scatter.items).toMatch(/^{{step\d+\.data}}$/);
      expect(loopStep.steps).toHaveLength(1);
    });

    it('should handle nested loops (for each inside for each)', async () => {
      const enhancedPrompt = `
GOAL: Process contacts and their deals

EXECUTION PLAN:
1. Search contacts
2. For each contact:
  3. Get contact deals
  4. For each deal:
    5. Send notification about deal
`;

      const result = await generator.generateWorkflow(enhancedPrompt);

      expect(result.success).toBe(true);

      const outerLoop = result.workflow.workflow_steps[1];
      expect(outerLoop.type).toBe('scatter_gather');
      expect(outerLoop.scatter.item_name).toBe('contact');

      const innerLoop = outerLoop.steps[1];
      expect(innerLoop.type).toBe('scatter_gather');
      expect(innerLoop.scatter.item_name).toBe('deal');
      expect(innerLoop.steps).toHaveLength(1);
    });
  });

  describe('Pattern 4: Nested Conditionals', () => {
    it('should handle if inside if (3 levels deep)', async () => {
      const enhancedPrompt = `
GOAL: Multi-level email classification

EXECUTION PLAN:
1. Fetch emails
2. For each email:
  3. If subject contains 'urgent':
    4. If subject contains 'critical':
      5. If subject contains 'security':
        6. Send immediate alert
      7. Otherwise:
        8. Send priority notification
    9. Otherwise:
      10. Send standard urgent notification
  11. Otherwise:
    12. Archive email
`;

      const result = await generator.generateWorkflow(enhancedPrompt);

      expect(result.success).toBe(true);

      const loopStep = result.workflow.workflow_steps[1];
      const level1 = loopStep.steps[0];
      expect(level1.type).toBe('conditional');

      const level2 = level1.then_steps[0];
      expect(level2.type).toBe('conditional');

      const level3 = level2.then_steps[0];
      expect(level3.type).toBe('conditional');
    });
  });

  describe('Pattern 5: Data Reference Validation', () => {
    it('should prevent cross-branch references (then_steps cannot reference else_steps)', async () => {
      const enhancedPrompt = `
GOAL: Test cross-branch references

EXECUTION PLAN:
1. Fetch data
2. Validate data using AI
3. If validation passed:
  4. Process data with AI
5. Otherwise:
  6. Log error with AI
7. Send summary email
`;

      const result = await generator.generateWorkflow(enhancedPrompt);

      expect(result.success).toBe(true);

      // Step 7 should reference step2 (last guaranteed step before conditional)
      // NOT step4 or step6 which are inside branches
      const summaryStep = result.workflow.workflow_steps[2];
      expect(summaryStep.params.data).toMatch(/{{step2\.data}}/);
    });

    it('should handle loop sibling references correctly', async () => {
      const enhancedPrompt = `
GOAL: Test loop sibling references

EXECUTION PLAN:
1. Fetch emails
2. For each email:
  3. Extract data using AI
  4. Validate extracted data using AI
  5. Send email with validation result
`;

      const result = await generator.generateWorkflow(enhancedPrompt);

      expect(result.success).toBe(true);

      const loopStep = result.workflow.workflow_steps[1];

      // Step 4 should reference step 3 (previous sibling in same loop)
      expect(loopStep.steps[1].params.data).toMatch(/{{step3\.data}}/);

      // Step 5 should reference step 4 (previous sibling in same loop)
      expect(loopStep.steps[2].params.data).toMatch(/{{step4\.data}}/);
    });
  });

  describe('Pattern 6: AI Batching Optimization', () => {
    it('should batch AI processing before loop (not inside loop)', async () => {
      const enhancedPrompt = `
GOAL: Classify emails efficiently

EXECUTION PLAN:
1. Fetch all emails
2. Classify ALL emails with categories using ai_processing
3. For each classified_email:
  4. If category urgent:
    5. Send immediate notification
  6. Otherwise:
    7. Archive email
`;

      const result = await generator.generateWorkflow(enhancedPrompt);

      expect(result.success).toBe(true);

      // Step 2 should be ai_processing BEFORE the loop
      expect(result.workflow.workflow_steps[1].type).toBe('ai_processing');

      // Step 3 should be the loop
      expect(result.workflow.workflow_steps[2].type).toBe('scatter_gather');
    });

    it('should NOT use AI for simple keyword matching', async () => {
      const enhancedPrompt = `
GOAL: Filter urgent emails

EXECUTION PLAN:
1. Fetch recent emails
2. For each email:
  3. If subject contains 'urgent':
    4. Send notification
`;

      const result = await generator.generateWorkflow(enhancedPrompt);

      expect(result.success).toBe(true);

      const loopStep = result.workflow.workflow_steps[1];
      const conditionalStep = loopStep.steps[0];

      // Should use conditional operator, NOT ai_processing
      expect(conditionalStep.type).toBe('conditional');
      expect(conditionalStep.type).not.toBe('ai_processing');
    });
  });

  describe('Pattern 7: Multi-Plugin Orchestration', () => {
    it('should handle workflows with 3+ services', async () => {
      const enhancedPrompt = `
GOAL: Sync contacts from email to CRM

EXECUTION PLAN:
1. Fetch emails from Gmail
2. Extract contact info using AI
3. For each contact:
  4. Create contact in HubSpot
  5. Send confirmation email via Gmail
`;

      const result = await generator.generateWorkflow(enhancedPrompt);

      expect(result.success).toBe(true);

      const usedPlugins = new Set();
      const collectPlugins = (steps: any[]) => {
        steps.forEach(step => {
          if (step.plugin) usedPlugins.add(step.plugin);
          if (step.steps) collectPlugins(step.steps);
          if (step.then_steps) collectPlugins(step.then_steps);
          if (step.else_steps) collectPlugins(step.else_steps);
        });
      };
      collectPlugins(result.workflow.workflow_steps);

      expect(usedPlugins.size).toBeGreaterThanOrEqual(2);
      expect(usedPlugins.has('google-mail')).toBe(true);
      expect(usedPlugins.has('hubspot')).toBe(true);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle empty enhanced prompt', async () => {
      const result = await generator.generateWorkflow('');

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it('should handle unknown service gracefully', async () => {
      const enhancedPrompt = `
GOAL: Use unknown service

EXECUTION PLAN:
1. Fetch data from unknown_service
2. Process data
`;

      const result = await generator.generateWorkflow(enhancedPrompt);

      // Should either fail gracefully or fall back to AI processing
      expect(result.success).toBe(true);
      expect(result.warnings).toBeDefined();
    });

    it('should validate PILOT_DSL_SCHEMA structure', async () => {
      const enhancedPrompt = `
GOAL: Simple workflow

EXECUTION PLAN:
1. Fetch emails using google-mail.fetch_recent_emails
2. Send summary using google-mail.send_email
`;

      const result = await generator.generateWorkflow(enhancedPrompt);

      expect(result.success).toBe(true);
      expect(result.workflow).toHaveProperty('agent_name');
      expect(result.workflow).toHaveProperty('description');
      expect(result.workflow).toHaveProperty('system_prompt');
      expect(result.workflow).toHaveProperty('workflow_type');
      expect(result.workflow).toHaveProperty('suggested_plugins');
      expect(result.workflow).toHaveProperty('required_inputs');
      expect(result.workflow).toHaveProperty('workflow_steps');
      expect(result.workflow).toHaveProperty('suggested_outputs');
      expect(result.workflow).toHaveProperty('reasoning');
      expect(result.workflow).toHaveProperty('confidence');
    });
  });

  describe('All Conditional Operators', () => {
    const operatorTests = [
      { condition: 'subject contains "urgent"', expectedOp: 'contains', expectedValue: 'urgent' },
      { condition: 'status equals active', expectedOp: 'equals', expectedValue: 'active' },
      { condition: 'data extracted successfully', expectedOp: 'is_not_null', expectedValue: '' },
      { condition: 'processing failed', expectedOp: 'is_null', expectedValue: '' },
      { condition: 'contact has open deals', expectedOp: 'is_not_null', expectedValue: '' },
      { condition: 'record not found', expectedOp: 'is_null', expectedValue: '' },
      { condition: 'customer exists', expectedOp: 'is_not_null', expectedValue: '' },
    ];

    operatorTests.forEach(({ condition, expectedOp, expectedValue }) => {
      it(`should detect operator "${expectedOp}" for condition "${condition}"`, async () => {
        const enhancedPrompt = `
GOAL: Test operator detection

EXECUTION PLAN:
1. Fetch data
2. If ${condition}:
  3. Process data
4. Otherwise:
  5. Skip
`;

        const result = await generator.generateWorkflow(enhancedPrompt);

        expect(result.success).toBe(true);

        const conditionalStep = result.workflow.workflow_steps[1];
        expect(conditionalStep.type).toBe('conditional');
        expect(conditionalStep.condition.operator).toBe(expectedOp);
        if (expectedValue) {
          expect(conditionalStep.condition.value).toBe(expectedValue);
        }
      });
    });
  });
});
