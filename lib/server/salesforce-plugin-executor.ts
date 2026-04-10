import { BasePluginExecutor } from './base-plugin-executor';
import { UserPluginConnections } from './user-plugin-connections';
import { PluginManagerV2 } from './plugin-manager-v2';
import pino from 'pino';

const pluginName = 'salesforce';

export class SalesforcePluginExecutor extends BasePluginExecutor {
  protected logger = pino({ name: `${pluginName}-plugin-executor` });

  constructor(userConnections: UserPluginConnections, pluginManager: PluginManagerV2) {
    super(pluginName, userConnections, pluginManager);
  }

  protected async executeSpecificAction(connection: any, actionName: string, parameters: any): Promise<any> {
    this.logger.debug({ actionName, params: parameters }, 'Executing Salesforce action');

    switch (actionName) {
      case 'create_lead':
        return this.createLead(connection, parameters);
      case 'query_leads':
        return this.queryLeads(connection, parameters);
      case 'update_lead':
        return this.updateLead(connection, parameters);
      case 'create_account':
        return this.createAccount(connection, parameters);
      case 'query_accounts':
        return this.queryAccounts(connection, parameters);
      case 'create_contact':
        return this.createContact(connection, parameters);
      case 'query_contacts':
        return this.queryContacts(connection, parameters);
      case 'create_opportunity':
        return this.createOpportunity(connection, parameters);
      case 'query_opportunities':
        return this.queryOpportunities(connection, parameters);
      default:
        throw new Error(`Unknown action: ${actionName}`);
    }
  }

  private async createLead(connection: any, params: any): Promise<any> {
    const { first_name, last_name, email, company, phone, status, lead_source } = params;

    const payload: any = {
      LastName: last_name,
      Company: company,
    };

    if (first_name) payload.FirstName = first_name;
    if (email) payload.Email = email;
    if (phone) payload.Phone = phone;
    if (status) payload.Status = status;
    if (lead_source) payload.LeadSource = lead_source;

    const response = await this.makeSalesforceRequest(
      connection,
      '/sobjects/Lead',
      'POST',
      payload
    );

    return {
      id: response.id,
      first_name,
      last_name,
      email,
      company,
      status: status || 'Open - Not Contacted',
      created_at: new Date().toISOString(),
    };
  }

  private async queryLeads(connection: any, params: any): Promise<any> {
    const { email, company, status, created_date, limit = 100 } = params;

    const conditions: string[] = [];

    if (email) conditions.push(`Email = '${this.escapeSoql(email)}'`);
    if (company) conditions.push(`Company LIKE '%${this.escapeSoql(company)}%'`);
    if (status) conditions.push(`Status = '${this.escapeSoql(status)}'`);
    if (created_date) conditions.push(`CreatedDate >= ${created_date}T00:00:00Z`);

    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const query = `SELECT Id, FirstName, LastName, Email, Company, Phone, Status, CreatedDate FROM Lead${whereClause} LIMIT ${limit}`;

    const response = await this.makeSalesforceRequest(
      connection,
      `/query?q=${encodeURIComponent(query)}`,
      'GET'
    );

    return {
      leads: response.records.map((record: any) => ({
        id: record.Id,
        first_name: record.FirstName,
        last_name: record.LastName,
        email: record.Email,
        company: record.Company,
        phone: record.Phone,
        status: record.Status,
        created_date: record.CreatedDate ? record.CreatedDate.split('T')[0] : null,
      })),
      lead_count: response.records.length,
      searched_at: new Date().toISOString(),
    };
  }

  private async updateLead(connection: any, params: any): Promise<any> {
    const { lead_id, first_name, last_name, email, phone, status, company } = params;

    const payload: any = {};

    if (first_name !== undefined) payload.FirstName = first_name;
    if (last_name !== undefined) payload.LastName = last_name;
    if (email !== undefined) payload.Email = email;
    if (phone !== undefined) payload.Phone = phone;
    if (status !== undefined) payload.Status = status;
    if (company !== undefined) payload.Company = company;

    await this.makeSalesforceRequest(
      connection,
      `/sobjects/Lead/${lead_id}`,
      'PATCH',
      payload
    );

    return {
      id: lead_id,
      success: true,
      updated_at: new Date().toISOString(),
    };
  }

  private async createAccount(connection: any, params: any): Promise<any> {
    const { name, phone, website, industry, type, billing_city, billing_country } = params;

    const payload: any = {
      Name: name,
    };

    if (phone) payload.Phone = phone;
    if (website) payload.Website = website;
    if (industry) payload.Industry = industry;
    if (type) payload.Type = type;
    if (billing_city) payload.BillingCity = billing_city;
    if (billing_country) payload.BillingCountry = billing_country;

    const response = await this.makeSalesforceRequest(
      connection,
      '/sobjects/Account',
      'POST',
      payload
    );

    return {
      id: response.id,
      name,
      type,
      industry,
      website,
      created_at: new Date().toISOString(),
    };
  }

