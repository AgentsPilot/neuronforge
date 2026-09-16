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

import { useCallback, useEffect, useRef, useState } from 'react';
import { ImageIcon, Loader2, Sparkles, Upload, X } from 'lucide-react';
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
  /*
   * How many generations are left today.
   *
   * Held here and refreshed from every answer the server gives, because a
   * picture can be generated from this picker on any block, on any page, and
   * from the wizard. A count this component worked out for itself would be
   * wrong the moment a second surface was used; the server is the only place
   * that knows.
   *
   * `null` means not yet known or not readable — the row simply is not drawn,
   * rather than promising an allowance nobody has verified.
   */
  const [allowance, setAllowance] = useState<{ used: number; limit: number; remaining: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // The picture just added, so it can be pointed at in a grid it has only just
  // joined — the owner needs to find it before they can choose it.
  const [justAdded, setJustAdded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const query = section ? `?section=${encodeURIComponent(section)}` : '';
      const response = await fetch(`/api/website/media${query}`);
      const result = await response.json();
      if (result.success) {
        setItems(result.data as LibraryItem[]);
        if (result.allowance) setAllowance(result.allowance);
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
   * THE OWNER'S OWN PHOTOGRAPH, FROM INSIDE THE PICKER.
   *
   * This offered a business its existing pictures and offered to generate a new
   * one, and had no way to add a file. An owner looking at a stock photo of
   * somebody else's treatment room, holding a photograph of their own, had to
   * close the picker to use it — which is the single most valuable edit anyone
   * makes to a generated site, put behind the most obscure path to it.
   *
   * Straight to `/api/website/upload`, the same endpoint the drag-and-drop
   * field uses, so one validation and one bucket policy still cover every way a
   * file arrives. The section and crop go with it, so the picture comes back
   * for the right slot next time.
   */
  const upload = async (file: File) => {
    if (uploading) return;
    setUploading(true);
    setUploadError(null);

    try {
      const form = new FormData();
      form.append('file', file);
      if (section) form.append('section', section);
      form.append('aspect', aspect);

      const response = await fetch('/api/website/upload', { method: 'POST', body: form });
      const result = await response.json();

      if (response.ok && result.success && result.url) {
        /*
         * UPLOADING IS NOT CHOOSING.
         *
         * The picture joins the grid and the owner picks it, the same as every
         * other picture here. Applying it and closing on their behalf takes the
         * decision away at the exact moment they most want it: adding two
         * photographs and comparing them is the ordinary case, and so is
         * uploading one, seeing it against the stock shot, and keeping the
         * stock shot.
         *
         * Reloaded rather than pushed onto the list, so what they see is the
         * stored row — the same picture the grid will show on every later open,
         * not an optimistic stand-in that might differ from it.
         */
        setJustAdded(result.url as string);
        await load();
        return;
      }
      setUploadError(result.error || t('media.upload.failed'));
    } catch {
      setUploadError(t('media.upload.failed'));
    } finally {
      setUploading(false);
      // So choosing the same file twice in a row still fires a change event.
      if (fileInput.current) fileInput.current.value = '';
    }
  };

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

      // Both answers carry the allowance — a refusal is exactly when the
      // number matters most.
      if (result.allowance) setAllowance(result.allowance);

      if (result.success) {
        onSelect(result.data.url as string);
        onClose();
        return;
      }

      setGenerateError(
        result.reason === 'limit_reached'
          ? t('media.generate.limit_reached', { limit: String(result.allowance?.limit ?? '') })
          : t(`media.generate.${result.reason ?? 'failed'}`)
      );
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
                  className={`group relative aspect-[4/3] overflow-hidden rounded-xl border transition-colors hover:border-[#4F6EF7] ${
                    item.url === justAdded
                      ? 'border-[#4F6EF7] ring-2 ring-[#4F6EF7]/40'
                      : 'border-[var(--v2-border)]'
                  }`}
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
          {/* Upload first: it is the likeliest thing an owner wants and the
              only one of the three that produces a picture of their actual
              business. */}
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/svg+xml"
            className="hidden"
            onChange={event => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm hover:bg-[var(--v2-surface-2)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {t('media.upload.working')}
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                {t('media.library.upload')}
              </>
            )}
          </button>
          {uploadError && <p className="text-sm text-red-500">{uploadError}</p>}

          {/*
            The allowance, where the owner is about to spend it.

            Generated pictures are billed per image, and until now nothing said
            so — the button looked as free as Upload beside it. Shown as what
            REMAINS rather than what has been used, because the only question
            being asked here is "can I do this again".
          */}
          {allowance && (
            <p className={`text-xs ${allowance.remaining === 0 ? 'text-amber-600 dark:text-amber-400' : 'text-[var(--v2-text-muted)]'}`}>
              {allowance.remaining > 0
                ? t('media.generate.remaining', {
                    remaining: String(allowance.remaining),
                    limit: String(allowance.limit),
                  })
                : t('media.generate.limit_reached', { limit: String(allowance.limit) })}
            </p>
          )}

          <div className="flex gap-2">
            <input
              type="text"
              value={prompt}
              onChange={event => setPrompt(event.target.value)}
              placeholder={t('media.generate.prompt')}
              maxLength={300}
              disabled={generating || allowance?.remaining === 0}
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
              disabled={!prompt.trim() || generating || allowance?.remaining === 0}
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
