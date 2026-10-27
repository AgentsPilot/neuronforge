'use client';

import { Globe, FileText, Link2, Mail, MessageSquare } from 'lucide-react';
import { Panel, IconTile, Badge, Caption, GoCode, TONE } from '../stageKit';
import { seg, lerp, easeOutCubic } from '../timing';
import { FAKE, type SceneProps } from '../storyboard';

/**
 * Chapter 1 — the capability map.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE CARD PER SITUATION, NOT ONE PER DATABASE TABLE
 *
 * The real page groups by object: a website card, a list of landing pages, a
 * list of smart links. That is the right way to ADMINISTER them and the wrong
 * way to explain them, because an owner does not arrive asking "what objects
 * exist", they arrive asking "which of these is for me".
 *
 * So the five cards are five situations:
 *
 *   a website with us        we build it from setup, you publish it
 *   your own website         keep it, connect the mailbox, enquiries land here
 *   contact-form link        a site with no form, or no site at all
 *   services link            the only thing here a client can actually BUY
 *   landing page             promoting one thing on its own
 *
 * The two smart links are deliberately SEPARATE cards. Sharing one made the
 * selling case share a sentence with the messaging case.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT TELLS THE OWNER'S OWN STORY
 *
 * The website card branches on `ctx.wantsWebsite` and is badged "Not needed"
 * rather than "Draft" for a business that declined one — a draft badge on a
 * site nobody asked for reads as a chore they are behind on. The links carry
 * their real codes and their real on/off state.
 *
 * `onlinePresenceGuidance` keeps the same discipline: a business that declined
 * a website is never told to build one. That answer was given.
 */

/**
 * Which card each beat is talking about. 0 is the opening line, which is
 * about the page as a whole, so nothing is singled out for it.
 *
 *   1 website · 2 own site · 3 contact link · 4,5 services · 6 landing
 */
const FOCUS = [0, 1, 2, 3, 4, 4, 5];

