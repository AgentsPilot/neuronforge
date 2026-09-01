'use client';

import { Building2, Package, CreditCard, Globe, Users, Check, type LucideIcon } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import type { CollectionMethod, PresenceMode } from '@/lib/business-os/setup/setupGraph';

/**
 * What the conversation has learned so far.
 *
 * This used to draw the dashboard's configuration chain — services, hours,
 * payments, invoicing, the lot — which was the wrong picture in the wrong
 * place. The chat asks about the business first and the chain opened with
 * services, so the node lighting up was never the thing the user had just been
 * asked, and the six steps nobody had reached yet sat there as ghosts adding
 * noise to a screen that was supposed to be explaining itself.
 *
 * So it mirrors the interview instead: one stop per question, in the order they
 * are asked, filling in as they are answered. The configuration chain still
 * exists and is still where this leads — it is what the dashboard shows once
 * there is something to configure. Here the job is smaller and more useful:
 * show what has been understood, and what is left to ask.
 */

export interface SetupSignals {
  business: string | null;
  servicesCount: number;
  hasPricedServices: boolean | null;
  collection: CollectionMethod | null;
  presence: PresenceMode | null;
  tracksClients: boolean;
  currentStep: string;
  willProvision: string[];
}

type SubjectId = 'business' | 'services' | 'money' | 'reach' | 'clients';

/**
 * The five things the chat asks about, in the order it asks them.
 *
 * `steps` is which conversation step is asking about this subject, so the panel
 * can mark it as the one in hand rather than guessing from what is filled in.
 */
const SUBJECTS: Array<{
  id: SubjectId;
  icon: LucideIcon;
  color: string;
  steps: string[];
}> = [
  { id: 'business', icon: Building2, color: '#8B5CF6', steps: ['business_story'] },
  { id: 'services', icon: Package, color: '#D14E97', steps: ['client_workflow', 'service_details'] },
  // Settled by the services now, not by a question of its own: the chat stopped
  // asking how money is collected once each service began saying it.
  { id: 'money', icon: CreditCard, color: '#22C58B', steps: ['service_details'] },
  { id: 'reach', icon: Globe, color: '#4F6EF7', steps: ['client_acquisition'] },
  { id: 'clients', icon: Users, color: '#8B5CF6', steps: ['client_tracking'] },
];

const COPY: Record<string, Record<string, string>> = {
  title: { en: 'What I know so far', es: 'Lo que sé hasta ahora', he: 'מה שאני יודע עד כה' },

  business: { en: 'Your business', es: 'Tu negocio', he: 'העסק שלך' },
  services: { en: 'What you sell', es: 'Lo que vendes', he: 'מה שאתה מוכר' },
  money: { en: 'Getting paid', es: 'Cobros', he: 'תשלומים' },
  reach: { en: 'Being found', es: 'Que te encuentren', he: 'איך מוצאים אותך' },
  clients: { en: 'Your clients', es: 'Tus clientes', he: 'הלקוחות שלך' },

  empty: {
    en: 'Tell me about your business and this fills in.',
    es: 'Cuéntame sobre tu negocio y esto se irá completando.',
    he: 'ספר לי על העסק שלך וזה יתמלא.',
  },

  // Why something is the way it is — the sentence that made it true, in the
  // user's own terms. Only the most recent one is shown.
  'why.card_online': {
    en: 'Clients pay by card, so you will need a card processor — that one needs you personally.',
    es: 'Pagan con tarjeta, así que necesitarás un procesador — ese te necesita a ti.',
    he: 'לקוחות משלמים בכרטיס, אז תצטרך מנפיק תשלומים — זה דורש אותך אישית.',
  },
  'why.invoice': {
    en: 'You invoice and they transfer — no card processor, but your bank details go on the invoice.',
    es: 'Tú facturas y ellos transfieren — sin procesador, pero tus datos bancarios van en la factura.',
    he: 'אתה שולח חשבונית והם מעבירים — בלי מנפיק תשלומים, אבל פרטי הבנק שלך יופיעו בחשבונית.',
  },
  'why.in_person': {
    en: 'Paid in person — nothing to set up for payments.',
    es: 'Pagan en persona — nada que configurar para cobros.',
    he: 'משלמים פנים מול פנים — אין מה להגדיר בתשלומים.',
  },
  'why.mixed': {
    en: 'Both ways — a processor if you want one, and your bank details on the invoice.',
    es: 'De las dos formas — procesador si lo quieres, y tus datos bancarios en la factura.',
    he: 'בשתי הדרכים — מנפיק תשלומים אם תרצה, ופרטי הבנק בחשבונית.',
  },
  'why.none': {
    en: 'Nothing is charged, so there is no money side to set up.',
    es: 'No se cobra nada, así que no hay cobros que configurar.',
    he: 'אין גבייה, אז אין צד כספי להגדיר.',
  },
  'why.site': {
    en: 'I will build and publish your site — that is where clients book you.',
    es: 'Construiré y publicaré tu sitio — ahí es donde reservan.',
    he: 'אבנה ואפרסם את האתר שלך — משם לקוחות מזמינים.',
  },
  'why.link': {
    en: 'No website — a booking link does the same job, and it is already done.',
    es: 'Sin web — un enlace de reserva hace lo mismo, y ya está listo.',
    he: 'בלי אתר — לינק להזמנות עושה את אותה עבודה, והוא כבר מוכן.',
  },
};

