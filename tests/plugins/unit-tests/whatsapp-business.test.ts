/**
 * Unit tests for WhatsAppPluginExecutor — 5 actions
 */

import { WhatsAppPluginExecutor } from '@/lib/server/whatsapp-business-plugin-executor';
import { createTestExecutor, expectSuccessResult, expectErrorResult, expectFetchCalledWith, expectAllFetchCallsAuthorized } from '../common/test-helpers';
import { mockFetchSuccess, mockFetchError, restoreFetch } from '../common/mock-fetch';

const PLUGIN_KEY = 'whatsapp-business';
const USER_ID = 'test-user-id';

describe('WhatsAppPluginExecutor', () => {
  let executor: any;

  beforeAll(async () => {
    const ctx = await createTestExecutor(WhatsAppPluginExecutor, PLUGIN_KEY, {
      profile_data: {
        phone_number_id: 'mock-phone-123',
        waba_id: 'mock-waba-456',
      },
    });
    executor = ctx.executor;
  });

  afterEach(() => {
    restoreFetch();
  });

  // ---- send_template_message ----
  describe('send_template_message', () => {
    it('should send template message to Graph API', async () => {
      mockFetchSuccess({
        messages: [{ id: 'wamid.abc123' }],
      });

      const result = await executor.executeAction(USER_ID, 'send_template_message', {
        recipient_phone: '+1234567890',
        template_name: 'hello_world',
        language_code: 'en_US',
      });

      expectSuccessResult(result);
      expect(result.data.message_id).toBe('wamid.abc123');
      expect(result.data.recipient).toBe('+1234567890');
      expectFetchCalledWith('graph.facebook.com/v23.0/mock-phone-123/messages', 'POST');
      expectAllFetchCallsAuthorized();
    });

    it('should handle template not found error', async () => {
      mockFetchError(400, JSON.stringify({
        error: { code: 133000, message: 'Template name does not exist in the translation' },
      }));

      const result = await executor.executeAction(USER_ID, 'send_template_message', {
        recipient_phone: '+1234567890',
        template_name: 'nonexistent_template',
        language_code: 'en_US',
      });

      expectErrorResult(result);
    });
  });

  // ---- send_text_message ----
  describe('send_text_message', () => {
    it('should send text message', async () => {
      mockFetchSuccess({
        messages: [{ id: 'wamid.text123' }],
      });

      const result = await executor.executeAction(USER_ID, 'send_text_message', {
        recipient_phone: '+9876543210',
        message_text: 'Hello from WhatsApp!',
      });

      expectSuccessResult(result);
      expect(result.data.message_id).toBe('wamid.text123');
      expect(result.data.is_reply).toBe(false);
      expectFetchCalledWith('graph.facebook.com/v23.0/mock-phone-123/messages', 'POST');
    });

    it('should handle invalid phone number error', async () => {
      mockFetchError(400, JSON.stringify({
        error: { code: 131021, message: 'Recipient phone number not valid' },
      }));

      const result = await executor.executeAction(USER_ID, 'send_text_message', {
        recipient_phone: 'invalid',
        message_text: 'Test',
      });

      expectErrorResult(result);
    });
  });

  // ---- send_interactive_message ----
  describe('send_interactive_message', () => {
    it('should send interactive button message', async () => {
      mockFetchSuccess({
        messages: [{ id: 'wamid.interactive123' }],
      });

      const result = await executor.executeAction(USER_ID, 'send_interactive_message', {
        recipient_phone: '+1234567890',
        body_text: 'Choose an option:',
        interaction_type: 'button',
        buttons: [
          { id: 'btn1', title: 'Option A' },
          { id: 'btn2', title: 'Option B' },
        ],
      });

      expectSuccessResult(result);
      expect(result.data.interaction_type).toBe('button');
      expectFetchCalledWith('graph.facebook.com/v23.0/mock-phone-123/messages', 'POST');
    });

    it('should send interactive list message', async () => {
      mockFetchSuccess({
        messages: [{ id: 'wamid.list123' }],
      });

      const result = await executor.executeAction(USER_ID, 'send_interactive_message', {
        recipient_phone: '+1234567890',
        body_text: 'Browse our menu:',
        interaction_type: 'list',
        list_button_text: 'View Menu',
        list_sections: [
          {
            title: 'Main',
            rows: [{ id: 'r1', title: 'Item 1' }],
          },
        ],
      });

      expectSuccessResult(result);
      expect(result.data.interaction_type).toBe('list');
    });
  });

  // ---- list_message_templates ----
  describe('list_message_templates', () => {
    it('should list available templates', async () => {
      mockFetchSuccess({
        data: [
          {
            name: 'hello_world',
            status: 'APPROVED',
            language: 'en_US',
            category: 'MARKETING',
            components: [{ type: 'BODY', text: 'Hello {{1}}!' }],
          },
        ],
        paging: {},
      });

      const result = await executor.executeAction(USER_ID, 'list_message_templates', {});

      expectSuccessResult(result);
      expect(result.data.templates).toHaveLength(1);
      expect(result.data.templates[0].name).toBe('hello_world');
      expect(result.data.templates[0].parameter_count).toBe(1);
      expectFetchCalledWith('graph.facebook.com/v23.0/mock-waba-456/message_templates');
    });
  });

  // ---- mark_message_read ----
  describe('mark_message_read', () => {
    it('should mark message as read', async () => {
      mockFetchSuccess({ success: true });

      const result = await executor.executeAction(USER_ID, 'mark_message_read', {
        message_id: 'wamid.read123',
      });

      expectSuccessResult(result);
      expect(result.data.message_id).toBe('wamid.read123');
      expectFetchCalledWith('graph.facebook.com/v23.0/mock-phone-123/messages', 'POST');
    });

    it('should handle message not found error', async () => {
      mockFetchError(400, JSON.stringify({
        error: { code: 100, message: 'Invalid message_id' },
      }));

      const result = await executor.executeAction(USER_ID, 'mark_message_read', {
        message_id: 'invalid-id',
      });

      expectErrorResult(result);
    });
  });
});
