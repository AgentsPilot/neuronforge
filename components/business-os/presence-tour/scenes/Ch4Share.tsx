'use client';

import { Share2, Check, Megaphone } from 'lucide-react';
import { Panel, Caption, Cursor, TONE } from '../stageKit';
import { seg, fade, lerp, easeInOutCubic, easeOutBack, easeOutCubic } from '../timing';
import type { SceneProps } from '../storyboard';

/**
 * Chapter 5 — sharing a link.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS CHAPTER AND `ShareGuide` ANSWER DIFFERENT QUESTIONS
 *
 * `components/business-os/ShareGuide.tsx`, on every live link row, teaches
 * WHERE to put a link and whether each place will make it clickable — an
 * Instagram caption will not, which is the fact it exists for. Reproducing
 * that here would duplicate 675 lines and the best thing on the page.
 *
 * This teaches WHY you share from the menu at all: each destination gets its
 * own tagged link (`/go/{code}?v=wa`), `/go/[code]/route.ts` expands that into
 * UTMs, and the Channels view reads them back. The five destinations are the
 * real ones from `lib/business-os/channel-insights/shareDestinations.ts:67-71`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EACH BEAT SHOWS WHAT ITS SENTENCE IS ABOUT
 *
 * Beat 1 used to keep the share MENU on screen while the voice said "this page
 * can tell you where your clients came from". A result is not a menu, and the
 * mismatch was the most jarring thing in the film. Now:
 *
 *   0  the menu, and the tag each destination gets
 *   1  the RESULT weeks later, split by source, with the untracked pile
 *   2  the pointer at the per-row guide
 */

/** Matches SHARE_DESTINATIONS order. WhatsApp is the one that ticks. */
const DESTS = ['whatsapp', 'instagram', 'facebook', 'email', 'qr'] as const;
const TAGS = ['wa', 'ig', 'fb', 'em', 'qr'] as const;

/**
 * What the Channels view reports back, weeks later.
 *
 * Set dressing, but the SHAPE is real: `ChannelSourcesSection` splits leads
 * and bookings by source and keeps an untracked bucket for arrivals it could
 * not attribute. That bucket is the argument — it is where a link pasted by
 * hand ends up.
 */
const RESULTS = [
  { key: 'whatsapp', leads: 12, booked: 4, untracked: false },
  { key: 'instagram', leads: 7, booked: 1, untracked: false },
  { key: 'email', leads: 3, booked: 2, untracked: false },
  { key: 'untracked', leads: 9, booked: 0, untracked: true },
] as const;

