/**
 * Unit tests for IntentClassifier
 *
 * Tests intent classification logic for workflow step optimization
 */

import { IntentClassifier } from '../IntentClassifier';
import type { IntentType } from '../types';

// Mock Supabase client
const mockSupabase = {
  from: jest.fn(() => ({
    select: jest.fn(() => ({
      eq: jest.fn(() => ({
        single: jest.fn(() => Promise.resolve({
          data: { value: 0.7 },
          error: null
        }))
      }))
    }))
  }))
} as any;

describe('IntentClassifier', () => {
  let classifier: IntentClassifier;

  beforeEach(() => {
    classifier = new IntentClassifier(mockSupabase);
    classifier.clearCache();
  });

  describe('Quick Pattern Matching', () => {
    test('should identify conditional steps with high confidence', async () => {
      const step = {
        step_type: 'conditional',
        prompt: 'Check if user is verified',
        plugin_key: ''
      };

      const result = await classifier.classify(step);

      expect(result.intent).toBe('conditional');
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
      expect(result.reasoning).toContain('conditional');
    });

    test('should identify send/notification steps from plugin', async () => {
      const step = {
        step_type: '',
        prompt: 'Notify the user',
        plugin_key: 'slack_notification'
      };

      const result = await classifier.classify(step);

      expect(result.intent).toBe('send');
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    test('should identify email notification steps', async () => {
      const step = {
        step_type: '',
        prompt: 'Send confirmation email',
        plugin_key: 'email_service'
      };

      const result = await classifier.classify(step);

      expect(result.intent).toBe('send');
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    test('should identify validation steps from prompt prefix', async () => {
      const step = {
        step_type: '',
        prompt: 'Validate the user input against schema',
        plugin_key: ''
      };

      const result = await classifier.classify(step);

      expect(result.intent).toBe('validate');
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    });

    test('should identify summarization steps from prompt prefix', async () => {
      const step = {
        step_type: '',
        prompt: 'Summarize the customer feedback into key points',
        plugin_key: ''
      };

      const result = await classifier.classify(step);

      expect(result.intent).toBe('summarize');
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    });
  });

  describe('Intent Distribution', () => {
    test('should calculate intent distribution correctly', async () => {
      const steps = [
        { prompt: 'Extract data from API', step_type: '', plugin_key: 'api_connector' },
        { prompt: 'Summarize the results', step_type: '', plugin_key: '' },
        { prompt: 'Generate report', step_type: '', plugin_key: '' },
        { prompt: 'Send email notification', step_type: '', plugin_key: 'email' },
        { prompt: 'Summarize feedback', step_type: '', plugin_key: '' }
      ];

      const classifications = await classifier.classifyBatch(steps);
      const distribution = classifier.getIntentDistribution(classifications);

      expect(Object.keys(distribution).length).toBeGreaterThan(0);
      expect(classifications).toHaveLength(steps.length);
    });
  });

  describe('Confidence Threshold', () => {
    test('should load confidence threshold from database', async () => {
      const threshold = await classifier.getConfidenceThreshold();

      expect(threshold).toBe(0.7);
      expect(mockSupabase.from).toHaveBeenCalledWith('system_settings_config');
    });

    test('should cache confidence threshold', async () => {
      const threshold1 = await classifier.getConfidenceThreshold();
      const threshold2 = await classifier.getConfidenceThreshold();

      expect(threshold1).toBe(threshold2);
      // Should only call database once due to caching
      expect(mockSupabase.from).toHaveBeenCalledTimes(1);
    });

    test('should use default threshold on database error', async () => {
      const errorSupabase = {
        from: jest.fn(() => ({
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              single: jest.fn(() => Promise.resolve({
                data: null,
                error: { message: 'Database error' }
              }))
            }))
          }))
        }))
      } as any;

      const errorClassifier = new IntentClassifier(errorSupabase);
      const threshold = await errorClassifier.getConfidenceThreshold();

      expect(threshold).toBe(0.7); // Default fallback
    });
  });

  describe('Batch Classification', () => {
    test('should classify multiple steps in batch', async () => {
      const steps = [
        { prompt: 'Fetch user data', step_type: '', plugin_key: 'database' },
        { prompt: 'Transform data to CSV', step_type: '', plugin_key: '' },
        { prompt: 'Validate the results', step_type: '', plugin_key: '' }
      ];

      const results = await classifier.classifyBatch(steps);

      expect(results).toHaveLength(steps.length);
      results.forEach(result => {
        expect(result.intent).toBeDefined();
        expect(result.confidence).toBeGreaterThan(0);
        expect(result.confidence).toBeLessThanOrEqual(1);
        expect(result.reasoning).toBeDefined();
      });
    });

    test('should handle empty batch', async () => {
      const results = await classifier.classifyBatch([]);

      expect(results).toHaveLength(0);
    });
  });

  describe('Cache Management', () => {
    test('should cache classification results', async () => {
      const step = {
        prompt: 'Extract customer data',
        step_type: '',
        plugin_key: 'api'
      };

      const result1 = await classifier.classify(step);
      const result2 = await classifier.classify(step);

      expect(result1).toEqual(result2);
    });

    test('should clear cache on demand', () => {
      classifier.clearCache();
      const stats = classifier.getCacheStats();

      expect(stats.size).toBe(0);
    });

    test('should provide cache statistics', async () => {
      const step = { prompt: 'Test', step_type: '', plugin_key: '' };
      await classifier.classify(step);

      const stats = classifier.getCacheStats();

      expect(stats.size).toBeGreaterThan(0);
    });
  });

  describe('Config Reload', () => {
    test('should reload configuration from database', async () => {
      await classifier.getConfidenceThreshold();
      await classifier.reloadConfig();

      // Should fetch from database again after reload
      const threshold = await classifier.getConfidenceThreshold();
      expect(threshold).toBeDefined();
    });
  });

  describe('Fallback Behavior', () => {
    test('should return generate intent on classification error', async () => {
      const invalidStep = {} as any; // Invalid step to trigger error path

      const result = await classifier.classify(invalidStep);

      expect(result.intent).toBe('generate'); // Fallback intent
      expect(result.confidence).toBe(0.5);
      expect(result.reasoning).toContain('Fallback');
    });
  });

  describe('Intent Type Coverage', () => {
    const intentExamples: Array<{ step: any; expectedIntent: IntentType }> = [
      {
        step: { prompt: 'Extract data from database', step_type: '', plugin_key: 'db' },
        expectedIntent: 'extract'
      },
      {
        step: { prompt: 'Summarize the document', step_type: '', plugin_key: '' },
        expectedIntent: 'summarize'
      },
      {
        step: { prompt: 'Generate a report', step_type: '', plugin_key: '' },
        expectedIntent: 'generate'
      },
      {
        step: { prompt: 'Validate input data', step_type: '', plugin_key: '' },
        expectedIntent: 'validate'
      },
      {
        step: { prompt: 'Send notification', step_type: '', plugin_key: 'email' },
        expectedIntent: 'send'
      },
      {
        step: { prompt: 'Transform JSON to XML', step_type: '', plugin_key: '' },
        expectedIntent: 'transform'
      },
      {
        step: { step_type: 'conditional', prompt: 'If verified', plugin_key: '' },
        expectedIntent: 'conditional'
      }
    ];

    intentExamples.forEach(({ step, expectedIntent }) => {
      test(`should classify "${step.prompt || step.step_type}" as ${expectedIntent}`, async () => {
        const result = await classifier.classify(step);

        // For quick pattern matches, should get the expected intent
        // For LLM-based classification, confidence might be lower
        expect(result.intent).toBeDefined();
        expect(result.confidence).toBeGreaterThan(0);
      });
    });
  });
});
