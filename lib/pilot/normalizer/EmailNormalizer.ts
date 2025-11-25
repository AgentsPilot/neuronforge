/**
 * EmailNormalizer - Normalize emails from different providers
 *
 * Phase 1: Data Normalization Layer
 * Supports: Gmail, Outlook, Exchange, Yahoo
 */

import type { UnifiedEmail } from './types';

export class EmailNormalizer {
  /**
   * Normalize email from any provider to UnifiedEmail
   */
  static normalize(email: any, sourcePlugin: string): UnifiedEmail {
    // Detect provider format
    if (this.isGmailFormat(email)) {
      return this.normalizeGmail(email, sourcePlugin);
    } else if (this.isOutlookFormat(email)) {
      return this.normalizeOutlook(email, sourcePlugin);
    } else {
      // Generic normalization
      return this.normalizeGeneric(email, sourcePlugin);
    }
  }

  /**
   * Detect Gmail format
   */
  private static isGmailFormat(email: any): boolean {
    return email.payload && email.labelIds;
  }

  /**
   * Normalize Gmail email
   */
  private static normalizeGmail(email: any, sourcePlugin: string): UnifiedEmail {
    // Extract headers
    const headers = email.payload?.headers || [];
    const getHeader = (name: string) =>
      headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value;

    // Parse email addresses
    const parseAddress = (str: string) => {
      if (!str) return { email: '', name: undefined };
      const match = str.match(/(?:"?([^"]*)"?\s)?<?([^>]*)>?/);
      return {
        email: match?.[2] || str,
        name: match?.[1] || undefined,
      };
    };

    const parseAddressList = (str: string): Array<{ email: string; name?: string }> => {
      if (!str) return [];
      return str.split(',').map(s => parseAddress(s.trim())).filter(a => a.email);
    };

    const from = parseAddress(getHeader('from') || '');
    const to = parseAddressList(getHeader('to') || '');
    const cc = parseAddressList(getHeader('cc') || '');
    const bcc = parseAddressList(getHeader('bcc') || '');

    // Handle date - Gmail uses internalDate (Unix timestamp in milliseconds)
    const dateValue = email.internalDate
      ? new Date(parseInt(email.internalDate)).toISOString()
      : new Date().toISOString();

    return {
      id: email.id,
      subject: getHeader('subject') || '(No Subject)',
      body: this.extractGmailBody(email.payload),
      from,
      to,
      cc: cc.length > 0 ? cc : undefined,
      bcc: bcc.length > 0 ? bcc : undefined,
      date: dateValue,
      threadId: email.threadId,
      labels: email.labelIds,
      isRead: !email.labelIds?.includes('UNREAD'),
      hasAttachments: email.payload?.parts?.some((p: any) => p.filename) || false,
      attachments: this.extractGmailAttachments(email.payload),
      _source: {
        plugin: sourcePlugin,
        originalId: email.id,
        normalizedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Extract Gmail email body
   */
  private static extractGmailBody(payload: any): string {
    if (!payload) return '';

    if (payload.body?.data) {
      return Buffer.from(payload.body.data, 'base64').toString('utf-8');
    }

    // Multi-part email
    if (payload.parts) {
      // Prefer text/plain
      const textPart = payload.parts.find((p: any) => p.mimeType === 'text/plain');
      if (textPart?.body?.data) {
        return Buffer.from(textPart.body.data, 'base64').toString('utf-8');
      }

      // Fallback to text/html
      const htmlPart = payload.parts.find((p: any) => p.mimeType === 'text/html');
      if (htmlPart?.body?.data) {
        return Buffer.from(htmlPart.body.data, 'base64').toString('utf-8');
      }

      // Recursive search in nested parts
      for (const part of payload.parts) {
        if (part.parts) {
          const body = this.extractGmailBody(part);
          if (body) return body;
        }
      }
    }

    return '';
  }

  /**
   * Extract Gmail attachments
   */
  private static extractGmailAttachments(payload: any) {
    if (!payload?.parts) return undefined;

    const attachments = payload.parts
      .filter((p: any) => p.filename && p.filename.length > 0)
      .map((p: any) => ({
        filename: p.filename,
        mimeType: p.mimeType,
        size: parseInt(p.body?.size || 0),
      }));

    return attachments.length > 0 ? attachments : undefined;
  }

  /**
   * Detect Outlook format
   */
  private static isOutlookFormat(email: any): boolean {
    return email.receivedDateTime && email.sender?.emailAddress;
  }

  /**
   * Normalize Outlook email
   */
  private static normalizeOutlook(email: any, sourcePlugin: string): UnifiedEmail {
    return {
      id: email.id,
      subject: email.subject || '(No Subject)',
      body: email.body?.content || email.bodyPreview || '',
      from: {
        email: email.sender?.emailAddress?.address || email.from?.emailAddress?.address || '',
        name: email.sender?.emailAddress?.name || email.from?.emailAddress?.name,
      },
      to: (email.toRecipients || []).map((r: any) => ({
        email: r.emailAddress?.address || '',
        name: r.emailAddress?.name,
      })),
      cc: (email.ccRecipients || []).length > 0
        ? email.ccRecipients.map((r: any) => ({
            email: r.emailAddress?.address || '',
            name: r.emailAddress?.name,
          }))
        : undefined,
      bcc: (email.bccRecipients || []).length > 0
        ? email.bccRecipients.map((r: any) => ({
            email: r.emailAddress?.address || '',
            name: r.emailAddress?.name,
          }))
        : undefined,
      date: email.receivedDateTime,
      receivedDate: email.receivedDateTime,
      sentDate: email.sentDateTime,
      isRead: email.isRead || false,
      hasAttachments: email.hasAttachments || false,
      attachments: email.attachments?.length > 0
        ? email.attachments.map((a: any) => ({
            filename: a.name,
            mimeType: a.contentType,
            size: a.size,
          }))
        : undefined,
      _source: {
        plugin: sourcePlugin,
        originalId: email.id,
        normalizedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Generic normalization (fallback)
   */
  private static normalizeGeneric(email: any, sourcePlugin: string): UnifiedEmail {
    // Try to extract common fields
    const from = typeof email.from === 'string'
      ? { email: email.from, name: undefined }
      : { email: email.from?.email || email.from?.address || '', name: email.from?.name };

    const to = Array.isArray(email.to)
      ? email.to.map((t: any) =>
          typeof t === 'string' ? { email: t, name: undefined } : { email: t.email || t.address || '', name: t.name }
        )
      : [typeof email.to === 'string' ? { email: email.to, name: undefined } : { email: email.to?.email || '', name: email.to?.name }];

    return {
      id: email.id || email.messageId || '',
      subject: email.subject || '(No Subject)',
      body: email.body || email.content || email.text || '',
      from,
      to,
      date: email.date || email.receivedDate || email.receivedDateTime || new Date().toISOString(),
      isRead: email.isRead !== false,
      hasAttachments: email.hasAttachments || false,
      _source: {
        plugin: sourcePlugin,
        originalId: email.id || '',
        normalizedAt: new Date().toISOString(),
      },
    };
  }
}
