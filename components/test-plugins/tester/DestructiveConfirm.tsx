'use client';

// components/test-plugins/tester/DestructiveConfirm.tsx
//
// Lightweight blocking confirm gate (FR6). Renders the platform-authored confirm
// message from the action's presence-check confirmation rule (CR1). Only shown for
// genuinely destructive actions — threshold confirms are advisory and never reach here.

interface DestructiveConfirmProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DestructiveConfirm({ message, onConfirm, onCancel }: DestructiveConfirmProps) {
  return (
    <div
      role="alertdialog"
      aria-label="Confirm destructive action"
      style={{
        marginTop: 12,
        padding: 14,
        border: '2px solid #dc3545',
        borderRadius: 5,
        backgroundColor: '#fff5f5',
      }}
    >
      <div style={{ fontWeight: 600, color: '#b02a37', marginBottom: 8 }}>
        ⚠ Destructive action — please confirm
      </div>
      <div style={{ fontSize: 13, marginBottom: 12 }}>{message}</div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={onConfirm}
          style={{
            padding: '8px 16px',
            backgroundColor: '#dc3545',
            color: 'white',
            border: 'none',
            borderRadius: 3,
            cursor: 'pointer',
          }}
        >
          Confirm & Run
        </button>
        <button
          onClick={onCancel}
          style={{
            padding: '8px 16px',
            backgroundColor: '#6c757d',
            color: 'white',
            border: 'none',
            borderRadius: 3,
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
