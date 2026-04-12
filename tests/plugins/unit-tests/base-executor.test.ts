/**
 * Unit tests for BasePluginExecutor.
 *
 * Uses a minimal TestPluginExecutor stub (SA-R1) to isolate base-class
 * behavior from any specific plugin implementation.
 *
 * Covers:
 *   P1-T4  error propagation chain through executeAction -> executeSpecificAction
 *   P1-T5  normalizeParameters (string-to-array conversion for array-typed schema fields)
 *   P3-T5  handleApiResponse fix tests (204 No Content, HTML error, non-JSON body)
 */

import { BasePluginExecutor } from '@/lib/server/base-plugin-executor';
import { createTestPluginManager } from '../common/mock-plugin-manager';
import { createMockUserConnections } from '../common/mock-user-connections';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { mockFetchSuccess, restoreFetch } from '../common/mock-fetch';
import { expectSuccessResult, expectErrorResult } from '../common/test-helpers';

// ---------------------------------------------------------------------------
// Minimal stub executor whose executeSpecificAction can be controlled per-test
// ---------------------------------------------------------------------------

type SpecificActionHandler = (
  connection: unknown,
  actionName: string,
  parameters: Record<string, unknown>
) => Promise<unknown>;

class TestPluginExecutor extends BasePluginExecutor {
  /**
   * Assign a handler before each test to control what executeSpecificAction does.
   * Defaults to returning an empty success payload.
   */
  public handler: SpecificActionHandler = async () => ({});

  constructor(
    pluginName: string,
    userConnections: ReturnType<typeof createMockUserConnections>,
    pluginManager: PluginManagerV2
  ) {
    super(pluginName, userConnections as never, pluginManager);
  }

