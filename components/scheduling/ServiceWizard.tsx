'use client';

/**
 * One service, as four questions.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS REPLACES
 *
 * A single panel that asked everything at once and then had to decide what each
 * field meant while half of them were unanswered. On a service the onboarding
 * chat had created — a name, a length, no price — it said four contradicting
 * things at the same time: "No price set yet" under the chips, "Free" beside
 * the payment plan, "Nothing is collected" in the summary, and a lit "They pay
 * by card" chip. Every one of them was produced by the same cause.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE THE RULES LIVE, WHICH IS NOT HERE
 *
 *   `serviceWizard`         the order, the branch, and what each step answers
 *   `serviceShapeFields`    what a shape means on the row
 *   `serviceRequirements`   what a shape asks of the business, in order
 *   `publishBlockers`       what would stop THIS row going live, from the
 *                           stored row, naming only what the server refuses
 *
 * This composes them. The one thing it decides is which screen is on top, and
 * even that is `serviceWizard`'s answer.
 *
 * @module components/scheduling
 */

import React, { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Loader2, X } from 'lucide-react';

import {
  ClientRail,
  WizardStepper,
  WizardStyles,
  type RailStop,
  type StepFace,
} from '@/components/scheduling/ServiceWizardChrome';
import {
  StepCost,
  StepMoney,
  StepPublish,
  StepWhat,
  type GateItem,
} from '@/components/scheduling/ServiceWizardSteps';
import {
  costShapeOf,
  nextStep,
  openingStep,
  previousStep,
  stepAnswered,
  stepsFor,
  type WizardStep,
  type WizardValues,
} from '@/lib/business-os/serviceWizard';

const LABELS: Record<WizardStep, string> = {
  what: '1 · What it is',
  cost: '2 · What it costs',
  money: '3 · How you get paid',
  publish: '4 · Publish',
};

export interface ServiceWizardProps {
  values: WizardValues;
  onChange: (next: WizardValues) => void;

  /** A service being created asks the same questions; only the verbs differ. */
  isNew: boolean;
  /** Published services are edited, not published again. */
  isDraft: boolean;
  saving: boolean;
  /**
   * The publish request is in flight.
   *
   * Separate from `saving`, which is the row write. Publishing is the slower of
   * the two — it reaches the gate, the row and the website — and showing the
   * save spinner for it would be the wrong claim about which thing is
   * happening.
   */
  publishing: boolean;
  /**
   * Does this row differ from what was loaded?
   *
   * The panel this replaces disabled Save on exactly this, and the reason is
   * worth keeping: pressing it again re-sent identical values and re-raised the
   * publish prompt, so an owner was asked to publish a second time for a write
   * that changed nothing. A new service is always dirty — it has never been
   * saved at all.
   */
  dirty: boolean;

  currencySymbol: string;
  currencyCode: string;

  /** Facts about the BUSINESS, which a service cannot know about itself. */
  /* Accepted and no longer read: step 3 stopped asking for the setting up, and
     step 4 answers the same question from `blockers`, which is the publish
     gate itself. Kept on the contract so the one caller does not have to
     change, and so the pair cannot drift apart. */
  invoiceReady: boolean;
  processorReady: boolean;
  hoursReady: boolean;
  onFixInvoice?: () => void;
  onConnectProcessor?: () => void;
  onFixHours?: () => void;

  /**
   * What the publish gate would refuse, from the STORED row.
   *
   * Passed in rather than derived here: `publishBlockers` reads what the server
   * holds, and a copy computed from the form would refuse a state that is not
   * the one being published.
   */
  blockers: Array<'hours' | 'invoice' | 'processor'>;
  /** True where the row cannot be sold at all — no time held, no money taken. */
  nothingToSell: boolean;

  onSave: () => void;
  onPublish?: () => void;
  onClose: () => void;
}

