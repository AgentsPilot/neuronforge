'use client';

import { Check, Circle } from 'lucide-react';
import { Panel, Caption, TONE } from '../stageKit';
import { seg, easeOutBack, lerp } from '../timing';
import type { SceneProps } from '../storyboard';

/**
 * Chapter 5 — where this owner actually stands.
 *
 * Not an animation. The film has explained three doors in the abstract; this
 * puts the owner back in their own account and says which of the three are
 * open. The playhead HOLDS here, so this is the frame left on screen when the
 * tour ends and somebody turns to read it.
 *
 * The body text is `t('presence.guide.' + state)` verbatim — the same sentence
 * the card behind the dialog is showing. Saying it twice in two different
 * forms would invite the owner to wonder which one is current.
 */
export function Ch5YouAreHere({ ub, t, ctx }: SceneProps) {
  const u = ub;
  const rows = [
    {
      done: ctx.websitePublished,
      label: t('presence.tour.here.website'),
    },
    {
      done: ctx.livePages > 0,
      label: t('presence.tour.here.landing'),
    },
    {
      done: ctx.bookingLinkActive,
      label: t('presence.tour.here.link'),
    },
  ];

  const reachable = rows.some(r => r.done);

  return (
    <div className="flex h-full flex-col justify-center p-4">
      <Panel className="p-5" style={{ opacity: seg(u, 0.04, 0.2) }}>
        <p className="text-sm font-semibold text-[var(--v2-text-primary)]">
          {reachable
            ? t('presence.tour.here.titleReachable')
            : t('presence.tour.here.titleBlocked')}
        </p>

        <ul className="mt-3 flex flex-col gap-2">
          {rows.map((r, i) => {
            const enter = seg(u, 0.18 + i * 0.09, 0.32 + i * 0.09);
            return (
              <li
                key={r.label}
                className="flex items-center gap-2.5"
                style={{
                  opacity: enter,
                  transform: `translateY(${lerp(6, 0, easeOutBack(enter))}px)`,
                }}
              >
                {r.done ? (
                  <Check className="h-4 w-4 shrink-0" style={{ color: TONE.success }} />
                ) : (
                  <Circle className="h-4 w-4 shrink-0 text-[var(--v2-text-muted)]" />
                )}
                <span
                  className={`text-[13px] ${
                    r.done
                      ? 'text-[var(--v2-text-primary)]'
                      : 'text-[var(--v2-text-muted)]'
                  }`}
                >
                  {r.label}
                </span>
              </li>
            );
          })}
        </ul>

        {/* The page's own sentence, not a second version of it. */}
        <p
          className="mt-4 border-t border-[var(--v2-border)] pt-3 text-xs leading-relaxed text-[var(--v2-text-secondary)]"
          style={{ opacity: seg(u, 0.5, 0.66) }}
        >
          {t(`presence.guide.${ctx.guidanceState}`)}
        </p>
      </Panel>

      <div className="pt-3">
        <Caption opacity={seg(u, 0.66, 0.8)}>{t('presence.tour.here.caption')}</Caption>
      </div>
    </div>
  );
}
