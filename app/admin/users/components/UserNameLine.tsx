'use client';

/**
 * The person part of a Businesses row (admin reorganisation slice 4, user
 * decisions U-3): the name (or a red "No name"), the Active/Inactive badge
 * beside it, and the email with its verified tick.
 *
 *   - No name → visible red "No name", a red icon hidden from screen readers,
 *     and a visually hidden " — needs attention" in the same container (SA C-16:
 *     not title-only, and not announced twice).
 *   - The verified tick sits beside the EMAIL it describes, with an accessible
 *     name, on every row, so the name line never carries it.
 *   - The badge colour follows `ACTIVE_BADGE_MODE`: `'neutral'` (U-7), so the
 *     Active badge is never green. The verified tick by the email stays green.
 *
 * `data-testid="row-user"` stays on the name TEXT only (SA C-15 (c)).
 */

import { AlertCircle, Ban, CheckCircle, UserCheck } from 'lucide-react';

import { ACTIVE_BADGE_MODE, hasPersonName, type ActiveBadgeMode } from '../userName';

interface Props {
  fullName: string | null | undefined;
  email: string;
  emailConfirmed: boolean;
  isActive: boolean;
  /** Defaults to the one switch in `userName.ts`; a prop so the test can cover every option. */
  activeBadgeMode?: ActiveBadgeMode;
}

const ACTIVE_GREEN = 'bg-green-500/20 text-green-300';
const ACTIVE_NEUTRAL = 'bg-blue-500/20 text-blue-200';
const INACTIVE = 'bg-slate-500/20 text-slate-300';

export function activeBadgeClass(isActive: boolean, named: boolean, mode: ActiveBadgeMode): string {
  if (!isActive) return INACTIVE;
  if (mode === 'neutral') return ACTIVE_NEUTRAL;
  if (mode === 'neutral-on-no-name' && !named) return ACTIVE_NEUTRAL;
  return ACTIVE_GREEN;
}

export function UserNameLine({ fullName, email, emailConfirmed, isActive, activeBadgeMode = ACTIVE_BADGE_MODE }: Props) {
  const named = hasPersonName(fullName);

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap" data-testid="row-name-line">
        {named ? (
          <p data-testid="row-user" className="text-sm text-slate-200">
            {fullName.trim()}
          </p>
        ) : (
          <p data-testid="row-no-name" className="text-sm font-medium text-red-300 flex items-center gap-1">
            <AlertCircle className="w-3.5 h-3.5 text-red-400" aria-hidden="true" />
            <span data-testid="row-user">No name</span>
            <span className="sr-only"> — needs attention</span>
          </p>
        )}
        <span
          data-testid="row-activity"
          className={`px-2 py-0.5 text-xs font-medium rounded-full w-fit flex items-center gap-1 ${activeBadgeClass(
            isActive,
            named,
            activeBadgeMode
          )}`}
        >
          {isActive ? (
            <>
              <UserCheck className="w-3 h-3" aria-hidden="true" />
              Active
            </>
          ) : (
            <>
              <Ban className="w-3 h-3" aria-hidden="true" />
              Inactive
            </>
          )}
        </span>
      </div>
      <p className="text-xs text-slate-400 flex items-center gap-1" data-testid="row-email">
        {email}
        {emailConfirmed && (
          <span className="inline-flex items-center" data-testid="row-email-verified">
            <CheckCircle className="w-3 h-3 text-green-400" aria-hidden="true" />
            <span className="sr-only">Email verified</span>
          </span>
        )}
      </p>
    </>
  );
}
