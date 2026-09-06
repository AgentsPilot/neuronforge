'use client';

import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Download, Trash2, Tag, X, Check, ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import type { CRMContact } from '@/lib/repositories/CRMContactRepository';
import type { CRMPipelineStage } from '@/lib/repositories/CRMPipelineStagesRepository';

interface CRMContactListProps {
  contacts: CRMContact[];
  stages?: CRMPipelineStage[];
  onContactClick: (contact: CRMContact) => void;
  onContactsUpdated?: () => void;
  // Pagination props
  currentPage?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;
}

const STAGE_COLORS: Record<string, string> = {
  lead: 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
  client: 'bg-green-500/20 text-green-600 dark:text-green-400',
  past_client: 'bg-slate-500/20 text-slate-600 dark:text-slate-400'
};

export function CRMContactList({
  contacts,
  stages = [],
  onContactClick,
  onContactsUpdated,
  currentPage = 1,
  totalPages = 1,
  onPageChange
}: CRMContactListProps) {
  const { t } = useLanguage();

  // Get stage label from stages array (uses stage_label from DB which is the source of truth)
  const getStageLabel = (stageKey: string | undefined): string => {
    if (!stageKey) return '-';
    const stage = stages.find(s => s.stage_key === stageKey);
    return stage?.stage_label || stageKey;
  };

  // Get stage color from stages array, fall back to default colors
  const getStageColor = (stageKey: string | undefined): string => {
    if (!stageKey) return 'bg-slate-500/20 text-slate-600 dark:text-slate-400';
    const stage = stages.find(s => s.stage_key === stageKey);
    if (stage?.color) {
      // Convert hex color to tailwind-like classes
      return `bg-[${stage.color}]/20 text-[${stage.color}]`;
    }
    // Fall back to default stage colors based on stage_type
    if (stage?.stage_type === 'lead') return 'bg-blue-500/20 text-blue-600 dark:text-blue-400';
    if (stage?.stage_type === 'prospect') return 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400';
    if (stage?.stage_type === 'client') return 'bg-green-500/20 text-green-600 dark:text-green-400';
    if (stage?.stage_type === 'past_client') return 'bg-slate-500/20 text-slate-600 dark:text-slate-400';
    // Fall back to STAGE_COLORS for legacy compatibility
    return STAGE_COLORS[stageKey] || 'bg-slate-500/20 text-slate-600 dark:text-slate-400';
  };
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showTagInput, setShowTagInput] = useState(false);
  const [bulkTag, setBulkTag] = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);
  const [sortColumn, setSortColumn] = useState<'name' | 'email' | 'phone' | 'stage' | 'updated_at'>('updated_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Clear selection when contacts change
  useEffect(() => {
    setSelectedIds(new Set());
  }, [contacts]);

  // Sort contacts
  const sortedContacts = [...contacts].sort((a, b) => {
    let comparison = 0;
    switch (sortColumn) {
      case 'name':
        const nameA = `${a.first_name || ''} ${a.last_name || ''}`.toLowerCase().trim();
        const nameB = `${b.first_name || ''} ${b.last_name || ''}`.toLowerCase().trim();
        comparison = nameA.localeCompare(nameB);
        break;
      case 'email':
        comparison = (a.email || '').localeCompare(b.email || '');
        break;
      case 'phone':
        comparison = (a.phone || '').localeCompare(b.phone || '');
        break;
      case 'stage':
        comparison = (a.stage || '').localeCompare(b.stage || '');
        break;
      case 'updated_at':
        comparison = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
        break;
    }
    return sortDirection === 'asc' ? comparison : -comparison;
  });

  const handleSort = (column: typeof sortColumn) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const SortIcon = ({ column }: { column: typeof sortColumn }) => {
    if (sortColumn !== column) {
      return <ArrowUpDown className="h-3 w-3 opacity-50" />;
    }
    return sortDirection === 'asc'
      ? <ArrowUp className="h-3 w-3" />
      : <ArrowDown className="h-3 w-3" />;
  };

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
      <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] overflow-hidden" style={{ borderRadius: (totalPages > 1 && onPageChange) ? 'var(--v2-radius-card) var(--v2-radius-card) 0 0' : 'var(--v2-radius-card)' }}>
        <div className="overflow-x-auto">
          <table className="w-full" style={{ fontFamily: 'var(--font-sans, "Heebo", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)' }}>
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
                <th
                  className="px-4 py-3 text-start text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wider cursor-pointer hover:text-[var(--v2-text-primary)] transition-colors"
                  onClick={() => handleSort('name')}
                >
                  <div className="flex items-center gap-1">
                    {t('crm.table.name')}
                    <SortIcon column="name" />
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-start text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wider cursor-pointer hover:text-[var(--v2-text-primary)] transition-colors"
                  onClick={() => handleSort('email')}
                >
                  <div className="flex items-center gap-1">
                    {t('crm.table.email')}
                    <SortIcon column="email" />
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-start text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wider cursor-pointer hover:text-[var(--v2-text-primary)] transition-colors"
                  onClick={() => handleSort('phone')}
                >
                  <div className="flex items-center gap-1">
                    {t('crm.table.phone')}
                    <SortIcon column="phone" />
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-start text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wider cursor-pointer hover:text-[var(--v2-text-primary)] transition-colors"
                  onClick={() => handleSort('stage')}
                >
                  <div className="flex items-center gap-1">
                    {t('crm.table.stage')}
                    <SortIcon column="stage" />
                  </div>
                </th>
                <th className="px-4 py-3 text-start text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wider">
                  {t('crm.table.tags')}
                </th>
                <th
                  className="px-4 py-3 text-start text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wider cursor-pointer hover:text-[var(--v2-text-primary)] transition-colors"
                  onClick={() => handleSort('updated_at')}
                >
                  <div className="flex items-center gap-1">
                    {t('crm.table.last_contact')}
                    <SortIcon column="updated_at" />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="bg-[var(--v2-surface)] divide-y divide-[var(--v2-border)]">
              {sortedContacts.map(contact => (
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
                    <span className="text-sm font-medium text-[var(--v2-text-primary)]">
                      {contact.first_name} {contact.last_name}
                    </span>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <span className="text-sm text-[var(--v2-text-primary)]">
                      {contact.email || '-'}
                    </span>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <span className="text-sm text-[var(--v2-text-primary)]">
                      {contact.phone || '-'}
                    </span>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <Badge className={`text-sm ${getStageColor(contact.stage)}`}>
                      {getStageLabel(contact.stage)}
                    </Badge>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex flex-wrap gap-1">
                      {contact.tags && contact.tags.length > 0 ? (
                        <>
                          {contact.tags.slice(0, 2).map(tag => (
                            <Badge key={tag} variant="outline" className="text-sm">
                              {tag}
                            </Badge>
                          ))}
                          {contact.tags.length > 2 && (
                            <Badge variant="outline" className="text-sm">
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
                    <span className="text-sm text-[var(--v2-text-primary)]">
                      {formatTimeAgo(contact.updated_at)}
                    </span>
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
        </div>
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && onPageChange && (
        <div className="flex items-center justify-between px-4 py-3 border border-[var(--v2-border)] border-t-0 bg-[var(--v2-surface)]" style={{ borderRadius: '0 0 var(--v2-radius-card) var(--v2-radius-card)' }}>
          <div className="text-sm text-[var(--v2-text-muted)]">
            {t('crm.pagination.page')} {currentPage} {t('crm.pagination.of')} {totalPages}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage <= 1}
              className="h-8 px-2"
            >
              <ChevronLeft className="h-4 w-4" />
              <span className="hidden sm:inline ms-1">{t('crm.pagination.prev')}</span>
            </Button>
            <div className="hidden sm:flex items-center gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (currentPage <= 3) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }
                return (
                  <Button
                    key={pageNum}
                    variant={currentPage === pageNum ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => onPageChange(pageNum)}
                    className={`h-8 w-8 p-0 ${currentPage === pageNum ? 'bg-[#8B5CF6] hover:bg-[#7C3AED] text-white' : ''}`}
                  >
                    {pageNum}
                  </Button>
                );
              })}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage >= totalPages}
              className="h-8 px-2"
            >
              <span className="hidden sm:inline me-1">{t('crm.pagination.next')}</span>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

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
