'use client';

import { createContext, useContext } from 'react';

import type { PortalMeeting } from '@/components/public/PortalMeetings';

export interface PortalContextValue {
  clientName: string | null;
  clientEmail: string | null;
  /** The business's zone, so "open today" is the business's today. */
  timeZone: string | null;
  /** Every other appointment this client has with this business. */
  meetings: PortalMeeting[];
}

const PortalContext = createContext<PortalContextValue | null>(null);

/**
 * What the portal knows about the client, resolved once on the server.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A CONTEXT RATHER THAN A PROP
 *
 * The layout reads this: who the client is, their address, the business's
 * clock, and every other appointment they have here. It is one server query
 * for the whole section, and it has to stay there — doing it per page would
 * run it again on every navigation between the portal, cancel and reschedule.
 *
 * But only the INDEX draws the cards built from it. A client half way through
 * picking a new time does not need their whole appointment history underneath
 * the calendar; that screen is one task, and the cards below it were noise.
 *
 * A layout cannot pass props to `children`, so the data travels as context and
 * the index decides what to render. The task screens simply do not read it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function PortalContextProvider({
  value,
  children,
}: {
  value: PortalContextValue;
  children: React.ReactNode;
}) {
  return <PortalContext.Provider value={value}>{children}</PortalContext.Provider>;
}

/** Null outside the portal section, which is a legitimate state, not a fault. */
export function usePortalContext(): PortalContextValue | null {
  return useContext(PortalContext);
}
