'use client';

import { useState } from 'react';
import { Plus, Trash2, Sparkles, Star, User, Briefcase, Building2, GripVertical, Loader2 } from 'lucide-react';
import type { TestimonialItem } from './blocks/types';
import { MediaUploader } from './MediaUploader';

interface TestimonialEditorProps {
  testimonials: TestimonialItem[];
  onChange: (testimonials: TestimonialItem[]) => void;
  onEnhanceWithAI: (index: number) => Promise<void>;
  isEnhancing: boolean;
  enhancingIndex: number | null;
  language: 'en' | 'es' | 'he';
}

const labels = {
  en: {
    add_testimonial: 'Add Testimonial',
    testimonial_quote: 'Quote',
    testimonial_author: 'Author Name',
    testimonial_role: 'Role / Title',
    testimonial_company: 'Company',
    testimonial_rating: 'Rating',
    testimonial_photo: 'Photo',
    enhance_with_ai: 'Enhance with AI',
    enhancing: 'Enhancing...',
    delete_testimonial: 'Delete',
    empty_state: 'No testimonials yet. Add one to get started.',
    quote_placeholder: 'Share what your client said about your service...',
    author_placeholder: 'John Smith',
    role_placeholder: 'CEO',
    company_placeholder: 'Acme Inc.',
    photo_placeholder: 'Upload photo'
  },
  es: {
    add_testimonial: 'Agregar Testimonio',
    testimonial_quote: 'Cita',
    testimonial_author: 'Nombre del Autor',
    testimonial_role: 'Rol / Título',
    testimonial_company: 'Empresa',
    testimonial_rating: 'Calificación',
    testimonial_photo: 'Foto',
    enhance_with_ai: 'Mejorar con IA',
    enhancing: 'Mejorando...',
    delete_testimonial: 'Eliminar',
    empty_state: 'Aún no hay testimonios. Agrega uno para comenzar.',
    quote_placeholder: 'Comparte lo que tu cliente dijo sobre tu servicio...',
    author_placeholder: 'Juan García',
    role_placeholder: 'Director',
    company_placeholder: 'Empresa SA',
    photo_placeholder: 'Subir foto'
  },
  he: {
    add_testimonial: 'הוסף המלצה',
    testimonial_quote: 'ציטוט',
    testimonial_author: 'שם הממליץ',
    testimonial_role: 'תפקיד',
    testimonial_company: 'חברה',
    testimonial_rating: 'דירוג',
    testimonial_photo: 'תמונה',
    enhance_with_ai: 'שפר עם AI',
    enhancing: 'משפר...',
    delete_testimonial: 'מחק',
    empty_state: 'אין המלצות עדיין. הוסף אחת כדי להתחיל.',
    quote_placeholder: 'שתף מה הלקוח שלך אמר על השירות שלך...',
    author_placeholder: 'ישראל ישראלי',
    role_placeholder: 'מנכ"ל',
    company_placeholder: 'חברה בע"מ',
    photo_placeholder: 'העלה תמונה'
  }
};

