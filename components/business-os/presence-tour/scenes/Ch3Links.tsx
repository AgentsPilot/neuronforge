'use client';

import { Link2, MessageSquare, Clock } from 'lucide-react';
import { Panel, IconTile, Badge, Btn, Caption, Cursor, GoCode, StatTile, TONE } from '../stageKit';
import { seg, fade, press, lerp, easeInOutCubic, easeOutBack, easeOutCubic } from '../timing';
import { FAKE, type SceneProps } from '../storyboard';

/**
 * Chapter 3 — a link, and why there are two of them.
 *
 * The longest chapter, because this is the question nothing on the page
 * answers and the one the owner asked first.
 *
 * Traced from `app/business-os/website/page.tsx`: the identity column
 * (4404-4478), the row actions including Activate (4481-4660), the row stat
 * tiles (4686-4716) and the amber gap notice (4314-4365).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FACTS IT MUST NOT GET WRONG
 *
 * From `SmartLinkRepository.getOrCreateDefaultLinks`:
 *
 *   - the BOOKING link is born `is_active: false`, deliberately, because
 *     switched on with no working hours it sends people to a page with no
 *     times to pick;
 *   - the CONTACT form is born on, and the code's own comment is the reason:
 *     "it sells nothing and cannot dead-end".
 *
 * That is the honest answer to "why two": one sells, one listens. Do not let
 * this scene imply the booking link is broken, or that the off state is an
 * oversight. It is a guard.
 */

/*
 * Which picture goes with which sentence.
 *
 *   0  the two rows, as the page draws them
 *   1  what each one opens
 *   2  why the selling one arrives switched off
 *   3  ...and why the listening one does not  (the same picture, held)
 *
 * Driven by `beat`, never by a fraction of the chapter: the chapter's length
 * now follows the script, so a hardcoded 0.62 would slide away from the
 * sentence it was chosen to match the moment anyone edited a caption.
 */
