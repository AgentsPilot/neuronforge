/**
 * ApprovalTracker - Manages human approval requests and responses
 *
 * Responsibilities:
 * - Create and track approval requests
 * - Store/retrieve approval requests from database
 * - Check approval status (approved, rejected, pending)
 * - Handle timeout logic
 * - Manage escalations
 *
 * Phase 6: Human-in-the-Loop
 *
 * @module lib/pilot/ApprovalTracker
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type { ApprovalRequest, ApprovalResponse } from './types';
import { ExecutionError } from './types';
import { auditLog } from '../services/AuditTrailService';
import { AUDIT_EVENTS } from '../audit/events';

export class ApprovalTracker {
  private supabase: SupabaseClient;
  private userId: string | null = null;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
    // Get current user for audit logging
    this.initializeUser();
  }

  private async initializeUser() {
    try {
      const { data: { user } } = await this.supabase.auth.getUser();
      this.userId = user?.id || null;
    } catch (error) {
      console.warn('[ApprovalTracker] Could not get current user for audit logging');
    }
  }

  /**
   * Create a new approval request
   */
  async createApprovalRequest(
    executionId: string,
    stepId: string,
    config: {
      approvers: string[];
      approvalType: 'any' | 'all' | 'majority';
      title: string;
      message?: string;
      context?: Record<string, any>;
      timeout?: number;
      timeoutAction?: 'approve' | 'reject' | 'escalate';
      escalateTo?: string[];
    }
  ): Promise<ApprovalRequest> {
    console.log(`✋ [ApprovalTracker] Creating approval request for ${stepId}`);

    const approvalId = `approval_${executionId}_${stepId}_${Date.now()}`;
    const now = new Date().toISOString();
    const expiresAt = config.timeout
      ? new Date(Date.now() + config.timeout).toISOString()
      : undefined;

    const approvalRequest: ApprovalRequest = {
      id: approvalId,
      executionId,
      stepId,
      approvers: config.approvers,
      approvalType: config.approvalType,
      title: config.title,
      message: config.message,
      context: config.context || {},
      status: 'pending',
      createdAt: now,
      expiresAt,
      responses: [],
      timeoutAction: config.timeoutAction,
      escalatedTo: config.escalateTo,
    };

    // Store in database
    const { error } = await this.supabase
      .from('workflow_approval_requests')
      .insert({
        id: approvalId,
        execution_id: executionId,
        step_id: stepId,
        approvers: config.approvers,
        approval_type: config.approvalType,
        title: config.title,
        message: config.message,
        context: config.context || {},
        status: 'pending',
        created_at: now,
        expires_at: expiresAt,
        timeout_action: config.timeoutAction,
        escalated_to: config.escalateTo,
      });

    if (error) {
      console.error(`❌ [ApprovalTracker] Failed to create approval request:`, error);
      throw new ExecutionError(
        `Failed to create approval request: ${error.message}`,
        'APPROVAL_REQUEST_CREATION_FAILED',
        stepId
      );
    }

    // Log audit event
    await auditLog({
      action: AUDIT_EVENTS.APPROVAL_REQUESTED,
      userId: this.userId || 'system',
      entityType: 'execution',
      entityId: approvalId,
      resourceName: config.title,
      details: {
        approvalId,
        executionId,
        stepId,
        title: config.title,
        approvers: config.approvers,
        approvalType: config.approvalType,
        timeout: config.timeout,
        timeoutAction: config.timeoutAction,
      },
    });

    console.log(`✅ [ApprovalTracker] Approval request created: ${approvalId}`);
    return approvalRequest;
  }

  /**
   * Get approval request by ID
   */
  async getApprovalRequest(approvalId: string): Promise<ApprovalRequest | null> {
    const { data, error } = await this.supabase
      .from('workflow_approval_requests')
      .select('*')
      .eq('id', approvalId)
      .single();

    if (error || !data) {
      console.warn(`⚠️  [ApprovalTracker] Approval request not found: ${approvalId}`);
      return null;
    }

    // Get responses
    const { data: responses } = await this.supabase
      .from('workflow_approval_responses')
      .select('*')
      .eq('approval_id', approvalId)
      .order('responded_at', { ascending: true });

    return {
      id: data.id,
      executionId: data.execution_id,
      stepId: data.step_id,
      approvers: data.approvers,
      approvalType: data.approval_type,
      title: data.title,
      message: data.message,
      context: data.context || {},
      status: data.status,
      createdAt: data.created_at,
      expiresAt: data.expires_at,
      responses: (responses || []).map(r => ({
        approverId: r.approver_id,
        decision: r.decision,
        comment: r.comment,
        respondedAt: r.responded_at,
        delegatedFrom: r.delegated_from,
      })),
      timeoutAction: data.timeout_action,
      escalatedTo: data.escalated_to,
    };
  }

  /**
   * Get approval request by execution and step
   */
  async getApprovalRequestByStep(
    executionId: string,
    stepId: string
  ): Promise<ApprovalRequest | null> {
    const { data, error } = await this.supabase
      .from('workflow_approval_requests')
      .select('*')
      .eq('execution_id', executionId)
      .eq('step_id', stepId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return null;
    }

    return this.getApprovalRequest(data.id);
  }

  /**
   * Record approval response
   */
  async recordApprovalResponse(
    approvalId: string,
    approverId: string,
    decision: 'approve' | 'reject',
    comment?: string,
    delegatedFrom?: string
  ): Promise<void> {
    console.log(`✋ [ApprovalTracker] Recording ${decision} from ${approverId}`);

    const now = new Date().toISOString();

    // Get current approval request
    const approval = await this.getApprovalRequest(approvalId);
    if (!approval) {
      throw new ExecutionError(
        `Approval request ${approvalId} not found`,
        'APPROVAL_NOT_FOUND'
      );
    }

    // Check if user is authorized
    if (!approval.approvers.includes(approverId)) {
      throw new ExecutionError(
        `User ${approverId} not authorized to approve this request`,
        'UNAUTHORIZED_APPROVER'
      );
    }

    // Check if already responded
    if (approval.responses.some(r => r.approverId === approverId)) {
      throw new ExecutionError(
        `User ${approverId} has already responded to this request`,
        'DUPLICATE_RESPONSE'
      );
    }

    // Store response
    const { error } = await this.supabase
      .from('workflow_approval_responses')
      .insert({
        approval_id: approvalId,
        approver_id: approverId,
        decision,
        comment,
        responded_at: now,
        delegated_from: delegatedFrom,
      });

    if (error) {
      throw new ExecutionError(
        `Failed to record approval response: ${error.message}`,
        'RESPONSE_RECORDING_FAILED'
      );
    }

    // Update approval status
    const newStatus = this.calculateApprovalStatus(
      approval.approvalType,
      approval.approvers.length,
      [...approval.responses, { approverId, decision, respondedAt: now, comment, delegatedFrom }]
    );

    if (newStatus !== 'pending') {
      await this.updateApprovalStatus(approvalId, newStatus);
    }

    console.log(`✅ [ApprovalTracker] Response recorded, new status: ${newStatus}`);
  }

  /**
   * Calculate approval status based on responses
   */
  private calculateApprovalStatus(
    approvalType: 'any' | 'all' | 'majority',
    totalApprovers: number,
    responses: ApprovalResponse[]
  ): 'pending' | 'approved' | 'rejected' {
    const approvals = responses.filter(r => r.decision === 'approve').length;
    const rejections = responses.filter(r => r.decision === 'reject').length;

    switch (approvalType) {
      case 'any':
        // Any single approval is enough
        if (approvals > 0) return 'approved';
        // If all have responded and none approved, it's rejected
        if (responses.length === totalApprovers && approvals === 0) return 'rejected';
        return 'pending';

      case 'all':
        // All must approve
        if (approvals === totalApprovers) return 'approved';
        // Any single rejection fails it
        if (rejections > 0) return 'rejected';
        return 'pending';

      case 'majority':
        // More than half must approve
        const required = Math.ceil(totalApprovers / 2);
        if (approvals >= required) return 'approved';
        // If remaining approvers can't reach majority, it's rejected
        const remaining = totalApprovers - responses.length;
        if (approvals + remaining < required) return 'rejected';
        return 'pending';

      default:
        return 'pending';
    }
  }

  /**
   * Update approval status
   */
  private async updateApprovalStatus(
    approvalId: string,
    status: 'pending' | 'approved' | 'rejected' | 'timeout' | 'escalated'
  ): Promise<void> {
    const { error } = await this.supabase
      .from('workflow_approval_requests')
      .update({ status })
      .eq('id', approvalId);

    if (error) {
      console.error(`❌ [ApprovalTracker] Failed to update approval status:`, error);
    }
  }

  /**
   * Check if approval has timed out
   */
  async checkTimeout(approvalId: string): Promise<boolean> {
    const approval = await this.getApprovalRequest(approvalId);
    if (!approval || !approval.expiresAt) {
      return false;
    }

    const now = new Date();
    const expiresAt = new Date(approval.expiresAt);

    if (now > expiresAt && approval.status === 'pending') {
      console.log(`⏰ [ApprovalTracker] Approval ${approvalId} has timed out`);

      // Handle timeout based on configuration
      const timeoutAction = approval.timeoutAction || 'reject';

      switch (timeoutAction) {
        case 'approve':
          await this.updateApprovalStatus(approvalId, 'approved');
          await auditLog({
            action: AUDIT_EVENTS.APPROVAL_TIMEOUT,
            userId: this.userId || 'system',
            entityType: 'execution',
            entityId: approvalId,
            resourceName: approval.title,
            details: {
              approvalId,
              executionId: approval.executionId,
              stepId: approval.stepId,
              title: approval.title,
              timeoutAction: 'approve',
              autoApproved: true,
            },
          });
          break;

        case 'reject':
          await this.updateApprovalStatus(approvalId, 'rejected');
          await auditLog({
            action: AUDIT_EVENTS.APPROVAL_TIMEOUT,
            userId: this.userId || 'system',
            entityType: 'execution',
            entityId: approvalId,
            resourceName: approval.title,
            details: {
              approvalId,
              executionId: approval.executionId,
              stepId: approval.stepId,
              title: approval.title,
              timeoutAction: 'reject',
              autoRejected: true,
            },
          });
          break;

        case 'escalate':
          if (approval.escalatedTo && approval.escalatedTo.length > 0) {
            await this.escalateApproval(approvalId, approval.escalatedTo, approval);
          } else {
            // No escalation targets, default to reject
            await this.updateApprovalStatus(approvalId, 'rejected');
            await auditLog({
              action: AUDIT_EVENTS.APPROVAL_TIMEOUT,
              userId: this.userId || 'system',
              entityType: 'execution',
              entityId: approvalId,
              resourceName: approval.title,
              details: {
                approvalId,
                executionId: approval.executionId,
                stepId: approval.stepId,
                title: approval.title,
                timeoutAction: 'escalate',
                escalationFailed: true,
                reason: 'No escalation targets available',
              },
            });
          }
          break;
      }

      return true;
    }

    return false;
  }

  /**
   * Escalate approval to new approvers
   */
  private async escalateApproval(
    approvalId: string,
    escalateTo: string[],
    approval: ApprovalRequest
  ): Promise<void> {
    console.log(`📤 [ApprovalTracker] Escalating approval ${approvalId} to:`, escalateTo);

    const { error } = await this.supabase
      .from('workflow_approval_requests')
      .update({
        status: 'escalated',
        approvers: escalateTo,
        escalated_at: new Date().toISOString(),
      })
      .eq('id', approvalId);

    if (error) {
      console.error(`❌ [ApprovalTracker] Failed to escalate approval:`, error);
      return;
    }

    // Log escalation audit event
    await auditLog({
      action: AUDIT_EVENTS.APPROVAL_ESCALATED,
      userId: this.userId || 'system',
      entityType: 'execution',
      entityId: approvalId,
      resourceName: approval.title,
      details: {
        approvalId,
        executionId: approval.executionId,
        stepId: approval.stepId,
        title: approval.title,
        originalApprovers: approval.approvers,
        escalatedTo: escalateTo,
        reason: 'Timeout - escalated to higher authority',
      },
    });
  }

  /**
   * Wait for approval (polling)
   */
  async waitForApproval(
    approvalId: string,
    pollInterval: number = 5000
  ): Promise<'approved' | 'rejected' | 'timeout'> {
    console.log(`⏳ [ApprovalTracker] Waiting for approval: ${approvalId}`);

    return new Promise((resolve) => {
      const interval = setInterval(async () => {
        // Check for timeout
        const timedOut = await this.checkTimeout(approvalId);
        if (timedOut) {
          clearInterval(interval);
          const approval = await this.getApprovalRequest(approvalId);
          if (approval?.status === 'approved') {
            resolve('approved');
          } else {
            resolve('timeout');
          }
          return;
        }

        // Check approval status
        const approval = await this.getApprovalRequest(approvalId);
        if (!approval) {
          clearInterval(interval);
          resolve('rejected');
          return;
        }

        if (approval.status === 'approved') {
          clearInterval(interval);
          resolve('approved');
        } else if (approval.status === 'rejected') {
          clearInterval(interval);
          resolve('rejected');
        } else if (approval.status === 'timeout') {
          clearInterval(interval);
          resolve('timeout');
        }
      }, pollInterval);
    });
  }
}
