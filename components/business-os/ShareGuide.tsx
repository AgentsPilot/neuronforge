'use client';

/**
 * How to share a link, and where it will actually work.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT EXISTS
 *
 * The share menu tags a link by where it is going, which is what makes the
 * Channels card able to say "three clients came from WhatsApp". None of that is
 * discoverable: the owner sees a Share icon, presses it, gets a list of apps,
 * and has no reason to think choosing one matters. Left alone they press "Just
 * copy the link" every time and the channel table stays empty.
 *
 * So the guide is not decoration. It is the only place the product explains why
 * the menu has six entries instead of a copy button.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A HINT, NOT A BANNER
 *
 * It began as a block fixed above the list. Wrong shape for something read
 * once: it pushed the links themselves down the page for ever, and an owner
 * who already knew had a 500px animation in the way every visit.
 *
 * So it is a small pulsing hint on ONE smart link — the first live one, since
 * three pulsing buttons is a fairground — which opens a dialog. Dismissing it
 * removes the hint for good. Nothing is fixed in the page.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT PLAYS ONCE AND WAITS
 *
 * An earlier version looped. A loop wipes the last panel exactly when somebody
 * turns to read it, and the last panel is the one worth reading — six places a
 * link can land, and whether it works in each. It now runs a single 12-second
 * pass and holds on that panel until dismissed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE INSTAGRAM PANEL IS THE POINT
 *
 * A link in an Instagram CAPTION is not clickable — it renders as plain text
 * and no amount of tagging changes that. An owner who does not know this pastes
 * their link into a post, waits a week, sees no clicks, and concludes the
 * feature is broken when Instagram is what refused. Every panel therefore says
 * in plain words whether people can click it.
 *
 * @module components/business-os/ShareGuide
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Megaphone } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

/**
 * Remembered per browser, not per account.
 *
 * A dismissal is "I have read this", which is a fact about a person at a
 * screen. Storing it server-side would need a column and a write, and would
 * still be wrong for the owner who reads it on their laptop and later opens the
 * page on a phone they have never used.
 */
const DISMISS_KEY = 'business-os:share-guide-dismissed';

interface ShareGuideProps {
  language: string;
  isRTL?: boolean;
  /** The owner's own domain, so the examples are not somebody else's. */
  shareDomain?: string;
  /**
   * What this link is for, so the examples are about the owner's own link.
   *
   * A contact form shared with "Book a time with me" reads as a different
   * product. The steps are identical; only the words in the six panels change.
   */
  kind?: 'booking' | 'form';
  /** The link's own code, so the guide shows the link it sits beside. */
  code?: string;
  /** Motion off: the hint sits still and the dialog does not animate. */
  prefersReducedMotion?: boolean;
}

