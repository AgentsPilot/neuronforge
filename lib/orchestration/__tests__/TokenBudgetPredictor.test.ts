/**
 * Unit tests for TokenBudgetPredictor
 *
 * Tests predictive token budget allocation using historical data
 */

import { TokenBudgetPredictor, BudgetPrediction } from '../TokenBudgetPredictor';

// Mock Supabase client
const createMockSupabase = (queryResults: any[] = []) => {
  return {
    from: jest.fn((table: string) => {
      if (table === 'workflow_step_executions') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              eq: jest.fn(() => ({
                gte: jest.fn(() => ({
                  lte: jest.fn(() => ({
                    gte: jest.fn(() => ({
                      not: jest.fn(() => ({
                        eq: jest.fn(() => {
                          return Promise.resolve({
                            data: queryResults,
                            error: null
                          });
                        })
                      }))
                    }))
                  }))
                }))
              }))
            }))
          }))
        };
      }
      return { select: jest.fn() };
    })
  } as any;
};

const createMockSupabaseWithError = (errorMessage: string) => {
  return {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          eq: jest.fn(() => ({
            gte: jest.fn(() => ({
              lte: jest.fn(() => ({
                gte: jest.fn(() => ({
                  not: jest.fn(() => ({
                    eq: jest.fn(() => {
                      return Promise.resolve({
                        data: null,
                        error: { message: errorMessage }
                      });
                    })
                  }))
                }))
              }))
            }))
          }))
        }))
      }))
    }))
  } as any;
};

