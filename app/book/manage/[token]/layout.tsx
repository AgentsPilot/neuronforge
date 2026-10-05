// app/book/manage/[token]/layout.tsx

import type { Metadata } from 'next';

import { PortalRail, type PortalMeeting } from '@/components/public/PortalRail';
import { PortalShell } from '@/components/public/PortalShell';
import { PublicBrandProvider } from '@/components/public/PublicBrandProvider';
import { PublicDirScript } from '@/components/public/PublicDirScript';
import { PublicFontLinks } from '@/components/public/PublicFontLinks';
import { PublicThemeStyle } from '@/components/public/PublicThemeStyle';
import { resolvePublicBranding } from '@/lib/branding/publicBranding';
import { publicT } from '@/lib/i18n/public-pages';
import { supabaseServer } from '@/lib/supabaseServer';
import { generateBookingToken, verifyBookingToken } from '@/lib/services/BookingEmailService';

interface PortalContext {
  clientName: string | null;
  clientEmail: string | null;
  timeZone: string | null;
  meetings: PortalMeeting[];
}

const EMPTY_CONTEXT: PortalContext = {
  clientName: null,
  clientEmail: null,
  timeZone: null,
  meetings: [],
};

/**
 * How many of this client's other appointments the rail will carry.
 *
 * The rail PAGINATES through these four at a time, so this is the whole list
 * rather than a first page of it. Capped all the same: a client of five years
 * has hundreds, every one of which would be signed, serialised and shipped to
 * the browser to fill a column nobody scrolls that far down.
 */
const MEETINGS_LIMIT = 60;

/**
 * Who the client is, and what they have had before — resolved on the SERVER.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The pages each fetch their own booking and so learn all of this a moment
 * after they paint. Reading it here means the bar and the rail are complete in
 * the first byte of HTML, and — because both now live in this layout — they are
 * read ONCE for the whole section instead of again on every navigation between
 * the portal, cancel and reschedule.
 *
 * The token is the authorization, exactly as it is for the branding above: it
 * proves the holder was sent this booking's link by email. Everything returned
 * is that client's own: their name, their address, their past appointments with
 * this one business. Nothing here widens what the link already grants.
 *
 * Any failure returns the empty context rather than throwing. A rail without a
 * past is the ordinary case anyway — a first-time client has none — so a
 * missing one costs nothing, where a layout that throws takes the booking with
 * it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function portalContextFor(token: string): Promise<PortalContext> {
  try {
    const decoded = verifyBookingToken(token);
    if (!decoded?.bookingId) return EMPTY_CONTEXT;

    const { data: booking } = await supabaseServer
      .from('scheduling_bookings')
      .select('user_id, contact_id, timezone, contact:crm_contacts(first_name, last_name, email)')
      .eq('id', decoded.bookingId)
      .maybeSingle();

    if (!booking) return EMPTY_CONTEXT;

    const contact = Array.isArray(booking.contact) ? booking.contact[0] : booking.contact;
    const clientName = [contact?.first_name, contact?.last_name].filter(Boolean).join(' ').trim();

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * EVERY APPOINTMENT THIS CLIENT HAS WITH THIS BUSINESS.
     *
     * Coming up and already held, newest-first within each — the portal is
     * their record with the business, and a portal holding only the one booking
     * they happened to click is a page.
     *
     * EVERY status, and every row — including the ones with no date.
     *
     * The filters here were costing a client more than half their history: one
     * contact with fourteen bookings was shown five, because `cancelled` and
     * `no_show` were excluded and so was every row without a `start_time`. A
     * list that silently drops two thirds of itself is worse than no list, so
     * the rule is now that the portal shows what exists and says what each one
     * is. A cancelled booking reads as cancelled; a no-show is labelled "did
     * not take place" rather than named as a no-show, which is the business's
     * word for it and not a thing to put to the client.
     *
     * A row with no `start_time` is a purchase rather than a meeting — a
     * product, or the container a package's sessions hang from. It is still
     * something the client has, so it is listed, without a date.
     *
     * Scoped to the contact AND the owner, so the list cannot cross a tenant
     * even if a contact id were ever reused. A package's child meetings carry
     * their own rows and appear in their own right, which is correct: each is
     * separately cancellable and separately linkable.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const { data: others } = booking.contact_id
      ? await supabaseServer
          .from('scheduling_bookings')
          .select('id, start_time, status, service:scheduling_services(service_name)')
          .eq('contact_id', booking.contact_id)
          .eq('user_id', booking.user_id)
          /*
           * The booking being viewed is IN the list, not excluded from it.
           *
           * Left out, a client with three appointments saw two and a count that
           * said two — so the one screen that is supposed to be their whole
           * record with the business was the one place that could not show it
           * to them. It is marked as the current one instead and carries no
           * link, because it is the page they are already on.
           */
          .order('start_time', { ascending: false, nullsFirst: false })
          .limit(MEETINGS_LIMIT)
      : { data: [] };

    const now = Date.now();

    return {
      clientName: clientName || null,
      clientEmail: contact?.email || null,
      timeZone: booking.timezone || null,
      meetings: (others ?? []).map(row => {
        const service = Array.isArray(row.service) ? row.service[0] : row.service;
        const startTime = (row.start_time as string) || null;

        const isCurrent = row.id === decoded.bookingId;

        return {
          id: row.id as string,
          serviceName: (service?.service_name as string) || null,
          startTime,
          isCurrent,
          /*
           * "Held" is the status, not the clock. A booking still sitting at
           * `confirmed` a week after its date is a business that has not caught
           * up rather than a session that happened — but it is also plainly not
           * coming up, so it is listed as past and simply not ticked.
           */
          status: row.status as string,
          held: row.status === 'completed',
          /*
           * Only something still standing can be "coming up". A cancelled
           * booking next week is not an appointment the client has, and
           * sorting it to the top of the list would say it is.
           */
          upcoming: Boolean(
            startTime &&
              new Date(startTime).getTime() > now &&
              (row.status === 'confirmed' || row.status === 'pending')
          ),
          /*
           * Its own signed link.
           *
           * Minted here because this request has already proved the caller
           * holds a valid token for THIS client's address, and every row is
           * that same client's own booking — signing a sibling for the same
           * address grants nothing they did not already have. The same
           * reasoning, and the same function, as the package meeting list.
           */
          /*
           * A link only where there is something to do or see. A cancelled
           * booking's portal offers nothing but the news it is cancelled, which
           * the row already says.
           */
          token:
            isCurrent || !decoded.email || row.status === 'cancelled' || row.status === 'no_show'
              ? null
              : generateBookingToken(row.id as string, decoded.email),
        };
      }),
    };
  } catch {
    return EMPTY_CONTEXT;
  }
}

