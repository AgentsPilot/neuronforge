'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Play } from 'lucide-react';
import type { BlockRendererProps } from './types';

interface VideoContent {
  title?: string;
  description?: string;
  video_url: string;
  thumbnail?: string;
  provider?: 'youtube' | 'vimeo' | 'custom';
  autoplay?: boolean;
}

export function VideoBlock({ content, styles, theme, isRTL, className }: BlockRendererProps) {
  const {
    title,
    description,
    video_url,
    thumbnail,
    provider = 'youtube',
    autoplay = false
  } = content as VideoContent;

  const [playing, setPlaying] = useState(autoplay);
  const primaryColor = theme?.colors.primary || '#4F6EF7';
  const aspectRatio = styles?.aspect_ratio || '16/9';

  // Extract video ID from URL
  const getVideoId = (url: string, provider: string): string | null => {
    if (provider === 'youtube') {
      const match = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
      return match ? match[1] : null;
    }
    if (provider === 'vimeo') {
      const match = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
      return match ? match[1] : null;
    }
    return null;
  };

  // Get embed URL
  const getEmbedUrl = (): string => {
    const videoId = getVideoId(video_url, provider);

    if (provider === 'youtube' && videoId) {
      return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`;
    }
    if (provider === 'vimeo' && videoId) {
      return `https://player.vimeo.com/video/${videoId}?autoplay=1`;
    }
    return video_url;
  };

  // Get thumbnail URL
  const getThumbnailUrl = (): string => {
    if (thumbnail) return thumbnail;

    const videoId = getVideoId(video_url, provider);

    if (provider === 'youtube' && videoId) {
      return `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
    }

    // Default placeholder
    return '/placeholder-video.jpg';
  };

  return (
    <section
      dir={isRTL ? 'rtl' : 'ltr'}
      className={`${styles?.padding || 'py-16 sm:py-24'} ${styles?.background || 'bg-white dark:bg-slate-950'} ${className || ''}`}
    >
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        {/* Header */}
        {(title || description) && (
          <div className="text-center mb-10">
            {title && (
              <motion.h2
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white"
                style={{ fontFamily: 'var(--website-font-heading)' }}
              >
                {title}
              </motion.h2>
            )}
            {description && (
              <motion.p
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.1 }}
                className="mt-4 text-lg text-gray-600 dark:text-gray-300 max-w-2xl mx-auto"
                style={{ fontFamily: 'var(--website-font-body)' }}
              >
                {description}
              </motion.p>
            )}
          </div>
        )}

        {/* Video Container */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 }}
          className="relative overflow-hidden rounded-2xl shadow-2xl"
          style={{
            aspectRatio,
            borderRadius: theme?.borderRadius || '1rem'
          }}
        >
          {playing ? (
            // Video iframe
            <iframe
              src={getEmbedUrl()}
              className="absolute inset-0 w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              title={title || 'Video'}
            />
          ) : (
            // Thumbnail with play button
            <button
              onClick={() => setPlaying(true)}
              className="absolute inset-0 w-full h-full group"
            >
              <img
                src={getThumbnailUrl()}
                alt={title || 'Video thumbnail'}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black/30 group-hover:bg-black/40 transition-colors" />

              {/* Play button */}
              <div
                className="absolute inset-0 flex items-center justify-center"
              >
                <motion.div
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  className="w-20 h-20 rounded-full flex items-center justify-center shadow-2xl"
                  style={{ backgroundColor: primaryColor }}
                >
                  <Play className="w-8 h-8 text-white ms-1" fill="white" />
                </motion.div>
              </div>
            </button>
          )}
        </motion.div>
      </div>
    </section>
  );
}