const TEXT: Record<string, Record<string, string>> = {
  en: {
    title: 'Share your link where your clients already are',
    subtitle: "Copy a different link for each place, and you'll see which one actually brings people in.",
    step1: 'Find the link you want to share, and press Share.',
    step2: "Choose where you're about to post it. The link is copied for you.",
    step3: 'Paste it where you were going. Each place gets its own link, so each is counted separately.',
    canClick: 'People can click it',
    cannotClick: "People can't click it",
    canScan: 'People can scan it',
    whatsapp: 'WhatsApp',
    igBio: 'Instagram bio',
    igPost: 'Instagram post',
    fbPost: 'Facebook post',
    email: 'Email',
    printed: 'Printed',
    footer: 'Each one counted on its own, so the Channels card can tell you which is working.',
    gotIt: 'Got it',
    plainCopy: 'Just copy the link',
    hide: 'Hide',
    hintLabel: 'How to share this',
    waAsk: 'Hi! Do you have room this week?',
    emailTo: 'To: dana@example.com',
    emailSubject: 'Re: availability',
    tagline: 'Training & consulting',
  },
  es: {
    title: 'Comparte tu enlace donde ya están tus clientes',
    subtitle: 'Copia un enlace distinto para cada sitio y verás cuál te trae gente.',
    step1: 'Busca el enlace que quieres compartir y pulsa Compartir.',
    step2: 'Elige dónde lo vas a publicar. El enlace se copia solo.',
    step3: 'Pégalo donde ibas. Cada sitio tiene su propio enlace, así cada uno se cuenta aparte.',
    canClick: 'Se puede pulsar',
    cannotClick: 'No se puede pulsar',
    canScan: 'Se puede escanear',
    whatsapp: 'WhatsApp',
    igBio: 'Bio de Instagram',
    igPost: 'Publicación de Instagram',
    fbPost: 'Publicación de Facebook',
    email: 'Correo',
    printed: 'Impreso',
    footer: 'Cada uno se cuenta por separado, para que Canales te diga cuál funciona.',
    gotIt: 'Entendido',
    plainCopy: 'Solo copiar el enlace',
    hide: 'Ocultar',
    hintLabel: 'Cómo compartirlo',
    waAsk: '¡Hola! ¿Tienes hueco esta semana?',
    emailTo: 'Para: dana@example.com',
    emailSubject: 'Re: disponibilidad',
    tagline: 'Formación y consultoría',
  },
  he: {
    title: 'שתפו את הקישור במקום שבו הלקוחות שלכם כבר נמצאים',
    subtitle: 'העתיקו קישור נפרד לכל מקום, ותראו מאיפה באמת מגיעים לקוחות.',
    step1: 'מצאו את הקישור שאתם רוצים לשתף ולחצו על שיתוף.',
    step2: 'בחרו איפה אתם עומדים לפרסם. הקישור מועתק אוטומטית.',
    step3: 'הדביקו במקום שאליו התכוונתם. לכל מקום קישור משלו, כך שכל אחד נספר בנפרד.',
    canClick: 'אפשר ללחוץ',
    cannotClick: 'אי אפשר ללחוץ',
    canScan: 'אפשר לסרוק',
    whatsapp: 'וואטסאפ',
    igBio: 'ביו באינסטגרם',
    igPost: 'פוסט באינסטגרם',
    fbPost: 'פוסט בפייסבוק',
    email: 'אימייל',
    printed: 'דפוס',
    footer: 'כל אחד נספר בנפרד, כדי שכרטיס הערוצים יגיד לכם מה עובד.',
    gotIt: 'הבנתי',
    plainCopy: 'רק להעתיק את הקישור',
    hide: 'הסתר',
    hintLabel: 'איך לשתף',
    waAsk: 'היי! יש מקום השבוע?',
    emailTo: 'אל: dana@example.com',
    emailSubject: 'בנוגע ל: זמינות',
    tagline: 'הדרכה וייעוץ',
  },
};

/**
 * The copy that changes with the link's purpose.
 *
 * Everything else — the steps, the panels, the chips — is identical, because
 * sharing a contact form and sharing a booking link are the same act. What
 * differs is what the owner would actually write beside it, and an example
 * reading "Book a time" under a contact form teaches the wrong sentence.
 */
const BOOKING_TEXT: Record<string, Record<string, string>> = {
  en: {
    waReply: 'Yes — pick a time here:',
    linkInBio: 'Booking for next month — link in bio',
    fbPostText: 'Now taking bookings for next month.',
    cta: 'Book a time',
    scan: 'Scan to book a time',
    emailBody: 'Happy to help — pick a slot that suits you.',
  },
  es: {
    waReply: 'Sí — elige una hora aquí:',
    linkInBio: 'Reservas para el próximo mes — enlace en la bio',
    fbPostText: 'Ya acepto reservas para el próximo mes.',
    cta: 'Reservar una hora',
    scan: 'Escanea para reservar',
    emailBody: 'Encantado de ayudarte — elige la hora que prefieras.',
  },
  he: {
    waReply: 'כן — בחרו שעה כאן:',
    linkInBio: 'פתוח להזמנות לחודש הבא — קישור בביו',
    fbPostText: 'פתוח להזמנות לחודש הבא.',
    cta: 'לקביעת תור',
    scan: 'סרקו לקביעת תור',
    emailBody: 'בשמחה — בחרו שעה שנוחה לכם.',
  },
};

const FORM_TEXT: Record<string, Record<string, string>> = {
  en: {
    waReply: 'Send me the details here:',
    linkInBio: 'Questions? The form is in my bio',
    fbPostText: 'Got a question? Send it over.',
    cta: 'Get in touch',
    scan: 'Scan to get in touch',
    emailBody: 'Happy to help — send me the details and I will come back to you.',
  },
  es: {
    waReply: 'Mándame los datos aquí:',
    linkInBio: '¿Dudas? El formulario está en mi bio',
    fbPostText: '¿Tienes una pregunta? Escríbeme.',
    cta: 'Contactar',
    scan: 'Escanea para contactar',
    emailBody: 'Encantado de ayudarte — mándame los datos y te respondo.',
  },
  he: {
    waReply: 'שלחו לי את הפרטים כאן:',
    linkInBio: 'שאלות? הטופס בביו',
    fbPostText: 'יש שאלה? שלחו לי.',
    cta: 'צרו קשר',
    scan: 'סרקו ליצירת קשר',
    emailBody: 'בשמחה — שלחו לי את הפרטים ואחזור אליכם.',
  },
};

