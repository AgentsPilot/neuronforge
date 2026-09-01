import { BasePluginExecutor } from './base-plugin-executor';
import { UserPluginConnections } from './user-plugin-connections';
import { PluginManagerV2 } from './plugin-manager-v2';
import { createLogger } from '@/lib/logger';

const pluginName = 'google-business-profile';
const ACCOUNT_API = 'https://mybusinessaccountmanagement.googleapis.com/v1';
const INFO_API = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const PERFORMANCE_API = 'https://businessprofileperformance.googleapis.com/v1';

/**
 * Read-only Google Business Profile.
 *
 * Google split what used to be one "My Business" API into several narrower ones,
 * so a single logical operation spans hosts: accounts come from the Account
 * Management API, locations from the Business Information API, and metrics from
 * the Business Profile Performance API. The older v4 Insights endpoint this
 * replaced is gone; do not reintroduce it.
 */
export class GoogleBusinessProfilePluginExecutor extends BasePluginExecutor {
  protected logger = createLogger({ module: 'PluginExecutor' }).child({ plugin: pluginName });

  constructor(userConnections: UserPluginConnections, pluginManager: PluginManagerV2) {
    super(pluginName, userConnections, pluginManager);
  }

  /**
   * Turn Google's answer into something that names the real cause.
   *
   * Google ships the Business Profile APIs with a quota of ZERO until an access
   * request is approved, so the first call of the day returns 429 /
   * RESOURCE_EXHAUSTED with "Quota exceeded ... Requests per minute". The base
   * executor matched `quota` and flattened that to "Rate limit exceeded. Please
   * try again later." — advice that can never come true, since there is no
   * limit being exceeded and waiting changes nothing.
   *
   * Distinguished by the service name: one list_locations call cannot exhaust a
   * genuine per-minute quota, so on these APIs the message means access, not
   * volume. Returning null for everything else leaves the base mapping intact.
   */
  protected mapPluginSpecificError(error: any, commonErrors: Record<string, string>): string | null {
    const message = error?.message || '';
    const quotaGatedService = /mybusiness[a-z]*\.googleapis\.com|businessprofileperformance\.googleapis\.com/i;

    if (/quota exceeded|RESOURCE_EXHAUSTED/i.test(message) && quotaGatedService.test(message)) {
      return 'Business Profile API access has not been granted for this Google Cloud project yet.';
    }

    return null;
  }

  protected async executeSpecificAction(
    connection: any,
    actionName: string,
    parameters: any
  ): Promise<any> {
    this.logger.debug({ actionName }, 'Executing Google Business Profile action');

    switch (actionName) {
      case 'list_locations':
        return this.listLocations(connection);
      case 'get_location_metrics':
        return this.getLocationMetrics(connection, parameters);
      default:
        throw new Error(`Unknown action: ${actionName}`);
    }
  }

  private async listLocations(connection: any): Promise<any> {
    const accountsResponse = await this.request(connection, `${ACCOUNT_API}/accounts`);
    const accounts = accountsResponse.accounts || [];

    const locations: Array<{
      id: string;
      title: string;
      address: string;
      account_name: string;
    }> = [];

    for (const account of accounts) {
      // readMask is mandatory on this endpoint — omitting it is a 400, not a
      // default-everything response.
      const url =
        `${INFO_API}/${account.name}/locations` +
        `?readMask=name,title,storefrontAddress&pageSize=100`;

      try {
        const response = await this.request(connection, url);
        for (const location of response.locations || []) {
          locations.push({
            id: String(location.name || '').replace('locations/', ''),
            title: location.title || '',
            address: this.formatAddress(location.storefrontAddress),
            account_name: account.name,
          });
        }
      } catch (error) {
        // One inaccessible account must not hide the locations of the others.
        this.logger.warn(
          { err: error, account: account.name },
          'Could not list locations for account'
        );
      }
    }

    return {
      locations,
      location_count: locations.length,
      retrieved_at: new Date().toISOString(),
    };
  }