export function Ch4Share({ beat, ub, t, isRTL }: SceneProps) {
  const u = ub;
  const cursorX = lerp(0.72, 0.3, easeInOutCubic(seg(u, 0.18, 0.44)));
  const menuOpen = seg(u, 0.16, 0.26);
  const picked = u > 0.52;

  return (
    <div className="flex h-full flex-col p-4">
      <div className="flex flex-1 flex-col justify-center">
        {/* ── 0. The menu, and the tag each destination carries ──────── */}
        {beat === 0 && (
          <div className="relative">
            <div className="mb-2.5 flex items-center justify-end">
              <span
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium"
                style={{
                  borderRadius: 'var(--v2-radius-button, 10px)',
                  border: `1px solid ${TONE.primary}`,
                  background: `${TONE.primary}1A`,
                  color: TONE.primary,
                }}
              >
                <Share2 className="h-[15px] w-[15px]" />
                {t('presence.tour.share.button')}
              </span>
            </div>

            <Panel
              className="overflow-hidden p-1.5"
              style={{
                opacity: menuOpen,
                transform: `translateY(${lerp(-6, 0, easeOutBack(menuOpen))}px)`,
                transformOrigin: 'top right',
              }}
            >
              {DESTS.map((d, i) => {
                const lit = d === 'whatsapp' && picked;
                return (
                  <div
                    key={d}
                    className="flex items-center gap-2.5 rounded-lg px-3 py-2"
                    style={{
                      background: lit ? `${TONE.success}14` : 'transparent',
                      opacity: seg(u, 0.2 + i * 0.03, 0.3 + i * 0.03),
                    }}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: lit ? TONE.success : 'var(--v2-border)' }}
                    />
                    <span className="flex-1 text-[13px] text-[var(--v2-text-primary)]">
                      {t(`presence.tour.share.${d}`)}
                    </span>
                    {/*
                      * The tag it actually gets. This is the whole reason to
                      * share from here rather than copy the address.
                      */}
                    <span
                      dir="ltr"
                      className="shrink-0 font-mono text-[10px] text-[var(--v2-text-muted)]"
                      style={{ opacity: seg(u, 0.34 + i * 0.04, 0.5 + i * 0.04) }}
                    >
                      ?v={TAGS[i]}
                    </span>
                    {lit && (
                      <Check
                        className="h-4 w-4 shrink-0"
                        style={{
                          color: TONE.success,
                          transform: `scale(${lerp(0.4, 1, easeOutBack(seg(u, 0.52, 0.62)))})`,
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </Panel>

            <Cursor x={cursorX} y={30} isRTL={isRTL} opacity={fade(u, 0.1, 0.16, 0.72, 0.82)} />
          </div>
        )}

        {/* ── 1. The result, weeks later ─────────────────────────────── */}
        {beat === 1 && (
          <Panel className="p-3.5" style={{ opacity: seg(u, 0, 0.06) }}>
            <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--v2-text-muted)]">
              {t('presence.tour.share.results')}
            </p>

            <div className="mb-1 flex items-center gap-2 text-[10px] text-[var(--v2-text-muted)]">
              <span className="flex-1" />
              <span className="w-12 text-center">{t('presence.tour.share.leads')}</span>
              <span className="w-12 text-center">{t('presence.tour.share.booked')}</span>
            </div>

            {RESULTS.map((row, i) => (
              <div
                key={row.key}
                className="flex items-center gap-2 border-t border-[var(--v2-border)] py-1.5"
                style={{
                  opacity: seg(u, 0.08 + i * 0.07, 0.24 + i * 0.07),
                  transform: `translateY(${lerp(5, 0, easeOutCubic(seg(u, 0.08 + i * 0.07, 0.3 + i * 0.07)))}px)`,
                }}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: row.untracked ? 'var(--v2-border)' : TONE.success }}
                />
                <span
                  className="flex-1 truncate text-[12.5px]"
                  style={{
                    color: row.untracked ? 'var(--v2-text-muted)' : 'var(--v2-text-primary)',
                  }}
                >
                  {row.untracked
                    ? t('presence.tour.share.untracked')
                    : t(`presence.tour.share.${row.key}`)}
                </span>
                <span
                  className="w-12 text-center text-[12.5px] font-semibold tabular-nums"
                  style={{
                    color: row.untracked ? 'var(--v2-text-muted)' : 'var(--v2-text-primary)',
                  }}
                >
                  {row.leads}
                </span>
                <span
                  className="w-12 text-center text-[12.5px] font-semibold tabular-nums"
                  style={{ color: row.untracked ? 'var(--v2-text-muted)' : TONE.success }}
                >
                  {row.booked}
                </span>
              </div>
            ))}
          </Panel>
        )}

        {/* ── 2. The per-row guide this chapter deliberately defers to ─ */}
        {beat === 2 && (
          <Panel
            className="flex items-center gap-3 px-4 py-4"
            style={{ opacity: seg(u, 0, 0.06) }}
          >
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full"
              style={{ background: `${TONE.purple}1A` }}
            >
              <Megaphone className="h-[18px] w-[18px]" style={{ color: TONE.purple }} />
            </span>
            <p className="text-[12.5px] leading-relaxed text-[var(--v2-text-secondary)]">
              {t('presence.tour.share.capGuide')}
            </p>
          </Panel>
        )}
      </div>

      <div className="pt-3">
        <Caption opacity={seg(u, 0, 0.05)}>
          {beat === 0 && t('presence.tour.share.capWhy')}
          {beat === 1 && t('presence.tour.share.capTracked')}
          {beat === 2 && t('presence.tour.share.capGuide')}
        </Caption>
      </div>
    </div>
  );
}
