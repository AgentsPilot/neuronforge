/**
 * The banner that stops this page being read as a description of the product.
 *
 * ── Why it is the loudest thing on the screen ───────────────────────────────
 * Every number below it — prices, allowances, what each plan includes — is an
 * INTENTION. Nothing reads the entitlement config at runtime while the mode is
 * `off`, so an account on Essentials today has chat, unlimited everything, and
 * no idea a plan exists. A reader who takes this page at face value would
 * conclude the opposite, and would tell a customer so.
 *
 * ── Undismissible by construction ───────────────────────────────────────────
 * No `onClose`, no `dismissible`, no `useState`, no storage key. There is
 * nowhere to add one without changing this component's signature, which is a
 * reviewable event. Copied deliberately from `FailOpenNotice` on the sibling
 * screen, which learned it the same way.
 *
 * ── It states the mode it was GIVEN ─────────────────────────────────────────
 * `mode` and `meaning` both arrive in the payload, read from the server's own
 * environment. This component has no default and no fallback: if the payload
 * says `enforce`, it says enforce. A banner that assumed "off" would be a lie
 * the moment somebody switched it on.
 */

import { AlertTriangle, ShieldCheck } from 'lucide-react';

interface Props {
  mode: 'off' | 'shadow' | 'enforce';
  meaning: string;
  envVar: string;
  enforced: boolean;
}

export function EnforcementBanner({ mode, meaning, envVar, enforced }: Props) {
  // Enforcing is the one state where this page describes reality. It gets a
  // different colour and a different verb, because "nothing is enforced" would
  // then be the false statement.
  const tone = enforced
    ? {
        border: 'border-emerald-500/40',
        background: 'bg-emerald-500/10',
        heading: 'text-emerald-200',
        body: 'text-emerald-100',
        quiet: 'text-emerald-100/70',
        icon: 'text-emerald-400',
      }
    : {
        border: 'border-amber-500/40',
        background: 'bg-amber-500/10',
        heading: 'text-amber-200',
        body: 'text-amber-100',
        quiet: 'text-amber-100/70',
        icon: 'text-amber-400',
      };

  const Icon = enforced ? ShieldCheck : AlertTriangle;

  return (
    <section
      data-testid="enforcement-banner"
      role="note"
      className={`rounded-lg border ${tone.border} ${tone.background} p-4`}
    >
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${tone.icon}`} aria-hidden="true" />
        <div className="space-y-2">
          <h2 className={`text-sm font-semibold ${tone.heading}`}>
            {enforced
              ? 'Entitlements are being ENFORCED.'
              : 'Nothing on this page is enforced. No customer is being limited by any of it.'}
          </h2>

          <p className={`text-sm font-medium leading-relaxed ${tone.body}`}>
            <span data-testid="enforcement-mode" className="font-mono uppercase">
              {mode}
            </span>
            {' — '}
            {meaning}
          </p>

          <p className={`text-sm leading-relaxed ${tone.quiet}`}>
            The mode is read from <span className="font-mono">{envVar}</span> on the server that
            answered this request, not assumed by this page. Every plan below is what an account{' '}
            <em>would</em> get; what an account actually gets today is decided by whether anything
            asks.
          </p>
        </div>
      </div>
    </section>
  );
}