  private async getLocationMetrics(connection: any, params: any): Promise<any> {
    const { location_id, since, until } = params;

    // Google excludes the current day entirely, so the default window ends
    // yesterday. Asking for today returns nothing and looks like a failure.
    const end = until ? new Date(until) : new Date(Date.now() - 86400000);
    const start = since ? new Date(since) : new Date(end.getTime() - 30 * 86400000);

    const metrics = [
      'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
      'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
      'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
      'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
      'WEBSITE_CLICKS',
      'CALL_CLICKS',
      'BUSINESS_DIRECTION_REQUESTS',
    ];

    const query = new URLSearchParams();
    for (const metric of metrics) query.append('dailyMetrics', metric);
    query.set('dailyRange.start_date.year', String(start.getUTCFullYear()));
    query.set('dailyRange.start_date.month', String(start.getUTCMonth() + 1));
    query.set('dailyRange.start_date.day', String(start.getUTCDate()));
    query.set('dailyRange.end_date.year', String(end.getUTCFullYear()));
    query.set('dailyRange.end_date.month', String(end.getUTCMonth() + 1));
    query.set('dailyRange.end_date.day', String(end.getUTCDate()));

    const response = await this.request(
      connection,
      `${PERFORMANCE_API}/locations/${location_id}:fetchMultiDailyMetricsTimeSeries?${query.toString()}`
    );

    const byDate = new Map<string, Record<string, number | string>>();

    for (const series of response.multiDailyMetricTimeSeries || []) {
      for (const metricSeries of series.dailyMetricTimeSeries || []) {
        const metricName = metricSeries.dailyMetric;

        for (const point of metricSeries.timeSeries?.datedValues || []) {
          const date = this.toIsoDate(point.date);
          if (!date) continue;

          const row = byDate.get(date) || {
            date,
            impressions: 0,
            website_clicks: 0,
            actions_calls: 0,
            actions_directions: 0,
          };

          // Google omits `value` entirely for a zero day rather than sending 0.
          const value = Number(point.value ?? 0) || 0;

          if (metricName?.startsWith('BUSINESS_IMPRESSIONS_')) {
            // The four impression metrics are Search/Maps x desktop/mobile.
            // Summing them gives the total the listing was shown.
            row.impressions = (row.impressions as number) + value;
          } else if (metricName === 'WEBSITE_CLICKS') {
            row.website_clicks = value;
          } else if (metricName === 'CALL_CLICKS') {
            row.actions_calls = value;
          } else if (metricName === 'BUSINESS_DIRECTION_REQUESTS') {
            row.actions_directions = value;
          }

          byDate.set(date, row);
        }
      }
    }

    const days = [...byDate.values()].sort((a, b) =>
      String(a.date).localeCompare(String(b.date))
    );

    return {
      location_id: String(location_id),
      days,
      retrieved_at: new Date().toISOString(),
    };
  }

  private toIsoDate(date: { year?: number; month?: number; day?: number } | undefined): string {
    if (!date?.year || !date?.month || !date?.day) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
  }

  private formatAddress(address: any): string {
    if (!address) return '';
    return [address.locality, address.administrativeArea, address.regionCode]
      .filter(Boolean)
      .join(', ');
  }

  private async request(connection: any, url: string): Promise<any> {
    const accessToken = connection.access_token;
    if (!accessToken) {
      throw new Error('Google connection is missing an access token. Please reconnect in Settings.');
    }

    this.logger.debug({ url }, 'Making Google Business Profile request');

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    if (!response.ok) {
      const apiError = data?.error;

      // These APIs are disabled by default on a Cloud project and need a quota
      // request to enable. That failure is indistinguishable from a permission
      // problem unless it is named.
      if (response.status === 403 && /disabled|not been used/i.test(apiError?.message || '')) {
        throw new Error(
          `The Google Business Profile APIs are not enabled for this Google Cloud project. ${apiError?.message}`
        );
      }

      this.logger.error(
        { status: response.status, code: apiError?.code, reason: apiError?.status },
        'Google Business Profile request failed'
      );
      throw new Error(apiError?.message || `Business Profile API error: ${response.status}`);
    }

    return data;
  }
}
