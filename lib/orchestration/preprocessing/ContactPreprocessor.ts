/**
 * ContactPreprocessor - Preprocess contact data
 *
 * Phase 2: Preprocessing System
 * Normalizes contact information, validates emails, extracts statistics
 */

import type { PreprocessingResult, PreprocessorConfig, ExtractedMetadata, PreprocessingOperation } from './types';

export class ContactPreprocessor {
  /**
   * Preprocess contact data
   */
  static async preprocess(
    data: any,
    config: Required<PreprocessorConfig>
  ): Promise<PreprocessingResult> {
    const operations: PreprocessingOperation[] = [];
    const warnings: string[] = [];

    // Ensure array
    const contacts = Array.isArray(data) ? data : [data];

    // Apply max items limit
    const limitedContacts = contacts.slice(0, config.maxItems);
    if (contacts.length > config.maxItems) {
      warnings.push(`Truncated from ${contacts.length} to ${config.maxItems} contacts`);
    }

    // Normalize structures if requested
    let cleanedContacts = limitedContacts;
    if (config.normalizeData) {
      cleanedContacts = this.normalizeStructures(limitedContacts);
      operations.push({
        type: 'normalize',
        target: 'structure',
        description: 'Normalized contact field structures',
        itemsAffected: cleanedContacts.length,
      });
    }

    // Validate emails
    if (config.removeNoise) {
      const beforeCount = cleanedContacts.length;
      cleanedContacts = this.validateContacts(cleanedContacts, warnings);
      const invalidCount = beforeCount - cleanedContacts.length;
      if (invalidCount > 0) {
        operations.push({
          type: 'filter',
          target: 'email',
          description: 'Removed contacts with invalid emails',
          itemsAffected: invalidCount,
        });
      }
    }

    // Deduplicate if requested
    if (config.deduplicate) {
      const beforeCount = cleanedContacts.length;
      cleanedContacts = this.deduplicate(cleanedContacts);
      operations.push({
        type: 'deduplicate',
        target: 'contacts',
        description: 'Removed duplicate contacts',
        itemsAffected: beforeCount - cleanedContacts.length,
      });
    }

    // Extract metadata
    const metadata: ExtractedMetadata = {};
    if (config.extractMetadata) {
      metadata.dateRange = this.extractDateRange(cleanedContacts);
      metadata.counts = this.extractCounts(cleanedContacts);
      metadata.contact = this.extractContactMetadata(cleanedContacts);

      operations.push({
        type: 'extract',
        target: 'metadata',
        description: 'Extracted contact metadata',
        itemsAffected: cleanedContacts.length,
      });
    }

    return {
      cleanedInput: cleanedContacts,
      metadata,
      operations,
      dataType: 'contact',
      success: true,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Normalize contact structures to consistent format
   */
  private static normalizeStructures(contacts: any[]): any[] {
    return contacts.map(contact => {
      // Extract name fields
      const firstName = contact.firstName || contact.first_name || contact.FirstName || contact.givenName;
      const lastName = contact.lastName || contact.last_name || contact.LastName || contact.familyName;
      const fullName = contact.name || contact.fullName || contact.displayName ||
                      `${firstName || ''} ${lastName || ''}`.trim();

      // Extract email
      const email = contact.email || contact.emailAddress || contact.Email ||
                   contact.emailAddresses?.[0]?.value || '';

      // Extract phone
      const phone = contact.phone || contact.phoneNumber || contact.Phone ||
                   contact.phoneNumbers?.[0]?.value;

      // Extract company
      const company = contact.company || contact.companyName || contact.Company ||
                     contact.Account?.Name || contact.organizations?.[0]?.name;

      // Extract job title
      const jobTitle = contact.jobTitle || contact.title || contact.Title ||
                      contact.organizations?.[0]?.title;

      return {
        id: contact.id || contact.contactId || contact.resourceName,
        email,
        name: {
          first: firstName,
          last: lastName,
          full: fullName || email || 'Unknown',
        },
        phone,
        company,
        jobTitle,
        linkedin: contact.linkedin || contact.LinkedIn__c || contact.linkedinUrl,
        twitter: contact.twitter || contact.Twitter__c || contact.twitterHandle,
        tags: contact.tags || [],
        lastContactedAt: contact.lastContactedAt || contact.lastModifiedDate || contact.LastModifiedDate,
        notes: contact.notes || contact.description || contact.Description,
      };
    });
  }

  /**
   * Validate contacts (require valid email)
   */
  private static validateContacts(contacts: any[], warnings: string[]): any[] {
    return contacts.filter(contact => {
      // Check for email
      if (!contact.email) {
        warnings.push(`Contact ${contact.name?.full || contact.id || 'unknown'} has no email`);
        return false;
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(contact.email)) {
        warnings.push(`Contact ${contact.name?.full || contact.id} has invalid email: ${contact.email}`);
        return false;
      }

      return true;
    });
  }

  /**
   * Deduplicate contacts by email
   */
  private static deduplicate(contacts: any[]): any[] {
    const seen = new Map<string, any>();

    for (const contact of contacts) {
      const key = contact.email.toLowerCase();

      if (!seen.has(key)) {
        seen.set(key, contact);
      } else {
        // Keep the contact with more information
        const existing = seen.get(key)!;
        const existingFields = Object.values(existing).filter(v => v !== undefined && v !== null && v !== '').length;
        const newFields = Object.values(contact).filter(v => v !== undefined && v !== null && v !== '').length;

        if (newFields > existingFields) {
          seen.set(key, contact);
        }
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Extract date range from contacts (last contacted)
   */
  private static extractDateRange(contacts: any[]): ExtractedMetadata['dateRange'] {
    const dates = contacts
      .map(c => c.lastContactedAt)
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

    if (earliest.getFullYear() === latest.getFullYear()) {
      const earliestShort = earliest.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
      return `${earliestShort} - ${latestStr}`;
    }

    return `${earliestStr} - ${latestStr}`;
  }

  /**
   * Extract count metadata
   */
  private static extractCounts(contacts: any[]): ExtractedMetadata['counts'] {
    return {
      total: contacts.length,
    };
  }

  /**
   * Extract contact-specific metadata
   */
  private static extractContactMetadata(contacts: any[]): ExtractedMetadata['contact'] {
    const withEmail = contacts.filter(c => c.email).length;
    const withPhone = contacts.filter(c => c.phone).length;
    const withCompany = contacts.filter(c => c.company).length;

    // Count by company
    const companyCount = new Map<string, number>();
    for (const contact of contacts) {
      if (contact.company) {
        companyCount.set(contact.company, (companyCount.get(contact.company) || 0) + 1);
      }
    }
    const topCompanies = Array.from(companyCount.entries())
      .map(([company, count]) => ({ company, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Count by tag
    const byTag: Record<string, number> = {};
    for (const contact of contacts) {
      for (const tag of contact.tags || []) {
        byTag[tag] = (byTag[tag] || 0) + 1;
      }
    }

    return {
      totalContacts: contacts.length,
      withEmail,
      withPhone,
      withCompany,
      topCompanies,
      byTag,
    };
  }
}
