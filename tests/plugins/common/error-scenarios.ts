/**
 * Shared error scenario test helper for plugin executor tests.
 *
 * Runs a standard battery of error scenarios against any executor+action
 * combination, reducing boilerplate across all 19 plugin test files.
 *
 * All tests are wrapped in describe('[full]', ...) per P3-07.
 */

import { mockFetchError, mockFetchThrow, restoreFetch } from './mock-fetch';
import { createMockUserConnections } from './mock-user-connections';
import { createTestPluginManager } from './mock-plugin-manager';
import { expectErrorResult } from './test-helpers';

const USER_ID = 'test-user-id';

/**
 * Run the standard battery of error scenarios against any executor+action.
 *
 * @param getExecutor - Returns the pre-built executor instance (uses existing connection)
 * @param ExecutorClass - The executor constructor, needed to build a null-connection instance
 * @param pluginKey - The plugin key for this executor
 * @param actionName - The action to test
 * @param validParams - Valid parameters for the action (used so validation passes)
 */
export function runStandardErrorScenarios(
  getExecutor: () => any,
  ExecutorClass: new (uc: any, pm: any) => any,
  pluginKey: string,
  actionName: string,
  validParams: Record<string, any>
): void {
  describe(`error scenarios for ${actionName}`, () => {
    afterEach(() => {
      restoreFetch();
    });

    it('handles network failure (DNS/timeout/connection reset)', async () => {
      mockFetchThrow(new Error('Network error'));
      const result = await getExecutor().executeAction(USER_ID, actionName, validParams);
      expectErrorResult(result, 'network error');
    });

    it('handles HTTP 401 Unauthorized', async () => {
      mockFetchError(401, { error: 'Unauthorized' });
      const result = await getExecutor().executeAction(USER_ID, actionName, validParams);
      expectErrorResult(result);
    });

    it('handles HTTP 403 Forbidden', async () => {
      mockFetchError(403, { error: 'Forbidden' });
      const result = await getExecutor().executeAction(USER_ID, actionName, validParams);
      expectErrorResult(result);
    });

    it('handles HTTP 404 Not Found', async () => {
      mockFetchError(404, { error: 'Not Found' });
      const result = await getExecutor().executeAction(USER_ID, actionName, validParams);
      expectErrorResult(result);
    });

    it('handles HTTP 429 Rate Limited', async () => {
      mockFetchError(429, { error: 'Too Many Requests' });
      const result = await getExecutor().executeAction(USER_ID, actionName, validParams);
      expectErrorResult(result);
    });

    it('handles HTTP 500 Server Error', async () => {
      mockFetchError(500, { error: 'Internal Server Error' });
      const result = await getExecutor().executeAction(USER_ID, actionName, validParams);
      expectErrorResult(result);
    });

    it('handles malformed JSON response', async () => {
      mockFetchError(200, 'this is not valid json {{{');
      const result = await getExecutor().executeAction(USER_ID, actionName, validParams);
      // Some executors treat status 200 with bad body as success path failure,
      // others as error — both are acceptable as long as it doesn't crash
      expect(result).toBeDefined();
    });

    it('handles empty string response body', async () => {
      mockFetchError(200, '');
      const result = await getExecutor().executeAction(USER_ID, actionName, validParams);
      expect(result).toBeDefined();
    });

    it('handles null connection (plugin not connected)', async () => {
      // Build a separate executor with null connection (SA-3)
      const pluginManager = await createTestPluginManager();
      const nullConnections = createMockUserConnections(); // no pluginKey = getConnection returns null
      const nullExecutor = new ExecutorClass(nullConnections, pluginManager);

      // No fetch mock needed — should fail before making any network call
      const result = await nullExecutor.executeAction(USER_ID, actionName, validParams);
      expectErrorResult(result);
    });
  });
}
