'use client';

/**
 * Page controls for a list of contacts.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS ITS OWN COMPONENT
 *
 * It was written inside `CRMContactList`, which meant the KANBAN — the default
 * view, and the one most people look at — had no way to page at all. The board
 * simply showed whatever the first fetch returned and said nothing about the
 * rest.
 *
 * Copying the markup into the pipeline view would have been the same mistake
 * this file exists to undo: the chip list for contact sources was written out
 * twice, the two copies drifted, and a contact captured by the website matched
 * neither. One pager, both views.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface ContactsPagerProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  t: (key: string) => string;
  /**
   * Whether it sits flush under a bordered card, as it does in the list view,
   * or floats free below the board.
   */
  attached?: boolean;
}

/** How many numbered buttons to show. More than five is a paragraph of digits. */
const WINDOW = 5;

export function ContactsPager({
  currentPage,
  totalPages,
  onPageChange,
  t,
  attached = false,
}: ContactsPagerProps) {
  // One page is not a choice, so there is nothing to offer.
  if (totalPages <= 1) return null;

  /*
   * A sliding window of page numbers, anchored at whichever end is near.
   *
   * With fifty pages the buttons have to be a window rather than a list, and it
   * has to follow the current page — otherwise paging past five leaves the
   * numbers behind and only the arrows still work.
   */
  const pageNumbers = Array.from({ length: Math.min(WINDOW, totalPages) }, (_, i) => {
    if (totalPages <= WINDOW) return i + 1;
    if (currentPage <= 3) return i + 1;
    if (currentPage >= totalPages - 2) return totalPages - (WINDOW - 1) + i;
    return currentPage - 2 + i;
  });

  return (
    <div
      className={`flex items-center justify-between px-4 py-3 bg-[var(--v2-surface)] border border-[var(--v2-border)] ${
        attached ? 'border-t-0' : 'mt-3'
      }`}
      style={{
        borderRadius: attached
          ? '0 0 var(--v2-radius-card) var(--v2-radius-card)'
          : 'var(--v2-radius-card)',
      }}
    >
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
          {pageNumbers.map(pageNum => (
            <Button
              key={pageNum}
              variant={currentPage === pageNum ? 'default' : 'outline'}
              size="sm"
              onClick={() => onPageChange(pageNum)}
              className={`h-8 w-8 p-0 ${
                currentPage === pageNum ? 'bg-[#8B5CF6] hover:bg-[#7C3AED] text-white' : ''
              }`}
            >
              {pageNum}
            </Button>
          ))}
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
  );
}
