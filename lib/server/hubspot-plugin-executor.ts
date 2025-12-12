// lib/server/hubspot-plugin-executor.ts

import { UserPluginConnections } from './user-plugin-connections';
import { PluginManagerV2 } from './plugin-manager-v2';
import { ExecutionResult } from '@/lib/types/plugin-types';
import { BasePluginExecutor } from './base-plugin-executor';

const pluginName = 'hubspot';
const hubspotApiUrl = "https://api.hubapi.com/crm/v3"; 

export class HubSpotPluginExecutor extends BasePluginExecutor {
  constructor(userConnections: UserPluginConnections, pluginManager: PluginManagerV2) {
    super(pluginName, userConnections, pluginManager);
  }

  // Execute HubSpot action with validation and error handling
  protected async executeSpecificAction(
    connection: any,
    actionName: string,
    parameters: any
  ): Promise<any> {
    // Execute the specific action
    let result: any;
    switch (actionName) {
      case 'get_contact':
        result = await this.getContact(connection, parameters);
        break;
      case 'get_contact_deals':
        result = await this.getContactDeals(connection, parameters);
        break;
      case 'get_contact_activities':
        result = await this.getContactActivities(connection, parameters);
        break;
      case 'search_contacts':
        result = await this.searchContacts(connection, parameters);
        break;
      case 'get_deal':
        result = await this.getDeal(connection, parameters);
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

  // Get contact by ID or email
  private async getContact(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Getting HubSpot contact');

    const { contact_identifier, identifier_type, properties, include_associations } = parameters;
    const idType = identifier_type || 'email';

    let url: string;
    let contactData: any;

    try {
      if (idType === 'email') {
        // Search by email using the search API
        const searchUrl = `${hubspotApiUrl}/objects/contacts/search`;
        const searchBody = {
          filterGroups: [
            {
              filters: [
                {
                  propertyName: 'email',
                  operator: 'EQ',
                  value: contact_identifier
                }
              ]
            }
          ],
          properties: properties || undefined,
          limit: 1
        };

        const searchResponse = await fetch(searchUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${connection.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(searchBody)
        });

        const searchData = await this.handleHubSpotResponse(searchResponse, 'search_contact');

        if (!searchData.results || searchData.results.length === 0) {
          return {
            success: false,
            error: 'contact_not_found',
            message: `No contact found with email: ${contact_identifier}`
          };
        }

        contactData = searchData.results[0];
      } else {
        // Get by ID
        url = new URL(`${hubspotApiUrl}/objects/contacts/${contact_identifier}`);
        
        if (properties && properties.length > 0) {
          url.searchParams.set('properties', properties.join(','));
        }

        if (include_associations) {
          url.searchParams.set('associations', 'deals,companies');
        }

        const response = await fetch(url.toString(), {
          headers: {
            'Authorization': `Bearer ${connection.access_token}`,
          },
        });

        contactData = await this.handleHubSpotResponse(response, 'get_contact');
      }

      // Format the response
      const contact = {
        contact_id: contactData.id,
        properties: contactData.properties,
        created_at: contactData.createdAt,
        updated_at: contactData.updatedAt,
        archived: contactData.archived || false
      };

      if (include_associations && contactData.associations) {
        contact['associations'] = {
          deals: contactData.associations.deals?.results || [],
          companies: contactData.associations.companies?.results || []
        };
      }

      return {
        success: true,
        data: contact,
        message: `Contact retrieved successfully`
      };

    } catch (error: any) {
      this.logger.error({ err: error }, 'Error getting contact:');
      throw error;
    }
  }

  // Get all deals associated with a contact
  private async getContactDeals(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Getting contact deals');

    const { contact_id, limit, include_deal_details, deal_properties } = parameters;
    const maxLimit = Math.min(limit || 50, 100);

    try {
      // Get deal associations
      const associationsUrl = `https://api.hubapi.com/crm/v4/objects/contacts/${contact_id}/associations/deals`;
      const associationsResponse = await fetch(associationsUrl, {
        headers: {
          'Authorization': `Bearer ${connection.access_token}`,
        },
      });

      const associationsData = await this.handleHubSpotResponse(associationsResponse, 'get_contact_associations');

      if (!associationsData.results || associationsData.results.length === 0) {
        return {
          success: true,
          data: {
            contact_id: contact_id,
            deals: [],
            total_count: 0
          },
          message: 'No deals found for this contact'
        };
      }

      const dealIds = associationsData.results.slice(0, maxLimit).map((assoc: any) => assoc.toObjectId);

      // Get deal details if requested
      let deals: any[] = [];
      if (include_deal_details !== false) {
        const dealsUrl = new URL(`${hubspotApiUrl}/objects/deals/batch/read`);
        
        const dealsBody = {
          inputs: dealIds.map((id: string) => ({ id })),
          properties: deal_properties || [
            'dealname',
            'amount',
            'dealstage',
            'closedate',
            'pipeline',
            'hubspot_owner_id',
            'createdate'
          ]
        };

        const dealsResponse = await fetch(dealsUrl.toString(), {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${connection.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(dealsBody)
        });

        const dealsData = await this.handleHubSpotResponse(dealsResponse, 'get_deals_batch');

        deals = (dealsData.results || []).map((deal: any) => ({
          deal_id: deal.id,
          deal_name: deal.properties.dealname,
          amount: deal.properties.amount,
          stage: deal.properties.dealstage,
          close_date: deal.properties.closedate,
          pipeline: deal.properties.pipeline,
          owner_id: deal.properties.hubspot_owner_id,
          created_at: deal.properties.createdate,
          properties: deal.properties
        }));
      } else {
        deals = dealIds.map((id: string) => ({ deal_id: id }));
      }

      // Calculate total deal value if amounts are available
      let total_value = 0;
      if (include_deal_details !== false) {
        total_value = deals.reduce((sum, deal) => {
          const amount = parseFloat(deal.amount) || 0;
          return sum + amount;
        }, 0);
      }

      return {
        success: true,
        data: {
          contact_id: contact_id,
          deals: deals,
          total_count: deals.length,
          total_deal_value: total_value > 0 ? total_value : undefined
        },
        message: `Found ${deals.length} deal(s) for this contact`
      };

    } catch (error: any) {
      this.logger.error({ err: error }, 'Error getting contact deals:');
      throw error;
    }
  }

  // Get contact activities (engagements)
  private async getContactActivities(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Getting contact activities');

    const { contact_id, activity_types, limit, since_date } = parameters;
    const maxLimit = Math.min(limit || 25, 100);
    const types = activity_types || ['calls', 'emails', 'notes', 'meetings', 'tasks'];

    const allActivities: any[] = [];

    try {
      // Fetch each activity type
      for (const activityType of types) {
        const url = new URL(`${hubspotApiUrl}/objects/${activityType}`);
        url.searchParams.set('limit', maxLimit.toString());
        url.searchParams.set('associations', 'contacts');

        // Add properties based on activity type
        const properties = this.getActivityProperties(activityType);
        if (properties.length > 0) {
          url.searchParams.set('properties', properties.join(','));
        }

        const response = await fetch(url.toString(), {
          headers: {
            'Authorization': `Bearer ${connection.access_token}`,
          },
        });

        const data = await this.handleHubSpotResponse(response, `get_${activityType}`);

        // Filter activities associated with this contact
        const contactActivities = (data.results || []).filter((activity: any) => {
          const contactAssociations = activity.associations?.contacts?.results || [];
          return contactAssociations.some((assoc: any) => assoc.id === contact_id);
        });

        // Filter by date if specified
        let filteredActivities = contactActivities;
        if (since_date) {
          const sinceTimestamp = new Date(since_date).getTime();
          filteredActivities = contactActivities.filter((activity: any) => {
            const activityTimestamp = new Date(activity.properties.hs_timestamp || activity.createdAt).getTime();
            return activityTimestamp >= sinceTimestamp;
          });
        }

        // Format and add to results
        filteredActivities.forEach((activity: any) => {
          allActivities.push(this.formatActivity(activityType, activity));
        });
      }

      // Sort by date (newest first)
      allActivities.sort((a, b) => {
        const dateA = new Date(a.timestamp).getTime();
        const dateB = new Date(b.timestamp).getTime();
        return dateB - dateA;
      });

      // Count by type
      const countsByType: Record<string, number> = {};
      allActivities.forEach(activity => {
        countsByType[activity.type] = (countsByType[activity.type] || 0) + 1;
      });

      return {
        success: true,
        data: {
          contact_id: contact_id,
          activities: allActivities,
          total_count: allActivities.length,
          counts_by_type: countsByType
        },
        message: `Found ${allActivities.length} activit${allActivities.length === 1 ? 'y' : 'ies'} for this contact`
      };

    } catch (error: any) {
      this.logger.error({ err: error }, 'Error getting contact activities:');
      throw error;
    }
  }

  // Search for contacts
  private async searchContacts(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Searching contacts');

    const { query, filters, limit, properties, sort_by, sort_direction } = parameters;
    const maxLimit = Math.min(limit || 25, 100);

    try {
      const searchUrl = `${hubspotApiUrl}/objects/contacts/search`;
      
      // Build filter groups
      const filterGroups: any[] = [];

      // Add query filter (searches name, email, company)
      if (query && query.trim()) {
        filterGroups.push({
          filters: [
            {
              propertyName: 'firstname',
              operator: 'CONTAINS_TOKEN',
              value: query
            }
          ]
        });
        filterGroups.push({
          filters: [
            {
              propertyName: 'lastname',
              operator: 'CONTAINS_TOKEN',
              value: query
            }
          ]
        });
        filterGroups.push({
          filters: [
            {
              propertyName: 'email',
              operator: 'CONTAINS_TOKEN',
              value: query
            }
          ]
        });
        filterGroups.push({
          filters: [
            {
              propertyName: 'company',
              operator: 'CONTAINS_TOKEN',
              value: query
            }
          ]
        });
      }

      // Add property filters
      if (filters && Object.keys(filters).length > 0) {
        const propertyFilters = Object.entries(filters).map(([property, value]) => ({
          propertyName: property,
          operator: 'EQ',
          value: String(value)
        }));

        if (filterGroups.length > 0) {
          // AND condition with query filters
          filterGroups[0].filters.push(...propertyFilters);
        } else {
          filterGroups.push({ filters: propertyFilters });
        }
      }

      const searchBody: any = {
        filterGroups: filterGroups,
        properties: properties || ['firstname', 'lastname', 'email', 'company', 'phone', 'lifecyclestage'],
        limit: maxLimit
      };

      // Add sorting
      if (sort_by) {
        searchBody.sorts = [
          {
            propertyName: sort_by,
            direction: sort_direction || 'DESCENDING'
          }
        ];
      }

      const response = await fetch(searchUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${connection.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(searchBody)
      });

      const data = await this.handleHubSpotResponse(response, 'search_contacts');

      const contacts = (data.results || []).map((contact: any) => ({
        contact_id: contact.id,
        properties: contact.properties,
        created_at: contact.createdAt,
        updated_at: contact.updatedAt
      }));

      return {
        success: true,
        data: {
          contacts: contacts,
          total_count: contacts.length,
          has_more: data.paging?.next ? true : false
        },
        message: `Found ${contacts.length} contact(s) matching search criteria`
      };

    } catch (error: any) {
      this.logger.error({ err: error }, 'Error searching contacts:');
      throw error;
    }
  }

  // Get deal details
  private async getDeal(connection: any, parameters: any): Promise<any> {
    this.logger.debug('Getting deal');

    const { deal_id, properties, include_associations } = parameters;

    try {
      const url = new URL(`${hubspotApiUrl}/objects/deals/${deal_id}`);
      
      if (properties && properties.length > 0) {
        url.searchParams.set('properties', properties.join(','));
      } else {
        // Default properties
        url.searchParams.set('properties', 'dealname,amount,dealstage,closedate,pipeline,hubspot_owner_id,createdate');
      }

      if (include_associations !== false) {
        url.searchParams.set('associations', 'contacts,companies');
      }

      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${connection.access_token}`,
        },
      });

      const dealData = await this.handleHubSpotResponse(response, 'get_deal');

      const deal = {
        deal_id: dealData.id,
        properties: dealData.properties,
        created_at: dealData.createdAt,
        updated_at: dealData.updatedAt,
        archived: dealData.archived || false
      };

      if (include_associations !== false && dealData.associations) {
        deal['associations'] = {
          contacts: dealData.associations.contacts?.results || [],
          companies: dealData.associations.companies?.results || []
        };
      }

      return {
        success: true,
        data: deal,
        message: 'Deal retrieved successfully'
      };

    } catch (error: any) {
      this.logger.error({ err: error }, 'Error getting deal:');
      throw error;
    }
  }

  // Helper: Get properties for activity type
  private getActivityProperties(activityType: string): string[] {
    const commonProps = ['hs_timestamp', 'hs_createdate', 'hubspot_owner_id'];
    
    const typeSpecificProps: Record<string, string[]> = {
      calls: ['hs_call_title', 'hs_call_body', 'hs_call_duration', 'hs_call_status'],
      emails: ['hs_email_subject', 'hs_email_text', 'hs_email_direction', 'hs_email_status'],
      notes: ['hs_note_body', 'hs_attachment_ids'],
      meetings: ['hs_meeting_title', 'hs_meeting_body', 'hs_meeting_start_time', 'hs_meeting_end_time'],
      tasks: ['hs_task_subject', 'hs_task_body', 'hs_task_status', 'hs_task_priority']
    };

    return [...commonProps, ...(typeSpecificProps[activityType] || [])];
  }

  // Helper: Format activity for consistent output
  private formatActivity(activityType: string, activity: any): any {
    const props = activity.properties;
    const baseActivity = {
      activity_id: activity.id,
      type: activityType,
      timestamp: props.hs_timestamp || activity.createdAt,
      owner_id: props.hubspot_owner_id,
      created_at: activity.createdAt
    };

    // Add type-specific fields
    switch (activityType) {
      case 'calls':
        return {
          ...baseActivity,
          title: props.hs_call_title,
          body: props.hs_call_body,
          duration: props.hs_call_duration,
          status: props.hs_call_status
        };
      case 'emails':
        return {
          ...baseActivity,
          subject: props.hs_email_subject,
          body: props.hs_email_text,
          direction: props.hs_email_direction,
          status: props.hs_email_status
        };
      case 'notes':
        return {
          ...baseActivity,
          body: props.hs_note_body,
          has_attachments: !!props.hs_attachment_ids
        };
      case 'meetings':
        return {
          ...baseActivity,
          title: props.hs_meeting_title,
          body: props.hs_meeting_body,
          start_time: props.hs_meeting_start_time,
          end_time: props.hs_meeting_end_time
        };
      case 'tasks':
        return {
          ...baseActivity,
          subject: props.hs_task_subject,
          body: props.hs_task_body,
          status: props.hs_task_status,
          priority: props.hs_task_priority
        };
      default:
        return baseActivity;
    }
  }

  // Handle HubSpot API responses
  private async handleHubSpotResponse(response: Response, operationName: string): Promise<any> {
    if (!response.ok) {
      const errorText = await response.text();
      if (this.debug) console.error(`DEBUG: ${operationName} HTTP failed:`, errorText);
      
      // Try to parse error JSON
      try {
        const errorData = JSON.parse(errorText);
        throw new Error(`HubSpot API error: ${errorData.message || errorData.category || response.status}`);
      } catch {
        throw new Error(`HubSpot API HTTP error: ${response.status} - ${errorText}`);
      }
    }

    const data = await response.json();
    return data;
  }

  // Override to handle HubSpot-specific errors
  protected mapPluginSpecificError(error: any, commonErrors: Record<string, string>): string | null {
    const errorMsg = error.message || '';

    // HubSpot-specific error patterns
    if (errorMsg.includes('contact not found') || errorMsg.includes('resource not found')) {
      return commonErrors.contact_not_found || 'Contact not found. Verify the contact ID or email address.';
    }

    if (errorMsg.includes('deal not found')) {
      return commonErrors.deal_not_found || 'Deal not found. Verify the deal ID.';
    }

    if (errorMsg.includes('invalid property') || errorMsg.includes('property does not exist')) {
      return commonErrors.invalid_property || 'Invalid property name. Check that the property exists in HubSpot.';
    }

    if (errorMsg.includes('invalid filter') || errorMsg.includes('filter property')) {
      return commonErrors.invalid_filter_property || 'Invalid filter property. Check that the property exists in HubSpot.';
    }

    if (errorMsg.includes('rate limit') || errorMsg.includes('429')) {
      return commonErrors.api_rate_limit || 'HubSpot API rate limit exceeded. Please wait and try again.';
    }

    if (errorMsg.includes('insufficient') || errorMsg.includes('missing scopes') || errorMsg.includes('403')) {
      return commonErrors.insufficient_permissions || 'Insufficient permissions. Check that required scopes are authorized.';
    }

    if (errorMsg.includes('invalid date')) {
      return commonErrors.invalid_date_format || 'Invalid date format. Use ISO 8601 format (YYYY-MM-DD).';
    }

    // Return null to fall back to common error handling
    return null;
  }

  // Test connection with a simple API call
  protected async performConnectionTest(connection: any): Promise<any> {
    // Test with a simple contacts API call
    const response = await fetch(`${hubspotApiUrl}/objects/contacts?limit=1`, {
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
      },
    });

    const data = await this.handleHubSpotResponse(response, 'connection_test');

    return {
      success: true,
      data: {
        account_id: connection.user_id,
        contact_count: data.total || 0
      },
      message: 'HubSpot connection active'
    };
  }

  /**
   * List all available HubSpot contacts for dynamic dropdown options
   * This method is called by the fetch-options API route
   */
  async list_contacts(connection: any, options: { page?: number; limit?: number } = {}): Promise<Array<{value: string; label: string; description?: string; icon?: string; group?: string}>> {
    try {
      const { limit = 100 } = options;

      const url = new URL(`${hubspotApiUrl}/objects/contacts`);
      url.searchParams.set('limit', limit.toString());
      url.searchParams.set('properties', 'firstname,lastname,email');

      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${connection.access_token}`,
        },
      });

      const data = await this.handleHubSpotResponse(response, 'list_contacts');

      if (!data.results || !Array.isArray(data.results)) {
        return [];
      }

      // Transform to option format
      return data.results.map((contact: any) => {
        const firstName = contact.properties.firstname || '';
        const lastName = contact.properties.lastname || '';
        const email = contact.properties.email || '';
        const name = [firstName, lastName].filter(Boolean).join(' ') || email || 'Unknown';

        return {
          value: contact.id,
          label: name,
          description: email,
          icon: '👤',
          group: 'Contacts',
        };
      });

    } catch (error: any) {
      this.logger.error({ err: error }, 'Error listing HubSpot contacts for options');
      throw error;
    }
  }

