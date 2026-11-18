'use client';

/**
 * What you sell, and the one of them to finish next.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SERVICE IS THE SPINE.
 *
 * The dashboard used to open with the readiness graph's own answer to "what
 * next", which is a GAP: "set your hours", "connect a processor", "add your
 * invoice details". Every one of those is true, and none of them is a thing an
 * owner set out to do. They are consequences of a service, and an owner who is
 * asked for working hours before anything has been priced is being asked to
 * sequence a dependency graph in their head.
 *
 * So the first card names a SERVICE. Its requirements belong to it, are decided
 * by its own attributes, and are shown where it is edited. "Finish Renovation
 * Consultation" is work somebody recognises; "availability: not configured" is
 * work they have to translate.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS DECIDES NOTHING ABOUT READINESS.
 *
 * It reads the catalogue and nothing else. Whether the business is ready, what
 * blocks publishing, which station is red: all of that stays with `setupGraph`
 * and `journeyReadiness`, which the reach journey below this renders. A draft
 * service deliberately changes none of it — `theGatesDoNotContradict` pins that
 * a draft decides nothing — and this card is the one surface that may talk
 * about drafts, because talking about them is its entire job.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useLanguage } from '@/lib/business-os/LanguageContext';

/** Only the fields this card draws. The row carries far more. */
export interface CatalogueService {
  id: string;
  service_name: string;
  status?: string | null;
  price?: number | string | null;
  currency?: string | null;
  duration_minutes?: number | null;
  is_scheduled?: boolean | null;
  collection?: 'online' | 'invoice' | null;
  sale_mode?: string | null;
}

/**
 * A step that comes BEFORE any service, when one is outstanding.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * The business profile is the first thing, with or without a catalogue. A
 * service editor is a strange first screen for a business that has no name,
 * no trade and no address: the name goes on the booking page, the invoice and
 * every email, so a service finished first is a service finished on top of a
 * blank.
 *
 * It is also the one step that is owed by an account with NOTHING to sell.
 * This card therefore renders for an empty catalogue too, which is why the
 * services list below it is optional rather than the reason the card exists.
 * ───────────────────────────────────────────────────────────────────────────
 */
export interface FirstStep {
  title: string;
  body: string;
  cta: string;
  onPress: () => void;
  /**
   * A second, equal way to do the same job.
   *
   * There is exactly one case and it is not an edge: a business that kept its
   * own website is reached two ways at once. Its site is already where clients
   * find it, so what is missing is a link to book through AND a way for the
   * enquiries that site emails them to become leads instead of sitting in an
   * inbox. Offering only the first would leave half the answer out.
   *
   * The reach journey's callout has drawn this pair for some time; this is the
   * same pair, in the card that now owns the next step.
   */
  secondary?: { cta: string; onPress: () => void } | null;
  /**
   * What comes after this, when anything does.
   *
   * Decided by the caller rather than derived here from the drafts. The panel
   * used to read the next draft and print "Then: <service>", which was right
   * while the profile was the first step and wrong the moment the catalogue
   * phase ended: an owner who has just said "that is all my services" was told
   * the next thing was a service.
   */
  then?: string | null;
}

interface Props {
  services: CatalogueService[];
  /** Opens the services editor on this row. */
  onOpenService: (serviceId: string) => void;
  /** Opens the editor with a new row started. */
  onAddService?: () => void;
  /** Takes the big card when present. See `FirstStep`. */
  firstStep?: FirstStep | null;
  /**
   * Another card above is already naming the next move, so this one must not.
   *
   * The panel draws "Finish <service>" whenever a draft exists and no
   * `firstStep` was given. That is right during the catalogue phase and wrong
   * after it: an owner who has said "that is all my services" and moved on to
   * being found was shown the being-found card AND a card telling them to
   * finish a service — the same two-voices-one-question fault this rework
   * exists to remove. The list below still shows the draft, which is the honest
   * place for it.
   */
  suppressNext?: boolean;
  /**
   * "That is all my services" — ends the services phase.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Without it the card has no way to finish. The platform cannot tell a
   * catalogue of one from a catalogue of one-so-far: a contractor may genuinely
   * sell a single thing, and publishing it is not a signal that they have
   * stopped, any more than a draft left alone means they have given up.
   *
   * Only the owner knows, so the owner is asked, once, and the answer is kept
   * (`dismissed_setup_steps`). Reversible by its nature: adding a service later
   * is just adding a service, and nothing here prevents it.
   * ───────────────────────────────────────────────────────────────────────────
   */
  onNoMoreServices?: () => void;
  /**
   * The business details are not in yet, so the catalogue is not open for
   * business either.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * ONE STEP AT A TIME, AND THIS IS THE SECOND ONE.
   *
   * The card above says "Tell me about your business" while this list offered a
   * button on every row and a "+ New service" link beside the heading, so the
   * screen named one next step and handed over three ways to do something else.
   * An owner who takes one of them lands in a service editor whose own gates
   * then ask for working hours, invoice details and a processor — the
   * dependency graph this rework exists to stop showing people.
   *
   * It is also the wrong order on the merits. The business name, trade and
   * address go on the booking page, the invoice and every email a service
   * produces, so a service finished first is finished on top of a blank.
   *
   * The rows STAY VISIBLE. What the chat built is the owner's, and hiding it
   * until they have filled in a form reads as work that went missing. They are
   * shown, named, and plainly not yet openable, with the reason attached to the
   * control that is refusing.
   * ───────────────────────────────────────────────────────────────────────────
   */
  locked?: boolean;
}

