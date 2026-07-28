'use client';

import { useState, useEffect, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Download, Trash2, Tag, X, Check } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import type { CRMContact } from '@/lib/repositories/CRMContactRepository';

interface CRMContactListProps {
  contacts: CRMContact[];
  onContactClick: (contact: CRMContact) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  onContactsUpdated?: () => void;
}

const STAGE_COLORS: Record<string, string> = {
  lead: 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
  client: 'bg-green-500/20 text-green-600 dark:text-green-400',
  past_client: 'bg-slate-500/20 text-slate-600 dark:text-slate-400'
};

export function CRMContactList({
  contacts,
  onContactClick,
  onLoadMore,
  hasMore = false,
  loadingMore = false,
  onContactsUpdated
}: CRMContactListProps) {
  const { t } = useLanguage();
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showTagInput, setShowTagInput] = useState(false);
  const [bulkTag, setBulkTag] = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);

  // Intersection Observer for infinite scroll
  useEffect(() => {
    if (!onLoadMore || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          onLoadMore();
        }
      },
      { threshold: 0.1 }
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => observer.disconnect();
  }, [onLoadMore, hasMore, loadingMore]);

  // Clear selection when contacts change
  useEffect(() => {
    setSelectedIds(new Set());
  }, [contacts]);

  const formatTimeAgo = (date: string) => {
    const seconds = Math.floor((new Date().getTime() - new Date(date).getTime()) / 1000);
    if (seconds < 60) return t('crm.pipeline.just_now');
    if (seconds < 3600) return `${Math.floor(seconds / 60)} ${t('crm.table.min_ago')}`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} ${t('crm.table.hours_ago')}`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)} ${t('crm.table.days_ago')}`;
    return new Date(date).toLocaleDateString();
  };

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === contacts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(contacts.map(c => c.id)));
    }
  };

  const handleBulkExport = () => {
    const selectedContacts = contacts.filter(c => selectedIds.has(c.id));
    if (selectedContacts.length === 0) return;

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

    const rows = selectedContacts.map(contact => [
      contact.first_name || '',
      contact.last_name || '',
      contact.email || '',
      contact.phone || '',
      contact.stage || '',
      contact.source || '',
      (contact.tags || []).join('; '),
      contact.created_at ? new Date(contact.created_at).toLocaleDateString() : ''
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `contacts_selected_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);

    setSelectedIds(new Set());
  };

  const handleBulkTag = async () => {
    if (!bulkTag.trim() || selectedIds.size === 0) return;

    setBulkLoading(true);
    try {
      const promises = Array.from(selectedIds).map(id => {
        const contact = contacts.find(c => c.id === id);
        if (!contact) return Promise.resolve();

        const existingTags = contact.tags || [];
        if (existingTags.includes(bulkTag.trim())) return Promise.resolve();

        return fetch(`/api/crm/contacts/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tags: [...existingTags, bulkTag.trim()] })
        });
      });

      await Promise.all(promises);
      setBulkTag('');
      setShowTagInput(false);
      setSelectedIds(new Set());
      onContactsUpdated?.();
    } catch (error) {
      console.error('Failed to add tag:', error);
    } finally {
      setBulkLoading(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(t('crm.bulk.delete_confirm').replace('{count}', String(selectedIds.size)))) return;

    setBulkLoading(true);
    try {
      const promises = Array.from(selectedIds).map(id =>
        fetch(`/api/crm/contacts/${id}`, { method: 'DELETE' })
      );

      await Promise.all(promises);
      setSelectedIds(new Set());
      onContactsUpdated?.();
    } catch (error) {
      console.error('Failed to delete contacts:', error);
    } finally {
      setBulkLoading(false);
    }
  };

  const selectedCount = selectedIds.size;

  return (
    <div>
      <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] overflow-hidden" style={{ borderRadius: 'var(--v2-radius-card)' }}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-[var(--v2-bg)] border-b border-[var(--v2-border)]">
              <tr>
                <th className="px-4 py-3 text-start">
                  <input
                    type="checkbox"
                    checked={contacts.length > 0 && selectedIds.size === contacts.length}
                    onChange={toggleSelectAll}
                    className="rounded border-[var(--v2-border)] text-[#8B5CF6] focus:ring-[#8B5CF6]"
                  />
                </th>
                <th className="px-4 py-3 text-start text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wider">
                  {t('crm.table.name')}
                </th>
                <th className="px-4 py-3 text-start text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wider">
                  {t('crm.table.email')}
                </th>
                <th className="px-4 py-3 text-start text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wider">
                  {t('crm.table.phone')}
                </th>
                <th className="px-4 py-3 text-start text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wider">
                  {t('crm.table.stage')}
                </th>
                <th className="px-4 py-3 text-start text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wider">
                  {t('crm.table.tags')}
                </th>
                <th className="px-4 py-3 text-start text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wider">
                  {t('crm.table.last_contact')}
                </th>
              </tr>
            </thead>
            <tbody className="bg-[var(--v2-surface)] divide-y divide-[var(--v2-border)]">
              {contacts.map(contact => (
                <tr
                  key={contact.id}
                  onClick={() => onContactClick(contact)}
                  className={`hover:bg-[var(--v2-surface-hover)] cursor-pointer transition-colors ${
                    selectedIds.has(contact.id) ? 'bg-[#8B5CF6]/5' : ''
                  }`}
                >
                  <td className="px-4 py-4" onClick={(e) => toggleSelect(contact.id, e)}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(contact.id)}
                      onChange={() => {}}
                      className="rounded border-[var(--v2-border)] text-[#8B5CF6] focus:ring-[#8B5CF6]"
                    />
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <div className="font-medium text-[var(--v2-text-primary)]">
                      {contact.first_name} {contact.last_name}
                    </div>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <div className="text-sm text-[var(--v2-text-secondary)]">
                      {contact.email || '-'}
                    </div>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <div className="text-sm text-[var(--v2-text-secondary)]">
                      {contact.phone || '-'}
                    </div>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <Badge className={STAGE_COLORS[contact.stage]}>
                      {t(`crm.stage.${contact.stage}`)}
                    </Badge>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex flex-wrap gap-1">
                      {contact.tags && contact.tags.length > 0 ? (
                        <>
                          {contact.tags.slice(0, 2).map(tag => (
                            <Badge key={tag} variant="outline" className="text-xs">
                              {tag}
                            </Badge>
                          ))}
                          {contact.tags.length > 2 && (
                            <Badge variant="outline" className="text-xs">
                              +{contact.tags.length - 2}
                            </Badge>
                          )}
                        </>
                      ) : (
                        <span className="text-sm text-[var(--v2-text-muted)]">-</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <div className="text-sm text-[var(--v2-text-muted)]">
                      {formatTimeAgo(contact.updated_at)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {contacts.length === 0 && (
            <div className="text-center py-12 text-[var(--v2-text-muted)]">
              {t('crm.table.no_contacts')}
            </div>
          )}

          {/* Infinite Scroll Trigger & Loading */}
          {contacts.length > 0 && (
            <div ref={loadMoreRef} className="py-4">
              {loadingMore && (
                <div className="flex items-center justify-center gap-2 text-[var(--v2-text-muted)]">
                  <div className="w-5 h-5 border-2 border-[#8B5CF6] border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm">{t('crm.table.loading_more')}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Floating Bulk Actions Bar */}
      {selectedCount > 0 && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-6 py-3 bg-[var(--v2-surface)] border border-[var(--v2-border)] shadow-xl"
          style={{ borderRadius: 'var(--v2-radius-card)' }}
        >
          <span className="text-sm font-medium text-[var(--v2-text-primary)]">
            {t('crm.bulk.selected').replace('{count}', String(selectedCount))}
          </span>

          <div className="w-px h-6 bg-[var(--v2-border)]" />

          {/* Tag Input */}
          {showTagInput ? (
            <div className="flex items-center gap-2">
              <Input
                value={bulkTag}
                onChange={(e) => setBulkTag(e.target.value)}
                placeholder={t('crm.bulk.tag_placeholder')}
                className="w-32 h-8 text-sm bg-[var(--v2-bg)]"
                onKeyDown={(e) => e.key === 'Enter' && handleBulkTag()}
                disabled={bulkLoading}
              />
              <Button
                size="sm"
                onClick={handleBulkTag}
                disabled={!bulkTag.trim() || bulkLoading}
                className="h-8 px-2 text-[#8B5CF6] border border-[#8B5CF6] bg-[#8B5CF6]/10 hover:bg-[#8B5CF6]/20"
              >
                <Check className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setShowTagInput(false); setBulkTag(''); }}
                className="h-8 px-2"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowTagInput(true)}
                className="h-8 gap-1.5 text-[#8B5CF6] hover:bg-[#8B5CF6]/10"
                disabled={bulkLoading}
              >
                <Tag className="h-4 w-4" />
                {t('crm.bulk.add_tag')}
              </Button>

              <Button
                size="sm"
                variant="ghost"
                onClick={handleBulkExport}
                className="h-8 gap-1.5 text-[#8B5CF6] hover:bg-[#8B5CF6]/10"
                disabled={bulkLoading}
              >
                <Download className="h-4 w-4" />
                {t('crm.bulk.export')}
              </Button>

              <Button
                size="sm"
                variant="ghost"
                onClick={handleBulkDelete}
                className="h-8 gap-1.5 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                disabled={bulkLoading}
              >
                <Trash2 className="h-4 w-4" />
                {t('crm.bulk.delete')}
              </Button>
            </>
          )}

          <div className="w-px h-6 bg-[var(--v2-border)]" />

          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelectedIds(new Set())}
            className="h-8 px-2 text-[var(--v2-text-muted)]"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
