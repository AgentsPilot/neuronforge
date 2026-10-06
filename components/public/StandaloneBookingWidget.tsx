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
import type { ServicePaymentPlan } from '@/lib/business-os/servicePaymentPlan';
import type { Locale } from '@/lib/i18n/config';

const logger = createLogger({ module: 'StandaloneBookingWidget' });

interface Service {
  id: string;
  name: string;
  description: string | null;
  /**
   * Null on a PRODUCT, which has no length to fit a slot into.
   *
   * Both availability endpoints return null here for an unscheduled service, and
   * this said `number` — so the chain typed away a value it receives. Harmless
   * only because a route response arrives untyped; a caller that types its own
   * data honestly (the subdomain booking page) could not pass it at all.
   */
  duration_minutes: number | null;
  price: number | null;
  currency: string;
  is_scheduled?: boolean | null;
  collection?: 'online' | 'invoice' | null;
  /** Bought outright, or quoted first. The modal's resolver reads it. */
  sale_mode?: 'direct' | 'proposal';
  /** How this service may be paid over time, when the business offers one. */
  paymentPlan?: ServicePaymentPlan;
}

interface StandaloneBookingWidgetProps {
  /**
   * Which business, and how this surface names it.
   *
   * A smart link carries a `userCode` and no subdomain; a business's own booking
   * page carries a subdomain and no code. Exactly one is expected, and both are
   * forwarded — `BookingModal` has always accepted either, so this wrapper being
   * userCode-only was the single reason `/site/{subdomain}/book` could not use
   * it and kept a second 1,500-line implementation of the same five steps.
   */
  userCode?: string;
  subdomain?: string;
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
  subdomain,
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
    logger.info({ userCode, subdomain, serviceId: service.id }, 'Standalone booking opened');
    setSelected(toModalService(service, collectionMethod));
  };

  return (
    /*
     * The panel the services sit on, in the business's own colours.
     *
     * It was `bg-white` with a `gray-200` border — a white card in the middle
     * of a near-black smart link, which is the one surface many businesses
     * have. `apc-panel` is the same vocabulary the website's offer list uses,
     * so this takes the template's fill, border and corner exactly as the
     * services section does.
     */
    <div className="apc-panel p-6">
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
          components, with the same fields and the same wording — and now for
          the business's own booking page too. Whichever identifier this surface
          has travels with it; the modal accepts either. */}
      <BookingModal
        isOpen={!!selected}
        onClose={() => setSelected(null)}
        theme={theme}
        locale={locale}
        isRTL={isRTL}
        subdomain={subdomain}
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
    /*
     * Zero, not null, and only here.
     *
     * `SelectedServiceData.duration_minutes` is `number` and is read by the slot
     * maths, which never runs for an unscheduled service — `is_scheduled: false`
     * drops the scheduling step before any duration is needed. Normalising at
     * this one boundary keeps the honest type on the way in without widening
     * every consumer downstream.
     */
    duration_minutes: service.duration_minutes ?? 0,
    price: service.price,
    currency: service.currency,
    is_scheduled: service.is_scheduled,
    // Carried through, or the modal shows a single price for a service the
    // business sells in instalments — and the client agrees to the wrong thing.
    paymentPlan: service.paymentPlan,
    // Declared on the way in and dropped on the way out, so a QUOTED service
    // reached the modal looking like a direct sale and was asked for a card
    // instead of ending at a request. Affects the smart link and the business's
    // own booking page, which both run through here.
    sale_mode: service.sale_mode,
    // The service's own answer, falling back to the business-wide one for a
    // service saved before services carried it.
    collection: service.collection ?? (businessCollection as 'online' | 'invoice' | null),
  };
}
