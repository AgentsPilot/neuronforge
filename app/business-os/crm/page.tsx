'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CRMPipelineView } from '@/components/crm/CRMPipelineView';
import { CRMContactList } from '@/components/crm/CRMContactList';
import { CRMTaskList } from '@/components/crm/CRMTaskList';
import { CRMContactModal } from '@/components/crm/CRMContactModal';
import { CRMTaskModal } from '@/components/crm/CRMTaskModal';
import { CRMContactDrawerV2 } from '@/components/crm/contact-drawer';
import { Plus, Search, Users, Download, LayoutGrid, List, CheckSquare } from 'lucide-react';
import { createLogger } from '@/lib/logger';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import type { CRMContact } from '@/lib/repositories/CRMContactRepository';
import type { CRMPipelineStage } from '@/lib/repositories/CRMPipelineStagesRepository';
import { PAGE_CONTAINER } from '@/lib/business-os/pageContainer';

const logger = createLogger({ module: 'CRMPage' });

type ViewMode = 'pipeline' | 'contacts' | 'tasks';

export default function CRMPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLanguage();
  const [viewMode, setViewMode] = useState<ViewMode>('pipeline');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedContact, setSelectedContact] = useState<CRMContact | null>(null);
  const [isNewContactModalOpen, setIsNewContactModalOpen] = useState(false);
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false);
  const [taskToEdit, setTaskToEdit] = useState<any>(null);
  const [taskListKey, setTaskListKey] = useState(0); // For refreshing task list
  const [contacts, setContacts] = useState<CRMContact[]>([]); // All contacts for pipeline view
  const [pipelineStages, setPipelineStages] = useState<CRMPipelineStage[]>([]);
  const [enabledCapabilities, setEnabledCapabilities] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerDefaultTab, setDrawerDefaultTab] = useState<'details' | 'tasks' | undefined>(undefined);
  // Pagination state for contacts list view
  const [currentPage, setCurrentPage] = useState(1);
  const [totalContacts, setTotalContacts] = useState(0);
  const PAGE_SIZE = 10;

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
    setCurrentPage(1);
    fetchContacts();
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

  // Fetch ALL contacts (for pipeline view and total count)
  const fetchContacts = async (silent: boolean = false) => {
    try {
      if (!silent) {
        setLoading(true);
      }

      const params = new URLSearchParams();
      if (searchQuery) params.set('search', searchQuery);
      // No limit - fetch all contacts for pipeline view

      const response = await fetch(`/api/crm/contacts?${params}`);
      const data = await response.json();

      if (data.success) {
        const allContacts = data.contacts || [];
        setContacts(allContacts);
        setTotalContacts(allContacts.length);
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch contacts');
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  // Get paginated contacts for list view
  const paginatedContacts = contacts.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );
  const totalPages = Math.ceil(totalContacts / PAGE_SIZE);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handleContactCreated = () => {
    setIsNewContactModalOpen(false);
    fetchContacts();
  };

  const handleContactUpdated = () => {
    setSelectedContact(null);
    fetchContacts();
  };

  const handleContactClick = (contact: CRMContact) => {
    setDrawerDefaultTab('details');
    setSelectedContact(contact);
  };

  const handleContactClickFromTaskList = (contact: CRMContact) => {
    setDrawerDefaultTab('tasks');
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

      {/* Main Content with max-width like dashboard */}
      <div className={`${PAGE_CONTAINER} py-6 sm:py-8 space-y-8`}>

        {/* Page Header with purple theme (CRM capability color) */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(139, 92, 246, 0.2)' }}>
              <Users className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: '#8B5CF6' }} />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-semibold text-[var(--v2-text-primary)] truncate">{t('capability.crm.name')}</h1>
              <p className="text-xs sm:text-sm text-[var(--v2-text-secondary)] mt-0.5 sm:mt-1 hidden sm:block">{t('crm.subtitle')}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto overflow-x-auto pb-2 sm:pb-0">
            <div className="relative hidden md:block">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--v2-text-muted)]" />
              <input
                type="text"
                placeholder={
                  viewMode === 'tasks'
                    ? (t('crm.tasks.search_placeholder') || 'Search tasks...')
                    : t('crm.search_placeholder')
                }
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="ps-10 pe-4 py-2 w-48 lg:w-64 bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:ring-2 focus:ring-[#8B5CF6] transition-all"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              />
            </div>
            {/* Export CSV Button */}
            <button
              onClick={handleExportCSV}
              disabled={contacts.length === 0}
              className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 text-[var(--v2-text-secondary)] text-xs sm:text-sm font-medium bg-[var(--v2-surface)] border border-[var(--v2-border)] transition-all hover:bg-[var(--v2-surface-hover)] disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              title={t('crm.export.tooltip')}
            >
              <Download className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">{t('crm.export.button')}</span>
            </button>

            {/* View Mode Tabs */}
            <div
              className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-0.5 sm:p-1 inline-flex gap-0.5 sm:gap-1 flex-shrink-0"
              style={{ borderRadius: 'var(--v2-radius-card)' }}
            >
              <button
                className={`p-1.5 sm:p-2 transition-all border ${
                  viewMode === 'pipeline'
                    ? 'text-[#8B5CF6] border-[#8B5CF6] bg-[#8B5CF6]/10'
                    : 'text-[var(--v2-text-secondary)] border-transparent hover:text-[var(--v2-text-primary)]'
                }`}
                style={{ borderRadius: 'var(--v2-radius-button)' }}
                onClick={() => setViewMode('pipeline')}
                title={t('crm.tab_pipeline')}
              >
                <LayoutGrid className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </button>
              <button
                className={`p-1.5 sm:p-2 transition-all border ${
                  viewMode === 'contacts'
                    ? 'text-[#8B5CF6] border-[#8B5CF6] bg-[#8B5CF6]/10'
                    : 'text-[var(--v2-text-secondary)] border-transparent hover:text-[var(--v2-text-primary)]'
                }`}
                style={{ borderRadius: 'var(--v2-radius-button)' }}
                onClick={() => setViewMode('contacts')}
                title={t('crm.tab_contacts')}
              >
                <List className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </button>
              <button
                className={`p-1.5 sm:p-2 transition-all border ${
                  viewMode === 'tasks'
                    ? 'text-[#8B5CF6] border-[#8B5CF6] bg-[#8B5CF6]/10'
                    : 'text-[var(--v2-text-secondary)] border-transparent hover:text-[var(--v2-text-primary)]'
                }`}
                style={{ borderRadius: 'var(--v2-radius-button)' }}
                onClick={() => setViewMode('tasks')}
                title={t('crm.tab_tasks')}
              >
                <CheckSquare className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </button>
            </div>

            {viewMode === 'tasks' ? (
              <button
                onClick={() => setIsNewTaskModalOpen(true)}
                className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 text-[#8B5CF6] text-xs sm:text-sm font-medium border border-[#8B5CF6] bg-[#8B5CF6]/10 hover:bg-[#8B5CF6]/20 transition-all whitespace-nowrap"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                <span className="hidden xs:inline">{t('crm.tasks.add_task')}</span>
                <span className="xs:hidden">{t('crm.add_short')}</span>
              </button>
            ) : (
              <button
                onClick={() => setIsNewContactModalOpen(true)}
                className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 text-[#8B5CF6] text-xs sm:text-sm font-medium border border-[#8B5CF6] bg-[#8B5CF6]/10 hover:bg-[#8B5CF6]/20 transition-all whitespace-nowrap"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                <span className="hidden xs:inline">{t('crm.add_contact')}</span>
                <span className="xs:hidden">{t('crm.add_short')}</span>
              </button>
            )}
          </div>
        </div>

        {/* Mobile Search Bar - Only visible on mobile */}
        <div className="md:hidden relative">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--v2-text-muted)]" />
          <input
            type="text"
            placeholder={
              viewMode === 'tasks'
                ? (t('crm.tasks.search_placeholder') || 'Search tasks...')
                : t('crm.search_placeholder')
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="ps-10 pe-4 py-2 w-full bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:ring-2 focus:ring-[#8B5CF6] transition-all"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          />
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
                onContactUpdated={() => fetchContacts(true)}
              />
            )}
            {viewMode === 'contacts' && (
              <CRMContactList
                contacts={paginatedContacts}
                stages={pipelineStages}
                onContactClick={handleContactClick}
                onContactsUpdated={() => fetchContacts()}
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={handlePageChange}
              />
            )}
            {viewMode === 'tasks' && (
              <CRMTaskList
                key={taskListKey}
                onContactClick={handleContactClickFromTaskList}
                onTaskClick={(task) => setTaskToEdit(task)}
                onTasksUpdated={() => setTaskListKey(prev => prev + 1)}
                searchQuery={searchQuery}
              />
            )}
          </>
        )}
      </div>

      {/* Contact Edit Drawer */}
      {selectedContact && (
        <CRMContactDrawerV2
          contact={selectedContact}
          stages={pipelineStages}
          enabledCapabilities={enabledCapabilities}
          isOpen={true}
          onClose={() => {
            setSelectedContact(null);
            setDrawerDefaultTab(undefined); // Reset default tab when closing
          }}
          onContactUpdated={handleContactUpdated}
          onTasksUpdated={() => setTaskListKey(prev => prev + 1)}
          initialSection={drawerDefaultTab || 'details'}
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

      {/* New/Edit Task Modal */}
      <CRMTaskModal
        isOpen={isNewTaskModalOpen || !!taskToEdit}
        onClose={() => {
          setIsNewTaskModalOpen(false);
          setTaskToEdit(null);
        }}
        onTaskCreated={() => {
          setTaskListKey(prev => prev + 1); // Refresh task list
          setTaskToEdit(null);
        }}
        taskToEdit={taskToEdit}
      />
    </div>
  );
}
