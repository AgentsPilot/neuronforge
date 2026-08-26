'use client';

import { useState, useEffect } from 'react';
import { X, CheckSquare, User, Calendar, AlertTriangle, ChevronDown, Check, Search, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { createLogger } from '@/lib/logger';
import type { CRMContact } from '@/lib/repositories/CRMContactRepository';
import type { CRMTask } from '@/lib/repositories/CRMTaskRepository';

const logger = createLogger({ module: 'CRMTaskModal' });

interface CRMTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTaskCreated?: () => void;
  preselectedContact?: CRMContact | null;
  taskToEdit?: CRMTask | null;
}

type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export function CRMTaskModal({
  isOpen,
  onClose,
  onTaskCreated,
  preselectedContact,
  taskToEdit
}: CRMTaskModalProps) {
  const { t, isRTL } = useLanguage();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [dueDate, setDueDate] = useState('');
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [selectedContactName, setSelectedContactName] = useState<string>('');
  const [contacts, setContacts] = useState<CRMContact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showContactDropdown, setShowContactDropdown] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const isEditMode = !!taskToEdit;

  // Track if contacts have been loaded
  const [contactsLoaded, setContactsLoaded] = useState(false);

  // Fetch contacts only when dropdown is first opened (lazy loading)
  useEffect(() => {
    if (showContactDropdown && !contactsLoaded && !preselectedContact) {
      fetchContacts().then(() => setContactsLoaded(true));
    }
  }, [showContactDropdown, contactsLoaded, preselectedContact]);

  // Reset contactsLoaded when modal closes
  useEffect(() => {
    if (!isOpen) {
      setContactsLoaded(false);
      setContacts([]);
    }
  }, [isOpen]);

  // Set preselected contact
  useEffect(() => {
    if (preselectedContact) {
      setSelectedContactId(preselectedContact.id);
      setSelectedContactName(`${preselectedContact.first_name} ${preselectedContact.last_name || ''}`.trim());
    } else {
      setSelectedContactId(null);
      setSelectedContactName('');
    }
  }, [preselectedContact]);

  // Reset form when modal opens or load task data when editing
  useEffect(() => {
    if (isOpen) {
      if (taskToEdit) {
        // Edit mode - populate with existing task data
        setTitle(taskToEdit.title || '');
        setDescription(taskToEdit.description || '');
        setPriority((taskToEdit.priority || 'medium') as TaskPriority);
        setDueDate(taskToEdit.due_date ? taskToEdit.due_date.split('T')[0] : '');
        if (taskToEdit.contact) {
          setSelectedContactId(taskToEdit.contact_id);
          setSelectedContactName(`${taskToEdit.contact.first_name} ${taskToEdit.contact.last_name || ''}`.trim());
        } else {
          setSelectedContactId(null);
          setSelectedContactName('');
        }
      } else {
        // Create mode - reset to defaults
        setTitle('');
        setDescription('');
        setPriority('medium');
        setDueDate('');
        if (!preselectedContact) {
          setSelectedContactId(null);
          setSelectedContactName('');
        }
      }
      setError(null);
      setContactSearch('');
      setShowContactDropdown(false);
    }
  }, [isOpen, taskToEdit, preselectedContact]);

  const fetchContacts = async () => {
    setLoadingContacts(true);
    try {
      // Fetch only 50 contacts for performance, users can search to find others
      const response = await fetch('/api/crm/contacts?limit=50');
      const data = await response.json();
      if (data.success) {
        setContacts(data.contacts || []);
      }
    } catch (err) {
      logger.error({ err }, 'Failed to fetch contacts');
    } finally {
      setLoadingContacts(false);
    }
  };

  const selectContact = (contact: CRMContact | null) => {
    if (contact) {
      setSelectedContactId(contact.id);
      setSelectedContactName(`${contact.first_name} ${contact.last_name || ''}`.trim());
    } else {
      setSelectedContactId(null);
      setSelectedContactName('');
    }
    setShowContactDropdown(false);
    setContactSearch('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setSaving(true);
    setError(null);

    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        priority,
        due_date: dueDate ? `${dueDate}T23:59:59.999Z` : null,
        contact_id: selectedContactId || null,
        ...(isEditMode ? {} : { status: 'pending' })
      };

      const url = isEditMode ? `/api/crm/tasks/${taskToEdit.id}` : '/api/crm/tasks';
      const method = isEditMode ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || data.details || `Failed to ${isEditMode ? 'update' : 'create'} task`);
      }

      onTaskCreated?.();
      onClose();
    } catch (err) {
      logger.error({ err }, `Failed to ${isEditMode ? 'update' : 'create'} task`);
      setError(err instanceof Error ? err.message : `Failed to ${isEditMode ? 'update' : 'create'} task`);
    } finally {
      setSaving(false);
    }
  };

  // Filter contacts based on search
  const filteredContacts = contacts.filter(contact => {
    if (!contactSearch) return true;
    const searchLower = contactSearch.toLowerCase();
    const fullName = `${contact.first_name} ${contact.last_name || ''}`.toLowerCase();
    return fullName.includes(searchLower) || (contact.email?.toLowerCase().includes(searchLower));
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="relative w-full max-w-md mx-4 bg-[var(--v2-bg)] border border-[var(--v2-border)] shadow-xl"
        style={{ borderRadius: 'var(--v2-radius-card)' }}
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--v2-border)]">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: 'rgba(139, 92, 246, 0.15)' }}
            >
              <CheckSquare className="w-5 h-5" style={{ color: '#8B5CF6' }} />
            </div>
            <h2 className="text-lg font-semibold text-[var(--v2-text-primary)]">
              {isEditMode ? (t('crm.task_modal.edit_title') || 'Edit Task') : (t('crm.task_modal.title') || 'New Task')}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface)] rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Task Title */}
          <div>
            <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-1.5">
              {t('crm.task_modal.task_title') || 'Task Title'} *
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('crm.task_modal.title_placeholder') || 'What needs to be done?'}
              className="w-full bg-[var(--v2-surface)] border-[var(--v2-border)] text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)]"
              autoFocus
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-1.5">
              {t('crm.task_modal.description') || 'Description'}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('crm.task_modal.description_placeholder') || 'Add details...'}
              rows={3}
              className="w-full px-3 py-2 text-sm rounded-md border bg-[var(--v2-surface)] border-[var(--v2-border)] text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:ring-2 focus:ring-[#8B5CF6] resize-none"
            />
          </div>

          {/* Contact Selection with Searchable Dropdown (only show if no preselected contact) */}
          {!preselectedContact && (
            <div>
              <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-1.5">
                <User className="w-4 h-4 inline me-1.5" />
                {t('crm.task_modal.contact') || 'Related Contact'}
              </label>

              <div className="relative">
                <button
                  type="button"
                  onClick={(e) => {
                    setShowContactDropdown(!showContactDropdown);
                  }}
                  className="w-full px-3 py-2.5 text-sm border border-[var(--v2-border)] bg-[var(--v2-surface)] rounded-lg flex items-center justify-between hover:border-[#8B5CF6] transition-colors"
                  id="contact-dropdown-button"
                >
                  <span className={selectedContactId ? 'text-[var(--v2-text-primary)]' : 'text-[var(--v2-text-muted)]'}>
                    {selectedContactName || (t('crm.task_modal.select_contact') || 'Select contact (optional)')}
                  </span>
                  <ChevronDown className={`w-4 h-4 text-[var(--v2-text-muted)] transition-transform ${showContactDropdown ? 'rotate-180' : ''}`} />
                </button>

                {showContactDropdown && (
                  <>
                    <div className="fixed inset-0 z-[60]" onClick={() => { setShowContactDropdown(false); setContactSearch(''); }} />
                    <div className="absolute z-[70] w-full mt-1 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg shadow-lg overflow-hidden max-h-[300px]">
                      {/* Search Input */}
                      <div className="p-2 border-b border-[var(--v2-border)]">
                        <div className="relative">
                          <Search className={`w-4 h-4 absolute ${isRTL ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 text-[var(--v2-text-muted)]`} />
                          <input
                            type="text"
                            value={contactSearch}
                            onChange={(e) => setContactSearch(e.target.value)}
                            placeholder={t('crm.task_modal.search_contacts') || 'Search contacts...'}
                            className={`w-full px-3 py-2 text-sm border border-[var(--v2-border)] bg-[var(--v2-bg)] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#8B5CF6] text-[var(--v2-text-primary)] ${isRTL ? 'pr-10' : 'pl-10'}`}
                            autoFocus
                          />
                        </div>
                      </div>

                      {/* Contact List */}
                      <div className="max-h-48 overflow-y-auto">
                        {/* No contact option */}
                        <button
                          type="button"
                          onClick={() => selectContact(null)}
                          className={`w-full px-4 py-2.5 text-sm flex items-center justify-between hover:bg-[var(--v2-bg)] ${
                            !selectedContactId ? 'bg-[var(--v2-bg)]' : ''
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-[var(--v2-border)] flex items-center justify-center">
                              <User className="w-4 h-4 text-[var(--v2-text-muted)]" />
                            </div>
                            <span className="text-[var(--v2-text-secondary)]">
                              {t('crm.task_modal.no_contact') || 'No contact (personal task)'}
                            </span>
                          </div>
                          {!selectedContactId && (
                            <Check className="w-4 h-4 text-[#8B5CF6]" />
                          )}
                        </button>

                        {loadingContacts ? (
                          <div className="px-4 py-3 flex items-center justify-center">
                            <Loader2 className="w-4 h-4 animate-spin text-[#8B5CF6]" />
                          </div>
                        ) : filteredContacts.length === 0 ? (
                          <div className="px-4 py-3 text-sm text-[var(--v2-text-muted)]">
                            {contactSearch
                              ? (t('crm.task_modal.no_matching_contacts') || 'No matching contacts')
                              : (t('crm.task_modal.no_contacts_found') || 'No contacts found')
                            }
                          </div>
                        ) : (
                          filteredContacts.map((contact) => (
                            <button
                              key={contact.id}
                              type="button"
                              onClick={() => selectContact(contact)}
                              className={`w-full px-4 py-2.5 text-sm flex items-center justify-between hover:bg-[var(--v2-bg)] ${
                                selectedContactId === contact.id ? 'bg-[var(--v2-bg)]' : ''
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-full bg-[#8B5CF6]/10 flex items-center justify-center">
                                  <span className="text-xs font-medium text-[#8B5CF6]">
                                    {contact.first_name?.charAt(0).toUpperCase() || '?'}
                                  </span>
                                </div>
                                <div className="text-start">
                                  <p className="font-medium text-[var(--v2-text-primary)]">
                                    {contact.first_name} {contact.last_name || ''}
                                  </p>
                                  {contact.email && (
                                    <p className="text-xs text-[var(--v2-text-muted)]">{contact.email}</p>
                                  )}
                                </div>
                              </div>
                              {selectedContactId === contact.id && (
                                <Check className="w-4 h-4 text-[#8B5CF6]" />
                              )}
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Show preselected contact info (read-only) */}
          {preselectedContact && (
            <div>
              <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-1.5">
                <User className="w-4 h-4 inline me-1.5" />
                {t('crm.task_modal.contact') || 'Related Contact'}
              </label>
              <div className="flex items-center gap-2 p-3 bg-[var(--v2-surface)] rounded-lg border border-[var(--v2-border)]">
                <div className="w-8 h-8 rounded-full bg-[#8B5CF6]/20 flex items-center justify-center">
                  <User className="w-4 h-4 text-[#8B5CF6]" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--v2-text-primary)]">
                    {preselectedContact.first_name} {preselectedContact.last_name || ''}
                  </p>
                  {preselectedContact.email && (
                    <p className="text-xs text-[var(--v2-text-muted)]">
                      {preselectedContact.email}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Due Date & Priority Row */}
          <div className="grid grid-cols-2 gap-4">
            {/* Due Date */}
            <div>
              <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-1.5">
                <Calendar className="w-4 h-4 inline me-1.5" />
                {t('crm.task_modal.due_date') || 'Due Date'}
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="date-input-fix w-full h-10 px-3 py-2 text-sm rounded-md border bg-[var(--v2-surface)] border-[var(--v2-border)] text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#8B5CF6]"
              />
              <style jsx>{`
                .date-input-fix {
                  color-scheme: light;
                }
                :global(.dark) .date-input-fix,
                :global(html.dark) .date-input-fix {
                  color-scheme: dark;
                }
                :global(.dark) .date-input-fix::-webkit-calendar-picker-indicator,
                :global(html.dark) .date-input-fix::-webkit-calendar-picker-indicator {
                  filter: invert(1) brightness(0.8);
                  cursor: pointer;
                }
              `}</style>
            </div>

            {/* Priority */}
            <div>
              <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-1.5">
                <AlertTriangle className="w-4 h-4 inline me-1.5" />
                {t('crm.task_modal.priority') || 'Priority'}
              </label>
              <Select
                key={`priority-select-${taskToEdit?.id || 'new'}-${priority}`}
                defaultValue={priority}
                onValueChange={(v) => setPriority(v as TaskPriority)}
              >
                <SelectTrigger className="w-full bg-[var(--v2-surface)] border-[var(--v2-border)] text-[var(--v2-text-primary)]">
                  <SelectValue placeholder={t('crm.task_modal.priority') || 'Priority'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">{t('crm.tasks.priority_low') || 'Low'}</SelectItem>
                  <SelectItem value="medium">{t('crm.tasks.priority_medium') || 'Medium'}</SelectItem>
                  <SelectItem value="high">{t('crm.tasks.priority_high') || 'High'}</SelectItem>
                  <SelectItem value="urgent">{t('crm.tasks.priority_urgent') || 'Urgent'}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
              <p className="text-sm text-red-500">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={saving}
              className="border-[var(--v2-border)] text-[var(--v2-text-secondary)]"
            >
              {t('common.cancel') || 'Cancel'}
            </Button>
            <Button
              type="submit"
              disabled={!title.trim() || saving}
              className="bg-[#8B5CF6] hover:bg-[#7C3AED] text-white"
            >
              {saving
                ? (t('common.saving') || 'Saving...')
                : isEditMode
                  ? (t('crm.task_modal.update') || 'Update Task')
                  : (t('crm.task_modal.create') || 'Create Task')
              }
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
