'use client';

/**
 * Everything waiting on the owner, and the one click that clears each of them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS FOR
 *
 * The work a small business loses is almost never work it decided against. It
 * is a form nobody answered, a quote nobody wrote, a quote written and never
 * sent, an intake form nobody chased, an invoice nobody followed up. Each one
 * was a single step away from done and each was invisible until somebody went
 * looking.
 *
 * ONE LIST, BECAUSE THEY ARE ONE PROBLEM
 *
 * They arrive from `findGaps`, which is also what the briefing reads — so the
 * card and the morning summary cannot disagree about what is outstanding. Every
 * row carries the action for its own kind, and the services behind all five
 * already existed: this card is wiring, not a new capability.
 *
 * NOTHING APPEARS HERE THAT THE OWNER CANNOT DO
 *
 * A quote sitting with a client who has not replied is genuinely outstanding
 * and genuinely not their move; it is reported in the briefing instead. A list
 * headed "needs you" that contains things you cannot act on is how somebody
 * learns to stop reading the list.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Send, Check, Clock, AlertCircle, FileText, Bell, Receipt } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
// One definition, in the registry that owns the vocabulary. Declared here too,
// the two would drift the first time an action was added.
import type { GapAction } from '@/lib/business-os/gaps/types';

export interface GapItemView {
  contactId: string;
  name: string;
  note: string | null;
  since: string;
  entityId: string | null;
  /** Only an enquiry can have an automatic reply queued. */
  queued?: {
    label: string | null;
    chosenBy: string | null;
    dueAt: string | null;
  } | null;
}

export interface GapView {
  id: string;
  action: GapAction;
  count: number;
  items: GapItemView[];
}

interface NeedsYouCardProps {
  gaps: GapView[];
  /** Refetch, so a cleared row leaves the list. */
  onChanged?: () => void;
}

type RowState =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'done' }
  | { kind: 'refused'; message: string };

/** The icon says what KIND of work this is before the label is read. */
const ACTION_ICON: Record<string, typeof Send> = {
  send_booking_link: Send,
  write_quote: FileText,
  send_quote: Send,
  chase_intake: Bell,
  chase_payment: Receipt,
};

