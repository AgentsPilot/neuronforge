import { BasePluginExecutor } from './base-plugin-executor';
import { UserPluginConnections } from './user-plugin-connections';
import { PluginManagerV2 } from './plugin-manager-v2';
import { createLogger } from '@/lib/logger';

const pluginName = 'google-analytics';
const ADMIN_API = 'https://analyticsadmin.googleapis.com/v1beta';
const DATA_API = 'https://analyticsdata.googleapis.com/v1beta';

/**
 * Read-only Google Analytics 4.
 *
 * Two APIs are involved: the Admin API lists what the user can read, and the
 * Data API runs reports. Both are plain REST with a bearer token, which is why
 * GA4 is far cheaper to support than Google Ads (developer token, GAQL, and a
 * streaming response format).
 *
 * Dimensions and metrics are validated against the definition's enums before a
 * request goes out. GA4 will happily accept arbitrary report shapes; exposing
 * that to an LLM-driven caller invites both nonsense reports and quota burn.
 */
export class GoogleAnalyticsPluginExecutor extends BasePluginExecutor {
  protected logger = createLogger({ module: 'PluginExecutor' }).child({ plugin: pluginName });

  constructor(userConnections: UserPluginConnections, pluginManager: PluginManagerV2) {
    super(pluginName, userConnections, pluginManager);
  }

  protected async executeSpecificAction(
    connection: any,
    actionName: string,
    parameters: any
  ): Promise<any> {
    this.logger.debug({ actionName }, 'Executing Google Analytics action');

    switch (actionName) {
      case 'list_properties':
        return this.listProperties(connection);
      case 'run_report':
        return this.runReport(connection, parameters);
      default:
        throw new Error(`Unknown action: ${actionName}`);
    }
  }

  private async listProperties(connection: any): Promise<any> {
    // accountSummaries returns accounts and their properties in one call, which
    // is what the account picker needs — no per-account fan-out.
    const response = await this.request(connection, `${ADMIN_API}/accountSummaries?pageSize=200`);

    const properties: Array<{ id: string; display_name: string; account_name: string }> = [];

    for (const account of response.accountSummaries || []) {
      for (const property of account.propertySummaries || []) {
        properties.push({
          // Comes back as "properties/401234567"; callers want the bare ID.
          id: String(property.property || '').replace('properties/', ''),
          display_name: property.displayName || '',
          account_name: account.displayName || '',
        });
      }
    }

    return {
      properties,
      property_count: properties.length,
      retrieved_at: new Date().toISOString(),
    };
  }

  private async runReport(connection: any, params: any): Promise<any> {
    const {
      property_id,
      since,
      until,
      dimensions = ['date'],
      metrics = ['sessions', 'activeUsers', 'screenPageViews'],
    } = params;

    const startDate = since || this.isoDate(new Date(Date.now() - 30 * 86400000));
    const endDate = until || this.isoDate(new Date());

    const body = {
      dateRanges: [{ startDate, endDate }],
      dimensions: dimensions.map((name: string) => ({ name })),
      metrics: metrics.map((name: string) => ({ name })),
      limit: 10000,
    };

    const response = await this.request(
      connection,
      `${DATA_API}/properties/${property_id}:runReport`,
      'POST',
      body
    );

    // GA4 returns dimension and metric values as parallel arrays with headers
    // held separately. Zip them into named keys so callers don't index by
    // position, which silently breaks the moment a dimension is added.
    const dimensionHeaders = (response.dimensionHeaders || []).map((h: any) => h.name);
    const metricHeaders = (response.metricHeaders || []).map((h: any) => h.name);

    const rows = (response.rows || []).map((row: any) => {
      const entry: Record<string, string | number> = {};

      dimensionHeaders.forEach((name: string, index: number) => {
        const value = row.dimensionValues?.[index]?.value ?? '';
        // GA4's date dimension is YYYYMMDD; everything downstream expects ISO.
        entry[name] = name === 'date' ? this.toIsoFromCompact(value) : value;
      });

      metricHeaders.forEach((name: string, index: number) => {
        entry[name] = Number(row.metricValues?.[index]?.value ?? 0) || 0;
      });

      return entry;
    });

    return {
      property_id: String(property_id),
      rows,
      row_count: rows.length,
      retrieved_at: new Date().toISOString(),
    };
  }

  private toIsoFromCompact(value: string): string {
    if (!/^\d{8}$/.test(value)) return value;
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }

  private isoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private async request(
    connection: any,
    url: string,
    method: 'GET' | 'POST' = 'GET',
    body?: unknown
  ): Promise<any> {
    const accessToken = connection.access_token;
    if (!accessToken) {
      throw new Error('Google connection is missing an access token. Please reconnect in Settings.');
    }

    // The token travels in the Authorization header, so unlike the Meta Graph
    // API the URL is safe to log.
    this.logger.debug({ url, method }, 'Making Google Analytics request');

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const data = await response.json();

    if (!response.ok) {
      const apiError = data?.error;
      this.logger.error(
        { status: response.status, code: apiError?.code, reason: apiError?.status },
        'Google Analytics request failed'
      );
      throw new Error(apiError?.message || `Google Analytics API error: ${response.status}`);
    }

    return data;
  }
}
