'use client';

import { useState } from 'react';
import type { BusinessListEntry } from '@/lib/business-os/usage/llmUsageReportTypes';
import { UUID_PATTERN, shortId } from './formatters';

interface BusinessPickerProps {
  sessionUserId: string;
  businesses: BusinessListEntry[];
  listLimit: number;
  loading: boolean;
  listError: string | null;
  search: string;
  onSearchChange: (value: string) => void;
  selectedAccountId: string | null;
  onSelect: (accountId: string) => void;
  platformAccountIds: string[];
}

const inputStyle: React.CSSProperties = { padding: '6px 8px', fontSize: '13px', fontFamily: 'monospace' };

/** FR-8: choose the business account by search, "My account" or a pasted id. */
export function BusinessPicker({
  sessionUserId,
  businesses,
  listLimit,
  loading,
  listError,
  search,
  onSearchChange,
  selectedAccountId,
  onSelect,
  platformAccountIds,
}: BusinessPickerProps) {
  const [pasted, setPasted] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);

  const isPlatform = (id: string | null) =>
    !!id && platformAccountIds.some((p) => p.toLowerCase() === id.toLowerCase());
  const sessionIsPlatform = isPlatform(sessionUserId);

  const usePasted = () => {
    const value = pasted.trim();
    if (!UUID_PATTERN.test(value)) {
      setPasteError('Paste a full account id (UUID).');
      return;
    }
    setPasteError(null);
    onSelect(value.toLowerCase());
  };

  return (
    <div style={{ display: 'grid', gap: '10px' }}>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <label htmlFor="llmUsageSearch">Search businesses:</label>
        <input
          id="llmUsageSearch"
          type="text"
          value={search}
          maxLength={100}
          placeholder="Company name"
          onChange={(e) => onSearchChange(e.target.value)}
          style={{ ...inputStyle, width: '240px' }}
        />
        <button
          type="button"
          onClick={() => onSelect(sessionUserId)}
          style={{ padding: '6px 12px', fontSize: '13px', cursor: 'pointer' }}
        >
          My account
        </button>
        {loading && <span style={{ color: '#666', fontSize: '12px' }}>Loading…</span>}
      </div>

      {sessionIsPlatform && (
        <div role="alert" style={{ color: '#856404', background: '#fff3cd', padding: '6px 10px', fontSize: '13px' }}>
          Your account is a platform account. It can&apos;t be used as the test business; its Business OS rows are
          shown in Check 2.
        </div>
      )}

      {listError && (
        <div role="alert" style={{ color: '#721c24', fontSize: '13px' }}>
          {listError}
        </div>
      )}

      <div
        data-testid="llm-usage-business-list"
        style={{ maxHeight: '180px', overflow: 'auto', border: '1px solid #ddd', fontSize: '13px' }}
      >
        {businesses.length === 0 && !loading ? (
          <div style={{ padding: '6px 10px', color: '#666' }}>No businesses found.</div>
        ) : (
          businesses.map((b) => {
            const selected = b.userId === selectedAccountId;
            return (
              <button
                key={b.userId}
                type="button"
                onClick={() => onSelect(b.userId)}
                aria-pressed={selected}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '4px 10px',
                  border: 'none',
                  background: selected ? '#cce5ff' : 'transparent',
                  cursor: 'pointer',
                  fontFamily: 'monospace',
                }}
              >
                {b.companyName ?? '(no name)'} <span style={{ color: '#666' }}>{shortId(b.userId)}</span>
              </button>
            );
          })
        )}
      </div>
      {businesses.length >= listLimit && (
        <div style={{ fontSize: '12px', color: '#666' }}>
          Showing the first {listLimit}. Narrow the search, or paste an account id.
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <label htmlFor="llmUsagePaste">Or paste an account id:</label>
        <input
          id="llmUsagePaste"
          type="text"
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          placeholder="00000000-0000-0000-0000-000000000000"
          style={{ ...inputStyle, width: '320px' }}
        />
        <button type="button" onClick={usePasted} style={{ padding: '6px 12px', fontSize: '13px', cursor: 'pointer' }}>
          Use this id
        </button>
      </div>
      {pasteError && (
        <div role="alert" style={{ color: '#721c24', fontSize: '13px' }}>
          {pasteError}
        </div>
      )}

      {selectedAccountId && isPlatform(selectedAccountId) && (
        <div role="alert" style={{ color: '#856404', background: '#fff3cd', padding: '6px 10px', fontSize: '13px' }}>
          This is the platform account; its Business OS rows are shown in Check 2. Choose a business account.
        </div>
      )}
    </div>
  );
}