interface OnboardingSetupPanelProps {
  signals: SetupSignals | null;
}

export function OnboardingSetupPanel({ signals }: OnboardingSetupPanelProps) {
  const { language, isRTL } = useLanguage();
  const t = (key: string) => COPY[key]?.[language] || COPY[key]?.en || '';
  const bodyFont = isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif';

  /** What the conversation has established about each subject, if anything. */
  const answerFor = (id: SubjectId): string | null => {
    if (!signals) return null;

    switch (id) {
      case 'business':
        return signals.business;
      case 'services':
        return signals.servicesCount > 0
          ? `${signals.servicesCount} ${language === 'he' ? 'שירותים' : language === 'es' ? 'servicios' : 'services'}`
          : null;
      case 'money':
        switch (signals.collection) {
          case 'card_online': return language === 'he' ? 'כרטיס בהזמנה' : language === 'es' ? 'Tarjeta al reservar' : 'Card at booking';
          case 'invoice': return language === 'he' ? 'חשבונית והעברה' : language === 'es' ? 'Factura y transferencia' : 'Invoice and transfer';
          case 'in_person': return language === 'he' ? 'תשלום במקום' : language === 'es' ? 'Pago en persona' : 'Paid in person';
          case 'mixed': return language === 'he' ? 'גם וגם' : language === 'es' ? 'Ambas formas' : 'Both ways';
          case 'none': return language === 'he' ? 'ללא תשלום' : language === 'es' ? 'Sin cobros' : 'Nothing charged';
          default: return null;
        }
      case 'reach':
        if (!signals.presence) return null;
        return signals.presence === 'booking_only' || signals.presence === 'none'
          ? (language === 'he' ? 'לינק להזמנות' : language === 'es' ? 'Enlace de reserva' : 'Booking link')
          : (language === 'he' ? 'אתר מלא' : language === 'es' ? 'Sitio web' : 'A website');
      case 'clients':
        return signals.tracksClients
          ? (language === 'he' ? 'מסע לקוח מוגדר' : language === 'es' ? 'Recorrido definido' : 'Journey set up')
          : null;
    }
  };

  const reason = (() => {
    if (!signals) return null;
    if (signals.currentStep === 'client_acquisition' || signals.presence) {
      return signals.presence
        ? (signals.presence === 'booking_only' || signals.presence === 'none' ? 'why.link' : 'why.site')
        : null;
    }
    return signals.collection ? `why.${signals.collection}` : null;
  })();

  return (
    <div
      dir={isRTL ? 'rtl' : 'ltr'}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '16px',
        borderRadius: '16px',
        background: 'var(--v2-surface)',
        border: '1px solid var(--v2-border)',
      }}
    >
      <span
        style={{
          fontFamily: bodyFont,
          fontSize: '10.5px',
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--v2-text-muted)',
        }}
      >
        {t('title')}
      </span>

      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        {SUBJECTS.map((subject, index) => {
          const answer = answerFor(subject.id);
          const known = answer !== null;
          const asking = !known && !!signals && subject.steps.includes(signals.currentStep);
          const color = known || asking ? subject.color : 'var(--v2-text-muted)';
          const Icon = subject.icon;
          const previousKnown = index > 0 && answerFor(SUBJECTS[index - 1].id) !== null;

          return (
            <div
              key={subject.id}
              style={{
                position: 'relative',
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '5px',
                // Not yet reached, and not being asked: present so the road
                // ahead is visible, quiet so it does not compete.
                opacity: known || asking ? 1 : 0.32,
                transition: 'opacity 0.35s',
              }}
            >
              {index > 0 && (
                <span
                  aria-hidden
                  style={{
                    position: 'absolute',
                    top: '13px',
                    insetInlineEnd: '50%',
                    width: '100%',
                    height: 0,
                    borderTop: `2px ${previousKnown ? 'solid' : 'dashed'} ${previousKnown ? subject.color + '55' : 'var(--v2-border)'}`,
                    zIndex: 0,
                  }}
                />
              )}

              <span
                style={{
                  position: 'relative',
                  zIndex: 1,
                  width: 27,
                  height: 27,
                  borderRadius: '999px',
                  display: 'grid',
                  placeItems: 'center',
                  background: known ? color : 'var(--v2-surface)',
                  border: `${asking ? 2 : 1.5}px ${known || asking ? 'solid' : 'dashed'} ${color}`,
                  boxShadow: asking ? `0 0 0 4px ${subject.color}22` : 'none',
                  color: known ? '#FFFFFF' : color,
                }}
              >
                <Icon style={{ width: 13, height: 13 }} strokeWidth={2} />
                {known && (
                  <span
                    style={{
                      position: 'absolute',
                      insetInlineEnd: '-3px',
                      bottom: '-3px',
                      width: 12,
                      height: 12,
                      borderRadius: '999px',
                      background: 'var(--v2-surface)',
                      border: `1px solid ${color}`,
                      display: 'grid',
                      placeItems: 'center',
                      color,
                    }}
                  >
                    <Check style={{ width: 7, height: 7 }} strokeWidth={3.5} />
                  </span>
                )}
              </span>

              <span
                style={{
                  fontFamily: bodyFont,
                  fontSize: '9.5px',
                  fontWeight: asking ? 700 : 500,
                  lineHeight: 1.2,
                  textAlign: 'center',
                  color: 'var(--v2-text-secondary)',
                  maxWidth: '100%',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  padding: '0 2px',
                }}
              >
                {t(subject.id)}
              </span>

              {/* The answer itself, under its own stop, so the panel is a
                  record of the conversation rather than a progress bar. */}
              {answer && (
                <span
                  style={{
                    fontFamily: bodyFont,
                    fontSize: '9px',
                    lineHeight: 1.2,
                    textAlign: 'center',
                    color: 'var(--v2-text-muted)',
                    maxWidth: '100%',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    padding: '0 2px',
                  }}
                >
                  {answer}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {reason && (
        <p
          style={{
            fontFamily: bodyFont,
            fontSize: '11.5px',
            lineHeight: 1.45,
            color: 'var(--v2-text-secondary)',
            borderInlineStart: '2px solid var(--v2-border)',
            paddingInlineStart: '9px',
          }}
        >
          {t(reason)}
        </p>
      )}

      {!signals?.business && (
        <p style={{ fontFamily: bodyFont, fontSize: '11.5px', color: 'var(--v2-text-muted)', lineHeight: 1.45 }}>
          {t('empty')}
        </p>
      )}
    </div>
  );
}
