'use client';

/**
 * ProposalBuilderModal
 *
 * Where the owner answers a quote request.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS DELIBERATELY IS NOT
 *
 * It is not a quoting tool. There are no line items, no unit prices, no
 * quantities and no cost breakdown — because the moment a proposal holds a
 * breakdown, this product owes the user a catalogue, a markup model and a
 * margin report, and becomes the project-management tool it is not trying to
 * be.
 *
 * What a small business actually needs to send is one number and a paragraph
 * explaining it, plus how that number is paid. So the owner types the total
 * they already worked out elsewhere, describes the work in their own words, and
 * splits the money into stages.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The split is the one place with a hard rule: percentages must sum to exactly
 * 100. A proposal that adds up to 90% is a client agreeing to pay less than the
 * total they were shown, and the difference is only discovered when the last
 * invoice is short. So sending is blocked, and the shortfall is named.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { FileText, Loader2, Paperclip, Plus, Send, Trash2, AlertTriangle, X } from 'lucide-react';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'ProposalBuilderModal' });

/** Mirrors `PaymentShape` in ProposalRepository. */
type ShapeKind = 'single' | 'installments' | 'milestones';

interface Stage {
  label: string;
  /** Held as a string so a half-typed "1" is not read as 1%. */
  percent: string;
}

interface ProposalBuilderModalProps {
  isOpen: boolean;
  onClose: () => void;
  contactId: string;
  contactName: string;
  /** The service they asked about, when the request named one. */
  serviceId?: string | null;
  /** The booking this quote answers. Ties it to one request, not to the service. */
  bookingId?: string | null;
  /** Pre-fills the title — usually the service name from the request. */
  defaultTitle?: string;
  currency?: string;
  /** A previous proposal this one replaces, after a decline. */
  supersedesId?: string | null;
  /**
   * That proposal's contents, to open on.
   *
   * A revision is almost never a rewrite — it is the same work at a different
   * price, or the same price paid differently. Starting from blank means
   * retyping a paragraph and a payment schedule to change one number, which is
   * how an owner decides not to re-quote at all.
   */
  basedOn?: {
    title: string;
    description: string | null;
    total: number;
    payment_shape: {
      kind: 'single' | 'installments' | 'milestones';
      count?: number;
      frequency?: 'weekly' | 'biweekly' | 'monthly' | 'quarterly';
      stages?: Array<{ label: string; percent: number }>;
    };
  } | null;
  /** Their reason for declining, so the owner can revise against it. */
  declineReason?: string | null;
  declineNote?: string | null;
  onSent: () => void;
  t: (key: string) => string;
  isRTL?: boolean;
}

/** The stage sets an owner reaches for, before they start editing. */
const PRESETS: Record<string, Array<{ labelKey: string; percent: number }>> = {
  deposit_balance: [
    { labelKey: 'proposal.stage.deposit', percent: 50 },
    { labelKey: 'proposal.stage.on_completion', percent: 50 },
  ],
  thirds: [
    { labelKey: 'proposal.stage.on_signing', percent: 30 },
    { labelKey: 'proposal.stage.midway', percent: 40 },
    { labelKey: 'proposal.stage.on_completion', percent: 30 },
  ],
};

