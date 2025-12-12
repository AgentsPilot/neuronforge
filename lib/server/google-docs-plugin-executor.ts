// lib/server/google-docs-plugin-executor.ts

import { UserPluginConnections } from './user-plugin-connections';
import { PluginManagerV2 } from './plugin-manager-v2';
import { ExecutionResult } from '@/lib/types/plugin-types';
import { GoogleBasePluginExecutor } from './google-base-plugin-executor';

const pluginName = 'google-docs';

export class GoogleDocsPluginExecutor extends GoogleBasePluginExecutor {
  protected docsApisUrl: string;

  constructor(userConnections: UserPluginConnections, pluginManager: PluginManagerV2) {
    super(pluginName, userConnections, pluginManager);

    this.docsApisUrl = 'https://docs.googleapis.com/v1/documents';
  }

  // Execute Google Docs action with validation and error handling
  protected async executeSpecificAction(
    connection: any,
    actionName: string,
    parameters: any
  ): Promise<any> {
    // Execute the specific action
    let result: any;
    switch (actionName) {
      case 'read_document':
        result = await this.readDocument(connection, parameters);
        break;
      case 'insert_text':
        result = await this.insertText(connection, parameters);
        break;
      case 'append_text':
        result = await this.appendText(connection, parameters);
        break;
      case 'create_document':
        result = await this.createDocument(connection, parameters);
        break;
      case 'get_document_info':
        result = await this.getDocumentInfo(connection, parameters);
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

  // Read full document content
  private async readDocument(connection: any, parameters: any): Promise<any> {
    this.logger.debug('DEBUG: Reading document from Google Docs');

    const { document_id, include_formatting, plain_text_only } = parameters;

    // Build request URL
    const url = `${this.docsApisUrl}/${document_id}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.text();
      this.logger.error({ err: error }, 'DEBUG: Docs read failed:', errorData);
      throw new Error(`Docs API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();

    // Extract text content
    let textContent = '';
    let charCount = 0;
    const content = data.body?.content || [];

    // Iterate through document structure and extract text
    for (const element of content) {
      if (element.paragraph) {
        const paragraphElements = element.paragraph.elements || [];
        for (const elem of paragraphElements) {
          if (elem.textRun?.content) {
            textContent += elem.textRun.content;
            charCount += elem.textRun.content.length;
          }
        }
      } else if (element.table) {
        // Extract text from tables if needed
        const table = element.table;
        for (const row of table.tableRows || []) {
          for (const cell of row.tableCells || []) {
            for (const cellContent of cell.content || []) {
              if (cellContent.paragraph) {
                const paragraphElements = cellContent.paragraph.elements || [];
                for (const elem of paragraphElements) {
                  if (elem.textRun?.content) {
                    textContent += elem.textRun.content;
                    charCount += elem.textRun.content.length;
                  }
                }
              }
            }
          }
        }
      }
    }

    const result: any = {
      document_id: data.documentId,
      title: data.title,
      char_count: charCount,
      retrieved_at: new Date().toISOString()
    };

    if (plain_text_only) {
      result.content = textContent;
    } else {
      result.content = textContent;
      result.structured_content = content;
    }

    if (include_formatting) {
      result.full_document = data;
    }

    return result;
  }

  // Insert text at a specific position
  private async insertText(connection: any, parameters: any): Promise<any> {
    this.logger.debug('DEBUG: Inserting text into Google Docs');

    const { document_id, text, index } = parameters;

    // First, get document to determine the end index if needed
    let insertIndex = index;
    if (index === -1) {
      const docInfo = await this.getDocumentInfo(connection, { document_id });
      insertIndex = docInfo.end_index - 1; // -1 because end index is after the last character
    }

    // Build batchUpdate request
    const requests = [
      {
        insertText: {
          text: text,
          location: {
            index: insertIndex
          }
        }
      }
    ];

    const url = `${this.docsApisUrl}/${document_id}:batchUpdate`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ requests })
    });

    if (!response.ok) {
      const errorData = await response.text();
      this.logger.error({ err: error }, 'DEBUG: Docs insert failed:', errorData);
      throw new Error(`Docs API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();

    return {
      document_id: data.documentId,
      char_count: text.length,
      index: insertIndex,
      inserted_at: new Date().toISOString()
    };
  }

  // Append text to the end of document
  private async appendText(connection: any, parameters: any): Promise<any> {
    this.logger.debug('DEBUG: Appending text to Google Docs');

    const { document_id, text, add_line_break } = parameters;

    // Get document to find the end index
    const url = `${this.docsApisUrl}/${document_id}`;
    const docResponse = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Accept': 'application/json',
      },
    });

    if (!docResponse.ok) {
      const errorData = await docResponse.text();
      this.logger.error({ err: error }, 'DEBUG: Docs get failed:', errorData);
      throw new Error(`Docs API error: ${docResponse.status} - ${errorData}`);
    }

    const docData = await docResponse.json();
    const endIndex = docData.body?.content?.[docData.body.content.length - 1]?.endIndex || 1;

    // Build text to insert (with optional line break)
    const textToInsert = add_line_break !== false ? `\n${text}` : text;

    // Build batchUpdate request
    const requests = [
      {
        insertText: {
          text: textToInsert,
          location: {
            index: endIndex - 1 // Insert before the final newline
          }
        }
      }
    ];

    const updateUrl = `${this.docsApisUrl}/${document_id}:batchUpdate`;

    const response = await fetch(updateUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ requests })
    });

    if (!response.ok) {
      const errorData = await response.text();
      this.logger.error({ err: error }, 'DEBUG: Docs append failed:', errorData);
      throw new Error(`Docs API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();

    return {
      document_id: data.documentId,
      title: docData.title,
      char_count: textToInsert.length,
      appended_at: new Date().toISOString()
    };
  }

  // Create a new document
  private async createDocument(connection: any, parameters: any): Promise<any> {
    this.logger.debug('DEBUG: Creating new document');

    const { title, initial_content } = parameters;

    // Build request body
    const requestBody: any = {
      title: title
    };

    const url = `${this.docsApisUrl}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.text();
      this.logger.error({ err: error }, 'DEBUG: Document creation failed:', errorData);
      throw new Error(`Docs API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();

    // If initial content provided, append it to the document
    if (initial_content && initial_content.trim().length > 0) {
      try {
        await this.appendText(connection, {
          document_id: data.documentId,
          text: initial_content,
          add_line_break: false
        });
      } catch (error) {
        this.logger.warn({ err: error }, 'DEBUG: Failed to add initial content:', error);
        // Continue anyway - document was created successfully
      }
    }

    return {
      document_id: data.documentId,
      document_url: `https://docs.google.com/document/d/${data.documentId}/edit`,
      title: data.title,
      created_at: new Date().toISOString()
    };
  }

  // Get document metadata and information
  private async getDocumentInfo(connection: any, parameters: any): Promise<any> {
    this.logger.debug('DEBUG: Getting document info');

    const { document_id, include_content_summary } = parameters;

    // Build request URL with minimal fields
    const url = `${this.docsApisUrl}/${document_id}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.text();
      this.logger.error({ err: error }, 'DEBUG: Get document info failed:', errorData);
      throw new Error(`Docs API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();

    const result: any = {
      document_id: data.documentId,
      title: data.title,
      retrieved_at: new Date().toISOString()
    };

    // Add content summary if requested
    if (include_content_summary) {
      let charCount = 0;
      let paragraphCount = 0;
      const content = data.body?.content || [];

      for (const element of content) {
        if (element.paragraph) {
          paragraphCount++;
          const paragraphElements = element.paragraph.elements || [];
          for (const elem of paragraphElements) {
            if (elem.textRun?.content) {
              charCount += elem.textRun.content.length;
            }
          }
        }
      }

      result.char_count = charCount;
      result.paragraph_count = paragraphCount;
      result.end_index = data.body?.content?.[data.body.content.length - 1]?.endIndex || 1;
    } else {
      // Just get the end index for potential use
      result.end_index = data.body?.content?.[data.body.content.length - 1]?.endIndex || 1;
    }

    return result;
  }

  // Override to handle Docs-specific errors
  protected mapGoogleServiceSpecificError(error: any, commonErrors: Record<string, string>): string | null {
    // Docs-specific: document not found
    if (error.message?.includes('404')) {
      return commonErrors.document_not_found || error.message;
    }

    // Docs-specific: invalid index for text insertion
    if (error.message?.includes('invalid') && error.message?.includes('index')) {
      return commonErrors.invalid_index || error.message;
    }

    // Return null to fall back to common Google error handling
    return null;
  }

  // Test connection with a simple API call
  protected async performConnectionTest(connection: any): Promise<any> {
    // Test with a simple API call (create test document)
    const response = await fetch(`${this.docsApisUrl}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Connection Test - Can Be Deleted'
      })
    });

    if (!response.ok) {
      return {
        success: false,
        error: 'connection_test_failed',
        message: `Google Docs connection test failed: ${response.status}`
      };
    }

    const testData = await response.json();

    // Clean up test document using parent's cleanup method
    if (testData.documentId) {
      await this.cleanupTestResource(connection.access_token, testData.documentId);
    }

    return {
      success: true,
      data: {
        can_create: true,
        can_read: true,
        can_write: true
      },
      message: 'Google Docs connection active'
    };
  }

  /**
   * List all available Google Docs for dynamic dropdown options
   * This method is called by the fetch-options API route
   */
  async list_documents(connection: any, options: { page?: number; limit?: number } = {}): Promise<Array<{value: string; label: string; description?: string; icon?: string; group?: string}>> {
    try {
      const { limit = 100 } = options;

      // Use Google Drive API to list documents
      const driveUrl = new URL('https://www.googleapis.com/drive/v3/files');
      driveUrl.searchParams.set('q', "mimeType='application/vnd.google-apps.document' and trashed=false");
      driveUrl.searchParams.set('fields', 'files(id,name,modifiedTime,owners)');
      driveUrl.searchParams.set('pageSize', limit.toString());
      driveUrl.searchParams.set('orderBy', 'modifiedTime desc');

      const response = await fetch(driveUrl.toString(), {
        headers: {
          'Authorization': `Bearer ${connection.access_token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Google Drive API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.files || !Array.isArray(data.files)) {
        return [];
      }

      // Transform to option format
      return data.files.map((file: any) => ({
        value: file.id,
        label: file.name,
        description: file.owners?.[0]?.displayName ? `Owner: ${file.owners[0].displayName}` : undefined,
        icon: '📄',
        group: 'My Documents',
      }));

    } catch (error: any) {
      this.logger.error({ err: error }, 'Error listing Google Docs for options');
      throw error;
    }
  }
}
