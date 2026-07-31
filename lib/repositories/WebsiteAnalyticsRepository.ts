/**
 * Website Analytics Repository
 * Handles page view tracking and analytics data access
 *
 * Following the repository pattern defined in REPOSITORY_STRATEGY.md
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import crypto from 'crypto';

const logger = createLogger({ service: 'WebsiteAnalyticsRepository' });

// ==================== TYPES ====================

export interface PageView {
  id: string;
  page_id: string;
  user_id: string;
  subdomain: string;
  viewed_at: string;
  user_agent: string | null;
  referer: string | null;
  ip_hash: string | null;
  country_code: string | null;
  device_type: string | null;
  session_id: string | null;
  created_at: string;
}

export interface PageViewInsert {
  page_id: string;
  user_id: string;
  subdomain: string;
  user_agent?: string | null;
  referer?: string | null;
  ip_hash?: string | null;
  country_code?: string | null;
  device_type?: string | null;
  session_id?: string | null;
}

export interface AnalyticsSummary {
  total_views: number;
  unique_visitors: number;
  views_today: number;
  visitors_today: number;
  views_this_month: number;
  visitors_this_month: number;
  views_30d: number;
  visitors_30d: number;
  views_7d: number;
  visitors_7d: number;
}

export interface RepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Hash IP address for privacy-safe unique visitor tracking
 */
export function hashIP(ip: string, salt?: string): string {
  const saltValue = salt || process.env.IP_HASH_SALT || 'default-salt';
  return crypto
    .createHash('sha256')
    .update(ip + saltValue)
    .digest('hex')
    .substring(0, 16); // Use first 16 chars for shorter storage
}

/**
 * Detect device type from user agent
 */
export function detectDeviceType(userAgent: string | null): string {
  if (!userAgent) return 'unknown';

  const ua = userAgent.toLowerCase();

  if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
    return 'mobile';
  }
  if (ua.includes('tablet') || ua.includes('ipad')) {
    return 'tablet';
  }
  return 'desktop';
}

// ==================== REPOSITORY CLASS ====================

export class WebsiteAnalyticsRepository {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  // ==================== WRITE OPERATIONS ====================

  /**
   * Track a page view
   */
  async trackPageView(data: PageViewInsert): Promise<RepositoryResult<PageView>> {
    try {
      const { data: view, error } = await this.supabase
        .from('website_page_views')
        .insert({
          page_id: data.page_id,
          user_id: data.user_id,
          subdomain: data.subdomain,
          user_agent: data.user_agent || null,
          referer: data.referer || null,
          ip_hash: data.ip_hash || null,
          country_code: data.country_code || null,
          device_type: data.device_type || null,
          session_id: data.session_id || null
        })
        .select()
        .single();

      if (error) throw error;

      logger.debug({ subdomain: data.subdomain, pageId: data.page_id }, 'Tracked page view');
      return { data: view, error: null };
    } catch (error) {
      logger.error({ err: error, subdomain: data.subdomain }, 'Failed to track page view');
      return { data: null, error: error as Error };
    }
  }

  // ==================== READ OPERATIONS ====================

