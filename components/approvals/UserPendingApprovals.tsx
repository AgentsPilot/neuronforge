'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import Link from 'next/link'
import { AlertCircle, CheckCircle, Clock, Hand, XCircle } from 'lucide-react'
import type { ApprovalRequest } from '@/lib/pilot'

export function UserPendingApprovals({ userId }: { userId: string }) {
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!userId) return

    fetchApprovals()

    // Poll for updates every 5 seconds
    const interval = setInterval(fetchApprovals, 5000)

    return () => clearInterval(interval)
  }, [userId])

  async function fetchApprovals() {
    try {
      console.log('[UserPendingApprovals] Fetching approvals for user:', userId)

      // Fetch all approval requests where the user is an approver
      const { data, error } = await supabase
        .from('workflow_approval_requests')
        .select('*')
        .contains('approvers', [userId])
        .order('created_at', { ascending: false })

      console.log('[UserPendingApprovals] Query result:', { data, error })

      if (error) {
        console.error('[UserPendingApprovals] Error fetching approvals:', error)
        return
      }

      if (!data) {
        setApprovals([])
        setLoading(false)
        return
      }

      // Get responses for each approval
      const approvalsWithResponses = await Promise.all(
        data.map(async (approval) => {
          const { data: responses } = await supabase
            .from('workflow_approval_responses')
            .select('*')
            .eq('approval_id', approval.id)
            .order('responded_at', { ascending: true })

          return {
            id: approval.id,
            executionId: approval.execution_id,
            stepId: approval.step_id,
            approvers: approval.approvers,
            approvalType: approval.approval_type,
            title: approval.title,
            message: approval.message,
            context: approval.context || {},
            status: approval.status,
            createdAt: approval.created_at,
            expiresAt: approval.expires_at,
            responses: (responses || []).map(r => ({
              approverId: r.approver_id,
              decision: r.decision,
              comment: r.comment,
              respondedAt: r.responded_at,
              delegatedFrom: r.delegated_from,
            })),
            timeoutAction: approval.timeout_action,
            escalatedTo: approval.escalated_to,
          }
        })
      )

      setApprovals(approvalsWithResponses)
      console.log('[UserPendingApprovals] Total approvals found:', approvalsWithResponses.length)
      setLoading(false)
    } catch (error) {
      console.error('[UserPendingApprovals] Error in fetchApprovals:', error)
      setLoading(false)
    }
  }

  // Filter pending approvals that the user hasn't responded to yet
  const pendingApprovals = approvals.filter(
    (approval) =>
      approval.status === 'pending' &&
      !approval.responses.some((r) => r.approverId === userId)
  )

  console.log('[UserPendingApprovals] Pending approvals:', pendingApprovals.length, pendingApprovals)

  // Don't show the card if there are no pending approvals
  if (!loading && pendingApprovals.length === 0) {
    console.log('[UserPendingApprovals] No pending approvals - not showing card')
    return null
  }

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-orange-50 via-white to-amber-50 rounded-2xl border-2 border-orange-200 shadow-lg p-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-amber-600 rounded-2xl flex items-center justify-center">
            <Hand className="h-6 w-6 text-white animate-pulse" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900">Loading Approvals...</h3>
            <p className="text-sm text-gray-600">Checking for pending requests</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-gradient-to-br from-orange-50 via-white to-amber-50 rounded-2xl border-2 border-orange-300 shadow-xl p-6 animate-pulse-slow">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <div className="w-14 h-14 bg-gradient-to-br from-orange-500 to-amber-600 rounded-2xl flex items-center justify-center shadow-lg animate-bounce-slow">
          <Hand className="h-7 w-7 text-white" />
        </div>
        <div>
          <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-orange-600" />
            Approval Required
          </h3>
          <p className="text-sm text-gray-700 font-medium">
            {pendingApprovals.length} workflow{pendingApprovals.length !== 1 ? 's' : ''} waiting for your approval
          </p>
        </div>
      </div>

      {/* Pending Approvals List */}
      <div className="space-y-3">
        {pendingApprovals.slice(0, 3).map((approval) => {
          const isExpiringSoon = approval.expiresAt
            ? new Date(approval.expiresAt).getTime() - Date.now() < 30 * 60 * 1000 // 30 minutes
            : false

          return (
            <Link
              key={approval.id}
              href={`/approvals/${approval.id}`}
              className="block group"
            >
              <div className="bg-white/80 backdrop-blur rounded-xl p-4 border-2 border-orange-200 hover:border-orange-400 hover:shadow-lg transition-all duration-200 transform hover:scale-[1.02]">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <h4 className="font-semibold text-gray-900 group-hover:text-orange-600 transition-colors">
                      {approval.title}
                    </h4>
                    {approval.message && (
                      <p className="text-sm text-gray-600 mt-1 line-clamp-2">{approval.message}</p>
                    )}
                  </div>
                  <div className={`px-3 py-1 rounded-full text-xs font-bold ${
                    isExpiringSoon
                      ? 'bg-red-100 text-red-700 animate-pulse'
                      : 'bg-orange-100 text-orange-700'
                  }`}>
                    {isExpiringSoon ? 'URGENT' : 'PENDING'}
                  </div>
                </div>

                <div className="flex items-center gap-4 text-xs text-gray-600">
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    <span>
                      {new Date(approval.createdAt).toLocaleDateString()} at{' '}
                      {new Date(approval.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  {approval.expiresAt && (
                    <div className={`flex items-center gap-1 ${isExpiringSoon ? 'text-red-600 font-semibold' : ''}`}>
                      <AlertCircle className="h-3 w-3" />
                      <span>
                        Expires{' '}
                        {new Date(approval.expiresAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  )}
                </div>

                {/* Approval type badge */}
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-xs text-gray-500">
                    Requires: <span className="font-semibold text-gray-700">{approval.approvalType}</span>
                  </span>
                  {approval.approvalType === 'all' && (
                    <span className="text-xs text-gray-500">
                      ({approval.approvers.length} approver{approval.approvers.length !== 1 ? 's' : ''})
                    </span>
                  )}
                </div>
              </div>
            </Link>
          )
        })}

        {/* Show count if more than 3 */}
        {pendingApprovals.length > 3 && (
          <div className="text-center py-2">
            <Link
              href="/approvals"
              className="text-sm text-orange-600 hover:text-orange-700 font-semibold hover:underline"
            >
              +{pendingApprovals.length - 3} more pending approval{pendingApprovals.length - 3 !== 1 ? 's' : ''}
            </Link>
          </div>
        )}
      </div>

      {/* Action Button */}
      <div className="mt-4 pt-4 border-t border-orange-200">
        <Link
          href={`/approvals/${pendingApprovals[0].id}`}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-105"
        >
          <CheckCircle className="h-5 w-5" />
          Review & Approve
        </Link>
      </div>
    </div>
  )
}
