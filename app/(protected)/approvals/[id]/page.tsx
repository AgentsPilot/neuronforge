/**
 * Approval Request Page
 *
 * Displays an approval request and allows user to approve or reject
 *
 * Phase 6: Human-in-the-Loop
 */

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import type { ApprovalRequest } from '@/lib/pilot';

export default function ApprovalPage({
  params,
}: {
  params: { id: string };
}) {
  const approvalId = params.id;
  const router = useRouter();

  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    fetchApproval();
    getCurrentUser();
  }, [approvalId]);

  async function getCurrentUser() {
    const { data: { user } } = await supabase.auth.getUser();
    setCurrentUserId(user?.id || null);
  }

  async function fetchApproval() {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/approvals/${approvalId}/respond`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch approval');
      }

      setApproval(data.approval);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleResponse(decision: 'approve' | 'reject') {
    if (!currentUserId) {
      setError('You must be logged in to respond');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      const response = await fetch(`/api/approvals/${approvalId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          decision,
          comment: comment.trim() || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit response');
      }

      // Success! Refresh approval to show new status
      await fetchApproval();

      // Show success message and redirect to dashboard
      alert(`Successfully ${decision}d the request! Redirecting to dashboard...`);

      // Redirect to dashboard after 1 second
      setTimeout(() => {
        router.push('/dashboard');
      }, 1000);

    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading approval request...</p>
        </div>
      </div>
    );
  }

  if (error && !approval) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 max-w-md">
          <h2 className="text-lg font-semibold text-red-800 mb-2">Error</h2>
          <p className="text-red-600">{error}</p>
          <button
            onClick={() => router.back()}
            className="mt-4 text-red-600 hover:text-red-800 underline"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  if (!approval) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">Approval request not found</p>
        </div>
      </div>
    );
  }

  const isApprover = currentUserId && approval.approvers.includes(currentUserId);
  const hasResponded = approval.responses.some(r => r.approverId === currentUserId);
  const canRespond = isApprover && !hasResponded && approval.status === 'pending';
  const isExpired = approval.expiresAt && new Date(approval.expiresAt) < new Date();

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="bg-white shadow-lg rounded-lg overflow-hidden">
          <div className="bg-orange-500 px-6 py-4">
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <span>✋</span>
              <span>Approval Required</span>
            </h1>
          </div>

          {/* Status Badge */}
          <div className="px-6 py-3 bg-gray-50 border-b">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Status:</span>
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                approval.status === 'approved' ? 'bg-green-100 text-green-800' :
                approval.status === 'rejected' ? 'bg-red-100 text-red-800' :
                approval.status === 'timeout' ? 'bg-yellow-100 text-yellow-800' :
                'bg-blue-100 text-blue-800'
              }`}>
                {approval.status.toUpperCase()}
              </span>
            </div>
          </div>

          {/* Content */}
          <div className="px-6 py-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              {approval.title}
            </h2>

            {approval.message && (
              <p className="text-gray-700 mb-6 whitespace-pre-wrap">
                {approval.message}
              </p>
            )}

            {/* Context Details */}
            {Object.keys(approval.context).length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-gray-900 mb-3">Details:</h3>
                <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                  {Object.entries(approval.context).map(([key, value]) => (
                    <div key={key} className="flex justify-between">
                      <span className="text-sm font-medium text-gray-600">{key}:</span>
                      <span className="text-sm text-gray-900">
                        {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Approval Info */}
            <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
              <div>
                <span className="text-gray-600">Approval Type:</span>
                <p className="font-medium text-gray-900">{approval.approvalType}</p>
              </div>
              <div>
                <span className="text-gray-600">Approvers:</span>
                <p className="font-medium text-gray-900">{approval.approvers.length} user(s)</p>
              </div>
              <div>
                <span className="text-gray-600">Created:</span>
                <p className="font-medium text-gray-900">
                  {new Date(approval.createdAt).toLocaleString()}
                </p>
              </div>
              {approval.expiresAt && (
                <div>
                  <span className="text-gray-600">Expires:</span>
                  <p className={`font-medium ${isExpired ? 'text-red-600' : 'text-gray-900'}`}>
                    {new Date(approval.expiresAt).toLocaleString()}
                  </p>
                </div>
              )}
            </div>

            {/* Responses */}
            {approval.responses.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-gray-900 mb-3">
                  Responses ({approval.responses.length}):
                </h3>
                <div className="space-y-3">
                  {approval.responses.map((response, idx) => (
                    <div
                      key={idx}
                      className={`border rounded-lg p-3 ${
                        response.decision === 'approve'
                          ? 'border-green-200 bg-green-50'
                          : 'border-red-200 bg-red-50'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-gray-900">
                          {response.approverId === currentUserId ? 'You' : response.approverId}
                        </span>
                        <span className={`text-sm font-medium ${
                          response.decision === 'approve' ? 'text-green-700' : 'text-red-700'
                        }`}>
                          {response.decision === 'approve' ? '✅ Approved' : '❌ Rejected'}
                        </span>
                      </div>
                      {response.comment && (
                        <p className="text-sm text-gray-700">{response.comment}</p>
                      )}
                      <p className="text-xs text-gray-500 mt-1">
                        {new Date(response.respondedAt).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            {/* Action Buttons */}
            {canRespond ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Comment (optional):
                  </label>
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Add a comment about your decision..."
                    rows={3}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    disabled={submitting}
                  />
                </div>

                <div className="flex gap-4">
                  <button
                    onClick={() => handleResponse('approve')}
                    disabled={submitting}
                    className="flex-1 bg-green-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {submitting ? 'Submitting...' : '✅ Approve'}
                  </button>
                  <button
                    onClick={() => handleResponse('reject')}
                    disabled={submitting}
                    className="flex-1 bg-red-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {submitting ? 'Submitting...' : '❌ Reject'}
                  </button>
                </div>
              </div>
            ) : hasResponded ? (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-blue-800 text-center">
                  ✓ You have already responded to this approval request
                </p>
              </div>
            ) : !isApprover ? (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <p className="text-yellow-800 text-center">
                  You are not authorized to respond to this approval request
                </p>
              </div>
            ) : (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <p className="text-gray-600 text-center">
                  This approval request is no longer pending
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Back Button */}
        <div className="mt-6 text-center">
          <button
            onClick={() => router.back()}
            className="text-orange-600 hover:text-orange-800 font-medium"
          >
            ← Go Back
          </button>
        </div>
      </div>
    </div>
  );
}
