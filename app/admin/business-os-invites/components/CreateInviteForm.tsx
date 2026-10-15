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
 *
 * Admin Layout Standard L-6: styling only, plus the reply read through the
 * shared `readJsonBody` (C-4); the fields, defaults, request body and error map
 * are unchanged. This form never touches the URL or the shared URL hook (SA-R-5
 * (2)): the link it produces is shown once and must not survive a reload.
 *
 * ── Admin Layout Follow-ups LF-3a (OR-2, SA-C9) ─────────────────────────────
 * The form is the body of the page's "New invite" drawer. Its draft is held by
 * the page (`draft`, `onDraftChange`), so Escape or an overlay click, which
 * close the drawer and unmount this form, never lose what the admin typed; only
 * Cancel or a success clears it. `submitting` and the error stay here: they are
 * about one attempt. The drawer's title is the heading, so the form has none.
 *
 * One send per Create (SA C5 a): a ref is checked first and set before any
 * await, so a second submit in the same tick returns at once. `onBusyChange`
 * tells the page a request is in flight, so it can refuse to close the drawer;
 * Cancel is disabled for the same reason. The request bytes are unchanged and
 * pinned by `__tests__/invites.requestPins.render.test.tsx`.
 */

import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';

import { readJsonBody } from '@/app/admin/components/layout/readJsonBody';

import type { CreateInviteRequest, CreatedInvite, InviteFormOptions } from '../types';

/** What the admin has typed and chosen so far: the ten values the form edits. */
export interface InviteDraft {
  email: string;
  inviteType: string;
  grantId: string;
  accessKind: '' | 'open_ended' | 'months';
  months: string;
  expiryDays: number;
  language: string;
  note: string;
  reason: string;
  sendEmail: boolean;
}

/** A fresh draft: the same starting values the form always had. */
export function initialInviteDraft(options: InviteFormOptions): InviteDraft {
  const firstAvailable = options.inviteTypes.find((type) => type.available) ?? null;
  return {
    email: '',
    inviteType: firstAvailable?.type ?? '',
    grantId: '',
    accessKind: '',
    months: '12',
    expiryDays: options.defaultExpiryDays,
    language: options.defaultLanguage,
    note: '',
    reason: '',
    sendEmail: true,
  };
}

interface Props {
  options: InviteFormOptions;
  draft: InviteDraft;
  onDraftChange: (draft: InviteDraft) => void;
  /** True from the moment a create is sent until it has settled. Writes a page ref only. */
  onBusyChange: (isBusy: boolean) => void;
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

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500';

export function CreateInviteForm({ options, draft, onDraftChange, onBusyChange, onCreated, onCancel }: Props) {
  const { email, inviteType, grantId, accessKind, months, expiryDays, language, note, reason, sendEmail } = draft;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set synchronously on the first submit: the guard a same-tick second submit cannot pass. */
  const isSending = useRef(false);

  const update = (patch: Partial<InviteDraft>) => onDraftChange({ ...draft, ...patch });

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
    if (isSending.current) return;
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

    isSending.current = true;
    onBusyChange(true);
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/business-os/invites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      });
      const body = await readJsonBody(response);
      if (!response.ok || !body || !body.success) {
        const code = typeof body?.error === 'string' ? body.error : 'could_not_create_invite';
        setError(ERROR_TEXT[code] ?? ERROR_TEXT.could_not_create_invite);
        return;
      }
      onCreated(body.data as CreatedInvite);
    } catch {
      setError(ERROR_TEXT.could_not_create_invite);
    } finally {
      isSending.current = false;
      onBusyChange(false);
      setSubmitting(false);
    }
  };

  const field = `w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-sm text-white ${FOCUS_RING}`;
  const label = 'mb-1 block text-xs font-medium text-slate-300';

  return (
    <form data-testid="create-invite-form" onSubmit={(event) => void submit(event)} className="space-y-4">
      <div>
        <label htmlFor="invite-email" className={label}>
          Email
        </label>
        <input
          id="invite-email"
          type="email"
          autoComplete="off"
          value={email}
          onChange={(event) => update({ email: event.target.value })}
          className={field}
        />
      </div>

      <fieldset>
        <legend className={label}>Invite type</legend>
        <div className="space-y-1">
          {options.inviteTypes.map((type) => (
            <label key={type.type} className={`flex items-center gap-2 text-sm ${type.available ? 'text-slate-200' : 'text-slate-400'}`}>
              <input
                type="radio"
                name="invite-type"
                value={type.type}
                checked={inviteType === type.type}
                disabled={!type.available}
                onChange={() => update({ inviteType: type.type, grantId: '' })}
              />
              {type.label}
              {!type.available && type.unavailableReason && (
                <span className="text-xs text-slate-400">({type.unavailableReason})</span>
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
          <select id="invite-grant" value={effectiveGrant} onChange={(event) => update({ grantId: event.target.value })} className={field}>
            {selected.grants.map((grant) => (
              <option key={grant.id} value={grant.id}>
                {grant.label}
              </option>
            ))}
          </select>
          {/* P-9.2: the server's note (the invitee pays at signup). Rendered, never decided here. */}
          {selected.note && (
            <p data-testid="invite-grant-note" className="mt-1 text-xs text-slate-500">
              {selected.note}
            </p>
          )}
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
                onChange={() => update({ accessKind: 'open_ended' })}
              />
              No end date
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="invite-access"
                value="months"
                checked={accessKind === 'months'}
                onChange={() => update({ accessKind: 'months' })}
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
                onChange={(event) => update({ months: event.target.value })}
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
            onChange={(event) => update({ expiryDays: Number(event.target.value) })}
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
          <select id="invite-language" value={language} onChange={(event) => update({ language: event.target.value })} className={field}>
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
        <textarea id="invite-note" rows={3} maxLength={1000} value={note} onChange={(event) => update({ note: event.target.value })} className={field} />
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
          onChange={(event) => update({ reason: event.target.value })}
          className={field}
        />
      </div>

      <div>
        <label className="flex items-start gap-2 text-sm text-slate-200">
          <input
            data-testid="invite-send-email"
            type="checkbox"
            checked={sendEmail}
            onChange={(event) => update({ sendEmail: event.target.checked })}
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
          className={`flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-40 ${FOCUS_RING}`}
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Create
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className={`rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700/50 disabled:opacity-40 ${FOCUS_RING}`}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
