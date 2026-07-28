'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import {
  Draft,
  DraftState,
  DraftManagerContextValue,
  DraftType,
  PreviewContext,
} from './DraftManagerTypes';

const STORAGE_KEY = 'business-os-drafts';

// Initial state
const initialState: DraftState = {
  drafts: [],
  previewContext: 'services',
  isPanelOpen: false,
  isPublishing: false,
  publishError: null,
};

// Create context
const DraftManagerContext = createContext<DraftManagerContextValue | null>(null);

// Provider component
export function DraftManagerProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DraftState>(initialState);

  // Load drafts from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.drafts && Array.isArray(parsed.drafts)) {
          setState(prev => ({
            ...prev,
            drafts: parsed.drafts,
            previewContext: parsed.previewContext || 'services',
          }));
        }
      }
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  // Persist drafts to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        drafts: state.drafts,
        previewContext: state.previewContext,
      }));
    } catch {
      // Ignore localStorage errors
    }
  }, [state.drafts, state.previewContext]);

  // Add a new draft
  const addDraft = useCallback((draft: Omit<Draft, 'id' | 'timestamp'>) => {
    const newDraft: Draft = {
      ...draft,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    };

    setState(prev => ({
      ...prev,
      drafts: [...prev.drafts, newDraft],
      isPanelOpen: true, // Auto-open panel when adding draft
    }));
  }, []);

  // Update an existing draft
  const updateDraft = useCallback((id: string, data: Partial<Draft['data']>) => {
    setState(prev => ({
      ...prev,
      drafts: prev.drafts.map(d =>
        d.id === id ? { ...d, data: { ...d.data, ...data }, timestamp: Date.now() } : d
      ),
    }));
  }, []);

  // Remove a draft
  const removeDraft = useCallback((id: string) => {
    setState(prev => {
      const newDrafts = prev.drafts.filter(d => d.id !== id);
      return {
        ...prev,
        drafts: newDrafts,
        // Auto-close panel if no more drafts
        isPanelOpen: newDrafts.length > 0 ? prev.isPanelOpen : false,
      };
    });
  }, []);

  // Clear all drafts
  const clearDrafts = useCallback(() => {
    setState(prev => ({
      ...prev,
      drafts: [],
      isPanelOpen: false,
    }));
  }, []);

  // Publish all drafts
  const publishAll = useCallback(async () => {
    if (state.drafts.length === 0) return;

    setState(prev => ({ ...prev, isPublishing: true, publishError: null }));

    try {
      // Group drafts by type for batch operations
      const draftsByType = state.drafts.reduce((acc, draft) => {
        if (!acc[draft.type]) acc[draft.type] = [];
        acc[draft.type].push(draft);
        return acc;
      }, {} as Record<DraftType, Draft[]>);

      // Process each type
      for (const [type, drafts] of Object.entries(draftsByType)) {
        for (const draft of drafts) {
          await publishDraft(type as DraftType, draft);
        }
      }

      // Clear all drafts on success
      setState(prev => ({
        ...prev,
        drafts: [],
        isPublishing: false,
        isPanelOpen: false,
      }));
    } catch (error) {
      setState(prev => ({
        ...prev,
        isPublishing: false,
        publishError: error instanceof Error ? error.message : 'Failed to publish changes',
      }));
      throw error;
    }
  }, [state.drafts]);

  // Discard all drafts
  const discardAll = useCallback(() => {
    setState(prev => ({
      ...prev,
      drafts: [],
      isPanelOpen: false,
      publishError: null,
    }));
  }, []);

  // Open preview panel
  const openPanel = useCallback((context?: PreviewContext) => {
    setState(prev => ({
      ...prev,
      isPanelOpen: true,
      previewContext: context || prev.previewContext,
    }));
  }, []);

  // Close preview panel
  const closePanel = useCallback(() => {
    setState(prev => ({
      ...prev,
      isPanelOpen: false,
    }));
  }, []);

  // Set preview context
  const setPreviewContext = useCallback((context: PreviewContext) => {
    setState(prev => ({
      ...prev,
      previewContext: context,
    }));
  }, []);

  // Computed values
  const draftCount = state.drafts.length;
  const hasDrafts = draftCount > 0;

  const getDraftsByType = useCallback((type: DraftType) => {
    return state.drafts.filter(d => d.type === type);
  }, [state.drafts]);

  // Memoize context value
  const value = useMemo<DraftManagerContextValue>(() => ({
    state,
    addDraft,
    updateDraft,
    removeDraft,
    clearDrafts,
    publishAll,
    discardAll,
    openPanel,
    closePanel,
    setPreviewContext,
    draftCount,
    hasDrafts,
    getDraftsByType,
  }), [
    state,
    addDraft,
    updateDraft,
    removeDraft,
    clearDrafts,
    publishAll,
    discardAll,
    openPanel,
    closePanel,
    setPreviewContext,
    draftCount,
    hasDrafts,
    getDraftsByType,
  ]);

  return (
    <DraftManagerContext.Provider value={value}>
      {children}
    </DraftManagerContext.Provider>
  );
}

