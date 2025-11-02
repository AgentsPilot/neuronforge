/**
 * Feature Flags Tests
 *
 * Tests for the feature flag utility functions.
 * These tests verify proper handling of environment variables
 * and correct fallback behavior for thread-based agent creation.
 */

describe('Feature Flags', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset modules to ensure fresh imports for each test
    jest.resetModules();
    // Create a new copy of process.env for isolation
    process.env = { ...originalEnv };
    // Clear the specific flag we're testing
    delete process.env.USE_THREAD_BASED_AGENT_CREATION;
  });

  afterAll(() => {
    // Restore original environment after all tests
    process.env = originalEnv;
  });

  describe('useThreadBasedAgentCreation', () => {
    it('should return false when flag is not set', () => {
      // Import after setting env to ensure fresh module
      const { useThreadBasedAgentCreation } = require('../featureFlags');
      delete process.env.USE_THREAD_BASED_AGENT_CREATION;
      expect(useThreadBasedAgentCreation()).toBe(false);
    });

    it('should return false when flag is "false"', () => {
      process.env.USE_THREAD_BASED_AGENT_CREATION = 'false';
      const { useThreadBasedAgentCreation } = require('../featureFlags');
      expect(useThreadBasedAgentCreation()).toBe(false);
    });

    it('should return false when flag is "0"', () => {
      process.env.USE_THREAD_BASED_AGENT_CREATION = '0';
      const { useThreadBasedAgentCreation } = require('../featureFlags');
      expect(useThreadBasedAgentCreation()).toBe(false);
    });

    it('should return true when flag is "true"', () => {
      process.env.USE_THREAD_BASED_AGENT_CREATION = 'true';
      const { useThreadBasedAgentCreation } = require('../featureFlags');
      expect(useThreadBasedAgentCreation()).toBe(true);
    });

    it('should return true when flag is "1"', () => {
      process.env.USE_THREAD_BASED_AGENT_CREATION = '1';
      const { useThreadBasedAgentCreation } = require('../featureFlags');
      expect(useThreadBasedAgentCreation()).toBe(true);
    });

    it('should return false for invalid values', () => {
      process.env.USE_THREAD_BASED_AGENT_CREATION = 'invalid';
      const { useThreadBasedAgentCreation } = require('../featureFlags');
      expect(useThreadBasedAgentCreation()).toBe(false);
    });

    it('should be case-insensitive for "true"', () => {
      process.env.USE_THREAD_BASED_AGENT_CREATION = 'TRUE';
      const { useThreadBasedAgentCreation } = require('../featureFlags');
      expect(useThreadBasedAgentCreation()).toBe(true);
    });

    it('should be case-insensitive for "false"', () => {
      process.env.USE_THREAD_BASED_AGENT_CREATION = 'FALSE';
      const { useThreadBasedAgentCreation } = require('../featureFlags');
      expect(useThreadBasedAgentCreation()).toBe(false);
    });

    // Additional edge case tests
    it('should return false for empty string', () => {
      process.env.USE_THREAD_BASED_AGENT_CREATION = '';
      const { useThreadBasedAgentCreation } = require('../featureFlags');
      expect(useThreadBasedAgentCreation()).toBe(false);
    });

    it('should return false for whitespace', () => {
      process.env.USE_THREAD_BASED_AGENT_CREATION = '   ';
      const { useThreadBasedAgentCreation } = require('../featureFlags');
      expect(useThreadBasedAgentCreation()).toBe(false);
    });

    it('should handle mixed case correctly', () => {
      process.env.USE_THREAD_BASED_AGENT_CREATION = 'TrUe';
      const { useThreadBasedAgentCreation } = require('../featureFlags');
      expect(useThreadBasedAgentCreation()).toBe(true);
    });

    it('should return false for numeric values other than 1', () => {
      process.env.USE_THREAD_BASED_AGENT_CREATION = '2';
      const { useThreadBasedAgentCreation } = require('../featureFlags');
      expect(useThreadBasedAgentCreation()).toBe(false);
    });

    it('should return false for "yes"', () => {
      process.env.USE_THREAD_BASED_AGENT_CREATION = 'yes';
      const { useThreadBasedAgentCreation } = require('../featureFlags');
      expect(useThreadBasedAgentCreation()).toBe(false);
    });

    it('should return false for "on"', () => {
      process.env.USE_THREAD_BASED_AGENT_CREATION = 'on';
      const { useThreadBasedAgentCreation } = require('../featureFlags');
      expect(useThreadBasedAgentCreation()).toBe(false);
    });
  });

  describe('getFeatureFlags', () => {
    it('should return all feature flags with thread flag enabled', () => {
      process.env.USE_THREAD_BASED_AGENT_CREATION = 'true';
      const { getFeatureFlags } = require('../featureFlags');
      const flags = getFeatureFlags();

      expect(flags).toHaveProperty('useThreadBasedAgentCreation');
      expect(flags.useThreadBasedAgentCreation).toBe(true);
    });

    it('should return all feature flags with thread flag disabled', () => {
      process.env.USE_THREAD_BASED_AGENT_CREATION = 'false';
      const { getFeatureFlags } = require('../featureFlags');
      const flags = getFeatureFlags();

      expect(flags.useThreadBasedAgentCreation).toBe(false);
    });

    it('should reflect current environment state', () => {
      // First call with false
      process.env.USE_THREAD_BASED_AGENT_CREATION = 'false';
      const { getFeatureFlags: getFlags1 } = require('../featureFlags');
      const flags1 = getFlags1();
      expect(flags1.useThreadBasedAgentCreation).toBe(false);

      // Reset modules and change env
      jest.resetModules();
      process.env.USE_THREAD_BASED_AGENT_CREATION = 'true';
      const { getFeatureFlags: getFlags2 } = require('../featureFlags');
      const flags2 = getFlags2();
      expect(flags2.useThreadBasedAgentCreation).toBe(true);
    });

    it('should return an object with all expected properties', () => {
      const { getFeatureFlags } = require('../featureFlags');
      const flags = getFeatureFlags();

      expect(typeof flags).toBe('object');
      expect(flags).not.toBeNull();
      expect('useThreadBasedAgentCreation' in flags).toBe(true);
    });
  });
});
