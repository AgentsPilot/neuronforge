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
import { MailCheck, MailX, MailQuestion, Loader2 } from 'lucide-react';

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
/**
 * The two inputs on this panel, themed.
 *
 * They carried a border and nothing else — no background and no text colour — so
 * they fell through to the browser default and rendered as a white box with black
 * text inside a dark drawer. A border token alone is not enough: an input has to
 * name all three, because the UA stylesheet supplies the two it leaves out.
 *
 * `placeholder:` too. Left to the UA it is a light grey chosen against white.
 */
const FIELD =
  'w-full rounded-md border border-[var(--v2-border)] bg-[var(--v2-surface)] ' +
  'px-3 py-2 text-sm text-[var(--v2-text-primary)] ' +
  'placeholder:text-[var(--v2-text-muted)]';

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
  // The read failed. Distinct from "no consent": see `load` below.
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/crm/contacts/${contactId}/consent`);
      const json = await response.json();
      if (json.success) {
        setState(json.data);
        setUnavailable(false);
      } else {
        /*
         * A failed read is not a refusal.
         *
         * This branch did not exist: a non-success response left `state` null,
         * and null reaches the summary below as `state?.consented` — falsy — so
         * the section announced "Not given". That is an affirmative claim that
         * this person declined marketing consent, made on the strength of a
         * request that never answered. Consent is the one fact on this record
         * that decides whether it is lawful to email them, so inventing it from
         * a 404 is the worst available default.
         *
         * Say we could not read it instead, and let the rest of the section
         * stay closed rather than render a state nobody established.
         */
        setUnavailable(true);
        logger.warn(
          { contactId, status: response.status, error: json.error },
          'Could not read consent; showing it as unknown rather than as refused'
        );
      }
    } catch (err) {
      setUnavailable(true);
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
    : unavailable
      ? t('crm.consent.unavailable')
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
        // MailX reads as "they said no", so an unreadable state must not use it.
        unavailable ? (
          <MailQuestion className="w-4 h-4 text-[var(--v2-text-muted)]" />
        ) : state?.consented ? (
          <MailCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <MailX className="w-4 h-4 text-[var(--v2-text-muted)]" />
        )
      }
      badge={<span className="text-xs text-[var(--v2-text-secondary)]">{summary}</span>}
      isRTL={isRTL}
    >
      <div className="space-y-4 text-sm">
        {/*
          Where they came from, when it was the newsletter. A promoted
          subscriber keeps their roster row precisely so this line can exist.
        */}
        {!loading && state?.subscribedAt && (
          <p className="text-xs text-[var(--v2-text-secondary)]">
            {t('crm.consent.subscriber_since').replace('{date}', formatDate(state.subscribedAt))}
          </p>
        )}

        {!loading && !noEmail && !state?.consented && (
          <p className="text-[var(--v2-text-secondary)]">{t('crm.consent.explain_not_given')}</p>
        )}

        {/* The history. This is what answers a data request, so it shows the
            exact wording rather than a summary of it. */}
        {!loading && (state?.events?.length ?? 0) > 0 && (
          <ul className="space-y-3">
            {state!.events.map((event) => (
              <li key={event.id} className="border-s-2 ps-3" style={{ borderColor: 'var(--v2-border)' }}>
                <div className="flex items-center gap-2">
                  <span
                    className={
                      event.decision === 'granted'
                        ? 'font-medium text-emerald-700 dark:text-emerald-400'
                        : 'font-medium text-[var(--v2-text-secondary)]'
                    }
                  >
                    {event.decision === 'granted'
                      ? t('crm.consent.event_granted')
                      : t('crm.consent.event_withdrawn')}
                  </span>
                  <span className="text-xs text-[var(--v2-text-secondary)]">{formatDate(event.occurred_at)}</span>
                  <span className="text-xs text-[var(--v2-text-muted)]">
                    ·{' '}
                    {KNOWN_METHODS.includes(event.method)
                      ? t(`crm.consent.method.${event.method}`)
                      : event.method}
                  </span>
                </div>
                {event.statement_text && (
                  <p className="mt-1 text-xs text-[var(--v2-text-secondary)] italic">“{event.statement_text}”</p>
                )}
              </li>
            ))}
          </ul>
        )}

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

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
          <div className="space-y-2 rounded-lg border border-[var(--v2-border)] p-3">
            <p className="text-xs text-[var(--v2-text-secondary)]">{t('crm.consent.offline_hint')}</p>
            <textarea
              value={wording}
              onChange={(e) => setWording(e.target.value)}
              rows={3}
              className={FIELD}
              placeholder={t('crm.consent.offline_placeholder')}
            />
            <label className="block text-xs text-[var(--v2-text-secondary)]">
              {t('crm.consent.when_agreed')}
              <input
                type="date"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                className={`${FIELD} mt-1 block w-auto px-2 py-1`}
              />
            </label>
            <div className="flex gap-2">
              {/*
                Explicit colours, because the `Button` default variant has none.
                It resolves to `bg-primary text-primary-foreground`, and neither
                class exists: `tailwind.config.js` defines `v2.primary`, never a
                bare `primary`, and no stylesheet defines `--primary`. So the
                default variant emits no background and no colour — this Save read
                as bare text, and in a dark drawer there was nothing behind it.
              */}
              <Button
                size="sm"
                className="bg-[var(--v2-primary)] text-white hover:opacity-90"
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
