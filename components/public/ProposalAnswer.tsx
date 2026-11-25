'use client';

/**
 * A quote, and the client's answer to it.
 *
 * No account, no password — the signed token is the authorisation. Everything
 * here speaks the BUSINESS's language, not the browser's: the quote was written
 * in it, and a client who received a Hebrew email should not land on an English
 * page.
 *
 * Declining is a first-class answer, not a dead end. Most rejections are "too
 * expensive", which the owner can act on — so the reason is asked for, and the
 * page says a revision may follow rather than closing the conversation.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE IMPLEMENTATION, TWO PLACES IT IS SHOWN
 *
 * `/proposal/[token]` is the page the quote EMAIL links to — a client who never
 * opens the portal still needs somewhere to answer. `/book/manage/[token]/quote`
 * is the same thing inside the portal, where it keeps the branded frame and the
 * rail of the client's own meetings instead of reading as a page from somewhere
 * else.
 *
 * Both mount this. The alternative was a second copy of the accept path, the
 * decline reasons, the document gate and the six terminal states — and a copy
 * of a flow that takes money is a copy that eventually disagrees with itself.
 *
 * `embedded` says only whether to draw the shell. The portal's layout already
 * mounts one for the whole section, and a second inside it would frame the page
 * twice.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, Download, FileText, X } from 'lucide-react';

import { BrandButton } from '@/components/public/BrandButton';
import { PublicPageSpinner } from '@/components/public/PublicSpinner';
import { PortalShell } from '@/components/public/PortalShell';
import { StatusCard } from '@/components/public/StatusCard';
import { SignaturePad } from '@/components/public/SignaturePad';
import { useOptionalPublicBrand } from '@/components/public/PublicBrandProvider';
import { createPublicT, formatPublicDate } from '@/lib/i18n/public-pages';
/*
 * The decline codes come from the shared namespace, not a local literal.
 *
 * These four are STORED and deliberately not renamed even though three duplicate
 * codes used elsewhere under different spellings — `cancellationReasons` carries
 * the equivalence map so a report can union them. Importing the list is what
 * stops a fifth spelling appearing here. `'other'` is already its last member.
 */
import { DECLINE_REASONS, type DeclineReason } from '@/lib/business-os/cancellationReasons';
/*
 * `renderText`, not `renderHtml`.
 *
 * Both are safe by construction — the whole point of that module — but this
 * page has no need to emit markup for an item's description, and plain text
 * means there is no `dangerouslySetInnerHTML` anywhere on a page a stranger
 * can open with a signed link.
 */
import { renderText, type ReplyBlock } from '@/lib/business-os/mail/replyBody';

type Code =
  | 'not_found'
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'withdrawn'
  | 'superseded'
  /**
   * The REQUEST failed — offline, a dropped connection, a server restart
   * mid-flight. Not a statement about the quote, which is why it is its own
   * code rather than `not_found`.
   */
  | 'unreachable';


