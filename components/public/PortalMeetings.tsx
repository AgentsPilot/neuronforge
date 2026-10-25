'use client';

import { useMemo, useState } from 'react';
import { CalendarClock, CheckCheck, ChevronLeft, ChevronRight, X } from 'lucide-react';

import { PublicCard } from '@/components/public/PublicCard';
import { formatPublicDate, publicT } from '@/lib/i18n/public-pages';
import type { PublicBrand } from '@/lib/branding/publicBranding';

export interface PortalMeeting {
  id: string;
  serviceName: string | null;
  startTime: string | null;
  /** `confirmed` | `pending` | `completed` | `cancelled` | `no_show`. */
  status: string;
  /**
   * `held` | `no_show` | `cancelled`, or null where nobody has said yet.
   *
   * The job's `status` answers whether the WORK is on; this answers what
   * happened at the appointment. Reading the former for the latter is why a
   * missed meeting showed the client no label at all.
   */
  meetingStatus?: string | null;
  /** Marked held by the business, rather than merely in the past. */
  held: boolean;
  upcoming: boolean;
  /** The one whose link this portal was opened with. */
  isCurrent: boolean;
  /** Its own signed link into this portal, or null when none could be minted. */
  token: string | null;
  /**
   * Whether this appointment can still be moved: standing, dated, and outside
   * the business's notice window. Computed by the portal route against the
   * same rule the reschedule route enforces, so a row never offers a change
   * that is about to be refused.
   */
  canModify?: boolean;
  /**
   * The SESSION this row is, for a package.
   *
   * A package is one booking with N meetings, so a session has no portal of
   * its own to link to: the row opens the PURCHASE's portal with the session
   * named, and the reschedule panel there moves that hour. Absent for a row
   * that is its own booking, which opens its own portal as it always did.
   */
  meetingId?: string | null;
  /**
   * How many meetings this row stands for.
   *
   * 1 for an ordinary booking, and the number of sessions for a package — a
   * package is ONE thing the client bought, and its six meetings listed
   * individually turned "my bookings" into a transcript. The row names the
   * package and says how many; the meetings themselves are listed, with their
   * own dates and their own actions, on the package card in the portal.
   */
  sessions?: number;
}

interface PortalMeetingsProps {
  brand: PublicBrand;
  meetings: PortalMeeting[];
  /**
   * The business's clock, so a date here matches the one the owner sees.
   *
   * Without it these rows were formatted on the READER's device. An appointment
   * at 23:00 Israel time is already the next day for a client opening the link
   * in London, so the portal and the contact drawer named different days for
   * one booking — and the portal is the version the client believes.
   */
  timeZone: string | null;
}

/** Four rows a page: enough to be a list, short enough to stay a rail. */
const PER_PAGE = 4;

