'use client';

/**
 * The newsletter audience.
 *
 * Deliberately not the contacts list. These people are not contacts: they gave
 * an address and nothing else, no chaser can reach them, and they have no
 * pipeline position to show. What matters here is whether they confirmed, where
 * they came from, and whether the owner wants to start working them.
 *
 * @module components/crm/CRMSubscriberList
 */

import { useCallback, useEffect, useState } from 'react';
import { Mail, MailCheck, MailX, Clock, Loader2, ArrowRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'CRMSubscriberList' });

interface Subscriber {
  id: string;
  email: string;
  name: string | null;
  status: 'pending' | 'confirmed' | 'unsubscribed' | 'promoted';
  source: string;
  subscribed_at: string;
  confirmed_at: string | null;
  promoted_contact_id: string | null;
  mailable: boolean;
}

const STATUS_ICON = {
  pending: Clock,
  confirmed: MailCheck,
  unsubscribed: MailX,
  promoted: ArrowRight,
} as const;

const STATUS_TONE = {
  pending: 'text-amber-600',
  confirmed: 'text-emerald-600',
  unsubscribed: 'text-gray-400',
  promoted: 'text-[#8B5CF6]',
} as const;

export function CRMSubscriberList({ onPromoted }: { onPromoted?: () => void }) {
  const { t, isRTL, language } = useLanguage();
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [loading, setLoading] = useState(true);
  const [includePromoted, setIncludePromoted] = useState(false);
  const [promoting, setPromoting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/crm/subscribers${includePromoted ? '?includePromoted=true' : ''}`
      );
      const json = await response.json();
      if (json.success) setSubscribers(json.subscribers ?? []);
    } catch (err) {
      logger.error({ err }, 'Could not load subscribers');
    } finally {
      setLoading(false);
    }
  }, [includePromoted]);

  useEffect(() => {
    void load();
  }, [load]);

  const promote = async (id: string) => {
    setPromoting(id);
    try {
      const response = await fetch('/api/crm/subscribers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriberId: id }),
      });
      const json = await response.json();
      if (json.success) {
        await load();
        // The pipeline gained a contact; the page owns that list, not this.
        onPromoted?.();
      }
    } catch (err) {
      logger.error({ err, id }, 'Could not promote a subscriber');
    } finally {
      setPromoting(null);
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(language === 'he' ? 'he-IL' : language === 'es' ? 'es-ES' : 'en-GB', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

  if (loading) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--v2-text-muted)]" />
      </div>
    );
  }

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'} className="space-y-4">
      {/*
        A toggle, not a checkbox: this switches the view between two states
        rather than collecting an answer to be submitted. The same `Switch` the
        settings panels and the briefing card use, so it reads as the one
        control the product already has.
      */}
      <div className="flex items-center gap-2">
        <Switch
          id="include-promoted"
          checked={includePromoted}
          onCheckedChange={setIncludePromoted}
        />
        <label
          htmlFor="include-promoted"
          className="cursor-pointer text-sm text-[var(--v2-text-secondary)]"
        >
          {t('crm.subscribers.show_promoted')}
        </label>
      </div>

      {subscribers.length === 0 ? (
        <div className="p-12 text-center text-[var(--v2-text-muted)]">
          <Mail className="mx-auto mb-4 h-10 w-10 opacity-40" />
          <p>{t('crm.subscribers.empty')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {subscribers.map((s) => {
            const Icon = STATUS_ICON[s.status];
            return (
              <div
                key={s.id}
                className="flex items-center justify-between gap-4 border border-[var(--v2-border)] bg-[var(--v2-surface)] p-4"
                style={{ borderRadius: 'var(--v2-radius-card)' }}
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-[var(--v2-text-primary)]">
                    {s.name || s.email}
                  </div>
                  {s.name && (
                    <div className="truncate text-sm text-[var(--v2-text-secondary)]">{s.email}</div>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--v2-text-muted)]">
                    <span className={`inline-flex items-center gap-1 ${STATUS_TONE[s.status]}`}>
                      <Icon className="h-3.5 w-3.5" />
                      {t(`crm.subscribers.status_${s.status}`)}
                    </span>
                    <span>
                      {t('crm.subscribers.subscribed_on')} {formatDate(s.subscribed_at)}
                    </span>
                    <span>{s.source}</span>
                    {/*
                      Shown only where the two disagree — confirmed here but not
                      mailable, because consent was withdrawn somewhere this
                      table never saw. The consent record governs sending, so
                      the discrepancy is surfaced rather than hidden.
                    */}
                    {s.status === 'confirmed' && !s.mailable && (
                      <span className="text-amber-600">{t('crm.subscribers.not_mailable')}</span>
                    )}
                  </div>
                </div>

                {/* Only for somebody not already a contact. */}
                {!s.promoted_contact_id && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={promoting === s.id}
                    onClick={() => promote(s.id)}
                    className="flex-shrink-0"
                  >
                    {promoting === s.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      t('crm.subscribers.promote')
                    )}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
