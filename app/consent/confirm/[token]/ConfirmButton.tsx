'use client';

/**
 * The button that actually creates the consent, and the three answers it can get.
 *
 * A deliberate human action on a page, rather than the fetch of a link. See the
 * route it posts to: link scanners open every URL in an email before the
 * recipient does, so a link that confirmed on GET would subscribe people who
 * never clicked — manufacturing exactly the consent this flow exists to verify.
 *
 * `BrandButton` and `StatusCard`, not markup of its own: this page has to look
 * like the business's booking and invoice pages, and every one of those is
 * built from these.
 */

import { useState } from 'react';

import { BrandButton } from '@/components/public/BrandButton';
import { StatusCard } from '@/components/public/StatusCard';

type Outcome =
  | { state: 'idle' }
  | { state: 'working' }
  | { state: 'done'; alreadyConfirmed: boolean }
  | { state: 'failed'; reason: string };

export interface ConfirmLabels {
  button: string;
  done: string;
  doneTitle: string;
  already: string;
  alreadyTitle: string;
  expired: string;
  invalid: string;
  failed: string;
  problemTitle: string;
}

interface Props {
  token: string;
  labels: ConfirmLabels;
  /** Somewhere useful to go afterwards, where the business has one. */
  websiteUrl?: string | null;
  websiteLabel: string;
}

export function ConfirmButton({ token, labels, websiteUrl, websiteLabel }: Props) {
  const [outcome, setOutcome] = useState<Outcome>({ state: 'idle' });

  const confirm = async () => {
    setOutcome({ state: 'working' });
    try {
      const response = await fetch('/api/public/consent/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const json = await response.json();

      if (json.success) {
        setOutcome({ state: 'done', alreadyConfirmed: Boolean(json.data?.alreadyConfirmed) });
      } else {
        setOutcome({ state: 'failed', reason: json.reason ?? 'failed' });
      }
    } catch {
      setOutcome({ state: 'failed', reason: 'failed' });
    }
  };

  if (outcome.state === 'done') {
    return (
      <StatusCard
        standalone
        inShell
        tone="success"
        title={outcome.alreadyConfirmed ? labels.alreadyTitle : labels.doneTitle}
        description={outcome.alreadyConfirmed ? labels.already : labels.done}
        actions={
          // A confirmation used to be a dead end. Somewhere to go next is the
          // outcome the business actually wants from this screen.
          websiteUrl ? (
            <BrandButton href={websiteUrl} variant="secondary">
              {websiteLabel}
            </BrandButton>
          ) : undefined
        }
      />
    );
  }

  if (outcome.state === 'failed') {
    const description =
      outcome.reason === 'expired'
        ? labels.expired
        : outcome.reason === 'invalid'
          ? labels.invalid
          : labels.failed;

    return (
      <StatusCard
        standalone
        inShell
        // `warning`, not `error`: an expired link is a normal thing that
        // happens to people, not a fault they should read as broken.
        tone="warning"
        title={labels.problemTitle}
        description={description}
      />
    );
  }

  return (
    <BrandButton
      onClick={confirm}
      loading={outcome.state === 'working'}
      disabled={outcome.state === 'working'}
      size="lg"
      fullWidth
    >
      {labels.button}
    </BrandButton>
  );
}
