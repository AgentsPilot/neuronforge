/**
 * A video, framed like every other picture on the page.
 *
 * The frame takes the template's own radius and aspect so the video sits in the
 * same rhythm as the gallery and the split band, rather than arriving as a
 * black rectangle from somewhere else. The player itself is the provider's —
 * only the frame is ours.
 *
 * @module components/website/templates/shapes/Video
 */

import type { BlockRendererProps } from '@/components/website/blocks/types';

interface VideoShape {
  title?: string;
  description?: string;
  video_url?: string;
  thumbnail?: string;
}

/** YouTube and Vimeo watch URLs, as the embed the iframe needs. */
function embedUrl(url: string): string {
  const youtube = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/);
  if (youtube) return `https://www.youtube.com/embed/${youtube[1]}`;
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return url;
}

export function VideoSection({ content, styles, isRTL, className }: BlockRendererProps) {
  const c = content as VideoShape;
  if (!c.video_url) return null;

  return (
    <section
      dir={isRTL ? 'rtl' : 'ltr'}
      className={`apc-sec ${styles?.padding ?? ''} ${className ?? ''}`}
    >
      {(c.title || c.description) && (
        <div className="apc-sec-head">
          {c.title && <h2>{c.title}</h2>}
          {c.description && <p className="apc-lede">{c.description}</p>}
        </div>
      )}

      <div className="apc-video">
        <iframe
          src={embedUrl(c.video_url)}
          title={c.title ?? 'Video'}
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
          allowFullScreen
        />
      </div>
    </section>
  );
}