const isLive = (service: CatalogueService) => service.status === 'active';

export function YourServicesPanel({ services, onOpenService, onAddService, firstStep, onNoMoreServices, suppressNext = false, locked = false }: Props) {
  const { t, isRTL } = useLanguage();

  /** `t` returns the key when a translation is missing, so fall back by hand. */
  const tr = (key: string, fallback: string): string => {
    const value = t(key);
    return value === key ? fallback : value;
  };

  /*
   * Nothing at all to show: no step owed, nothing sold.
   *
   * An empty catalogue alone is NOT that case. The business profile is owed
   * whether or not anything is sold, and a business with nothing to sell is
   * precisely the one that still has to say who it is. What this guards is the
   * genuinely empty card: no first step, no services.
   */
  if (!firstStep && services.length === 0) return null;

  /** Why every control in the list is refusing, in one sentence. */
  const lockedWhy = tr(
    'services.panel.lockedWhy',
    'Your services open once your business details are in. They go on every booking page, invoice and email a service sends.'
  );

  const drafts = services.filter(service => !isLive(service));
  const next = drafts[0] ?? null;
  const font = isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif';
  const display = isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif';

  /** "Draft · $150 · 60 min", skipping whatever has not been answered yet. */
  const subtitle = (service: CatalogueService): string => {
    const parts: string[] = [
      isLive(service) ? tr('services.panel.live', 'Live') : tr('services.panel.draft', 'Draft'),
    ];
    const price = Number(service.price);
    if (Number.isFinite(price) && price > 0) {
      parts.push(`${price} ${service.currency ?? ''}`.trim());
    } else if (service.sale_mode === 'proposal') {
      parts.push(tr('services.panel.quoted', 'Quoted'));
    }
    if (service.is_scheduled && service.duration_minutes) {
      parts.push(`${service.duration_minutes} ${tr('services.panel.min', 'min')}`);
    }
    return parts.join(' · ');
  };

  return (
    <div
      className="ysp"
      style={{ direction: isRTL ? 'rtl' : 'ltr', fontFamily: font }}
    >
      {/*
        THE BIG CARD: one service, named, with one button.

        Drawn only while something is still a draft. Once everything is live it
        would be a card announcing that there is nothing to do, which is what
        the reach journey underneath already says better.
      */}
      {firstStep ? (
        <div className="ysp-next">
          <div className="ysp-next-head">
            <span className="ysp-eyebrow">{tr('services.panel.firstStep', 'First step')}</span>
          </div>
          <h3 style={{ fontFamily: display }}>{firstStep.title}</h3>
          <p>{firstStep.body}</p>
          <div className="ysp-next-actions">
            <button type="button" className="ysp-btn ap-primary-lift" onClick={firstStep.onPress}>
              {firstStep.cta}
            </button>
            {firstStep.secondary && (
              <button type="button" className="ysp-btn ysp-btn-quiet" onClick={firstStep.secondary.onPress}>
                {firstStep.secondary.cta}
              </button>
            )}
            {firstStep.then && <span className="ysp-then">{firstStep.then}</span>}
          </div>
        </div>
      ) : next && !suppressNext && !locked && (
        <div className="ysp-next">
          <div className="ysp-next-head">
            <span className="ysp-eyebrow">{tr('services.panel.nextStep', 'Next step')}</span>
            <span className="ysp-count">
              {tr('services.panel.counter', 'Service {n} of {total}')
                .replace('{n}', String(services.indexOf(next) + 1))
                .replace('{total}', String(services.length))}
            </span>
          </div>
          <h3 style={{ fontFamily: display }}>
            {tr('services.panel.finish', 'Finish {name}').replace('{name}', next.service_name)}
          </h3>
          <p>
            {tr(
              'services.panel.finishWhy',
              'It is still a draft, so no client can book it. Open it and it will show you what it needs, with a button for each.'
            )}
          </p>
          <div className="ysp-next-actions">
            <button
              type="button"
              className="ysp-btn ap-primary-lift"
              onClick={() => onOpenService(next.id)}
            >
              {tr('services.panel.open', 'Open the service')}
            </button>
            {drafts.length > 1 && (
              <span className="ysp-then">
                {tr('services.panel.then', 'Then: {name}').replace('{name}', drafts[1].service_name)}
              </span>
            )}
            {/* The way out of this phase, quieter than the work itself. */}
            {onNoMoreServices && (
              <button type="button" className="ysp-done" onClick={onNoMoreServices}>
                {tr('services.panel.noMore', 'That is all my services')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Everything you sell, live and draft together, each with its own way in.
          Absent entirely for an account with nothing to sell: a heading over an
          empty box is a worse answer than no box. */}
      {services.length > 0 && (
      <div className="ysp-list">
        <div className="ysp-list-head">
          <span>{tr('services.panel.title', 'Your services')}</span>
          <span style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            {/* Offered here too: an owner with nothing in draft never sees the
                card above, and would otherwise have no way to say they are
                finished. */}
            {onNoMoreServices && !next && !locked && (
              <button type="button" className="ysp-add" onClick={onNoMoreServices}>
                {tr('services.panel.noMore', 'That is all my services')}
              </button>
            )}
            {/* Adding one is the same work as opening one, so it waits for the
                same answer. Disabled rather than removed: a control that
                vanishes teaches nothing about when it comes back. */}
            {onAddService && (
              <button
                type="button"
                className="ysp-add"
                onClick={locked ? undefined : onAddService}
                disabled={locked}
                title={locked ? lockedWhy : undefined}
              >
                {tr('services.panel.add', '+ New service')}
              </button>
            )}
          </span>
        </div>

        {/* Said once, above the rows, because a tooltip is not an answer on a
            touch screen and the asterisk-less Open buttons would otherwise look
            broken rather than waiting. */}
        {locked && <p className="ysp-locked">{lockedWhy}</p>}

        {services.map(service => (
          <div key={service.id} className="ysp-row" data-live={isLive(service) ? '1' : '0'}>
            <span className="ysp-mark" aria-hidden>{isLive(service) ? '✓' : ''}</span>
            <span className="ysp-name">
              <b>{service.service_name}</b>
              <span>{subtitle(service)}</span>
            </span>
            <button
              type="button"
              className="ysp-open"
              onClick={locked ? undefined : () => onOpenService(service.id)}
              disabled={locked}
              title={locked ? lockedWhy : undefined}
            >
              {tr('services.panel.openShort', 'Open')}
            </button>
          </div>
        ))}
      </div>
      )}

      <style jsx global>{`
        .ysp {
          display: flex;
          flex-direction: column;
          gap: 14px;
          margin-bottom: 24px;
        }

        .ysp-next {
          border: 1px solid color-mix(in srgb, var(--v2-primary) 38%, var(--v2-border));
          background:
            linear-gradient(180deg, color-mix(in srgb, var(--v2-primary) 9%, transparent), transparent 62%),
            var(--v2-surface);
          border-radius: 18px;
          padding: 17px 18px 18px;
          box-shadow: 0 6px 20px -10px rgba(16,22,42,0.25);
        }
        .ysp-next-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 9px;
        }
        .ysp-eyebrow {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--v2-primary);
        }
        .ysp-count {
          font-size: 11.5px;
          color: var(--v2-text-muted);
          font-variant-numeric: tabular-nums;
        }
        .ysp-next h3 {
          margin: 0;
          font-size: 19px;
          font-weight: 600;
          letter-spacing: -0.01em;
          color: var(--v2-text-primary);
          line-height: 1.25;
        }
        .ysp-next p {
          margin: 5px 0 0;
          font-size: 13px;
          line-height: 1.45;
          color: var(--v2-text-secondary);
          /*
           * The card's full width, not a 62ch column.
           *
           * A measure that tight is right for a page of prose and wrong here:
           * the card is wide, so the cap left the sentence breaking after about
           * two thirds with the rest of the line empty, which reads as a layout
           * fault rather than as a paragraph.
           *
           * (No backticks in this comment: it sits inside a styled-jsx template
           * literal, and one would close it. Two did.)
           */
          text-wrap: pretty;
        }
        .ysp-next-actions {
          display: flex;
          align-items: center;
          gap: 14px;
          flex-wrap: wrap;
          margin-top: 14px;
        }
        .ysp-then {
          font-size: 12px;
          color: var(--v2-text-muted);
        }
        /*
         * The second route is an alternative, not a lesser one. It carries the
         * surface colour rather than a transparent fill, like every other
         * secondary button in Business OS, so it reads as a control on whatever
         * ground the card is using.
         */
        .ysp-btn-quiet {
          background: var(--v2-surface);
          color: var(--v2-text-primary);
          border: 1px solid var(--v2-border);
        }
        .ysp-btn-quiet:hover {
          background: var(--v2-bg);
          filter: none;
        }
        .ysp-done {
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
        .ysp-done:hover {
          color: var(--v2-text-primary);
        }

        /* The same recipe every primary in Business OS wears. */
        .ysp-btn {
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
        .ysp-btn:hover {
          filter: brightness(1.05);
          transform: translateY(-1px);
        }
        .ysp-btn:active {
          transform: scale(0.98);
        }

        .ysp-list {
          border: 1px solid var(--v2-border);
          background: var(--v2-surface);
          border-radius: 18px;
          padding: 14px 15px 15px;
        }
        .ysp-list-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--v2-text-secondary);
          margin-bottom: 11px;
        }
        .ysp-add {
          border: none;
          background: none;
          padding: 0;
          font-size: 11.5px;
          font-weight: 600;
          letter-spacing: normal;
          text-transform: none;
          color: var(--v2-primary);
          cursor: pointer;
        }
        .ysp-add:hover {
          text-decoration: underline;
        }
        /* Waiting, not broken. Both refusing controls read the same way: dimmed,
           no hover response, and a cursor that says the click will not land. */
        .ysp-add:disabled,
        .ysp-open:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .ysp-add:disabled:hover {
          text-decoration: none;
        }
        .ysp-open:disabled:hover {
          background: var(--v2-surface);
          border-color: var(--v2-border);
        }
        .ysp-locked {
          margin: 0 0 10px;
          font-size: 11.5px;
          line-height: 1.45;
          color: var(--v2-text-muted);
          text-transform: none;
          letter-spacing: normal;
        }

        .ysp-row {
          display: flex;
          align-items: center;
          gap: 11px;
          padding: 10px 11px;
          border: 1px solid var(--v2-border);
          border-radius: 12px;
          background: var(--v2-bg);
        }
        .ysp-row + .ysp-row {
          margin-top: 7px;
        }
        .ysp-mark {
          width: 18px;
          height: 18px;
          flex: 0 0 auto;
          border-radius: 50%;
          border: 1.5px solid var(--v2-text-muted);
          display: grid;
          place-items: center;
          font-size: 10px;
          font-weight: 700;
          color: transparent;
        }
        .ysp-row[data-live="1"] .ysp-mark {
          background: #22C58B;
          border-color: #22C58B;
          color: #06251A;
        }
        .ysp-name {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .ysp-name b {
          font-size: 13px;
          font-weight: 600;
          color: var(--v2-text-primary);
        }
        .ysp-name span {
          font-size: 11.5px;
          color: var(--v2-text-muted);
        }
        .ysp-open {
          margin-inline-start: auto;
          flex: 0 0 auto;
          border: 1px solid var(--v2-border);
          background: var(--v2-surface);
          color: var(--v2-text-primary);
          font-size: 12px;
          font-weight: 600;
          padding: 7px 13px;
          border-radius: 9px;
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s;
        }
        .ysp-open:hover {
          background: var(--v2-bg);
          border-color: var(--v2-text-muted);
        }

        @media (prefers-reduced-motion: reduce) {
          .ysp-btn,
          .ysp-open {
            transition: none;
          }
          .ysp-btn:hover {
            transform: none;
          }
        }
      `}</style>
    </div>
  );
}
