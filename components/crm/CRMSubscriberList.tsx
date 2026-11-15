'use client';

/**
 * Everyone the business may email.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This was the newsletter roster and nothing else, on the reasoning that these
 * people "are not contacts: they gave an address and nothing else". True of a
 * roster row, and it described almost nobody — the roster only ever receives
 * newsletter signups who were not already contacts, while consent is given far
 * more often inside the booking flow, on the contact form, and by the owner in
 * the CRM drawer. On a live account that was nine people consented and an
 * empty screen.
 *
 * So the list answers the question an owner actually asks of it — who may I
 * write to — and `status` says how each person got here. A `contact` row is
 * somebody already in the CRM: it carries a name, shows no Promote button, and
 * is still listed, because leaving them out is what made this screen useless.
 *
 * Still deliberately NOT the contacts list: a contact with no consent does not
 * appear, and a plain address with consent does.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module components/crm/CRMSubscriberList
 */

import { useCallback, useEffect, useState } from 'react';
import { Mail, MailCheck, MailX, Clock, Loader2, ArrowRight, User } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { CRMLoadingState } from '@/components/crm/CRMLoadingState';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'CRMSubscriberList' });

interface Subscriber {
  id: string;
  email: string;
  name: string | null;
  /** `contact` is somebody already in the CRM who consented elsewhere. */
  status: 'pending' | 'confirmed' | 'unsubscribed' | 'promoted' | 'contact';
  source: string;
  subscribed_at: string;
  confirmed_at: string | null;
  promoted_contact_id: string | null;
  mailable: boolean;
}

/**
 * How this person arrived, in words rather than in the column's own value.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The row printed `source` raw, so an owner read `website_booking`, `consent`
 * and `footer_form` — three different vocabularies, none of them language, all
 * of them ours rather than theirs.
 *
 * `source` is written by several flows and by the contacts table too, so the
 * set is open. The fallback is therefore a real sentence rather than the raw
 * value: a source nobody has translated yet reads as "agreed to be emailed",
 * which is true of every row on this screen by definition, instead of leaking
 * a snake_case token onto a client-facing-looking list.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function sourcePhrase(source: string | null | undefined, t: (key: string) => string): string {
  const key = `crm.subscribers.source.${String(source ?? '').trim() || 'unknown'}`;
  const phrase = t(key);
  return phrase !== key ? phrase : t('crm.subscribers.source.unknown');
}

const STATUS_ICON = {
  pending: Clock,
  confirmed: MailCheck,
  unsubscribed: MailX,
  promoted: ArrowRight,
  contact: User,
} as const;

const STATUS_TONE = {
  pending: 'text-amber-600',
  confirmed: 'text-emerald-600',
  unsubscribed: 'text-gray-400',
  promoted: 'text-[#8B5CF6]',
  /*
   * The same violet as `promoted`, because both mean "this person is in the
   * CRM". The two differ in how they got there, which the label says, and
   * giving that a second colour would imply a difference the owner can act on.
   */
  contact: 'text-[#8B5CF6]',
} as const;

