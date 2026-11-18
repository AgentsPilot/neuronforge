'use client';

/**
 * Being found: the last phase of the setup, in two sub-stages.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 1  YOUR LINK      the one address a client can open. Published HERE, not on
 *                   the Online presence tab — which is hidden during setup, so
 *                   sending an owner there would be sending them through a door
 *                   that is not on screen and expecting them to find their way
 *                   back.
 *
 * 2  YOUR MAILBOX   only for a business that told the interview its enquiries
 *                   arrive by email. The site already brings people in; what is
 *                   missing is anybody reading what it sends.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A SMART LINK HAS NO PUBLISH STEP, WHICH IS WHY THIS IS POSSIBLE.
 *
 * `/go/{code}` serves a link the moment it exists, so `is_active` is its only
 * gate — and `getOrCreateDefaultLinks` already made this account's booking link
 * during the build, deliberately switched OFF. Publishing is therefore one
 * PATCH, not a page of work, and there is no reason for it to live anywhere
 * else.
 *
 * The same is NOT true of a website. Publishing a site is reviewing pages,
 * copy and a domain; a business that asked us to build one keeps going to the
 * website page for it, and this card only shows the way. See `mode`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SKIPPING IS AN ANSWER.
 *
 * An owner may not want a link at all — they have their own site and their own
 * buttons on it. Skipping moves them to the mailbox and, where there is no
 * mailbox to offer, ends the setup. It is recorded as dismissing the `website`
 * step, which is what that record has always meant.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useState } from 'react';

import { useLanguage } from '@/lib/business-os/LanguageContext';

interface BookingLink {
  id: string;
  code: string;
  is_active: boolean;
  destination_type: string | null;
}

interface Props {
  /**
   * Which kind of reach this business chose, read off the `website` setup
   * item's action rather than decided again here.
   */
  mode: 'link' | 'site';
  /** For `site` mode only: open the website page, where publishing lives. */
  onOpenWebsite: () => void;
  /** The interview said enquiries arrive by email at a site they already have. */
  offerMailbox: boolean;
  /** A channel is already connected, so stage two is finished. */
  mailboxConnected: boolean;
  /** Opens the mailbox wizard, in place, on the channels card. */
  onConnectMailbox: () => void;
  /** Something went live: refresh the surfaces that gate on it. */
  onPublished: () => void;
  /** The owner does not want a link. Records it and moves on. */
  onSkip: () => void;
  /**
   * The owner does not want the mailbox read, for now.
   *
   * Its own callback, because "Not now" on this stage used to fire `onSkip` —
   * the WEBSITE skip. It recorded the wrong decision and, since this stage
   * renders on `offerMailbox && !mailboxConnected`, it did not even dismiss
   * itself: the card went on offering the mailbox forever.
   */
  onSkipMailbox: () => void;
  /** They have already skipped it, so stage one is behind them. */
  skipped: boolean;
  /**
   * They changed their mind and do want a link.
   *
   * A setup phase has to be reversible in a way a dismissed checklist row does
   * not: "I do not need a booking link" is a decision made in about a second,
   * by somebody who has not yet seen what the link does. Without a way back the
   * card never returns, and on an account with no mailbox to offer the whole
   * card closes, so there is no way back at all.
   */
  onUnskip: () => void;
}

