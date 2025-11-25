/**
 * EmailPreprocessor - Preprocess email data
 *
 * Phase 2: Preprocessing System
 * Extracts metadata, removes noise, normalizes email structures
 */

import type { PreprocessingResult, PreprocessorConfig, ExtractedMetadata, PreprocessingOperation } from './types';

export class EmailPreprocessor {
  /**
   * Preprocess email data
   */
  static async preprocess(
    data: any,
    config: Required<PreprocessorConfig>
  ): Promise<PreprocessingResult> {
    const operations: PreprocessingOperation[] = [];
    const warnings: string[] = [];

    // Ensure array
    const emails = Array.isArray(data) ? data : [data];

    // Apply max items limit
    const limitedEmails = emails.slice(0, config.maxItems);
    if (emails.length > config.maxItems) {
      warnings.push(`Truncated from ${emails.length} to ${config.maxItems} emails`);
    }

    // Clean noise if requested
    let cleanedEmails = limitedEmails;
    if (config.removeNoise) {
      cleanedEmails = this.removeNoise(limitedEmails);
      operations.push({
        type: 'clean',
        target: 'body',
        description: 'Removed email signatures and disclaimers',
        itemsAffected: cleanedEmails.length,
      });
    }

    // Normalize structures if requested
    if (config.normalizeData) {
      cleanedEmails = this.normalizeStructures(cleanedEmails);
      operations.push({
        type: 'normalize',
        target: 'structure',
        description: 'Normalized email field structures',
        itemsAffected: cleanedEmails.length,
      });
    }

    // Deduplicate if requested
    if (config.deduplicate) {
      const beforeCount = cleanedEmails.length;
      cleanedEmails = this.deduplicate(cleanedEmails);
      operations.push({
        type: 'deduplicate',
        target: 'emails',
        description: 'Removed duplicate emails',
        itemsAffected: beforeCount - cleanedEmails.length,
      });
    }

    // Extract metadata
    const metadata: ExtractedMetadata = {};
    if (config.extractMetadata) {
      metadata.dateRange = this.extractDateRange(cleanedEmails);
      metadata.counts = this.extractCounts(cleanedEmails);
      metadata.email = this.extractEmailMetadata(cleanedEmails);

      operations.push({
        type: 'extract',
        target: 'metadata',
        description: 'Extracted email metadata',
        itemsAffected: cleanedEmails.length,
      });
    }

    return {
      cleanedInput: cleanedEmails,
      metadata,
      operations,
      dataType: 'email',
      success: true,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Remove email signatures, disclaimers, and other noise
   */
  private static removeNoise(emails: any[]): any[] {
    return emails.map(email => {
      if (!email.body && !email.snippet) {
        return email;
      }

      let body = email.body || email.snippet || '';

      // Remove common signature patterns
      body = this.removeSignatures(body);

      // Remove email disclaimers
      body = this.removeDisclaimers(body);

      // Remove quoted replies (lines starting with >)
      body = this.removeQuotedReplies(body);

      return {
        ...email,
        body: body.trim(),
        _originalBodyLength: (email.body || email.snippet || '').length,
      };
    });
  }

  /**
   * Remove email signatures
   */
  private static removeSignatures(body: string): string {
    const signaturePatterns = [
      /--\s*\n[\s\S]*/g, // -- signature separator
      /_{3,}\n[\s\S]*/g, // ___ separator
      /Best regards,[\s\S]*/gi,
      /Best,[\s\S]*/gi,
      /Thanks,[\s\S]*/gi,
      /Thank you,[\s\S]*/gi,
      /Regards,[\s\S]*/gi,
      /Sincerely,[\s\S]*/gi,
      /Cheers,[\s\S]*/gi,
      /Sent from my (iPhone|iPad|Android)/gi,
    ];

    let cleaned = body;
    for (const pattern of signaturePatterns) {
      const match = cleaned.match(pattern);
      if (match && match.index !== undefined) {
        // Only remove if signature is in last 30% of email
        const signatureStart = match.index;
        const bodyLength = cleaned.length;
        if (signatureStart > bodyLength * 0.7) {
          cleaned = cleaned.substring(0, signatureStart);
        }
      }
    }

    return cleaned;
  }

  /**
   * Remove legal disclaimers
   */
  private static removeDisclaimers(body: string): string {
    const disclaimerPatterns = [
      /CONFIDENTIAL[:\s\-]*[\s\S]{0,500}?(?=\n\n|$)/gi,
      /This email (and any attachments|is confidential)[\s\S]{0,500}?(?=\n\n|$)/gi,
      /DISCLAIMER[:\s\-]*[\s\S]{0,500}?(?=\n\n|$)/gi,
      /The information contained in this[\s\S]{0,500}?(?=\n\n|$)/gi,
    ];

    let cleaned = body;
    for (const pattern of disclaimerPatterns) {
      cleaned = cleaned.replace(pattern, '');
    }

    return cleaned;
  }

  /**
   * Remove quoted reply text
   */
  private static removeQuotedReplies(body: string): string {
    // Remove lines starting with >
    const lines = body.split('\n');
    const filteredLines = lines.filter(line => !line.trim().startsWith('>'));
    return filteredLines.join('\n');
  }

  /**
   * Normalize email structures to consistent format
   */
  private static normalizeStructures(emails: any[]): any[] {
    return emails.map(email => ({
      id: email.id || email.messageId || email.message_id,
      subject: email.subject || '(No Subject)',
      body: email.body || email.snippet || email.text || '',
      from: this.normalizeAddress(email.from || email.sender),
      to: this.normalizeAddressList(email.to || email.recipients),
      cc: this.normalizeAddressList(email.cc),
      date: email.date || email.receivedAt || email.received_at || new Date().toISOString(),
      isRead: email.isRead ?? email.is_read ?? email.read ?? false,
      hasAttachments: email.hasAttachments ?? email.has_attachments ?? (email.attachments?.length > 0) ?? false,
      attachments: email.attachments || [],
      labels: email.labels || email.tags || [],
      threadId: email.threadId || email.thread_id,
    }));
  }

  /**
   * Normalize email address to consistent format
   */
  private static normalizeAddress(address: any): { email: string; name?: string } | null {
    if (!address) return null;

    if (typeof address === 'string') {
      // Parse "Name <email@example.com>" format
      const match = address.match(/^(.+?)\s*<(.+?)>$/);
      if (match) {
        return { name: match[1].trim(), email: match[2].trim() };
      }
      return { email: address.trim() };
    }

    if (typeof address === 'object') {
      return {
        email: address.email || address.emailAddress || address.address || '',
        name: address.name || address.displayName || address.personal,
      };
    }

    return null;
  }

  /**
   * Normalize address list
   */
  private static normalizeAddressList(addresses: any): Array<{ email: string; name?: string }> {
    if (!addresses) return [];
    if (!Array.isArray(addresses)) {
      const normalized = this.normalizeAddress(addresses);
      return normalized ? [normalized] : [];
    }
    return addresses
      .map(addr => this.normalizeAddress(addr))
      .filter((addr): addr is { email: string; name?: string } => addr !== null);
  }

  /**
   * Deduplicate emails by ID or subject+date
   */
  private static deduplicate(emails: any[]): any[] {
    const seen = new Set<string>();
    return emails.filter(email => {
      const key = email.id || `${email.subject}:${email.date}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  /**
   * Extract date range from emails
   */
  private static extractDateRange(emails: any[]): ExtractedMetadata['dateRange'] {
    const dates = emails
      .map(e => e.date)
      .filter(d => d)
      .map(d => new Date(d))
      .filter(d => !isNaN(d.getTime()));

    if (dates.length === 0) {
      return undefined;
    }

    const earliest = new Date(Math.min(...dates.map(d => d.getTime())));
    const latest = new Date(Math.max(...dates.map(d => d.getTime())));

    return {
      earliest: earliest.toISOString(),
      latest: latest.toISOString(),
      formattedRange: this.formatDateRange(earliest, latest),
      count: dates.length,
    };
  }

  /**
   * Format date range as human-readable string
   */
  private static formatDateRange(earliest: Date, latest: Date): string {
    const options: Intl.DateTimeFormatOptions = {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    };

    const earliestStr = earliest.toLocaleDateString('en-US', options);
    const latestStr = latest.toLocaleDateString('en-US', options);

    if (earliestStr === latestStr) {
      return earliestStr;
    }

    // Same year, show abbreviated format
    if (earliest.getFullYear() === latest.getFullYear()) {
      const earliestShort = earliest.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
      return `${earliestShort} - ${latestStr}`;
    }

    return `${earliestStr} - ${latestStr}`;
  }

  /**
   * Extract count metadata
   */
  private static extractCounts(emails: any[]): ExtractedMetadata['counts'] {
    return {
      total: emails.length,
      unread: emails.filter(e => !e.isRead).length,
      withAttachments: emails.filter(e => e.hasAttachments).length,
    };
  }

  /**
   * Extract email-specific metadata
   */
  private static extractEmailMetadata(emails: any[]): ExtractedMetadata['email'] {
    const senderMap = new Map<string, { email: string; name?: string; count: number }>();
    const recipientMap = new Map<string, { email: string; name?: string; count: number }>();
    const threadIds = new Set<string>();
    let totalAttachments = 0;
    let totalBodyLength = 0;

    for (const email of emails) {
      // Track senders
      if (email.from?.email) {
        const existing = senderMap.get(email.from.email);
        if (existing) {
          existing.count++;
        } else {
          senderMap.set(email.from.email, {
            email: email.from.email,
            name: email.from.name,
            count: 1,
          });
        }
      }

      // Track recipients
      for (const recipient of email.to || []) {
        if (recipient.email) {
          const existing = recipientMap.get(recipient.email);
          if (existing) {
            existing.count++;
          } else {
            recipientMap.set(recipient.email, {
              email: recipient.email,
              name: recipient.name,
              count: 1,
            });
          }
        }
      }

      // Track threads
      if (email.threadId) {
        threadIds.add(email.threadId);
      }

      // Track attachments
      totalAttachments += email.attachments?.length || 0;

      // Track body length
      totalBodyLength += (email.body || '').length;
    }

    const senders = Array.from(senderMap.values()).sort((a, b) => b.count - a.count);
    const recipients = Array.from(recipientMap.values()).sort((a, b) => b.count - a.count);

    return {
      senders,
      recipients,
      hasAttachments: totalAttachments > 0,
      totalAttachments,
      threads: threadIds.size,
      avgBodyLength: emails.length > 0 ? Math.round(totalBodyLength / emails.length) : 0,
    };
  }
}
