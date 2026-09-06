'use client';

/**
 * CustomerAcquisitionList
 * Displays both Smart Links and Landing Pages with click/conversion stats
 * Used in the Website Editor section of Business OS
 */

import { useState, useEffect } from 'react';
import {
  Link, FileText, Copy, ExternalLink, Trash2,
  MoreHorizontal, Loader2, TrendingUp, Users
} from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';

// Types
interface SmartLink {
  id: string;
  code: string;
  destination_url: string;
  destination_type: 'form' | 'booking' | 'landing_page';
  name: string;
  click_count: number;
  conversion_count: number;
  created_at: string;
}

interface LandingPage {
  id: string;
  slug: string;
  title: string;
  status: 'draft' | 'published';
  service_id: string | null;
  created_at: string;
}

interface CustomerAcquisitionItem {
  id: string;
  type: 'smart-link' | 'landing-page';
  name: string;
  url: string;
  fullUrl: string;
  status: 'active' | 'draft' | 'published';
  clicks: number;
  conversions: number;
  createdAt: string;
  destinationType?: 'form' | 'booking' | 'landing_page';
}

interface CustomerAcquisitionListProps {
  subdomain?: string;
  userCode?: string;
  onEdit?: (item: CustomerAcquisitionItem) => void;
  onDelete?: (item: CustomerAcquisitionItem) => void;
  refreshTrigger?: number;
}

// Labels
const LABELS = {
  en: {
    loading: 'Loading...',
    empty_title: 'No links yet',
    empty_desc: 'Create your first smart link or landing page to start capturing leads',
    clicks: 'clicks',
    conversions: 'conversions',
    copy: 'Copy',
    copied: 'Copied!',
    preview: 'Preview',
    edit: 'Edit',
    delete: 'Delete',
    smart_link: 'Smart Link',
    landing_page: 'Landing Page',
    contact_form: 'Contact Form',
    booking: 'Booking',
    draft: 'Draft',
    published: 'Published',
    active: 'Active'
  },
  es: {
    loading: 'Cargando...',
    empty_title: 'Sin enlaces aún',
    empty_desc: 'Crea tu primer smart link o landing page para empezar a capturar leads',
    clicks: 'clics',
    conversions: 'conversiones',
    copy: 'Copiar',
    copied: '¡Copiado!',
    preview: 'Vista previa',
    edit: 'Editar',
    delete: 'Eliminar',
    smart_link: 'Smart Link',
    landing_page: 'Landing Page',
    contact_form: 'Formulario',
    booking: 'Reserva',
    draft: 'Borrador',
    published: 'Publicado',
    active: 'Activo'
  },
  he: {
    loading: 'טוען...',
    empty_title: 'אין קישורים עדיין',
    empty_desc: 'צור את הקישור החכם או דף הנחיתה הראשון שלך כדי להתחיל לאסוף לידים',
    clicks: 'קליקים',
    conversions: 'המרות',
    copy: 'העתק',
    copied: 'הועתק!',
    preview: 'תצוגה מקדימה',
    edit: 'עריכה',
    delete: 'מחיקה',
    smart_link: 'קישור חכם',
    landing_page: 'דף נחיתה',
    contact_form: 'טופס יצירת קשר',
    booking: 'הזמנה',
    draft: 'טיוטה',
    published: 'פורסם',
    active: 'פעיל'
  }
};

