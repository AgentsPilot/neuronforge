/**
 * Shared test helpers for plugin executor tests.
 *
 * Provides factory functions to create fully-wired executor instances
 * and assertion helpers to validate results and fetch calls.
 */

import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { createMockUserConnections } from './mock-user-connections';
import { createTestPluginManager } from './mock-plugin-manager';
import type { MockConnection } from './mock-connection';
import { getLastFetchCall, getAllFetchCalls } from './mock-fetch';

// Type for any executor constructor
type ExecutorConstructor = new (
  userConnections: any,
  pluginManager: PluginManagerV2
) => any;

/**
 * Create a fully-wired executor instance for testing.
 *
 * Wires mock UserPluginConnections (returning the correct connection
 * for the given plugin key) and a real PluginManagerV2 loaded with
 * JSON definitions.
 */
export async function createTestExecutor<T>(
  ExecutorClass: new (uc: any, pm: PluginManagerV2) => T,
  pluginKey: string,
  connectionOverrides?: Partial<MockConnection>
): Promise<{ executor: T; pluginManager: PluginManagerV2 }> {
  const pluginManager = await createTestPluginManager();
  const userConnections = createMockUserConnections(pluginKey, connectionOverrides);
  const executor = new ExecutorClass(userConnections, pluginManager);

  return { executor, pluginManager };
}

// ---------- Assertion Helpers ----------

/**
 * Assert that an ExecutionResult indicates success.
 */
export function expectSuccessResult(result: any): void {
  expect(result).toBeDefined();
  expect(result.success).toBe(true);
  expect(result.data).toBeDefined();
}

/**
 * Assert that an ExecutionResult indicates failure.
 * Optionally checks that the error/message contains a substring.
 */
export function expectErrorResult(result: any, errorSubstring?: string): void {
  expect(result).toBeDefined();
  expect(result.success).toBe(false);
  if (errorSubstring) {
    const text = (result.error || '') + ' ' + (result.message || '');
    expect(text.toLowerCase()).toContain(errorSubstring.toLowerCase());
  }
}

/**
 * Assert the last fetch call matches a URL pattern and optionally method.
 */
export function expectFetchCalledWith(
  urlPattern: string | RegExp,
  method?: string
): void {
  const last = getLastFetchCall();
  expect(last).toBeDefined();
  if (typeof urlPattern === 'string') {
    expect(last!.url).toContain(urlPattern);
  } else {
    expect(last!.url).toMatch(urlPattern);
  }
  if (method) {
    const actualMethod = last!.options?.method || 'GET';
    expect(actualMethod.toUpperCase()).toBe(method.toUpperCase());
  }
}

/**
 * Assert that fetch was called exactly N times.
 */
export function expectFetchCallCount(expected: number): void {
  expect(getAllFetchCalls().length).toBe(expected);
}

/**
 * Assert that every fetch call included an Authorization header.
 */
export function expectAllFetchCallsAuthorized(): void {
  for (const call of getAllFetchCalls()) {
    const headers = call.options?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization || headers?.authorization).toBeDefined();
  }
}
