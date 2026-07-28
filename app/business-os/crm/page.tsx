'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BusinessOSHeader } from '@/components/business-os/BusinessOSHeader';
import { CRMPipelineView } from '@/components/crm/CRMPipelineView';
import { CRMContactList } from '@/components/crm/CRMContactList';
import { CRMContactModal } from '@/components/crm/CRMContactModal';
import { CRMContactDrawer } from '@/components/crm/CRMContactDrawer';
import { Plus, Search, ArrowLeft, Users, Download, LayoutGrid, List } from 'lucide-react';
import { createLogger } from '@/lib/logger';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import type { CRMContact } from '@/lib/repositories/CRMContactRepository';
import type { CRMPipelineStage } from '@/lib/repositories/CRMPipelineStagesRepository';

const logger = createLogger({ module: 'CRMPage' });

type ViewMode = 'pipeline' | 'contacts';

export default function CRMPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLanguage();
  const [viewMode, setViewMode] = useState<ViewMode>('pipeline');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedContact, setSelectedContact] = useState<CRMContact | null>(null);
  const [isNewContactModalOpen, setIsNewContactModalOpen] = useState(false);
  const [contacts, setContacts] = useState<CRMContact[]>([]);
  const [pipelineStages, setPipelineStages] = useState<CRMPipelineStage[]>([]);
  const [enabledCapabilities, setEnabledCapabilities] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [drawerDefaultTab, setDrawerDefaultTab] = useState<'details' | 'tasks' | undefined>(undefined);
  const PAGE_SIZE = 50;

  // Fetch pipeline stages and capabilities on mount
  useEffect(() => {
    fetchPipelineStages();
    fetchCapabilities();
  }, []);

  // Handle contact query parameter - open specific contact drawer
  useEffect(() => {
    const contactId = searchParams.get('contact');
    if (contactId && contacts.length > 0) {
      const contact = contacts.find(c => c.id === contactId);
      if (contact) {
        setDrawerDefaultTab('details');
        setSelectedContact(contact);
        // Clear the query param from URL after opening
        router.replace('/business-os/crm', { scroll: false });
      } else {
        // Contact not in current list - fetch it directly
        fetchContactById(contactId);
      }
    }
  }, [searchParams, contacts]);

  // Handle task query parameter - fetch task to get contact_id, then open drawer with tasks tab
  useEffect(() => {
    const taskId = searchParams.get('task');
    if (taskId) {
      fetchTaskAndOpenDrawer(taskId);
    }
  }, [searchParams]);

  const fetchTaskAndOpenDrawer = async (taskId: string) => {
    try {
      logger.info({ taskId }, 'Fetching task to open drawer');
      const response = await fetch(`/api/crm/tasks/${taskId}`);
      const data = await response.json();
      logger.info({ taskId, success: data.success, hasTask: !!data.task, contactId: data.task?.contact_id }, 'Task fetch result');

      if (data.success && data.task) {
        if (data.task.contact_id) {
          // Task is linked to a contact - fetch contact and open drawer with tasks tab
          const contactResponse = await fetch(`/api/crm/contacts/${data.task.contact_id}`);
          const contactData = await contactResponse.json();
          logger.info({ contactId: data.task.contact_id, success: contactData.success }, 'Contact fetch result');

          if (contactData.success && contactData.contact) {
            setDrawerDefaultTab('tasks');
            setSelectedContact(contactData.contact);
            router.replace('/business-os/crm', { scroll: false });
          }
        } else {
          // Standalone task (no contact) - for now, just clear the URL
          // TODO: Could show a task modal here
          logger.info({ taskId }, 'Task has no contact_id - standalone task');
          router.replace('/business-os/crm', { scroll: false });
        }
      }
    } catch (error) {
      logger.error({ err: error, taskId }, 'Failed to fetch task by ID');
    }
  };

  const fetchContactById = async (contactId: string) => {
    try {
      const response = await fetch(`/api/crm/contacts/${contactId}`);
      const data = await response.json();
      if (data.success && data.contact) {
        setDrawerDefaultTab('details');
        setSelectedContact(data.contact);
        router.replace('/business-os/crm', { scroll: false });
      }
    } catch (error) {
      logger.error({ err: error, contactId }, 'Failed to fetch contact by ID');
    }
  };

  // Reset and fetch when search changes
  useEffect(() => {
    setContacts([]);
    setHasMore(true);
    fetchContacts(0, true);
  }, [searchQuery]);

  const fetchPipelineStages = async () => {
    try {
      const response = await fetch('/api/crm/pipeline-stages');
      const data = await response.json();
      if (data.success) {
        setPipelineStages(data.stages || []);
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch pipeline stages');
    }
  };

  const fetchCapabilities = async () => {
    try {
      const response = await fetch('/api/capabilities');
      const data = await response.json();
      if (data.success) {
        setEnabledCapabilities(data.enabledKeys || []);
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch capabilities');
    }
  };

  const fetchContacts = async (offset: number = 0, reset: boolean = false, silent: boolean = false) => {
    try {
      if (!silent) {
        if (reset) {
          setLoading(true);
        } else {
          setLoadingMore(true);
        }
      }

      const params = new URLSearchParams();
      if (searchQuery) params.set('search', searchQuery);
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(offset));

      const response = await fetch(`/api/crm/contacts?${params}`);
      const data = await response.json();

      if (data.success) {
        const newContacts = data.contacts || [];
        if (reset) {
          setContacts(newContacts);
        } else {
          setContacts(prev => [...prev, ...newContacts]);
        }
        // If we got fewer items than PAGE_SIZE, no more data
        setHasMore(newContacts.length === PAGE_SIZE);
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch contacts');
    } finally {
      if (!silent) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };

  const loadMore = useCallback(() => {
    if (!loadingMore && hasMore) {
      fetchContacts(contacts.length, false);
    }
  }, [loadingMore, hasMore, contacts.length]);

  const handleContactCreated = () => {
    setIsNewContactModalOpen(false);
    fetchContacts(0, true);
  };

  const handleContactUpdated = () => {
    setSelectedContact(null);
    fetchContacts(0, true);
  };

  const handleContactClick = (contact: CRMContact) => {
    setSelectedContact(contact);
  };

  const handleExportCSV = () => {
    if (contacts.length === 0) return;

    // Define CSV headers
    const headers = [
      t('crm.export.first_name'),
      t('crm.export.last_name'),
      t('crm.export.email'),
      t('crm.export.phone'),
      t('crm.export.stage'),
      t('crm.export.source'),
      t('crm.export.tags'),
      t('crm.export.created_at')
    ];

    // Map contacts to CSV rows
    const rows = contacts.map(contact => [
      contact.first_name || '',
      contact.last_name || '',
      contact.email || '',
      contact.phone || '',
      contact.stage || '',
      contact.source || '',
      (contact.tags || []).join('; '),
      contact.created_at ? new Date(contact.created_at).toLocaleDateString() : ''
    ]);

    // Create CSV content
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    // Create and trigger download
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `contacts_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className="min-h-screen bg-[var(--v2-bg)]">
      <BusinessOSHeader />

      {/* Main Content with max-width like dashboard */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-8">

        {/* Page Header with purple theme (CRM capability color) */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'rgba(139, 92, 246, 0.2)' }}>
              <Users className="w-6 h-6" style={{ color: '#8B5CF6' }} />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-[var(--v2-text-primary)]">{t('capability.crm.name')}</h1>
              <p className="text-sm text-[var(--v2-text-secondary)] mt-1">{t('crm.subtitle')}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Back to Dashboard */}
            <button
              onClick={() => router.push('/business-os')}
              className="p-2 text-[var(--v2-text-secondary)] bg-[var(--v2-surface)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] hover:text-[var(--v2-text-primary)] transition-all"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              title={t('crm.back_to_dashboard')}
            >
              <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
            </button>

            <div className="relative">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--v2-text-muted)]" />
              <input
                type="text"
                placeholder={t('crm.search_placeholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="ps-10 pe-4 py-2 w-64 bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:ring-2 focus:ring-[#8B5CF6] transition-all"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              />
            </div>
            {/* Export CSV Button */}
            <button
              onClick={handleExportCSV}
              disabled={contacts.length === 0}
              className="flex items-center gap-2 px-4 py-2 text-[var(--v2-text-secondary)] text-sm font-medium bg-[var(--v2-surface)] border border-[var(--v2-border)] transition-all hover:bg-[var(--v2-surface-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              title={t('crm.export.tooltip')}
            >
              <Download className="h-4 w-4" />
              {t('crm.export.button')}
            </button>

            {/* View Mode Tabs */}
            <div
              className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-1 inline-flex gap-1"
              style={{ borderRadius: 'var(--v2-radius-card)' }}
            >
              <button
                className={`p-2 transition-all border ${
                  viewMode === 'pipeline'
                    ? 'text-[#8B5CF6] border-[#8B5CF6] bg-[#8B5CF6]/10'
                    : 'text-[var(--v2-text-secondary)] border-transparent hover:text-[var(--v2-text-primary)]'
                }`}
                style={{ borderRadius: 'var(--v2-radius-button)' }}
                onClick={() => setViewMode('pipeline')}
                title={t('crm.tab_pipeline')}
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                className={`p-2 transition-all border ${
                  viewMode === 'contacts'
                    ? 'text-[#8B5CF6] border-[#8B5CF6] bg-[#8B5CF6]/10'
                    : 'text-[var(--v2-text-secondary)] border-transparent hover:text-[var(--v2-text-primary)]'
                }`}
                style={{ borderRadius: 'var(--v2-radius-button)' }}
                onClick={() => setViewMode('contacts')}
                title={t('crm.tab_contacts')}
              >
                <List className="h-4 w-4" />
              </button>
            </div>

            <button
              onClick={() => setIsNewContactModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 text-[#8B5CF6] text-sm font-medium border border-[#8B5CF6] bg-[#8B5CF6]/10 hover:bg-[#8B5CF6]/20 transition-all"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              <Plus className="h-4 w-4" />
              {t('crm.add_contact')}
            </button>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 border-4 border-t-transparent rounded-full animate-spin mx-auto" style={{ borderColor: '#8B5CF6', borderTopColor: 'transparent' }}></div>
              <p className="text-[var(--v2-text-secondary)] font-medium">{t('crm.loading')}</p>
            </div>
          </div>
        ) : (
          <>
            {viewMode === 'pipeline' && (
              <CRMPipelineView
                contacts={contacts}
                stages={pipelineStages}
                onContactClick={handleContactClick}
                onContactUpdated={() => fetchContacts(0, true, true)}
              />
            )}
            {viewMode === 'contacts' && (
              <CRMContactList
                contacts={contacts}
                onContactClick={handleContactClick}
                onLoadMore={loadMore}
                hasMore={hasMore}
                loadingMore={loadingMore}
                onContactsUpdated={() => fetchContacts(0, true)}
              />
            )}
          </>
        )}
      </div>

      {/* Contact Edit Drawer */}
      {selectedContact && (
        <CRMContactDrawer
          contact={selectedContact}
          stages={pipelineStages}
          enabledCapabilities={enabledCapabilities}
          isOpen={true}
          onClose={() => {
            setSelectedContact(null);
            setDrawerDefaultTab(undefined); // Reset default tab when closing
          }}
          onContactUpdated={handleContactUpdated}
          defaultTab={drawerDefaultTab}
        />
      )}

      {/* New Contact Modal */}
      {isNewContactModalOpen && (
        <CRMContactModal
          stages={pipelineStages}
          isOpen={true}
          onClose={() => setIsNewContactModalOpen(false)}
          onContactUpdated={handleContactCreated}
        />
      )}
    </div>
  );
}