// Hook to use draft manager
export function useDraftManager(): DraftManagerContextValue {
  const context = useContext(DraftManagerContext);
  if (!context) {
    throw new Error('useDraftManager must be used within a DraftManagerProvider');
  }
  return context;
}

// Helper function to publish a single draft
async function publishDraft(type: DraftType, draft: Draft): Promise<void> {
  const { action, entityId, data } = draft;

  switch (type) {
    case 'service':
      await publishServiceDraft(action, entityId, data);
      break;
    case 'availability':
      await publishAvailabilityDraft(data);
      break;
    case 'contact':
      await publishContactDraft(action, entityId, data);
      break;
    case 'invoice':
      await publishInvoiceDraft(action, entityId, data);
      break;
    case 'booking':
      await publishBookingDraft(action, entityId, data);
      break;
    default:
      throw new Error(`Unknown draft type: ${type}`);
  }
}

// Service publishing
async function publishServiceDraft(
  action: Draft['action'],
  entityId: string | undefined,
  data: Record<string, any>
): Promise<void> {
  const baseUrl = '/api/scheduling/services';

  if (action === 'create') {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to create service');
  } else if (action === 'update' && entityId) {
    const res = await fetch(`${baseUrl}/${entityId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to update service');
  } else if (action === 'delete' && entityId) {
    const res = await fetch(`${baseUrl}/${entityId}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete service');
  }
}

// Availability publishing
async function publishAvailabilityDraft(data: Record<string, any>): Promise<void> {
  const res = await fetch('/api/scheduling/availability', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ availability: data }),
  });
  if (!res.ok) throw new Error('Failed to update availability');
}

// Contact publishing
async function publishContactDraft(
  action: Draft['action'],
  entityId: string | undefined,
  data: Record<string, any>
): Promise<void> {
  const baseUrl = '/api/crm/contacts';

  if (action === 'create') {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to create contact');
  } else if (action === 'update' && entityId) {
    const res = await fetch(`${baseUrl}/${entityId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to update contact');
  } else if (action === 'delete' && entityId) {
    const res = await fetch(`${baseUrl}/${entityId}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete contact');
  }
}

// Invoice publishing
async function publishInvoiceDraft(
  action: Draft['action'],
  entityId: string | undefined,
  data: Record<string, any>
): Promise<void> {
  const baseUrl = '/api/payments/invoices';

  if (action === 'create') {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to create invoice');
  } else if (action === 'update' && entityId) {
    const res = await fetch(`${baseUrl}/${entityId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to update invoice');
  }
}

// Booking publishing
async function publishBookingDraft(
  action: Draft['action'],
  entityId: string | undefined,
  data: Record<string, any>
): Promise<void> {
  const baseUrl = '/api/scheduling/bookings';

  if (action === 'create') {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to create booking');
  } else if (action === 'delete' && entityId) {
    const res = await fetch(`${baseUrl}/${entityId}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Cancelled via chat' }),
    });
    if (!res.ok) throw new Error('Failed to cancel booking');
  }
}