export function ServiceWizard({
  values,
  onChange,
  isNew,
  isDraft,
  saving,
  publishing,
  dirty,
  currencySymbol,
  currencyCode,
  invoiceReady,
  processorReady,
  hoursReady,
  onFixInvoice,
  onConnectProcessor,
  onFixHours,
  blockers,
  nothingToSell,
  onSave,
  onPublish,
  onClose,
}: ServiceWizardProps) {
  /*
   * Where it opens.
   *
   * A new service starts at the beginning. An existing one opens on its first
   * UNANSWERED step — which for every service the chat wrote is "what it
   * costs", the one question nobody has answered, rather than a name that is
   * already correct.
   *
   * Read once, on mount: re-deriving it would move the screen under the owner
   * as they answer.
   */
  const [step, setStep] = useState<WizardStep>(() => (isNew ? 'what' : openingStep(values)));

  const steps = stepsFor(values);
  const shape = costShapeOf(values);

  const faces: StepFace[] = steps.map(id => ({
    id,
    label: LABELS[id],
    answered: stepAnswered(id, values),
  }));

  /*
   * The journey, told as the client walks it.
   *
   * Each stop is claimed only once its answer exists. The `caveat` state is the
   * one sentence this product has to get right and keeps getting wrong: a card
   * service with no processor is INVOICED, the booking still happens, and
   * nobody is turned away.
   */
  const stops: RailStop[] = useMemo(() => {
    const list: RailStop[] = [];
    const named = values.name.trim() || 'this service';

    list.push({
      state: values.name.trim() ? 'done' : 'waiting',
      title: values.name.trim() ? 'Picks ' + named : 'Picks it from your list',
    });

    if (values.is_scheduled) {
      list.push({
        state: values.duration.trim() ? 'done' : 'waiting',
        title: values.duration.trim()
          ? 'Chooses a ' + values.duration.trim() + ' minute slot'
          : 'Chooses a time',
        note: hoursReady ? undefined : 'Needs your working hours.',
      });
    }

    if (shape === 'free') {
      list.push({ state: 'done', title: 'Pays nothing', note: 'Nothing is collected.' });
    } else if (shape === 'quoted') {
      list.push({
        state: 'done',
        title: 'Asks for a quote',
        note: 'You send one, they accept, and the invoice follows.',
      });
    } else if (shape === 'priced') {
      list.push({
        state: 'done',
        title: 'Sees ' + currencySymbol + values.price.trim(),
        note: 'Before they book.',
      });

      if (values.collection === 'online') {
        list.push(
          processorReady
            ? { state: 'done', title: 'Pays by card', note: 'Charged when they book.' }
            : {
                state: 'caveat',
                title: 'Gets an invoice, for now',
                note: 'No card account yet, so the booking still happens and you bill them. Nobody is turned away.',
              }
        );
      } else if (values.collection === 'invoice') {
        list.push({ state: 'done', title: 'Gets an invoice', note: 'You bill them afterwards.' });
      } else {
        list.push({ state: 'waiting', title: 'Pays by…', note: 'The next question.' });
      }
    } else {
      list.push({ state: 'waiting', title: 'Pays, or does not', note: 'You answer that next.' });
    }

    list.push({
      state: 'done',
      title: 'Gets a confirmation',
      note: values.is_scheduled ? 'And a reminder the day before.' : undefined,
    });

    return list;
  }, [values, shape, currencySymbol, processorReady, hoursReady]);

  const railSummary = [
    values.duration.trim() ? values.duration.trim() + ' min' : null,
    shape === 'priced' ? currencySymbol + values.price.trim() : shape === 'free' ? 'Free' : shape === 'quoted' ? 'Quoted' : null,
  ]
    .filter(Boolean)
    .join(' · ') || 'Not answered yet';

  /*
   * Step 4's list IS the gate.
   *
   * Built from `blockers`, which `publishBlockers` produced from the stored row
   * and which names only what the publish route refuses on its own. The
   * processor is listed and marked `optional` deliberately: `isBlockingGap`
   * keeps it non-blocking because a card service with no Stripe is invoiced and
   * goes on trading.
   */
  const gate: GateItem[] = useMemo(() => {
    const items: GateItem[] = [];

    items.push({
      state: values.name.trim() && (!values.is_scheduled || values.duration.trim()) ? 'done' : 'now',
      title: values.is_scheduled ? 'A name and a length' : 'A name',
      note:
        values.name.trim() && (!values.is_scheduled || values.duration.trim())
          ? [values.name.trim(), values.is_scheduled ? values.duration.trim() + ' minutes' : null]
              .filter(Boolean)
              .join(', ')
          : 'Both are typed on the first step.',
    });

    if (values.is_scheduled) {
      items.push({
        state: blockers.includes('hours') ? 'now' : 'done',
        title: 'Hours a client can pick from',
        note: blockers.includes('hours')
          ? 'Nothing can be booked until there is a time to book.'
          : 'Set, so a client has slots to choose from.',
        action: blockers.includes('hours') ? { label: 'Set your hours', onPress: onFixHours } : undefined,
      });
    }

    if (shape === 'priced' || shape === 'quoted') {
      items.push({
        state: blockers.includes('invoice') ? 'now' : 'done',
        title: 'Your invoice details',
        note: blockers.includes('invoice')
          ? 'A bill has to say who sent it and where the money goes. About two minutes.'
          : 'Filled in, so documents can go out.',
        action: blockers.includes('invoice') ? { label: 'Fill them in', onPress: onFixInvoice } : undefined,
      });
    }

    if (shape === 'priced' && values.collection === 'online') {
      items.push({
        state: processorReady ? 'done' : 'optional',
        title: 'A card account',
        note: processorReady
          ? 'Connected. Cards are charged when a client books.'
          : 'Until it is connected, this service is invoiced instead.',
        action: processorReady ? undefined : { label: 'Connect', onPress: onConnectProcessor },
      });
    }

    return items;
  }, [values, shape, blockers, processorReady, onFixHours, onFixInvoice, onConnectProcessor]);

  const back = previousStep(step, values);
  const forward = nextStep(step, values);
  const canGoOn = stepAnswered(step, values);

  const title = values.name.trim() || (isNew ? 'New service' : 'This service');
  const subtitle = [
    values.is_scheduled && values.duration.trim() ? values.duration.trim() + ' minute appointment' : null,
    shape === 'priced' && values.price.trim() ? currencySymbol + values.price.trim() : null,
    shape === 'free' ? 'Free' : shape === 'quoted' ? 'Priced per job' : null,
    isDraft ? 'draft' : 'live',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="sw">
      <WizardStyles />

      <div className="sw-head">
        <div className="sw-head-text">
          <p className="sw-head-title">{title}</p>
          <p className="sw-head-note">{subtitle}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="sw-quiet">
          <X width={18} height={18} aria-hidden="true" />
        </button>
      </div>

      <WizardStepper steps={faces} current={step} />

      <div className="sw-body">
        <div className="sw-main">
          {step === 'what' && <StepWhat values={values} onChange={onChange} />}

          {step === 'cost' && (
            <StepCost
              values={values}
              onChange={onChange}
              currencySymbol={currencySymbol}
              currencyCode={currencyCode}
            />
          )}

          {step === 'money' && (
            <StepMoney
              values={values}
              onChange={onChange}
              /* No `facts`: the setting-up rows moved to step 4, which builds
                 them from the publish gate rather than from these flags. */
              currencySymbol={currencySymbol}
            />
          )}

          {step === 'publish' && <StepPublish items={gate} />}

          {/*
            The one shape the publish route refuses outright: no time held and
            no money taken, so there is nothing for a client to book. Said here
            rather than met as a refusal after pressing Publish.
          */}
          {nothingToSell && (
            <div className="sw-need sw-need-now">
              <span className="sw-need-text">
                <span className="sw-need-title">There is nothing to book here</span>
                <span className="sw-need-note">
                  This takes no appointment and no payment. Give it a price, or switch the appointment on.
                </span>
              </span>
            </div>
          )}
        </div>

        <ClientRail stops={stops} summary={railSummary} />
      </div>

      <div className="sw-foot">
        <button
          type="button"
          onClick={() => back && setStep(back)}
          disabled={!back}
          className="sw-quiet"
        >
          <ArrowLeft width={15} height={15} aria-hidden="true" /> Back
        </button>

        <div className="sw-foot-side">
          {forward ? (
            <>
              <span className="sw-note">Saved as a draft as you go</span>
              <button
                type="button"
                onClick={() => {
                  /* Only when something changed. Continue moves the screen
                     whatever happens; a save that re-sends identical values
                     would also re-raise the publish prompt. */
                  if (dirty) onSave();
                  setStep(forward);
                }}
                disabled={!canGoOn || saving}
                className="sw-primary"
              >
                {saving ? (
                  <Loader2 width={15} height={15} className="animate-spin" aria-hidden="true" />
                ) : null}
                Continue
                <ArrowRight width={15} height={15} aria-hidden="true" />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onSave}
                disabled={saving || !dirty}
                title={!dirty ? 'Nothing has changed yet' : undefined}
                className="sw-quiet"
              >
                {isDraft ? 'Keep as a draft' : 'Save changes'}
              </button>

              {/*
                Publishing stays the server's decision. The button is disabled
                only where the gate has already said no, and it names the
                reason rather than failing on the press.
              */}
              {isDraft && onPublish && (
                <button
                  type="button"
                  onClick={onPublish}
                  disabled={publishing || saving || blockers.length > 0 || nothingToSell}
                  /* `aria-busy` as well as the spinner: a screen reader has no
                     way to see a turning icon. */
                  aria-busy={publishing || undefined}
                  className="sw-primary"
                >
                  {publishing ? (
                    <Loader2 width={15} height={15} className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Check width={15} height={15} aria-hidden="true" />
                  )}
                  {/*
                    The word changes too. A spinner alone says "something is
                    happening"; publishing reaches the gate, the row and the
                    website, so it is worth saying WHICH something — and a
                    button that looks identical mid-flight is the one people
                    press twice.
                  */}
                  {publishing ? 'Publishing…' : 'Publish'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