export function ProposalBuilderModal({
  isOpen,
  onClose,
  contactId,
  contactName,
  serviceId = null,
  bookingId = null,
  defaultTitle = '',
  currency = 'USD',
  supersedesId = null,
  basedOn = null,
  declineReason = null,
  declineNote = null,
  onSent,
  t,
  isRTL = false,
}: ProposalBuilderModalProps) {
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState('');
  const [total, setTotal] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [kind, setKind] = useState<ShapeKind>('single');
  const [stages, setStages] = useState<Stage[]>([]);
  const [installmentCount, setInstallmentCount] = useState(3);
  const [frequency, setFrequency] = useState<'weekly' | 'biweekly' | 'monthly' | 'quarterly'>(
    'monthly'
  );

  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * The proposal document.
   *
   * Optional by design — a ₪400 job needs a number and a sentence, not a PDF —
   * but for anything substantial the document IS the offer: scope, exclusions,
   * terms. The toggle exists so attaching one is a deliberate act rather than
   * an empty field every owner scrolls past.
   */
  const [attachDocument, setAttachDocument] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** Big enough for a real proposal, small enough to survive an inbox. */
  const MAX_FILE_MB = 10;

  /*
   * A local preview of the file about to be sent.
   *
   * `URL.createObjectURL` rather than an upload-then-fetch: the point is to
   * check you attached the RIGHT document before it reaches a client, and that
   * check is worthless if it only becomes possible after sending.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * CREATED AND REVOKED IN THE SAME EFFECT, deliberately.
   *
   * The obvious shape — `useMemo` to create, an effect to revoke — is broken in
   * development. StrictMode runs effects twice: mount, cleanup, mount. The
   * cleanup revoked the URL, and the memo did not re-run because `file` had not
   * changed, so the preview pointed at a URL the browser had already released
   * and the panel rendered blank.
   *
   * Pairing them means each run creates its own URL and revokes the one it
   * created, which is correct under StrictMode and in production alike.
   * ─────────────────────────────────────────────────────────────────────────
   */
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);

    // Object URLs are held by the document until revoked; a modal opened twenty
    // times would otherwise pin twenty files in memory.
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const isPdf = file?.type === 'application/pdf';
  const isImage = Boolean(file?.type?.startsWith('image/'));

  /*
   * What the form opens on.
   *
   * A REVISION opens on the quote it replaces. A new quote opens blank —
   * reopening for a different client must never inherit the last one's numbers,
   * which is what this effect originally existed to prevent.
   *
   * `validUntil` is deliberately NOT carried over: the old date is in the past
   * by the time anyone is revising, and silently reusing it would send a quote
   * that expired before it arrived.
   */
  useEffect(() => {
    if (!isOpen) return;

    if (basedOn) {
      setTitle(basedOn.title);
      setDescription(basedOn.description ?? '');
      setTotal(String(basedOn.total));
      setKind(basedOn.payment_shape?.kind ?? 'single');
      setStages(
        basedOn.payment_shape?.stages?.map(s => ({
          label: s.label,
          percent: String(s.percent),
        })) ?? []
      );
      setInstallmentCount(basedOn.payment_shape?.count ?? 3);
      setFrequency(basedOn.payment_shape?.frequency ?? 'monthly');
    } else {
      setTitle(defaultTitle);
      setDescription('');
      setTotal('');
      setKind('single');
      setStages([]);
      setInstallmentCount(3);
      setFrequency('monthly');
    }

    setValidUntil('');
    setAttachDocument(false);
    setFile(null);
    setError(null);
    setSending(false);
    /*
     * Keyed on `supersedesId`, NOT on `basedOn`.
     *
     * `basedOn` arrives from a `.find()` over the drawer's proposals, so its
     * identity changes every time that list is refetched — and the drawer
     * refetches on its own. Listing the object here would wipe whatever the
     * owner had typed the moment a background refresh landed. The id is a
     * string and only changes when a genuinely different quote is being
     * revised.
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, defaultTitle, contactId, supersedesId]);

  /*
   * The route accepts four currencies. A service carrying anything else — or a
   * lowercase code — would fail Zod and come back as "Invalid proposal", which
   * tells the owner nothing about a field this form does not even show them.
   * Normalised here, and the display below uses the same value the API will.
   */
  const ACCEPTED = ['USD', 'EUR', 'ILS', 'GBP'];
  const sendCurrency = ACCEPTED.includes((currency || '').toUpperCase())
    ? currency.toUpperCase()
    : 'USD';

  const totalNumber = Number(total.replace(/,/g, ''));
  const totalValid = total.trim() !== '' && Number.isFinite(totalNumber) && totalNumber > 0;

  /*
   * The percentages, and whether they are allowed to be sent.
   *
   * Compared against a cent of tolerance rather than exactly, because a third
   * of a job is 33.33 + 33.33 + 33.34 and floating point will not agree that
   * those make 100 on the nose. The tolerance is far tighter than any real
   * rounding an owner would type.
   */
  const percentSum = useMemo(
    () => stages.reduce((sum, s) => sum + (Number(s.percent) || 0), 0),
    [stages]
  );
  const splitComplete = kind !== 'milestones' || Math.abs(percentSum - 100) < 0.01;
  const stagesNamed = kind !== 'milestones' || stages.every(s => s.label.trim().length > 0);

  const money = (amount: number) =>
    new Intl.NumberFormat(isRTL ? 'he-IL' : 'en-US', {
      style: 'currency',
      currency: sendCurrency,
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);

  /** What each stage is worth, so the owner sees money and not just percentages. */
  const stageAmount = (percent: string) =>
    totalValid ? (totalNumber * (Number(percent) || 0)) / 100 : 0;

  const applyPreset = (key: keyof typeof PRESETS) => {
    setKind('milestones');
    setStages(PRESETS[key].map(s => ({ label: t(s.labelKey), percent: String(s.percent) })));
  };

  const updateStage = (index: number, patch: Partial<Stage>) =>
    setStages(prev => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  /*
   * A toggle turned on with no file chosen blocks sending.
   *
   * The alternative — quietly sending without the document — is worse than an
   * error: the owner believes the client received the offer in full, and the
   * client is asked to agree to a number with nothing behind it.
   */
  const documentReady = !attachDocument || Boolean(file);

  const canSend =
    totalValid && title.trim().length > 0 && splitComplete && stagesNamed && documentReady && !sending;

  const handleSend = async () => {
    if (!canSend) return;
    setSending(true);
    setError(null);

    const payment_shape =
      kind === 'milestones'
        ? {
            kind: 'milestones' as const,
            stages: stages.map(s => ({ label: s.label.trim(), percent: Number(s.percent) })),
          }
        : kind === 'installments'
          ? { kind: 'installments' as const, count: installmentCount, frequency }
          : { kind: 'single' as const };

    try {
      /*
       * The document goes up FIRST.
       *
       * Ordering matters: a quote created before a failed upload would exist,
       * be sendable, and claim a document it does not have. Uploading first
       * means the worst case is a stored file with no quote against it —
       * invisible clutter rather than a client receiving an offer with the
       * substance missing.
       */
      let documentId: string | null = null;

      if (attachDocument && file) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          // `result` is a data URL; the API wants the payload alone.
          reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });

        const uploadRes = await fetch(`/api/crm/contacts/${contactId}/documents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: file.name,
            document_type: 'proposal',
            file_name: file.name,
            file_size: file.size,
            mime_type: file.type || 'application/octet-stream',
            file_content: base64,
          }),
        });

        const uploaded = await uploadRes.json();
        if (!uploaded.success || !uploaded.document?.id) {
          setError(uploaded.error || t('proposal.error_upload'));
          setSending(false);
          return;
        }
        documentId = uploaded.document.id;
      }

      // Two calls on purpose: the proposal exists as a draft before anything is
      // emailed, so a transport failure leaves something the owner can retry
      // rather than a lost hour of typing.
      const createRes = await fetch('/api/business-os/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: contactId,
          service_id: serviceId,
          booking_id: bookingId,
          title: title.trim(),
          description: description.trim() || null,
          currency: sendCurrency,
          total: totalNumber,
          valid_until: validUntil || null,
          payment_shape,
          supersedes_id: supersedesId,
          document_id: documentId,
        }),
      });
      const created = await createRes.json();
      // `proposal`, not `data` — the route names it after the thing. Reading
      // the wrong key threw a TypeError inside the try, which the catch below
      // then reported as a transport failure: the quote HAD been saved, and
      // the owner was told it had not.
      if (!created.success || !created.proposal?.id) {
        setError(created.error || t('proposal.error_create'));
        setSending(false);
        return;
      }

      const sendRes = await fetch(`/api/business-os/proposals/${created.proposal.id}/send`, {
        method: 'POST',
      });
      const sent = await sendRes.json();
      if (!sent.success) {
        // The draft survived; say so, so the owner does not retype it.
        setError(sent.error || t('proposal.error_send_draft_kept'));
        setSending(false);
        return;
      }

      onSent();
      onClose();
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? { message: err.message, stack: err.stack } : err, contactId },
        'Could not send the proposal'
      );
      setError(t('proposal.error_send'));
      setSending(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      {/*
        Wide enough to hold the offer and the document that justifies it.
        ─────────────────────────────────────────────────────────────────────
        The preview sits AFTER the form in the DOM, so `dir` places it on the
        far side: left in RTL, right in LTR. It is not a decorative panel — an
        owner sending a five-figure quote wants to see that the file attached is
        the one they meant, and doing that after sending is not checking.

        It collapses on narrow screens rather than shrinking both halves into
        uselessness.
      */}
      <DialogContent
        className="max-h-[90vh] overflow-hidden flex flex-col p-0 transition-[max-width] duration-200"
        /*
         * Width as a STYLE, not a class.
         *
         * `DialogContent` hard-codes `max-w-lg` in its own class list, and this
         * project's `cn` is a plain join with no tailwind-merge — so passing
         * `max-w-5xl` leaves both classes on the element and lets CSS source
         * order decide which wins. That is a coin-flip that depends on how
         * Tailwind happens to emit its scale. An inline style beats every class
         * outright, which is the one thing that is not in question here.
         */
        style={{ maxWidth: file ? '64rem' : '32rem' }}
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        <DialogHeader className="px-5 pt-5 pb-3 rtl:text-right">
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold text-[var(--v2-text-primary)]">
            <FileText className="w-5 h-5" />
            {supersedesId ? t('proposal.revise_title') : t('proposal.new_title')}
          </DialogTitle>
          <p className="text-sm text-[var(--v2-text-secondary)]">
            {t('proposal.for')} {contactName}
          </p>
        </DialogHeader>

        <div className="flex min-h-0 flex-1">
        <div className={`overflow-y-auto px-5 pb-4 space-y-4 ${file ? 'w-full md:w-[420px] md:shrink-0' : 'flex-1'}`}>
          {/* Why they said no, when this is a revision. The owner is quoting
              against a stated objection, and it belongs on screen while they
              set the new number — not one drawer away. */}
          {supersedesId && declineReason && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm">
              <p className="font-medium text-amber-900">
                {t(`proposal.decline.reason.${declineReason}`)}
              </p>
              {declineNote && <p className="mt-0.5 text-amber-800">{declineNote}</p>}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-1.5">
              {t('proposal.field.title')}
            </label>
            <Input value={title} onChange={e => setTitle(e.target.value)} maxLength={200} />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-1.5">
              {t('proposal.field.description')}
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={4}
              maxLength={5000}
              placeholder={t('proposal.field.description_placeholder')}
              className="w-full rounded-lg border border-[var(--v2-border)] bg-[var(--v2-surface)] px-3 py-2 text-sm text-[var(--v2-text-primary)] outline-none focus:border-[var(--v2-primary)]"
            />
            <p className="mt-1 text-xs text-[var(--v2-text-secondary)]">
              {t('proposal.field.description_hint')}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-1.5">
                {t('proposal.field.total')}
              </label>
              <Input
                value={total}
                onChange={e => setTotal(e.target.value)}
                inputMode="decimal"
                placeholder="0"
                className="tabular-nums"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-1.5">
                {t('proposal.field.valid_until')}
              </label>
              <Input
                type="date"
                value={validUntil}
                onChange={e => setValidUntil(e.target.value)}
              />
            </div>
          </div>

          {/* How the money arrives. */}
          <div>
            <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-1.5">
              {t('proposal.field.payment')}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['single', 'milestones', 'installments'] as ShapeKind[]).map(option => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setKind(option);
                    if (option === 'milestones' && stages.length === 0) applyPreset('deposit_balance');
                  }}
                  className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                    kind === option
                      ? 'border-[var(--v2-primary)] bg-[var(--v2-primary)]/10 text-[var(--v2-primary)] font-medium'
                      : 'border-[var(--v2-border)] text-[var(--v2-text-secondary)]'
                  }`}
                >
                  {t(`proposal.shape.${option}`)}
                </button>
              ))}
            </div>
          </div>

          {kind === 'installments' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-1.5">
                  {t('proposal.field.count')}
                </label>
                <Input
                  type="number"
                  min={2}
                  max={24}
                  value={installmentCount}
                  onChange={e => setInstallmentCount(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-1.5">
                  {t('proposal.field.frequency')}
                </label>
                <select
                  value={frequency}
                  onChange={e => setFrequency(e.target.value as typeof frequency)}
                  className="w-full rounded-lg border border-[var(--v2-border)] bg-[var(--v2-surface)] px-3 py-2 text-sm text-[var(--v2-text-primary)]"
                >
                  {(['weekly', 'biweekly', 'monthly', 'quarterly'] as const).map(f => (
                    <option key={f} value={f}>
                      {t(`proposal.frequency.${f}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {kind === 'milestones' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-[var(--v2-text-primary)]">
                  {t('proposal.field.stages')}
                </label>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => applyPreset('deposit_balance')}
                    className="text-xs text-[var(--v2-text-secondary)] hover:text-[var(--v2-primary)]"
                  >
                    50/50
                  </button>
                  <span className="text-xs text-[var(--v2-border)]">·</span>
                  <button
                    type="button"
                    onClick={() => applyPreset('thirds')}
                    className="text-xs text-[var(--v2-text-secondary)] hover:text-[var(--v2-primary)]"
                  >
                    30/40/30
                  </button>
                </div>
              </div>

              {stages.map((stage, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={stage.label}
                    onChange={e => updateStage(index, { label: e.target.value })}
                    placeholder={t('proposal.field.stage_label')}
                    maxLength={120}
                    className="flex-1"
                  />
                  <div className="relative w-20 shrink-0">
                    <Input
                      value={stage.percent}
                      onChange={e => updateStage(index, { percent: e.target.value })}
                      inputMode="decimal"
                      className="tabular-nums pe-6"
                    />
                    <span className="pointer-events-none absolute inset-y-0 end-2 flex items-center text-xs text-[var(--v2-text-secondary)]">
                      %
                    </span>
                  </div>
                  {/* The money each stage is worth. A percentage is what the
                      owner types; an amount is what they are agreeing to. */}
                  <span className="w-24 shrink-0 text-end text-sm tabular-nums text-[var(--v2-text-secondary)]">
                    {totalValid ? money(stageAmount(stage.percent)) : '—'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setStages(prev => prev.filter((_, i) => i !== index))}
                    className="shrink-0 p-1.5 text-[var(--v2-text-secondary)] hover:text-red-500"
                    aria-label={t('proposal.remove_stage')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}

              <button
                type="button"
                onClick={() => setStages(prev => [...prev, { label: '', percent: '' }])}
                className="flex items-center gap-1.5 text-sm text-[var(--v2-primary)]"
              >
                <Plus className="w-4 h-4" />
                {t('proposal.add_stage')}
              </button>

              {/* The rule, stated while it is being broken rather than at the
                  moment of sending. The shortfall is named in percent AND in
                  money — "10% missing" is abstract; "₪6,000 unaccounted for" is
                  the number the owner recognises. */}
              {!splitComplete && stages.length > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    {t('proposal.split_incomplete')} {percentSum.toFixed(2).replace(/\.?0+$/, '')}%
                    {totalValid && (
                      <> · {money(Math.abs(totalNumber - (totalNumber * percentSum) / 100))}</>
                    )}
                  </span>
                </div>
              )}
            </div>
          )}

          {/*
            The proposal document.
            ─────────────────────────────────────────────────────────────────
            Last in the form, because it is the last thing an owner does: they
            write the price, then attach the paperwork that justifies it.
          */}
          <div className="rounded-lg border border-[var(--v2-border)] px-3 py-2.5">
            <div className="flex items-start justify-between gap-3">
              <label htmlFor="attach-proposal-document" className="min-w-0 cursor-pointer">
                <span className="block text-sm font-medium text-[var(--v2-text-primary)]">
                  {t('proposal.attach_document')}
                </span>
                <span className="mt-0.5 block text-xs text-[var(--v2-text-secondary)]">
                  {t('proposal.attach_document_hint')}
                </span>
              </label>

              {/*
                Pinned to LTR, as in DailyBriefingCard.
                The shared Switch moves its thumb with a fixed rightward
                `translate-x-[20px]`. Inside this RTL dialog the track itself
                lays out right-to-left, so the thumb would start at the right
                edge and that shift would carry it clean out of the track. The
                row around it still mirrors, so the control stays on the correct
                side of its label.
              */}
              <div dir="ltr" className="mt-0.5 shrink-0">
                <Switch
                  id="attach-proposal-document"
                  checked={attachDocument}
                  onCheckedChange={checked => {
                    setAttachDocument(checked);
                    // Turning it off drops the file too — leaving it staged
                    // would send a document the owner had just decided against.
                    if (!checked) {
                      setFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }
                  }}
                />
              </div>
            </div>

            {attachDocument && (
              <div className="mt-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,image/*"
                  className="hidden"
                  onChange={e => {
                    const chosen = e.target.files?.[0];
                    if (!chosen) return;
                    // Checked here rather than on send: an owner who picks a
                    // 40MB file should be told immediately, not after they have
                    // finished writing the quote.
                    if (chosen.size > MAX_FILE_MB * 1024 * 1024) {
                      setError(t('proposal.error_file_too_big').replace('{max}', String(MAX_FILE_MB)));
                      e.target.value = '';
                      return;
                    }
                    setError(null);
                    setFile(chosen);
                  }}
                />

                {file ? (
                  <div className="flex items-center gap-2 rounded-lg bg-[var(--v2-surface)] px-3 py-2">
                    <Paperclip className="h-4 w-4 shrink-0 text-[var(--v2-text-secondary)]" />
                    <span className="flex-1 truncate text-sm text-[var(--v2-text-primary)]">
                      {file.name}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-[var(--v2-text-secondary)]">
                      {(file.size / 1024 / 1024).toFixed(1)} MB
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setFile(null);
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }}
                      className="shrink-0 p-1 text-[var(--v2-text-secondary)] hover:text-red-500"
                      aria-label={t('proposal.remove_file')}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--v2-border)] px-3 py-3 text-sm text-[var(--v2-text-secondary)] transition-colors hover:border-[var(--v2-primary)] hover:text-[var(--v2-primary)]"
                  >
                    <Paperclip className="h-4 w-4" />
                    {t('proposal.choose_file')}
                  </button>
                )}
              </div>
            )}
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        {/* The document, beside the offer. Hidden below md: two columns in a
            phone-width dialog leaves neither of them usable. */}
        {file && previewUrl && (
          <div
            className="hidden min-w-0 flex-1 flex-col border-s md:flex"
            style={{ borderColor: 'var(--v2-border)', background: 'var(--v2-surface)' }}
          >
            <div
              className="flex items-center gap-2 border-b px-4 py-2.5"
              style={{ borderColor: 'var(--v2-border)' }}
            >
              <Paperclip className="h-4 w-4 shrink-0 text-[var(--v2-text-secondary)]" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--v2-text-primary)]">
                {file.name}
              </span>
              <a
                href={previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-xs text-[var(--v2-primary)] hover:underline"
              >
                {t('proposal.open_in_tab')}
              </a>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-3">
              {isPdf ? (
                /* An iframe, not <embed>: the object URL is same-origin and
                   every browser this runs in renders a PDF inline from one. */
                <iframe
                  src={previewUrl}
                  title={file.name}
                  className="h-full w-full rounded-lg border"
                  style={{ borderColor: 'var(--v2-border)', minHeight: '420px' }}
                />
              ) : isImage ? (
                <img
                  src={previewUrl}
                  alt={file.name}
                  className="mx-auto max-h-full rounded-lg object-contain"
                />
              ) : (
                /* Word documents and the rest. No browser renders these inline,
                   and a blank frame reads as a broken upload rather than an
                   unpreviewable format — so it says which it is. */
                <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                  <FileText className="h-10 w-10 text-[var(--v2-text-muted)]" />
                  <p className="text-sm text-[var(--v2-text-secondary)]">
                    {t('proposal.preview_unavailable')}
                  </p>
                  <a
                    href={previewUrl}
                    download={file.name}
                    className="text-sm font-medium text-[var(--v2-primary)] hover:underline"
                  >
                    {t('proposal.download_to_check')}
                  </a>
                </div>
              )}
            </div>
          </div>
        )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--v2-border)] px-5 py-3">
          <Button variant="ghost" onClick={onClose} disabled={sending}>
            {t('proposal.cancel')}
          </Button>
          <Button onClick={handleSend} disabled={!canSend}>
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Send className="w-4 h-4 me-1.5" />
                {t('proposal.send')}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