export function NeedsYouCard({ gaps, onChanged }: NeedsYouCardProps) {
  const { t, isRTL } = useLanguage();
  const router = useRouter();
  const [rows, setRows] = useState<Record<string, RowState>>({});

  const setRow = (key: string, state: RowState) => setRows(prev => ({ ...prev, [key]: state }));

  /**
   * Where each action goes.
   *
   * Every one of these endpoints already existed and is already used elsewhere
   * — the contact drawer sends intake forms and resends invoices through the
   * same two. Nothing new is being asked of the server.
   */
  const endpointFor = (action: GapAction, item: GapItemView): string | null => {
    switch (action) {
      case 'send_booking_link':
        return `/api/crm/contacts/${item.contactId}/send-booking-link`;
      case 'send_quote':
        return item.entityId ? `/api/business-os/proposals/${item.entityId}/send` : null;
      case 'chase_intake':
        return item.entityId ? `/api/scheduling/bookings/${item.entityId}/intake` : null;
      case 'chase_payment':
        return item.entityId ? `/api/payments/invoices/${item.entityId}/send` : null;
      default:
        return null;
    }
  };

  /**
   * Stop or hurry a reply that is queued but has not gone yet.
   *
   * The fifteen-minute window only means something if there is something to
   * press inside it — a card that announces "sending in 12 minutes" and offers
   * no way to intervene is worse than one that says nothing, because it shows
   * the owner a decision being taken without them.
   */
  const control = async (item: GapItemView, action: 'cancel' | 'send_now') => {
    const key = `queued:${item.contactId}`;
    setRow(key, { kind: 'working' });

    try {
      const response = await fetch(`/api/business-os/leads/${item.contactId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, kind: 'invite' }),
      });
      const data = await response.json();

      if (data?.success) {
        setRow(key, { kind: 'idle' });
        onChanged?.();
        return;
      }

      // Losing the race with the runner is the honest answer, not an error.
      setRow(key, { kind: 'refused', message: translateReason(t, data?.reason) });
    } catch {
      setRow(key, { kind: 'refused', message: t('gaps.refused.generic') });
    }
  };

  const act = async (gap: GapView, item: GapItemView) => {
    const key = `${gap.id}:${item.contactId}`;

    /*
     * Writing a quote is the one that is not a send.
     *
     * It needs the owner to decide what the work costs, so it opens the builder
     * they already use rather than pretending a button can answer it.
     */
    if (gap.action === 'write_quote') {
      router.push(`/business-os/crm?contact=${item.contactId}&action=quote`);
      return;
    }

    const endpoint = endpointFor(gap.action, item);
    if (!endpoint) {
      setRow(key, { kind: 'refused', message: t('gaps.refused.generic') });
      return;
    }

    setRow(key, { kind: 'working' });
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json();

      if (data?.success) {
        setRow(key, { kind: 'done' });
        setTimeout(() => onChanged?.(), 1200);
        return;
      }

      // A refusal is a next step, not an error — show what the server said.
      setRow(key, { kind: 'refused', message: data?.detail || translateReason(t, data?.reason) });
    } catch {
      setRow(key, { kind: 'refused', message: t('gaps.refused.generic') });
    }
  };

  if (gaps.length === 0) return null;

  const total = gaps.reduce((sum, gap) => sum + gap.count, 0);

  return (
    <div
      style={{
        direction: isRTL ? 'rtl' : 'ltr',
        background: 'var(--v2-surface)',
        border: '1px solid var(--v2-border)',
        borderRadius: '18px',
        padding: '17px 18px',
        boxShadow: '0 6px 20px -10px rgba(16,22,42,0.25)',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">
          {t('gaps.card_title')}
        </h3>
        <span
          className="text-[11px] font-medium px-2 py-0.5 rounded-full"
          style={{ background: 'var(--v2-primary)', color: '#fff' }}
        >
          {total}
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {gaps.map(gap => (
          <div key={gap.id}>
            {/* The kind, said once, rather than repeated on every row. */}
            <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--v2-text-muted)] mb-1.5">
              {t(`gaps.kind.${gap.id}`)}
              {gap.count > gap.items.length && (
                <span className="normal-case"> · {gap.count}</span>
              )}
            </p>

            <div className="flex flex-col gap-2">
              {gap.items.map(item => {
                const key = `${gap.id}:${item.contactId}`;
                const state = rows[key] ?? { kind: 'idle' };
                const Icon = ACTION_ICON[gap.action || ''] || Send;

                return (
                  <div
                    key={key}
                    className="p-2.5 rounded-xl border border-[var(--v2-border)]"
                    style={{ background: 'var(--v2-bg)' }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[var(--v2-text-primary)] truncate">
                          {item.name}
                        </p>
                        {item.note && (
                          <p className="text-xs text-[var(--v2-text-muted)] line-clamp-2 mt-0.5">
                            {item.note}
                          </p>
                        )}
                        <p className="text-[11px] text-[var(--v2-text-muted)] mt-1 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {waitedFor(item.since, t)}
                        </p>
                      </div>

                      {gap.action && (
                        <button
                          type="button"
                          onClick={() => act(gap, item)}
                          disabled={state.kind === 'working' || state.kind === 'done'}
                          className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-opacity disabled:opacity-60"
                          style={{ background: 'var(--v2-primary)', color: '#fff' }}
                        >
                          {state.kind === 'done' ? (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              {t('gaps.done')}
                            </>
                          ) : (
                            <>
                              <Icon className="w-3.5 h-3.5" />
                              {state.kind === 'working'
                                ? t('gaps.working')
                                : t(`gaps.action.${gap.action}`)}
                            </>
                          )}
                        </button>
                      )}
                    </div>

                    {item.queued && state.kind === 'idle' && (
                      <div
                        className="mt-2 pt-2 border-t flex items-center justify-between gap-2"
                        style={{ borderColor: 'var(--v2-border)' }}
                      >
                        <p className="text-[11px] text-[var(--v2-text-muted)] min-w-0">
                          {t('gaps.will_send')} {item.queued.label}
                          {item.queued.dueAt && <> · {dueIn(item.queued.dueAt, t)}</>}
                        </p>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => control(item, 'send_now')}
                            className="text-[11px] font-medium text-[var(--v2-primary)] hover:opacity-70"
                          >
                            {t('gaps.send_now')}
                          </button>
                          <span className="text-[var(--v2-border)]">·</span>
                          <button
                            type="button"
                            onClick={() => control(item, 'cancel')}
                            className="text-[11px] font-medium text-[var(--v2-text-muted)] hover:opacity-70"
                          >
                            {t('gaps.cancel')}
                          </button>
                        </div>
                      </div>
                    )}

                    {rows[`queued:${item.contactId}`]?.kind === 'refused' && (
                      <p className="mt-2 text-[11px] flex items-start gap-1.5 text-[var(--v2-text-muted)]">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
                        <span>{(rows[`queued:${item.contactId}`] as { message: string }).message}</span>
                      </p>
                    )}

                    {state.kind === 'refused' && (
                      <p className="mt-2 text-[11px] flex items-start gap-1.5 text-[var(--v2-text-muted)]">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
                        <span>{state.message}</span>
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * How long it has been stuck, in the units a person would say out loud.
 *
 * Deliberately coarse: nobody acts differently on four hours versus five, and
 * "3 days" is the number that decides whether this is now urgent.
 */
function waitedFor(since: string, t: (key: string) => string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 60000));
  if (minutes < 60) return t('gaps.just_now');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}${t('gaps.hours_short')}`;
  return `${Math.floor(hours / 24)}${t('gaps.days_short')}`;
}

/** Floored at a minute: "in 0 minutes" reads as already gone. */
function dueIn(dueAt: string, t: (key: string) => string): string {
  const minutes = Math.ceil((new Date(dueAt).getTime() - Date.now()) / 60000);
  if (minutes <= 1) return t('gaps.due_now');
  return t('gaps.due_in').replace('{n}', String(minutes));
}

/**
 * A refusal reason, in words.
 *
 * `t()` answers with the KEY when it does not know one, which is truthy — so a
 * `t(key) || t(fallback)` chain never reaches its fallback and an unmapped
 * reason renders as the literal string `gaps.refused.invoice_gone` on a
 * customer's dashboard. Deciding on the key list here is what stops that.
 */
const KNOWN_REASONS = new Set([
  'no_contact_email',
  'no_booking_url',
  'journey_not_ready',
  'not_found',
  'send_failed',
  'already_sending',
  'already_settled',
  'already_returned',
  'appointment_passed',
  'not_approved',
]);

function translateReason(t: (key: string) => string, reason?: string): string {
  return reason && KNOWN_REASONS.has(reason)
    ? t(`gaps.refused.${reason}`)
    : t('gaps.refused.generic');
}
