'use client';

/**
 * Whether this person can receive marketing email, and the evidence behind it.
 *
 * Without this panel the send gate is invisible: the owner asks the platform to
 * email a client, nothing arrives, and there is nowhere to find out why. That
 * reads as a broken feature rather than as a rule being applied.
 *
 * THE TWO ACTIONS ARE DELIBERATELY ASYMMETRIC.
 *
 * Withdrawing is one click. Recording a consent given offline takes a sentence:
 * the owner has to type what the person actually agreed to, and when. A plain
 * on/off toggle would be the "mark everyone as consented" button in miniature,
 * and it would make the lazy path the unlawful one.
 *
 * @module components/crm/contact-drawer/ConsentSection
 */

import { useCallback, useEffect, useState } from 'react';
import { MailCheck, MailX, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { CollapsibleSection } from '../CollapsibleSection';
import { createLogger } from '@/lib/logger';
import { useLanguage } from '@/lib/business-os/LanguageContext';

const logger = createLogger({ module: 'ConsentSection' });

interface ConsentEvent {
  id: string;
  decision: 'granted' | 'withdrawn';
  method: string;
  statement_text: string | null;
  source_surface: string | null;
  occurred_at: string;
}

interface ConsentState {
  email?: string;
  consented: boolean | null;
  decidedAt: string | null;
  events: ConsentEvent[];
  /** Set where this contact began as a newsletter subscriber. */
  subscribedAt?: string | null;
}

/**
 * Plain words for a database enum. The owner never sees `list_unsubscribe`.
 *
 * Listed rather than interpolated into the key: `t()` answers with the KEY
 * itself when it does not know one, so an enum value this list has not met
 * would render as the literal string `crm.consent.method.whatever` in the
 * consent history — the one place in the app that has to read back exactly what
 * happened. Unknown methods fall through to the raw value instead, which at
 * least says something true.
 */
const KNOWN_METHODS = [
  'web_form',
  'double_optin_confirm',
  'unsubscribe_link',
  'list_unsubscribe',
  'owner_entered',
  'imported',
  'reply_stop',
  'legacy_unsubscribe_import',
];

interface Props {
  contactId: string;
  isRTL?: boolean;
}

export function ConsentSection({ contactId, isRTL }: Props) {
  const { t, language } = useLanguage();
  const [state, setState] = useState<ConsentState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showGrantForm, setShowGrantForm] = useState(false);
  const [wording, setWording] = useState('');
  const [when, setWhen] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/crm/contacts/${contactId}/consent`);
      const json = await response.json();
      if (json.success) setState(json.data);
    } catch (err) {
      logger.error({ err, contactId }, 'Could not load consent');
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    void load();
  }, [load]);

  const record = async (body: Record<string, unknown>) => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/crm/contacts/${contactId}/consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await response.json();
      if (!json.success) throw new Error(json.error || t('crm.consent.save_failed'));
      setShowGrantForm(false);
      setWording('');
      setWhen('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('crm.consent.save_failed'));
    } finally {
      setSaving(false);
    }
  };

  /*
   * The reader's language, not the browser's. A Hebrew interface showing
   * "Mar 3" is the kind of half-translated surface that reads as unfinished.
   */
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(language, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

  // No address means nothing to hold consent against. Say so rather than
  // showing "not given", which implies they declined.
  const noEmail = state?.consented === null;

  const summary = loading
    ? t('crm.consent.checking')
    : noEmail
      ? t('crm.consent.no_email')
      : state?.consented
        ? t('crm.consent.agreed_on')
            .replace('{date}', state.decidedAt ? formatDate(state.decidedAt) : '')
            .trim()
        : t('crm.consent.not_given');

  return (
    <CollapsibleSection
      title={t('crm.consent.title')}
      icon={
        state?.consented ? (
          <MailCheck className="w-4 h-4 text-emerald-600" />
        ) : (
          <MailX className="w-4 h-4 text-gray-400" />
        )
      }
      badge={<span className="text-xs text-gray-500">{summary}</span>}
      isRTL={isRTL}
    >
      <div className="space-y-4 text-sm">
        {/*
          Where they came from, when it was the newsletter. A promoted
          subscriber keeps their roster row precisely so this line can exist.
        */}
        {!loading && state?.subscribedAt && (
          <p className="text-xs text-gray-500">
            {t('crm.consent.subscriber_since').replace('{date}', formatDate(state.subscribedAt))}
          </p>
        )}

        {!loading && !noEmail && !state?.consented && (
          <p className="text-gray-500">{t('crm.consent.explain_not_given')}</p>
        )}

        {/* The history. This is what answers a data request, so it shows the
            exact wording rather than a summary of it. */}
        {!loading && (state?.events?.length ?? 0) > 0 && (
          <ul className="space-y-3">
            {state!.events.map((event) => (
              <li key={event.id} className="border-s-2 ps-3" style={{ borderColor: '#e5e7eb' }}>
                <div className="flex items-center gap-2">
                  <span
                    className={
                      event.decision === 'granted'
                        ? 'font-medium text-emerald-700'
                        : 'font-medium text-gray-600'
                    }
                  >
                    {event.decision === 'granted'
                      ? t('crm.consent.event_granted')
                      : t('crm.consent.event_withdrawn')}
                  </span>
                  <span className="text-xs text-gray-500">{formatDate(event.occurred_at)}</span>
                  <span className="text-xs text-gray-400">
                    ·{' '}
                    {KNOWN_METHODS.includes(event.method)
                      ? t(`crm.consent.method.${event.method}`)
                      : event.method}
                  </span>
                </div>
                {event.statement_text && (
                  <p className="mt-1 text-xs text-gray-500 italic">“{event.statement_text}”</p>
                )}
              </li>
            ))}
          </ul>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        {!loading && !noEmail && (
          <div className="flex flex-wrap gap-2">
            {/* One click, always available. Withdrawal is never made harder
                than agreeing was. */}
            {state?.consented && (
              <Button
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => record({ decision: 'withdrawn' })}
              >
                {saving ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  t('crm.consent.record_withdrawal')
                )}
              </Button>
            )}

            {!state?.consented && !showGrantForm && (
              <Button variant="outline" size="sm" onClick={() => setShowGrantForm(true)}>
                {t('crm.consent.record_offline')}
              </Button>
            )}
          </div>
        )}

        {showGrantForm && (
          <div className="space-y-2 rounded-lg border border-gray-200 p-3">
            <p className="text-xs text-gray-500">{t('crm.consent.offline_hint')}</p>
            <textarea
              value={wording}
              onChange={(e) => setWording(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
              placeholder={t('crm.consent.offline_placeholder')}
            />
            <label className="block text-xs text-gray-500">
              {t('crm.consent.when_agreed')}
              <input
                type="date"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                className="mt-1 block rounded-md border border-gray-200 px-2 py-1 text-sm"
              />
            </label>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={saving || !wording.trim()}
                onClick={() =>
                  record({
                    decision: 'granted',
                    statement_text: wording.trim(),
                    // Midday, not midnight: a date with no time is a day, and
                    // midnight in the browser's zone can land on the day before
                    // once it reaches the database as UTC.
                    occurred_at: when ? new Date(`${when}T12:00:00`).toISOString() : undefined,
                  })
                }
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : t('common.save')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowGrantForm(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}
