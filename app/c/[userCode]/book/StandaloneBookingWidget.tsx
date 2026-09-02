'use client';

/**
 * The public booking surface behind a smart link.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CATALOGUE, AND THEN THE SAME MODAL EVERY OTHER SURFACE USES.
 *
 * This file used to be an 800-line booking flow of its own: its own step
 * machine, its own service cards, its own date picker, its own client form, its
 * own translations. It shared nothing with the website or the landing page but
 * the endpoint it posted to, and the two implementations had drifted:
 *
 *   • phone was REQUIRED on a landing page and optional here
 *   • the intake step was hardcoded off, so a business with intake enabled
 *     never collected it from a smart link
 *   • `text-left` and `mr-1` were hardcoded, so Hebrew rendered left-aligned
 *     inside a page that had correctly set `dir="rtl"`
 *   • a priced service collected no money at all
 *
 * None of those were decisions. They were what happens when the same screen
 * exists twice. So the flow is now `BookingModal` — the identical component the
 * website and landing pages open — and this file is only the catalogue that
 * opens it.
 *
 * The one deliberate difference: a smart link exposes the WHOLE catalogue,
 * where a landing page arrives with a single service already chosen. So the
 * services are listed here on the page, and picking one opens the modal with
 * that service pre-selected.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState } from 'react';
import { createLogger } from '@/lib/logger';
import { BookingModal } from '@/components/website/blocks/BookingModal';
import { ServicesStep, LABELS, type Service as SharedService } from '@/components/website/blocks/ProcessFlowSection';
import type { SelectedServiceData, PageTheme } from '@/components/website/blocks/types';
import type { CollectionMethod } from '@/lib/business-os/setup/setupGraph';
import type { Locale } from '@/lib/i18n/config';

const logger = createLogger({ module: 'StandaloneBookingWidget' });

interface Service {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  price: number | null;
  currency: string;
  is_scheduled?: boolean | null;
  collection?: 'online' | 'invoice' | null;
}

interface StandaloneBookingWidgetProps {
  userCode: string;
  services: Service[];
  timezone: string;
  primaryColor: string;
  locale?: Locale;
  initialServiceId?: string;
  theme?: PageTheme;
  /**
   * How the business collects, for services saved before they carried it
   * themselves. The service's own answer always wins.
   */
  collectionMethod?: CollectionMethod | null;
  /** Stripe connected with charges enabled. False drops the payment step. */
  processorReady?: boolean;
}

export function StandaloneBookingWidget({
  userCode,
  services,
  primaryColor,
  locale = 'en',
  initialServiceId,
  theme,
  collectionMethod = null,
  processorReady = false,
}: StandaloneBookingWidgetProps) {
  const isRTL = locale === 'he';
  const labels = LABELS[locale] || LABELS.en;

  /**
   * The service the modal is booking, or null when the catalogue is showing.
   *
   * A smart link may still be built for one service, in which case the modal
   * opens straight onto it and the catalogue is never seen.
   */
  const [selected, setSelected] = useState<SelectedServiceData | null>(() => {
    const initial = initialServiceId ? services.find(s => s.id === initialServiceId) : null;
    return initial ? toModalService(initial, collectionMethod) : null;
  });

  const open = (service: Service) => {
    logger.info({ userCode, serviceId: service.id }, 'Smart-link booking opened');
    setSelected(toModalService(service, collectionMethod));
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <ServicesStep
        services={services as SharedService[]}
        loading={false}
        primaryColor={primaryColor}
        onSelect={service => open(service as Service)}
        isRTL={isRTL}
        labels={labels}
        theme={theme}
      />

      {/* The same modal the website and landing pages open, on the same
          components, with the same fields and the same wording. It identifies
          the business by `userCode` because a smart link has no subdomain —
          which is the single reason this surface could not use it before. */}
      <BookingModal
        isOpen={!!selected}
        onClose={() => setSelected(null)}
        theme={theme}
        locale={locale}
        isRTL={isRTL}
        userCode={userCode}
        initialService={selected}
        paymentsEnabled={processorReady}
      />
    </div>
  );
}

/**
 * A catalogue row, as the modal expects it.
 *
 * `is_scheduled` and `collection` are what decide the journey — whether the
 * client picks a time, and whether they are asked for a card. Passing them is
 * what stops the modal falling back to a hardcoded flow and asking for a slot
 * on a service that has no time.
 */
function toModalService(
  service: Service,
  businessCollection: CollectionMethod | null
): SelectedServiceData {
  return {
    id: service.id,
    name: service.name,
    description: service.description,
    duration_minutes: service.duration_minutes,
    price: service.price,
    currency: service.currency,
    is_scheduled: service.is_scheduled,
    // The service's own answer, falling back to the business-wide one for a
    // service saved before services carried it.
    collection: service.collection ?? (businessCollection as 'online' | 'invoice' | null),
  };
}
