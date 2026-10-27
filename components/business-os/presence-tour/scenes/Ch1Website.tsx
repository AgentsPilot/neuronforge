'use client';

import { Globe, Check, Sparkles } from 'lucide-react';
import { Panel, IconTile, Badge, Btn, Caption, Cursor, TONE } from '../stageKit';
import { seg, fade, press, lerp, easeInOutCubic, easeOutCubic, easeOutBack } from '../timing';
import { FAKE, type SceneProps } from '../storyboard';

/**
 * Chapter 2 — your website, from nothing to live.
 *
 * Traced from `app/business-os/website/page.tsx`: the header "+ Create
 * Website" control (5120-5128) and the Main Website Card (5340-5520), plus
 * `WebsiteSetupWizard.tsx:135-200` for the step order.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FOUR BEATS, BECAUSE TWO WAS A JUMP CUT
 *
 * The first version had one beat for "you have no website" and one for "here
 * is a published website", so it cut straight from an empty state to a live
 * site with nothing in between. The owner asked for both halves of the real
 * story — generate one with the wizard, or publish the draft we already wrote
 * — and neither half is a single frame:
 *
 *   0  no site yet, and the control that starts one
 *   1  the wizard: pick a look, we fill it from setup
 *   2  the result, written and saved, still private
 *   3  read it, press Publish, it goes live
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TEMPLATES ARE DRAWN, NOT LEFT BLANK
 *
 * They were three empty grey rectangles, which read as a component that had
 * failed to load rather than as a choice of layouts. Each is now a tiny page
 * with a header, a hero and some lines — enough to be recognisably a website
 * at 90 pixels wide.
 */
export function Ch1Website({ beat, ub, t, isRTL, ctx }: SceneProps) {
  const u = ub;

  /* Beat 0 — the cursor reaches the Create button and presses it. */
  const createX = lerp(0.35, 0.82, easeInOutCubic(seg(u, 0.15, 0.55)));
  const createPress = press(u, 0.55, 0.7);

  /* Beat 1 — a template is chosen, then the pages fill in. */
  const pickX = lerp(0.2, 0.52, easeInOutCubic(seg(u, 0.1, 0.42)));
  const picked = u > 0.46;
  const filling = seg(u, 0.56, 0.78);

  /* Beat 3 — Publish. */
  const pubX = lerp(0.25, 0.8, easeInOutCubic(seg(u, 0.2, 0.55)));
  const pubPress = press(u, 0.55, 0.68);
  const published = u > 0.64;

  return (
    <div className="relative flex h-full flex-col p-4">
      {/*
        * Content is CENTRED in the stage, not pinned to the top.
        *
        * The script is normally spoken rather than printed, so the caption row
        * below collapses to nothing — which left every scene hugging the top
        * of a 340px panel above a large void, and the whole thing read as a
        * component that had failed to load.
        */}
      <div className="flex flex-1 flex-col justify-center gap-2.5">
        {/* ── 0. No site yet ───────────────────────────────────────────── */}
        {beat === 0 && (
          <div className="relative" style={{ opacity: seg(u, 0, 0.06) }}>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-[var(--v2-text-primary)]">
                  {t('presence.tour.doors.website')}
                </p>
                <p className="text-xs text-[var(--v2-text-muted)]">
                  {t('presence.tour.doors.websiteSub')}
                </p>
              </div>
              <Btn tone={TONE.primary} filled pressScale={createPress}>
                + {t('presence.tour.website.create')}
              </Btn>
            </div>

            {/* The empty state the page actually shows before a site exists. */}
            <Panel className="grid min-h-[150px] place-items-center px-4 py-8">
              <div className="text-center">
                <IconTile tone={TONE.primary} size={40}>
                  <Globe className="h-5 w-5" />
                </IconTile>
                <p className="mt-2.5 text-xs text-[var(--v2-text-muted)]">
                  {t('presence.tour.website.cardTitle')}
                </p>
              </div>
            </Panel>

            <Cursor x={createX} y={6} isRTL={isRTL} opacity={fade(u, 0.1, 0.16, 0.86, 0.96)} />
          </div>
        )}

        {/* ── 1. The wizard ────────────────────────────────────────────── */}
        {beat === 1 && (
          <div className="relative" style={{ opacity: seg(u, 0, 0.06) }}>
            <Panel className="p-4">
              {/* Step chips, named rather than anonymous bars. */}
              <div className="mb-3 flex items-center gap-1">
                {[1, 2, 3, 4].map(n => {
                  const reached = filling > 0 ? n <= 3 : n === 1;
                  return (
                    <div key={n} className="flex-1">
                      <span
                        className="block h-1 rounded-full"
                        style={{
                          background: reached ? TONE.primary : 'var(--v2-border)',
                        }}
                      />
                    </div>
                  );
                })}
              </div>
              <p className="mb-3 text-xs font-semibold text-[var(--v2-text-primary)]">
                {filling > 0
                  ? t('presence.tour.website.filling')
                  : t('presence.tour.website.step1')}
              </p>

              {/* Three layouts you can actually tell apart. */}
              <div className="grid grid-cols-3 gap-2.5">
                {[0, 1, 2].map(i => (
                  <MiniSite
                    key={i}
                    variant={i}
                    chosen={picked && i === 1}
                    enter={seg(u, 0.04 + i * 0.05, 0.18 + i * 0.05)}
                    fill={i === 1 ? filling : 0}
                  />
                ))}
              </div>

              {filling > 0 && (
                <div
                  className="mt-3 flex items-center gap-1.5 text-[11px]"
                  style={{ opacity: filling, color: TONE.primary }}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {t('presence.tour.website.step2')} · {t('presence.tour.website.step3')}
                </div>
              )}
            </Panel>

            <Cursor x={pickX} y={70} isRTL={isRTL} opacity={fade(u, 0.06, 0.12, 0.5, 0.6)} />
          </div>
        )}

        {/* ── 2 and 3. The card, private then live ─────────────────────── */}
        {beat >= 2 && (
          <div className="relative" style={{ opacity: seg(u, 0, 0.06) }}>
            <Panel className="p-4">
              <div className="flex items-center gap-3">
                <IconTile tone={TONE.primary}>
                  <Globe className="h-[17px] w-[17px]" />
                </IconTile>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--v2-text-primary)]">
                      {t('presence.tour.website.cardTitle')}
                    </span>
                    <Badge tone={beat === 3 && published ? 'live' : 'draft'}>
                      {beat === 3 && published
                        ? t('presence.tour.badge.live')
                        : t('presence.tour.badge.draft')}
                    </Badge>
                  </div>
                  <div
                    dir="ltr"
                    className="mt-0.5 font-mono text-xs"
                    style={{
                      color:
                        beat === 3 && published ? TONE.primary : 'var(--v2-text-muted)',
                    }}
                  >
                    {ctx.subdomain || FAKE.domain}.agentspilot.com
                  </div>
                </div>
                {beat === 3 && (
                  <Btn
                    tone={published ? TONE.success : TONE.primary}
                    filled={!published}
                    pressScale={pubPress}
                  >
                    {published ? (
                      <>
                        <Check className="h-3.5 w-3.5" /> {t('presence.tour.badge.live')}
                      </>
                    ) : (
                      t('presence.tour.website.publish')
                    )}
                  </Btn>
                )}
              </div>

              {/* What the draft actually contains — the thing being published. */}
              <div className="mt-3 border-t border-[var(--v2-border)] pt-3">
                <MiniSite variant={1} chosen enter={1} fill={1} wide />
              </div>
            </Panel>

            {beat === 3 && (
              <Cursor x={pubX} y={44} isRTL={isRTL} opacity={fade(u, 0.14, 0.2, 0.8, 0.9)} />
            )}
          </div>
        )}
      </div>

      <div className="pt-3">
        <Caption opacity={seg(u, 0, 0.05)}>
          {beat === 0 &&
            t(ctx.wantsWebsite
              ? 'presence.tour.website.capB0'
              : 'presence.tour.website.capA0')}
          {beat === 1 &&
            t(ctx.wantsWebsite
              ? 'presence.tour.website.capB1'
              : 'presence.tour.website.capA1')}
          {beat === 2 && t('presence.tour.website.cap2')}
          {beat === 3 &&
            t(ctx.wantsWebsite
              ? 'presence.tour.website.capB3'
              : 'presence.tour.website.capA3')}
        </Caption>
      </div>
    </div>
  );
}