/**
 * The branded frame for every booking-management page.
 *
 * WHY THE BRANDING IS RESOLVED HERE AND NOT IN THE PAGES
 *
 * All four pages below are client components that fetched the booking and only
 * then learned the business's colour and language. So every one of them painted
 * an unbranded grey skeleton first, in the wrong direction, and snapped into
 * place a moment later — and the cancel page, which never read the language at
 * all, simply stayed in English LTR for Hebrew clients.
 *
 * Resolving from the token on the server means the page arrives already in the
 * right colours and the right direction, and no page has to remember to set
 * `dir` for itself.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const brand = await resolvePublicBranding({ by: 'bookingToken', token }, { includeInfo: false });

  return {
    title: brand
      ? `${publicT(brand.locale, 'manageBooking')} · ${brand.businessName}`
      : 'Booking',
    // A booking link identifies a real person's appointment. It must never
    // reach a search index.
    robots: { index: false, follow: false },
  };
}

export default async function BookingManageLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [brand, portal] = await Promise.all([
    resolvePublicBranding({ by: 'bookingToken', token }),
    portalContextFor(token),
  ]);

  // An invalid or expired token still has to render something. The page below
  // does its own verification and shows the branded "link expired" state, so
  // this just gets out of the way rather than throwing.
  if (!brand) return <>{children}</>;

  return (
    <>
      <PublicDirScript brand={brand} />
      <PublicFontLinks brand={brand} />
      <PublicThemeStyle brand={brand} />
      <PublicBrandProvider brand={brand}>
        {/*
          The portal's frame, mounted ONCE for the whole section.

          Rendered here rather than by each page so it survives navigation: the
          pages are client components that fetch their own booking, so a frame
          inside them was unmounted on every move between the portal, cancel and
          reschedule — the bar vanished, a bare spinner filled the screen, and
          the bar was drawn again. In the layout it simply stays, and the
          spinner appears underneath it.
        */}
        <PortalShell
          brand={brand}
          clientName={portal.clientName}
          aside={
            <PortalRail
              brand={brand}
              clientName={portal.clientName}
              clientEmail={portal.clientEmail}
              timeZone={portal.timeZone}
              meetings={portal.meetings}
            />
          }
        >
          {children}
        </PortalShell>
      </PublicBrandProvider>
    </>
  );
}