/**
 * Every appointment this client has with this business.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT PAGINATES RATHER THAN EXPANDS
 *
 * A client who has been coming for a year has dozens. Showing four and hiding
 * the rest behind "show all" means the rail is either too short to be useful or
 * suddenly longer than the page beside it — and on a phone, expanding it pushes
 * everything else off the screen. Four at a time with a pair of arrows is the
 * same information at a constant height.
 *
 * The LIST is resolved on the server, once, by the layout. This component only
 * decides which four of it to draw, so turning a page costs no request and
 * nothing reloads.
 *
 * Ordered by the date of the booking, newest at the top, in one list. Each row
 * still says whether it is coming up or done — that is a label on the row, and
 * no longer a reason to move it above or below anything.
 *
 * A package is ONE row here, however many sessions it has. The sessions
 * themselves are listed on the package card in the portal, each with its own
 * date and its own reschedule and cancel.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function PortalMeetings({ brand, meetings, timeZone }: PortalMeetingsProps) {
  const [page, setPage] = useState(0);

  const t = (key: string) => publicT(brand.locale, key);
  /* The chevrons follow the reading direction, not the axis. */
  const Previous = brand.dir === 'rtl' ? ChevronRight : ChevronLeft;
  const Next = brand.dir === 'rtl' ? ChevronLeft : ChevronRight;

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * ONE LIST, BY THE DATE OF THE BOOKING, NEWEST FIRST.
   *
   * This was two blocks: what is still coming, soonest first, then what is
   * done, most recent first. Each half read correctly on its own and the
   * seam between them did not — the same date could appear near the top and
   * again near the bottom depending only on whether it had passed, so the
   * list had no single order a client could follow. Asked for and settled as
   * one ordering over every row.
   *
   * `upcoming` is still carried per row, because each one still SAYS which it
   * is; it just no longer decides where the row sits.
   *
   * A row with no date is a purchase rather than a meeting — a product, or a
   * package container with no sessions. It sorts last rather than being
   * dropped, because the client still has it.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const ordered = useMemo(() => {
    const at = (value: string | null) => (value ? new Date(value).getTime() : null);
    return [...meetings].sort((a, b) => {
      const left = at(a.startTime);
      const right = at(b.startTime);
      if (left === null && right === null) return 0;
      if (left === null) return 1;
      if (right === null) return -1;
      return right - left;
    });
  }, [meetings]);

  /**
   * What this one is, in a word, and whether it still counts.
   *
   * Every row says which it is. A list that showed a cancelled booking and a
   * held one identically would be a list a client cannot read, and the status
   * is the first thing they are looking for.
   */
  const describe = (meeting: PortalMeeting) => {
    if (meeting.meetingStatus === 'cancelled' || meeting.status === 'cancelled') {
      return { label: t('cancelled'), Icon: X, spent: true };
    }
    if (meeting.meetingStatus === 'no_show' || meeting.status === 'no_show') {
      // The business's word for this is "no-show". That is a judgement, and not
      // one to put in front of the client; what is true for both is that it did
      // not happen.
      return { label: t('portal.missed'), Icon: X, spent: true };
    }
    if (meeting.held) {
      return { label: t('portal.held'), Icon: CheckCheck, spent: true };
    }
    return { label: null, Icon: CalendarClock, spent: false };
  };

  if (ordered.length === 0) return null;

  const pages = Math.ceil(ordered.length / PER_PAGE);
  // Clamped rather than trusted: a list that shrinks under a reader (a booking
  // cancelled in another tab) would otherwise leave them on a blank page.
  const current = Math.min(page, pages - 1);
  const shown = ordered.slice(current * PER_PAGE, current * PER_PAGE + PER_PAGE);

  const arrowStyle = {
    color: 'var(--ap-text-muted)',
    border: '1px solid var(--ap-border)',
    borderRadius: 'var(--ap-radius-md)',
  } as const;

  return (
    /* The surface is the TEMPLATE's: see PublicCard. `p-5` applies only on a
       palette-only theme, where no composition sets its own padding. */
    <PublicCard className="p-5">
      <div className="mb-2 flex items-center gap-2">
        <h2
          className="text-xs font-semibold"
          style={{
            color: 'var(--ap-text-muted)',
            // Hebrew has no case; uppercase only adds unnatural letter-spacing.
            letterSpacing: brand.locale === 'he' ? 'normal' : '0.05em',
            textTransform: brand.locale === 'he' ? 'none' : 'uppercase',
          }}
        >
          {t('portal.my_meetings')}
        </h2>

        {/* The count, so a client knows whether turning a page is worth it. */}
        <span className="ms-auto text-xs tabular-nums" style={{ color: 'var(--ap-text-muted)' }}>
          {ordered.length}
        </span>
      </div>

      <ul>
        {shown.map((meeting, index) => {
          const { label, Icon, spent } = describe(meeting);

          const body = (
            <>
              <span
                aria-hidden
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                style={{
                  background: meeting.upcoming ? 'var(--ap-brand-tint)' : 'var(--ap-surface-2)',
                  color: meeting.upcoming ? 'var(--ap-brand)' : 'var(--ap-text-muted)',
                }}
              >
                <Icon className="h-3 w-3" />
              </span>

              <span className="min-w-0 flex-1">
                <span
                  className="block truncate font-semibold"
                  style={{
                    color: spent ? 'var(--ap-text-muted)' : 'var(--ap-text)',
                    textDecoration: meeting.status === 'cancelled' ? 'line-through' : undefined,
                  }}
                >
                  <bdi>{meeting.serviceName || '—'}</bdi>
                </span>

                <span className="block text-xs" style={{ color: 'var(--ap-text-muted)' }}>
                  {/* A booking with no date is a purchase rather than a meeting
                      — a product, or the container a package hangs from. It is
                      still something the client has. */}
                  {meeting.startTime
                    ? formatPublicDate(
                        new Date(meeting.startTime),
                        brand.locale,
                        {
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                        },
                        // The business's clock. Same instant, same day as the
                        // owner's contact drawer reports it.
                        timeZone
                      )
                    : t('portal.no_date')}
                  {/*
                    A package says so on its own row, because the date beside
                    it is one session's and the row stands for all of them.
                    Without this the client sees a single line where six used
                    to be and no sign that the other five are still theirs.
                  */}
                  {(meeting.sessions ?? 1) > 1 &&
                    ` · ${t('portal.package_of').replace('{count}', String(meeting.sessions))}`}
                  {label && ` · ${label}`}
                </span>
              </span>

              {meeting.token && (
                <Next
                  className="h-4 w-4 shrink-0"
                  style={{ color: 'var(--ap-text-muted)' }}
                  aria-hidden
                />
              )}
            </>
          );

          const rowStyle = {
            borderTop: index === 0 ? undefined : '1px solid var(--ap-border)',
            /* The one they are on, marked rather than hidden. */
            background: meeting.isCurrent ? 'var(--ap-brand-tint)' : undefined,
            borderRadius: meeting.isCurrent ? 'var(--ap-radius-md)' : undefined,
            paddingInline: meeting.isCurrent ? '0.5rem' : undefined,
            marginInline: meeting.isCurrent ? '-0.5rem' : undefined,
          };

          /*
           * Linked wherever a token could be minted. Each row opens THAT
           * booking's own portal — the same screens, for a different
           * appointment — which is the only way a client can cancel or move one
           * they did not arrive on.
           */
          /*
           * A session opens the purchase's portal with `?session=`, because it
           * has no portal of its own — there is no booking behind it. Straight
           * to the reschedule card, which is the one thing a client comes to a
           * session row to do; `canModify` decides whether it is offered at
           * all, the same rule the route enforces.
           */
          const href = meeting.meetingId
            ? `/book/manage/${meeting.token}?task=reschedule&session=${encodeURIComponent(meeting.meetingId)}`
            : `/book/manage/${meeting.token}`;

          return meeting.token && (!meeting.meetingId || meeting.canModify) ? (
            <li key={meeting.id} style={rowStyle}>
              <a
                href={href}
                className="-mx-2 flex items-center gap-2.5 rounded-lg px-2 py-2.5 text-sm transition-opacity hover:opacity-70"
              >
                {body}
              </a>
            </li>
          ) : (
            <li
              key={meeting.id}
              className="flex items-center gap-2.5 py-2.5 text-sm"
              style={rowStyle}
            >
              {body}
            </li>
          );
        })}
      </ul>

      {pages > 1 && (
        <div
          className="mt-2 flex items-center gap-2 border-t pt-3"
          style={{ borderColor: 'var(--ap-border)' }}
        >
          <span className="text-xs tabular-nums" style={{ color: 'var(--ap-text-muted)' }}>
            {current + 1} / {pages}
          </span>

          <div className="ms-auto flex items-center gap-1.5">
            <button
              type="button"
              aria-label={t('back')}
              onClick={() => setPage(value => Math.max(0, value - 1))}
              disabled={current === 0}
              className="flex h-7 w-7 items-center justify-center transition-opacity hover:opacity-60 disabled:opacity-30"
              style={arrowStyle}
            >
              <Previous className="h-3.5 w-3.5" aria-hidden />
            </button>

            <button
              type="button"
              aria-label={t('portal.all_meetings')}
              onClick={() => setPage(value => Math.min(pages - 1, value + 1))}
              disabled={current >= pages - 1}
              className="flex h-7 w-7 items-center justify-center transition-opacity hover:opacity-60 disabled:opacity-30"
              style={arrowStyle}
            >
              <Next className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        </div>
      )}
    </PublicCard>
  );
}