  /**
   * Get analytics summary for a user's website
   * Queries the raw table directly to avoid RLS issues with views
   */
  async getSummary(userId: string, subdomain?: string): Promise<RepositoryResult<AnalyticsSummary>> {
    try {
      // Query raw page_views table and compute stats
      let query = this.supabase
        .from('website_page_views')
        .select('viewed_at, ip_hash')
        .eq('user_id', userId);

      if (subdomain) {
        query = query.eq('subdomain', subdomain);
      }

      const { data, error } = await query;

      console.log('[Analytics Repo] Query result:', {
        dataLength: data?.length,
        error,
        userId,
        subdomain,
        firstRecord: data?.[0],
        serverTime: new Date().toISOString()
      });

      if (error) throw error;

      if (!data || data.length === 0) {
        return {
          data: {
            total_views: 0,
            unique_visitors: 0,
            views_today: 0,
            visitors_today: 0,
            views_this_month: 0,
            visitors_this_month: 0,
            views_30d: 0,
            visitors_30d: 0,
            views_7d: 0,
            visitors_7d: 0
          },
          error: null
        };
      }

      // Calculate date boundaries
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Aggregate stats
      const allIpHashes = new Set<string>();
      const todayIpHashes = new Set<string>();
      const monthIpHashes = new Set<string>();
      const thirtyDayIpHashes = new Set<string>();
      const sevenDayIpHashes = new Set<string>();

      let viewsToday = 0;
      let viewsThisMonth = 0;
      let views30d = 0;
      let views7d = 0;

      for (const view of data) {
        const viewedAt = new Date(view.viewed_at);
        const ipHash = view.ip_hash || 'unknown';

        allIpHashes.add(ipHash);

        if (viewedAt >= todayStart) {
          viewsToday++;
          todayIpHashes.add(ipHash);
        }

        if (viewedAt >= monthStart) {
          viewsThisMonth++;
          monthIpHashes.add(ipHash);
        }

        if (viewedAt >= thirtyDaysAgo) {
          views30d++;
          thirtyDayIpHashes.add(ipHash);
        }

        if (viewedAt >= sevenDaysAgo) {
          views7d++;
          sevenDayIpHashes.add(ipHash);
        }
      }

      const result = {
        total_views: data.length,
        unique_visitors: allIpHashes.size,
        views_today: viewsToday,
        visitors_today: todayIpHashes.size,
        views_this_month: viewsThisMonth,
        visitors_this_month: monthIpHashes.size,
        views_30d: views30d,
        visitors_30d: thirtyDayIpHashes.size,
        views_7d: views7d,
        visitors_7d: sevenDayIpHashes.size
      };

      console.log('[Analytics Repo] Computed stats:', result);

      return {
        data: result,
        error: null
      };
    } catch (error) {
      logger.error({ err: error, userId, subdomain }, 'Failed to get analytics summary');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get daily views for the last N days (for charts)
   */
  async getDailyViews(
    userId: string,
    subdomain: string,
    days: number = 30
  ): Promise<RepositoryResult<Array<{ date: string; views: number; visitors: number }>>> {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const { data, error } = await this.supabase
        .from('website_page_views')
        .select('viewed_at, ip_hash')
        .eq('user_id', userId)
        .eq('subdomain', subdomain)
        .gte('viewed_at', startDate.toISOString())
        .order('viewed_at', { ascending: true });

      if (error) throw error;

      // Aggregate by date
      const dailyData: Record<string, { views: number; visitors: Set<string> }> = {};

      (data || []).forEach(view => {
        const date = new Date(view.viewed_at).toISOString().split('T')[0];
        if (!dailyData[date]) {
          dailyData[date] = { views: 0, visitors: new Set() };
        }
        dailyData[date].views++;
        if (view.ip_hash) {
          dailyData[date].visitors.add(view.ip_hash);
        }
      });

      // Convert to array with all dates
      const result: Array<{ date: string; views: number; visitors: number }> = [];
      const currentDate = new Date(startDate);
      const endDate = new Date();

      while (currentDate <= endDate) {
        const dateStr = currentDate.toISOString().split('T')[0];
        result.push({
          date: dateStr,
          views: dailyData[dateStr]?.views || 0,
          visitors: dailyData[dateStr]?.visitors.size || 0
        });
        currentDate.setDate(currentDate.getDate() + 1);
      }

      return { data: result, error: null };
    } catch (error) {
      logger.error({ err: error, userId, subdomain }, 'Failed to get daily views');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get top referrers
   */
  async getTopReferrers(
    userId: string,
    subdomain: string,
    limit: number = 10
  ): Promise<RepositoryResult<Array<{ referer: string; count: number }>>> {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { data, error } = await this.supabase
        .from('website_page_views')
        .select('referer')
        .eq('user_id', userId)
        .eq('subdomain', subdomain)
        .not('referer', 'is', null)
        .neq('referer', '')
        .gte('viewed_at', thirtyDaysAgo.toISOString());

      if (error) throw error;

      // Count referrers
      const refererCounts: Record<string, number> = {};
      (data || []).forEach(view => {
        if (view.referer) {
          try {
            const url = new URL(view.referer);
            const domain = url.hostname;
            refererCounts[domain] = (refererCounts[domain] || 0) + 1;
          } catch {
            refererCounts[view.referer] = (refererCounts[view.referer] || 0) + 1;
          }
        }
      });

      // Sort and limit
      const result = Object.entries(refererCounts)
        .map(([referer, count]) => ({ referer, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);

      return { data: result, error: null };
    } catch (error) {
      logger.error({ err: error, userId, subdomain }, 'Failed to get top referrers');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get device breakdown
   */
  async getDeviceBreakdown(
    userId: string,
    subdomain: string
  ): Promise<RepositoryResult<{ desktop: number; mobile: number; tablet: number; unknown: number }>> {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { data, error } = await this.supabase
        .from('website_page_views')
        .select('device_type')
        .eq('user_id', userId)
        .eq('subdomain', subdomain)
        .gte('viewed_at', thirtyDaysAgo.toISOString());

      if (error) throw error;

      const breakdown = { desktop: 0, mobile: 0, tablet: 0, unknown: 0 };

      (data || []).forEach(view => {
        const type = view.device_type as keyof typeof breakdown;
        if (type in breakdown) {
          breakdown[type]++;
        } else {
          breakdown.unknown++;
        }
      });

      return { data: breakdown, error: null };
    } catch (error) {
      logger.error({ err: error, userId, subdomain }, 'Failed to get device breakdown');
      return { data: null, error: error as Error };
    }
  }
}

// Singleton export
let instance: WebsiteAnalyticsRepository | null = null;

export function getWebsiteAnalyticsRepository(supabase: SupabaseClient): WebsiteAnalyticsRepository {
  if (!instance) {
    instance = new WebsiteAnalyticsRepository(supabase);
  }
  return instance;
}
