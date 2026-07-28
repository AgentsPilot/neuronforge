'use client';

import { useEffect, useState } from 'react';
import { Plus, Clock, DollarSign, Pencil } from 'lucide-react';
import { useDraftManager } from '@/lib/business-os/DraftManager';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { Draft, ServiceDraftData } from '@/lib/business-os/DraftManagerTypes';

interface SchedulingService {
  id: string;
  service_name: string;
  description?: string;
  duration_minutes: number;
  price: number;
  currency: string;
  status: 'draft' | 'active' | 'inactive';
  is_active?: boolean;
}

// Color palette for service dots
const SERVICE_COLORS = ['#4F6EF7', '#F97316', '#D14E97', '#22C58B', '#8B5CF6', '#0EA5E9'];

export function ServicesPreview() {
  const { t, language } = useLanguage();
  const { getDraftsByType, state } = useDraftManager();
  const [services, setServices] = useState<SchedulingService[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch existing services
  useEffect(() => {
    const fetchServices = async () => {
      try {
        const res = await fetch('/api/scheduling/services?activeOnly=false');
        const data = await res.json();
        if (data.success && data.data) {
          setServices(data.data);
        }
      } catch (error) {
        console.error('Failed to fetch services:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchServices();
  }, []);

  // Get service drafts
  const serviceDrafts = getDraftsByType('service');

  // Merge services with drafts
  const mergedServices = getMergedServices(services, serviceDrafts);

  // Format price
  const formatPrice = (price: number, currency: string, isFree: boolean) => {
    if (isFree || price === 0) {
      return t('preview.service_free') || 'Free';
    }

    const locale = language === 'he' ? 'he-IL' : language === 'es' ? 'es-ES' : 'en-US';
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(price);
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="p-4 border border-[var(--v2-border)] animate-pulse"
            style={{ borderRadius: 'var(--v2-radius-card)' }}
          >
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-[var(--v2-border)]" />
              <div className="flex-1">
                <div className="h-4 bg-[var(--v2-border)] rounded w-2/3 mb-2" />
                <div className="h-3 bg-[var(--v2-border)] rounded w-1/3" />
              </div>
              <div className="h-5 bg-[var(--v2-border)] rounded w-16" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Booking page header simulation */}
      <div className="mb-4">
        <p className="text-[10px] font-semibold tracking-[0.12em] uppercase text-[#F97316] mb-1">
          {t('preview.your_business') || 'Your Business'}
        </p>
        <h3 className="font-semibold text-[var(--v2-text-primary)]">
          {t('preview.book_session') || 'Book a session'}
        </h3>
      </div>

      {/* Services list */}
      {mergedServices.length === 0 ? (
        <div className="text-center py-8 text-[var(--v2-text-muted)]">
          <p className="mb-2">{t('preview.no_services') || 'No services yet'}</p>
          <p className="text-sm">{t('preview.no_services_hint') || 'Say "add a service" in the chat to create one'}</p>
        </div>
      ) : (
        mergedServices.map((service, index) => (
          <ServiceCard
            key={service.id || `draft-${index}`}
            service={service}
            color={SERVICE_COLORS[index % SERVICE_COLORS.length]}
            formatPrice={formatPrice}
            t={t}
          />
        ))
      )}

      {/* Add service button */}
      <button
        className="w-full flex items-center justify-center gap-2 p-4 border-2 border-dashed border-[var(--v2-border)] text-[#F97316] font-medium hover:border-[#F97316] hover:bg-[rgba(249,115,22,0.04)] transition-colors"
        style={{ borderRadius: 'var(--v2-radius-card)' }}
      >
        <Plus className="h-4 w-4" />
        {t('preview.add_service') || 'Add a service'}
      </button>
    </div>
  );
}

// Service card component
interface ServiceCardProps {
  service: MergedService;
  color: string;
  formatPrice: (price: number, currency: string, isFree: boolean) => string;
  t: (key: string) => string;
}

function ServiceCard({ service, color, formatPrice, t }: ServiceCardProps) {
  const isFree = service.is_free || service.price === 0;

  return (
    <div
      className={`
        relative p-4 border bg-white dark:bg-[var(--v2-surface)] transition-all
        hover:border-[#F97316] hover:shadow-[0_8px_20px_-12px_rgba(249,115,22,0.4)]
        ${service.draftStatus ? 'border-amber-400 bg-amber-50/50 dark:bg-amber-900/10' : 'border-[var(--v2-border)]'}
      `}
      style={{ borderRadius: 'var(--v2-radius-card)' }}
    >
      {/* Draft badge */}
      {service.draftStatus && (
        <span
          className="absolute -top-2 end-3 px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase bg-amber-400 text-amber-900"
          style={{ borderRadius: '4px' }}
        >
          {service.draftStatus === 'new'
            ? (t('preview.badge_new') || 'New')
            : (t('preview.badge_edited') || 'Edited')
          }
        </span>
      )}

      <div className="flex items-center gap-3">
        {/* Color dot */}
        <span
          className="w-3 h-3 rounded-full flex-none"
          style={{ backgroundColor: color }}
        />

        {/* Service info */}
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-[var(--v2-text-primary)] truncate">
            {service.service_name}
          </h4>
          <div className="flex items-center gap-2 text-xs text-[var(--v2-text-muted)]">
            <Clock className="h-3 w-3" />
            <span>{service.duration_minutes} {t('preview.minutes') || 'min'}</span>
          </div>
        </div>

        {/* Price */}
        <span
          className={`font-bold text-sm ${isFree ? 'text-[#22C58B]' : 'text-[var(--v2-text-primary)]'}`}
        >
          {formatPrice(service.price, service.currency, isFree)}
        </span>

        {/* Edit button */}
        <button
          className="p-2 text-[var(--v2-text-muted)] hover:text-[#F97316] hover:bg-[rgba(249,115,22,0.1)] transition-colors"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// Types for merged services
interface MergedService extends SchedulingService {
  draftStatus?: 'new' | 'edited' | null;
  draftId?: string;
  is_free?: boolean;
}

// Merge existing services with drafts
function getMergedServices(services: SchedulingService[], drafts: Draft[]): MergedService[] {
  const result: MergedService[] = [];
  const serviceMap = new Map<string, SchedulingService>();

  // Index existing services
  services.forEach(s => serviceMap.set(s.id, s));

  // Track which services have been processed via drafts
  const processedIds = new Set<string>();

  // Process drafts first
  drafts.forEach(draft => {
    const data = draft.data as ServiceDraftData;

    if (draft.action === 'create') {
      // New service from draft
      result.push({
        id: draft.id,
        service_name: data.service_name,
        description: data.description,
        duration_minutes: data.duration_minutes,
        price: data.price,
        currency: data.currency || 'USD',
        status: data.status || 'draft',
        is_free: data.is_free,
        draftStatus: 'new',
        draftId: draft.id,
      });
    } else if (draft.action === 'update' && draft.entityId) {
      // Updated service
      const existing = serviceMap.get(draft.entityId);
      if (existing) {
        result.push({
          ...existing,
          ...data,
          service_name: data.service_name || existing.service_name,
          duration_minutes: data.duration_minutes ?? existing.duration_minutes,
          price: data.price ?? existing.price,
          currency: data.currency || existing.currency,
          is_free: data.is_free,
          draftStatus: 'edited',
          draftId: draft.id,
        });
        processedIds.add(draft.entityId);
      }
    } else if (draft.action === 'delete' && draft.entityId) {
      // Mark as processed (will be excluded)
      processedIds.add(draft.entityId);
    }
  });

  // Add remaining services (not touched by drafts)
  services.forEach(service => {
    if (!processedIds.has(service.id)) {
      result.push({
        ...service,
        draftStatus: null,
      });
    }
  });

  // Sort: new items first, then by name
  result.sort((a, b) => {
    if (a.draftStatus === 'new' && b.draftStatus !== 'new') return -1;
    if (b.draftStatus === 'new' && a.draftStatus !== 'new') return 1;
    return a.service_name.localeCompare(b.service_name);
  });

  return result;
}
