'use client';

/**
 * Permission to email clients: who has given it, what they were asked, and what
 * still stands in the way of using it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE COUNT IS AT THE TOP
 *
 * "12 of your 340 contacts can receive marketing email" is the single most
 * useful line on this screen, and it is the one that stops the send gate being
 * experienced as a bug. Everyone who signed up before the checkbox existed is
 * in the other 328, permanently: consent cannot be collected after the fact,
 * because the email asking for it would itself be the marketing email nobody
 * agreed to.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * Any way to mark contacts as consented in bulk. It would take one click to
 * undo everything this screen exists to do, and it is the first thing anyone
 * looking at the count above will want. Consent given on paper or in person is
 * recorded one person at a time, on their own card in the CRM, with the wording
 * typed in.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Info } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'MarketingConsentPanel' });

interface Settings {
  capture_enabled: boolean;
  statement_en: string | null;
  statement_he: string | null;
  statement_es: string | null;
  privacy_policy_mode: 'hosted' | 'url' | 'none';
  privacy_policy_url: string | null;
  privacy_policy_body: string | null;
  postal_address: string | null;
  label_as_advertisement: boolean;
}

interface Payload {
  settings: Settings | null;
  defaults: {
    statement_en: string;
    statement_he: string;
    statement_es: string;
    privacy_policy_body: string;
  };
  counts: { mailable: number; contacts: number };
  sending: { enabled: boolean; hasPostalAddress: boolean };
}

const EMPTY: Settings = {
  capture_enabled: true,
  statement_en: null,
  statement_he: null,
  statement_es: null,
  privacy_policy_mode: 'hosted',
  privacy_policy_url: null,
  privacy_policy_body: null,
  postal_address: null,
  label_as_advertisement: false,
};

export function MarketingConsentPanel() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [form, setForm] = useState<Settings>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/business-os/consent-settings');
      const json = await response.json();
      if (json.success) {
        setPayload(json.data);
        setForm({ ...EMPTY, ...(json.data.settings ?? {}) });
      }
    } catch (err) {
      logger.error({ err }, 'Could not load consent settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const response = await fetch('/api/business-os/consent-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await response.json();
      if (json.success) {
        setSaved(true);
        await load();
      }
    } catch (err) {
      logger.error({ err }, 'Could not save consent settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <Loader2 className="w-4 h-4 animate-spin text-[var(--v2-text-muted)]" />;
  }

  const counts = payload?.counts;
  const sending = payload?.sending;

  const field =
    'w-full rounded-lg border border-[var(--v2-border)] bg-[var(--v2-surface)] px-3 py-2 text-sm text-[var(--v2-text-primary)]';

  return (
    <div className="space-y-5 text-sm">
      {/* The number that makes the gate legible. */}
      {counts && (
        <div className="rounded-lg border border-[var(--v2-border)] p-3">
          <p className="text-[var(--v2-text-primary)]">
            <strong>{counts.mailable}</strong> of your <strong>{counts.contacts}</strong> contacts
            can receive marketing email.
          </p>
          {counts.contacts > counts.mailable && (
            <p className="mt-1 text-xs text-[var(--v2-text-muted)]">
              The rest were added before you started asking, so there is no record of them
              agreeing. That cannot be filled in afterwards: an email asking for permission
              is itself a marketing email. They will keep receiving bookings, invoices and
              receipts as normal.
            </p>
          )}
        </div>
      )}

      {/* Why nothing is going out yet, said plainly rather than left to be
          discovered when a campaign sends to nobody. */}
      {sending && !sending.enabled && (
        <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="text-xs text-amber-900">
            <p className="font-medium">Marketing sending is not switched on yet.</p>
            <p className="mt-1">
              Permission is being collected now because it cannot be collected later.
              Sending needs one more piece: an unsubscribe link in every message. Until
              that is in place nothing marketing will go out, even to people who have
              agreed.
            </p>
          </div>
        </div>
      )}

      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={form.capture_enabled}
          onChange={(e) => setForm({ ...form, capture_enabled: e.target.checked })}
          className="mt-0.5"
        />
        <span>
          <span className="text-[var(--v2-text-primary)]">Ask on my public forms</span>
          <span className="mt-0.5 block text-xs text-[var(--v2-text-muted)]">
            Adds an optional, unticked box to your contact form, booking pages and
            newsletter signup. Turning it off removes the box; it does not assume a yes.
          </span>
        </span>
      </label>

      <div>
        <label className="mb-1 block text-[var(--v2-text-primary)]">What people are agreeing to</label>
        <p className="mb-2 text-xs text-[var(--v2-text-muted)]">
          Shown next to the box and stored word for word with every agreement, so you can
          always show what someone actually said yes to. Leave blank to use the default.
        </p>
        {(['en', 'he', 'es'] as const).map((locale) => (
          <textarea
            key={locale}
            value={form[`statement_${locale}`] ?? ''}
            onChange={(e) =>
              setForm({ ...form, [`statement_${locale}`]: e.target.value || null })
            }
            rows={2}
            dir={locale === 'he' ? 'rtl' : 'ltr'}
            placeholder={payload?.defaults[`statement_${locale}`]}
            className={`${field} mb-2`}
          />
        ))}
      </div>

      <div>
        <label className="mb-1 block text-[var(--v2-text-primary)]">Privacy notice</label>
        <select
          value={form.privacy_policy_mode}
          onChange={(e) =>
            setForm({ ...form, privacy_policy_mode: e.target.value as Settings['privacy_policy_mode'] })
          }
          className={`${field} mb-2`}
        >
          <option value="hosted">Publish one on my pages</option>
          <option value="url">Link to my own</option>
          <option value="none">I do not publish one</option>
        </select>

        {form.privacy_policy_mode === 'url' && (
          <input
            type="url"
            value={form.privacy_policy_url ?? ''}
            onChange={(e) => setForm({ ...form, privacy_policy_url: e.target.value || null })}
            placeholder="https://example.com/privacy"
            className={field}
          />
        )}

        {form.privacy_policy_mode === 'hosted' && (
          <>
            <textarea
              value={form.privacy_policy_body ?? ''}
              onChange={(e) => setForm({ ...form, privacy_policy_body: e.target.value || null })}
              rows={10}
              placeholder={payload?.defaults.privacy_policy_body}
              className={`${field} font-mono text-xs`}
            />
            <p className="mt-1 text-xs text-[var(--v2-text-muted)]">
              Left blank, we publish a notice written from what we already hold about your
              business. It is a starting point, not legal advice — if you handle health
              data, work with children, or operate across several countries, have it looked
              at.
            </p>
          </>
        )}
      </div>

      <div>
        <label className="mb-1 block text-[var(--v2-text-primary)]">Postal address</label>
        <textarea
          value={form.postal_address ?? ''}
          onChange={(e) => setForm({ ...form, postal_address: e.target.value || null })}
          rows={2}
          className={field}
        />
        <p className="mt-1 text-xs text-[var(--v2-text-muted)]">
          Required by law in the footer of every marketing email, in most of the world.
          Agreement from the recipient does not replace it. Marketing will not send
          without one.
        </p>
      </div>

      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={form.label_as_advertisement}
          onChange={(e) => setForm({ ...form, label_as_advertisement: e.target.checked })}
          className="mt-0.5"
        />
        <span>
          <span className="text-[var(--v2-text-primary)]">Label marketing as advertising</span>
          <span className="mt-0.5 block text-xs text-[var(--v2-text-muted)]">
            Required for email sent to people in Israel. Adds a clear marking to the top of
            every marketing message.
          </span>
        </span>
      </label>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving} size="sm">
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
        </Button>
        {saved && <span className="text-xs text-emerald-600">Saved</span>}
      </div>
    </div>
  );
}