export function Ch0Doors({ u, beat, beatAt, t, ctx }: SceneProps) {
  const focus = FOCUS[beat] ?? 0;

  const enter = (i: number) => seg(u, 0.02 + i * 0.03, 0.1 + i * 0.03);

  const style = (mine: number, order: number) => {
    const on = focus === mine;
    const quiet = focus !== 0 && !on;
    return {
      opacity: enter(order) * (quiet ? 0.38 : 1),
      transform: `translateY(${lerp(8, 0, easeOutCubic(enter(order))) + (on ? -3 : 0)}px)`,
      borderColor: on ? TONE.primary : undefined,
    };
  };

  const capIn = beatAt.length > beat ? seg(u, beatAt[beat], beatAt[beat] + 0.025) : 1;

  return (
    <div className="flex h-full flex-col p-4">
      <div className="flex flex-1 flex-col justify-center gap-2">
        {/* ── 1. A website with us ───────────────────────────────────── */}
        <Row
          style={style(1, 0)}
          tone={TONE.primary}
          icon={<Globe className="h-4 w-4" />}
          title={t('presence.tour.doors.website')}
          sub={t('presence.tour.doors.websiteSub')}
          badge={
            ctx.wantsWebsite ? (
              <Badge tone={ctx.websitePublished ? 'live' : 'draft'}>
                {ctx.websitePublished
                  ? t('presence.tour.badge.live')
                  : t('presence.tour.badge.draft')}
              </Badge>
            ) : (
              <Badge tone="inactive">{t('presence.tour.doors.notNeeded')}</Badge>
            )
          }
        />

        {/* ── 2. A website they already have ─────────────────────────── */}
        {/*
          * Not an object on this page, and included anyway: an owner with
          * their own site reads the other four, concludes none apply, and
          * leaves. Real — `inboxChannelSetup.ts` ships a plan per provider,
          * and `InboxProvider` is exactly 'google-mail' | 'outlook'.
          */}
        <Row
          style={style(2, 1)}
          tone={TONE.amber}
          icon={<Mail className="h-4 w-4" />}
          title={t('presence.tour.doors.ownSite')}
          sub={t('presence.tour.doors.ownSiteSub')}
          badge={
            <div className="flex items-center gap-1">
              {['Gmail', 'Outlook'].map(n => (
                <span
                  key={n}
                  className="rounded px-1.5 py-0.5 text-[9.5px] font-medium"
                  style={{ border: '1px solid var(--v2-border)', color: 'var(--v2-text-muted)' }}
                >
                  {n}
                </span>
              ))}
            </div>
          }
        />

        {/* ── 3. The contact-form link ───────────────────────────────── */}
        <Row
          style={style(3, 2)}
          tone={TONE.purple}
          icon={<MessageSquare className="h-4 w-4" />}
          title={t('presence.tour.doors.contactLink')}
          sub={t('presence.tour.doors.contactLinkSub')}
          badge={
            <div className="flex items-center gap-2">
              <GoCode code={ctx.contactCode} />
              <Badge tone="live">{t('presence.tour.badge.live')}</Badge>
            </div>
          }
        />

        {/* ── 4. The services link: the one they sell with ───────────── */}
        <Row
          style={style(4, 3)}
          tone={TONE.primary}
          icon={<Link2 className="h-4 w-4" />}
          title={t('presence.tour.doors.servicesLink')}
          sub={t('presence.tour.doors.servicesLinkSub')}
          badge={
            <div className="flex items-center gap-2">
              {/* A price, because this is the card about money. */}
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                style={{ background: `${TONE.primary}1A`, color: TONE.primary }}
              >
                {FAKE.priceA}
              </span>
              <GoCode code={ctx.bookingCode} />
              <Badge tone={ctx.bookingLinkActive ? 'live' : 'inactive'}>
                {ctx.bookingLinkActive
                  ? t('presence.tour.badge.live')
                  : t('presence.tour.badge.inactive')}
              </Badge>
            </div>
          }
        />

        {/* ── 5. A landing page ──────────────────────────────────────── */}
        <Row
          style={style(5, 4)}
          tone={TONE.success}
          icon={<FileText className="h-4 w-4" />}
          title={t('presence.tour.doors.landing')}
          sub={t('presence.tour.doors.landingSub')}
        />
      </div>

      {/*
        * The script, shown only where there is no voice to carry it.
        * `Caption` returns null when the voice is doing the talking.
        */}
      <div className="pt-2">
        <Caption opacity={capIn}>
          {beat === 0 && t('presence.tour.doors.cap1')}
          {beat === 1 &&
            t(ctx.wantsWebsite
              ? 'presence.tour.doors.capSiteUs'
              : 'presence.tour.doors.capSiteNone')}
          {beat === 2 && t('presence.tour.doors.capOwn')}
          {beat === 3 && t('presence.tour.doors.capContact')}
          {beat === 4 && t('presence.tour.doors.capSell')}
          {beat === 5 && t('presence.tour.doors.capSellB')}
          {beat === 6 && t('presence.tour.doors.capPromo')}
        </Caption>
      </div>
    </div>
  );
}

/** One capability, compact enough that five fit the stage. */
function Row({
  style,
  tone,
  icon,
  title,
  sub,
  badge,
}: {
  style: React.CSSProperties;
  tone: string;
  icon: React.ReactNode;
  title: string;
  sub: string;
  badge?: React.ReactNode;
}) {
  return (
    <Panel className="flex items-center gap-2.5 px-3.5 py-2.5" style={style}>
      <IconTile tone={tone} size={30}>
        {icon}
      </IconTile>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-[var(--v2-text-primary)]">
          {title}
        </div>
        <div className="truncate text-[11px] text-[var(--v2-text-muted)]">{sub}</div>
      </div>
      {badge ? <div className="flex shrink-0 items-center">{badge}</div> : null}
    </Panel>
  );
}
