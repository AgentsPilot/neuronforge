/**
 * Unit tests for TokenBudgetManager
 *
 * Tests token budget allocation, tracking, and enforcement
 */

import { TokenBudgetManager } from '../TokenBudgetManager';
import type { IntentClassification, BudgetAllocationStrategy } from '../types';

// Mock Supabase client
const createMockSupabase = (configValues: Record<string, any> = {}) => {
  return {
    from: jest.fn((table: string) => {
      if (table === 'system_settings_config') {
        return {
          select: jest.fn(() => ({
            in: jest.fn((key: string, values: string[]) => ({
              then: (resolve: Function) => {
                const data = values.map(key => ({
                  key,
                  value: configValues[key] || getDefaultConfigValue(key)
                })).filter(item => item.value !== undefined);
                return Promise.resolve({ data, error: null });
              }
            })),
            eq: jest.fn((key: string, value: string) => ({
              single: jest.fn(() => {
                const configValue = configValues[value];
                return Promise.resolve({
                  data: configValue !== undefined ? { value: configValue } : null,
                  error: configValue !== undefined ? null : { message: 'Not found' }
                });
              })
            }))
          }))
        };
      }
      return { select: jest.fn() };
    })
  } as any;
};

function getDefaultConfigValue(key: string): any {
  const defaults: Record<string, any> = {
    'orchestration_max_tokens_per_step': 4000,
    'orchestration_max_tokens_per_workflow': 20000,
    'orchestration_budget_overage_allowed': true,
    'orchestration_budget_overage_threshold': 1.2,
    'orchestration_token_budget_extract': 800,
    'orchestration_token_budget_summarize': 1500,
    'orchestration_token_budget_generate': 2500,
    'orchestration_token_budget_validate': 1000,
    'orchestration_token_budget_send': 500,
    'orchestration_token_budget_transform': 800,
    'orchestration_token_budget_conditional': 300,
    'orchestration_token_budget_aggregate': 1200,
    'orchestration_token_budget_filter': 600,
    'orchestration_token_budget_enrich': 1000,
    'orchestration_budget_allocation_strategy': 'proportional'
  };
  return defaults[key];
}

