// /lib/services/AuditTrailService.ts
// Centralized, enterprise-grade audit trail service
// Handles all audit logging with batching, error resilience, and compliance features

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import {
  AuditLogEntry,
  AuditLogInput,
  AuditServiceConfig,
  AuditQueryParams,
  AuditQueryResult,
  GDPRExport,
  RetentionPolicy,
  ChangeSet,
} from '../audit/types';
import { getEventMetadata } from '../audit/events';
import { generateDiff, sanitizeChanges, summarizeChanges } from '../audit/diff';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ service: 'AuditTrailService' });

/**
 * Singleton audit trail service
 * Provides centralized, non-blocking audit logging
 */
class AuditTrailService {
  private static instance: AuditTrailService;
  private supabase: SupabaseClient;
  private config: Required<AuditServiceConfig>;
  private logQueue: AuditLogEntry[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing = false;

  private constructor(config: AuditServiceConfig = {}) {
    this.supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    this.config = {
      enabled: config.enabled ?? true,
      batchSize: config.batchSize ?? 100,
      batchIntervalMs: config.batchIntervalMs ?? 5000,
      silent: config.silent ?? true, // Never throw by default
      retentionPolicy: config.retentionPolicy ?? {
        defaultDays: 365,
        criticalEventsDays: 2555, // 7 years
        gdprMaxDays: 90,
      },
      enableTamperDetection: config.enableTamperDetection ?? false,
      enableCompression: config.enableCompression ?? false,
    };

    /*
     * No timer is started here.
     *
     * The singleton is constructed at module scope (see the export at the
     * bottom), so starting an interval in the constructor meant that merely
     * IMPORTING this file began a 5-second wakeup that nothing ever cleared.
     * Anything that transitively reached it inherited a handle that keeps the
     * Node event loop alive forever — which is why every Jest run touching the
     * booking or bizql chain ended in "a worker process has failed to exit
     * gracefully", and why an idle process woke twice a minute to flush an
     * empty queue.
     *
     * The timer now starts when there is something to flush and stops when
     * there is not. See `ensureFlushTimer`.
     */
  }

  /**
   * Get singleton instance
   */
  public static getInstance(config?: AuditServiceConfig): AuditTrailService {
    if (!AuditTrailService.instance) {
      AuditTrailService.instance = new AuditTrailService(config);
    }
    return AuditTrailService.instance;
  }

  /**
   * Main logging method
   * Call this to log any auditable event
   */
  public async log(input: AuditLogInput): Promise<void> {
    if (!this.config.enabled) return;

    try {
      const entry = await this.buildLogEntry(input);
      this.logQueue.push(entry);
      // Something is now waiting, so the timer has a reason to exist.
      this.ensureFlushTimer();

      // Flush immediately if batch size reached
      if (this.logQueue.length >= this.config.batchSize) {
        await this.flush();
      }
    } catch (error) {
      this.handleError('Failed to queue audit log', error, input);
    }
  }

  /**
   * Build a complete audit log entry from input
   * Enriches with metadata, context, and compliance info
   */
  private async buildLogEntry(input: AuditLogInput): Promise<AuditLogEntry> {
    const metadata = getEventMetadata(input.action);

    // Extract request context if provided
    const context = input.request ? this.extractRequestContext(input.request) : {};

    // Sanitize sensitive data from changes
    const sanitizedChanges = input.changes
      ? sanitizeChanges(input.changes)
      : null;

    // Use system admin user ID as fallback when no user ID is provided
    // System admin is used for automated/system actions
    const systemAdminId = process.env.SYSTEM_ADMIN_USER_ID;
    const userId = input.userId || systemAdminId || null;
    const actorId = input.actorId || input.userId || systemAdminId || null;

    // Build the entry
    const entry: AuditLogEntry = {
      user_id: userId,
      actor_id: actorId,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId || null,
      resource_name: input.resourceName || null,
      changes: sanitizedChanges,
      details: {
        ...input.details,
        ...(input.changes && {
          changeSummary: summarizeChanges(input.changes),
        }),
        // Flag when system admin is used for automated actions
        ...(userId === systemAdminId && !input.userId && {
          system_action: true,
        }),
      },
      ip_address: context.ipAddress || null,
      user_agent: context.userAgent || null,
      session_id: context.sessionId || null,
      severity: input.severity || metadata.severity,
      compliance_flags: input.complianceFlags || metadata.complianceFlags || [],
      created_at: new Date().toISOString(),
    };

    // Optional: Add cryptographic hash for tamper detection
    if (this.config.enableTamperDetection) {
      entry.hash = await this.generateHash(entry);
    }

    return entry;
  }

  /**
   * Extract context from Next.js request
   */
  private extractRequestContext(request: NextRequest): {
    ipAddress?: string;
    userAgent?: string;
    sessionId?: string;
  } {
    // Extract IP address - handle both IPv4 and IPv6
    let ipAddress =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      request.headers.get('x-real-ip') ||
      request.ip ||
      undefined;

    // Convert IPv6 localhost to IPv4 for consistency
    if (ipAddress === '::1' || ipAddress === '::ffff:127.0.0.1') {
      ipAddress = '127.0.0.1';
    }

    const userAgent = request.headers.get('user-agent') || undefined;

    // Extract session ID from multiple sources
    // Priority: Supabase auth cookie > custom session cookie > header
    const sessionId =
      request.cookies.get('sb-access-token')?.value ||
      request.cookies.get('sb-refresh-token')?.value ||
      request.cookies.get('session_id')?.value ||
      request.headers.get('x-session-id') ||
      request.headers.get('authorization')?.substring(0, 32) || // First 32 chars of auth token
      undefined;

    return { ipAddress, userAgent, sessionId };
  }

  /**
   * Generate cryptographic hash for tamper detection
   */
  private async generateHash(entry: AuditLogEntry): Promise<string> {
    const data = JSON.stringify({
      user_id: entry.user_id,
      action: entry.action,
      entity_id: entry.entity_id,
      created_at: entry.created_at,
      changes: entry.changes,
    });

    // Simple hash using Web Crypto API
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Flush queued logs to database
   */
  public async flush(): Promise<void> {
    if (this.isFlushing || this.logQueue.length === 0) return;

    this.isFlushing = true;

    try {
      const logsToWrite = [...this.logQueue];
      this.logQueue = []; // Clear queue immediately

      const { error } = await this.supabase
        .from('audit_trail')
        .insert(logsToWrite);

      if (error) {
        throw error;
      }

      logger.debug({ count: logsToWrite.length }, 'Flushed audit logs');
    } catch (error) {
      this.handleError('Failed to flush audit logs', error);
    } finally {
      this.isFlushing = false;

      /*
       * Nothing left to flush means nothing left to wake up for.
       *
       * Reached on the failure path too, and deliberately: the queue is cleared
       * before the insert, so a failed write loses those entries either way and
       * leaving the timer running would not bring them back — it would only
       * keep the process awake on behalf of an empty queue.
       */
      if (this.logQueue.length === 0) {
        this.stopFlushTimer();
      }
    }
  }

  /**
   * Run the flush timer while — and only while — something is queued.
   *
   * Idempotent: called on every queued entry, starts at most one interval.
   */
  private ensureFlushTimer(): void {
    if (!this.config.enabled || this.flushTimer) return;

    this.flushTimer = setInterval(() => {
      void this.flush();
    }, this.config.batchIntervalMs);

    /*
     * Unreferenced as well as lazy.
     *
     * Lazy start means an idle process holds no handle at all; `unref` covers
     * the remaining window, where entries are queued and the process would
     * otherwise be free to exit. It does not stop the timer firing — anything
     * else keeping the loop alive, which for a server is the HTTP listener,
     * keeps it ticking — it only stops a pending audit flush from being the
     * one thing preventing shutdown.
     *
     * Nothing is lost by that: `beforeExit` below flushes whatever is still
     * queued. Guarded because `unref` is a Node timer method and this module is
     * also reachable from runtimes without it.
     */
    this.flushTimer.unref?.();
  }

  /**
   * Stop auto-flush timer
   */
  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Query audit logs with advanced filtering
   */
  public async query(params: AuditQueryParams): Promise<AuditQueryResult> {
    const page = params.page || 1;
    const limit = params.limit || 50;
    const offset = (page - 1) * limit;

    let query = this.supabase
      .from('audit_trail')
      .select('*', { count: 'exact' });

    // Apply filters
    if (params.userId) {
      query = query.eq('user_id', params.userId);
    }

    if (params.actorId) {
      query = query.eq('actor_id', params.actorId);
    }

    if (params.action) {
      if (Array.isArray(params.action)) {
        query = query.in('action', params.action);
      } else {
        query = query.eq('action', params.action);
      }
    }

    if (params.entityType) {
      if (Array.isArray(params.entityType)) {
        query = query.in('entity_type', params.entityType);
      } else {
        query = query.eq('entity_type', params.entityType);
      }
    }

    if (params.entityId) {
      query = query.eq('entity_id', params.entityId);
    }

    if (params.severity) {
      if (Array.isArray(params.severity)) {
        query = query.in('severity', params.severity);
      } else {
        query = query.eq('severity', params.severity);
      }
    }

    if (params.dateFrom) {
      const date = typeof params.dateFrom === 'string'
        ? params.dateFrom
        : params.dateFrom.toISOString();
      query = query.gte('created_at', date);
    }

    if (params.dateTo) {
      const date = typeof params.dateTo === 'string'
        ? params.dateTo
        : params.dateTo.toISOString();
      query = query.lte('created_at', date);
    }

    // Sorting
    const sortBy = params.sortBy || 'created_at';
    const sortOrder = params.sortOrder || 'desc';
    query = query.order(sortBy, { ascending: sortOrder === 'asc' });

    // Pagination
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      throw new Error(`Failed to query audit logs: ${error.message}`);
    }

    return {
      logs: data || [],
      total: count || 0,
      page,
      limit,
      hasMore: (count || 0) > offset + limit,
    };
  }

  /**
   * Export user data for GDPR compliance (Article 20)
   */
  public async exportUserData(userId: string): Promise<GDPRExport> {
    const { data, error } = await this.supabase
      .from('audit_trail')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to export user data: ${error.message}`);
    }

    const logs = data || [];

    // Generate summary
    const actionsPerformed: Record<string, number> = {};
    const entitiesModified: Record<string, number> = {};

    for (const log of logs) {
      actionsPerformed[log.action] = (actionsPerformed[log.action] || 0) + 1;
      entitiesModified[log.entity_type] = (entitiesModified[log.entity_type] || 0) + 1;
    }

    const dateRange = logs.length > 0
      ? {
          from: logs[logs.length - 1].created_at,
          to: logs[0].created_at,
        }
      : { from: new Date().toISOString(), to: new Date().toISOString() };

    return {
      userId,
      exportedAt: new Date().toISOString(),
      totalEvents: logs.length,
      dateRange,
      logs,
      summary: {
        actionsPerformed,
        entitiesModified,
      },
    };
  }

  /**
   * Anonymize user data for GDPR compliance (Right to erasure)
   */
  public async anonymizeUserData(userId: string): Promise<number> {
    const { data, error } = await this.supabase
      .from('audit_trail')
      .update({
        user_id: null,
        actor_id: null,
        ip_address: null,
        user_agent: null,
        session_id: null,
        details: { anonymized: true },
      })
      .eq('user_id', userId)
      .select('id');

    if (error) {
      throw new Error(`Failed to anonymize user data: ${error.message}`);
    }

    const count = data?.length || 0;

    // Log the anonymization
    await this.log({
      action: 'DATA_ANONYMIZED',
      entityType: 'user',
      entityId: userId,
      userId: null, // System action
      details: {
        recordsAnonymized: count,
        reason: 'GDPR Right to Erasure (Article 17)',
      },
      severity: 'critical',
      complianceFlags: ['GDPR'],
    });

    return count;
  }

  /**
   * Apply retention policy - delete old logs
   */
  public async applyRetentionPolicy(policy?: RetentionPolicy): Promise<number> {
    const retentionPolicy = policy || this.config.retentionPolicy;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionPolicy.defaultDays);

    const { data, error } = await this.supabase
      .from('audit_trail')
      .delete()
      .lt('created_at', cutoffDate.toISOString())
      .neq('severity', 'critical') // Keep critical events longer
      .select('id');

    if (error) {
      throw new Error(`Failed to apply retention policy: ${error.message}`);
    }

    return data?.length || 0;
  }

  /**
   * Handle errors silently (if configured)
   */
  private handleError(message: string, error: unknown, context?: any): void {
    // `context` is an AuditLogInput and stays structured rather than being
    // stringified into the message, so a failed audit write is searchable by
    // the same fields as a successful one.
    logger.error({ err: error, context }, message);

    if (!this.config.silent) {
      throw error;
    }
  }

  /**
   * Graceful shutdown - flush remaining logs
   */
  public async shutdown(): Promise<void> {
    this.stopFlushTimer();
    await this.flush();
  }
}

// Export singleton instance
export const AuditTrail = AuditTrailService.getInstance();

/*
 * Flush on the way out.
 *
 * The timer is unreferenced, so a process with queued entries is free to exit
 * before the next tick. `beforeExit` fires when the loop has nothing left to
 * do, which is exactly that moment, and the flush it triggers gives the loop
 * more work — so the entries are written and the process then exits normally.
 *
 * Registered once, and only where `process` exists. It does NOT fire on
 * `process.exit()` or on a signal; those paths should call `shutdown()`, which
 * stops the timer and flushes explicitly.
 */
if (typeof process !== 'undefined' && typeof process.once === 'function') {
  process.once('beforeExit', () => {
    void AuditTrail.flush();
  });
}

// Export class for testing
export { AuditTrailService };

// Convenience methods for common operations
export const auditLog = (input: AuditLogInput) => AuditTrail.log(input);
export const auditQuery = (params: AuditQueryParams) => AuditTrail.query(params);
export const auditFlush = () => AuditTrail.flush();
