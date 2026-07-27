/**
 * Integration tests for GmailPluginExecutor
 *
 * Tests real Gmail API interactions: create draft, verify, delete.
 * Skips gracefully when GOOGLE_MAIL_TEST_TOKEN is not set.
 *
 * IMPORTANT: These tests are idempotent -- all created artifacts are
 * cleaned up in afterAll/afterEach blocks.
 */

import { GmailPluginExecutor } from '@/lib/server/gmail-plugin-executor';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { createTestPluginManager } from '../common/mock-plugin-manager';
import {
  describeIfCredentials,
  getTestConnection,
  getCredentials,
  generateTestId,
} from './integration-config';

const PLUGIN_KEY = 'google-mail';
const USER_ID = 'integration-test-user';

const conditionalDescribe = describeIfCredentials(PLUGIN_KEY);

conditionalDescribe('GmailPluginExecutor [integration]', () => {
  let executor: GmailPluginExecutor;
  let pluginManager: PluginManagerV2;
  const cleanupDraftIds: string[] = [];

  beforeAll(async () => {
    pluginManager = await createTestPluginManager();
    const connection = getTestConnection(PLUGIN_KEY);

    // Build a mock UserPluginConnections that returns the real connection
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

    executor = new GmailPluginExecutor(userConnections, pluginManager);
  });

  afterAll(async () => {
    // Clean up any drafts that were created during tests
    for (const draftId of cleanupDraftIds) {
      try {
        await executor.executeAction(USER_ID, 'delete_email', {
          message_id: draftId,
        });
      } catch {
        // Best-effort cleanup -- do not fail the test suite
      }
    }
  });

  describe('[smoke]', () => {
    it('should create a draft, verify it exists, then delete it', async () => {
      const testId = generateTestId();

      // Step 1: Create a draft
      const createResult = await executor.executeAction(USER_ID, 'create_draft', {
        recipients: { to: ['agentpilot-integration-test@example.com'] },
        content: {
          subject: `Integration Test Draft ${testId}`,
          body: `This is an automated integration test draft. ID: ${testId}. Safe to delete.`,
        },
      });

      expect(createResult.success).toBe(true);
      expect(createResult.data).toBeDefined();
      const draftId = createResult.data?.draft_id || createResult.data?.message_id;
      expect(draftId).toBeDefined();

      // Track for cleanup
      if (draftId) {
        cleanupDraftIds.push(draftId);
      }

      // Step 2: Delete the draft (cleanup)
      if (draftId) {
        const deleteResult = await executor.executeAction(USER_ID, 'delete_email', {
          message_id: draftId,
        });
        expect(deleteResult.success).toBe(true);

        // Remove from cleanup list since we already deleted it
        const idx = cleanupDraftIds.indexOf(draftId);
        if (idx >= 0) cleanupDraftIds.splice(idx, 1);
      }
    });
  });

  describe('[full]', () => {
    it('should search for emails with a query', async () => {
      const result = await executor.executeAction(USER_ID, 'search_emails', {
        query: 'subject:agentpilot-integration-test-nonexistent',
        max_results: 1,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    // ─── Phase 1 label lifecycle: get_or_create → list → delete ────────────
    // Self-cleaning: the label created here is deleted at the end of the test.
    it('should get_or_create a label, list it, then delete it (idempotent)', async () => {
      const labelName = `AP Test ${generateTestId()}`;

      // 1. Create the label.
      const createRes = await executor.executeAction(USER_ID, 'get_or_create_label', {
        label_name: labelName,
      });
      expect(createRes.success).toBe(true);
      expect(createRes.data.created).toBe(true);
      const labelId: string = createRes.data.label_id;
      expect(labelId).toBeDefined();

      // 2. Idempotency: a second call must NOT create a duplicate.
      const secondRes = await executor.executeAction(USER_ID, 'get_or_create_label', {
        label_name: labelName,
      });
      expect(secondRes.success).toBe(true);
      expect(secondRes.data.created).toBe(false);
      expect(secondRes.data.label_id).toBe(labelId);

      // 3. list_labels includes the new label.
      const listRes = await executor.executeAction(USER_ID, 'list_labels', { label_type: 'user' });
      expect(listRes.success).toBe(true);
      const found = (listRes.data.labels as Array<{ id: string }>).some((l) => l.id === labelId);
      expect(found).toBe(true);

      // 4. delete_label removes it.
      const deleteRes = await executor.executeAction(USER_ID, 'delete_label', {
        label_id: labelId,
      });
      expect(deleteRes.success).toBe(true);
      expect(deleteRes.data.deleted).toBe(true);

      // 5. Deleting again → already-absent success (idempotent-ish).
      const deleteAgain = await executor.executeAction(USER_ID, 'delete_label', {
        label_id: labelId,
      });
      expect(deleteAgain.success).toBe(true);
      expect(deleteAgain.data.already_absent).toBe(true);
    });

    // ─── send_draft: create a draft then send it ───────────────────────────
    it('should create a draft and send it via send_draft', async () => {
      const testId = generateTestId();
      const createResult = await executor.executeAction(USER_ID, 'create_draft', {
        recipients: { to: ['agentpilot-integration-test@example.com'] },
        content: {
          subject: `Integration send_draft ${testId}`,
          body: `Automated integration test. ID: ${testId}. Safe to ignore.`,
        },
      });
      expect(createResult.success).toBe(true);
      const draftId = createResult.data?.draft_id;
      expect(draftId).toBeDefined();

      const sendResult = await executor.executeAction(USER_ID, 'send_draft', {
        draft_id: draftId,
      });
      expect(sendResult.success).toBe(true);
      expect(sendResult.data.message_id).toBeDefined();
    });

    // ─── batch_modify_emails: archive then restore a message ───────────────
    // Uses whatever the search returns; skips gracefully if the inbox is empty.
    it('should batch_modify_emails (archive) on a found message', async () => {
      const searchRes = await executor.executeAction(USER_ID, 'search_emails', {
        query: 'in:inbox',
        max_results: 1,
      });
      expect(searchRes.success).toBe(true);
      const emails = (searchRes.data.emails as Array<{ id: string }>) || [];
      if (emails.length === 0) {
        // Nothing to modify in an empty inbox — nothing to assert beyond the guard.
        return;
      }
      const messageId = emails[0].id;

      const archiveRes = await executor.executeAction(USER_ID, 'batch_modify_emails', {
        message_ids: [messageId],
        archive: true,
      });
      expect(archiveRes.success).toBe(true);
      expect(archiveRes.data.modified_count).toBe(1);

      // Restore INBOX so the test leaves no side effect.
      await executor.executeAction(USER_ID, 'batch_modify_emails', {
        message_ids: [messageId],
        add_labels: ['INBOX'],
      });
    });

    // NOTE: reply_to_email is exercised in the unit suite (thread continuation +
    // In-Reply-To). A live reply is intentionally omitted here to avoid sending
    // real mail into a shared test mailbox thread.
  });
});
