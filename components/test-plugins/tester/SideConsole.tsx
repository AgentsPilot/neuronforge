'use client';

// components/test-plugins/tester/SideConsole.tsx
//
// FR8 persistent, session-scoped side console. One entry per plugin API call, newest
// first, expandable + copyable + clearable, bounded by the hook's retention cap.
// Entries are already redaction-scrubbed by useSideConsole before they reach here;
// this component renders only that scrubbed data (belt-and-suspenders Level 1 — F2's
// hard guarantee is server-side and applies to any future Level-2 path).

import { useState } from 'react';
import type { ConsoleEntry } from '@/lib/plugins/tester/tester-types';

interface SideConsoleProps {
  entries: ConsoleEntry[];
  onClear: () => void;
}

export function SideConsole({ entries, onClear }: SideConsoleProps) {
  return (
    <div
      data-testid="side-console"
      style={{ border: '1px solid #ccc', borderRadius: 5, padding: 12, height: '100%', minWidth: 320 }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <strong>Side Console ({entries.length})</strong>
        <button
          onClick={onClear}
          disabled={entries.length === 0}
          style={{
            padding: '4px 12px',
            backgroundColor: entries.length === 0 ? '#adb5bd' : '#6c757d',
            color: 'white',
            border: 'none',
            borderRadius: 3,
            cursor: entries.length === 0 ? 'not-allowed' : 'pointer',
            fontSize: 12,
          }}
        >
          Clear
        </button>
      </div>
      {entries.length === 0 ? (
        <div style={{ fontSize: 12, color: '#666' }}>No calls yet. Run an action to log it here.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 520, overflow: 'auto' }}>
          {entries.map((entry) => (
            <ConsoleRow key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}

function ConsoleRow({ entry }: { entry: ConsoleEntry }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify({ request: entry.request, response: entry.response }, null, 2)
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };

  return (
    <div data-testid="console-entry" style={{ border: '1px solid #e0e0e0', borderRadius: 3, padding: 8 }}>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', fontSize: 12 }}
        onClick={() => setExpanded((v) => !v)}
      >
        <span>
          <span style={{ color: entry.outcome === 'success' ? '#1a7431' : '#b02a37' }}>
            {entry.outcome === 'success' ? '✓' : '✗'}
          </span>{' '}
          <strong>{entry.plugin}.{entry.action}</strong>{' '}
          <span style={{ color: '#666' }}>{entry.durationMs}ms</span>
        </span>
        <span style={{ color: '#888' }}>{expanded ? '▲' : '▼'}</span>
      </div>
      <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>
        {entry.timestamp} · user {entry.userId}
      </div>
      {expanded && (
        <div style={{ marginTop: 6 }}>
          <button
            onClick={copy}
            style={{
              padding: '2px 8px',
              marginBottom: 6,
              backgroundColor: copied ? '#28a745' : '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: 3,
              cursor: 'pointer',
              fontSize: 11,
            }}
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
          <pre style={{ backgroundColor: '#f8f9fa', padding: 8, borderRadius: 3, fontSize: 11, overflow: 'auto', margin: 0 }}>
            {JSON.stringify({ request: entry.request, response: entry.response }, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
