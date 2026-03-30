// lib/server/gmail-plugin-executor.ts

import { UserPluginConnections } from './user-plugin-connections';
import { PluginManagerV2 } from './plugin-manager-v2';
import { GoogleBasePluginExecutor } from './google-base-plugin-executor';

const pluginName = 'google-mail'; // Current plugin key

// Executor for Gmail plugin actions

export class GmailPluginExecutor extends GoogleBasePluginExecutor {
  protected gmailApisUrl: string;
  
  constructor(userConnections: UserPluginConnections, pluginManager: PluginManagerV2) {
    super(pluginName, userConnections, pluginManager);

    this.gmailApisUrl = 'https://gmail.googleapis.com/gmail/v1';
  }
  
  // Execute Gmail action with validation and error handling
  protected async executeSpecificAction(
    connection: any,
    actionName: string,
    parameters: any
  ): Promise<any> {
    switch (actionName) {
      case 'send_email':
        return await this.sendEmail(connection, parameters);
      case 'search_emails':
        return await this.searchEmails(connection, parameters);
      case 'create_draft':
        return await this.createDraft(connection, parameters);
<<<<<<< Updated upstream
=======
      case 'get_email_attachment':
        return await this.getEmailAttachment(connection, parameters);
      case 'modify_message':
        return await this.modifyMessage(connection, parameters);
>>>>>>> Stashed changes
      default:
        throw new Error(`Action ${actionName} not supported`);
    }
  }