export function TestimonialEditor({
  testimonials,
  onChange,
  onEnhanceWithAI,
  isEnhancing,
  enhancingIndex,
  language
}: TestimonialEditorProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(
    testimonials.length > 0 ? 0 : null
  );
  const t = labels[language];
  const isRTL = language === 'he';

  const handleAdd = () => {
    const newTestimonial: TestimonialItem = {
      quote: '',
      author: '',
      role: '',
      company: '',
      rating: 5
    };
    const newTestimonials = [...testimonials, newTestimonial];
    onChange(newTestimonials);
    setExpandedIndex(newTestimonials.length - 1);
  };

  const handleUpdate = (index: number, field: keyof TestimonialItem, value: string | number) => {
    const updated = [...testimonials];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  const handleDelete = (index: number) => {
    const updated = testimonials.filter((_, i) => i !== index);
    onChange(updated);
    if (expandedIndex === index) {
      setExpandedIndex(updated.length > 0 ? 0 : null);
    } else if (expandedIndex !== null && expandedIndex > index) {
      setExpandedIndex(expandedIndex - 1);
    }
  };

  const renderStarRating = (rating: number, index: number) => (
    <div className="flex gap-1" dir="ltr">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => handleUpdate(index, 'rating', star)}
          className="p-0.5 hover:scale-110 transition-transform"
        >
          <Star
            className="w-5 h-5"
            fill={star <= rating ? '#FBBF24' : 'none'}
            stroke={star <= rating ? '#FBBF24' : '#D1D5DB'}
          />
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Empty State */}
      {testimonials.length === 0 && (
        <div className="text-center py-8 px-4 bg-[var(--v2-bg)] rounded-lg border border-dashed border-[var(--v2-border)]">
          <User className="w-10 h-10 mx-auto text-[var(--v2-text-muted)] mb-3" />
          <p className="text-[var(--v2-text-muted)] text-sm mb-4">
            {t.empty_state}
          </p>
          <button
            type="button"
            onClick={handleAdd}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#4F6EF7] hover:bg-[#3B5AE5] rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            {t.add_testimonial}
          </button>
        </div>
      )}

      {/* Testimonial List */}
      {testimonials.map((testimonial, index) => (
        <div
          key={index}
          className="bg-[var(--v2-bg)] rounded-lg border border-[var(--v2-border)] overflow-hidden"
        >
          {/* Header - Always visible */}
          <button
            type="button"
            onClick={() => setExpandedIndex(expandedIndex === index ? null : index)}
            className="w-full flex items-center gap-3 p-3 hover:bg-[var(--v2-surface)] transition-colors text-start"
          >
            <GripVertical className="w-4 h-4 text-[var(--v2-text-muted)] flex-shrink-0" />
            <div className="w-8 h-8 rounded-full bg-[#4F6EF7]/10 flex items-center justify-center flex-shrink-0 overflow-hidden">
              {testimonial.image ? (
                <img src={testimonial.image} alt={testimonial.author || ''} className="w-full h-full object-cover" />
              ) : testimonial.author ? (
                <span className="text-sm font-medium text-[#4F6EF7]">
                  {testimonial.author.charAt(0).toUpperCase()}
                </span>
              ) : (
                <User className="w-4 h-4 text-[#4F6EF7]" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[var(--v2-text-primary)] truncate">
                {testimonial.author || t.testimonial_author}
              </p>
              {(testimonial.role || testimonial.company) && (
                <p className="text-xs text-[var(--v2-text-muted)] truncate">
                  {testimonial.role}
                  {testimonial.role && testimonial.company && ' · '}
                  {testimonial.company}
                </p>
              )}
            </div>
            {testimonial.rating && (
              <div className="flex gap-0.5" dir="ltr">
                {[...Array(testimonial.rating)].map((_, i) => (
                  <Star
                    key={i}
                    className="w-3 h-3"
                    fill="#FBBF24"
                    stroke="#FBBF24"
                  />
                ))}
              </div>
            )}
          </button>

          {/* Expanded Form */}
          {expandedIndex === index && (
            <div className="px-4 pb-4 space-y-4 border-t border-[var(--v2-border)]">
              {/* Quote */}
              <div className="mt-4">
                <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-1">
                  {t.testimonial_quote}
                </label>
                <div className="relative">
                  <textarea
                    rows={3}
                    value={testimonial.quote}
                    onChange={(e) => handleUpdate(index, 'quote', e.target.value)}
                    placeholder={t.quote_placeholder}
                    className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7] resize-none"
                    dir={isRTL ? 'rtl' : 'ltr'}
                  />
                  <button
                    type="button"
                    onClick={() => onEnhanceWithAI(index)}
                    disabled={isEnhancing || !testimonial.quote.trim()}
                    className="absolute bottom-2 end-2 flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[#4F6EF7] bg-[#4F6EF7]/10 hover:bg-[#4F6EF7]/20 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isEnhancing && enhancingIndex === index ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" />
                        {t.enhancing}
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3 h-3" />
                        {t.enhance_with_ai}
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Author Photo & Name Row */}
              <div className="flex gap-3 items-start">
                <div className="flex-shrink-0">
                  <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-1">
                    {t.testimonial_photo}
                  </label>
                  <MediaUploader
                    value={testimonial.image || ''}
                    onChange={(url) => handleUpdate(index, 'image', url)}
                    onRemove={() => handleUpdate(index, 'image', '')}
                    placeholder={t.photo_placeholder}
                    previewClassName="w-16 h-16 rounded-full"
                    showUrlInput={false}
                  />
                </div>
                <div className="flex-1 grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-1">
                      <User className="w-3.5 h-3.5 inline me-1" />
                      {t.testimonial_author}
                    </label>
                    <input
                      type="text"
                      value={testimonial.author}
                      onChange={(e) => handleUpdate(index, 'author', e.target.value)}
                      placeholder={t.author_placeholder}
                      className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7] text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-1">
                      <Briefcase className="w-3.5 h-3.5 inline me-1" />
                      {t.testimonial_role}
                    </label>
                    <input
                      type="text"
                      value={testimonial.role || ''}
                      onChange={(e) => handleUpdate(index, 'role', e.target.value)}
                      placeholder={t.role_placeholder}
                      className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7] text-sm"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-1">
                    <Building2 className="w-3.5 h-3.5 inline me-1" />
                    {t.testimonial_company}
                  </label>
                  <input
                    type="text"
                    value={testimonial.company || ''}
                    onChange={(e) => handleUpdate(index, 'company', e.target.value)}
                    placeholder={t.company_placeholder}
                    className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7] text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-1">
                    <Star className="w-3.5 h-3.5 inline me-1" />
                    {t.testimonial_rating}
                  </label>
                  <div className="pt-1.5">
                    {renderStarRating(testimonial.rating || 5, index)}
                  </div>
                </div>
              </div>

              {/* Delete Button */}
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => handleDelete(index)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  {t.delete_testimonial}
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Add Button (when there are existing testimonials) */}
      {testimonials.length > 0 && (
        <button
          type="button"
          onClick={handleAdd}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-[var(--v2-text-secondary)] bg-[var(--v2-bg)] hover:bg-[var(--v2-surface)] border border-dashed border-[var(--v2-border)] rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t.add_testimonial}
        </button>
      )}
    </div>
  );
}