export function Ch3Links({ beat, ub, t, isRTL, ctx }: SceneProps) {
  /*
   *   0  what a smart link IS, and why we made you one
   *   1  what it does for you  (branches: with a website, or instead of one)
   *   2  the two rows, as the page draws them
   *   3  what each one opens
   *   4  why the selling one arrives switched off
   *   5  ...and why the listening one does not  (same picture, held)
   */
  const inWhat = beat === 0;
  const inSell = beat === 1;
  /*
   * Beats 2 to 5 share ONE picture. They are four sentences about the same
   * two rows, so the rows arrive on beat 2 and stay until the chapter ends;
   * each later beat annotates them rather than replacing them.
   */
  const inRows = beat >= 2;

  /* The activation plays across beat 4; beat 5 holds the result. */
  const whyU = beat === 4 ? ub : 1;
  const u = ub;
  const cursorX = lerp(0.18, 0.78, easeInOutCubic(seg(whyU, 0.3, 0.6)));
  const pressScale = press(whyU, 0.6, 0.72);
  /** The badge only flips AFTER the press, never before. */
  const activated = whyU > 0.7;

  return (
    <div className="flex h-full flex-col p-4">
      {/*
        * Content is CENTRED in the stage, not pinned to the top.
        *
        * The script is normally spoken rather than printed, so the caption row
        * below collapses to nothing — which left every scene hugging the top
        * of a 340px panel above a large void, and the whole thing read as a
        * component that had failed to load.
        */}
      <div className="flex flex-1 flex-col justify-center gap-2.5">
        {/* ── Why it exists: something to send when someone asks ──────── */}
        {inWhat && (
          <div className="flex flex-col gap-2" style={{ opacity: seg(u, 0, 0.08) }}>
            {/* Their question. */}
            <div
              className="max-w-[72%] self-start rounded-2xl rounded-ss-sm px-3.5 py-2.5"
              style={{
                background: 'var(--v2-surface)',
                border: '1px solid var(--v2-border)',
                opacity: seg(u, 0.05, 0.2),
              }}
            >
              <p className="text-[12.5px] text-[var(--v2-text-primary)]">
                {t('presence.tour.links.ask')}
              </p>
            </div>

            {/* Your answer: one link instead of retyping everything. */}
            <div
              className="max-w-[78%] self-end rounded-2xl rounded-ee-sm px-3.5 py-2.5"
              style={{
                background: `${TONE.primary}1A`,
                border: `1px solid ${TONE.primary}55`,
                opacity: seg(u, 0.3, 0.46),
                transform: `translateY(${lerp(8, 0, easeOutBack(seg(u, 0.3, 0.5)))}px)`,
              }}
            >
              <p className="text-[12.5px] text-[var(--v2-text-primary)]">
                {t('presence.tour.links.reply')}
              </p>
              <p dir="ltr" className="mt-1 font-mono text-[11px]" style={{ color: TONE.primary }}>
                /go/{ctx.bookingCode}
              </p>
            </div>
          </div>
        )}

        {/* ── What it does for them ───────────────────────────────────── */}
        {inSell && (
          <div style={{ opacity: seg(u, 0, 0.08) }}>
            <Panel className="p-3.5">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--v2-text-muted)]">
                {t('presence.tour.links.bookingPage')}
              </p>
              <div className="flex flex-col gap-1.5">
                {[
                  { name: FAKE.serviceA, price: FAKE.priceA },
                  { name: FAKE.serviceB, price: '' },
                ].map((row, i) => (
                  <div
                    key={row.name}
                    className="flex items-center justify-between rounded-lg border border-[var(--v2-border)] px-3 py-2"
                    style={{
                      opacity: seg(u, 0.08 + i * 0.08, 0.24 + i * 0.08),
                      transform: `translateY(${lerp(6, 0, easeOutCubic(seg(u, 0.08 + i * 0.08, 0.28 + i * 0.08)))}px)`,
                    }}
                  >
                    <span className="text-[12.5px] text-[var(--v2-text-primary)]">{row.name}</span>
                    <span className="text-[12.5px] font-semibold" style={{ color: TONE.primary }}>
                      {row.price}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-2.5 grid grid-cols-4 gap-1.5" style={{ opacity: seg(u, 0.34, 0.5) }}>
                {['9:00', '11:30', '14:00', '16:30'].map((slot, i) => (
                  <span
                    key={slot}
                    dir="ltr"
                    className="rounded py-1 text-center text-[10.5px]"
                    style={{
                      border: `1px solid ${i === 1 ? TONE.primary : 'var(--v2-border)'}`,
                      color: i === 1 ? TONE.primary : 'var(--v2-text-secondary)',
                      background: i === 1 ? `${TONE.primary}14` : 'transparent',
                    }}
                  >
                    {slot}
                  </span>
                ))}
              </div>
              <div className="mt-2.5" style={{ opacity: seg(u, 0.54, 0.68) }}>
                <Btn tone={TONE.primary} filled>
                  {t('presence.tour.links.bookIt')}
                </Btn>
              </div>
            </Panel>
          </div>
        )}

        {/* ── 2-5. The two rows, PERSISTENT, annotated as the voice goes ── */}
        {/*
          * One picture for four beats, not four pictures.
          *
          * Beats 2 through 5 are all ABOUT these two rows — there are two of
          * them, here is what each opens, here is why one is off, here is why
          * the other is not. The first version swapped the picture every time,
          * so the rows appeared for five seconds and vanished mid-explanation
          * while the voice was still describing them.
          *
          * Now they arrive once and stay for the whole argument, roughly
          * twenty-two seconds, and each beat ADDS to them: a line about what
          * each opens, then the gap notice and the switch, then the reason the
          * contact form never needed one.
          */}
        {inRows && (
          <div className="flex flex-col gap-2.5" style={{ opacity: seg(u, 0, 0.06) }}>
            {/* The real amber gap notice, above the row it is about. */}
            {beat >= 4 && (
              <div
                className="flex items-start gap-2.5 p-2.5"
                style={{
                  background: `${TONE.amber}14`,
                  border: `1px solid ${TONE.amber}55`,
                  borderRadius: 'var(--v2-radius-card, 16px)',
                  opacity: beat === 4 ? seg(u, 0.04, 0.16) : 1,
                }}
              >
                <Clock className="mt-px h-3.5 w-3.5 shrink-0" style={{ color: TONE.amber }} />
                <p className="text-[11.5px] leading-relaxed text-[var(--v2-text-secondary)]">
                  {t('presence.tour.links.whyOff')}
                </p>
              </div>
            )}

            <div className="relative">
              <LinkRow
                t={t}
                name={t('presence.tour.links.bookingName')}
                sub={t('presence.tour.links.bookingType')}
                opens={t('presence.tour.links.bookingPage')}
                showOpens={beat >= 3}
                code={ctx.bookingCode}
                tone={TONE.primary}
                live={beat >= 4 ? activated : ctx.bookingLinkActive}
                icon={<Link2 className="h-[17px] w-[17px]" />}
                showStats={beat < 4}
                sells
                action={
                  beat >= 4 ? (
                    <Btn
                      tone={activated ? TONE.success : TONE.primary}
                      pressScale={beat === 4 ? pressScale : 1}
                    >
                      {activated
                        ? t('presence.tour.badge.live')
                        : t('presence.tour.links.activate')}
                    </Btn>
                  ) : undefined
                }
              />
              {beat === 4 && (
                <Cursor
                  x={cursorX}
                  y={18}
                  isRTL={isRTL}
                  opacity={fade(whyU, 0.26, 0.32, 0.86, 0.94)}
                />
              )}
            </div>

            <LinkRow
              t={t}
              name={t('presence.tour.links.contactName')}
              sub={t('presence.tour.links.contactType')}
              opens={t('presence.tour.links.contactPage')}
              showOpens={beat >= 3}
              code={ctx.contactCode}
              tone={TONE.purple}
              live
              icon={<MessageSquare className="h-[17px] w-[17px]" />}
              showStats={beat < 4}
              /* Beat 5 is the one about this row, so it lifts then. */
              emphasis={beat === 5}
            />
          </div>
        )}
      </div>

      <div className="pt-3">
        <Caption opacity={seg(u, 0, 0.05)}>
          {beat === 0 && t('presence.tour.links.capWhat')}
          {beat === 1 &&
            t(ctx.wantsWebsite
              ? 'presence.tour.links.capSellWeb'
              : 'presence.tour.links.capSellNoWeb')}
          {beat === 2 && t('presence.tour.links.capRows')}
          {beat === 3 && t('presence.tour.links.capSplit')}
          {beat === 4 && t('presence.tour.links.capWhy')}
          {beat === 5 && t('presence.tour.links.capWhyB')}
        </Caption>
      </div>
    </div>
  );
}

/* ── Local pieces ──────────────────────────────────────────────────────── */

function LinkRow({
  t,
  name,
  sub,
  opens,
  showOpens = false,
  code,
  tone,
  live,
  icon,
  action,
  showStats = false,
  sells = false,
  emphasis = false,
}: {
  t: SceneProps['t'];
  name: string;
  sub: string;
  code: string;
  tone: string;
  live: boolean;
  icon: React.ReactNode;
  action?: React.ReactNode;
  showStats?: boolean;
  /** This row takes bookings. The contact form does not. */
  sells?: boolean;
  /** What it opens, revealed on the beat that explains it. */
  opens?: string;
  showOpens?: boolean;
  /** Lifted while the voice is about this row specifically. */
  emphasis?: boolean;
}) {
  return (
    <Panel
      className="flex items-center gap-3 px-4 py-3 transition-none"
      style={
        emphasis
          ? { borderColor: TONE.purple, transform: 'translateY(-3px)' }
          : undefined
      }
    >
      <IconTile tone={tone}>{icon}</IconTile>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[var(--v2-text-primary)]">{name}</span>
          <Badge tone={live ? 'live' : 'inactive'}>
            {live ? t('presence.tour.badge.live') : t('presence.tour.badge.inactive')}
          </Badge>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <GoCode code={code} />
          <span className="text-xs text-[var(--v2-text-muted)]">· {sub}</span>
        </div>
        {/* What it opens. Appears on the beat that explains the difference. */}
        {showOpens && opens ? (
          <div className="mt-1 flex items-center gap-1.5">
            <span
              className="h-1 w-1 shrink-0 rounded-full"
              style={{ background: tone }}
            />
            <span className="text-[11.5px]" style={{ color: tone }}>
              {opens}
            </span>
          </div>
        ) : null}
      </div>
      {showStats && (
        <div className="hidden items-center gap-1.5 sm:flex">
          <StatTile label={t('presence.tour.stats.clicks')} value={FAKE.clicks} />
          {/*
            * The two rows do NOT report the same thing.
            *
            * A contact form cannot take a booking — that is the entire point
            * this chapter is making — so showing it a "Booked" count flatly
            * contradicts the sentence being spoken over it. It counts
            * messages; only the services link counts bookings.
            */}
          {sells ? (
            <StatTile label={t('presence.tour.stats.conversions')} value={FAKE.conversions} />
          ) : (
            <StatTile label={t('presence.tour.stats.messages')} value={FAKE.messages} />
          )}
        </div>
      )}
      {action}
    </Panel>
  );
}
