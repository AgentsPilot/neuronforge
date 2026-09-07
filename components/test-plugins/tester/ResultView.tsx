'use client';

// components/test-plugins/tester/ResultView.tsx
//
// FR7 current-result display: the most recent run's readable success payload or a
// clear error. The running history lives in the SideConsole (FR8) — this focuses on
// "what just happened" to avoid duplication.

import type { ExecutionResult } from '@/lib/types/plugin-types';

interface ResultViewProps {
  result: ExecutionResult | null;
}

export function ResultView({ result }: ResultViewProps) {
  if (!result) return null;

  const ok = result.success;
  return (
    <div
      data-testid="tester-result"
      style={{
        marginTop: 16,
        padding: 14,
        border: `1px solid ${ok ? '#28a745' : '#dc3545'}`,
        borderRadius: 5,
        backgroundColor: ok ? '#f6fff8' : '#fff5f5',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 8, color: ok ? '#1a7431' : '#b02a37' }}>
        {ok ? '✓ Success' : '✗ Error'}
      </div>
      {!ok && (result.error || result.message) && (
        <div style={{ fontSize: 13, marginBottom: 8, color: '#b02a37' }}>
          {result.error || result.message}
        </div>
      )}
      <pre
        style={{
          backgroundColor: '#f8f9fa',
          padding: 12,
          borderRadius: 3,
          overflow: 'auto',
          fontSize: 12,
          maxHeight: 280,
          margin: 0,
        }}
      >
        {JSON.stringify(ok ? result.data ?? result : result, null, 2)}
      </pre>
    </div>
  );
}