interface QuoteDetail {
  /** Which version this is — sent back with an accept so it cannot drift. */
  id: string;
  title: string;
  description: string | null;
  total: number;
  currency: string;
  validUntil: string | null;
  /** Days to pay once an invoice is raised. A term of the offer, not a setting. */
  termsDays: number | null;
  stages: Array<{
    label: string;
    amount: number;
    /**
     * When this period falls due, once there IS a schedule.
     *
     * Null until the quote is accepted, because the first date is the
     * acceptance plus the payment terms and nothing can know it before then.
     * A milestone has none ever: it falls due when the work is done.
     */
    dueDate?: string | null;
  }>;
  dueOnAccept: number;
  clientFirstName: string | null;
  /**
   * The FIRST file the business attached, and the one acceptance is gated on.
   *
   * Kept as its own field rather than folded into `documents` below, because
   * the gate, its copy and its guard tests all read this and none of them
   * should have to learn that a quote can now carry several.
   */
  document: {
    name: string;
    size: number | null;
    mimeType: string | null;
    url: string;
  } | null;
  /**
   * Every file, including the one above. Empty on a quote with none.
   *
   * The gate deliberately stays on the FIRST. "Open this before you agree" is
   * about the thing the owner wants read; requiring every photograph of a site
   * to be opened would block acceptance on paperwork nobody needs to read, and
   * that is a worse failure than an unopened attachment.
   */
  documents: Array<{
    name: string;
    size: number | null;
    mimeType: string | null;
    url: string;
  }>;
  /**
   * THE BREAKDOWN the owner built — what the total is made of.
   *
   * Not `document`, which is the FILE above: that is something the owner
   * attached, this is something they wrote here. Null on every quote priced as
   * a single figure, and the section is then omitted rather than drawn empty.
   *
   * The amounts arrive already rounded and already summing to `total`. This
   * page formats them; it never re-adds them, because a client reading a
   * different sum from the one they are approving is the whole failure this
   * guards against.
   */
  breakdown: {
    items: Array<{
      id: string;
      date: string | null;
      label: string;
      qty: number;
      unitPrice: number;
      body: ReplyBlock[];
    }>;
    tax: { rate: number; label: string; inclusive: boolean };
    letterhead: {
      name: string | null;
      /* Already formatted by the route — one line per address line, country
         translated. Never the raw jsonb, which printed `[object Object]`. */
      addressLines: string[];
      taxId: string | null;
      phone: string | null;
      email: string | null;
      logoUrl: string | null;
    };
  } | null;
  /**
   * Whether Approve is gated on a typed name and an explicit agreement.
   *
   * False on every quote written before 2026-11-10, and on every one from an
   * owner who does not ask for it — so the page is exactly what it is today.
   * Independent of the breakdown: a package of meetings can require one.
   */
  requiresSignature: boolean;
  /**
   * A PACKAGE: the meetings being sold, as instants.
   *
   * The client is agreeing to specific hours of their own life, so they are on
   * the page the accept button is on. Null for an ordinary quote.
   */
  sessions: {
    dates: string[];
    durationMinutes: number;
    /** Each meeting is invoiced after it happens; nothing is due on approval. */
    billPerSession: boolean;
    /** The BUSINESS's zone, which is the clock the client turns up by. */
    timezone: string;
  } | null;
}

export interface ProposalAnswerProps {
  /** The signed proposal token. Supplied by the route, or by the portal. */
  token: string;
  /**
   * Skip the shell, because something above already drew one.
   *
   * The portal's layout mounts the branded frame once for its whole section, so
   * an embedded copy renders its content bare and inherits that frame.
   */
  embedded?: boolean;
}

