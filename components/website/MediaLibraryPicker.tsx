'use client';

/**
 * Pick a picture the business already has.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Pictures are now chosen for a business when its site is generated, and stored
 * as its own. Without somewhere to see them, that ownership is theoretical: the
 * owner could only ever replace a picture by finding a new one, and a photograph
 * already paid for and already approved for the landing page could not be reused
 * on the website.
 *
 * It also matters for the commonest edit there is. Swapping a stock hero for
 * their own photograph is the single most valuable change an owner can make, and
 * they will only make it if the alternatives are in front of them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE SLOT IS PASSED IN
 *
 * A hero crop is not a team portrait. The list is ordered so pictures chosen for
 * this kind of section come first — but every picture is still offered, because
 * an owner who wants their gallery photograph in the hero should not have to
 * argue with a filter to do it.
 *
 * @module components/website/MediaLibraryPicker
 */

import { useCallback, useEffect, useState } from 'react';
import { ImageIcon, Loader2, Sparkles, X } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';

interface LibraryItem {
  id: string;
  url: string;
  description: string | null;
  section: string | null;
  aspect: string | null;
  source: 'stock' | 'generated' | 'upload';
}

interface MediaLibraryPickerProps {
  /** The slot being filled, so its own pictures are offered first. */
  section?: string;
  /** The crop this slot needs, so a generated picture is the right shape. */
  aspect?: 'wide' | 'portrait' | 'square';
  /** Opened from the Generate button: put the cursor in the prompt. */
  focusGenerate?: boolean;
  onSelect: (url: string) => void;
  onClose: () => void;
}

export function MediaLibraryPicker({
  section,
  aspect = 'wide',
  focusGenerate = false,
  onSelect,
  onClose,
}: MediaLibraryPickerProps) {
  const { t, isRTL } = useLanguage();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  // Distinct from an empty library: "we could not read it" sends the owner to
  // a different action than "you have not added one yet".
  const [unavailable, setUnavailable] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const query = section ? `?section=${encodeURIComponent(section)}` : '';
      const response = await fetch(`/api/website/media${query}`);
      const result = await response.json();
      if (result.success) {
        setItems(result.data as LibraryItem[]);
      } else {
        setUnavailable(true);
        setItems([]);
      }
    } catch {
      // An empty library and a failed request look the same to the owner, and
      // there is nothing useful for them to do about either — the upload and
      // URL paths beside this one still work.
      setUnavailable(true);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [section]);

  useEffect(() => {
    void load();
  }, [load]);

  const sourceLabel = (source: LibraryItem['source']) =>
    t(`media.library.source_${source}`);

  /*
   * Generation is the fallback, not the default.
   *
   * Stock covers the common case for free and in a fifth of a second; this is
   * for what stock cannot give. A generated picture lands in the library like
   * any other, so it can be reused on another page without being paid for again.
   */
  const generate = async () => {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setGenerateError(null);

    try {
      const response = await fetch('/api/website/media/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), aspect, section }),
      });
      const result = await response.json();

      if (result.success) {
        onSelect(result.data.url as string);
        onClose();
        return;
      }
      setGenerateError(t(`media.generate.${result.reason ?? 'failed'}`));
    } catch {
      setGenerateError(t('media.generate.failed'));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div
      dir={isRTL ? 'rtl' : 'ltr'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-3xl max-h-[80vh] overflow-hidden rounded-2xl bg-[var(--v2-surface)] border border-[var(--v2-border)] shadow-2xl flex flex-col"
        onClick={event => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('media.library.title')}
      >
        <div className="flex items-start justify-between gap-4 p-5 border-b border-[var(--v2-border)]">
          <div>
            <h2 className="text-base font-semibold text-[var(--v2-text-primary)]">
              {t('media.library.title')}
            </h2>
            <p className="mt-1 text-sm text-[var(--v2-text-muted)]">
              {t('media.library.subtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--v2-text-muted)] hover:bg-[var(--v2-surface-2)] transition-colors"
            aria-label={t('media.library.close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-[var(--v2-text-muted)]">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">{t('media.library.loading')}</span>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-[var(--v2-text-muted)]">
              <ImageIcon className="w-8 h-8" />
              <p className="text-sm text-center max-w-xs">
                {t(unavailable ? 'media.library.unavailable' : 'media.library.empty')}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {items.map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onSelect(item.url);
                    onClose();
                  }}
                  className="group relative aspect-[4/3] overflow-hidden rounded-xl border border-[var(--v2-border)] hover:border-[#4F6EF7] transition-colors"
                  title={item.description ?? ''}
                >
                  <img
                    src={item.url}
                    alt={item.description ?? ''}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                  <span className="absolute top-1.5 start-1.5 px-1.5 py-0.5 rounded-md bg-black/60 text-white text-[10px] font-medium">
                    {sourceLabel(item.source)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-[var(--v2-border)] p-5 space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={prompt}
              onChange={event => setPrompt(event.target.value)}
              placeholder={t('media.generate.prompt')}
              maxLength={300}
              disabled={generating}
              autoFocus={focusGenerate}
              className="flex-1 px-3 py-2 bg-[var(--v2-surface-2)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void generate();
                }
              }}
            />
            <button
              type="button"
              onClick={() => void generate()}
              disabled={!prompt.trim() || generating}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[#4F6EF7] text-white text-sm hover:bg-[#3B5AE5] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {generating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t('media.generate.working')}
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  {t('media.generate.action')}
                </>
              )}
            </button>
          </div>
          {generateError && <p className="text-sm text-red-500">{generateError}</p>}
        </div>
      </div>
    </div>
  );
}

export default MediaLibraryPicker;
