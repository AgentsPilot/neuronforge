/**
 * Pending Approvals Component
 *
 * Displays pending approval requests for the current execution
 *
 * Phase 6: Human-in-the-Loop
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { ApprovalRequest } from '@/lib/pilot';
import { supabase } from '@/lib/supabaseClient';

interface PendingApprovalsProps {
  executionId: string;
  onApprovalComplete?: () => void;
}

export function PendingApprovals({ executionId, onApprovalComplete }: PendingApprovalsProps) {
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchApprovals();

    // Poll for updates every 5 seconds
    const interval = setInterval(fetchApprovals, 5000);

    return () => clearInterval(interval);
  }, [executionId]);

  async function fetchApprovals() {
    try {
      const { data, error } = await supabase
        .from('workflow_approval_requests')
        .select('*')
        .eq('execution_id', executionId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const formattedApprovals: ApprovalRequest[] = (data || []).map((item: any) => ({
        id: item.id,
        executionId: item.execution_id,
        stepId: item.step_id,
        approvers: item.approvers,
        approvalType: item.approval_type,
        title: item.title,
        message: item.message,
        context: item.context || {},
        status: item.status,
        createdAt: item.created_at,
        expiresAt: item.expires_at,
        responses: [],
        timeoutAction: item.timeout_action,
        escalatedTo: item.escalated_to,
      }));

      setApprovals(formattedApprovals);

      // Notify parent if all approvals are complete
      if (
        formattedApprovals.length > 0 &&
        formattedApprovals.every(a => a.status !== 'pending') &&
        onApprovalComplete
      ) {
        onApprovalComplete();
      }
    } catch (error) {
      console.error('Error fetching approvals:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-gray-50 rounded-lg p-4">
        <div className="animate-pulse flex items-center gap-3">
          <div className="h-10 w-10 bg-gray-200 rounded-lg"></div>
          <div className="flex-1 space-y-2">
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
            <div className="h-3 bg-gray-200 rounded w-1/2"></div>
          </div>
        </div>
      </div>
    );
  }

  if (approvals.length === 0) {
    return null;
  }

  const pendingApprovals = approvals.filter(a => a.status === 'pending');
  const completedApprovals = approvals.filter(a => a.status !== 'pending');

  return (
    <div className="space-y-4">
      {/* Pending Approvals */}
      {pendingApprovals.length > 0 && (
        <div className="bg-orange-50 border-2 border-orange-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-2xl">✋</span>
            <h3 className="text-lg font-semibold text-orange-900">
              Pending Approvals ({pendingApprovals.length})
            </h3>
          </div>

          <div className="space-y-3">
            {pendingApprovals.map((approval) => (
              <Link
                key={approval.id}
                href={`/approvals/${approval.id}`}
                className="block bg-white border border-orange-200 rounded-lg p-4 hover:border-orange-400 hover:shadow-md transition-all"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <h4 className="font-medium text-gray-900">{approval.title}</h4>
                    {approval.message && (
                      <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                        {approval.message}
                      </p>
                    )}
                  </div>
                  <span className="ml-4 px-3 py-1 bg-orange-100 text-orange-800 text-xs font-medium rounded-full whitespace-nowrap">
                    Action Required
                  </span>
                </div>

                <div className="flex items-center gap-4 text-xs text-gray-500 mt-3">
                  <span>👥 {approval.approvers.length} approver(s)</span>
                  <span>📋 {approval.approvalType}</span>
                  {approval.expiresAt && (
                    <span>
                      ⏰ Expires{' '}
                      {new Date(approval.expiresAt).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                  )}
                </div>

                <div className="mt-3 flex items-center gap-2 text-sm text-orange-600 font-medium">
                  <span>Click to review and respond</span>
                  <span>→</span>
                </div>
              </Link>
            ))}
          </div>

          <p className="text-sm text-orange-700 mt-4 italic">
            💡 The workflow is paused. It will resume automatically once all required approvals are received.
          </p>
        </div>
      )}

      {/* Completed Approvals */}
      {completedApprovals.length > 0 && (
        <div className="bg-gray-50 rounded-lg p-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">
            Approval History ({completedApprovals.length})
          </h3>

          <div className="space-y-2">
            {completedApprovals.map((approval) => (
              <div
                key={approval.id}
                className={`flex items-center justify-between p-3 rounded-lg border ${
                  approval.status === 'approved'
                    ? 'bg-green-50 border-green-200'
                    : approval.status === 'rejected'
                    ? 'bg-red-50 border-red-200'
                    : 'bg-yellow-50 border-yellow-200'
                }`}
              >
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">{approval.title}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {new Date(approval.createdAt).toLocaleString()}
                  </p>
                </div>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-medium ${
                    approval.status === 'approved'
                      ? 'bg-green-100 text-green-800'
                      : approval.status === 'rejected'
                      ? 'bg-red-100 text-red-800'
                      : 'bg-yellow-100 text-yellow-800'
                  }`}
                >
                  {approval.status === 'approved' && '✅ Approved'}
                  {approval.status === 'rejected' && '❌ Rejected'}
                  {approval.status === 'timeout' && '⏰ Timeout'}
                  {approval.status === 'escalated' && '📤 Escalated'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
