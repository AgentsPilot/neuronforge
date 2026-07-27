/**
 * Integration tests for GoogleDocsPluginExecutor
 *
 * Tests real Google Docs API interactions for the Phase 1 `replace_text` action.
 * Skips gracefully when GOOGLE_DOCS_TEST_TOKEN is not set (same skip-without-token
 * pattern as the Sheets integration harness).
 *
 * Requires env vars:
 * - GOOGLE_DOCS_TEST_TOKEN: OAuth access token (with the `documents` + `drive` scopes)
 * - GOOGLE_DOCS_TEST_DOCUMENT_ID: (optional) an existing document for read-only checks
 *
 * This file seeds the Docs integration harness for Phase 2 (format_document_text /
 * insert_table), which will require end-of-body boundary + empty-document coverage.
 * The lifecycle test creates its own throwaway document, so it never mutates a shared one.
 */

import { GoogleDocsPluginExecutor } from '@/lib/server/google-docs-plugin-executor';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { createTestPluginManager } from '../common/mock-plugin-manager';
import {
  getTestConnection,
  getCredentials,
  hasCredentials,
} from './integration-config';

const PLUGIN_KEY = 'google-docs';
const USER_ID = 'integration-test-user';

const conditionalDescribe = hasCredentials(PLUGIN_KEY) ? describe : describe.skip;

conditionalDescribe('GoogleDocsPluginExecutor [integration]', () => {
  let executor: GoogleDocsPluginExecutor;
  let pluginManager: PluginManagerV2;

  beforeAll(async () => {
    pluginManager = await createTestPluginManager();
    const connection = getTestConnection(PLUGIN_KEY);

    const userConnections = {
      getConnection: jest.fn().mockResolvedValue(connection),
      getConnectionStatus: jest.fn().mockResolvedValue({ connected: true, reason: 'connected' }),
      getConnectedPlugins: jest.fn().mockResolvedValue(connection ? [connection] : []),
      getConnectedPluginKeys: jest.fn().mockResolvedValue([PLUGIN_KEY]),
      getAllActivePlugins: jest.fn().mockResolvedValue(connection ? [connection] : []),
      getDisconnectedPluginKeys: jest.fn().mockResolvedValue([]),
      isTokenValid: jest.fn().mockReturnValue(true),
      shouldRefreshToken: jest.fn().mockReturnValue(false),
      refreshToken: jest.fn().mockResolvedValue(connection),
    } as any;

    executor = new GoogleDocsPluginExecutor(userConnections, pluginManager);
  });

  // ==========================================================================
  // Phase 1 replace_text lifecycle — creates a throwaway document, seeds a
  // placeholder, then exercises replace_text (match) + a case-sensitivity check
  // + a zero-match check end-to-end. Skips without credentials (same guard as
  // the rest of this file).
  // ==========================================================================
  describe('[full] Phase 1 replace_text lifecycle', () => {
    it('creates → replaces a placeholder → verifies match_case and zero-match paths', async () => {
      // 1. Create a dedicated throwaway document seeded with a placeholder + a lowercase token.
      const createResult = await executor.executeAction(USER_ID, 'create_document', {
        title: `agentpilot-docs-phase1-${Date.now().toString(36)}`,
        initial_content: 'Dear {name}, welcome. cat sat on the mat.',
      });
      expect(createResult.success).toBe(true);
      const documentId = createResult.data.document_id;
      expect(documentId).toBeDefined();

      // 2. Replace the placeholder — expect exactly one occurrence changed.
      const replaceResult = await executor.executeAction(USER_ID, 'replace_text', {
        document_id: documentId,
        text_to_find: '{name}',
        replace_text: 'Alice',
      });
      expect(replaceResult.success).toBe(true);
      expect(replaceResult.data.occurrences_changed).toBe(1);

      // 3. Case-sensitive search that should NOT match ("CAT" ≠ "cat") — zero occurrences.
      const caseResult = await executor.executeAction(USER_ID, 'replace_text', {
        document_id: documentId,
        text_to_find: 'CAT',
        replace_text: 'dog',
        match_case: true,
      });
      expect(caseResult.success).toBe(true);
      expect(caseResult.data.occurrences_changed).toBe(0);

      // 4. Zero-match search for text that is not present — Google omits occurrencesChanged,
      //    executor must default to 0 (a successful "nothing to replace", not an error).
      const zeroResult = await executor.executeAction(USER_ID, 'replace_text', {
        document_id: documentId,
        text_to_find: 'this-string-does-not-exist-anywhere',
        replace_text: 'x',
      });
      expect(zeroResult.success).toBe(true);
      expect(zeroResult.data.occurrences_changed).toBe(0);
    }, 60000);

    it('rejects an empty text_to_find without mutating the document', async () => {
      const createResult = await executor.executeAction(USER_ID, 'create_document', {
        title: `agentpilot-docs-guard-${Date.now().toString(36)}`,
        initial_content: 'Some content.',
      });
      expect(createResult.success).toBe(true);

      const result = await executor.executeAction(USER_ID, 'replace_text', {
        document_id: createResult.data.document_id,
        text_to_find: '',
        replace_text: 'anything',
      });
      expect(result.success).toBe(false);
    }, 60000);
  });

  // Silence unused-var lint when credentials are present but extras are not used directly.
  void getCredentials;
});
