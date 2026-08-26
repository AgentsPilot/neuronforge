'use client';

import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Trash2, Check, ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown,
  Calendar, Clock, AlertCircle, CheckCircle2, Circle, User, Plus, Search
} from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import type { CRMTask, TaskPriority, TaskStatus } from '@/lib/repositories/CRMTaskRepository';
import type { CRMContact } from '@/lib/repositories/CRMContactRepository';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'CRMTaskList' });

interface CRMTaskListProps {
  onTaskClick?: (task: CRMTask) => void;
  onContactClick?: (contact: CRMContact) => void;
  onTasksUpdated?: () => void;
  onAddTask?: () => void;
  searchQuery?: string;
}

const PRIORITY_CONFIG: Record<TaskPriority, { color: string; label: string }> = {
  low: { color: 'bg-slate-500/20 text-slate-600 dark:text-slate-400', label: 'Low' },
  medium: { color: 'bg-blue-500/20 text-blue-600 dark:text-blue-400', label: 'Medium' },
  high: { color: 'bg-orange-500/20 text-orange-600 dark:text-orange-400', label: 'High' },
  urgent: { color: 'bg-red-500/20 text-red-600 dark:text-red-400', label: 'Urgent' }
};

const STATUS_CONFIG: Record<TaskStatus, { icon: typeof Circle; color: string; label: string }> = {
  pending: { icon: Circle, color: 'text-slate-400', label: 'Pending' },
  in_progress: { icon: Clock, color: 'text-blue-500', label: 'In Progress' },
  completed: { icon: CheckCircle2, color: 'text-green-500', label: 'Completed' },
  cancelled: { icon: AlertCircle, color: 'text-red-400', label: 'Cancelled' }
};

