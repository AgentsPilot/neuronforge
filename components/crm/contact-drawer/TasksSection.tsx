'use client';

import { useState } from 'react';
import { CheckSquare, Plus, Circle, CheckCircle2, Trash2, Clock, AlertTriangle, Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { CollapsibleSection } from '../CollapsibleSection';
import type { ContactTask } from './types';

interface TasksSectionProps {
  tasks: ContactTask[];
  t: (key: string) => string;
  isRTL: boolean;
  language?: string;
  onCreateTask?: (title: string, priority?: string, dueDate?: string) => void;
  onToggleTask?: (taskId: string, completed: boolean) => void;
  onDeleteTask?: (taskId: string) => void;
  isLoading?: boolean;
  isOpen?: boolean;
  onToggle?: (isOpen: boolean) => void;
}

const PRIORITY_STYLES = {
  low: { color: 'text-slate-500', bg: 'bg-slate-500/10' },
  medium: { color: 'text-blue-500', bg: 'bg-blue-500/10' },
  high: { color: 'text-amber-500', bg: 'bg-amber-500/10' },
  urgent: { color: 'text-red-500', bg: 'bg-red-500/10', icon: AlertTriangle }
};

export function TasksSection({
  tasks,
  t,
  isRTL,
  language,
  onCreateTask,
  onToggleTask,
  onDeleteTask,
  isLoading = false,
  isOpen,
  onToggle
}: TasksSectionProps) {
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [newTaskDueDate, setNewTaskDueDate] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);

  // Separate active and completed tasks
  const activeTasks = tasks.filter(task => task.status !== 'completed' && task.status !== 'cancelled');
  const completedTasks = tasks.filter(task => task.status === 'completed');

  // Sort active tasks by priority and due date
  const sortedActiveTasks = [...activeTasks].sort((a, b) => {
    const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
    const aPriority = priorityOrder[a.priority] ?? 4;
    const bPriority = priorityOrder[b.priority] ?? 4;

    if (aPriority !== bPriority) return aPriority - bPriority;

    // Then by due date (earlier first)
    if (a.due_date && b.due_date) {
      return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
    }
    if (a.due_date) return -1;
    if (b.due_date) return 1;
    return 0;
  });

  const handleAddTask = () => {
    if (newTaskTitle.trim() && onCreateTask) {
      onCreateTask(newTaskTitle.trim(), newTaskPriority, newTaskDueDate || undefined);
      setNewTaskTitle('');
      setNewTaskPriority('medium');
      setNewTaskDueDate('');
    }
  };

  const formatDueDate = (date: string) => {
    const dueDate = new Date(date);
    const now = new Date();
    const diffDays = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return { text: t('crm.task.overdue') || 'Overdue', className: 'text-red-500 dark:text-red-400' };
    if (diffDays === 0) return { text: t('crm.task.today') || 'Today', className: 'text-amber-600 dark:text-amber-400' };
    if (diffDays === 1) return { text: t('crm.task.tomorrow') || 'Tomorrow', className: 'text-blue-500 dark:text-blue-400' };

    return {
      text: dueDate.toLocaleDateString(),
      className: 'text-[var(--v2-text-muted)]'
    };
  };

  return (
    <CollapsibleSection
      title={t('crm.drawer.section_tasks') || 'Tasks'}
      icon={<CheckSquare className="h-4 w-4" />}
      defaultOpen={activeTasks.length > 0}
      isOpen={isOpen}
      onToggle={onToggle}
      isRTL={isRTL}
      badge={
        activeTasks.length > 0 && (
          <span className="text-xs bg-[#8B5CF6]/10 text-[#8B5CF6] px-2 py-0.5 rounded-full">
            {activeTasks.length}
          </span>
        )
      }
    >
      <div className="space-y-3" dir={isRTL ? 'rtl' : 'ltr'}>
        {/* Add task form */}
        {onCreateTask && (
          <div className="space-y-3 p-3 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg">
            <Input
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddTask()}
              placeholder={t('crm.task.add_placeholder') || 'Add a task...'}
              className="w-full bg-[var(--v2-surface)] border-[var(--v2-border)] focus:border-[#8B5CF6] text-start text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)]"
            />
            <div className="flex gap-2 flex-wrap">
              <input
                type="date"
                value={newTaskDueDate}
                onChange={(e) => setNewTaskDueDate(e.target.value)}
                className="date-input-dark-fix flex-1 min-w-[140px] h-10 px-3 py-2 text-sm rounded-md border bg-[var(--v2-surface)] border-[var(--v2-border)] text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <style jsx>{`
                .date-input-dark-fix {
                  color-scheme: light;
                }
                :global(.dark) .date-input-dark-fix,
                :global(html.dark) .date-input-dark-fix {
                  color-scheme: dark;
                }
                :global(.dark) .date-input-dark-fix::-webkit-calendar-picker-indicator,
                :global(html.dark) .date-input-dark-fix::-webkit-calendar-picker-indicator {
                  filter: invert(1) brightness(0.8);
                  cursor: pointer;
                }
              `}</style>
              <Select
                value={newTaskPriority}
                onValueChange={(value) => setNewTaskPriority(value as 'low' | 'medium' | 'high' | 'urgent')}
              >
                <SelectTrigger className="w-[130px] bg-[var(--v2-surface)] border-[var(--v2-border)] text-[var(--v2-text-primary)]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">{t('crm.drawer.priority_low') || 'Low'}</SelectItem>
                  <SelectItem value="medium">{t('crm.drawer.priority_medium') || 'Medium'}</SelectItem>
                  <SelectItem value="high">{t('crm.drawer.priority_high') || 'High'}</SelectItem>
                  <SelectItem value="urgent">{t('crm.drawer.priority_urgent') || 'Urgent'}</SelectItem>
                </SelectContent>
              </Select>
              <Button
                type="button"
                onClick={handleAddTask}
                size="sm"
                disabled={!newTaskTitle.trim()}
                className="px-3 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white disabled:opacity-50"
              >
                <Plus className="h-4 w-4 me-1" />
                {t('crm.drawer.add') || 'Add'}
              </Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 p-3 animate-pulse">
                <div className="w-5 h-5 bg-[var(--v2-border)] rounded" />
                <div className="flex-1 h-4 bg-[var(--v2-border)] rounded" />
              </div>
            ))}
          </div>
        ) : tasks.length === 0 ? (
          <div className="text-center py-4">
            <CheckSquare className="h-8 w-8 text-[var(--v2-text-muted)] mx-auto mb-2" />
            <p className="text-sm text-[var(--v2-text-muted)]">
              {t('crm.drawer.no_tasks') || 'No tasks yet'}
            </p>
          </div>
        ) : (
          <>
            {/* Active tasks */}
            <div className="space-y-1">
              {sortedActiveTasks.map((task) => {
                const priorityStyle = PRIORITY_STYLES[task.priority] || PRIORITY_STYLES.medium;
                const dueInfo = task.due_date ? formatDueDate(task.due_date) : null;

                return (
                  <div
                    key={task.id}
                    className="group flex items-start gap-3 p-2 rounded-lg hover:bg-[var(--v2-surface)] transition-colors"
                  >
                    {/* Checkbox */}
                    <button
                      type="button"
                      onClick={() => onToggleTask?.(task.id, true)}
                      className="mt-0.5 flex-shrink-0"
                    >
                      <Circle className="h-5 w-5 text-[var(--v2-text-muted)] hover:text-[#8B5CF6] transition-colors" />
                    </button>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[var(--v2-text-primary)]">{task.title}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {/* Priority badge */}
                        <span className={`text-xs px-1.5 py-0.5 rounded ${priorityStyle.bg} ${priorityStyle.color}`}>
                          {t(`crm.task.priority.${task.priority}`) || task.priority}
                        </span>

                        {/* Due date */}
                        {dueInfo && (
                          <span className={`text-xs flex items-center gap-1 ${dueInfo.className}`}>
                            <Clock className="h-3 w-3 flex-shrink-0" />
                            <bdi>{dueInfo.text}</bdi>
                          </span>
                        )}

                        {/* AI badge */}
                        {task.created_by && task.created_by !== 'manual' && (
                          <Badge className="text-xs gap-1 bg-purple-500/20 text-purple-600 dark:text-purple-400 border-purple-500/30">
                            <Bot className="h-3 w-3" />
                            AI
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* Delete button */}
                    {onDeleteTask && (
                      <button
                        type="button"
                        onClick={() => onDeleteTask(task.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-[var(--v2-text-muted)] hover:text-red-500 transition-all"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Completed tasks toggle */}
            {completedTasks.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setShowCompleted(!showCompleted)}
                  className="w-full py-2 text-sm text-[var(--v2-text-muted)] hover:text-[var(--v2-text-secondary)] transition-colors"
                >
                  {showCompleted
                    ? t('crm.task.hide_completed') || 'Hide completed'
                    : t('crm.task.show_completed', { count: completedTasks.length }) || `Show ${completedTasks.length} completed`
                  }
                </button>

                {showCompleted && (
                  <div className="space-y-1 opacity-60">
                    {completedTasks.map((task) => (
                      <div
                        key={task.id}
                        className="group flex items-start gap-3 p-2 rounded-lg"
                      >
                        <button
                          type="button"
                          onClick={() => onToggleTask?.(task.id, false)}
                          className="mt-0.5 flex-shrink-0"
                        >
                          <CheckCircle2 className="h-5 w-5 text-green-500" />
                        </button>
                        <p className="text-sm text-[var(--v2-text-secondary)] line-through">{task.title}</p>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </CollapsibleSection>
  );
}