describe('TokenBudgetManager', () => {
  let manager: TokenBudgetManager;
  let mockSupabase: any;

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    manager = new TokenBudgetManager(mockSupabase);
  });

  afterEach(() => {
    manager.reset();
  });

  describe('Budget Allocation', () => {
    test('should allocate budgets for all workflow steps', async () => {
      const workflow = {
        workflow_steps: [
          { id: 'step1', prompt: 'Extract data' },
          { id: 'step2', prompt: 'Generate report' },
          { id: 'step3', prompt: 'Send email' }
        ]
      };

      const intents: IntentClassification[] = [
        { intent: 'extract', confidence: 0.9, reasoning: 'Data extraction' },
        { intent: 'generate', confidence: 0.85, reasoning: 'Content generation' },
        { intent: 'send', confidence: 0.95, reasoning: 'Email notification' }
      ];

      const budgets = await manager.allocateBudget(workflow, intents);

      expect(budgets.size).toBe(3);
      expect(budgets.get('step1')).toBeDefined();
      expect(budgets.get('step2')).toBeDefined();
      expect(budgets.get('step3')).toBeDefined();

      budgets.forEach((budget, stepId) => {
        expect(budget.allocated).toBeGreaterThan(0);
        expect(budget.used).toBe(0);
        expect(budget.remaining).toBe(budget.allocated);
        expect(budget.compressed).toBe(0);
      });
    });

    test('should throw error if step count does not match intent count', async () => {
      const workflow = {
        workflow_steps: [
          { id: 'step1', prompt: 'Extract' },
          { id: 'step2', prompt: 'Generate' }
        ]
      };

      const intents: IntentClassification[] = [
        { intent: 'extract', confidence: 0.9, reasoning: 'Extract' }
      ];

      await expect(manager.allocateBudget(workflow, intents))
        .rejects
        .toThrow('Step count');
    });

    test('should apply AIS multiplier to budgets', async () => {
      const workflow = {
        workflow_steps: [
          { id: 'step1', prompt: 'Generate' }
        ]
      };

      const intents: IntentClassification[] = [
        { intent: 'generate', confidence: 0.9, reasoning: 'Generate' }
      ];

      // High complexity agent
      const agentAIS = {
        creation_score: 8.0,
        execution_score: 9.0,
        combined_score: 8.7
      };

      const budgets = await manager.allocateBudget(workflow, intents, agentAIS);
      const budget = budgets.get('step1')!;

      // With high AIS score, should get more budget than baseline
      expect(budget.allocated).toBeGreaterThan(2500); // Baseline is 2500 for generate
    });

    test('should scale down budgets if total exceeds workflow limit', async () => {
      const workflow = {
        workflow_steps: Array.from({ length: 10 }, (_, i) => ({
          id: `step${i}`,
          prompt: 'Generate content'
        }))
      };

      const intents: IntentClassification[] = Array.from({ length: 10 }, () => ({
        intent: 'generate' as const,
        confidence: 0.9,
        reasoning: 'Generate'
      }));

      const budgets = await manager.allocateBudget(workflow, intents);

      const totalAllocated = Array.from(budgets.values())
        .reduce((sum, b) => sum + b.allocated, 0);

      // Should not exceed workflow limit
      expect(totalAllocated).toBeLessThanOrEqual(20000);
    });
  });

  describe('Budget Allocation Strategies', () => {
    const workflow = {
      workflow_steps: [
        { id: 'step1', prompt: 'Extract' },
        { id: 'step2', prompt: 'Generate' },
        { id: 'step3', prompt: 'Send' }
      ]
    };

    const intents: IntentClassification[] = [
      { intent: 'extract', confidence: 0.9, reasoning: 'Extract' },
      { intent: 'generate', confidence: 0.85, reasoning: 'Generate' },
      { intent: 'send', confidence: 0.95, reasoning: 'Send' }
    ];

    test('should allocate equal budgets with equal strategy', async () => {
      mockSupabase = createMockSupabase({
        'orchestration_budget_allocation_strategy': 'equal'
      });
      manager = new TokenBudgetManager(mockSupabase);

      const budgets = await manager.allocateBudget(workflow, intents);

      const allocations = Array.from(budgets.values()).map(b => b.allocated);
      const firstAllocation = allocations[0];

      // All steps should have similar allocations (within small variance)
      allocations.forEach(alloc => {
        expect(Math.abs(alloc - firstAllocation)).toBeLessThan(100);
      });
    });

    test('should allocate proportional budgets based on intent', async () => {
      const budgets = await manager.allocateBudget(workflow, intents);

      const extractBudget = budgets.get('step1')!.allocated;
      const generateBudget = budgets.get('step2')!.allocated;
      const sendBudget = budgets.get('step3')!.allocated;

      // Generate should get more than extract, extract more than send
      expect(generateBudget).toBeGreaterThan(extractBudget);
      expect(extractBudget).toBeGreaterThan(sendBudget);
    });
  });

  describe('Budget Tracking', () => {
    test('should track token usage for steps', async () => {
      const workflow = {
        workflow_steps: [{ id: 'step1', prompt: 'Test' }]
      };
      const intents: IntentClassification[] = [
        { intent: 'generate', confidence: 0.9, reasoning: 'Test' }
      ];

      await manager.allocateBudget(workflow, intents);

      await manager.trackUsage('step1', 500);

      const status = await manager.getBudgetStatus('step1');
      expect(status.used).toBe(500);
      expect(status.remaining).toBe(status.allocated - 500);
    });

    test('should handle multiple usage tracking calls', async () => {
      const workflow = {
        workflow_steps: [{ id: 'step1', prompt: 'Test' }]
      };
      const intents: IntentClassification[] = [
        { intent: 'generate', confidence: 0.9, reasoning: 'Test' }
      ];

      await manager.allocateBudget(workflow, intents);

      await manager.trackUsage('step1', 300);
      await manager.trackUsage('step1', 200);
      await manager.trackUsage('step1', 100);

      const status = await manager.getBudgetStatus('step1');
      expect(status.used).toBe(600);
    });

    test('should warn on budget overage', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const workflow = {
        workflow_steps: [{ id: 'step1', prompt: 'Test' }]
      };
      const intents: IntentClassification[] = [
        { intent: 'conditional', confidence: 0.9, reasoning: 'Test' }
      ];

      mockSupabase = createMockSupabase({
        'orchestration_budget_overage_allowed': false
      });
      manager = new TokenBudgetManager(mockSupabase);

      await manager.allocateBudget(workflow, intents);
      const budget = await manager.getBudgetStatus('step1');

      // Use more than allocated
      await manager.trackUsage('step1', budget.allocated + 100);

      expect(consoleWarnSpy).toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });
  });

  describe('Budget Checking', () => {
    test('should check if step has sufficient budget', async () => {
      const workflow = {
        workflow_steps: [{ id: 'step1', prompt: 'Test' }]
      };
      const intents: IntentClassification[] = [
        { intent: 'generate', confidence: 0.9, reasoning: 'Test' }
      ];

      await manager.allocateBudget(workflow, intents);
      const budget = await manager.getBudgetStatus('step1');

      const canProceed1 = await manager.checkBudget('step1', budget.allocated - 100);
      expect(canProceed1).toBe(true);

      const canProceed2 = await manager.checkBudget('step1', budget.allocated + 1000);
      expect(canProceed2).toBe(false);
    });

    test('should allow overage when enabled', async () => {
      const workflow = {
        workflow_steps: [{ id: 'step1', prompt: 'Test' }]
      };
      const intents: IntentClassification[] = [
        { intent: 'generate', confidence: 0.9, reasoning: 'Test' }
      ];

      await manager.allocateBudget(workflow, intents);
      const budget = await manager.getBudgetStatus('step1');

      // Should allow 20% overage (threshold 1.2)
      const overageAmount = budget.allocated * 0.15;
      const canProceed = await manager.checkBudget('step1', budget.allocated + overageAmount);

      expect(canProceed).toBe(true);
    });

    test('should return true for unknown steps', async () => {
      const canProceed = await manager.checkBudget('unknown_step', 1000);
      expect(canProceed).toBe(true);
    });
  });

  describe('Compression Tracking', () => {
    test('should record compressed tokens', async () => {
      const workflow = {
        workflow_steps: [{ id: 'step1', prompt: 'Test' }]
      };
      const intents: IntentClassification[] = [
        { intent: 'summarize', confidence: 0.9, reasoning: 'Test' }
      ];

      await manager.allocateBudget(workflow, intents);

      manager.recordCompression('step1', 200);

      const status = await manager.getBudgetStatus('step1');
      expect(status.compressed).toBe(200);
    });

    test('should accumulate compression savings', async () => {
      const workflow = {
        workflow_steps: [{ id: 'step1', prompt: 'Test' }]
      };
      const intents: IntentClassification[] = [
        { intent: 'summarize', confidence: 0.9, reasoning: 'Test' }
      ];

      await manager.allocateBudget(workflow, intents);

      manager.recordCompression('step1', 100);
      manager.recordCompression('step1', 150);

      const status = await manager.getBudgetStatus('step1');
      expect(status.compressed).toBe(250);
    });
  });

  describe('Budget Summary', () => {
    test('should provide total budget summary', async () => {
      const workflow = {
        workflow_steps: [
          { id: 'step1', prompt: 'Extract' },
          { id: 'step2', prompt: 'Generate' }
        ]
      };
      const intents: IntentClassification[] = [
        { intent: 'extract', confidence: 0.9, reasoning: 'Extract' },
        { intent: 'generate', confidence: 0.9, reasoning: 'Generate' }
      ];

      await manager.allocateBudget(workflow, intents);

      await manager.trackUsage('step1', 400);
      await manager.trackUsage('step2', 1000);
      manager.recordCompression('step1', 100);

      const summary = manager.getTotalBudgetSummary();

      expect(summary.totalAllocated).toBeGreaterThan(0);
      expect(summary.totalUsed).toBe(1400);
      expect(summary.totalCompressed).toBe(100);
      expect(summary.totalRemaining).toBeGreaterThan(0);
      expect(summary.utilizationRate).toBeGreaterThan(0);
      expect(summary.utilizationRate).toBeLessThanOrEqual(1);
    });

    test('should handle empty budget state', () => {
      const summary = manager.getTotalBudgetSummary();

      expect(summary.totalAllocated).toBe(0);
      expect(summary.totalUsed).toBe(0);
      expect(summary.totalCompressed).toBe(0);
      expect(summary.totalRemaining).toBe(0);
      expect(summary.utilizationRate).toBe(0);
    });
  });

  describe('Configuration Management', () => {
    test('should reload configuration', async () => {
      await manager.reloadConfig();
      // Should not throw error
      expect(true).toBe(true);
    });

    test('should use default constraints on database error', async () => {
      const errorSupabase = {
        from: jest.fn(() => ({
          select: jest.fn(() => ({
            in: jest.fn(() => Promise.resolve({
              data: null,
              error: { message: 'Database error' }
            }))
          }))
        }))
      } as any;

      const errorManager = new TokenBudgetManager(errorSupabase);
      const workflow = {
        workflow_steps: [{ id: 'step1', prompt: 'Test' }]
      };
      const intents: IntentClassification[] = [
        { intent: 'generate', confidence: 0.9, reasoning: 'Test' }
      ];

      // Should still work with defaults
      const budgets = await errorManager.allocateBudget(workflow, intents);

      expect(budgets.size).toBe(1);
      expect(budgets.get('step1')?.allocated).toBeGreaterThan(0);
    });
  });

  describe('Reset Functionality', () => {
    test('should reset all budgets', async () => {
      const workflow = {
        workflow_steps: [{ id: 'step1', prompt: 'Test' }]
      };
      const intents: IntentClassification[] = [
        { intent: 'generate', confidence: 0.9, reasoning: 'Test' }
      ];

      await manager.allocateBudget(workflow, intents);
      manager.reset();

      const summary = manager.getTotalBudgetSummary();
      expect(summary.totalAllocated).toBe(0);
    });
  });

  describe('Budget Status', () => {
    test('should throw error for non-existent step', async () => {
      await expect(manager.getBudgetStatus('non_existent'))
        .rejects
        .toThrow('No budget found');
    });

    test('should return budget copy (not reference)', async () => {
      const workflow = {
        workflow_steps: [{ id: 'step1', prompt: 'Test' }]
      };
      const intents: IntentClassification[] = [
        { intent: 'generate', confidence: 0.9, reasoning: 'Test' }
      ];

      await manager.allocateBudget(workflow, intents);

      const status1 = await manager.getBudgetStatus('step1');
      const status2 = await manager.getBudgetStatus('step1');

      // Should be equal but not same reference
      expect(status1).toEqual(status2);
      expect(status1).not.toBe(status2);
    });
  });
});
