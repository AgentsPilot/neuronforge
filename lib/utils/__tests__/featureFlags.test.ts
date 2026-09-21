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

  describe('isThreadBasedAgentCreationEnabled', () => {
    it('should return false when flag is not set', () => {
      // Import after setting env to ensure fresh module
      const { isThreadBasedAgentCreationEnabled } = require('../featureFlags');
      delete process.env.USE_THREAD_BASED_AGENT_CREATION;
      expect(isThreadBasedAgentCreationEnabled()).toBe(false);
    });

    it('should return false when flag is "false"', () => {
      process.env.USE_THREAD_BASED_AGENT_CREATION = 'false';
      const { isThreadBasedAgentCreationEnabled } = require('../featureFlags');
      expect(isThreadBasedAgentCreationEnabled()).toBe(false);
    });

    it('should return false when flag is "0"', () => {
      process.env.USE_THREAD_BASED_AGENT_CREATION = '0';
      const { isThreadBasedAgentCreationEnabled } = require('../featureFlags');
      expect(isThreadBasedAgentCreationEnabled()).toBe(false);
    });

    it('should return true when flag is "true"', () => {
      process.env.USE_THREAD_BASED_AGENT_CREATION = 'true';
      const { isThreadBasedAgentCreationEnabled } = require('../featureFlags');
      expect(isThreadBasedAgentCreationEnabled()).toBe(true);
    });

    it('should return true when flag is "1"', () => {
      process.env.USE_THREAD_BASED_AGENT_CREATION = '1';
      const { isThreadBasedAgentCreationEnabled } = require('../featureFlags');
      expect(isThreadBasedAgentCreationEnabled()).toBe(true);
    });

    it('should return false for invalid values', () => {
      process.env.USE_THREAD_BASED_AGENT_CREATION = 'invalid';
      const { isThreadBasedAgentCreationEnabled } = require('../featureFlags');
      expect(isThreadBasedAgentCreationEnabled()).toBe(false);
    });

    it('should be case-insensitive for "true"', () => {
      process.env.USE_THREAD_BASED_AGENT_CREATION = 'TRUE';
      const { isThreadBasedAgentCreationEnabled } = require('../featureFlags');
      expect(isThreadBasedAgentCreationEnabled()).toBe(true);
    });

    it('should be case-insensitive for "false"', () => {
      process.env.USE_THREAD_BASED_AGENT_CREATION = 'FALSE';
      const { isThreadBasedAgentCreationEnabled } = require('../featureFlags');
      expect(isThreadBasedAgentCreationEnabled()).toBe(false);
    });

    // Additional edge case tests
    it('should return false for empty string', () => {
      process.env.USE_THREAD_BASED_AGENT_CREATION = '';
      const { isThreadBasedAgentCreationEnabled } = require('../featureFlags');
      expect(isThreadBasedAgentCreationEnabled()).toBe(false);
    });

    it('should return false for whitespace', () => {
      process.env.USE_THREAD_BASED_AGENT_CREATION = '   ';
      const { isThreadBasedAgentCreationEnabled } = require('../featureFlags');
      expect(isThreadBasedAgentCreationEnabled()).toBe(false);
    });

    it('should handle mixed case correctly', () => {
      process.env.USE_THREAD_BASED_AGENT_CREATION = 'TrUe';
      const { isThreadBasedAgentCreationEnabled } = require('../featureFlags');
      expect(isThreadBasedAgentCreationEnabled()).toBe(true);
    });

    it('should return false for numeric values other than 1', () => {
      process.env.USE_THREAD_BASED_AGENT_CREATION = '2';
      const { isThreadBasedAgentCreationEnabled } = require('../featureFlags');
      expect(isThreadBasedAgentCreationEnabled()).toBe(false);
    });

    it('should return false for "yes"', () => {
      process.env.USE_THREAD_BASED_AGENT_CREATION = 'yes';
      const { isThreadBasedAgentCreationEnabled } = require('../featureFlags');
      expect(isThreadBasedAgentCreationEnabled()).toBe(false);
    });

    it('should return false for "on"', () => {
      process.env.USE_THREAD_BASED_AGENT_CREATION = 'on';
      const { isThreadBasedAgentCreationEnabled } = require('../featureFlags');
      expect(isThreadBasedAgentCreationEnabled()).toBe(false);
    });
  });

  describe('getFeatureFlags', () => {
    it('should return all feature flags with thread flag enabled', () => {
      process.env.USE_THREAD_BASED_AGENT_CREATION = 'true';
      const { getFeatureFlags } = require('../featureFlags');
      const flags = getFeatureFlags();

      expect(flags).toHaveProperty('isThreadBasedAgentCreationEnabled');
      expect(flags.isThreadBasedAgentCreationEnabled).toBe(true);
    });

    it('should return all feature flags with thread flag disabled', () => {
      process.env.USE_THREAD_BASED_AGENT_CREATION = 'false';
      const { getFeatureFlags } = require('../featureFlags');
      const flags = getFeatureFlags();

      expect(flags.isThreadBasedAgentCreationEnabled).toBe(false);
    });

    it('should reflect current environment state', () => {
      // First call with false
      process.env.USE_THREAD_BASED_AGENT_CREATION = 'false';
      const { getFeatureFlags: getFlags1 } = require('../featureFlags');
      const flags1 = getFlags1();
      expect(flags1.isThreadBasedAgentCreationEnabled).toBe(false);

      // Reset modules and change env
      jest.resetModules();
      process.env.USE_THREAD_BASED_AGENT_CREATION = 'true';
      const { getFeatureFlags: getFlags2 } = require('../featureFlags');
      const flags2 = getFlags2();
      expect(flags2.isThreadBasedAgentCreationEnabled).toBe(true);
    });

    it('should return an object with all expected properties', () => {
      const { getFeatureFlags } = require('../featureFlags');
      const flags = getFeatureFlags();

      expect(typeof flags).toBe('object');
      expect(flags).not.toBeNull();
      expect('isThreadBasedAgentCreationEnabled' in flags).toBe(true);
      expect('isV6AgentGenerationEnabled' in flags).toBe(true);
    });
  });

  describe('isV6AgentGenerationEnabled', () => {
    beforeEach(() => {
      jest.resetModules();
      delete process.env.NEXT_PUBLIC_USE_V6_AGENT_GENERATION;
    });

    it('should return false when flag is not set', () => {
      const { isV6AgentGenerationEnabled } = require('../featureFlags');
      delete process.env.NEXT_PUBLIC_USE_V6_AGENT_GENERATION;
      expect(isV6AgentGenerationEnabled()).toBe(false);
    });

    it('should return false when flag is "false"', () => {
      process.env.NEXT_PUBLIC_USE_V6_AGENT_GENERATION = 'false';
      const { isV6AgentGenerationEnabled } = require('../featureFlags');
      expect(isV6AgentGenerationEnabled()).toBe(false);
    });

    it('should return false when flag is "0"', () => {
      process.env.NEXT_PUBLIC_USE_V6_AGENT_GENERATION = '0';
      const { isV6AgentGenerationEnabled } = require('../featureFlags');
      expect(isV6AgentGenerationEnabled()).toBe(false);
    });

    it('should return true when flag is "true"', () => {
      process.env.NEXT_PUBLIC_USE_V6_AGENT_GENERATION = 'true';
      const { isV6AgentGenerationEnabled } = require('../featureFlags');
      expect(isV6AgentGenerationEnabled()).toBe(true);
    });

    it('should return true when flag is "1"', () => {
      process.env.NEXT_PUBLIC_USE_V6_AGENT_GENERATION = '1';
      const { isV6AgentGenerationEnabled } = require('../featureFlags');
      expect(isV6AgentGenerationEnabled()).toBe(true);
    });

    it('should return false for invalid values', () => {
      process.env.NEXT_PUBLIC_USE_V6_AGENT_GENERATION = 'invalid';
      const { isV6AgentGenerationEnabled } = require('../featureFlags');
      expect(isV6AgentGenerationEnabled()).toBe(false);
    });

    it('should be case-insensitive for "true"', () => {
      process.env.NEXT_PUBLIC_USE_V6_AGENT_GENERATION = 'TRUE';
      const { isV6AgentGenerationEnabled } = require('../featureFlags');
      expect(isV6AgentGenerationEnabled()).toBe(true);
    });

    it('should be case-insensitive for "false"', () => {
      process.env.NEXT_PUBLIC_USE_V6_AGENT_GENERATION = 'FALSE';
      const { isV6AgentGenerationEnabled } = require('../featureFlags');
      expect(isV6AgentGenerationEnabled()).toBe(false);
    });

    it('should return false for empty string', () => {
      process.env.NEXT_PUBLIC_USE_V6_AGENT_GENERATION = '';
      const { isV6AgentGenerationEnabled } = require('../featureFlags');
      expect(isV6AgentGenerationEnabled()).toBe(false);
    });

    it('should return false for whitespace', () => {
      process.env.NEXT_PUBLIC_USE_V6_AGENT_GENERATION = '   ';
      const { isV6AgentGenerationEnabled } = require('../featureFlags');
      expect(isV6AgentGenerationEnabled()).toBe(false);
    });

    it('should handle mixed case correctly', () => {
      process.env.NEXT_PUBLIC_USE_V6_AGENT_GENERATION = 'TrUe';
      const { isV6AgentGenerationEnabled } = require('../featureFlags');
      expect(isV6AgentGenerationEnabled()).toBe(true);
    });
  });

  describe('isV6ReviewModeEnabled', () => {
    beforeEach(() => {
      jest.resetModules();
      delete process.env.NEXT_PUBLIC_USE_V6_REVIEW_MODE;
    });

    // NOTE: This flag defaults to TRUE (unlike other flags that default to false)
    it('should return true when flag is not set (default behavior)', () => {
      const { isV6ReviewModeEnabled } = require('../featureFlags');
      delete process.env.NEXT_PUBLIC_USE_V6_REVIEW_MODE;
      expect(isV6ReviewModeEnabled()).toBe(true);
    });

    it('should return false when flag is "false"', () => {
      process.env.NEXT_PUBLIC_USE_V6_REVIEW_MODE = 'false';
      const { isV6ReviewModeEnabled } = require('../featureFlags');
      expect(isV6ReviewModeEnabled()).toBe(false);
    });

    it('should return false when flag is "0"', () => {
      process.env.NEXT_PUBLIC_USE_V6_REVIEW_MODE = '0';
      const { isV6ReviewModeEnabled } = require('../featureFlags');
      expect(isV6ReviewModeEnabled()).toBe(false);
    });

    it('should return true when flag is "true"', () => {
      process.env.NEXT_PUBLIC_USE_V6_REVIEW_MODE = 'true';
      const { isV6ReviewModeEnabled } = require('../featureFlags');
      expect(isV6ReviewModeEnabled()).toBe(true);
    });

    it('should return true when flag is "1"', () => {
      process.env.NEXT_PUBLIC_USE_V6_REVIEW_MODE = '1';
      const { isV6ReviewModeEnabled } = require('../featureFlags');
      expect(isV6ReviewModeEnabled()).toBe(true);
    });

    // NOTE: Invalid values default to TRUE for this flag
    it('should return true for invalid values (defaults to true)', () => {
      process.env.NEXT_PUBLIC_USE_V6_REVIEW_MODE = 'invalid';
      const { isV6ReviewModeEnabled } = require('../featureFlags');
      expect(isV6ReviewModeEnabled()).toBe(true);
    });

    it('should be case-insensitive for "true"', () => {
      process.env.NEXT_PUBLIC_USE_V6_REVIEW_MODE = 'TRUE';
      const { isV6ReviewModeEnabled } = require('../featureFlags');
      expect(isV6ReviewModeEnabled()).toBe(true);
    });

    it('should be case-insensitive for "false"', () => {
      process.env.NEXT_PUBLIC_USE_V6_REVIEW_MODE = 'FALSE';
      const { isV6ReviewModeEnabled } = require('../featureFlags');
      expect(isV6ReviewModeEnabled()).toBe(false);
    });

    // NOTE: Empty string defaults to TRUE for this flag
    it('should return true for empty string (defaults to true)', () => {
      process.env.NEXT_PUBLIC_USE_V6_REVIEW_MODE = '';
      const { isV6ReviewModeEnabled } = require('../featureFlags');
      expect(isV6ReviewModeEnabled()).toBe(true);
    });

    // NOTE: Whitespace defaults to TRUE for this flag
    it('should return true for whitespace (defaults to true)', () => {
      process.env.NEXT_PUBLIC_USE_V6_REVIEW_MODE = '   ';
      const { isV6ReviewModeEnabled } = require('../featureFlags');
      expect(isV6ReviewModeEnabled()).toBe(true);
    });

    it('should handle mixed case correctly', () => {
      process.env.NEXT_PUBLIC_USE_V6_REVIEW_MODE = 'TrUe';
      const { isV6ReviewModeEnabled } = require('../featureFlags');
      expect(isV6ReviewModeEnabled()).toBe(true);
    });

    it('should handle mixed case for false correctly', () => {
      process.env.NEXT_PUBLIC_USE_V6_REVIEW_MODE = 'FaLsE';
      const { isV6ReviewModeEnabled } = require('../featureFlags');
      expect(isV6ReviewModeEnabled()).toBe(false);
    });
  });

  describe('getFeatureFlags includes isV6ReviewModeEnabled', () => {
    beforeEach(() => {
      jest.resetModules();
      delete process.env.NEXT_PUBLIC_USE_V6_REVIEW_MODE;
    });

    it('should include isV6ReviewModeEnabled property', () => {
      const { getFeatureFlags } = require('../featureFlags');
      const flags = getFeatureFlags();

      expect('isV6ReviewModeEnabled' in flags).toBe(true);
    });

    it('should return isV6ReviewModeEnabled as true by default', () => {
      const { getFeatureFlags } = require('../featureFlags');
      const flags = getFeatureFlags();

      expect(flags.isV6ReviewModeEnabled).toBe(true);
    });

    it('should return isV6ReviewModeEnabled as false when explicitly disabled', () => {
      process.env.NEXT_PUBLIC_USE_V6_REVIEW_MODE = 'false';
      const { getFeatureFlags } = require('../featureFlags');
      const flags = getFeatureFlags();

      expect(flags.isV6ReviewModeEnabled).toBe(false);
    });
  });
});