/**
 * A website, ninety pixels wide.
 *
 * Three variants so the chooser is a real choice rather than the same box
 * three times. `fill` animates the placeholder lines into actual service rows,
 * which is the moment "we write it from your setup" becomes visible.
 */
function MiniSite({
  variant,
  chosen,
  enter,
  fill,
  wide = false,
}: {
  variant: number;
  chosen: boolean;
  enter: number;
  fill: number;
  wide?: boolean;
}) {
  const line = (w: string, i: number) => (
    <span
      key={i}
      className="block h-1 rounded-full"
      style={{ width: w, background: 'var(--v2-border)' }}
    />
  );

  return (
    <div
      className="overflow-hidden"
      style={{
        border: `1px solid ${chosen ? TONE.primary : 'var(--v2-border)'}`,
        borderRadius: 10,
        background: 'var(--v2-bg)',
        opacity: enter,
        transform: `translateY(${lerp(8, 0, easeOutCubic(enter))}px) scale(${
          chosen ? lerp(1, 1.03, easeOutBack(Math.min(1, fill * 2 || 1))) : 1
        })`,
      }}
    >
      {/* header */}
      <div
        className="flex items-center gap-1 px-1.5 py-1"
        style={{ background: variant === 2 ? TONE.primary : 'var(--v2-surface)' }}
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: variant === 2 ? '#fff' : TONE.primary }}
        />
        <span
          className="h-1 w-5 rounded-full"
          style={{ background: variant === 2 ? 'rgba(255,255,255,.6)' : 'var(--v2-border)' }}
        />
      </div>

      {/* hero */}
      <div
        className={wide ? 'h-7' : variant === 0 ? 'h-6' : 'h-4'}
        style={{
          background:
            variant === 1
              ? `linear-gradient(90deg, ${TONE.primary}33, ${TONE.purple}22)`
              : 'var(--v2-surface)',
        }}
      />

      {/* body: placeholder lines that become real rows as it fills */}
      <div className="flex flex-col gap-1 p-1.5">
        {fill < 0.5
          ? ['70%', '50%', '60%'].map((w, i) => line(w, i))
          : ['Intro session · ₪200', 'Monthly package', 'Mon-Thu 9:00-17:00'].map((txt, i) => (
              <span
                key={i}
                className="block truncate text-[6px] leading-[1.6] text-[var(--v2-text-secondary)]"
                style={{ opacity: seg(fill, 0.5 + i * 0.12, 0.7 + i * 0.12) }}
              >
                {txt}
              </span>
            ))}
      </div>
    </div>
  );
}