  /**
   * List all available HubSpot companies for dynamic dropdown options
   * This method is called by the fetch-options API route
   */
  async list_companies(connection: any, options: { page?: number; limit?: number } = {}): Promise<Array<{value: string; label: string; description?: string; icon?: string; group?: string}>> {
    try {
      const { limit = 100 } = options;

      const url = new URL(`${hubspotApiUrl}/objects/companies`);
      url.searchParams.set('limit', limit.toString());
      url.searchParams.set('properties', 'name,domain');

      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${connection.access_token}`,
        },
      });

      const data = await this.handleHubSpotResponse(response, 'list_companies');

      if (!data.results || !Array.isArray(data.results)) {
        return [];
      }

      // Transform to option format
      return data.results.map((company: any) => ({
        value: company.id,
        label: company.properties.name || 'Unknown Company',
        description: company.properties.domain || undefined,
        icon: '🏢',
        group: 'Companies',
      }));

    } catch (error: any) {
      this.logger.error({ err: error }, 'Error listing HubSpot companies for options');
      throw error;
    }
  }

  /**
   * List all available HubSpot deals for dynamic dropdown options
   * This method is called by the fetch-options API route
   */
  async list_deals(connection: any, options: { page?: number; limit?: number } = {}): Promise<Array<{value: string; label: string; description?: string; icon?: string; group?: string}>> {
    try {
      const { limit = 100 } = options;

      const url = new URL(`${hubspotApiUrl}/objects/deals`);
      url.searchParams.set('limit', limit.toString());
      url.searchParams.set('properties', 'dealname,amount,dealstage');

      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${connection.access_token}`,
        },
      });

      const data = await this.handleHubSpotResponse(response, 'list_deals');

      if (!data.results || !Array.isArray(data.results)) {
        return [];
      }

      // Transform to option format
      return data.results.map((deal: any) => {
        const amount = deal.properties.amount ? `$${deal.properties.amount}` : '';
        const stage = deal.properties.dealstage || '';
        const description = [amount, stage].filter(Boolean).join(' - ');

        return {
          value: deal.id,
          label: deal.properties.dealname || 'Unknown Deal',
          description: description || undefined,
          icon: '💼',
          group: 'Deals',
        };
      });

    } catch (error: any) {
      this.logger.error({ err: error }, 'Error listing HubSpot deals for options');
      throw error;
    }
  }
}