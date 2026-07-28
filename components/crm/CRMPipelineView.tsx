'use client';

import { useState, useEffect, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { Mail, Phone, Calendar, GripVertical, User, Clock, CheckSquare } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import type { CRMContact } from '@/lib/repositories/CRMContactRepository';
import type { CRMPipelineStage } from '@/lib/repositories/CRMPipelineStagesRepository';

// Animated Pipeline Flow Header - shows all stages as a connected flowing progress bar
function PipelineFlowHeader({
  stages,
  contactCounts,
  t
}: {
  stages: CRMPipelineStage[];
  contactCounts: Record<string, number>;
  t: (key: string) => string;
}) {
  const total = Object.values(contactCounts).reduce((sum, c) => sum + c, 0);

  return (
    <div
      className="mb-6 p-4 bg-[var(--v2-surface)] border border-[var(--v2-border)] overflow-hidden"
      style={{ borderRadius: 'var(--v2-radius-card)' }}
    >
      {/* Stage labels and counts */}
      <div className="flex items-center justify-between mb-3">
        {stages.map((stage, index) => (
          <div
            key={stage.stage_key}
            className="flex-1 text-center relative"
            style={{ minWidth: 0 }}
          >
            <div className="flex flex-col items-center">
              <span
                className="text-sm font-semibold truncate max-w-full px-2"
                style={{ color: stage.color || 'var(--v2-text-primary)' }}
              >
                {t(`crm.stage.${stage.stage_key}`) !== `crm.stage.${stage.stage_key}`
                  ? t(`crm.stage.${stage.stage_key}`)
                  : stage.stage_label}
              </span>
              <span
                className="text-xs font-medium mt-0.5"
                style={{ color: `${stage.color}99` || 'var(--v2-text-secondary)' }}
              >
                {contactCounts[stage.stage_key] || 0}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Animated flow bar - equal width segments matching Kanban columns */}
      <div className="relative h-4 overflow-hidden flex" style={{ borderRadius: '8px', gap: '3px' }}>
        {stages.map((stage, index) => {
          const count = contactCounts[stage.stage_key] || 0;
          const stageColor = stage.color || '#8B5CF6';
          const isActive = count > 0;
          const isLast = index === stages.length - 1;

          return (
            <div
              key={stage.stage_key}
              className="flex-1 h-full relative overflow-hidden flex items-center"
              style={{ borderRadius: '4px' }}
            >
              {/* Stage segment background */}
              <div
                className="absolute inset-0 transition-all duration-500"
                style={{
                  backgroundColor: isActive ? stageColor : `${stageColor}25`,
                }}
              />

              {/* Shimmer effect for active segments */}
              {isActive && (
                <div
                  className="absolute inset-0 animate-pipeline-shimmer"
                  style={{
                    background: `linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.5) 50%, transparent 100%)`,
                    backgroundSize: '200% 100%'
                  }}
                />
              )}

              {/* Arrow connector (except for last stage) */}
              {!isLast && (
                <div
                  className="absolute h-full flex items-center animate-pipeline-pulse-arrow z-10"
                  style={{ insetInlineEnd: '-10px' }}
                >
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center"
                    style={{
                      background: `linear-gradient(135deg, ${stageColor}CC 0%, ${stageColor} 100%)`,
                      boxShadow: `0 2px 6px ${stageColor}50`
                    }}
                  >
                    <svg width="10" height="10" viewBox="0 0 12 12" className="text-white rtl:rotate-180">
                      <path
                        d="M4 3 L8 6 L4 9"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Flowing particles */}
        <div className="absolute inset-0 pointer-events-none">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="absolute h-3 w-3 rounded-full animate-pipeline-flow-particle"
              style={{
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'radial-gradient(circle, #FFFFFF 0%, #C4B5FD 40%, #8B5CF6 100%)',
                boxShadow: '0 0 10px 3px rgba(139, 92, 246, 0.6), 0 0 4px 2px rgba(255, 255, 255, 0.7)',
                animationDelay: `${i * 1.5}s`
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface CRMPipelineViewProps {
  contacts: CRMContact[];
  stages: CRMPipelineStage[];
  onContactClick: (contact: CRMContact) => void;
  onContactUpdated: () => void;
}

// Helper to generate Tailwind-compatible color classes from hex color
function getStageColors(hexColor: string | null) {
  // Default colors if no color specified
  if (!hexColor) {
    return {
      textColor: 'text-slate-600 dark:text-slate-400',
      bgColor: 'bg-slate-500/10',
      borderColor: 'border-slate-500/30',
      dotStyle: { backgroundColor: '#64748B' }
    };
  }

  // Use inline styles for dynamic colors from the database
  return {
    textColor: '',
    bgColor: '',
    borderColor: '',
    dotStyle: { backgroundColor: hexColor },
    // Inline styles for dynamic hex colors
    headerStyle: {
      backgroundColor: `${hexColor}15`,
      borderColor: `${hexColor}40`,
      color: hexColor
    }
  };
}

export function CRMPipelineView({ contacts, stages, onContactClick, onContactUpdated }: CRMPipelineViewProps) {
  const { t } = useLanguage();
  const [draggedContact, setDraggedContact] = useState<CRMContact | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  // Optimistic updates: track contacts being moved (id -> new stage)
  const [pendingMoves, setPendingMoves] = useState<Record<string, string>>({});
  // Track previous contacts to detect when data has been refreshed
  const prevContactsRef = useRef<CRMContact[]>(contacts);

  // Clear pending moves when contacts data is refreshed from server
  useEffect(() => {
    if (contacts !== prevContactsRef.current) {
      // Contacts have been refreshed - clear any pending moves that are now reflected in the data
      setPendingMoves(prev => {
        const newPending: Record<string, string> = {};
        for (const [contactId, targetStage] of Object.entries(prev)) {
          const contact = contacts.find(c => c.id === contactId);
          // Only keep pending if contact doesn't exist or hasn't moved to target stage yet
          if (contact && contact.stage !== targetStage) {
            newPending[contactId] = targetStage;
          }
        }
        return newPending;
      });
      prevContactsRef.current = contacts;
    }
  }, [contacts]);

  const getContactsByStage = (stage: string) => {
    return contacts.filter(contact => {
      const pendingStage = pendingMoves[contact.id];

      // If this contact has a pending move
      if (pendingStage !== undefined) {
        // Show in the target stage only
        return pendingStage === stage;
      }

      // No pending move - use actual stage
      return contact.stage === stage;
    });
  };

  const handleDragStart = (e: React.DragEvent, contact: CRMContact) => {
    setDraggedContact(contact);
    e.dataTransfer.effectAllowed = 'move';
    // Add a slight delay to show the dragging state
    setTimeout(() => {
      (e.target as HTMLElement).style.opacity = '0.5';
    }, 0);
  };

  const handleDragEnd = (e: React.DragEvent) => {
    (e.target as HTMLElement).style.opacity = '1';
    setDraggedContact(null);
    setDragOverStage(null);
  };

  const handleDragOver = (e: React.DragEvent, stage: string) => {
    e.preventDefault();
    setDragOverStage(stage);
  };

  const handleDragLeave = () => {
    setDragOverStage(null);
  };

  const handleDrop = async (stage: string) => {
    if (!draggedContact || draggedContact.stage === stage) {
      setDragOverStage(null);
      return;
    }

    const contactId = draggedContact.id;

    // Optimistic update: immediately move in UI
    setPendingMoves(prev => ({ ...prev, [contactId]: stage }));
    setDraggedContact(null);
    setDragOverStage(null);

    try {
      const response = await fetch(`/api/crm/contacts/${contactId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage })
      });

      if (response.ok) {
        // Refresh data from server - pendingMoves will be cleared by useEffect when new data arrives
        onContactUpdated();
      } else {
        // Revert on error by clearing pending move
        setPendingMoves(prev => {
          const { [contactId]: _, ...rest } = prev;
          return rest;
        });
      }
    } catch {
      // Revert on error by clearing pending move
      setPendingMoves(prev => {
        const { [contactId]: _, ...rest } = prev;
        return rest;
      });
    }
  };

  const formatTimeAgo = (date: string) => {
    const seconds = Math.floor((new Date().getTime() - new Date(date).getTime()) / 1000);
    if (seconds < 60) return t('crm.pipeline.just_now');
    if (seconds < 3600) return `${Math.floor(seconds / 60)}${t('crm.pipeline.min_ago')}`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}${t('crm.pipeline.hours_ago')}`;
    return `${Math.floor(seconds / 86400)}${t('crm.pipeline.days_ago')}`;
  };

  const getInitials = (contact: CRMContact) => {
    const first = contact.first_name?.[0] || '';
    const last = contact.last_name?.[0] || '';
    return (first + last).toUpperCase() || '?';
  };

  // Calculate contact counts for each stage (for the flow header)
  const contactCounts: Record<string, number> = {};
  stages.forEach(stage => {
    contactCounts[stage.stage_key] = getContactsByStage(stage.stage_key).length;
  });

  // Show empty state if no stages configured
  if (stages.length === 0) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <div className="text-center text-[var(--v2-text-muted)]">
          <User className="h-12 w-12 mx-auto mb-4 opacity-40" />
          <p>{t('crm.pipeline.no_stages')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Animated Flow Header */}
      <PipelineFlowHeader
        stages={stages}
        contactCounts={contactCounts}
        t={t}
      />

      {/* Kanban Columns - matches flow header segments */}
      <div className="flex flex-1 overflow-x-auto" style={{ gap: '3px' }}>
      {stages.map(stage => {
        const stageContacts = getContactsByStage(stage.stage_key);
        const isDropTarget = dragOverStage === stage.stage_key && draggedContact?.stage !== stage.stage_key;

        return (
          <div
            key={stage.stage_key}
            className="flex-1 flex flex-col" style={{ minWidth: '200px' }}
            onDragOver={(e) => handleDragOver(e, stage.stage_key)}
            onDragLeave={handleDragLeave}
            onDrop={() => handleDrop(stage.stage_key)}
          >
            {/* Drop Zone */}
            <div
              className={`flex-1 space-y-3 overflow-y-auto p-1 transition-all duration-200 ${
                isDropTarget
                  ? 'bg-[#8B5CF6]/10 border-2 border-dashed border-[#8B5CF6] rounded-lg'
                  : ''
              }`}
            >
              {/* Contact Cards */}
              {stageContacts.map(contact => {
                // If there's a pending move, pass contact with updated stage
                const pendingStage = pendingMoves[contact.id];
                const contactWithCurrentStage = pendingStage
                  ? { ...contact, stage: pendingStage }
                  : contact;

                return (
                <div
                  key={contact.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, contact)}
                  onDragEnd={handleDragEnd}
                  onClick={() => onContactClick(contactWithCurrentStage)}
                  className={`
                    bg-[var(--v2-surface)] border border-[var(--v2-border)] p-4
                    cursor-grab active:cursor-grabbing
                    hover:border-[#8B5CF6]/50 hover:shadow-lg hover:shadow-[#8B5CF6]/10
                    transition-all duration-200 group
                    ${draggedContact?.id === contact.id ? 'opacity-50 scale-95' : ''}
                  `}
                  style={{ borderRadius: 'var(--v2-radius-card)' }}
                >
                  <div className="space-y-3">
                    {/* Header with Avatar and Grip */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3 min-w-0">
                        {/* Avatar */}
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold text-white flex-shrink-0"
                          style={{ background: 'linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)' }}
                        >
                          {getInitials(contact)}
                        </div>
                        {/* Name */}
                        <div className="min-w-0">
                          <div className="font-semibold text-[var(--v2-text-primary)] group-hover:text-[#8B5CF6] transition-colors truncate">
                            {contact.first_name} {contact.last_name}
                          </div>
                          {contact.source && (
                            <div className="text-xs text-[var(--v2-text-muted)] mt-0.5">
                              {t(`crm.source.${contact.source}`)}
                            </div>
                          )}
                        </div>
                      </div>
                      {/* Drag Handle */}
                      <GripVertical className="h-4 w-4 text-[var(--v2-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                    </div>

                    {/* Contact Info */}
                    <div className="space-y-1.5">
                      {contact.email && (
                        <div className="flex items-center gap-2 text-sm text-[var(--v2-text-secondary)]">
                          <Mail className="h-3.5 w-3.5 text-[var(--v2-text-muted)] flex-shrink-0" />
                          <span className="truncate">{contact.email}</span>
                        </div>
                      )}
                      {contact.phone && (
                        <div className="flex items-center gap-2 text-sm text-[var(--v2-text-secondary)]">
                          <Phone className="h-3.5 w-3.5 text-[var(--v2-text-muted)] flex-shrink-0" />
                          <span dir="ltr">{contact.phone}</span>
                        </div>
                      )}
                    </div>

                    {/* Tags */}
                    {contact.tags && contact.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {contact.tags.slice(0, 3).map(tag => (
                          <Badge
                            key={tag}
                            variant="outline"
                            className="text-xs px-2 py-0.5 bg-[#8B5CF6]/10 text-[#8B5CF6] border-[#8B5CF6]/30"
                          >
                            {tag}
                          </Badge>
                        ))}
                        {contact.tags.length > 3 && (
                          <Badge
                            variant="outline"
                            className="text-xs px-2 py-0.5 bg-[var(--v2-surface)] text-[var(--v2-text-muted)] border-[var(--v2-border)]"
                          >
                            +{contact.tags.length - 3}
                          </Badge>
                        )}
                      </div>
                    )}

                    {/* Footer */}
                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-[var(--v2-border)]">
                      <div className="flex items-center gap-1.5 text-xs text-[var(--v2-text-muted)]">
                        <Clock className="h-3 w-3 flex-shrink-0" />
                        <span>{formatTimeAgo(contact.updated_at)}</span>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        {(contact.tasks_count ?? 0) > 0 && (
                          <div className="flex items-center gap-1 text-xs text-amber-500">
                            <CheckSquare className="h-3 w-3" />
                            <span>{contact.tasks_count}</span>
                          </div>
                        )}
                        {(contact.bookings_count ?? 0) > 0 && (
                          <div className="flex items-center gap-1 text-xs text-[#8B5CF6]">
                            <Calendar className="h-3 w-3" />
                            <span>{contact.bookings_count}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );})}

              {/* Empty State */}
              {stageContacts.length === 0 && (
                <div
                  className={`
                    flex flex-col items-center justify-center py-12
                    border-2 border-dashed border-[var(--v2-border)]
                    text-[var(--v2-text-muted)] text-sm
                    ${isDropTarget ? 'border-[#8B5CF6] bg-[#8B5CF6]/5' : ''}
                  `}
                  style={{ borderRadius: 'var(--v2-radius-card)' }}
                >
                  <User className="h-8 w-8 mb-2 opacity-40" />
                  <span>{t('crm.pipeline.no_contacts')}</span>
                  {isDropTarget && (
                    <span className="text-[#8B5CF6] mt-1 font-medium">
                      {t('crm.pipeline.drop_here')}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}
