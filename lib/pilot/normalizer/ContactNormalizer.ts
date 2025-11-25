/**
 * ContactNormalizer - Normalize contacts from different CRM systems
 *
 * Phase 1: Data Normalization Layer
 * Supports: HubSpot, Salesforce, Google Contacts, Microsoft Contacts
 */

import type { UnifiedContact } from './types';

export class ContactNormalizer {
  /**
   * Normalize contact from any provider to UnifiedContact
   * Plugin-agnostic: Detects format by data structure
   */
  static normalize(contact: any, sourcePlugin: string): UnifiedContact {
    // Detect format by structure, not plugin name

    // HubSpot format: has 'properties' object with nested fields
    if (contact.properties && (contact.vid || contact.id)) {
      return this.normalizeHubSpot(contact, sourcePlugin);
    }

    // Salesforce format: has 'Id' (capital I) and 'Account' object
    if (contact.Id && contact.LastModifiedDate) {
      return this.normalizeSalesforce(contact, sourcePlugin);
    }

    // Google Contacts format: has 'resourceName' and 'names' array
    if (contact.resourceName && contact.names) {
      return this.normalizeGoogleContacts(contact, sourcePlugin);
    }

    // Generic fallback
    return this.normalizeGeneric(contact, sourcePlugin);
  }

  /**
   * Normalize HubSpot contact
   */
  private static normalizeHubSpot(contact: any, sourcePlugin: string): UnifiedContact {
    const props = contact.properties || contact;

    return {
      id: contact.id || contact.vid,
      email: props.email || '',
      name: {
        first: props.firstname,
        last: props.lastname,
        full: `${props.firstname || ''} ${props.lastname || ''}`.trim() || props.email || 'Unknown',
      },
      phone: props.phone || props.mobilephone,
      company: props.company,
      jobTitle: props.jobtitle,
      linkedin: props.linkedin_url,
      twitter: props.twitter_handle,
      tags: contact.tags || [],
      lastContactedAt: props.lastmodifieddate || props.hs_lastmodifieddate,
      notes: props.notes,
      _source: {
        plugin: sourcePlugin,
        originalId: contact.id || contact.vid,
        normalizedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Normalize Salesforce contact
   */
  private static normalizeSalesforce(contact: any, sourcePlugin: string): UnifiedContact {
    return {
      id: contact.Id,
      email: contact.Email || '',
      name: {
        first: contact.FirstName,
        last: contact.LastName,
        full: `${contact.FirstName || ''} ${contact.LastName || ''}`.trim() || contact.Email || 'Unknown',
      },
      phone: contact.Phone || contact.MobilePhone,
      company: contact.Account?.Name || contact.AccountId,
      jobTitle: contact.Title,
      linkedin: contact.LinkedIn__c,
      twitter: contact.Twitter__c,
      tags: contact.Tags ? contact.Tags.split(',').map((t: string) => t.trim()) : [],
      lastContactedAt: contact.LastModifiedDate,
      notes: contact.Description,
      _source: {
        plugin: sourcePlugin,
        originalId: contact.Id,
        normalizedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Normalize Google Contacts
   */
  private static normalizeGoogleContacts(contact: any, sourcePlugin: string): UnifiedContact {
    const name = contact.names?.[0];
    const email = contact.emailAddresses?.[0]?.value || '';
    const phone = contact.phoneNumbers?.[0]?.value;
    const org = contact.organizations?.[0];

    return {
      id: contact.resourceName || contact.id,
      email,
      name: {
        first: name?.givenName,
        last: name?.familyName,
        full: name?.displayName || email || 'Unknown',
      },
      phone,
      company: org?.name,
      jobTitle: org?.title,
      tags: contact.userDefined?.map((u: any) => u.value) || [],
      notes: contact.biographies?.[0]?.value,
      _source: {
        plugin: sourcePlugin,
        originalId: contact.resourceName || contact.id,
        normalizedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Generic normalization (fallback)
   */
  private static normalizeGeneric(contact: any, sourcePlugin: string): UnifiedContact {
    const firstName = contact.firstName || contact.first_name || contact.FirstName;
    const lastName = contact.lastName || contact.last_name || contact.LastName;
    const email = contact.email || contact.Email || contact.emailAddress || '';

    return {
      id: contact.id || contact.contactId || '',
      email,
      name: {
        first: firstName,
        last: lastName,
        full: contact.name || contact.fullName || `${firstName || ''} ${lastName || ''}`.trim() || email || 'Unknown',
      },
      phone: contact.phone || contact.phoneNumber || contact.Phone,
      company: contact.company || contact.companyName || contact.Company,
      jobTitle: contact.jobTitle || contact.title || contact.Title,
      tags: contact.tags || [],
      lastContactedAt: contact.lastContactedAt || contact.lastModifiedDate,
      notes: contact.notes || contact.description,
      _source: {
        plugin: sourcePlugin,
        originalId: contact.id || '',
        normalizedAt: new Date().toISOString(),
      },
    };
  }
}
