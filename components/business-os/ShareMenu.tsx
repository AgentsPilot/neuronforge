'use client';

/**
 * "Where are you posting this?" — asked without ever saying UTM.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS A SHARE MENU AND NOT A SETTING
 *
 * The obvious design is a field on the link: source, medium, campaign. Those
 * columns exist on `smart_links` already and every row in production has them
 * empty, because a small-business owner has no reason to know what a UTM is and
 * no product ever asked them in words they recognise.
 *
 * The next design is to ask at the copy button — "where are you sharing this?".
 * That fails for a duller reason: the owner copies ONCE and pastes in five
 * places over the next month. A question answered at copy time is answered once
 * and wrong thereafter.
 *
 * So nothing is asked. The owner clicks WhatsApp because they are about to post
 * it to WhatsApp, and gets a WhatsApp-tagged link on the clipboard. Choosing the
 * destination IS the answer, and it can be given again tomorrow for a different
 * one.
 *
 * Every item copies; none navigates. Opening WhatsApp Web or a mail client
 * sounds helpful and is not — the owner is already where they meant to post,
 * with the message half written.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * "JUST COPY THE LINK" IS LOAD-BEARING
 *
 * It must stay, and it must not be buried. Forcing a choice to obtain a link
 * would trade a small gap in attribution for friction on the one action that
 * matters — and an owner who cannot get their link quickly will get it from the
 * browser bar instead, which is untagged anyway.
 *
 * @module components/business-os/ShareMenu
 */

import { useEffect, useRef, useState } from 'react';
import { Copy, Check, Mail, QrCode, Share2 } from 'lucide-react';
import {
  SHARE_DESTINATIONS,
  shareUrlFor,
  shareUrlForPage,
  type ShareVariant,
} from '@/lib/business-os/channel-insights/shareDestinations';

interface ShareMenuProps {
  /**
   * A smart link's code, for `/go/{code}?v=…`, or an absolute page URL for a
   * website or landing page. Exactly one.
   *
   * They differ because only the smart link has a redirect to expand the short
   * code; a page the visitor reaches directly must carry the real parameters.
   */
  target: { kind: 'smart_link'; code: string } | { kind: 'page'; url: string };
  /** What is being shared, for the menu's heading. */
  title: string;
  language: string;
  isRTL?: boolean;
  /** Rendered as the trigger. Defaults to a labelled Share button. */
  compact?: boolean;
}

/**
 * Brand marks, drawn rather than imported.
 *
 * lucide dropped brand glyphs, and these five are recognised before their label
 * is read — which is the whole point of a menu someone should be able to use
 * without stopping to think.
 */
const BRAND_PATHS: Partial<Record<ShareVariant, { path: string; color: string }>> = {
  wa: {
    color: '#25D366',
    path: 'M12 2a10 10 0 0 0-8.5 15.2L2 22l4.9-1.5A10 10 0 1 0 12 2Zm0 18.2c-1.6 0-3.1-.4-4.4-1.2l-.3-.2-3 .9.9-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.6-5.6c-.3-.2-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.1-.2 0-.4.1-.5l.4-.5.2-.4v-.4l-.8-1.9c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.4.1-.6.3-.2.2-.8.8-.8 2s.9 2.4 1 2.6c.1.2 1.8 2.8 4.4 3.9 1.6.7 2.2.7 3 .6.5 0 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2l-.4-.2Z',
  },
  ig: {
    color: '#E4405F',
    path: 'M12 2.2c3.2 0 3.6 0 4.9.1 1.2 0 1.8.2 2.2.4.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.2.4.4 1 .4 2.2.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c0 1.2-.2 1.8-.4 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1 .4-2.2.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2 0-1.8-.2-2.2-.4-.6-.2-1-.5-1.4-.9-.4-.4-.7-.8-.9-1.4-.2-.4-.4-1-.4-2.2-.1-1.3-.1-1.7-.1-4.9s0-3.6.1-4.9c0-1.2.2-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1-.4 2.2-.4 1.3-.1 1.7-.1 4.9-.1Zm0 1.8c-3.1 0-3.5 0-4.8.1-.9 0-1.4.2-1.7.3-.4.2-.7.4-1 .7-.3.3-.5.6-.7 1-.1.3-.3.8-.3 1.7-.1 1.3-.1 1.7-.1 4.8s0 3.5.1 4.8c0 .9.2 1.4.3 1.7.2.4.4.7.7 1 .3.3.6.5 1 .7.3.1.8.3 1.7.3 1.3.1 1.7.1 4.8.1s3.5 0 4.8-.1c.9 0 1.4-.2 1.7-.3.4-.2.7-.4 1-.7.3-.3.5-.6.7-1 .1-.3.3-.8.3-1.7.1-1.3.1-1.7.1-4.8s0-3.5-.1-4.8c0-.9-.2-1.4-.3-1.7-.2-.4-.4-.7-.7-1-.3-.3-.6-.5-1-.7-.3-.1-.8-.3-1.7-.3-1.3-.1-1.7-.1-4.8-.1Zm0 3.1a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 8.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Zm6.4-8.4a1.2 1.2 0 1 1-2.3 0 1.2 1.2 0 0 1 2.3 0Z',
  },
  fb: {
    color: '#1877F2',
    path: 'M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.4h-1.2c-1.2 0-1.6.8-1.6 1.6V12h2.7l-.4 2.9h-2.3v7A10 10 0 0 0 22 12Z',
  },
};