  private async queryAccounts(connection: any, params: any): Promise<any> {
    const { name, industry, type, limit = 100 } = params;

    const conditions: string[] = [];

    if (name) conditions.push(`Name LIKE '%${this.escapeSoql(name)}%'`);
    if (industry) conditions.push(`Industry = '${this.escapeSoql(industry)}'`);
    if (type) conditions.push(`Type = '${this.escapeSoql(type)}'`);

    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const query = `SELECT Id, Name, Phone, Website, Industry, Type FROM Account${whereClause} LIMIT ${limit}`;

    const response = await this.makeSalesforceRequest(
      connection,
      `/query?q=${encodeURIComponent(query)}`,
      'GET'
    );

    return {
      accounts: response.records.map((record: any) => ({
        id: record.Id,
        name: record.Name,
        phone: record.Phone,
        website: record.Website,
        industry: record.Industry,
        type: record.Type,
      })),
      account_count: response.records.length,
      searched_at: new Date().toISOString(),
    };
  }

  private async createContact(connection: any, params: any): Promise<any> {
    const { first_name, last_name, email, phone, account_id, title } = params;

    const payload: any = {
      LastName: last_name,
    };

    if (first_name) payload.FirstName = first_name;
    if (email) payload.Email = email;
    if (phone) payload.Phone = phone;
    if (account_id) payload.AccountId = account_id;
    if (title) payload.Title = title;

    const response = await this.makeSalesforceRequest(
      connection,
      '/sobjects/Contact',
      'POST',
      payload
    );

    return {
      id: response.id,
      first_name,
      last_name,
      email,
      account_id,
      created_at: new Date().toISOString(),
    };
  }

  private async queryContacts(connection: any, params: any): Promise<any> {
    const { email, last_name, account_id, limit = 100 } = params;

    const conditions: string[] = [];

    if (email) conditions.push(`Email = '${this.escapeSoql(email)}'`);
    if (last_name) conditions.push(`LastName LIKE '%${this.escapeSoql(last_name)}%'`);
    if (account_id) conditions.push(`AccountId = '${this.escapeSoql(account_id)}'`);

    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const query = `SELECT Id, FirstName, LastName, Email, Phone, AccountId, Title FROM Contact${whereClause} LIMIT ${limit}`;

    const response = await this.makeSalesforceRequest(
      connection,
      `/query?q=${encodeURIComponent(query)}`,
      'GET'
    );

    return {
      contacts: response.records.map((record: any) => ({
        id: record.Id,
        first_name: record.FirstName,
        last_name: record.LastName,
        email: record.Email,
        phone: record.Phone,
        account_id: record.AccountId,
        title: record.Title,
      })),
      contact_count: response.records.length,
      searched_at: new Date().toISOString(),
    };
  }

  private async createOpportunity(connection: any, params: any): Promise<any> {
    const { name, account_id, amount, close_date, stage, probability, description } = params;

    const payload: any = {
      Name: name,
      CloseDate: close_date,
      StageName: stage,
    };

    if (account_id) payload.AccountId = account_id;
    if (amount !== undefined) payload.Amount = amount;
    if (probability !== undefined) payload.Probability = probability;
    if (description) payload.Description = description;

    const response = await this.makeSalesforceRequest(
      connection,
      '/sobjects/Opportunity',
      'POST',
      payload
    );

    return {
      id: response.id,
      name,
      amount,
      stage,
      close_date,
      account_id,
      created_at: new Date().toISOString(),
    };
  }

  private async queryOpportunities(connection: any, params: any): Promise<any> {
    const { account_id, stage, close_date_from, close_date_to, limit = 100 } = params;

    const conditions: string[] = [];

    if (account_id) conditions.push(`AccountId = '${this.escapeSoql(account_id)}'`);
    if (stage) conditions.push(`StageName = '${this.escapeSoql(stage)}'`);
    if (close_date_from) conditions.push(`CloseDate >= ${close_date_from}`);
    if (close_date_to) conditions.push(`CloseDate <= ${close_date_to}`);

    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const query = `SELECT Id, Name, Amount, StageName, CloseDate, AccountId, Probability FROM Opportunity${whereClause} LIMIT ${limit}`;

    const response = await this.makeSalesforceRequest(
      connection,
      `/query?q=${encodeURIComponent(query)}`,
      'GET'
    );

    const opportunities = response.records.map((record: any) => ({
      id: record.Id,
      name: record.Name,
      amount: record.Amount,
      stage: record.StageName,
      close_date: record.CloseDate,
      account_id: record.AccountId,
      probability: record.Probability,
    }));

    const totalAmount = opportunities.reduce((sum: number, opp: any) => sum + (opp.amount || 0), 0);

    return {
      opportunities,
      opportunity_count: response.records.length,
      total_amount: totalAmount,
      searched_at: new Date().toISOString(),
    };
  }

  private async makeSalesforceRequest(
    connection: any,
    endpoint: string,
    method: string,
    body?: any
  ): Promise<any> {
    const accessToken = connection.access_token;
    const instanceUrl = connection.instance_url || 'https://login.salesforce.com';

    // Construct the full API URL
    const apiVersion = 'v59.0'; // Latest API version as of 2024
    const url = `${instanceUrl}/services/data/${apiVersion}${endpoint}`;

    const options: RequestInit = {
      method,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    };

    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      options.body = JSON.stringify(body);
    }

    this.logger.debug({ url, method }, 'Making Salesforce API request');

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error({ status: response.status, error: errorText }, 'Salesforce API error');
      throw new Error(`Salesforce API error: ${response.status} - ${errorText}`);
    }

    // PATCH requests return 204 No Content on success
    if (response.status === 204) {
      return {};
    }

    return response.json();
  }

  private escapeSoql(value: string): string {
    // Escape single quotes for SOQL
    return value.replace(/'/g, "\\'");
  }
}
