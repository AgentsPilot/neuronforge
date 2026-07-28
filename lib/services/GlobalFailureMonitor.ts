/**
 * GlobalFailureMonitor
 *
 * Monitors platform-wide error patterns for early warning
 * and proactive user notification.
 *
 * Part of Phase 3: Platform Learning (Memory System Enhancement)
 *
 * PRIVACY: Aggregates error counts only. No user identification
 * or data exposure.
 *
 * @module lib/services/GlobalFailureMonitor
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ service: 'GlobalFailureMonitor' });

// ============ Types ============

export interface GlobalFailure {
  id: string;
  error_code: string;
  plugin: string;
  action: string | null;
  affected_workflows_count: number;
  severity: 'normal' | 'elevated' | 'critical';
  known_fixes: Array<{
    method: string;
    success: boolean;
    timestamp: string;
  }>;
  first_seen: string;
  last_seen: string;
}

export interface FailureAlert {
  plugin: string;
  action: string | null;
  error_code: string;
  severity: 'elevated' | 'critical';
  message: string;
  affected_count: number;
  recommended_action?: string;
}

export interface RecordFailureInput {
  errorCode: string;
  plugin: string;
  action?: string;
  recoveryMethod?: string;
  recoverySuccess?: boolean;
}

// ============ Service ============

export class GlobalFailureMonitor {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Record a failure occurrence
   *
   * Call this from StepExecutor when a step fails.
   * Updates global failure registry with aggregate counts.
   *
   * @param input - Failure details
   */
  async recordFailure(input: RecordFailureInput): Promise<void> {
    try {
      const { error } = await this.supabase.rpc('record_global_failure', {
        p_error_code: input.errorCode,
        p_plugin: input.plugin,
        p_action: input.action || null,
        p_recovery_method: input.recoveryMethod || null,
        p_recovery_success: input.recoverySuccess ?? null,
      });

      if (error) {
        logger.debug({ err: error }, 'Failed to record global failure (non-blocking)');
      }
    } catch (err) {
      // Non-blocking
      logger.debug({ err }, 'Global failure recording failed (non-blocking)');
    }
  }

  /**
   * Get active failures for a plugin
   *
   * Call this before executing steps to warn users about known issues.
   *
   * @param plugin - Plugin key
   * @param action - Optional action filter
   */
  async getActiveFailures(
    plugin: string,
    action?: string
  ): Promise<GlobalFailure[]> {
    try {
      const { data, error } = await this.supabase.rpc('get_active_failures', {
        p_plugin: plugin,
        p_action: action || null,
      });

      if (error || !data) {
        return [];
      }

      return data as GlobalFailure[];
    } catch (err) {
      logger.error({ err }, 'Failed to get active failures');
      return [];
    }
  }

  /**
   * Check if there are critical failures affecting a list of plugins
   *
   * @param plugins - List of plugins to check
   */
  async checkForAlerts(plugins: string[]): Promise<FailureAlert[]> {
    try {
      const alerts: FailureAlert[] = [];

      for (const plugin of plugins) {
        const failures = await this.getActiveFailures(plugin);

        for (const failure of failures) {
          if (failure.severity === 'elevated' || failure.severity === 'critical') {
            // Find best known fix
            const successfulFixes = failure.known_fixes
              .filter((f) => f.success)
              .map((f) => f.method);
            const recommendedAction = successfulFixes.length > 0
              ? `Try: ${successfulFixes[0]}`
              : undefined;

            alerts.push({
              plugin: failure.plugin,
              action: failure.action,
              error_code: failure.error_code,
              severity: failure.severity as 'elevated' | 'critical',
              message: this.formatAlertMessage(failure),
              affected_count: failure.affected_workflows_count,
              recommended_action: recommendedAction,
            });
          }
        }
      }

      return alerts;
    } catch (err) {
      logger.error({ err }, 'Failed to check for alerts');
      return [];
    }
  }

  /**
   * Format alerts as a warning string for user display
   */
  formatAlertsForUser(alerts: FailureAlert[]): string {
    if (alerts.length === 0) {
      return '';
    }

    const lines: string[] = ['⚠️ Platform Alerts:'];

    for (const alert of alerts) {
      const icon = alert.severity === 'critical' ? '🔴' : '🟡';
      lines.push(`${icon} ${alert.plugin}: ${alert.message}`);
      if (alert.recommended_action) {
        lines.push(`   ${alert.recommended_action}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Get platform health summary
   */
  async getHealthSummary(): Promise<{
    totalActiveFailures: number;
    criticalCount: number;
    elevatedCount: number;
    topAffectedPlugins: Array<{ plugin: string; count: number }>;
  }> {
    try {
      const { data, error } = await this.supabase
        .from('global_failure_patterns')
        .select('plugin, severity, affected_workflows_count')
        .in('status', ['active', 'investigating'])
        .gt('last_seen', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      if (error || !data) {
        return {
          totalActiveFailures: 0,
          criticalCount: 0,
          elevatedCount: 0,
          topAffectedPlugins: [],
        };
      }

      const criticalCount = data.filter((f) => f.severity === 'critical').length;
      const elevatedCount = data.filter((f) => f.severity === 'elevated').length;

      // Aggregate by plugin
      const pluginCounts: Record<string, number> = {};
      for (const f of data) {
        pluginCounts[f.plugin] =
          (pluginCounts[f.plugin] || 0) + f.affected_workflows_count;
      }

      const topAffectedPlugins = Object.entries(pluginCounts)
        .map(([plugin, count]) => ({ plugin, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      return {
        totalActiveFailures: data.length,
        criticalCount,
        elevatedCount,
        topAffectedPlugins,
      };
    } catch (err) {
      logger.error({ err }, 'Failed to get health summary');
      return {
        totalActiveFailures: 0,
        criticalCount: 0,
        elevatedCount: 0,
        topAffectedPlugins: [],
      };
    }
  }

  /**
   * Mark a failure as resolved
   */
  async markResolved(failureId: string): Promise<void> {
    try {
      await this.supabase
        .from('global_failure_patterns')
        .update({
          status: 'resolved',
          resolved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', failureId);
    } catch (err) {
      logger.error({ err }, 'Failed to mark failure as resolved');
    }
  }

  /**
   * Get best known fix for an error
   */
  async getBestFix(
    plugin: string,
    errorCode: string,
    action?: string
  ): Promise<{ method: string; successRate: number } | null> {
    try {
      const failures = await this.getActiveFailures(plugin, action);

      const matching = failures.find(
        (f) => f.error_code === errorCode && f.known_fixes.length > 0
      );

      if (!matching) {
        return null;
      }

      // Calculate success rate per method
      const methodStats: Record<string, { success: number; total: number }> = {};

      for (const fix of matching.known_fixes) {
        if (!methodStats[fix.method]) {
          methodStats[fix.method] = { success: 0, total: 0 };
        }
        methodStats[fix.method].total += 1;
        if (fix.success) {
          methodStats[fix.method].success += 1;
        }
      }

      // Find best method
      let bestMethod: string | null = null;
      let bestRate = 0;

      for (const [method, stats] of Object.entries(methodStats)) {
        const rate = stats.success / stats.total;
        if (rate > bestRate && stats.total >= 2) {
          bestMethod = method;
          bestRate = rate;
        }
      }

      if (!bestMethod) {
        return null;
      }

      return { method: bestMethod, successRate: bestRate };
    } catch (err) {
      logger.error({ err }, 'Failed to get best fix');
      return null;
    }
  }

  // ============ Private Methods ============

  private formatAlertMessage(failure: GlobalFailure): string {
    const ageHours = Math.round(
      (Date.now() - new Date(failure.first_seen).getTime()) / (1000 * 60 * 60)
    );
    const ageStr = ageHours < 1 ? 'just now' : `${ageHours}h ago`;

    return (
      `${failure.error_code} errors affecting ${failure.affected_workflows_count} workflows ` +
      `(started ${ageStr})`
    );
  }
}

// Singleton factory
let _instance: GlobalFailureMonitor | null = null;
let _lastSupabase: SupabaseClient | null = null;

export function getGlobalFailureMonitor(
  supabase: SupabaseClient
): GlobalFailureMonitor {
  if (!_instance || _lastSupabase !== supabase) {
    _instance = new GlobalFailureMonitor(supabase);
    _lastSupabase = supabase;
  }
  return _instance;
}
