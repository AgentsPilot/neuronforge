// lib/server/whatsapp-business-plugin-executor.ts

import { UserPluginConnections } from './user-plugin-connections';
import { PluginManagerV2 } from './plugin-manager-v2';
import { ExecutionResult } from '@/lib/types/plugin-types';
import { BasePluginExecutor } from './base-plugin-executor';

const pluginName = 'whatsapp-business';
const fbUrl = 'https://graph.facebook.com/v23.0';

export class WhatsAppPluginExecutor extends BasePluginExecutor {
  constructor(userConnections: UserPluginConnections, pluginManager: PluginManagerV2) {
    super(pluginName, userConnections, pluginManager);
  }

  // Execute WhatsApp action with validation and error handling
  protected async executeSpecificAction(
    connection: any,
    actionName: string,
    parameters: any
  ): Promise<any> {
    // Execute the specific action
    let result: any;
    switch (actionName) {
      case 'send_template_message':
        result = await this.sendTemplateMessage(connection, parameters);
        break;
      case 'send_text_message':
        result = await this.sendTextMessage(connection, parameters);
        break;
      case 'send_interactive_message':
        result = await this.sendInteractiveMessage(connection, parameters);
        break;
      case 'list_message_templates':
        result = await this.listMessageTemplates(connection, parameters);
        break;
      case 'mark_message_read':
        result = await this.markMessageRead(connection, parameters);
        break;
      default:
        return {
          success: false,
          error: 'Unknown action',
          message: `Action ${actionName} not supported`
        };
    }

    return result;
  }

  // Send a template message to initiate conversation
  private async sendTemplateMessage(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Sending WhatsApp template message');

    const { recipient_phone, template_name, language_code, template_parameters } = parameters;

    // Get phone_number_id from profile_data
    const phoneNumberId = connection.profile_data?.phone_number_id;
    if (!phoneNumberId) {
      throw new Error('Phone number ID not found in connection profile. Please reconnect WhatsApp.');
    }

    // Build template component structure
    const components: any[] = [];

    if (template_parameters) {
      // Add body parameters if provided
      if (template_parameters.body && Array.isArray(template_parameters.body)) {
        components.push({
          type: 'body',
          parameters: template_parameters.body.map((value: string) => ({
            type: 'text',
            text: value
          }))
        });
      }

      // Add header parameters if provided
      if (template_parameters.header && Array.isArray(template_parameters.header)) {
        components.push({
          type: 'header',
          parameters: template_parameters.header.map((value: string) => ({
            type: 'text',
            text: value
          }))
        });
      }
    }

    const requestBody: any = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient_phone,
      type: 'template',
      template: {
        name: template_name,
        language: {
          code: language_code
        }
      }
    };

    // Add components only if we have parameters
    if (components.length > 0) {
      requestBody.template.components = components;
    }

    const response = await fetch(
      `${fbUrl}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${connection.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      }
    );

    const data = await this.handleWhatsAppResponse(response, 'send_template_message');

    return {
      success: true,
      message_id: data.messages?.[0]?.id,
      recipient: recipient_phone,
      template_name: template_name,
      message: `Template message '${template_name}' sent successfully to ${recipient_phone}`
    };
  }

  // Send a free-form text message
  private async sendTextMessage(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Sending WhatsApp text message');

    const { recipient_phone, message_text, preview_url, reply_to_message_id } = parameters;

    // Get phone_number_id from profile_data
    const phoneNumberId = connection.profile_data?.phone_number_id;
    if (!phoneNumberId) {
      throw new Error('Phone number ID not found in connection profile. Please reconnect WhatsApp.');
    }

    const requestBody: any = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient_phone,
      type: 'text',
      text: {
        preview_url: preview_url || false,
        body: message_text
      }
    };

    // Add context for reply if provided
    if (reply_to_message_id) {
      requestBody.context = {
        message_id: reply_to_message_id
      };
    }

    const response = await fetch(
      `${fbUrl}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${connection.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      }
    );

    const data = await this.handleWhatsAppResponse(response, 'send_text_message');

