'use client';

import { FileText, Link2 } from 'lucide-react';
import { Panel, IconTile, Badge, Btn, Caption, Cursor, TONE } from '../stageKit';
import { seg, fade, press, lerp, easeInOutCubic, easeOutBack } from '../timing';
import { FAKE, type SceneProps } from '../storyboard';

/**
 * Chapter 2 — a landing page, and how it differs from a link.
 *
 * Traced from `LandingPageWizard.tsx:1924-1973` (the two choice cards) and
 * `app/business-os/website/page.tsx:4722-4891` (landing rows).
 *
 * The compare card quotes the product's OWN labels verbatim, because those
 * are the words the owner will meet in the wizard thirty seconds later. The
 * caption adds the thing the labels do not say: what it is FOR.
 */

/* Beat 0 picks Landing Page in the wizard; beat 1 publishes the result. */
export function Ch2Landing({ beat, ub, t, isRTL }: SceneProps) {
  const inChoose = beat === 0;
  const chooseU = ub;
  const compareU = ub;
  const u = ub;

  const cursorX = lerp(0.24, 0.72, easeInOutCubic(seg(chooseU, 0.3, 0.64)));
  const picked = chooseU > 0.72;

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
        {inChoose ? (
          <div className="relative" style={{ opacity: seg(u, 0, 0.05) }}>
            <p className="mb-2.5 text-xs text-[var(--v2-text-secondary)]">
              {t('presence.tour.landing.wizardTitle')}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <ChoiceCard
                tone={TONE.primary}
                icon={<Link2 className="h-[17px] w-[17px]" />}
                title={t('presence.tour.landing.smartLink')}
                body={t('presence.tour.landing.smartLinkDesc')}
                selected={false}
                enter={seg(chooseU, 0.08, 0.2)}
              />
              <ChoiceCard
                tone={TONE.success}
                icon={<FileText className="h-[17px] w-[17px]" />}
                title={t('presence.tour.landing.landingPage')}
                body={t('presence.tour.landing.landingPageDesc')}
                selected={picked}
                enter={seg(chooseU, 0.14, 0.26)}
                pressScale={press(chooseU, 0.64, 0.76)}
              />
            </div>
            <Cursor
              x={cursorX}
              y={70}
              isRTL={isRTL}
              opacity={fade(chooseU, 0.26, 0.32, 0.86, 0.94)}
            />
          </div>
        ) : (
          <div style={{ opacity: seg(u, 0, 0.06) }}>
            <Panel className="flex items-center gap-3 px-4 py-3">
              <IconTile tone={TONE.success}>
                <FileText className="h-[17px] w-[17px]" />
              </IconTile>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-[var(--v2-text-primary)]">
                    {FAKE.serviceA}
                  </span>
                  <Badge tone={compareU > 0.55 ? 'live' : 'draft'}>
                    {compareU > 0.55
                      ? t('presence.tour.badge.live')
                      : t('presence.tour.badge.draft')}
                  </Badge>
                </div>
                <div className="mt-0.5 text-xs text-[var(--v2-text-muted)]">
                  {t('presence.tour.landing.oneService')}
                </div>
              </div>
              <Btn
                tone={compareU > 0.55 ? TONE.success : TONE.primary}
                filled={compareU <= 0.55}
                pressScale={press(compareU, 0.44, 0.56)}
              >
                {compareU > 0.55
                  ? t('presence.tour.badge.live')
                  : t('presence.tour.website.publish')}
              </Btn>
            </Panel>
          </div>
        )}
      </div>

      <div className="pt-3">
        <Caption opacity={inChoose ? fade(u, 0.3, 0.36, 0.5, 0.55) : 0}>
          {t('presence.tour.landing.capChoose')}
        </Caption>
        <Caption opacity={!inChoose ? seg(u, 0.68, 0.76) : 0}>
          {t('presence.tour.landing.capPurpose')}
        </Caption>
      </div>
    </div>
  );
}

function ChoiceCard({
  tone,
  icon,
  title,
  body,
  selected,
  enter,
  pressScale = 1,
}: {
  tone: string;
  icon: React.ReactNode;
  title: string;
  body: string;
  selected: boolean;
  enter: number;
  pressScale?: number;
}) {
  return (
    <div
      className="p-3.5"
      style={{
        border: `1px solid ${selected ? tone : 'var(--v2-border)'}`,
        background: selected ? `${tone}0F` : 'var(--v2-surface)',
        borderRadius: 'var(--v2-radius-card, 16px)',
        opacity: enter,
        transform: `translateY(${lerp(10, 0, easeOutBack(enter))}px) scale(${pressScale})`,
      }}
    >
      <IconTile tone={tone} size={32}>
        {icon}
      </IconTile>
      <p className="mt-2 text-[13px] font-semibold text-[var(--v2-text-primary)]">{title}</p>
      <p className="mt-1 text-[11px] leading-snug text-[var(--v2-text-muted)]">{body}</p>
    </div>
  );
}
