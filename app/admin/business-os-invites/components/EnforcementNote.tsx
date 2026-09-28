/**
 * GR-5: honest status until enforcement.
 *
 * A champion invite RECORDS a Founding Partner basis; nothing limits any account
 * until entitlements are enforced. Stated on the page that issues the invites,
 * in the mode the server reported, so an admin never promises an invitee a
 * difference the product does not yet make. Undismissible, like the Tiers
 * screen's banner.
 */

import { AlertTriangle, ShieldCheck } from 'lucide-react';

import type { EnforcementMode } from '../types';

interface Props {
  mode: EnforcementMode;
}

export function EnforcementNote({ mode }: Props) {
  const enforced = mode === 'enforce';
  const Icon = enforced ? ShieldCheck : AlertTriangle;

  return (
    <section
      data-testid="enforcement-note"
      role="note"
      className={`rounded-lg border p-4 ${
        enforced ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-amber-500/40 bg-amber-500/10'
      }`}
    >
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${enforced ? 'text-emerald-400' : 'text-amber-400'}`} aria-hidden="true" />
        <div className="space-y-1 text-sm">
          <p className={enforced ? 'font-semibold text-emerald-100' : 'font-semibold text-amber-100'}>
            {enforced
              ? 'Plans are enforced: the plan an invite grants is the plan the account gets.'
              : 'An invite records the plan it grants. Nothing is enforced yet, so every account has the full product.'}
          </p>
          <p className={enforced ? 'text-emerald-100/70' : 'text-amber-100/70'}>
            Entitlements mode: <span className="font-mono uppercase">{mode}</span>. Until signup from an invite is built,
            invite links are for internal demos only: do not send them to real invitees, as they would expire first.
          </p>
        </div>
      </div>
    </section>
  );
}