export function CRMSubscriberList({ onPromoted }: { onPromoted?: () => void }) {
  const { t, isRTL, language } = useLanguage();
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [loading, setLoading] = useState(true);
  /*
   * ON by default, which is the opposite of what it was.
   *
   * The list is "everyone you may email", and on a real account most of those
   * people are already contacts — they consented while booking or enquiring.
   *
   * ── IT OPENS CLOSED AGAIN, AND WHY THAT IS SAFE NOW ───────────────────────
   * Owner decision 2026-11-14: a contact already in the pipeline appearing on
   * this screen read as a mistake — "why do I get him, he is in the pipeline".
   * The honest default is therefore the narrower one: people you may email and
   * have NOT started working yet.
   *
   * That default is exactly what once made this screen show zero rows for an
   * account with nine consented people, so it does not go back alone. The
   * empty state below now distinguishes "nobody has agreed to anything" from
   * "everyone who agreed is already in your CRM", and the second points at the
   * toggle that reveals them. The old failure was a blank screen with no way
   * out of it; what is restored is the default, not the dead end.
   */
  const [includePromoted, setIncludePromoted] = useState(false);
  const [promoting, setPromoting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      /*
       * Sent on every request rather than only when true. The route's default
       * is now "include", so an omitted parameter no longer means "exclude" —
       * saying it outright is what keeps the two ends from disagreeing.
       */
      const response = await fetch(
        `/api/crm/subscribers?includePromoted=${includePromoted}`
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
    /*
     * It SAYS what it is loading.
     *
     * A bare spinner was defensible while the CRM page covered this tab with
     * its own "Loading contacts…" — one of them had to be wrong, and the page
     * won. Now that the page no longer holds this view behind a contacts fetch
     * it has no use for, this spinner is the only one the owner sees here, so
     * it names its own subject like the tasks list does.
     */
    return (
      <CRMLoadingState label={t('crm.subscribers.loading')} />
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
      {/*
        THIS VIEW'S OWN HEADING.
        ─────────────────────────────────────────────────────────────────────
        The page header says "client list — manage your contacts and
        relationships", which is the CONTACTS view talking. Over this list it
        is wrong twice: these are not all contacts, and the screen is not about
        relationships but about permission.

        The sentence is the one the empty state already carried, kept now that
        there are rows — which is exactly when an owner stops being able to
        work out what they are looking at.
      */}
      {/*
        ONE HEADER ROW: what this list is, and the one control over it.

        The switch had a line of its own under the two-line heading, which gave
        the screen three stacked bands of text before the first person in it.
        Beside the heading it costs no vertical space and reads as part of the
        same statement: here is the audience, and here is whether the people
        already in the CRM are in it.

        `flex-wrap` rather than a breakpoint: the switch drops under the
        heading only when there is genuinely no room for it, which is the same
        answer at any width. `justify-between` is logical, so the switch sits
        left in Hebrew without a second rule.
      */}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-[var(--v2-text-primary)]">
            {t('crm.subscribers.title')}
          </h2>
          <p className="mt-0.5 text-sm text-[var(--v2-text-secondary)]">
            {t('crm.subscribers.subtitle')}
          </p>
        </div>

        {/* `pt-0.5` so it rests on the TITLE's line rather than above it. */}
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
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
      </div>

      {subscribers.length === 0 ? (
        /*
          TWO EMPTY STATES, because they mean opposite things.

          "Nobody has agreed to be emailed" is a business fact and the owner's
          next move is to start collecting consent. "Everyone who agreed is
          already in your CRM" is a FILTER, and the next move is one click on
          the switch above. Saying the first when the second is true is the
          blank screen this default caused before.
        */
        <div className="p-12 text-center text-[var(--v2-text-muted)]">
          <Mail className="mx-auto mb-4 h-10 w-10 opacity-40" />
          <p>{includePromoted ? t('crm.subscribers.empty') : t('crm.subscribers.empty_filtered')}</p>
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
                  {/*
                    TWO QUESTIONS, TWO LINES.
                    ───────────────────────────────────────────────────────
                    One slot used to carry both "איש קשר" (who they are) and
                    "אושר" (the state of their consent), in the same position
                    and the same styling, so neither read clearly. The status
                    answers whether you may write to them; the line beneath
                    answers how they got here and when.
                  */}
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className={`inline-flex items-center gap-1 ${STATUS_TONE[s.status]}`}>
                      <Icon className="h-3.5 w-3.5" />
                      {t(`crm.subscribers.status_${s.status}`)}
                    </span>
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

                  <div className="mt-1 text-xs text-[var(--v2-text-muted)]">
                    {sourcePhrase(s.source, t)}
                    {' · '}
                    {t('crm.subscribers.subscribed_on')} {formatDate(s.subscribed_at)}
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