  protected async executeSpecificAction(
    connection: unknown,
    actionName: string,
    parameters: Record<string, unknown>
  ): Promise<unknown> {
    return this.handler(connection, actionName, parameters);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a TestPluginExecutor wired to the real google-mail plugin definition. */
async function buildTestExecutor(pluginKey = 'google-mail') {
  const pluginManager = await createTestPluginManager();
  const userConnections = createMockUserConnections(pluginKey);
  const executor = new TestPluginExecutor(pluginKey, userConnections, pluginManager);
  return { executor, pluginManager };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BasePluginExecutor', () => {
  beforeEach(() => {
    // Provide a default successful fetch mock so the base class does not
    // accidentally hit the network during validation / connection lookup.
    mockFetchSuccess({});
  });

  afterEach(() => {
    restoreFetch();
  });

  // -----------------------------------------------------------------------
  // P1-T4: Error propagation chain
  // -----------------------------------------------------------------------

  describe('[smoke]', () => {
    describe('error propagation', () => {
      it('surfaces Error thrown in executeSpecificAction as { success: false } with the error message', async () => {
        const { executor } = await buildTestExecutor();
        executor.handler = async () => {
          throw new Error('API failed');
        };

        const result = await executor.executeAction('test-user-id', 'send_email', {
          recipients: { to: ['a@b.com'] },
          content: { subject: 'hi', body: 'hello' },
        });

        expect(result.success).toBe(false);
        // The base class mapErrorToMessage should include the original message
        expect(result.message).toBeDefined();
        expect(
          (result.error || '') + ' ' + (result.message || '')
        ).toContain('API failed');
      });

      it('surfaces error.code when the thrown error has a .code property', async () => {
        const { executor } = await buildTestExecutor();
        executor.handler = async () => {
          const err = new Error('Something went wrong') as Error & { code: string };
          err.code = 'CUSTOM_ERR_CODE';
          throw err;
        };

        const result = await executor.executeAction('test-user-id', 'send_email', {
          recipients: { to: ['a@b.com'] },
          content: { subject: 'hi', body: 'hello' },
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('CUSTOM_ERR_CODE');
      });

      it('returns validation error independently of executeSpecificAction errors', async () => {
        const { executor } = await buildTestExecutor();

        // The handler should NOT be called because validation should fail first
        let handlerCalled = false;
        executor.handler = async () => {
          handlerCalled = true;
          return {};
        };

        // send_email requires 'recipients' — omit it to trigger validation failure
        const result = await executor.executeAction('test-user-id', 'send_email', {});

        expect(result.success).toBe(false);
        expect(handlerCalled).toBe(false);
      });
    });
  });

  describe('[full]', () => {
    describe('error propagation edge cases', () => {
      it('handles non-Error throws (string) gracefully', async () => {
        const { executor } = await buildTestExecutor();
        executor.handler = async () => {
          // eslint-disable-next-line no-throw-literal
          throw 'raw string error';
        };

        const result = await executor.executeAction('test-user-id', 'send_email', {
          recipients: { to: ['a@b.com'] },
          content: { subject: 'hi', body: 'hello' },
        });

        expect(result.success).toBe(false);
        // Should not crash — the base class catch handles any type
      });
    });
  });

  // -----------------------------------------------------------------------
  // P3-T5: handleApiResponse fix tests
  // -----------------------------------------------------------------------

  describe('[full]', () => {
    describe('handleApiResponse', () => {
      it('returns empty object for 204 No Content', async () => {
        const { executor } = await buildTestExecutor();

        // Access the protected method via the handler which calls it
        executor.handler = async function (this: any) {
          // Build a mock 204 response
          const response = {
            ok: true,
            status: 204,
            statusText: 'No Content',
            headers: new Headers(),
            text: async () => '',
            json: async () => { throw new Error('No body'); },
          } as unknown as Response;
          // Call handleApiResponse directly via the executor's prototype
          return await (executor as any).handleApiResponse(response, 'test_operation');
        };

        // Use a simple action that passes validation
        const result = await executor.executeAction('test-user-id', 'send_email', {
          recipients: { to: ['a@b.com'] },
          content: { subject: 'hi', body: 'hello' },
        });

        expectSuccessResult(result);
        // The data should be the empty object returned by handleApiResponse
        expect(result.data).toEqual({});
      });

      it('throws meaningful error for HTML error pages (non-ok response)', async () => {
        const { executor } = await buildTestExecutor();

        executor.handler = async function () {
          const htmlBody = '<html><body><h1>411 Length Required</h1></body></html>';
          const response = {
            ok: false,
            status: 411,
            statusText: 'Length Required',
            headers: new Headers({ 'content-type': 'text/html' }),
            text: async () => htmlBody,
            json: async () => { throw new SyntaxError('Unexpected token <'); },
          } as unknown as Response;
          return await (executor as any).handleApiResponse(response, 'test_operation');
        };

        const result = await executor.executeAction('test-user-id', 'send_email', {
          recipients: { to: ['a@b.com'] },
          content: { subject: 'hi', body: 'hello' },
        });

        expectErrorResult(result);
        // Should contain status code and the HTML body in the error
        const errorText = (result.error || '') + ' ' + (result.message || '');
        expect(errorText).toContain('411');
      });

      it('throws meaningful error for non-JSON success response (XML/text body)', async () => {
        const { executor } = await buildTestExecutor();

        executor.handler = async function () {
          const xmlBody = '<?xml version="1.0"?><response><status>ok</status></response>';
          const response = {
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: new Headers({ 'content-type': 'application/xml' }),
            json: async () => { throw new SyntaxError('Unexpected token <'); },
            text: async () => xmlBody,
          } as unknown as Response;
          return await (executor as any).handleApiResponse(response, 'test_operation');
        };

        const result = await executor.executeAction('test-user-id', 'send_email', {
          recipients: { to: ['a@b.com'] },
          content: { subject: 'hi', body: 'hello' },
        });

        expectErrorResult(result);
        const errorText = (result.error || '') + ' ' + (result.message || '');
        expect(errorText.toLowerCase()).toContain('json');
      });
    });
  });

  // -----------------------------------------------------------------------
  // P1-T5: normalizeParameters
  // -----------------------------------------------------------------------

  describe('[smoke]', () => {
    describe('normalizeParameters', () => {
      it('converts a string value to a single-element array when schema declares type "array"', async () => {
        const { executor } = await buildTestExecutor('google-mail');

        // Capture the parameters as received by executeSpecificAction
        let receivedParams: Record<string, unknown> = {};
        executor.handler = async (_conn, _action, params) => {
          receivedParams = params as Record<string, unknown>;
          // Return a minimal valid result so the base class does not error
          return {
            message_id: 'test',
            labels_added: [],
            labels_removed: [],
          };
        };

        // modify_email has 'add_labels' declared as type: "array" in the schema.
        // Passing a string should be normalized to an array by the base class.
        await executor.executeAction('test-user-id', 'modify_email', {
          message_id: 'msg-123',
          add_labels: 'AgentsPilot',
        });

        expect(receivedParams.add_labels).toEqual(['AgentsPilot']);
      });

      it('leaves an already-array value unchanged', async () => {
        const { executor } = await buildTestExecutor('google-mail');

        let receivedParams: Record<string, unknown> = {};
        executor.handler = async (_conn, _action, params) => {
          receivedParams = params as Record<string, unknown>;
          return {
            message_id: 'test',
            labels_added: [],
            labels_removed: [],
          };
        };

        await executor.executeAction('test-user-id', 'modify_email', {
          message_id: 'msg-123',
          add_labels: ['Label1', 'Label2'],
        });

        expect(receivedParams.add_labels).toEqual(['Label1', 'Label2']);
      });

      it('does not affect non-array schema fields', async () => {
        const { executor } = await buildTestExecutor('google-mail');

        let receivedParams: Record<string, unknown> = {};
        executor.handler = async (_conn, _action, params) => {
          receivedParams = params as Record<string, unknown>;
          return {
            message_id: 'test',
            labels_added: [],
            labels_removed: [],
          };
        };

        await executor.executeAction('test-user-id', 'modify_email', {
          message_id: 'msg-123',
          mark_important: true,
        });

        // message_id is type string — should remain a string
        expect(receivedParams.message_id).toBe('msg-123');
        // mark_important is type boolean — should remain a boolean
        expect(receivedParams.mark_important).toBe(true);
      });
    });
  });
});