export function ProposalAnswer({ token, embedded = false }: ProposalAnswerProps) {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [proposal, setProposal] = useState<QuoteDetail | null>(null);
  const [code, setCode] = useState<Code | null>(null);
  const [answering, setAnswering] = useState(false);
  const [showDecline, setShowDecline] = useState(false);
  /*
   * The signing step, opened by Approve.
   *
   * The signature used to sit inline above both buttons, which asked the
   * client to sign BEFORE they had decided anything — so typing a name,
   * drawing a mark, ticking the box and then pressing Decline was a reachable
   * and faintly absurd path. A contract asks you to decide, then sign.
   */
  const [showSign, setShowSign] = useState(false);
  /** What the client typed, and whether they ticked. Both are required before
      Approve enables — see the gate below. */
  const [signedName, setSignedName] = useState('');
  const [agreed, setAgreed] = useState(false);
  /* The drawn mark, as a PNG data URI. Null until something is drawn — see
     `SignaturePad`, which refuses a stray tap as a signature. */
  const [signatureImage, setSignatureImage] = useState<string | null>(null);

  /** Where an already-accepted quote is paid, and whether it still needs paying. */
  const [invoice, setInvoice] = useState<{ url: string; paid: boolean } | null>(null);
  /*
   * NOTHING PRESELECTED, and the send button is gated on it.
   *
   * This defaulted to 'too_expensive'. The send button was never gated, so every
   * client who declined without touching the radios recorded "too expensive" —
   * which means the stored decline reasons over-report price by however many
   * clients never looked at the list. A default on a mandatory picker does not
   * save the reader a click, it decides the answer for them.
   */
  const [reason, setReason] = useState<DeclineReason | ''>('');
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
        /*
         * ─────────────────────────────────────────────────────────────────
         * A FAILED REQUEST IS NOT A MISSING QUOTE.
         *
         * This set `not_found`, so any dropped connection told the client
         * "we could not find this quote — open the link from your email or
         * contact the business". They do contact the business, about a quote
         * that is sitting there perfectly intact, and the business has no way
         * to tell them anything useful.
         *
         * It is the same mistake as the invisible payment spinner earlier in
         * this portal: reporting a transport failure as an absence. The quote
         * is the worst place for it, because the client's next move is to
         * stop trusting the number.
         * ─────────────────────────────────────────────────────────────────
         */
        setCode('unreachable');
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
  /*
   * The letterhead's one-line contact run, built once.
   *
   * Phone, email and tax id, in that order, each rendered inside its own
   * `<bdi>` below. Kept as a list rather than a joined string so the isolates
   * can go around the items and not around the separators.
   */
  const contactBits = [
    proposal?.breakdown?.letterhead.phone,
    proposal?.breakdown?.letterhead.email,
    proposal?.breakdown?.letterhead.taxId,
  ].filter((bit): bit is string => Boolean(bit));

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
      setCode(data.code ?? 'unreachable');
      setShowDecline(false);
      setShowSign(false);
    } catch {
      /* The answer did not reach us. Say so and let them try again, rather
         than leaving a button that appears to have done nothing. */
      setAnswering(false);
      setCode('unreachable');
    }
  };

  if (loading) return <PublicPageSpinner />;

  /*
   * The terminal states.
   *
   * Each says something different: "already accepted" is good news and
   * "expired" is not. One generic "this link is no longer valid" would leave a
   * client who accepted yesterday wondering whether it worked.
   *
   * `unreachable` is the odd one out and deliberately so — it is the only one
   * that is NOT terminal. It means the request failed, the quote is untouched,
   * and refreshing will very likely work. It is `warning`, not `error`,
   * because nothing has gone wrong with the offer.
   */
  if (code) {
    const states: Record<Code, { tone: 'success' | 'warning' | 'error' | 'info'; icon: typeof Check }> = {
      unreachable: { tone: 'warning', icon: AlertTriangle },
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

    /*
     * Three ways out, and they are not interchangeable.
     *
     * Embedded, the portal's frame is already around this, so the card goes in
     * bare. Standalone with a brand, it gets the shared portal shell. Standalone with
     * none — the token names no real proposal, the one case with no business to
     * brand as — it stands alone, which `StatusCard` is told via `standalone`.
     */
    if (embedded) return card;

    return brand ? (
      <PortalShell brand={brand}>
        <div className="mx-auto max-w-lg">{card}</div>
      </PortalShell>
    ) : (
      card
    );
  }

  if (!proposal || !brand) return <PublicPageSpinner />;

  const body = (
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

          {/*
            ─────────────────────────────────────────────────────────────────
            THE BREAKDOWN — what the total is made of.

            Above the money, because it is the argument for it: a client who
            meets the figure first is deciding before they have read anything.
            Everything below this block is untouched — the total, the stages,
            the sessions, the terms, the attached file, accept and decline are
            the same markup reading the same fields they always have.

            Omitted entirely when there is none, which is every quote written
            before this existed.
            ─────────────────────────────────────────────────────────────────
          */}
          {proposal.breakdown && (
            <section
              className="mt-4 overflow-hidden"
              /*
               * `dir` PINNED, not inherited.
               *
               * The rest of the page gets its direction from `PortalShell`'s
               * `dir={brand.dir}` — but this component renders in two places
               * and only one of them is inside that shell: standalone at
               * `/proposal/[token]`, and embedded in the portal, which draws
               * its own. A block that inherits direction is correct in one and
               * wrong in the other.
               *
               * The letterhead is where it showed: an address is several short
               * lines, half of them Latin, and with the wrong direction they
               * sit against the opposite edge from the business name above
               * them.
               *
               * Taken from `brand.dir` — the SAME value the shell uses, rather
               * than a second `locale === 'he'` test that would have to be kept
               * in step with it. `getDirection` already answers this for every
               * locale, so a right-to-left language added later arrives here
               * without an edit. `'ltr'` only when there is no brand at all,
               * which is the case where `locale` falls back to `'en'` too.
               */
              dir={brand?.dir ?? 'ltr'}
              style={{
                border: '1px solid var(--ap-border)',
                borderRadius: 'var(--ap-radius-md)',
              }}
            >
              {/* Letterhead. Read live from the business profile, so a change
                  of address does not need open quotes reissuing. */}
              {(proposal.breakdown.letterhead.name ||
                proposal.breakdown.letterhead.addressLines.length > 0) && (
                <header
                  className="flex items-start gap-3 px-3.5 py-3"
                  style={{ background: 'var(--ap-brand-tint)' }}
                >
                  {proposal.breakdown.letterhead.logoUrl && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={proposal.breakdown.letterhead.logoUrl}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded-lg object-cover"
                    />
                  )}
                  <div className="min-w-0">
                    {proposal.breakdown.letterhead.name && (
                      <p
                        className="text-sm font-semibold"
                        style={{ color: 'var(--ap-text)', fontFamily: 'var(--ap-font-heading)' }}
                      >
                        {proposal.breakdown.letterhead.name}
                      </p>
                    )}
                    {/* One line per address line, as a postal address is
                        written — and as the PDF prints it. The contact details
                        and the tax id follow on their own line. */}
                    <div
                      className="mt-0.5 text-[11.5px] leading-relaxed"
                      style={{ color: 'var(--ap-text-muted)' }}
                    >
                      {/*
                        EVERY LINE IN ITS OWN `<bdi>`.

                        These are Latin strings inside a right-to-left block,
                        and the bidi algorithm reorders a run it is not told to
                        leave alone. `14 Venus Drive` printed as
                        `Venus Drive 14`, because the leading digits resolve as
                        a separate run and get placed at the right-hand end.

                        `<bdi>` isolates the line and picks its direction from
                        its own first strong character, which is what makes it
                        safe here: a Latin line stays left-to-right, and a line
                        that is genuinely Hebrew — `ארצות הברית` on the quote in
                        front of me — is still laid out right-to-left. Forcing
                        `dir="ltr"` would fix the street and break the country.

                        Same element the invoices list already uses for amounts.
                      */}
                      {proposal.breakdown.letterhead.addressLines.map((line, i) => (
                        <p key={`addr-${i}`}>
                          <bdi>{line}</bdi>
                        </p>
                      ))}
                      {contactBits.length > 0 && (
                        <p>
                          {/*
                            Separators OUTSIDE the isolates, so they stay
                            neutral and the items keep document order.

                            Joining first and isolating the result would not
                            help: the `+` of `+12013643030` is a neutral at the
                            edge of a Latin run, so it migrated to the far end
                            and printed `12013643030+` — a phone number nobody
                            can dial. One isolate per item is what holds each
                            one together.
                          */}
                          {contactBits.map((bit, i) => (
                            <span key={`bit-${i}`}>
                              {i > 0 && ' · '}
                              <bdi>{bit}</bdi>
                            </span>
                          ))}
                        </p>
                      )}
                    </div>
                  </div>
                </header>
              )}

              <ul className="list-none p-0">
                {proposal.breakdown.items.map((item, index) => {
                  const text = renderText(item.body).trim();
                  return (
                    <li
                      key={item.id}
                      className="flex items-start gap-3 px-3.5 py-3"
                      style={{
                        borderTop:
                          index === 0 ? 'none' : '1px solid var(--ap-border)',
                      }}
                    >
                      {item.date && (
                        <span
                          className="w-[52px] shrink-0 pt-0.5 text-[11.5px] tabular-nums"
                          style={{ color: 'var(--ap-text-muted)' }}
                        >
                          {formatPublicDate(item.date, locale, { day: 'numeric', month: 'short' })}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium" style={{ color: 'var(--ap-text)' }}>
                          {item.label}
                        </p>
                        {text && (
                          <p
                            className="mt-1 whitespace-pre-line text-[12.5px] leading-relaxed"
                            style={{ color: 'var(--ap-text-muted)' }}
                          >
                            {text}
                          </p>
                        )}
                        {/* Said only when it is more than one, so a single unit
                            does not print "1 ×" on every line. */}
                        {item.qty !== 1 && (
                          <p
                            className="mt-1 text-[11.5px] tabular-nums"
                            style={{ color: 'var(--ap-text-muted)' }}
                          >
                            {item.qty} × {money(item.unitPrice)}
                          </p>
                        )}
                      </div>
                      <span
                        className="shrink-0 pt-0.5 text-sm font-semibold tabular-nums"
                        style={{ color: 'var(--ap-text)' }}
                      >
                        {money(
                          /* The same rounding the editor and the route used, so
                             the lines on this page add up to the figure below
                             them. */
                          Math.round(item.qty * item.unitPrice * 100) / 100
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
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

          {/*
            The schedule, spelled out. "Paid in 3" is not something a client can
            agree to; how much, and against what, is.

            NOT for a package billed per meeting: there the stages ARE the
            meetings, so this block listed "Meeting 1 … Meeting 6" with their
            amounts and the dates were listed again underneath — the same six
            facts twice, in two different orders. The meetings list below
            carries the amount on each row instead.
          */}
          {proposal.stages.length > 1 && !proposal.sessions?.billPerSession && (
            <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--ap-border)' }}>
              <p
                className="mb-2 text-xs font-semibold uppercase tracking-wide"
                style={{ color: 'var(--ap-text-muted)' }}
              >
                {t('proposal.stages')}
              </p>
              <ul className="space-y-1.5">
                {proposal.stages.map((stage, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0" style={{ color: 'var(--ap-text)' }}>
                      {stage.label}
                      {/*
                        THE DATE THE OWNER ALREADY SEES.
                        ────────────────────────────────
                        The drawer shows "לתשלום עד 29 בנוב׳ 2026" against each
                        period because an accepted quote has real instalment
                        rows. This page showed the same three amounts and no
                        dates — the one surface where the schedule is being
                        agreed to was the one that could not state it.

                        Read on the BUSINESS's clock, as every other date on
                        this page is: `due_date` is a bare SQL DATE, and read
                        in the reader's own zone it slips a day west of UTC.
                      */}
                      {stage.dueDate && (
                        <span className="ms-2 text-xs" style={{ color: 'var(--ap-text-muted)' }}>
                          {formatPublicDate(
                            new Date(`${stage.dueDate}T00:00:00Z`),
                            locale,
                            { day: 'numeric', month: 'short', year: 'numeric' },
                            'UTC'
                          )}
                        </span>
                      )}
                    </span>
                    <span className="font-medium tabular-nums" style={{ color: 'var(--ap-text)' }}>
                      {money(stage.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/*
            THE MEETINGS, when this quote sells several.
            ─────────────────────────────────────────────────────────────────
            ON THE BUSINESS'S CLOCK, NAMED. This formatted on the reader's own
            clock, which for a page that server-renders its first paint is the
            SERVER's: an Israeli business's 16:30 sessions were listed as 09:30,
            all six of them, because the host runs in New York. The hour that
            matters is the one the client turns up at, so the zone comes from
            the business and the list says which it is.

            For a package billed per meeting each row also carries its amount —
            the stage list above would otherwise repeat these six facts in a
            different order, which is what made this page hard to read.
          */}
          {proposal.sessions && proposal.sessions.dates.length > 0 && (
            <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--ap-border)' }}>
              <p
                className="mb-2 text-xs font-semibold uppercase tracking-wide"
                style={{ color: 'var(--ap-text-muted)' }}
              >
                {t('proposal.sessions_title')
                  .replace('{count}', String(proposal.sessions.dates.length))
                  .replace('{minutes}', String(proposal.sessions.durationMinutes))}
              </p>

              <ol className="space-y-2">
                {proposal.sessions.dates.map((iso, i) => (
                  <li key={iso} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="flex items-baseline gap-2">
                      <span
                        className="tabular-nums"
                        style={{ color: 'var(--ap-text-muted)', minWidth: '1.25rem' }}
                      >
                        {i + 1}.
                      </span>
                      <span style={{ color: 'var(--ap-text)' }}>
                        {new Date(iso).toLocaleString(intlLocale, {
                          weekday: 'short',
                          day: 'numeric',
                          month: 'long',
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZone: proposal.sessions?.timezone,
                        })}
                      </span>
                    </span>

                    {/* Its own share, for a package billed per meeting. */}
                    {proposal.sessions?.billPerSession && proposal.stages[i] && (
                      <span
                        className="font-medium tabular-nums"
                        style={{ color: 'var(--ap-text)' }}
                      >
                        {money(proposal.stages[i].amount)}
                      </span>
                    )}
                  </li>
                ))}
              </ol>

              {/*
                Which clock those hours are on. A client in another country
                needs to know, and a client in the same one loses nothing by
                being told.
              */}
              <p className="mt-2 text-xs" style={{ color: 'var(--ap-text-muted)' }}>
                {t('proposal.sessions_timezone').replace(
                  '{zone}',
                  proposal.sessions.timezone.replace(/_/g, ' ')
                )}
              </p>

              {/* Nothing is due now, and each meeting is invoiced after it
                  happens. The button alone cannot say that. */}
              {proposal.sessions.billPerSession && (
                <p className="mt-2 text-sm" style={{ color: 'var(--ap-text)' }}>
                  {t('proposal.sessions_billed_after')}
                </p>
              )}
            </div>
          )}

          {/* When it falls due — part of what they are agreeing to, so it sits
              with the money rather than turning up on the first invoice. */}
          {typeof proposal.termsDays === 'number' && (
            <div className="mt-3 flex items-baseline justify-between text-sm">
              <span style={{ color: 'var(--ap-text-muted)' }}>{t('proposal.terms')}</span>
              <span style={{ color: 'var(--ap-text)' }}>
                {proposal.termsDays === 0
                  ? t('proposal.terms_on_receipt')
                  : t('proposal.terms_net').replace('{days}', String(proposal.termsDays))}
              </span>
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
        {/*
          THE QUOTE AS A PDF — a different thing from the card below it.

          Below is the FILE the owner attached, which the client must open
          before approving. This is the quote itself, rendered: the same
          letterhead, items, total and terms already on this page, in something
          they can keep or forward.

          Deliberately NOT gated. The attachment gate means "read this before
          you agree"; applying it here would ask a client to download a copy of
          what they are already looking at.

          Offered on every quote, with or without a breakdown.
        */}
        <a
          href={`/api/proposal/${token}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 self-start px-3 py-2 text-sm transition-colors"
          style={{
            border: '1px solid var(--ap-border)',
            borderRadius: 'var(--ap-radius-md)',
            color: 'var(--ap-text-muted)',
          }}
        >
          <Download className="h-4 w-4 shrink-0" />
          {t('proposal.download_pdf')}
        </a>

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

        {/*
          THE REST OF THE FILES.

          Listed compactly below the gated one, not as more full cards: the
          first is the thing the owner wants read before agreeing, and giving
          five photographs of a site the same visual weight would bury it.

          Ungated, deliberately — see `documents` on QuoteDetail.
        */}
        {proposal.documents.length > 1 && (
          <div className="flex flex-col gap-1.5">
            {proposal.documents.slice(1).map(file => (
              <a
                key={file.url}
                href={file.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm"
                style={{ color: 'var(--ap-text-muted)' }}
              >
                <FileText className="h-4 w-4 shrink-0" />
                <span className="min-w-0 truncate">{file.name}</span>
              </a>
            ))}
          </div>
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
              {DECLINE_REASONS.map(value => (
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
                // Mandatory. Unreachable without a reason rather than silently
                // sending a default one.
                disabled={!reason}
                onClick={() =>
                  reason && answer({ answer: 'decline', reason, note: note.trim() || undefined })
                }
              >
                {t('proposal.decline.send')}
              </BrandButton>
            </div>
          </div>
        ) : showSign ? (
          /*
            ───────────────────────────────────────────────────────────────────
            THE SIGNING STEP — reached only by pressing Approve.

            It used to sit inline above both buttons, which asked for a
            signature before the client had decided anything: type a name, draw
            a mark, tick the box, then press Decline was a reachable path and a
            faintly absurd one.

            Behind Approve, that path does not exist — signing is part of
            accepting rather than a thing beside it. Decline stays one tap on
            the panel below, which it must: a client who has decided against the
            job should not scroll past a signature pad to say so.

            It also shortens the page for the commonest visit, where somebody
            opens the link to read a price rather than to sign.
            ───────────────────────────────────────────────────────────────────
          */
          <div className="space-y-2">
            {proposal.requiresSignature && (
              <div
                className="mb-3 p-3.5"
                style={{
                  background: 'var(--ap-surface)',
                  border: '1px solid var(--ap-border)',
                  borderRadius: 'var(--ap-radius-md)',
                }}
              >
                <label
                  htmlFor="proposal-signed-name"
                  className="mb-1.5 block text-xs font-medium"
                  style={{ color: 'var(--ap-text-muted)' }}
                >
                  {t('proposal.sign.name_label')}
                </label>
                <input
                  id="proposal-signed-name"
                  type="text"
                  autoComplete="name"
                  value={signedName}
                  onChange={e => setSignedName(e.target.value)}
                  placeholder={proposal.clientFirstName ?? ''}
                  className="w-full px-3 py-2 text-sm outline-none"
                  style={{
                    background: 'var(--ap-bg)',
                    border: '1px solid var(--ap-border)',
                    borderRadius: 'var(--ap-radius-sm)',
                    color: 'var(--ap-text)',
                  }}
                />
                {/*
                  THE MARK, beneath the name.
                  ─────────────────────────────────────────────────────────
                  Both, not either. The typed name is the legible record —
                  what the owner's strip shows, what a report lists, what a
                  dispute reads — and a drawing answers none of those. The
                  drawing is what puts a signature on the PDF and makes the
                  document read as a contract rather than a web form.
                */}
                <div className="mt-3">
                  <SignaturePad
                    label={t('proposal.sign.draw_label')}
                    clearLabel={t('proposal.sign.draw_clear')}
                    hint={t('proposal.sign.draw_hint')}
                    onChange={setSignatureImage}
                  />
                </div>

                <label className="mt-2.5 flex cursor-pointer items-start gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={e => setAgreed(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0"
                  />
                  <span style={{ color: 'var(--ap-text-muted)' }}>
                    {t('proposal.sign.statement')}
                  </span>
                </label>
              </div>
            )}
            <BrandButton
              fullWidth
              loading={answering}
              /*
               * Inside the signing step, so the document gate is already
               * behind us — it is enforced on the Approve that opens this
               * panel. What is left is the signature itself: a name, a mark,
               * and an explicit agreement.
               */
              disabled={
                proposal.requiresSignature &&
                (signedName.trim().length < 2 || !agreed || !signatureImage)
              }
              onClick={() =>
                answer({
                  answer: 'accept',
                  proposal_id: proposal.id,
                  ...(proposal.requiresSignature
                    ? {
                        signature: {
                          name: signedName.trim(),
                          agreed: true,
                          image: signatureImage,
                          /* What THIS page displayed. The server records its
                             own wording and keeps this as the echo, so a stale
                             page cannot decide what was agreed to. */
                          statement: t('proposal.sign.statement'),
                        },
                      }
                    : {}),
                })
              }
            >
              {proposal.dueOnAccept > 0 && proposal.dueOnAccept !== proposal.total
                ? t('proposal.accept_with_due', { amount: money(proposal.dueOnAccept) })
                : t('proposal.accept')}
            </BrandButton>
            {/* Back, not Decline. From inside the signing step the way out is
                to the quote — a client who opened it to sign and changed their
                mind has not decided to refuse, only not to sign yet. */}
            <BrandButton
              variant="ghost"
              fullWidth
              disabled={answering}
              onClick={() => setShowSign(false)}
            >
              {t('proposal.back')}
            </BrandButton>
          </div>
        ) : (
          <div className="space-y-2">
            {/*
              Approve opens the signing step when one is required, and answers
              outright when it is not — so a quote that asks for no signature
              behaves exactly as it always has, in one tap.
            */}
            <BrandButton
              fullWidth
              loading={answering}
              disabled={Boolean(proposal.document) && !documentOpened}
              onClick={() => {
                if (proposal.requiresSignature) {
                  setShowSign(true);
                  return;
                }
                answer({ answer: 'accept', proposal_id: proposal.id });
              }}
            >
              {proposal.dueOnAccept > 0 && proposal.dueOnAccept !== proposal.total
                ? t('proposal.accept_with_due', { amount: money(proposal.dueOnAccept) })
                : t('proposal.accept')}
            </BrandButton>

            {/* Declining is NOT gated. Someone who has decided against the job
                should not have to open a document — or a signature pad — to say
                so. */}
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
  );

  /*
    Embedded, the portal has already drawn the frame and this returns the body
    bare — the rule `quoteAnsweredInThePortal.guard.test.ts` asserts, because
    an early draft framed an accepted quote twice.

    Standing alone it now uses the SAME shell as the portal rather than
    `PublicShell`, so a client who opens a quote from their email and a client
    who opens it from their portal see one page, not two designs.
  */
  return embedded ? (
    body
  ) : (
    <PortalShell brand={brand}>
      <div className="mx-auto max-w-lg">{body}</div>
    </PortalShell>
  );
}
