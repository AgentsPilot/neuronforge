'use client';

/**
 * The page a client opens from a quote email.
 *
 * No account, no password — the signed token in the URL is the authorisation.
 * Everything here speaks the BUSINESS's language, not the browser's: the quote
 * was written in it, and a client who received a Hebrew email should not land
 * on an English page.
 *
 * Declining is a first-class answer, not a dead end. Most rejections are "too
 * expensive", which the owner can act on — so the reason is asked for, and the
 * page says a revision may follow rather than closing the conversation.
 */

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AlertTriangle, Check, Download, FileText, X } from 'lucide-react';

import { BrandButton } from '@/components/public/BrandButton';
import { PublicPageSpinner } from '@/components/public/PublicSpinner';
import { PublicShell } from '@/components/public/PublicShell';
import { StatusCard } from '@/components/public/StatusCard';
import { useOptionalPublicBrand } from '@/components/public/PublicBrandProvider';
import { createPublicT } from '@/lib/i18n/public-pages';

type Code = 'not_found' | 'accepted' | 'declined' | 'expired' | 'withdrawn' | 'superseded';

const DECLINE_REASONS = ['too_expensive', 'timing', 'scope', 'chose_other'] as const;
type DeclineReason = (typeof DECLINE_REASONS)[number] | 'other';

interface ProposalView {
  /** Which version this is — sent back with an accept so it cannot drift. */
  id: string;
  title: string;
  description: string | null;
  total: number;
  currency: string;
  validUntil: string | null;
  stages: Array<{ label: string; amount: number }>;
  dueOnAccept: number;
  clientFirstName: string | null;
  /** The full proposal, when the business attached one. */
  document: {
    name: string;
    size: number | null;
    mimeType: string | null;
    url: string;
  } | null;
}