export function BeingFoundCard({
  mode,
  onOpenWebsite,
  offerMailbox,
  mailboxConnected,
  onConnectMailbox,
  onPublished,
  onSkip,
  onSkipMailbox,
  skipped,
  onUnskip,
}: Props) {
  const { t, isRTL } = useLanguage();

  const tr = (key: string, fallback: string): string => {
    const value = t(key);
    return value === key ? fallback : value;
  };

  const [link, setLink] = useState<BookingLink | null>(null);
  /**
   * The contact form link, which `getOrCreateDefaultLinks` makes alongside the
   * booking one and leaves switched ON — it sells nothing and cannot dead-end.
   *
   * Needed because declining the mailbox makes it the only way an enquiry
   * reaches this business: their website will go on emailing them and nobody
   * will be reading it, so a form that files leads directly is what is left.
   */
  const [formLink, setFormLink] = useState<BookingLink | null>(null);
  /**
   * "Not now" has been pressed, and nothing has been recorded yet.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * It used to record the decline on the press and then explain the
   * consequence. Two things were wrong with that. The explanation arrived after
   * the decision rather than before it, which is not a choice; and recording it
   * answered the last phase, so the setup finished and the whole dashboard
   * unfolded underneath the card that was still mid-sentence.
   *
   * So this is a gate: the consequence first, then an explicit yes. Nothing is
   * written and no phase is answered until the owner confirms that a form
   * submission is the only way they want to be reached.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const [confirmingDecline, setConfirmingDecline] = useState(false);
  const [loading, setLoading] = useState(mode === 'link');
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /**
   * Hold stage one open after a successful publish, to show the address.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Without this the card advanced the instant the link went live: `is_active`
   * flipped, stage one counted as done, and the mailbox stage replaced it. The
   * owner pressed Publish and the thing they had just published vanished.
   *
   * The link is the one piece of this setup they have to keep — it goes in a
   * signature, on a site, into a WhatsApp message — so it is shown with a Copy
   * button and the owner moves on when they are ready.
   *
   * Only right after publishing. On a later visit the address lives on the
   * Online presence tab, which publishing has just made visible, and repeating
   * it here would be a card that never finishes.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const [justPublished, setJustPublished] = useState(false);

  /*
   * `includeDefaults` CREATES the pair if they are missing, which is what makes
   * this safe on an account whose build predates them. Idempotent by design.
   */
  const loadLink = useCallback(async () => {
    try {
      /*
       * `active=false` means "do not filter by active", and it is essential
       * here rather than incidental.
       *
       * The route reads `activeOnly = active !== 'false'`, so the default is
       * live links only — and `getOrCreateDefaultLinks` creates the booking
       * link switched OFF on purpose, because a smart link is served the moment
       * it exists. Without this the one link this card exists to publish is the
       * one link the list leaves out, and the button sits disabled forever.
       */
      /* No `type` filter: both defaults are wanted, and the booking one is the
         only thing the type filter was ever selecting. */
      const response = await fetch('/api/smart-links?includeDefaults=true&active=false');
      if (!response.ok) { setLoading(false); return; }
      const body = await response.json();
      const links: BookingLink[] = body?.links ?? body?.data ?? [];
      setLink(links.find(candidate => candidate.destination_type === 'booking') ?? null);
      setFormLink(links.find(candidate => candidate.destination_type === 'form') ?? null);
    } catch {
      /* The card falls back to explaining without a link to show. */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLink();
  }, [loadLink]);

  /** Returns whether it went live, so a caller can decide what happens next. */
  const publish = async (): Promise<boolean> => {
    if (!link || publishing) return false;
    setPublishing(true);
    setError(null);
    try {
      /*
       * PUT, not PATCH. The route exports GET, PUT and DELETE, so a PATCH is
       * answered by Next itself with 405 and no JSON body — which surfaced here
       * as the generic "could not be published yet", with the real reason being
       * that nothing ever reached the handler. Toggling with a body of just
       * `is_active` is what this route is for; the links page does the same.
       */
      const response = await fetch(`/api/smart-links/${link.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: true }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        /*
         * The route refuses a link whose journey cannot run, and returns the
         * gaps apart so each can be named. Shown rather than swallowed: "could
         * not publish" with no reason is the dead end this phase exists to
         * remove.
         */
        /* The status, when there is no sentence to show. A bare "could not"
           sent me hunting for a journey gap that did not exist; the 405 was
           the whole story and was invisible. */
        setError(
          body?.error
          || `${tr('found.link.failed', 'That could not be published yet.')} (${response.status})`
        );
        return false;
      }

      setLink(current => (current ? { ...current, is_active: true } : current));
      setJustPublished(true);
      /* The Online presence tab gates on something being reachable, so it
         appears without a reload. */
      onPublished();
      return true;
    } catch {
      setError(tr('found.link.failed', 'That could not be published yet.'));
      return false;
    } finally {
      setPublishing(false);
    }
  };

  const publicUrl = link ? `${window.location.origin}/go/${link.code}` : '';
  const formUrl = formLink ? `${window.location.origin}/go/${formLink.code}` : '';

  const copy = async (value: string = publicUrl) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* Clipboard refused (an insecure origin, or permission). The address is
         on screen and selectable, which is the fallback that always works. */
    }
  };

  /** Stage one is behind us once the link is live, skipped, or not the route. */
  const linkStageDone = mode === 'site' ? true : skipped || link?.is_active === true;
  const showMailbox = linkStageDone && offerMailbox && !mailboxConnected && !justPublished;

  const font = isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif';
  const display = isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif';

  /*
   * Nothing left in this phase: the link is settled and either there is no
   * mailbox to offer or it is already connected. The card draws nothing rather
   * than announcing that there is nothing to do.
   */
  /**
   * The card's stylesheet, as a value rather than inline in one return.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * It sat inside the main return, and this component has THREE returns: the
   * confirmation gate, the one-line note for a skipped link, and the card
   * itself. styled-jsx only injects a stylesheet that is actually rendered, so
   * both early returns came out with no CSS at all — dark text on a dark
   * ground, no panel, no buttons. Reported with a screenshot of exactly that.
   *
   * A variable rather than a shared wrapper, because the wrapper's own class
   * differs per branch and threading that through was the more invasive half.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const sheet = (
        <style jsx global>{`
          .bfc {
            border: 1px solid color-mix(in srgb, var(--v2-primary) 38%, var(--v2-border));
            background:
              linear-gradient(180deg, color-mix(in srgb, var(--v2-primary) 9%, transparent), transparent 62%),
              var(--v2-surface);
            border-radius: 18px;
            padding: 17px 18px 18px;
            box-shadow: 0 6px 20px -10px rgba(16,22,42,0.25);
            margin-bottom: 14px;
          }
          .bfc-head {
            margin-bottom: 9px;
          }
          .bfc-eyebrow {
            font-size: 11px;
            font-weight: 600;
            letter-spacing: 0.1em;
            text-transform: uppercase;
            color: var(--v2-primary);
          }
          .bfc h3 {
            margin: 0;
            font-size: 19px;
            font-weight: 600;
            letter-spacing: -0.01em;
            color: var(--v2-text-primary);
            line-height: 1.25;
          }
          .bfc p {
            margin: 5px 0 0;
            font-size: 13px;
            line-height: 1.45;
            color: var(--v2-text-secondary);
            text-wrap: pretty;
          }
          .bfc-actions {
            display: flex;
            align-items: center;
            gap: 14px;
            flex-wrap: wrap;
            margin-top: 14px;
          }
          .bfc-btn {
            border: none;
            background: var(--v2-primary);
            color: #fff;
            font-size: 13px;
            font-weight: 600;
            padding: 10px 16px;
            border-radius: 11px;
            cursor: pointer;
            transition: filter 0.15s, transform 0.15s;
          }
          .bfc-btn:hover {
            filter: brightness(1.05);
            transform: translateY(-1px);
          }
          .bfc-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
          }
          /* A second button, carrying the surface colour so it reads as a control
           on the card's tinted ground rather than a shaded patch. */
        .bfc-btn-quiet {
          background: var(--v2-surface);
          color: var(--v2-text-primary);
          border: 1px solid var(--v2-border);
        }
        .bfc-btn-quiet:hover {
          background: var(--v2-bg);
          filter: none;
        }
        .bfc-skip {
            border: none;
            background: none;
            padding: 0;
            font-size: 12.5px;
            font-weight: 500;
            color: var(--v2-text-secondary);
            cursor: pointer;
            text-decoration: underline;
            text-underline-offset: 2px;
          }
          .bfc-skip:hover {
            color: var(--v2-text-primary);
          }
          /* One line, no heading: a note rather than a step. */
          .bfc-quiet {
            display: flex;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
            font-size: 12.5px;
            color: var(--v2-text-secondary);
            background: var(--v2-surface);
            border-color: var(--v2-border);
          }
          .bfc-keep {
            margin-top: 14px;
            font-weight: 500;
            color: var(--v2-text-primary);
          }
          .bfc-live {
            display: flex;
            align-items: center;
            gap: 12px;
            flex-wrap: wrap;
            margin-top: 14px;
            padding: 10px 12px;
            border-radius: 11px;
            border: 1px solid var(--v2-border);
            background: var(--v2-bg);
          }
          .bfc-url {
            font-size: 13px;
            font-weight: 500;
            color: var(--v2-text-primary);
            word-break: break-all;
            direction: ltr;
          }
          .bfc-copy {
            margin-inline-start: auto;
            border: 1px solid var(--v2-border);
            background: var(--v2-surface);
            color: var(--v2-text-primary);
            font-size: 12px;
            font-weight: 600;
            padding: 7px 13px;
            border-radius: 9px;
            cursor: pointer;
          }
          .bfc-error {
            margin-top: 10px;
            color: #F26B6B;
            font-size: 12.5px;
            font-weight: 500;
          }
          @media (prefers-reduced-motion: reduce) {
            .bfc-btn {
              transition: none;
            }
            .bfc-btn:hover {
              transform: none;
            }
          }
        `}</style>
  );

  /*
   * Nothing left in this phase. A SKIPPED link is not that: the way back has to
   * live somewhere, and this card is the only thing on screen that knows the
   * link exists. It stays as one quiet line.
   */
  const nothingLeft =
    linkStageDone && !showMailbox && !justPublished && mode === 'link' && !skipped;
  if (nothingLeft) return null;

  /* Skipped, with no mailbox stage to carry the offer: one line and nothing else. */
  if (skipped && !showMailbox && !justPublished && mode === 'link' && !link?.is_active) {
    return (
      <div className="bfc bfc-quiet" style={{ direction: isRTL ? 'rtl' : 'ltr', fontFamily: font }}>
        <span>{tr('found.link.skipped', 'You skipped your booking link.')}</span>
        <button type="button" className="bfc-skip" onClick={onUnskip}>
          {tr('found.link.reconsider', 'Publish it after all')}
        </button>
        {sheet}
      </div>
    );
  }

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * DECLINED THE MAILBOX: SAY WHAT IS LEFT.
   *
   * Their website will go on emailing them when somebody fills in its form, and
   * now nobody is reading those. What remains is this link: a form that files
   * an enquiry as a lead the moment it is submitted.
   *
   * Shown once, at the moment of the decision, rather than as a standing
   * warning. An owner who has just chosen this does not need to be told again
   * every time they open the page, and the link itself lives on the Online
   * presence tab from here.
   * ───────────────────────────────────────────────────────────────────────────
   */
  if (confirmingDecline) {
    return (
      <div className="bfc" style={{ direction: isRTL ? 'rtl' : 'ltr', fontFamily: font }}>
        <div className="bfc-head">
          <span className="bfc-eyebrow">{tr('found.stage.two', 'Last step')}</span>
        </div>
        {/*
          Two situations reach this gate, and one sentence cannot serve both.
          An owner who PUBLISHED their booking link has two ways in and is only
          declining a third; one who skipped it has exactly this form and
          nothing else. Telling the first that the form is their only way in
          would be false, and telling the second it is one of several would
          hide the thing they need to weigh.
        */}
        <h3 style={{ fontFamily: display }}>
          {link?.is_active
            ? tr('found.only.title_published', 'Then your links are how people reach you')
            : tr('found.only.title', 'Then this form is the only way in')}
        </h3>
        <p>
          {link?.is_active
            ? tr(
                'found.only.body_published',
                'Your site will keep emailing you when somebody fills in its form, and nobody here is reading that inbox. What still works is the link you published, and the form below: both file an enquiry the moment it arrives.'
              )
            : tr(
                'found.only.body',
                'Your site will keep emailing you when somebody fills in its form, and nobody here is reading that inbox. Anyone who opens this link instead lands as a lead straight away, with their details already filed.'
              )}
        </p>

        {formUrl && (
          <div className="bfc-live">
            <span className="bfc-url">{formUrl}</span>
            <button type="button" className="bfc-copy" onClick={() => copy(formUrl)}>
              {copied ? tr('found.link.copied', 'Copied') : tr('found.link.copy', 'Copy')}
            </button>
          </div>
        )}

        <div className="bfc-actions">
          {/*
            The confirmation, and the ONLY thing that records the decline. The
            mailbox offer keeps the primary weight: this is the moment an owner
            is most likely to reconsider, and a minute of connecting beats every
            enquiry going unread.
          */}
          <button
            type="button"
            className="bfc-btn ap-primary-lift"
            onClick={() => { setConfirmingDecline(false); onConnectMailbox(); }}
          >
            {tr('reach.fix.inbox_channel', 'Read my website enquiries')}
          </button>
          {/*
            THE WAY BACK TO THE LINK, for an owner who skipped it and has just
            been told a form is all they have left. That is the first moment the
            trade-off is concrete, and it is exactly when somebody who does not
            like the form idea will want the booking link after all.

            Offered only when there is no live link to go back to; an owner who
            already published one is not missing anything.
          */}
          {!link?.is_active && (
            <button
              type="button"
              className="bfc-btn bfc-btn-quiet"
              disabled={publishing || !link}
              /*
               * Publishes HERE. It used to send the owner back a stage to press
               * a different button, which is a worse answer to "I have changed
               * my mind" than simply doing the thing: they have already decided,
               * and the stage they would land on exists to ask them to decide.
               *
               * `onUnskip` still fires, so the record agrees with what happened
               * — the link is no longer skipped, it is live.
               */
              onClick={async () => {
                const live = await publish();
                if (!live) return;
                onUnskip();
                setConfirmingDecline(false);
              }}
            >
              {publishing
                ? tr('found.link.publishing', 'Publishing...')
                : tr('found.only.publishInstead', 'Publish my booking link instead')}
            </button>
          )}
          <button
            type="button"
            className="bfc-skip"
            onClick={() => { onSkipMailbox(); setConfirmingDecline(false); }}
          >
            {link?.is_active
              ? tr('found.only.confirm_published', 'Yes, my links are enough')
              : tr('found.only.confirm', 'Yes, the form is enough')}
          </button>
        </div>

        {error && (
          <p className="bfc-error" role="alert">
            {error}
          </p>
        )}
        {sheet}
      </div>
    );
  }

  return (
    <div className="bfc" style={{ direction: isRTL ? 'rtl' : 'ltr', fontFamily: font }}>
      <div className="bfc-head">
        <span className="bfc-eyebrow">
          {showMailbox
            ? tr('found.stage.two', 'Last step')
            : tr('found.stage.one', 'Being found')}
        </span>
      </div>

      {showMailbox ? (
        <>
          <h3 style={{ fontFamily: display }}>
            {tr('found.mailbox.title', 'Let me read the enquiries your site sends you')}
          </h3>
          <p>
            {tr(
              'found.mailbox.body',
              'Your website emails you when somebody fills in its form. Connect that mailbox and each one becomes a lead with a reply already drafted, instead of a message waiting in an inbox.'
            )}
          </p>
          <div className="bfc-actions">
            <button type="button" className="bfc-btn ap-primary-lift" onClick={onConnectMailbox}>
              {tr('reach.fix.inbox_channel', 'Read my website enquiries')}
            </button>
            {/* The way back, for an owner who skipped the link a moment ago and
                has since seen what it was for. Before "Not now": these are both
                ways off this card, and the one that goes BACK a step reads
                first — a reader who has already decided to move on has stopped
                looking by the time they reach the last control. */}
            {skipped && !link?.is_active && (
              <button type="button" className="bfc-skip" onClick={onUnskip}>
                {tr('found.link.reconsider', 'Publish it after all')}
              </button>
            )}
            <button
              type="button"
              className="bfc-skip"
              /* Opens the gate. Records nothing: see `confirmingDecline`. */
              onClick={() => setConfirmingDecline(true)}
            >
              {tr('found.skip.mailbox', 'Not now')}
            </button>
          </div>
        </>
      ) : mode === 'site' ? (
        <>
          <h3 style={{ fontFamily: display }}>
            {tr('found.site.title', 'Your page is built and not yet live')}
          </h3>
          <p>
            {tr(
              'found.site.body',
              'Review it and publish when you are happy with it. Until then nobody can find you.'
            )}
          </p>
          <div className="bfc-actions">
            <button type="button" className="bfc-btn ap-primary-lift" onClick={onOpenWebsite}>
              {tr('reach.fix.website', 'Review and publish')}
            </button>
          </div>
        </>
      ) : (
        <>
          <h3 style={{ fontFamily: display }}>
            {tr('found.link.title', 'One address that takes a client all the way')}
          </h3>
          {/*
            WHAT IT IS AND WHAT THEY DO WITH IT, before the button.

            "Publish your booking link" means nothing to somebody who has never
            had one. The two sentences below are the whole explanation: what it
            does, and where to put it.
          */}
          <p>
            {tr(
              'found.link.body',
              'This is your own address. Anyone who opens it sees what you sell, picks one, and leaves their details, so nothing has to be arranged by email. Publish it, then put it on your website, in your signature and anywhere clients already look for you.'
            )}
          </p>

          {link?.is_active ? (
            <>
              <p className="bfc-keep">
                {tr('found.link.keep', 'Your link is live. Keep it somewhere you can reach: this is the address clients open.')}
              </p>
              <div className="bfc-live">
                <span className="bfc-url">{publicUrl}</span>
                <button type="button" className="bfc-copy" onClick={() => copy()}>
                  {copied ? tr('found.link.copied', 'Copied') : tr('found.link.copy', 'Copy')}
                </button>
              </div>
              {/* The owner leaves this stage when they have the address, not
                  when the request finished. */}
              {justPublished && (
                <div className="bfc-actions">
                  <button
                    type="button"
                    className="bfc-btn ap-primary-lift"
                    onClick={() => setJustPublished(false)}
                  >
                    {/* Names where it goes. A bare "Next" on the last card of a
                        setup reads as "there is more of this", which is the one
                        thing an owner who has just finished wants to know the
                        answer to. */}
                    {offerMailbox && !mailboxConnected
                      ? tr('found.link.next', 'Next: my mailbox')
                      : tr('found.link.done', 'Finish setup')}
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="bfc-actions">
              <button
                type="button"
                className="bfc-btn ap-primary-lift"
                onClick={publish}
                disabled={loading || publishing || !link}
              >
                {publishing
                  ? tr('found.link.publishing', 'Publishing...')
                  : tr('found.link.publish', 'Publish my link')}
              </button>
              <button type="button" className="bfc-skip" onClick={onSkip}>
                {tr('found.skip.link', 'I do not need a link')}
              </button>
            </div>
          )}

          {error && (
            <p className="bfc-error" role="alert">
              {error}
            </p>
          )}
        </>
      )}

      {sheet}
    </div>
  );
}