export function ShareGuide({
  language,
  isRTL = false,
  shareDomain,
  kind = 'booking',
  code = '1el7ye',
  prefersReducedMotion = false,
}: ShareGuideProps) {
  const [dismissed, setDismissed] = useState(true);
  const [open, setOpen] = useState(false);
  const t = TEXT[language] || TEXT.en;
  const link = `${shareDomain || 'agentspilot.ai'}/go/${code}`;

  /*
   * The words that differ between a booking link and a contact form. Picked
   * here so the six panels below stay one shape — only their copy varies.
   */
  const v = kind === 'form' ? FORM_TEXT[language] || FORM_TEXT.en : BOOKING_TEXT[language] || BOOKING_TEXT.en;

  /*
   * `true` until the browser answers, not `false`.
   *
   * Rendering the guide and then hiding it is a flash of something the owner
   * already dismissed, on every page load. Hidden first, shown once storage
   * says it was never dismissed.
   */
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === '1');
    } catch {
      // Private browsing, or storage refused. Show it: a guide shown twice is
      // a smaller failure than one nobody can ever see.
      setDismissed(false);
    }
  }, []);

  /*
   * Dismissal closes the dialog AND retires the hint. "Got it" is a statement
   * about the guide, not about this dialog — reopening it tomorrow would make
   * the button a liar.
   */
  const dismiss = () => {
    setOpen(false);
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Nothing to do. It will return on the next load, which is survivable.
    }
  };

  if (dismissed) return null;

  const chip = (label: string, tone: 'yes' | 'no') => (
    <span
      className={`ms-auto shrink-0 whitespace-nowrap rounded-full px-1.5 py-px text-[9px] font-medium ${
        tone === 'yes'
          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
          : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
      }`}
    >
      {label}
    </span>
  );

  const panelHead = (icon: ReactNode, label: string, chipEl: ReactNode) => (
    <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-[var(--v2-text-primary)]">
      {icon}
      {label}
      {chipEl}
    </div>
  );

  return (
    <>
      {/*
        The hint. Small, and it pulses until it has been read — the animation
        is the only thing that makes an owner wonder what it is, and a static
        question mark beside four other icons is invisible.
      */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#8B5CF6]/40 bg-[#8B5CF6]/10 px-2.5 py-1 text-[11px] font-medium text-[#8B5CF6] transition-colors hover:bg-[#8B5CF6]/20 ${
          prefersReducedMotion ? '' : 'ap-attention'
        }`}
        title={t.title}
      >
        <Megaphone className="h-3 w-3" />
        {t.hintLabel}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          dir={isRTL ? 'rtl' : 'ltr'}
          className="w-[calc(100%-2rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[1100px] bg-[var(--v2-surface)] p-0"
        >
          <style jsx global>{`
        /* One pass, ending on step 3, which stays until dismissed. */
        .sg-scene { position: absolute; inset: 0; opacity: 0; animation-duration: 12s; animation-fill-mode: forwards; animation-timing-function: ease; }
        .sg-s1 { animation-name: sgS1; }
        .sg-s2 { animation-name: sgS2; }
        .sg-s3 { animation-name: sgS3; }
        @keyframes sgS1 { 0%,1% {opacity:0} 3%,30% {opacity:1} 34%,100% {opacity:0} }
        @keyframes sgS2 { 0%,34% {opacity:0} 38%,66% {opacity:1} 70%,100% {opacity:0} }
        @keyframes sgS3 { 0%,70% {opacity:0} 74%,100% {opacity:1} }

        .sg-pill { animation-duration: 12s; animation-fill-mode: forwards; }
        .sg-p1 { animation-name: sgP1; }
        .sg-p2 { animation-name: sgP2; }
        .sg-p3 { animation-name: sgP3; }
        @keyframes sgP1 { 0%,30% {background:#4F6EF7;color:#fff} 34%,100% {background:rgba(148,163,184,.18);color:#94A3B8} }
        @keyframes sgP2 { 0%,34% {background:rgba(148,163,184,.18);color:#94A3B8} 38%,66% {background:#4F6EF7;color:#fff} 70%,100% {background:rgba(148,163,184,.18);color:#94A3B8} }
        @keyframes sgP3 { 0%,70% {background:rgba(148,163,184,.18);color:#94A3B8} 74%,100% {background:#4F6EF7;color:#fff} }

        .sg-cursor { position: absolute; animation: sgCursor 12s forwards; }
        @keyframes sgCursor {
          0%,3% { transform: translate(-90px, 34px); opacity: 0; }
          8% { opacity: 1; }
          17% { transform: translate(0,0); opacity: 1; }
          20% { transform: translate(0,0) scale(.82); }
          23%,30% { transform: translate(0,0) scale(1); opacity: 1; }
          34%,100% { opacity: 0; }
        }
        .sg-press { animation: sgPress 12s forwards; }
        @keyframes sgPress { 0%,19% {transform:scale(1)} 21% {transform:scale(.95)} 24%,100% {transform:scale(1)} }

        .sg-menu { animation: sgMenu 12s forwards; transform-origin: top right; }
        @keyframes sgMenu {
          0%,35% { opacity: 0; transform: translateY(-6px) scale(.97); }
          39%,66% { opacity: 1; transform: translateY(0) scale(1); }
          70%,100% { opacity: 0; }
        }
        .sg-wa { animation: sgWa 12s forwards; }
        @keyframes sgWa { 0%,45% {background:transparent} 49%,66% {background:rgba(37,211,102,.10)} 70%,100% {background:transparent} }
        .sg-tick { animation: sgTick 12s forwards; }
        @keyframes sgTick { 0%,48% {opacity:0;transform:scale(.6)} 52%,66% {opacity:1;transform:scale(1)} 70%,100% {opacity:0} }

        .sg-land { animation: sgLand 12s forwards; opacity: 0; }
        .sg-l2 { animation-delay: .3s; }
        .sg-l3 { animation-delay: .6s; }
        .sg-l4 { animation-delay: .9s; }
        .sg-l5 { animation-delay: 1.2s; }
        .sg-l6 { animation-delay: 1.5s; }
        @keyframes sgLand { 0%,73% {opacity:0;transform:translateY(7px)} 78%,100% {opacity:1;transform:translateY(0)} }

        .sg-done { animation: sgDone 12s forwards; opacity: 0; }
        @keyframes sgDone { 0%,84% {opacity:0} 90%,100% {opacity:1} }

        /* Motion is decoration. Without it the steps stack and all read at once. */
        @media (prefers-reduced-motion: reduce) {
          .sg-scene, .sg-pill, .sg-cursor, .sg-press, .sg-menu, .sg-wa, .sg-tick, .sg-land, .sg-done { animation: none !important; }
          .sg-scene { position: relative; opacity: 1; }
          .sg-cursor { display: none; }
          .sg-land, .sg-done { opacity: 1; transform: none; }
          .sg-stage { height: auto !important; display: flex; flex-direction: column; gap: 16px; }
        }
      `}</style>

          <DialogHeader className="border-b border-[var(--v2-border)] px-5 py-4 text-start">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <Megaphone className="h-4 w-4 shrink-0 text-[#8B5CF6]" />
                <div className="min-w-0">
                  <DialogTitle className="truncate text-sm font-semibold text-[var(--v2-text-primary)]">
                    {t.title}
                  </DialogTitle>
                  <DialogDescription className="truncate text-xs text-[var(--v2-text-secondary)]">
                    {t.subtitle}
                  </DialogDescription>
                </div>
              </div>
              {/* The step pills keep the reader's place; the dialog's own close
                  button sits to their right, so no second X here. */}
              <div className="hidden shrink-0 gap-1.5 pe-6 sm:flex">
                {['sg-p1', 'sg-p2', 'sg-p3'].map((cls, i) => (
                  <span key={cls} className={`sg-pill ${cls} rounded-full px-2 py-0.5 text-[11px] font-semibold`}>
                    {i + 1}
                  </span>
                ))}
              </div>
            </div>
          </DialogHeader>

      {/* Stage */}
      <div className="sg-stage relative h-[560px] sm:h-[544px]">
        {/* ── Step 1 ─────────────────────────────────────────────────── */}
        <div className="sg-scene sg-s1 p-4">
          <p className="mb-3 text-xs text-[var(--v2-text-secondary)]">
            <b className="text-[var(--v2-text-primary)]">1.</b> {t.step1}
          </p>
          <div className="flex items-center gap-4 rounded-[14px] border border-[var(--v2-border)] bg-[var(--v2-surface)] px-4 py-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: 'rgba(79,110,247,0.1)' }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#4F6EF7" strokeWidth="2" strokeLinecap="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.5-1.5" /></svg>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-[var(--v2-text-primary)]">Booking Link</span>
                <span className="rounded bg-green-100 px-2 py-px text-[11px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">Live</span>
              </div>
              <div className="mt-0.5 text-xs text-[var(--v2-text-muted)]">/go/1el7ye</div>
            </div>
            <div className="relative ms-auto">
              <div className="sg-press inline-flex items-center gap-1.5 rounded-[10px] border border-[#4F6EF7] bg-[#4F6EF7]/10 px-3.5 py-1.5 text-[13px] font-medium text-[#4F6EF7]">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></svg>
                Share
              </div>
              <div className="sg-cursor" style={{ left: 44, top: 20 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="#1F2937" stroke="#FFFFFF" strokeWidth="1.4"><path d="M5 2l7 18 2.5-7.5L22 10z" /></svg>
              </div>
            </div>
          </div>
        </div>

        {/* ── Step 2 ─────────────────────────────────────────────────── */}
        <div className="sg-scene sg-s2 p-4">
          <p className="mb-3 text-xs text-[var(--v2-text-secondary)]">
            <b className="text-[var(--v2-text-primary)]">2.</b> {t.step2}
          </p>
          <div className="flex justify-end">
            <div className="sg-menu w-[262px] rounded-[14px] border border-[var(--v2-border)] bg-[var(--v2-surface)] p-1.5 shadow-lg">
              <div className="sg-wa flex items-center gap-2.5 rounded-[9px] px-3 py-2">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="#25D366"><path d="M12 2a10 10 0 0 0-8.5 15.2L2 22l4.9-1.5A10 10 0 1 0 12 2Zm0 18.2c-1.6 0-3.1-.4-4.4-1.2l-.3-.2-3 .9.9-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Z" /></svg>
                <span className="flex-1 text-[13.5px] text-[var(--v2-text-primary)]">{t.whatsapp}</span>
                <svg className="sg-tick" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#22C55E" strokeWidth="3" strokeLinecap="round"><path d="M20 6 9 17l-5-5" /></svg>
              </div>
              {[
                { label: t.igBio, fill: '#E4405F', d: 'M12 7.3a4.7 4.7 0 1 1 0 9.4 4.7 4.7 0 0 1 0-9.4Zm0 7.7a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm6-7.9a1.1 1.1 0 1 1-2.2 0 1.1 1.1 0 0 1 2.2 0ZM12 4c-2.6 0-2.9 0-3.9.1-1 0-1.6.2-2 .4-.5.2-.9.4-1.3.8-.4.4-.6.8-.8 1.3-.2.4-.3 1-.4 2-.1 1-.1 1.3-.1 3.4s0 2.4.1 3.4c0 1 .2 1.6.4 2 .2.5.4.9.8 1.3.4.4.8.6 1.3.8.4.2 1 .3 2 .4 1 0 1.3.1 3.9.1s2.9 0 3.9-.1c1 0 1.6-.2 2-.4.5-.2.9-.4 1.3-.8.4-.4.6-.8.8-1.3.2-.4.3-1 .4-2 0-1 .1-1.3.1-3.4s0-2.4-.1-3.4c0-1-.2-1.6-.4-2a3.5 3.5 0 0 0-.8-1.3 3.5 3.5 0 0 0-1.3-.8c-.4-.2-1-.3-2-.4C14.9 4 14.6 4 12 4Z' },
                { label: t.fbPost, fill: '#1877F2', d: 'M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.4h-1.2c-1.2 0-1.6.8-1.6 1.6V12h2.7l-.4 2.9h-2.3v7A10 10 0 0 0 22 12Z' },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-2.5 px-3 py-2">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill={item.fill}><path d={item.d} /></svg>
                  <span className="flex-1 text-[13.5px] text-[var(--v2-text-primary)]">{item.label}</span>
                </div>
              ))}
              <div className="flex items-center gap-2.5 px-3 py-2">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m2 7 10 6 10-6" /></svg>
                <span className="flex-1 text-[13.5px] text-[var(--v2-text-primary)]">{t.email}</span>
              </div>
              <div className="mx-3 my-1 h-px bg-[var(--v2-border)]" />
              <div className="flex items-center gap-2.5 px-3 py-2">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                <span className="flex-1 text-[13.5px] text-[var(--v2-text-secondary)]">{t.plainCopy}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Step 3 ─────────────────────────────────────────────────── */}
        <div className="sg-scene sg-s3 p-4">
          <p className="mb-2.5 text-xs text-[var(--v2-text-secondary)]">
            <b className="text-[var(--v2-text-primary)]">3.</b> {t.step3}
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {/* WhatsApp */}
            <div className="sg-land">
              {panelHead(
                <svg width="13" height="13" viewBox="0 0 24 24" fill="#25D366"><path d="M12 2a10 10 0 0 0-8.5 15.2L2 22l4.9-1.5A10 10 0 1 0 12 2Zm0 18.2c-1.6 0-3.1-.4-4.4-1.2l-.3-.2-3 .9.9-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Z" /></svg>,
                t.whatsapp,
                chip(t.canClick, 'yes')
              )}
              <div className="flex h-[196px] flex-col overflow-hidden rounded-[11px] border border-[#D8DADE]" style={{ background: '#ECE5DD' }}>
                <div className="flex items-center gap-2 px-2.5 py-2" style={{ background: '#075E54' }}>
                  <div className="h-5 w-5 rounded-full" style={{ background: '#B9C4C2' }} />
                  <span className="text-[10.5px] font-medium text-white">Dana Levi</span>
                </div>
                <div className="flex flex-1 flex-col justify-end gap-1.5 p-2.5">
                  <div className="max-w-[80%] self-start rounded-lg rounded-bl-sm bg-white px-2 py-1.5">
                    <p className="text-[10px] text-[#1F2937]">{t.waAsk}</p>
                  </div>
                  <div className="max-w-[88%] self-end rounded-lg rounded-br-sm px-2 py-1.5" style={{ background: '#DCF8C6' }}>
                    <p className="text-[10px] text-[#1F2937]">{v.waReply}</p>
                    <p className="mt-0.5 break-all text-[10px] text-[#1B7F4B]">{link}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1.5" style={{ background: '#F0F0F0' }}>
                  <div className="h-4 flex-1 rounded-full bg-white" />
                  <div className="h-4 w-4 rounded-full" style={{ background: '#25D366' }} />
                </div>
              </div>
            </div>

            {/* Instagram bio */}
            <div className="sg-land sg-l2">
              {panelHead(
                <svg width="13" height="13" viewBox="0 0 24 24" fill="#E4405F"><path d="M12 7.3a4.7 4.7 0 1 1 0 9.4 4.7 4.7 0 0 1 0-9.4Zm0 7.7a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm6-7.9a1.1 1.1 0 1 1-2.2 0 1.1 1.1 0 0 1 2.2 0ZM12 4c-2.6 0-2.9 0-3.9.1-1 0-1.6.2-2 .4-.5.2-.9.4-1.3.8-.4.4-.6.8-.8 1.3-.2.4-.3 1-.4 2-.1 1-.1 1.3-.1 3.4s0 2.4.1 3.4c0 1 .2 1.6.4 2 .2.5.4.9.8 1.3.4.4.8.6 1.3.8.4.2 1 .3 2 .4 1 0 1.3.1 3.9.1s2.9 0 3.9-.1c1 0 1.6-.2 2-.4.5-.2.9-.4 1.3-.8.4-.4.6-.8.8-1.3.2-.4.3-1 .4-2 0-1 .1-1.3.1-3.4s0-2.4-.1-3.4c0-1-.2-1.6-.4-2a3.5 3.5 0 0 0-.8-1.3 3.5 3.5 0 0 0-1.3-.8c-.4-.2-1-.3-2-.4C14.9 4 14.6 4 12 4Z" /></svg>,
                t.igBio,
                chip(t.canClick, 'yes')
              )}
              <div className="h-[196px] overflow-hidden rounded-[11px] border border-[#DBDBDB] bg-white p-3">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full p-0.5" style={{ background: 'linear-gradient(135deg,#FEDA75,#D62976,#4F5BD5)' }}>
                    <div className="h-full w-full rounded-full" style={{ background: '#E9E9E9' }} />
                  </div>
                  <div className="flex gap-3.5">
                    <div className="text-center"><div className="text-[11px] font-bold text-[#1F2937]">248</div><div className="text-[9px] text-[#8E8E8E]">posts</div></div>
                    <div className="text-center"><div className="text-[11px] font-bold text-[#1F2937]">1,412</div><div className="text-[9px] text-[#8E8E8E]">followers</div></div>
                  </div>
                </div>
                <div className="mt-2.5 text-[10.5px] font-semibold text-[#1F2937]">davidkpmg</div>
                <div className="mt-0.5 text-[10px] leading-snug text-[#1F2937]">{t.tagline}</div>
                <div className="mt-0.5 break-all text-[10px] text-[#00376B]">{link}</div>
                <div className="mt-2.5 flex gap-1.5">
                  <div className="h-5 flex-1 rounded-md border border-[#DBDBDB]" />
                  <div className="h-5 flex-1 rounded-md border border-[#DBDBDB]" />
                </div>
              </div>
            </div>

            {/* Instagram post — the one that cannot be clicked */}
            <div className="sg-land sg-l3">
              {panelHead(
                <svg width="13" height="13" viewBox="0 0 24 24" fill="#E4405F"><path d="M12 7.3a4.7 4.7 0 1 1 0 9.4 4.7 4.7 0 0 1 0-9.4Zm0 7.7a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm6-7.9a1.1 1.1 0 1 1-2.2 0 1.1 1.1 0 0 1 2.2 0ZM12 4c-2.6 0-2.9 0-3.9.1-1 0-1.6.2-2 .4-.5.2-.9.4-1.3.8-.4.4-.6.8-.8 1.3-.2.4-.3 1-.4 2-.1 1-.1 1.3-.1 3.4s0 2.4.1 3.4c0 1 .2 1.6.4 2 .2.5.4.9.8 1.3.4.4.8.6 1.3.8.4.2 1 .3 2 .4 1 0 1.3.1 3.9.1s2.9 0 3.9-.1c1 0 1.6-.2 2-.4.5-.2.9-.4 1.3-.8.4-.4.6-.8.8-1.3.2-.4.3-1 .4-2 0-1 .1-1.3.1-3.4s0-2.4-.1-3.4c0-1-.2-1.6-.4-2a3.5 3.5 0 0 0-.8-1.3 3.5 3.5 0 0 0-1.3-.8c-.4-.2-1-.3-2-.4C14.9 4 14.6 4 12 4Z" /></svg>,
                t.igPost,
                chip(t.cannotClick, 'no')
              )}
              <div className="flex h-[196px] flex-col overflow-hidden rounded-[11px] border border-[#DBDBDB] bg-white">
                <div className="flex items-center gap-2 px-2.5 py-2">
                  <div className="h-5 w-5 rounded-full" style={{ background: 'linear-gradient(135deg,#FEDA75,#D62976,#4F5BD5)' }} />
                  <span className="text-[10px] font-semibold text-[#1F2937]">davidkpmg</span>
                </div>
                <div className="flex-1" style={{ background: '#EFEFEF' }} />
                <div className="px-2.5 py-2">
                  <div className="mb-1 flex gap-2">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1F2937" strokeWidth="1.7"><path d="M20.8 6.6a5 5 0 0 0-8.8-2 5 5 0 1 0-8.8 5L12 21l8.8-11.4a5 5 0 0 0 0-3Z" /></svg>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1F2937" strokeWidth="1.7"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.8 8.8 0 0 1-3.8-.9L3 21l1.9-5A8.4 8.4 0 1 1 21 11.5Z" /></svg>
                  </div>
                  <p className="text-[9.5px] leading-snug text-[#1F2937]">{v.linkInBio}</p>
                </div>
              </div>
            </div>

            {/* Facebook */}
            <div className="sg-land sg-l4">
              {panelHead(
                <svg width="13" height="13" viewBox="0 0 24 24" fill="#1877F2"><path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.4h-1.2c-1.2 0-1.6.8-1.6 1.6V12h2.7l-.4 2.9h-2.3v7A10 10 0 0 0 22 12Z" /></svg>,
                t.fbPost,
                chip(t.canClick, 'yes')
              )}
              <div className="h-[196px] overflow-hidden rounded-[11px] border border-[#DDDFE2] bg-white p-2.5">
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-full" style={{ background: '#E4E6EB' }} />
                  <div>
                    <div className="text-[10px] font-semibold text-[#050505]">David KPMG</div>
                    <div className="text-[9px] text-[#65676B]">2h · Public</div>
                  </div>
                </div>
                <p className="mt-2 text-[10px] leading-snug text-[#050505]">{v.fbPostText}</p>
                <p className="mt-0.5 break-all text-[10px] text-[#1877F2]">{link}</p>
                <div className="mt-2 overflow-hidden rounded-md border border-[#DDDFE2]">
                  <div className="h-[30px]" style={{ background: '#E4E6EB' }} />
                  <div className="px-2 py-1" style={{ background: '#F0F2F5' }}>
                    <div className="text-[8px] uppercase tracking-wide text-[#65676B]">{(shareDomain || 'agentspilot.ai').toUpperCase()}</div>
                    <div className="text-[9.5px] font-semibold text-[#050505]">{v.cta}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Email */}
            <div className="sg-land sg-l5">
              {panelHead(
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m2 7 10 6 10-6" /></svg>,
                t.email,
                chip(t.canClick, 'yes')
              )}
              <div className="flex h-[196px] flex-col overflow-hidden rounded-[11px] border border-[#DADCE0] bg-white">
                <div className="border-b border-[#F1F3F4] px-2.5 py-2">
                  <div className="text-[9.5px] text-[#5F6368]">{t.emailTo}</div>
                  <div className="mt-0.5 text-[10px] font-medium text-[#202124]">{t.emailSubject}</div>
                </div>
                <div className="flex flex-1 flex-col p-2.5">
                  <p className="text-[10px] leading-relaxed text-[#202124]">{v.emailBody}</p>
                  <div className="mt-auto border-s-2 border-[#DADCE0] ps-2.5">
                    <div className="text-[10px] font-semibold text-[#202124]">David KPMG</div>
                    <div className="mt-px text-[9px] text-[#5F6368]">{t.tagline}</div>
                    <div className="mt-0.5 break-all text-[9.5px] text-[#1A73E8]">{link}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Printed */}
            <div className="sg-land sg-l6">
              {panelHead(
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3zM18 18h3v3h-3z" /></svg>,
                t.printed,
                chip(t.canScan, 'yes')
              )}
              <div className="flex h-[196px] flex-col items-center justify-center overflow-hidden rounded-[11px] border border-[var(--v2-border)] bg-white p-3 text-center">
                <div className="text-[11px] font-semibold tracking-wide text-[#1F2937]">DAVID KPMG</div>
                <div className="mt-0.5 text-[9px] text-[#9CA3AF]">{t.tagline}</div>
                <div className="my-2 rounded-lg border border-[#E5E7EB] p-1.5">
                  <svg width="58" height="58" viewBox="0 0 24 24" fill="none" stroke="#1F2937" strokeWidth="1.5">
                    <rect x="2.5" y="2.5" width="6.5" height="6.5" rx="1" /><rect x="15" y="2.5" width="6.5" height="6.5" rx="1" /><rect x="2.5" y="15" width="6.5" height="6.5" rx="1" />
                    <path d="M5 5h1.5v1.5H5zM17.5 5H19v1.5h-1.5zM5 17.5h1.5V19H5z" fill="#1F2937" />
                    <path d="M12 3v3M12 9v2M15 12h2M12 15v2M19 12v2M12 20v1.5M15.5 15.5h2v2h-2zM19 19h2.5v2.5H19z" />
                  </svg>
                </div>
                <div className="text-[9.5px] text-[#6B7280]">{v.scan}</div>
              </div>
            </div>
          </div>

          <div className="sg-done mt-3 flex items-center gap-3 rounded-[11px] border border-[var(--v2-border)] bg-[var(--v2-surface)] py-2 pe-2 ps-3">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#22C58B" strokeWidth="2.4" strokeLinecap="round" className="shrink-0"><path d="M20 6 9 17l-5-5" /></svg>
            <span className="text-xs text-[var(--v2-text-secondary)]">{t.footer}</span>
            <button
              type="button"
              onClick={dismiss}
              className="ms-auto shrink-0 rounded-[9px] bg-[#4F6EF7] px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-[#3B5AE5]"
            >
              {t.gotIt}
            </button>
          </div>
        </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