    return {
      success: true,
      message_id: data.messages?.[0]?.id,
      recipient: recipient_phone,
      is_reply: !!reply_to_message_id,
      message: `Text message sent successfully to ${recipient_phone}`
    };
  }

  // Send an interactive message with buttons or lists
  private async sendInteractiveMessage(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Sending WhatsApp interactive message');

    const {
      recipient_phone,
      body_text,
      interaction_type,
      header_text,
      footer_text,
      buttons,
      list_button_text,
      list_sections
    } = parameters;

    // Get phone_number_id from profile_data
    const phoneNumberId = connection.profile_data?.phone_number_id;
    if (!phoneNumberId) {
      throw new Error('Phone number ID not found in connection profile. Please reconnect WhatsApp.');
    }

    // Build interactive object based on type
    const interactive: any = {
      type: interaction_type,
      body: {
        text: body_text
      }
    };

    // Add optional header (only for lists)
    if (header_text && interaction_type === 'list') {
      interactive.header = {
        type: 'text',
        text: header_text
      };
    }

    // Add optional footer
    if (footer_text) {
      interactive.footer = {
        text: footer_text
      };
    }

    // Build action based on interaction type
    if (interaction_type === 'button') {
      if (!buttons || !Array.isArray(buttons) || buttons.length === 0) {
        throw new Error('Buttons array required for button type interactive messages');
      }

      interactive.action = {
        buttons: buttons.map(btn => ({
          type: 'reply',
          reply: {
            id: btn.id,
            title: btn.title
          }
        }))
      };
    } else if (interaction_type === 'list') {
      if (!list_button_text || !list_sections || !Array.isArray(list_sections)) {
        throw new Error('list_button_text and list_sections required for list type interactive messages');
      }

      interactive.action = {
        button: list_button_text,
        sections: list_sections
      };
    } else {
      throw new Error('interaction_type must be "button" or "list"');
    }

    const requestBody = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient_phone,
      type: 'interactive',
      interactive: interactive
    };

    const response = await fetch(
      `${fbUrl}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${connection.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      }
    );

    const data = await this.handleWhatsAppResponse(response, 'send_interactive_message');

    return {
      success: true,
      message_id: data.messages?.[0]?.id,
      recipient: recipient_phone,
      interaction_type: interaction_type,
      message: `Interactive ${interaction_type} message sent successfully to ${recipient_phone}`
    };
  }

  // List all available message templates
  private async listMessageTemplates(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Listing WhatsApp message templates');

    const { limit, status_filter, name_filter } = parameters;

    // Get waba_id from profile_data
    const wabaId = connection.profile_data?.waba_id;
    if (!wabaId) {
      throw new Error('WhatsApp Business Account ID not found in connection profile. Please reconnect WhatsApp.');
    }

    // Build URL with query parameters
    const url = new URL(`${fbUrl}/${wabaId}/message_templates`);
    url.searchParams.set('limit', (limit || 50).toString());
    url.searchParams.set('fields', 'name,status,language,category,components');

    // Add status filter if provided
    if (status_filter) {
      url.searchParams.set('status', status_filter);
    }

    // Add name filter if provided (using name contains)
    if (name_filter) {
      url.searchParams.set('name', name_filter);
    }

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
      },
    });

    const data = await this.handleWhatsAppResponse(response, 'list_message_templates');

    // Format templates for easier consumption
    const templates = (data.data || []).map((template: any) => ({
      name: template.name,
      status: template.status,
      language: template.language,
      category: template.category,
      components: template.components || [],
      // Extract parameter count from body component
      parameter_count: this.extractParameterCount(template.components)
    }));

    return {
      success: true,
      templates: templates,
      total_count: templates.length,
      has_more: !!data.paging?.next,
      message: `Retrieved ${templates.length} message templates`
    };
  }

  // Mark an incoming message as read
  private async markMessageRead(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Marking WhatsApp message as read');

    const { message_id } = parameters;

    // Get phone_number_id from profile_data
    const phoneNumberId = connection.profile_data?.phone_number_id;
    if (!phoneNumberId) {
      throw new Error('Phone number ID not found in connection profile. Please reconnect WhatsApp.');
    }

    const requestBody = {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: message_id
    };

    const response = await fetch(
      `${fbUrl}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${connection.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      }
    );

    const data = await this.handleWhatsAppResponse(response, 'mark_message_read');

    return {
      success: true,
      message_id: message_id,
      message: `Message ${message_id} marked as read successfully`
    };
  }

  // Helper: Extract parameter count from template components
  private extractParameterCount(components: any[]): number {
    if (!components || !Array.isArray(components)) return 0;

    const bodyComponent = components.find((c: any) => c.type === 'BODY');
    if (!bodyComponent || !bodyComponent.text) return 0;

    // Count {{N}} patterns in template text
    const matches = bodyComponent.text.match(/\{\{\d+\}\}/g);
    return matches ? matches.length : 0;
  }

  // Handle WhatsApp API responses
  private async handleWhatsAppResponse(response: Response, operationName: string): Promise<any> {
    if (!response.ok) {
      const errorText = await response.text();
      if (this.debug) console.error(`DEBUG: ${operationName} HTTP failed:`, errorText);

      // Try to parse error JSON
      try {
        const errorData = JSON.parse(errorText);
        const errorMessage = errorData.error?.message || errorText;
        const errorCode = errorData.error?.code;
        
        if (this.debug) console.error(`DEBUG: WhatsApp error code ${errorCode}: ${errorMessage}`);
        
        throw new Error(`WhatsApp API error (${errorCode}): ${errorMessage}`);
      } catch (parseError) {
        throw new Error(`WhatsApp API HTTP error: ${response.status} - ${errorText}`);
      }
    }

    const data = await response.json();

    // Check for API-level errors in successful HTTP responses
    if (data.error) {
      const errorMessage = data.error.message || 'Unknown WhatsApp error';
      const errorCode = data.error.code;
      if (this.debug) console.error(`DEBUG: ${operationName} WhatsApp error:`, errorMessage);
      throw new Error(`WhatsApp API error (${errorCode}): ${errorMessage}`);
    }

    return data;
  }

  // Override to handle WhatsApp-specific errors
  protected mapPluginSpecificError(error: any, commonErrors: Record<string, string>): string | null {
    const errorMsg = error.message || '';

    // Extract error code from message (format: "WhatsApp API error (CODE): message")
    const codeMatch = errorMsg.match(/\((\d+)\):/);
    const errorCode = codeMatch ? parseInt(codeMatch[1]) : null;

    // WhatsApp-specific error codes
    if (errorCode === 131026 || errorMsg.includes('Message failed to send')) {
      return commonErrors.outside_service_window || 'Cannot send message outside 24-hour customer service window. Use template messages instead.';
    }

    if (errorCode === 131051 || errorMsg.includes('Unsupported message type')) {
      return 'Message type not supported or incorrectly formatted.';
    }

    if (errorCode === 131047 || errorMsg.includes('Re-engagement message')) {
      return 'Cannot send message - outside customer service window and no valid template used.';
    }

    if (errorCode === 133000 || errorMsg.includes('Template name does not exist')) {
      return commonErrors.template_not_found || 'Template not found or not approved. Check template name and status.';
    }

    if (errorCode === 133004 || errorMsg.includes('Template param count mismatch')) {
      return commonErrors.parameter_mismatch || 'Template parameter count or format mismatch. Verify parameters match template definition.';
    }

    if (errorCode === 131031 || errorMsg.includes('User is not a valid WhatsApp user')) {
      return commonErrors.invalid_phone || 'Invalid phone number or user does not have WhatsApp.';
    }

    if (errorCode === 131021 || errorMsg.includes('Recipient phone number not valid')) {
      return commonErrors.invalid_phone || 'Invalid phone number format. Use international format with country code.';
    }

    if (errorCode === 130429 || errorMsg.includes('Rate limit hit')) {
      return commonErrors.api_rate_limit || 'WhatsApp rate limit exceeded. Maximum 80 messages per second per phone number.';
    }

    if (errorCode === 131048 || errorMsg.includes('Number does not exist')) {
      return 'Recipient phone number does not exist or is not a valid WhatsApp number.';
    }

    if (errorCode === 131016 || errorMsg.includes('Service unavailable')) {
      return 'WhatsApp service temporarily unavailable. Please try again later.';
    }

    if (errorCode === 368 || errorMsg.includes('Temporarily blocked for policies violations')) {
      return commonErrors.template_paused || 'Phone number temporarily blocked due to policy violations. Check WhatsApp Manager for details.';
    }

    if (errorCode === 131056 || errorMsg.includes('Phone number does not belong to this WhatsApp Business Account')) {
      return 'Phone number ID mismatch. Please reconnect WhatsApp plugin.';
    }

    if (errorCode === 80007 || errorMsg.includes('Insufficient credit')) {
      return commonErrors.insufficient_credit || 'Insufficient credit balance. Add payment method in WhatsApp Manager.';
    }

    if (errorMsg.includes('Customer has blocked')) {
      return commonErrors.customer_blocked || 'Customer has blocked your business number.';
    }

    if (errorMsg.includes('Message ID not found') || errorMsg.includes('Invalid message_id')) {
      return commonErrors.message_not_found || 'Message ID not found or invalid. Check the message ID from webhook.';
    }

    if (errorCode === 190 || errorMsg.includes('Invalid OAuth access token')) {
      return commonErrors.auth_failed || 'Access token expired or invalid. Please reconnect WhatsApp plugin.';
    }

    if (errorCode === 200 || errorMsg.includes('Insufficient permissions')) {
      return commonErrors.insufficient_permissions || 'Insufficient permissions. Ensure all required scopes are granted during connection.';
    }

    // Return null to fall back to common error handling
    return null;
  }

  // Test connection with a simple API call
  protected async performConnectionTest(connection: any): Promise<any> {
    // Get phone_number_id and waba_id from profile_data
    const phoneNumberId = connection.profile_data?.phone_number_id;
    const wabaId = connection.profile_data?.waba_id;

    if (!phoneNumberId || !wabaId) {
      throw new Error('Phone number ID or WABA ID not found in connection profile.');
    }

    // Test with a simple GET request to phone number endpoint
    const response = await fetch(
      `${fbUrl}/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
      {
        headers: {
          'Authorization': `Bearer ${connection.access_token}`,
        },
      }
    );

    const data = await this.handleWhatsAppResponse(response, 'connection_test');

    return {
      success: true,
      data: {
        phone_number_id: phoneNumberId,
        waba_id: wabaId,
        display_phone_number: data.display_phone_number,
        verified_name: data.verified_name,
        quality_rating: data.quality_rating
      },
      message: 'WhatsApp connection active'
    };
  }
}