export function CustomerAcquisitionList({
  subdomain = '',
  userCode = '',
  onEdit,
  onDelete,
  refreshTrigger = 0
}: CustomerAcquisitionListProps) {
  const { language } = useLanguage();
  const labels = LABELS[language] || LABELS.en;
  const isRTL = language === 'he';

  const [items, setItems] = useState<CustomerAcquisitionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  // Fetch data
  useEffect(() => {
    fetchData();
  }, [refreshTrigger]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch smart links and landing pages in parallel
      const [smartLinksRes, landingPagesRes] = await Promise.all([
        fetch('/api/smart-links'),
        fetch('/api/website/landing-pages')
      ]);

      const smartLinksData = await smartLinksRes.json();
      const landingPagesData = await landingPagesRes.json();

      const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
      const combinedItems: CustomerAcquisitionItem[] = [];

      // Transform smart links
      if (smartLinksData.success && smartLinksData.smartLinks) {
        smartLinksData.smartLinks.forEach((link: SmartLink) => {
          combinedItems.push({
            id: link.id,
            type: 'smart-link',
            name: link.name,
            url: `/go/${link.code}`,
            fullUrl: `${baseUrl}/go/${link.code}`,
            status: 'active',
            clicks: link.click_count || 0,
            conversions: link.conversion_count || 0,
            createdAt: link.created_at,
            destinationType: link.destination_type
          });
        });
      }

      // Transform landing pages
      if (landingPagesData.success && landingPagesData.landingPages) {
        landingPagesData.landingPages.forEach((page: LandingPage) => {
          const pageUrl = subdomain ? `/${page.slug}` : `/site/${subdomain}/${page.slug}`;
          combinedItems.push({
            id: page.id,
            type: 'landing-page',
            name: page.title,
            url: pageUrl,
            fullUrl: subdomain
              ? `https://${subdomain}.agentspilot.com/${page.slug}`
              : `${baseUrl}/site/${subdomain}/${page.slug}`,
            status: page.status,
            clicks: 0, // TODO: Add analytics for landing pages
            conversions: 0,
            createdAt: page.created_at
          });
        });
      }

      // Sort by creation date (newest first)
      combinedItems.sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      setItems(combinedItems);
    } catch (error) {
      console.error('[CustomerAcquisitionList] Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (item: CustomerAcquisitionItem) => {
    navigator.clipboard.writeText(item.fullUrl);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDelete = async (item: CustomerAcquisitionItem) => {
    if (onDelete) {
      onDelete(item);
      return;
    }

    // Default delete behavior
    try {
      const endpoint = item.type === 'smart-link'
        ? `/api/smart-links?id=${item.id}`
        : `/api/website/landing-pages/${item.id}`;

      await fetch(endpoint, { method: 'DELETE' });
      fetchData(); // Refresh list
    } catch (error) {
      console.error('[CustomerAcquisitionList] Error deleting item:', error);
    }
    setMenuOpenId(null);
  };

  // Get icon based on item type
  const getItemIcon = (item: CustomerAcquisitionItem) => {
    if (item.type === 'landing-page') {
      return <FileText className="w-5 h-5" />;
    }
    return <Link className="w-5 h-5" />;
  };

  // Get status badge
  const getStatusBadge = (item: CustomerAcquisitionItem) => {
    const statusConfig = {
      active: { label: labels.active, className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
      published: { label: labels.published, className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
      draft: { label: labels.draft, className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400' }
    };

    const config = statusConfig[item.status] || statusConfig.draft;

    return (
      <span className={`text-xs px-2 py-0.5 rounded-full ${config.className}`}>
        {config.label}
      </span>
    );
  };

  // Get type label
  const getTypeLabel = (item: CustomerAcquisitionItem) => {
    if (item.type === 'landing-page') {
      return labels.landing_page;
    }
    if (item.destinationType === 'form') {
      return labels.contact_form;
    }
    return labels.booking;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-[var(--v2-text-muted)]" />
        <span className="ms-2 text-sm text-[var(--v2-text-muted)]">{labels.loading}</span>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-[var(--v2-surface-hover)] flex items-center justify-center">
          <Link className="w-6 h-6 text-[var(--v2-text-muted)]" />
        </div>
        <h3 className="text-base font-semibold text-[var(--v2-text-primary)] mb-1">
          {labels.empty_title}
        </h3>
        <p className="text-sm text-[var(--v2-text-secondary)]">
          {labels.empty_desc}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2" dir={isRTL ? 'rtl' : 'ltr'}>
      {items.map((item) => (
        <div
          key={item.id}
          className="flex items-center gap-3 p-3 rounded-xl bg-[var(--v2-surface)] border border-[var(--v2-border)] hover:border-[#4F6EF7]/30 transition-colors group"
        >
          {/* Icon */}
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
            item.type === 'smart-link'
              ? 'bg-[#4F6EF7]/10 text-[#4F6EF7]'
              : 'bg-green-500/10 text-green-600'
          }`}>
            {getItemIcon(item)}
          </div>

          {/* Name and URL */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="font-medium text-[var(--v2-text-primary)] truncate">
                {item.name}
              </h4>
              {getStatusBadge(item)}
            </div>
            <div className="flex items-center gap-2 text-xs text-[var(--v2-text-muted)]">
              <span className="truncate" dir="ltr">{item.url}</span>
              <span className="hidden sm:inline">•</span>
              <span className="hidden sm:inline">{getTypeLabel(item)}</span>
            </div>
          </div>

          {/* Stats */}
          <div className="hidden md:flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1.5 text-[var(--v2-text-secondary)]">
              <TrendingUp className="w-4 h-4" />
              <span>{item.clicks} {labels.clicks}</span>
            </div>
            <div className="flex items-center gap-1.5 text-[var(--v2-text-secondary)]">
              <Users className="w-4 h-4" />
              <span>{item.conversions} {labels.conversions}</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => copyToClipboard(item)}
              className="p-2 rounded-lg text-[var(--v2-text-muted)] hover:text-[#4F6EF7] hover:bg-[var(--v2-surface-hover)] transition-colors"
              title={labels.copy}
            >
              <Copy className="w-4 h-4" />
            </button>

            {copiedId === item.id && (
              <span className="text-xs text-green-600 font-medium">
                {labels.copied}
              </span>
            )}

            <button
              onClick={() => window.open(item.fullUrl, '_blank')}
              className="p-2 rounded-lg text-[var(--v2-text-muted)] hover:text-[#4F6EF7] hover:bg-[var(--v2-surface-hover)] transition-colors"
              title={labels.preview}
            >
              <ExternalLink className="w-4 h-4" />
            </button>

            {/* More menu */}
            <div className="relative">
              <button
                onClick={() => setMenuOpenId(menuOpenId === item.id ? null : item.id)}
                className="p-2 rounded-lg text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface-hover)] transition-colors"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>

              {menuOpenId === item.id && (
                <>
                  {/* Backdrop to close menu */}
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setMenuOpenId(null)}
                  />
                  {/* Menu */}
                  <div className={`absolute top-full z-20 mt-1 w-32 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg shadow-lg py-1 ${isRTL ? 'left-0' : 'right-0'}`}>
                    {onEdit && (
                      <button
                        onClick={() => {
                          onEdit(item);
                          setMenuOpenId(null);
                        }}
                        className="w-full px-3 py-1.5 text-sm text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface-hover)] text-start"
                      >
                        {labels.edit}
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(item)}
                      className="w-full px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 text-start"
                    >
                      {labels.delete}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