const TEXT: Record<string, Record<string, string>> = {
  en: {
    share: 'Share',
    heading: 'Share',
    hint: "Copy a link for where you're posting it, and you'll see which one brings clients.",
    plain: 'Just copy the link',
    copied: 'Copied',
  },
  es: {
    share: 'Compartir',
    heading: 'Compartir',
    hint: 'Copia un enlace para donde lo vas a publicar, y verás cuál te trae clientes.',
    plain: 'Solo copiar el enlace',
    copied: 'Copiado',
  },
  he: {
    share: 'שיתוף',
    heading: 'שיתוף',
    hint: 'העתיקו קישור למקום שבו אתם מפרסמים, ותראו מה מביא לקוחות.',
    plain: 'רק להעתיק את הקישור',
    copied: 'הועתק',
  },
};

const LABELS: Record<ShareVariant, Record<string, string>> = {
  wa: { en: 'WhatsApp', es: 'WhatsApp', he: 'וואטסאפ' },
  ig: { en: 'Instagram', es: 'Instagram', he: 'אינסטגרם' },
  fb: { en: 'Facebook', es: 'Facebook', he: 'פייסבוק' },
  em: { en: 'Email', es: 'Correo', he: 'אימייל' },
  qr: { en: 'Printed / QR code', es: 'Impreso / código QR', he: 'דפוס / קוד QR' },
};

export function ShareMenu({ target, title, language, isRTL = false, compact = false }: ShareMenuProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<ShareVariant | 'plain' | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const t = TEXT[language] || TEXT.en;

  // Close on an outside click or Escape — a menu that traps the page is worse
  // than no menu.
  useEffect(() => {
    if (!open) return;

    const onPointer = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const urlFor = (variant: ShareVariant | null) =>
    target.kind === 'smart_link'
      ? shareUrlFor(window.location.origin, target.code, variant)
      : shareUrlForPage(target.url, variant);

  const copy = async (variant: ShareVariant | 'plain') => {
    const url = urlFor(variant === 'plain' ? null : variant);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(variant);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      // A clipboard the browser refused. Nothing useful to say; the menu stays
      // open so the owner can try the plain link.
    }
  };

  /*
   * Every destination copies. None of them navigates.
   * ───────────────────────────────────────────────────────────────────────────
   * WhatsApp opened wa.me and email opened a mail client, which sounds helpful
   * and is not: the owner is usually already somewhere else with the post half
   * written, and being thrown into WhatsApp Web mid-task is an interruption
   * they did not ask for. What they wanted was the link.
   *
   * So the destination now chooses the TAG, not the journey. Pick WhatsApp,
   * get a WhatsApp-tagged link on the clipboard, paste it wherever you were
   * going anyway.
   */
  const choose = (variant: ShareVariant) => {
    void copy(variant);
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={
          compact
            ? 'p-1.5 text-[var(--v2-text-muted)] hover:text-[#4F6EF7] transition-colors'
            : 'inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-[#4F6EF7] border border-[#4F6EF7] bg-[#4F6EF7]/[0.08] hover:bg-[#4F6EF7]/[0.15] transition-colors'
        }
        style={compact ? undefined : { borderRadius: '10px' }}
        title={t.share}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Share2 className="h-4 w-4" />
        {!compact && t.share}
      </button>

      {open && (
        <div
          role="menu"
          dir={isRTL ? 'rtl' : 'ltr'}
          className={`absolute z-50 mt-2 w-[270px] bg-[var(--v2-surface)] border border-[var(--v2-border)] p-2 shadow-lg ${isRTL ? 'start-0' : 'end-0'}`}
          style={{ borderRadius: '14px' }}
        >
          <div className="px-3 pt-2 pb-2.5">
            <p className="text-[13px] font-semibold text-[var(--v2-text-primary)] truncate">{title}</p>
            <p className="text-[12px] text-[var(--v2-text-muted)] mt-1 leading-snug">{t.hint}</p>
          </div>

          {SHARE_DESTINATIONS.map(destination => {
            const brand = BRAND_PATHS[destination.variant];
            const label = LABELS[destination.variant]?.[language] || LABELS[destination.variant]?.en || destination.labelEn;
            const justCopied = copied === destination.variant;

            return (
              <button
                key={destination.variant}
                type="button"
                role="menuitem"
                onClick={() => choose(destination.variant)}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-[10px] hover:bg-[var(--v2-bg)] transition-colors text-start"
              >
                {brand ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill={brand.color} aria-hidden="true" className="shrink-0">
                    <path d={brand.path} />
                  </svg>
                ) : destination.variant === 'em' ? (
                  <Mail className="h-[18px] w-[18px] text-[var(--v2-text-secondary)] shrink-0" />
                ) : (
                  <QrCode className="h-[18px] w-[18px] text-[var(--v2-text-secondary)] shrink-0" />
                )}
                <span className="text-sm text-[var(--v2-text-primary)] flex-1">{label}</span>
                {justCopied && <Check className="h-4 w-4 text-green-500 shrink-0" />}
              </button>
            );
          })}

          <div className="h-px bg-[var(--v2-border)] mx-3 my-1.5" />

          <button
            type="button"
            role="menuitem"
            onClick={() => copy('plain')}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-[10px] hover:bg-[var(--v2-bg)] transition-colors text-start"
          >
            <Copy className="h-[18px] w-[18px] text-[var(--v2-text-muted)] shrink-0" />
            <span className="text-sm text-[var(--v2-text-secondary)] flex-1">{t.plain}</span>
            {copied === 'plain' && <Check className="h-4 w-4 text-green-500 shrink-0" />}
          </button>
        </div>
      )}
    </div>
  );
}