export default function ProposalPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [proposal, setProposal] = useState<ProposalView | null>(null);
  const [code, setCode] = useState<Code | null>(null);
  const [answering, setAnswering] = useState(false);
  const [showDecline, setShowDecline] = useState(false);
  /** Where an already-accepted quote is paid, and whether it still needs paying. */
  const [invoice, setInvoice] = useState<{ url: string; paid: boolean } | null>(null);
  const [reason, setReason] = useState<DeclineReason>('too_expensive');
  const [note, setNote] = useState('');
  /*
   * Whether they have opened the document.
   *
   * Deliberately not persisted. This is not an audit trail — it is a guard
   * against agreeing to a number without reading what it buys, and it should
   * cost a returning client one click, not follow them around.
   */
  const [documentOpened, setDocumentOpened] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/proposal/${token}`, { cache: 'no-store' });
        const data = await res.json();
        setProposal(data.proposal ?? null);
        setCode(data.code ?? null);
        setInvoice(data.invoiceUrl ? { url: data.invoiceUrl, paid: Boolean(data.invoicePaid) } : null);
      } catch {
        setCode('not_found');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  /*
   * The brand comes from the LAYOUT, resolved on the server before this page
   * renders — not threaded back through the API response, which is how it used
   * to arrive. That reconstruction needed a fake `userId` and a duplicate of
   * half the `PublicBrand` shape, and it could only be right AFTER the fetch.
   *
   * Null only when the token names no real proposal, which is the one case with
   * no business to brand as.
   */
  const brand = useOptionalPublicBrand();

  const locale = brand?.locale || 'en';
  const t = createPublicT(locale);
  const intlLocale = brand?.localeCode || 'en-US';
  const money = (amount: number) =>
    new Intl.NumberFormat(intlLocale, {
      style: 'currency',
      currency: proposal?.currency || brand?.currency || 'USD',
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);

  const answer = async (payload: Record<string, unknown>) => {
    setAnswering(true);
    try {
      const res = await fetch(`/api/proposal/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      /*
       * Accepting with money due goes straight to the invoice.
       *
       * The page used to stop at "thank you" — the client had just agreed to
       * pay a deposit and was given nowhere to pay it, which is the moment a
       * signed job goes quiet. `replace`, not `push`: the quote has been
       * answered, and Back should not return to a page offering to answer it
       * again.
       *
       * The invoice is emailed too, so closing the tab here loses nothing.
       */
      if (data.code === 'accepted' && data.data?.invoiceUrl) {
        router.replace(data.data.invoiceUrl);
        return;
      }

      // Whatever came back is the truth, including "somebody already answered".
      setCode(data.code ?? 'not_found');
      setShowDecline(false);
    } catch {
      setAnswering(false);
    }
  };

  if (loading) return <PublicPageSpinner />;

  /*
   * The terminal states.
   *
   * Six of them, and each says something different: "already accepted" is good
   * news and "expired" is not. One generic "this link is no longer valid" would
   * leave a client who accepted yesterday wondering whether it worked.
   */
  if (code) {
    const states: Record<Code, { tone: 'success' | 'warning' | 'error' | 'info'; icon: typeof Check }> = {
      accepted: { tone: 'success', icon: Check },
      declined: { tone: 'info', icon: X },
      expired: { tone: 'warning', icon: AlertTriangle },
      withdrawn: { tone: 'info', icon: X },
      superseded: { tone: 'info', icon: FileText },
      not_found: { tone: 'error', icon: AlertTriangle },
    };
    const state = states[code];

    const card = (
      <>
        <StatusCard
          tone={state.tone}
          icon={state.icon}
          title={t(`proposal.state.${code}.title`)}
          description={t(`proposal.state.${code}.body`)}
          standalone={!brand}
          inShell={Boolean(brand)}
        />

        {/* The way on. An accepted quote whose deposit is unpaid is the one
            terminal state that is not actually terminal — the client owes
            money and this is the only link they were sent. */}
        {code === 'accepted' && invoice && (
          <div className="mt-4">
            <BrandButton fullWidth onClick={() => router.push(invoice.url)}>
              {invoice.paid ? t('proposal.view_invoice') : t('proposal.pay_now')}
            </BrandButton>
          </div>
        )}
      </>
    );

    return brand ? (
      <PublicShell brand={brand} width="narrow" header={{ compact: true }}>
        {card}
      </PublicShell>
    ) : (
      card
    );
  }

  if (!proposal || !brand) return <PublicPageSpinner />;

  return (
    <PublicShell brand={brand} width="narrow" header={{ subtitle: t('proposal.header') }}>
      <div className="space-y-5">
        {/* The greeting, not a second title — the header above already names
            the business, and the subtitle already says this is a quote. */}
        <div>
          <p className="text-base font-medium" style={{ color: 'var(--ap-text)' }}>
            {proposal.clientFirstName
              ? t('proposal.greeting_named', { name: proposal.clientFirstName })
              : t('proposal.greeting')}
          </p>
          <p className="mt-1 text-sm" style={{ color: 'var(--ap-text-muted)' }}>
            {t('proposal.intro')}
          </p>
        </div>

        <div
          className="p-5"
          style={{
            background: 'var(--ap-surface)',
            border: '1px solid var(--ap-border)',
            borderRadius: 'var(--ap-radius-lg)',
            boxShadow: 'var(--ap-shadow-sm)',
          }}
        >
          <p
            className="text-base font-semibold"
            style={{ color: 'var(--ap-text)', fontFamily: 'var(--ap-font-heading)' }}
          >
            {proposal.title}
          </p>

          {proposal.description && (
            <p
              className="mt-2 whitespace-pre-line text-sm leading-relaxed"
              style={{ color: 'var(--ap-text)' }}
            >
              {proposal.description}
            </p>
          )}

          {/* The total, given the weight of the thing being decided. Tinted
              with the brand rather than ruled off, so the number reads as the
              subject of the page and not one more row in a table. */}
          <div
            className="mt-4 flex items-baseline justify-between px-3 py-2.5"
            style={{ background: 'var(--ap-brand-tint)', borderRadius: 'var(--ap-radius-md)' }}
          >
            <span className="text-sm" style={{ color: 'var(--ap-text-muted)' }}>
              {t('proposal.total')}
            </span>
            <span
              className="text-xl font-semibold tabular-nums"
              style={{ color: 'var(--ap-text)' }}
            >
              {money(proposal.total)}
            </span>
          </div>

          {/* The schedule, spelled out. "Paid in 3" is not something a client
              can agree to; how much, and against what, is. */}
          {proposal.stages.length > 1 && (
            <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--ap-border)' }}>
              <p
                className="mb-2 text-xs font-semibold uppercase tracking-wide"
                style={{ color: 'var(--ap-text-muted)' }}
              >
                {t('proposal.stages')}
              </p>
              <ul className="space-y-1.5">
                {proposal.stages.map((stage, i) => (
                  <li key={i} className="flex items-baseline justify-between text-sm">
                    <span style={{ color: 'var(--ap-text)' }}>{stage.label}</span>
                    <span className="font-medium tabular-nums" style={{ color: 'var(--ap-text)' }}>
                      {money(stage.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {proposal.validUntil && (
            <p className="mt-4 text-xs" style={{ color: 'var(--ap-text-muted)' }}>
              {t('proposal.valid_until', {
                date: new Date(`${proposal.validUntil}T12:00:00Z`).toLocaleDateString(
                  intlLocale,
                  { day: 'numeric', month: 'long', year: 'numeric' }
                ),
              })}
            </p>
          )}
        </div>

        {/*
          The offer in full.
          ─────────────────────────────────────────────────────────────────────
          Accepting is blocked until this is opened. Not friction for its own
          sake: the card above carries a number and a paragraph, while the
          document carries the scope and the exclusions — the parts a dispute is
          actually about. A client who agreed without opening it agreed to the
          number alone, and that is the disagreement neither side wants later.
        */}
        {proposal.document && (
          <a
            href={proposal.document.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setDocumentOpened(true)}
            className="flex items-center gap-3 p-4 transition-colors"
            style={{
              background: 'var(--ap-surface)',
              border: `1px solid ${documentOpened ? 'var(--ap-border)' : 'var(--ap-brand)'}`,
              borderRadius: 'var(--ap-radius-lg)',
              boxShadow: 'var(--ap-shadow-sm)',
            }}
          >
            <FileText className="h-5 w-5 shrink-0" style={{ color: 'var(--ap-brand)' }} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium" style={{ color: 'var(--ap-text)' }}>
                {proposal.document.name}
              </span>
              <span className="block text-xs" style={{ color: 'var(--ap-text-muted)' }}>
                {documentOpened ? t('proposal.document.opened') : t('proposal.document.open_prompt')}
              </span>
            </span>
            <Download className="h-4 w-4 shrink-0" style={{ color: 'var(--ap-text-muted)' }} />
          </a>
        )}

        {showDecline ? (
          <div
            className="p-5"
            style={{
              background: 'var(--ap-surface)',
              border: '1px solid var(--ap-border)',
              borderRadius: 'var(--ap-radius-lg)',
              boxShadow: 'var(--ap-shadow-sm)',
            }}
          >
            <p className="text-sm font-medium" style={{ color: 'var(--ap-text)' }}>
              {t('proposal.decline.title')}
            </p>
            <p className="mt-1 text-xs" style={{ color: 'var(--ap-text-muted)' }}>
              {t('proposal.decline.why')}
            </p>

            <div className="mt-3 space-y-2">
              {[...DECLINE_REASONS, 'other' as const].map(value => (
                <label
                  key={value}
                  className="flex cursor-pointer items-center gap-2.5 px-3 py-2.5 text-sm"
                  style={{
                    color: 'var(--ap-text)',
                    borderRadius: 'var(--ap-radius-md)',
                    // The chosen one is tinted as well as outlined: a 1px
                    // border change is easy to miss on a phone, and this is
                    // the answer being sent on the client's behalf.
                    border: `1px solid ${reason === value ? 'var(--ap-brand)' : 'var(--ap-border)'}`,
                    background: reason === value ? 'var(--ap-brand-tint)' : 'transparent',
                  }}
                >
                  <input
                    type="radio"
                    name="reason"
                    checked={reason === value}
                    onChange={() => setReason(value)}
                    className="h-3.5 w-3.5"
                    style={{ accentColor: 'var(--ap-brand)' }}
                  />
                  {t(`proposal.decline.reason.${value}`)}
                </label>
              ))}
            </div>

            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder={t('proposal.decline.note_placeholder')}
              rows={2}
              className="mt-3 w-full px-3 py-2 text-sm outline-none"
              style={{
                background: 'var(--ap-surface)',
                color: 'var(--ap-text)',
                border: '1px solid var(--ap-border)',
                borderRadius: 'var(--ap-radius-md)',
              }}
            />

            <div className="mt-4 flex gap-2">
              <BrandButton
                variant="secondary"
                fullWidth
                onClick={() => setShowDecline(false)}
                disabled={answering}
              >
                {t('proposal.back')}
              </BrandButton>
              <BrandButton
                fullWidth
                loading={answering}
                onClick={() => answer({ answer: 'decline', reason, note: note.trim() || undefined })}
              >
                {t('proposal.decline.send')}
              </BrandButton>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <BrandButton
              fullWidth
              loading={answering}
              disabled={Boolean(proposal.document) && !documentOpened}
              onClick={() => answer({ answer: 'accept', proposal_id: proposal.id })}
            >
              {proposal.dueOnAccept > 0 && proposal.dueOnAccept !== proposal.total
                ? t('proposal.accept_with_due', { amount: money(proposal.dueOnAccept) })
                : t('proposal.accept')}
            </BrandButton>
            {/* Declining is NOT gated. Someone who has decided against the job
                should not have to open a document to say so. */}
            <BrandButton
              variant="ghost"
              fullWidth
              disabled={answering}
              onClick={() => setShowDecline(true)}
            >
              {t('proposal.decline')}
            </BrandButton>

            {proposal.document && !documentOpened && (
              <p className="pt-1 text-center text-xs" style={{ color: 'var(--ap-text-muted)' }}>
                {t('proposal.document.required')}
              </p>
            )}
          </div>
        )}
      </div>
    </PublicShell>
  );
}