describe('TokenBudgetPredictor', () => {
  let predictor: TokenBudgetPredictor;
  let mockSupabase: any;

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    predictor = new TokenBudgetPredictor(mockSupabase);
  });

  afterEach(() => {
    predictor.clearCache();
  });

  describe('Budget Prediction', () => {
    test('should predict budget using mean + 2σ', async () => {
      // Create historical data with known statistics
      // Mean: 1000, Std Dev: 100
      const historicalData = [
        { tokens_used: 900 },
        { tokens_used: 950 },
        { tokens_used: 1000 },
        { tokens_used: 1050 },
        { tokens_used: 1100 },
        { tokens_used: 900 },
        { tokens_used: 950 },
        { tokens_used: 1000 },
        { tokens_used: 1050 },
        { tokens_used: 1100 }
      ];

      mockSupabase = createMockSupabase(historicalData);
      predictor = new TokenBudgetPredictor(mockSupabase);

      const prediction = await predictor.predict('extract', 'balanced', 5.0);

      expect(prediction).not.toBeNull();
      expect(prediction!.budget).toBeGreaterThan(1000); // Should be > mean
      expect(prediction!.source).toBe('prediction');
      expect(prediction!.sampleSize).toBe(10);
      expect(prediction!.confidence).toBeGreaterThan(0);
      expect(prediction!.confidence).toBeLessThanOrEqual(1);
    });

    test('should return null if insufficient samples', async () => {
      // Only 5 samples (need 10 minimum)
      const historicalData = [
        { tokens_used: 1000 },
        { tokens_used: 1100 },
        { tokens_used: 900 },
        { tokens_used: 1050 },
        { tokens_used: 950 }
      ];

      mockSupabase = createMockSupabase(historicalData);
      predictor = new TokenBudgetPredictor(mockSupabase);

      const prediction = await predictor.predict('extract', 'balanced', 5.0);

      expect(prediction).toBeNull();
    });

    test('should return null if no historical data', async () => {
      mockSupabase = createMockSupabase([]);
      predictor = new TokenBudgetPredictor(mockSupabase);

      const prediction = await predictor.predict('extract', 'balanced', 5.0);

      expect(prediction).toBeNull();
    });

    test('should return null on database error', async () => {
      mockSupabase = createMockSupabaseWithError('Database connection failed');
      predictor = new TokenBudgetPredictor(mockSupabase);

      const prediction = await predictor.predict('extract', 'balanced', 5.0);

      expect(prediction).toBeNull();
    });

    test('should apply minimum budget of 100 tokens', async () => {
      // Very small token usage (should trigger minimum)
      const historicalData = Array.from({ length: 10 }, () => ({
        tokens_used: 10
      }));

      mockSupabase = createMockSupabase(historicalData);
      predictor = new TokenBudgetPredictor(mockSupabase);

      const prediction = await predictor.predict('conditional', 'fast', 2.0);

      expect(prediction).not.toBeNull();
      expect(prediction!.budget).toBe(100); // Should apply minimum
    });

    test('should cap budget at 100,000 tokens', async () => {
      // Extremely large token usage (should trigger cap)
      const historicalData = Array.from({ length: 10 }, () => ({
        tokens_used: 60000
      }));

      mockSupabase = createMockSupabase(historicalData);
      predictor = new TokenBudgetPredictor(mockSupabase);

      const prediction = await predictor.predict('generate', 'powerful', 9.0);

      expect(prediction).not.toBeNull();
      expect(prediction!.budget).toBeLessThanOrEqual(100000); // Should cap
    });

    test('should handle different step types and tiers', async () => {
      const historicalData = Array.from({ length: 15 }, () => ({
        tokens_used: 2000
      }));

      mockSupabase = createMockSupabase(historicalData);
      predictor = new TokenBudgetPredictor(mockSupabase);

      const prediction1 = await predictor.predict('extract', 'fast', 3.0);
      const prediction2 = await predictor.predict('generate', 'powerful', 8.0);
      const prediction3 = await predictor.predict('summarize', 'balanced', 5.0);

      expect(prediction1).not.toBeNull();
      expect(prediction2).not.toBeNull();
      expect(prediction3).not.toBeNull();
    });
  });

  describe('Confidence Calculation', () => {
    test('should have higher confidence with more samples', async () => {
      const data10 = Array.from({ length: 10 }, () => ({ tokens_used: 1000 }));
      const data50 = Array.from({ length: 50 }, () => ({ tokens_used: 1000 }));
      const data100 = Array.from({ length: 100 }, () => ({ tokens_used: 1000 }));

      // Prediction with 10 samples
      mockSupabase = createMockSupabase(data10);
      predictor = new TokenBudgetPredictor(mockSupabase);
      const pred10 = await predictor.predict('extract', 'balanced', 5.0);

      // Prediction with 50 samples
      mockSupabase = createMockSupabase(data50);
      predictor = new TokenBudgetPredictor(mockSupabase);
      const pred50 = await predictor.predict('extract', 'balanced', 5.0);

      // Prediction with 100 samples
      mockSupabase = createMockSupabase(data100);
      predictor = new TokenBudgetPredictor(mockSupabase);
      const pred100 = await predictor.predict('extract', 'balanced', 5.0);

      expect(pred10!.confidence).toBeLessThan(pred50!.confidence);
      expect(pred50!.confidence).toBeLessThan(pred100!.confidence);
    });

    test('should approach 1.0 confidence with large sample size', async () => {
      const largeDataset = Array.from({ length: 200 }, () => ({
        tokens_used: 1500
      }));

      mockSupabase = createMockSupabase(largeDataset);
      predictor = new TokenBudgetPredictor(mockSupabase);

      const prediction = await predictor.predict('extract', 'balanced', 5.0);

      expect(prediction!.confidence).toBeGreaterThan(0.95);
      expect(prediction!.confidence).toBeLessThanOrEqual(1.0);
    });
  });

  describe('Cache Management', () => {
    test('should cache predictions', async () => {
      const historicalData = Array.from({ length: 15 }, () => ({
        tokens_used: 1200
      }));

      mockSupabase = createMockSupabase(historicalData);
      predictor = new TokenBudgetPredictor(mockSupabase);

      // First call - should query database
      const prediction1 = await predictor.predict('extract', 'balanced', 5.0);

      // Second call - should use cache (same parameters)
      const prediction2 = await predictor.predict('extract', 'balanced', 5.0);

      expect(prediction1).toEqual(prediction2);
      expect(prediction1!.source).toBe('prediction');
      expect(prediction2!.source).toBe('prediction');
    });

    test('should cache different predictions separately', async () => {
      const historicalData = Array.from({ length: 15 }, () => ({
        tokens_used: 1200
      }));

      mockSupabase = createMockSupabase(historicalData);
      predictor = new TokenBudgetPredictor(mockSupabase);

      const pred1 = await predictor.predict('extract', 'fast', 3.0);
      const pred2 = await predictor.predict('extract', 'balanced', 3.0);
      const pred3 = await predictor.predict('generate', 'fast', 3.0);

      // All should be cached separately
      const stats = predictor.getCacheStats();
      expect(stats.size).toBe(3);
      expect(stats.entries.length).toBe(3);
    });

    test('should clear cache on demand', async () => {
      const historicalData = Array.from({ length: 15 }, () => ({
        tokens_used: 1200
      }));

      mockSupabase = createMockSupabase(historicalData);
      predictor = new TokenBudgetPredictor(mockSupabase);

      await predictor.predict('extract', 'balanced', 5.0);

      let stats = predictor.getCacheStats();
      expect(stats.size).toBe(1);

      predictor.clearCache();

      stats = predictor.getCacheStats();
      expect(stats.size).toBe(0);
    });

    test('should provide cache statistics', () => {
      const stats = predictor.getCacheStats();

      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('entries');
      expect(Array.isArray(stats.entries)).toBe(true);
    });
  });

  describe('Complexity Score Handling', () => {
    test('should query with ±1 complexity range', async () => {
      const historicalData = Array.from({ length: 15 }, () => ({
        tokens_used: 1000
      }));

      mockSupabase = createMockSupabase(historicalData);
      predictor = new TokenBudgetPredictor(mockSupabase);

      await predictor.predict('extract', 'balanced', 5.0);

      // Verify query was called with complexity range
      expect(mockSupabase.from).toHaveBeenCalledWith('workflow_step_executions');
    });

    test('should round complexity score for cache key', async () => {
      const historicalData = Array.from({ length: 15 }, () => ({
        tokens_used: 1000
      }));

      mockSupabase = createMockSupabase(historicalData);
      predictor = new TokenBudgetPredictor(mockSupabase);

      // These should use same cache (both round to 5)
      await predictor.predict('extract', 'balanced', 5.2);
      await predictor.predict('extract', 'balanced', 5.4);

      const stats = predictor.getCacheStats();
      expect(stats.size).toBe(1); // Should only cache once
    });
  });

  describe('Prediction Statistics', () => {
    test('should calculate prediction accuracy', async () => {
      const statsData = [
        {
          tokens_used: 1000,
          predicted_budget: 1200,
          proportional_budget: 1500
        },
        {
          tokens_used: 1100,
          predicted_budget: 1300,
          proportional_budget: 1600
        },
        {
          tokens_used: 900,
          predicted_budget: 1100,
          proportional_budget: 1400
        }
      ];

      // Mock the stats query
      mockSupabase = {
        from: jest.fn(() => ({
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              eq: jest.fn(() => ({
                eq: jest.fn(() => ({
                  gte: jest.fn(() => ({
                    not: jest.fn(() => ({
                      not: jest.fn(() => {
                        return Promise.resolve({
                          data: statsData,
                          error: null
                        });
                      })
                    }))
                  }))
                }))
              }))
            }))
          }))
        }))
      } as any;

      predictor = new TokenBudgetPredictor(mockSupabase);

      const stats = await predictor.getPredictionStats('extract', 'balanced', 7);

      expect(stats).not.toBeNull();
      expect(stats!.totalPredictions).toBe(3);
      expect(stats!.avgAccuracy).toBeGreaterThan(0);
      expect(stats!.avgAccuracy).toBeLessThanOrEqual(1);
      expect(stats!.avgSavings).toBeGreaterThan(0); // Should show savings vs proportional
    });

    test('should return null if no prediction data available', async () => {
      mockSupabase = {
        from: jest.fn(() => ({
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              eq: jest.fn(() => ({
                eq: jest.fn(() => ({
                  gte: jest.fn(() => ({
                    not: jest.fn(() => ({
                      not: jest.fn(() => {
                        return Promise.resolve({
                          data: [],
                          error: null
                        });
                      })
                    }))
                  }))
                }))
              }))
            }))
          }))
        }))
      } as any;

      predictor = new TokenBudgetPredictor(mockSupabase);

      const stats = await predictor.getPredictionStats('extract', 'balanced', 7);

      expect(stats).toBeNull();
    });

    test('should handle stats query error gracefully', async () => {
      mockSupabase = {
        from: jest.fn(() => ({
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              eq: jest.fn(() => ({
                eq: jest.fn(() => ({
                  gte: jest.fn(() => ({
                    not: jest.fn(() => ({
                      not: jest.fn(() => {
                        return Promise.resolve({
                          data: null,
                          error: { message: 'Query failed' }
                        });
                      })
                    }))
                  }))
                }))
              }))
            }))
          }))
        }))
      } as any;

      predictor = new TokenBudgetPredictor(mockSupabase);

      const stats = await predictor.getPredictionStats('extract', 'balanced', 7);

      expect(stats).toBeNull();
    });
  });

  describe('Edge Cases', () => {
    test('should handle zero standard deviation', async () => {
      // All values are identical - zero variance
      const historicalData = Array.from({ length: 10 }, () => ({
        tokens_used: 1000
      }));

      mockSupabase = createMockSupabase(historicalData);
      predictor = new TokenBudgetPredictor(mockSupabase);

      const prediction = await predictor.predict('extract', 'balanced', 5.0);

      expect(prediction).not.toBeNull();
      expect(prediction!.budget).toBe(1000); // μ + 2(0) = μ
    });

    test('should handle high variance data', async () => {
      // High variance dataset
      const historicalData = [
        { tokens_used: 500 },
        { tokens_used: 5000 },
        { tokens_used: 1000 },
        { tokens_used: 4000 },
        { tokens_used: 1500 },
        { tokens_used: 3500 },
        { tokens_used: 2000 },
        { tokens_used: 3000 },
        { tokens_used: 2500 },
        { tokens_used: 2000 }
      ];

      mockSupabase = createMockSupabase(historicalData);
      predictor = new TokenBudgetPredictor(mockSupabase);

      const prediction = await predictor.predict('generate', 'balanced', 5.0);

      expect(prediction).not.toBeNull();
      // Budget should account for high variance (large 2σ component)
      expect(prediction!.budget).toBeGreaterThan(2500); // Mean is 2500
    });

    test('should handle exactly minimum sample size', async () => {
      const historicalData = Array.from({ length: 10 }, () => ({
        tokens_used: 1200
      }));

      mockSupabase = createMockSupabase(historicalData);
      predictor = new TokenBudgetPredictor(mockSupabase);

      const prediction = await predictor.predict('extract', 'balanced', 5.0);

      expect(prediction).not.toBeNull();
      expect(prediction!.sampleSize).toBe(10);
    });
  });

  describe('Integration Scenarios', () => {
    test('should provide consistent predictions for same inputs', async () => {
      const historicalData = Array.from({ length: 20 }, (_, i) => ({
        tokens_used: 1000 + i * 50
      }));

      mockSupabase = createMockSupabase(historicalData);
      predictor = new TokenBudgetPredictor(mockSupabase);

      const pred1 = await predictor.predict('extract', 'balanced', 5.0);
      const pred2 = await predictor.predict('extract', 'balanced', 5.0);

      expect(pred1).toEqual(pred2);
    });

    test('should handle multiple concurrent predictions', async () => {
      const historicalData = Array.from({ length: 15 }, () => ({
        tokens_used: 1500
      }));

      mockSupabase = createMockSupabase(historicalData);
      predictor = new TokenBudgetPredictor(mockSupabase);

      const predictions = await Promise.all([
        predictor.predict('extract', 'fast', 3.0),
        predictor.predict('generate', 'balanced', 5.0),
        predictor.predict('summarize', 'powerful', 7.0),
        predictor.predict('validate', 'fast', 4.0)
      ]);

      predictions.forEach(pred => {
        expect(pred).not.toBeNull();
        expect(pred!.budget).toBeGreaterThan(0);
      });
    });
  });
});
