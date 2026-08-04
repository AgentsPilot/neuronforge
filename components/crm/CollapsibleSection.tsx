'use client';

import { useState, ReactNode, useEffect } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface CollapsibleSectionProps {
  title: string;
  icon?: ReactNode;
  defaultOpen?: boolean;
  isOpen?: boolean;
  onToggle?: (isOpen: boolean) => void;
  badge?: ReactNode;
  actionButton?: ReactNode;
  children: ReactNode;
  className?: string;
  isRTL?: boolean;
}

export function CollapsibleSection({
  title,
  icon,
  defaultOpen = false,
  isOpen: controlledIsOpen,
  onToggle,
  badge,
  actionButton,
  children,
  className = '',
  isRTL = false
}: CollapsibleSectionProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(defaultOpen);

  // Use controlled state if provided, otherwise use internal state
  const isControlled = controlledIsOpen !== undefined;
  const isOpen = isControlled ? controlledIsOpen : internalIsOpen;

  // Sync internal state with controlled state
  useEffect(() => {
    if (isControlled) {
      setInternalIsOpen(controlledIsOpen);
    }
  }, [controlledIsOpen, isControlled]);

  const handleToggle = () => {
    const newState = !isOpen;
    if (onToggle) {
      onToggle(newState);
    }
    if (!isControlled) {
      setInternalIsOpen(newState);
    }
  };

  return (
    <div className={`border border-[var(--v2-border)] rounded-lg overflow-hidden ${className}`} dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="w-full flex items-center justify-between px-4 py-3 bg-[var(--v2-surface)]">
        <button
          type="button"
          onClick={handleToggle}
          className="flex-1 flex items-center justify-between hover:opacity-80 transition-opacity"
        >
          <div className="flex items-center gap-2">
            {icon && <span className="text-[var(--v2-text-muted)]">{icon}</span>}
            <span className="font-medium text-sm text-[var(--v2-text-primary)] text-start">{title}</span>
            {badge}
          </div>
          <div className="flex items-center gap-2">
            {isOpen ? (
              <ChevronUp className="h-4 w-4 text-[var(--v2-text-muted)]" />
            ) : (
              <ChevronDown className="h-4 w-4 text-[var(--v2-text-muted)]" />
            )}
          </div>
        </button>
        {actionButton && (
          <div className="ms-2">
            {actionButton}
          </div>
        )}
      </div>

      {/* Content */}
      {isOpen && (
        <div className="p-4 bg-[var(--v2-bg)] border-t border-[var(--v2-border)]">
          {children}
        </div>
      )}
    </div>
  );
}