export function CRMTaskList({
  onTaskClick,
  onContactClick,
  onTasksUpdated,
  onAddTask,
  searchQuery = ''
}: CRMTaskListProps) {
  const { t, isRTL } = useLanguage();
  const [tasks, setTasks] = useState<CRMTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [sortColumn, setSortColumn] = useState<'title' | 'due_date' | 'priority' | 'status' | 'contact' | 'created_at'>('created_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('all');

  // Delete confirmation state
  const [taskToDelete, setTaskToDelete] = useState<CRMTask | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 10;

  // Fetch tasks
  useEffect(() => {
    fetchTasks();
  }, [statusFilter]);

  const fetchTasks = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.set('include_completed', 'true');
      params.set('orderBy', 'due_date');
      params.set('orderDirection', 'asc');
      params.set('limit', '100'); // Limit to 100 tasks for performance
      if (statusFilter !== 'all') {
        params.set('status', statusFilter);
      }

      const response = await fetch(`/api/crm/tasks?${params}`);
      const data = await response.json();

      if (data.success) {
        setTasks(data.tasks || []);
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch tasks');
    } finally {
      setLoading(false);
    }
  };

  // Clear selection when tasks change
  useEffect(() => {
    setSelectedIds(new Set());
  }, [tasks]);

  // Filter tasks by search query
  const filteredTasks = tasks.filter(task => {
    if (!searchQuery) return true;
    const searchLower = searchQuery.toLowerCase();
    const titleMatch = task.title?.toLowerCase().includes(searchLower);
    const descriptionMatch = task.description?.toLowerCase().includes(searchLower);
    const contactMatch = task.contact
      ? `${task.contact.first_name} ${task.contact.last_name || ''}`.toLowerCase().includes(searchLower)
      : false;
    return titleMatch || descriptionMatch || contactMatch;
  });

  // Sort tasks
  const sortedTasks = [...filteredTasks].sort((a, b) => {
    let comparison = 0;
    switch (sortColumn) {
      case 'title':
        comparison = (a.title || '').localeCompare(b.title || '');
        break;
      case 'due_date':
        if (!a.due_date && !b.due_date) comparison = 0;
        else if (!a.due_date) comparison = 1;
        else if (!b.due_date) comparison = -1;
        else comparison = new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
        break;
      case 'priority':
        const priorityOrder: Record<TaskPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
        comparison = priorityOrder[a.priority] - priorityOrder[b.priority];
        break;
      case 'status':
        const statusOrder: Record<TaskStatus, number> = { pending: 0, in_progress: 1, completed: 2, cancelled: 3 };
        comparison = statusOrder[a.status] - statusOrder[b.status];
        break;
      case 'contact':
        const contactNameA = a.contact ? `${a.contact.first_name} ${a.contact.last_name || ''}`.toLowerCase() : '';
        const contactNameB = b.contact ? `${b.contact.first_name} ${b.contact.last_name || ''}`.toLowerCase() : '';
        comparison = contactNameA.localeCompare(contactNameB);
        break;
      case 'created_at':
        if (!a.created_at && !b.created_at) comparison = 0;
        else if (!a.created_at) comparison = 1;
        else if (!b.created_at) comparison = -1;
        else comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        break;
    }
    return sortDirection === 'asc' ? comparison : -comparison;
  });

  // Pagination
  const totalPages = Math.ceil(sortedTasks.length / PAGE_SIZE);
  const paginatedTasks = sortedTasks.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

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

  const formatDueDate = (date: string | null) => {
    if (!date) return '-';
    const dueDate = new Date(date);
    const now = new Date();
    const diffDays = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return (
        <span className="text-red-500 font-medium">
          {t('crm.tasks.overdue')} ({Math.abs(diffDays)} {t('crm.tasks.days')})
        </span>
      );
    } else if (diffDays === 0) {
      return <span className="text-orange-500 font-medium">{t('crm.tasks.today')}</span>;
    } else if (diffDays === 1) {
      return <span className="text-yellow-600">{t('crm.tasks.tomorrow')}</span>;
    } else if (diffDays <= 7) {
      return <span>{diffDays} {t('crm.tasks.days')}</span>;
    }
    return dueDate.toLocaleDateString();
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
    if (selectedIds.size === paginatedTasks.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(paginatedTasks.map(t => t.id)));
    }
  };

  const handleMarkComplete = async () => {
    if (selectedIds.size === 0) return;

    setBulkLoading(true);
    try {
      const promises = Array.from(selectedIds).map(id =>
        fetch(`/api/crm/tasks/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'completed' })
        })
      );

      await Promise.all(promises);
      setSelectedIds(new Set());
      fetchTasks();
      onTasksUpdated?.();
    } catch (error) {
      logger.error({ err: error }, 'Failed to mark tasks complete');
    } finally {
      setBulkLoading(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(t('crm.tasks.delete_confirm').replace('{count}', String(selectedIds.size)))) return;

    setBulkLoading(true);
    try {
      const promises = Array.from(selectedIds).map(id =>
        fetch(`/api/crm/tasks/${id}`, { method: 'DELETE' })
      );

      await Promise.all(promises);
      setSelectedIds(new Set());
      fetchTasks();
      onTasksUpdated?.();
    } catch (error) {
      logger.error({ err: error }, 'Failed to delete tasks');
    } finally {
      setBulkLoading(false);
    }
  };

  const handleToggleStatus = async (task: CRMTask, e: React.MouseEvent) => {
    e.stopPropagation();
    const newStatus: TaskStatus = task.status === 'completed' ? 'pending' : 'completed';

    // Optimistic update - immediately update UI
    setTasks(prevTasks =>
      prevTasks.map(t =>
        t.id === task.id ? { ...t, status: newStatus } : t
      )
    );

    try {
      const response = await fetch(`/api/crm/tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });

      if (!response.ok) {
        // Revert on failure
        setTasks(prevTasks =>
          prevTasks.map(t =>
            t.id === task.id ? { ...t, status: task.status } : t
          )
        );
      }
      onTasksUpdated?.();
    } catch (error) {
      // Revert on error
      setTasks(prevTasks =>
        prevTasks.map(t =>
          t.id === task.id ? { ...t, status: task.status } : t
        )
      );
      logger.error({ err: error }, 'Failed to toggle task status');
    }
  };

  const handleDeleteTask = (task: CRMTask, e: React.MouseEvent) => {
    e.stopPropagation();
    setTaskToDelete(task);
  };

  const confirmDelete = async () => {
    if (!taskToDelete) return;

    setIsDeleting(true);
    try {
      const response = await fetch(`/api/crm/tasks/${taskToDelete.id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        fetchTasks();
        onTasksUpdated?.();
        setTaskToDelete(null);
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to delete task');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCompleteTask = async (task: CRMTask, e: React.MouseEvent) => {
    e.stopPropagation();
    const newStatus: TaskStatus = task.status === 'completed' ? 'pending' : 'completed';

    // Optimistic update - immediately update UI
    setTasks(prevTasks =>
      prevTasks.map(t =>
        t.id === task.id ? { ...t, status: newStatus } : t
      )
    );

    try {
      const response = await fetch(`/api/crm/tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });

      if (!response.ok) {
        // Revert on failure
        setTasks(prevTasks =>
          prevTasks.map(t =>
            t.id === task.id ? { ...t, status: task.status } : t
          )
        );
      }
      onTasksUpdated?.();
    } catch (error) {
      // Revert on error
      setTasks(prevTasks =>
        prevTasks.map(t =>
          t.id === task.id ? { ...t, status: task.status } : t
        )
      );
      logger.error({ err: error }, 'Failed to complete task');
    }
  };

  const selectedCount = selectedIds.size;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-t-transparent rounded-full animate-spin mx-auto" style={{ borderColor: '#8B5CF6', borderTopColor: 'transparent' }}></div>
          <p className="text-[var(--v2-text-secondary)] font-medium">{t('crm.tasks.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Filters */}
      <div className="flex items-center gap-2 mb-4">
        {(['all', 'pending', 'in_progress', 'completed'] as const).map((status) => (
          <button
            key={status}
            onClick={() => { setStatusFilter(status); setCurrentPage(1); }}
            className={`px-3 py-1.5 text-sm font-medium transition-all ${
              statusFilter === status
                ? 'text-[#8B5CF6] bg-[#8B5CF6]/10 border border-[#8B5CF6]'
                : 'text-[var(--v2-text-secondary)] bg-[var(--v2-surface)] border border-[var(--v2-border)] hover:border-[var(--v2-border-hover)]'
            }`}
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            {status === 'all' ? t('crm.tasks.filter_all') : t(`crm.tasks.status_${status}`)}
          </button>
        ))}
      </div>

      <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] overflow-hidden" style={{ borderRadius: totalPages > 1 ? 'var(--v2-radius-card) var(--v2-radius-card) 0 0' : 'var(--v2-radius-card)' }}>
        <div className="overflow-x-auto">
          <table className="w-full" style={{ fontFamily: 'var(--font-sans, "Heebo", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)' }}>
            <thead className="bg-[var(--v2-bg)] border-b border-[var(--v2-border)]">
              <tr>
                <th className="px-4 py-3 text-start">
                  <input
                    type="checkbox"
                    checked={paginatedTasks.length > 0 && selectedIds.size === paginatedTasks.length}
                    onChange={toggleSelectAll}
                    className="rounded border-[var(--v2-border)] text-[#8B5CF6] focus:ring-[#8B5CF6]"
                  />
                </th>
                <th
                  className="px-4 py-3 text-start text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wider cursor-pointer hover:text-[var(--v2-text-primary)] transition-colors"
                  onClick={() => handleSort('title')}
                >
                  <div className="flex items-center gap-1">
                    {t('crm.tasks.title')}
                    <SortIcon column="title" />
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-start text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wider cursor-pointer hover:text-[var(--v2-text-primary)] transition-colors"
                  onClick={() => handleSort('contact')}
                >
                  <div className="flex items-center gap-1">
                    {t('crm.tasks.contact')}
                    <SortIcon column="contact" />
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-start text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wider cursor-pointer hover:text-[var(--v2-text-primary)] transition-colors"
                  onClick={() => handleSort('due_date')}
                >
                  <div className="flex items-center gap-1">
                    {t('crm.tasks.due_date')}
                    <SortIcon column="due_date" />
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-start text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wider cursor-pointer hover:text-[var(--v2-text-primary)] transition-colors"
                  onClick={() => handleSort('priority')}
                >
                  <div className="flex items-center gap-1">
                    {t('crm.tasks.priority')}
                    <SortIcon column="priority" />
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-start text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wider cursor-pointer hover:text-[var(--v2-text-primary)] transition-colors"
                  onClick={() => handleSort('status')}
                >
                  <div className="flex items-center gap-1">
                    {t('crm.tasks.status')}
                    <SortIcon column="status" />
                  </div>
                </th>
                <th className="px-4 py-3 text-end text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wider">
                  {t('crm.tasks.actions') || 'Actions'}
                </th>
              </tr>
            </thead>
            <tbody className="bg-[var(--v2-surface)] divide-y divide-[var(--v2-border)]">
              {paginatedTasks.map(task => {
                const StatusIcon = STATUS_CONFIG[task.status].icon;
                return (
                  <tr
                    key={task.id}
                    onClick={() => onTaskClick?.(task)}
                    className={`hover:bg-[var(--v2-surface-hover)] cursor-pointer transition-colors ${
                      selectedIds.has(task.id) ? 'bg-[#8B5CF6]/5' : ''
                    } ${task.status === 'completed' ? 'opacity-60' : ''}`}
                  >
                    <td className="px-4 py-4" onClick={(e) => toggleSelect(task.id, e)}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(task.id)}
                        onChange={() => {}}
                        className="rounded border-[var(--v2-border)] text-[#8B5CF6] focus:ring-[#8B5CF6]"
                      />
                    </td>
                    <td className="px-4 py-4">
                      <span className={`text-sm font-medium text-[var(--v2-text-primary)] ${task.status === 'completed' ? 'line-through' : ''}`}>
                        {task.title}
                      </span>
                      {task.description && (
                        <p className="text-xs text-[var(--v2-text-muted)] mt-0.5 line-clamp-1">
                          {task.description}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      {task.contact ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (onContactClick && task.contact) {
                              onContactClick(task.contact as CRMContact);
                            }
                          }}
                          className="flex items-center gap-2 hover:bg-[var(--v2-surface-hover)] px-2 py-1 -mx-2 -my-1 rounded transition-colors"
                        >
                          <div className="w-6 h-6 rounded-full bg-[#8B5CF6]/20 flex items-center justify-center">
                            <User className="w-3 h-3 text-[#8B5CF6]" />
                          </div>
                          <span className="text-sm text-[var(--v2-text-primary)] hover:text-[#8B5CF6]">
                            {task.contact.first_name} {task.contact.last_name || ''}
                          </span>
                        </button>
                      ) : (
                        <span className="text-sm text-[var(--v2-text-muted)]">-</span>
                      )}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2 text-sm">
                        <Calendar className="h-4 w-4 text-[var(--v2-text-muted)]" />
                        {formatDueDate(task.due_date)}
                      </div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <Badge className={`text-xs ${PRIORITY_CONFIG[task.priority].color}`}>
                        {t(`crm.tasks.priority_${task.priority}`)}
                      </Badge>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <Badge className={`text-xs ${
                        task.status === 'completed' ? 'bg-green-500/20 text-green-600 dark:text-green-400' :
                        task.status === 'in_progress' ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400' :
                        task.status === 'cancelled' ? 'bg-red-500/20 text-red-600 dark:text-red-400' :
                        'bg-slate-500/20 text-slate-600 dark:text-slate-400'
                      }`}>
                        {t(`crm.tasks.status_${task.status}`)}
                      </Badge>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-end">
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={(e) => handleCompleteTask(task, e)}
                          className={`p-1.5 rounded-md transition-colors ${
                            task.status === 'completed'
                              ? 'bg-green-500/10 text-green-600 hover:bg-green-500/20'
                              : 'hover:bg-[var(--v2-surface-hover)] text-[var(--v2-text-muted)] hover:text-green-600'
                          }`}
                          title={task.status === 'completed' ? (t('crm.tasks.mark_incomplete') || 'Mark incomplete') : (t('crm.tasks.mark_complete') || 'Mark complete')}
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          onClick={(e) => handleDeleteTask(task, e)}
                          className="p-1.5 rounded-md hover:bg-red-500/10 text-[var(--v2-text-muted)] hover:text-red-600 transition-colors"
                          title={t('crm.tasks.delete') || 'Delete task'}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {tasks.length === 0 && (
            <div className="text-center py-12 text-[var(--v2-text-muted)]">
              <Calendar className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>{t('crm.tasks.no_tasks')}</p>
              {onAddTask && (
                <button
                  onClick={onAddTask}
                  className="mt-3 text-[#8B5CF6] hover:underline text-sm font-medium"
                >
                  {t('crm.tasks.create_first')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border border-[var(--v2-border)] border-t-0 bg-[var(--v2-surface)]" style={{ borderRadius: '0 0 var(--v2-radius-card) var(--v2-radius-card)' }}>
          <div className="text-sm text-[var(--v2-text-muted)]">
            {t('crm.pagination.page')} {currentPage} {t('crm.pagination.of')} {totalPages}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(p => p - 1)}
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
                    onClick={() => setCurrentPage(pageNum)}
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
              onClick={() => setCurrentPage(p => p + 1)}
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
            {t('crm.tasks.selected').replace('{count}', String(selectedCount))}
          </span>

          <div className="w-px h-6 bg-[var(--v2-border)]" />

          <Button
            size="sm"
            variant="ghost"
            onClick={handleMarkComplete}
            className="h-8 gap-1.5 text-green-600 hover:bg-green-500/10"
            disabled={bulkLoading}
          >
            <Check className="h-4 w-4" />
            {t('crm.tasks.mark_complete')}
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={handleBulkDelete}
            className="h-8 gap-1.5 text-red-500 hover:text-red-600 hover:bg-red-500/10"
            disabled={bulkLoading}
          >
            <Trash2 className="h-4 w-4" />
            {t('crm.tasks.delete')}
          </Button>

          <div className="w-px h-6 bg-[var(--v2-border)]" />

          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelectedIds(new Set())}
            className="h-8 px-2 text-[var(--v2-text-muted)]"
          >
            <span className="text-xs">{t('common.cancel')}</span>
          </Button>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!taskToDelete} onOpenChange={(open) => !open && setTaskToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('crm.tasks.delete_confirm_title') || 'Delete Task'}</DialogTitle>
            <DialogDescription>
              {t('crm.tasks.delete_confirm_single') || 'Are you sure you want to delete this task? This action cannot be undone.'}
              {taskToDelete && (
                <div className="mt-4 p-3 bg-[var(--v2-surface)] rounded-lg border border-[var(--v2-border)]">
                  <p className="font-medium text-[var(--v2-text-primary)]">{taskToDelete.title}</p>
                  {taskToDelete.description && (
                    <p className="text-sm text-[var(--v2-text-muted)] mt-1">{taskToDelete.description}</p>
                  )}
                </div>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setTaskToDelete(null)}
              disabled={isDeleting}
            >
              {t('common.cancel') || 'Cancel'}
            </Button>
            <Button
              variant="default"
              onClick={confirmDelete}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {isDeleting ? (t('common.deleting') || 'Deleting...') : (t('crm.tasks.delete') || 'Delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