  // Send email via Gmail API
  private async sendEmail(connection: any, parameters: any): Promise<any> {
    if (this.debug) console.log('DEBUG: Sending email via Gmail API');

    // Build email message
    const message = this.buildEmailMessage(parameters);
    
    // Send via Gmail API
    const response = await fetch(`${this.gmailApisUrl}/users/me/messages/send`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: message })
    });

    if (!response.ok) {
      const errorData = await response.text();
      if (this.debug) console.error('DEBUG: Gmail send failed:', errorData);
      throw new Error(`Gmail API error: ${response.status} - ${errorData}`);
    }

    const result = await response.json();
    
    // Return formatted result
    const recipientCount = this.countRecipients(parameters.recipients);
    
    return {
      message_id: result.id,
      thread_id: result.threadId,
      sent_at: new Date().toISOString(),
      recipient_count: recipientCount,
      recipients: parameters.recipients,
      subject: parameters.content?.subject || '(no subject)'
    };
  }

  // Search emails via Gmail API
  private async searchEmails(connection: any, parameters: any): Promise<any> {
    if (this.debug) console.log('DEBUG: Searching emails via Gmail API');

    // Build search query
    const searchQuery = this.buildSearchQuery(parameters);
    
    // Search messages
    const listUrl = new URL(`${this.gmailApisUrl}/users/me/messages`);
    listUrl.searchParams.set('maxResults', parameters.max_results?.toString() || '10');
    listUrl.searchParams.set('q', searchQuery);

    const listResponse = await fetch(listUrl.toString(), {
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Accept': 'application/json',
      },
    });

    if (!listResponse.ok) {
      const errorData = await listResponse.text();
      if (this.debug) console.error('DEBUG: Gmail search failed:', errorData);
      throw new Error(`Gmail search failed: ${listResponse.status} - ${errorData}`);
    }

    const listData = await listResponse.json();
    
    if (!listData.messages || listData.messages.length === 0) {
      return {
        emails: [],
        total_found: 0,
        search_query: searchQuery,
        message: 'No emails found matching search criteria'
      };
    }

    // Fetch email details
    const emails = [];
    const messagesToFetch = listData.messages.slice(0, parameters.max_results || 10);

    for (const message of messagesToFetch) {
      try {
        const emailDetail = await this.fetchEmailDetail(connection.access_token, message.id, parameters.include_attachments || false);
        emails.push(emailDetail);
      } catch (error) {
        if (this.debug) console.warn(`DEBUG: Failed to fetch email ${message.id}:`, error);
      }
    }

    return {
      emails,
      total_found: emails.length,
      total_available: listData.resultSizeEstimate || 0,
      search_query: searchQuery,
      searched_at: new Date().toISOString()
    };
  }

  // Create draft via Gmail API
  private async createDraft(connection: any, parameters: any): Promise<any> {
    if (this.debug) console.log('DEBUG: Creating draft via Gmail API');

    // Build email message
    const message = this.buildEmailMessage(parameters);
    
    // Create draft
    const response = await fetch(`${this.gmailApisUrl}/users/me/drafts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: { raw: message }
      })
    });

    if (!response.ok) {
      const errorData = await response.text();
      if (this.debug) console.error('DEBUG: Gmail draft creation failed:', errorData);
      throw new Error(`Gmail draft creation failed: ${response.status} - ${errorData}`);
    }

    const result = await response.json();
    
    // Return formatted result
    const recipientCount = this.countRecipients(parameters.recipients || {});
    
    return {
      draft_id: result.id,
      message_id: result.message?.id,
      created_at: new Date().toISOString(),
      recipient_count: recipientCount,
      recipients: parameters.recipients || {},
      subject: parameters.content?.subject || '(no subject)'
    };
  }

<<<<<<< Updated upstream
=======
  // Download email attachment content
  private async getEmailAttachment(connection: any, parameters: any): Promise<any> {
    const { message_id, attachment_id, filename } = parameters;

    if (!message_id || !attachment_id) {
      throw new Error('message_id and attachment_id are required parameters');
    }

    this.logger.debug({ message_id, attachment_id, filename }, 'Downloading email attachment');

    try {
      // Download attachment using Gmail API
      const response = await fetch(
        `${this.gmailApisUrl}/users/me/messages/${message_id}/attachments/${attachment_id}`,
        {
          headers: {
            'Authorization': `Bearer ${connection.access_token}`,
            'Accept': 'application/json',
          },
        }
      );

      if (!response.ok) {
        const errorData = await response.text();
        this.logger.error({ status: response.status, errorData }, 'Attachment download failed');
        throw new Error(`Attachment download failed: ${response.status} - ${errorData}`);
      }

      const attachmentData = await response.json();

      // Detect MIME type from filename extension
      let mimeType = 'application/octet-stream';
      if (filename) {
        const ext = filename.split('.').pop()?.toLowerCase();
        const mimeMap: Record<string, string> = {
          'pdf': 'application/pdf',
          'png': 'image/png',
          'jpg': 'image/jpeg',
          'jpeg': 'image/jpeg',
          'gif': 'image/gif',
          'txt': 'text/plain',
          'csv': 'text/csv',
          'json': 'application/json',
          'doc': 'application/msword',
          'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'xls': 'application/vnd.ms-excel',
          'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        };
        mimeType = ext ? (mimeMap[ext] || 'application/octet-stream') : mimeType;
      }

      const result: any = {
        filename: filename || 'attachment',
        mimeType,
        size: attachmentData.size || 0,
        data: attachmentData.data, // Base64-encoded content from Gmail API
        // PDFs can be processed visually by vision models (GPT-4o, etc.)
        is_image: mimeType.startsWith('image/') || mimeType === 'application/pdf'
      };

      // Attempt text extraction for text files
      if (mimeType.startsWith('text/')) {
        try {
          result.extracted_text = this.decodeBase64Url(attachmentData.data);
        } catch (textError) {
          this.logger.warn({ err: textError }, 'Text extraction failed');
          result.extracted_text = '(Text extraction unavailable)';
        }
      } else if (mimeType === 'application/pdf') {
        // PDF text extraction would require additional library
        // For now, indicate it's not extracted
        result.extracted_text = '(PDF text extraction not yet implemented)';
      }

      this.logger.debug(
        { filename, mimeType, size: result.size },
        'Attachment downloaded successfully'
      );

      return result;

    } catch (error: any) {
      this.logger.error({ err: error, message_id, attachment_id }, 'Attachment download error');
      throw new Error(`Failed to download attachment: ${error.message}`);
    }
  }

  // Modify message labels and properties
  private async modifyMessage(connection: any, parameters: any): Promise<any> {
    const { message_id, add_labels, remove_labels, mark_important, mark_read } = parameters;

    if (!message_id) {
      throw new Error('message_id is required');
    }

    this.logger.debug({ message_id, add_labels, remove_labels, mark_important, mark_read }, 'Modifying message');

    // Build modification request
    const requestBody: any = {};

    // Handle label modifications
    const labelsToAdd: string[] = [];
    const labelsToRemove: string[] = [];

    if (add_labels && Array.isArray(add_labels)) {
      labelsToAdd.push(...add_labels);
    }
    if (remove_labels && Array.isArray(remove_labels)) {
      labelsToRemove.push(...remove_labels);
    }

    // Handle importance flag (IMPORTANT label)
    if (mark_important === true) {
      labelsToAdd.push('IMPORTANT');
    } else if (mark_important === false) {
      labelsToRemove.push('IMPORTANT');
    }

    // Handle read/unread status (UNREAD label - note the inverse logic)
    if (mark_read === true) {
      labelsToRemove.push('UNREAD');
    } else if (mark_read === false) {
      labelsToAdd.push('UNREAD');
    }

    // Only add to request if we have changes
    if (labelsToAdd.length > 0) {
      requestBody.addLabelIds = labelsToAdd;
    }
    if (labelsToRemove.length > 0) {
      requestBody.removeLabelIds = labelsToRemove;
    }

    // If no modifications specified, return error
    if (labelsToAdd.length === 0 && labelsToRemove.length === 0) {
      throw new Error('At least one modification must be specified (add_labels, remove_labels, mark_important, or mark_read)');
    }

    // Make API request
    const response = await fetch(
      `${this.gmailApisUrl}/users/me/messages/${message_id}/modify`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${connection.access_token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(requestBody)
      }
    );

    if (!response.ok) {
      const errorData = await response.text();
      this.logger.error({ status: response.status, errorData }, 'Message modification failed');
      throw new Error(`Gmail API error: ${response.status} - ${errorData}`);
    }

    const result = await response.json();

    return {
      message_id: result.id,
      thread_id: result.threadId,
      labels: result.labelIds || [],
      labels_added: labelsToAdd,
      labels_removed: labelsToRemove,
      modified_at: new Date().toISOString(),
      message: 'Message modified successfully'
    };
  }

>>>>>>> Stashed changes
  // Private helper methods

  // Build RFC 2822 email message
  private buildEmailMessage(parameters: any): string {
    const { recipients, content } = parameters;
    
    let message = '';
    
    // Headers
    if (recipients?.to?.length) {
      message += `To: ${recipients.to.join(', ')}\r\n`;
    }
    if (recipients?.cc?.length) {
      message += `Cc: ${recipients.cc.join(', ')}\r\n`;
    }
    if (recipients?.bcc?.length) {
      message += `Bcc: ${recipients.bcc.join(', ')}\r\n`;
    }
    if (content?.subject) {
      message += `Subject: ${content.subject}\r\n`;
    }
    
    // MIME headers for content type
    message += `MIME-Version: 1.0\r\n`;
    if (content?.html_body) {
      message += `Content-Type: text/html; charset=utf-8\r\n`;
    } else {
      message += `Content-Type: text/plain; charset=utf-8\r\n`;
    }
    
    message += '\r\n'; // Empty line between headers and body
    
    // Body
    if (content?.html_body) {
      message += content.html_body;
    } else if (content?.body) {
      message += content.body;
    }
    
    // Base64url encode the message (Gmail's format)
    return Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  // Build Gmail search query
  private buildSearchQuery(parameters: any): string {
    let query = parameters.query || '';
    
    // Add folder filter
    if (parameters.folder && parameters.folder !== 'all') {
      if (query) query += ' ';
      query += `in:${parameters.folder}`;
    }
    
    // Default to inbox if no query provided
    if (!query) {
      query = 'in:inbox';
    }
    
    return query;
  }

  // Fetch detailed email information
  private async fetchEmailDetail(accessToken: string, messageId: string, includeAttachments: boolean): Promise<any> {
    const format = includeAttachments ? 'full' : 'metadata';
    
    const response = await fetch(
      `${this.gmailApisUrl}/users/me/messages/${messageId}?format=${format}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch email details: ${response.status}`);
    }

    const email = await response.json();
    const headers = email.payload?.headers || [];
    
    const getHeader = (name: string) => 
      headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

    const emailInfo = {
      id: email.id,
      thread_id: email.threadId,
      subject: getHeader('Subject'),
      from: getHeader('From'),
      to: getHeader('To'),
      date: getHeader('Date'),
      snippet: email.snippet || '',
      labels: email.labelIds || [],
      body: '',
      attachments: []
    };

    // Extract body text
    if (email.payload) {
      emailInfo.body = this.extractEmailBody(email.payload);
    }

    // Process attachments if requested
    if (includeAttachments && email.payload) {
      emailInfo.attachments = await this.processEmailAttachments(email.payload, messageId, accessToken);
    }

    return emailInfo;
  }

  // Extract email body text
  private extractEmailBody(payload: any): string {
    if (payload.parts) {
      // Multi-part email
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          return this.decodeBase64Url(part.body.data);
        }
        if (part.mimeType === 'text/html' && part.body?.data) {
          // Basic HTML to text conversion
          const html = this.decodeBase64Url(part.body.data);
          return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        }
        // Check nested parts
        if (part.parts) {
          const nestedText = this.extractEmailBody(part);
          if (nestedText) return nestedText;
        }
      }
    }
    
    // Simple email body
    if (payload.body?.data) {
      return this.decodeBase64Url(payload.body.data);
    }
    
    return '';
  }

  // Process email attachments
  private async processEmailAttachments(payload: any, messageId: string, accessToken: string): Promise<any[]> {
    const attachments: any[] = [];
    
    const processPayload = async (part: any) => {
      if (part.parts) {
        for (const subPart of part.parts) {
          await processPayload(subPart);
        }
      }
      
      if (part.filename && part.body?.attachmentId) {
        try {
          // For now, just return attachment metadata
          // In full implementation, you could download and process content
          attachments.push({
            filename: part.filename,
            mimeType: part.mimeType,
            size: part.body.size || 0,
            attachmentId: part.body.attachmentId,
            // Could add: downloadUrl, processedContent, etc.
          });
        } catch (error) {
          if (this.debug) console.warn(`DEBUG: Failed to process attachment ${part.filename}:`, error);
        }
      }
    };
    
    await processPayload(payload);
    return attachments;
  }

  // Decode base64url (Gmail's encoding)
  private decodeBase64Url(data: string): string {
    try {
      // Convert base64url to base64
      const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
      // Add padding if necessary
      const padding = '='.repeat((4 - base64.length % 4) % 4);
      return atob(base64 + padding);
    } catch (error) {
      if (this.debug) console.warn('DEBUG: Failed to decode base64url:', error);
      return '';
    }
  }  

  // Override to handle Gmail-specific errors
  protected mapGoogleServiceSpecificError(error: any, commonErrors: Record<string, string>): string | null {
    // Check for Gmail-specific error codes or messages
    if (error.message?.includes('dailyLimitExceeded')) {
      return 'Gmail daily sending limit exceeded. Try again tomorrow.';
    }

    if (error.message?.includes('invalidRecipient')) {
      return commonErrors.invalid_recipient || 'Invalid email address format.';
    }

    if (error.message?.includes('messageTooLarge')) {
      return commonErrors.attachment_too_large || 'Message size exceeds Gmail limits.';
    }

    // Return null to fall back to common Google error handling
    return null;
  }  

  protected async performConnectionTest(connection: any): Promise<any> {
    const response = await fetch(`${this.gmailApisUrl}/users/me/profile`, {
      headers: this.buildAuthHeader(connection.access_token)
    });

    const profile = await this.handleApiResponse(response, 'Gmail connection test');
    
    return {
      email: profile.emailAddress,
      total_messages: profile.messagesTotal,
      total_threads: profile.threadsTotal
    };
  }
}