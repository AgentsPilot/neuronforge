'use client';

/**
 * FR-1: create an invite.
 *
 * Every choice on this form arrives in `options`, decided by the server: the
 * invite types and whether each is available, the plans a type can grant, the
 * expiry choices and default, the languages and default, and the month cap. The
 * form names no plan and no type. It keys "needs an access decision" on
 * `requiresAccess`, not on which type it is.
 *
 * A disabled option is presentation only. The server refuses a Paid invite on
 * its own (C-6); this form just says so first, with the server's words.
 *
 * Slice 2a (FR-14): "Send the invitation email" is ticked by default. Unticked,
 * nothing is sent and the admin copies the link from the panel, as before. The
 * language arrives pre-selected to the admin's own saved language (D-8).
 */

import { useMemo, useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';

import type { CreateInviteRequest, CreatedInvite, InviteFormOptions } from '../types';

interface Props {
  options: InviteFormOptions;
  onCreated: (created: CreatedInvite) => void;
  onCancel: () => void;
}

/** What the server's refusal codes mean, in the admin's words. */
const ERROR_TEXT: Record<string, string> = {
  invalid_input: 'Some fields are not valid. Check the email, the reason and the choices.',
  paid_invites_not_available: 'Paid invites are not available until payments are live.',
  invite_type_not_allowed: 'You cannot issue this type of invite.',
  grant_not_available: 'That plan is no longer offered.',
  could_not_create_invite: 'The invite could not be created. Try again.',
};

const REASON_MIN = 3;

export function CreateInviteForm({ options, onCreated, onCancel }: Props) {
  const firstAvailable = options.inviteTypes.find((type) => type.available) ?? null;

  const [email, setEmail] = useState('');
  const [inviteType, setInviteType] = useState<string>(firstAvailable?.type ?? '');
  const [grantId, setGrantId] = useState<string>('');
  const [accessKind, setAccessKind] = useState<'' | 'open_ended' | 'months'>('');
  const [months, setMonths] = useState('12');
  const [expiryDays, setExpiryDays] = useState(options.defaultExpiryDays);
  const [language, setLanguage] = useState(options.defaultLanguage);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => options.inviteTypes.find((type) => type.type === inviteType) ?? null,
    [options.inviteTypes, inviteType]
  );
  const effectiveGrant = grantId || selected?.grants.find((grant) => grant.default)?.id || '';
  const monthsNumber = Number(months);
  const monthsValid = Number.isInteger(monthsNumber) && monthsNumber >= 1 && monthsNumber <= options.championAccessMonthsMax;

  const canSubmit =
    !submitting &&
    selected !== null &&
    selected.available &&
    email.trim().length > 0 &&
    Array.from(reason.trim()).length >= REASON_MIN &&
    (!selected.requiresAccess || accessKind === 'open_ended' || (accessKind === 'months' && monthsValid));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !canSubmit) return;

    const request: CreateInviteRequest = {
      inviteType: selected.type,
      email: email.trim(),
      linkExpiryDays: expiryDays,
      language,
      reason: reason.trim(),
      sendEmail,
      ...(note.trim() ? { personalNote: note.trim() } : {}),
      ...(selected.requiresAccess
        ? { access: accessKind === 'months' ? { kind: 'months' as const, months: monthsNumber } : { kind: 'open_ended' as const } }
        : { grantId: effectiveGrant }),
    };

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/business-os/invites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.success) {
        const code = typeof body?.error === 'string' ? body.error : 'could_not_create_invite';
        setError(ERROR_TEXT[code] ?? ERROR_TEXT.could_not_create_invite);
        return;
      }
      onCreated(body.data as CreatedInvite);
    } catch {
      setError(ERROR_TEXT.could_not_create_invite);
    } finally {
      setSubmitting(false);
    }
  };

  const field = 'w-full rounded border border-slate-600 bg-slate-900/60 px-3 py-2 text-sm text-white';
  const label = 'mb-1 block text-xs font-medium text-slate-300';

  return (
    <form
      data-testid="create-invite-form"
      onSubmit={(event) => void submit(event)}
      className="space-y-4 rounded-lg border border-slate-700 bg-slate-800/40 p-4"
    >
      <h2 className="text-sm font-semibold text-white">New invite</h2>

      <div>
        <label htmlFor="invite-email" className={label}>
          Email
        </label>
        <input
          id="invite-email"
          type="email"
          autoComplete="off"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={field}
        />
      </div>

      <fieldset>
        <legend className={label}>Invite type</legend>
        <div className="space-y-1">
          {options.inviteTypes.map((type) => (
            <label key={type.type} className={`flex items-center gap-2 text-sm ${type.available ? 'text-slate-200' : 'text-slate-500'}`}>
              <input
                type="radio"
                name="invite-type"
                value={type.type}
                checked={inviteType === type.type}
                disabled={!type.available}
                onChange={() => {
                  setInviteType(type.type);
                  setGrantId('');
                }}
              />
              {type.label}
              {!type.available && type.unavailableReason && (
                <span className="text-xs text-slate-500">({type.unavailableReason})</span>
              )}
            </label>
          ))}
        </div>
      </fieldset>

      {selected && selected.grants.length > 0 && (
        <div>
          <label htmlFor="invite-grant" className={label}>
            Plan
          </label>
          <select id="invite-grant" value={effectiveGrant} onChange={(event) => setGrantId(event.target.value)} className={field}>
            {selected.grants.map((grant) => (
              <option key={grant.id} value={grant.id}>
                {grant.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {selected?.requiresAccess && (
        <fieldset>
          <legend className={label}>Access end (required)</legend>
          <div className="space-y-1 text-sm text-slate-200">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="invite-access"
                value="open_ended"
                checked={accessKind === 'open_ended'}
                onChange={() => setAccessKind('open_ended')}
              />
              No end date
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="invite-access"
                value="months"
                checked={accessKind === 'months'}
                onChange={() => setAccessKind('months')}
              />
              A number of months from signup
            </label>
            {accessKind === 'months' && (
              <input
                aria-label="Months of access"
                type="number"
                min={1}
                max={options.championAccessMonthsMax}
                value={months}
                onChange={(event) => setMonths(event.target.value)}
                className={`${field} max-w-[8rem]`}
              />
            )}
          </div>
        </fieldset>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="invite-expiry" className={label}>
            Link expiry
          </label>
          <select
            id="invite-expiry"
            value={expiryDays}
            onChange={(event) => setExpiryDays(Number(event.target.value))}
            className={field}
          >
            {options.expiryDays.map((days) => (
              <option key={days} value={days}>
                {days} days
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="invite-language" className={label}>
            Invitee language
          </label>
          <select id="invite-language" value={language} onChange={(event) => setLanguage(event.target.value)} className={field}>
            {options.languages.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="invite-note" className={label}>
          Personal note (optional, shown to the invitee)
        </label>
        <textarea id="invite-note" rows={3} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} className={field} />
      </div>

      <div>
        <label htmlFor="invite-reason" className={label}>
          Internal reason (at least {REASON_MIN} characters, never shown to the invitee)
        </label>
        <input
          id="invite-reason"
          type="text"
          maxLength={500}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className={field}
        />
      </div>

      <div>
        <label className="flex items-start gap-2 text-sm text-slate-200">
          <input
            data-testid="invite-send-email"
            type="checkbox"
            checked={sendEmail}
            onChange={(event) => setSendEmail(event.target.checked)}
            className="mt-1"
          />
          <span>
            Send the invitation email
            <span className="block text-xs text-slate-400">
              {sendEmail
                ? 'The invitee gets an email with the link, in the language above. The link is also shown once, to copy.'
                : 'No email is sent. Copy the link from the next screen and send it yourself.'}
            </span>
          </span>
        </label>
      </div>

      {error && (
        <p role="alert" className="text-sm text-rose-300">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className="flex items-center gap-2 rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-40"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Create
        </button>
        <button type="button" onClick={onCancel} className="rounded border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700/50">
          Cancel
        </button>
      </div>
    </form>
  );
}
