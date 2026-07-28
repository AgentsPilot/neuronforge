'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import type { BlockRendererProps, GalleryImage } from './types';

interface GalleryContent {
  title?: string;
  subtitle?: string;
  images: GalleryImage[];
  layout?: 'grid' | 'masonry' | 'carousel' | 'featured';
}

export function GalleryBlock({ content, styles, theme, isRTL, className }: BlockRendererProps) {
  const {
    title,
    subtitle,
    images = [],
    layout = 'grid'
  } = content as GalleryContent;

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const columns = styles?.columns || 3;
  const primaryColor = theme?.colors.primary || '#4F6EF7';

  const gridColsClass = {
    2: 'grid-cols-2',
    3: 'grid-cols-2 sm:grid-cols-3',
    4: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'
  }[columns] || 'grid-cols-2 sm:grid-cols-3';

  const openLightbox = (index: number) => setLightboxIndex(index);
  const closeLightbox = () => setLightboxIndex(null);

  const nextImage = () => {
    if (lightboxIndex !== null) {
      setLightboxIndex((lightboxIndex + 1) % images.length);
    }
  };

  const prevImage = () => {
    if (lightboxIndex !== null) {
      setLightboxIndex((lightboxIndex - 1 + images.length) % images.length);
    }
  };

  return (
    <>
      <section
        dir={isRTL ? 'rtl' : 'ltr'}
        className={`${styles?.padding || 'py-16 sm:py-24'} ${styles?.background || 'bg-white dark:bg-slate-950'} ${className || ''}`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          {/* Header */}
          {(title || subtitle) && (
            <div className="text-center mb-12">
              {title && (
                <motion.h2
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white"
                  style={{ fontFamily: theme?.fonts.heading }}
                >
                  {title}
                </motion.h2>
              )}
              {subtitle && (
                <motion.p
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.1 }}
                  className="mt-4 text-lg text-gray-600 dark:text-gray-300"
                  style={{ fontFamily: theme?.fonts.body }}
                >
                  {subtitle}
                </motion.p>
              )}
            </div>
          )}

          {/* Grid Layout */}
          {layout === 'grid' && (
            <div className={`grid ${gridColsClass} gap-4`}>
              {images.map((image, index) => (
                <motion.button
                  key={index}
                  initial={{ opacity: 0, scale: 0.9 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.05 }}
                  onClick={() => openLightbox(index)}
                  className="group relative aspect-square overflow-hidden rounded-lg"
                  style={{ borderRadius: theme?.borderRadius || '0.5rem' }}
                >
                  <img
                    src={image.url}
                    alt={image.alt}
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors" />
                  {image.caption && (
                    <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                      <p className="text-white text-sm">{image.caption}</p>
                    </div>
                  )}
                </motion.button>
              ))}
            </div>
          )}

          {/* Masonry Layout */}
          {layout === 'masonry' && (
            <div className={`columns-2 sm:columns-3 gap-4 space-y-4`}>
              {images.map((image, index) => (
                <motion.button
                  key={index}
                  initial={{ opacity: 0 }}
                  whileInView={{ opacity: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.05 }}
                  onClick={() => openLightbox(index)}
                  className="group relative break-inside-avoid overflow-hidden rounded-lg w-full"
                  style={{ borderRadius: theme?.borderRadius || '0.5rem' }}
                >
                  <img
                    src={image.url}
                    alt={image.alt}
                    className="w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors" />
                </motion.button>
              ))}
            </div>
          )}

          {/* Featured Layout (1 large + smaller grid) */}
          {layout === 'featured' && images.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Featured Image */}
              <motion.button
                initial={{ opacity: 0, x: isRTL ? 20 : -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                onClick={() => openLightbox(0)}
                className="group relative aspect-square lg:aspect-auto lg:row-span-2 overflow-hidden rounded-xl"
                style={{ borderRadius: theme?.borderRadius || '0.75rem' }}
              >
                <img
                  src={images[0].url}
                  alt={images[0].alt}
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
              </motion.button>

              {/* Smaller Grid */}
              <div className="grid grid-cols-2 gap-4">
                {images.slice(1, 5).map((image, index) => (
                  <motion.button
                    key={index}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: (index + 1) * 0.1 }}
                    onClick={() => openLightbox(index + 1)}
                    className="group relative aspect-square overflow-hidden rounded-lg"
                    style={{ borderRadius: theme?.borderRadius || '0.5rem' }}
                  >
                    <img
                      src={image.url}
                      alt={image.alt}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors" />
                  </motion.button>
                ))}
              </div>
            </div>
          )}

          {/* Carousel Layout */}
          {layout === 'carousel' && (
            <div className="overflow-x-auto pb-4 -mx-4 px-4">
              <div className="flex gap-4" style={{ width: 'max-content' }}>
                {images.map((image, index) => (
                  <motion.button
                    key={index}
                    initial={{ opacity: 0, x: 50 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: index * 0.1 }}
                    onClick={() => openLightbox(index)}
                    className="group relative flex-shrink-0 w-72 h-48 overflow-hidden rounded-xl"
                    style={{ borderRadius: theme?.borderRadius || '0.75rem' }}
                  >
                    <img
                      src={image.url}
                      alt={image.alt}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                    {image.caption && (
                      <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/60 to-transparent">
                        <p className="text-white text-sm">{image.caption}</p>
                      </div>
                    )}
                  </motion.button>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Lightbox */}
      <AnimatePresence>
        {lightboxIndex !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
            onClick={closeLightbox}
          >
            {/* Close button */}
            <button
              onClick={closeLightbox}
              className="absolute top-4 end-4 p-2 text-white/70 hover:text-white transition-colors"
            >
              <X className="w-8 h-8" />
            </button>

            {/* Navigation */}
            <button
              onClick={(e) => { e.stopPropagation(); prevImage(); }}
              className="absolute start-4 p-2 text-white/70 hover:text-white transition-colors"
            >
              {isRTL ? <ChevronRight className="w-8 h-8" /> : <ChevronLeft className="w-8 h-8" />}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); nextImage(); }}
              className="absolute end-4 p-2 text-white/70 hover:text-white transition-colors"
            >
              {isRTL ? <ChevronLeft className="w-8 h-8" /> : <ChevronRight className="w-8 h-8" />}
            </button>

            {/* Image */}
            <motion.img
              key={lightboxIndex}
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              src={images[lightboxIndex].url}
              alt={images[lightboxIndex].alt}
              className="max-h-[85vh] max-w-[85vw] object-contain"
              onClick={(e) => e.stopPropagation()}
            />

            {/* Caption */}
            {images[lightboxIndex].caption && (
              <div className="absolute bottom-8 inset-x-0 text-center">
                <p className="text-white text-lg">{images[lightboxIndex].caption}</p>
              </div>
            )}

            {/* Dots */}
            <div className="absolute bottom-4 inset-x-0 flex justify-center gap-2">
              {images.map((_, index) => (
                <button
                  key={index}
                  onClick={(e) => { e.stopPropagation(); setLightboxIndex(index); }}
                  className={`w-2 h-2 rounded-full transition-all ${
                    index === lightboxIndex ? 'w-6 bg-white' : 'bg-white/50'
                  }`}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
