'use client';

/**
 * The four questions themselves.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Each step is a pure function of the values it is given plus the facts about
 * the business it cannot know (hours set, invoice details filled, a processor
 * connected). None of them decides a rule: `serviceWizard` owns the order,
 * `serviceShapeFields` owns what a shape means on the row, and
 * `serviceRequirements` owns what each shape asks of the business.
 *
 * What lives here is the drawing, and the copy — which is most of the point.
 * The screen this replaces said four contradicting things about an unpriced
 * service because each sentence was written where it was rendered rather than
 * decided once.
 *
 * @module components/scheduling
 */

import React, { useState } from 'react';
import { AlertTriangle, Check, Clock, CreditCard, FileText } from 'lucide-react';

import { CONFIG_ACCENT } from '@/components/business-os/configAccent';
import {
  applyCostShape,
  costShapeOf,
  type CostShape,
  type WizardValues,
} from '@/lib/business-os/serviceWizard';

const DONE = '#22C58B';

/**
 * A short exclusive choice, drawn as one track with the answer raised inside.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The shape the service editor has always used for this kind of question, kept
 * verbatim from the panel it replaces: a rounded track, a half-pixel of inset
 * padding, and the active option carrying the surface colour rather than a
 * border of its own.
 *
 * The instalment options were first drawn here as loose chips, which read as
 * four independent toggles rather than one answer with four possible values.
 */
function Segment({
  options,
}: {
  options: Array<{ value: string; label: string; active: boolean; onClick: () => void }>;
}) {
  return (
    <div role="group" className="sw-segment">
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          onClick={option.onClick}
          aria-pressed={option.active}
          className={option.active ? 'sw-segment-option sw-segment-on' : 'sw-segment-option'}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface StepProps {
  values: WizardValues;
  onChange: (next: WizardValues) => void;
  /** What the owner calls their money, stated rather than asked here. */
  currencySymbol: string;
  currencyCode: string;
}

/* ════════════════════════════════════════════════════════════════════════════
   1 · WHAT IT IS
   ═══════════════════════════════════════════════════════════════════════════ */

const LENGTHS = ['30', '45', '60', '90'];

/**
 * The gap kept AFTER a service, offered as the answers people actually give.
 *
 * `'0'` leads, because none is the commonest honest answer and the one an owner
 * should not have to hunt for: a call needs no turnaround, a treatment room
 * does. The database default is 15, which is why services created through the
 * older paths carry one nobody chose.
 */
const GAPS = ['0', '10', '15', '30'];

export function StepWhat({ values, onChange }: Omit<StepProps, 'currencySymbol' | 'currencyCode'>) {
  const set = (patch: Partial<WizardValues>) => onChange({ ...values, ...patch });

  return (
    <>
      <div>
        <h2 className="sw-title">What are you selling?</h2>
        <p className="sw-lede">The name a client sees when they pick from your list.</p>
      </div>

      <label className="sw-field">
        <span className="sw-label">Name</span>
        <input
          type="text"
          value={values.name}
          onChange={event => set({ name: event.target.value })}
          placeholder="Renovation Consultation"
          className="sw-input"
        />
      </label>

      <label className="sw-field">
        <span className="sw-label">
          What it includes <span className="sw-optional">— optional</span>
        </span>
        <textarea
          rows={2}
          value={values.description}
          onChange={event => set({ description: event.target.value })}
          placeholder="An hour on site, measurements, and a written scope you keep."
          className="sw-input sw-textarea"
        />
        <span className="sw-hint">Your booking page and your invoices both use this.</span>
      </label>

      <div className="sw-rule" />

      <div>
        <p className="sw-question">Does a client book a time for this?</p>
        <div className="sw-choices">
          <button
            type="button"
            aria-pressed={values.is_scheduled}
            onClick={() => set({ is_scheduled: true })}
            className={values.is_scheduled ? 'sw-choice sw-choice-on' : 'sw-choice'}
          >
            <span className="sw-choice-head">
              <Clock className="sw-choice-icon" aria-hidden="true" />
              <span className="sw-choice-title">Yes, they pick a time</span>
            </span>
            <span className="sw-choice-note">A slot is held in your diary.</span>
          </button>

          <button
            type="button"
            aria-pressed={!values.is_scheduled}
            onClick={() => set({ is_scheduled: false, duration: '', buffer: '' })}
            className={!values.is_scheduled ? 'sw-choice sw-choice-on' : 'sw-choice'}
          >
            <span className="sw-choice-head">
              <Check className="sw-choice-icon" aria-hidden="true" />
              <span className="sw-choice-title">No, there is no appointment</span>
            </span>
            <span className="sw-choice-note">A product, a package, a job you schedule yourself.</span>
          </button>
        </div>
      </div>

      {/* Asked only of something that holds a slot. A product has no length. */}
      {values.is_scheduled && (
        <div>
          <p className="sw-label sw-label-block">How long does it take?</p>
          <div className="sw-pills">
            {LENGTHS.map(minutes => (
              <button
                key={minutes}
                type="button"
                aria-pressed={values.duration === minutes}
                onClick={() => set({ duration: minutes })}
                className={values.duration === minutes ? 'sw-pill sw-pill-on' : 'sw-pill'}
              >
                {minutes} min
              </button>
            ))}
            <label className="sw-pill sw-pill-other">
              <input
                type="number"
                inputMode="numeric"
                min={5}
                step={5}
                value={LENGTHS.includes(values.duration) ? '' : values.duration}
                onChange={event => set({ duration: event.target.value })}
                placeholder="Another length"
                aria-label="Another length in minutes"
                className="sw-pill-input"
              />
            </label>
          </div>

          {/*
            ───────────────────────────────────────────────────────────────────
            THE GAP AFTER IT, WHICH THIS WIZARD DESCRIBED BEFORE IT COULD SET.
            ───────────────────────────────────────────────────────────────────
            `buffer_minutes` is honoured by every public booking surface and by
            the owner's own grid, and the rail beside this already reads it back
            — "runs 60 minutes, and keeps 15 clear afterwards, so it costs the
            day 75". The number in that sentence came from the database default
            or from the modal on the old scheduling page, because the editor
            that replaced the services form never carried a control for it: the
            value was held in state, seeded from the row and saved again
            untouched.

            So the sentence promised something the screen could not do. Here it
            is, next to the length, because the two are one question — how long
            it takes, and how long you need before the next client.

            Asked only of something that holds a slot, like the length above.
          */}
          <p className="sw-label sw-label-block" style={{ marginTop: 14 }}>
            And how long do you need after it?
          </p>
          <div className="sw-pills">
            {GAPS.map(minutes => {
              /* An unanswered gap IS no gap, so both read as the same answer
                 — `''` is what a row that never chose one looks like here. */
              const chosen =
                minutes === '0'
                  ? values.buffer.trim() === '' || values.buffer.trim() === '0'
                  : values.buffer.trim() === minutes;

              return (
                <button
                  key={minutes}
                  type="button"
                  aria-pressed={chosen}
                  onClick={() => set({ buffer: minutes })}
                  className={chosen ? 'sw-pill sw-pill-on' : 'sw-pill'}
                >
                  {minutes === '0' ? 'No gap' : minutes + ' min'}
                </button>
              );
            })}
            <label className="sw-pill sw-pill-other">
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={5}
                value={GAPS.includes(values.buffer.trim()) ? '' : values.buffer}
                onChange={event => set({ buffer: event.target.value })}
                placeholder="Another gap"
                aria-label="Another gap in minutes"
                className="sw-pill-input"
              />
            </label>
          </div>
          <p className="sw-hint" style={{ marginTop: 8 }}>
            Kept clear before the next client can be offered a time. It comes out
            of your day, so leave it at none unless you need it.
          </p>
        </div>
      )}
    </>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   2 · WHAT IT COSTS — the only branch in the editor
   ═══════════════════════════════════════════════════════════════════════════ */

export function StepCost({ values, onChange, currencySymbol, currencyCode }: StepProps) {
  const shape = costShapeOf(values);

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE ONE ANSWER THAT CANNOT PROVE ITSELF.
   *
   * `costShapeOf` reads the shape off `price` and `sale_mode`, which is right
   * for every state the row can be in — and leaves "I charge a set price" with
   * nothing to write. Free is `price: '0'`, a quote is
   * `sale_mode: 'proposal'`, but a set price is only a set price once an
   * AMOUNT exists, and the amount is what the owner is about to type.
   *
   * So pressing it changed nothing: `applyCostShape` returned the same empty
   * price, `costShapeOf` still answered `unanswered`, and the panel that was
   * supposed to open stayed shut. Reported as "clicking on it nothing happen".
   *
   * The pick is therefore remembered HERE, for the length of this screen, and
   * only for that one option. It is not a fourth stored state and nothing else
   * reads it: `stepAnswered` still requires a real figure, so Continue stays
   * disabled until one is typed, which is the honest behaviour — the question
   * genuinely is not answered yet.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const [pickedPriced, setPickedPriced] = useState(false);

  /** Open while the row says so, or while the owner has just asked for it. */
  const pricedOpen = shape === 'priced' || (shape === 'unanswered' && pickedPriced);

  const pick = (next: Exclude<CostShape, 'unanswered'>) => {
    setPickedPriced(next === 'priced');
    onChange(applyCostShape(values, next));
  };

  return (
    <>
      <div>
        <h2 className="sw-title">What does it cost?</h2>
        <p className="sw-lede">One answer. Everything after it follows from this.</p>
      </div>

      <div className="sw-shapes">
        <button
          type="button"
          aria-pressed={shape === 'free'}
          onClick={() => pick('free')}
          className={shape === 'free' ? 'sw-shape sw-shape-on' : 'sw-shape'}
        >
          <span className="sw-radio" data-on={shape === 'free' ? '1' : '0'} />
          <span className="sw-shape-text">
            <span className="sw-shape-title">It is free</span>
            <span className="sw-shape-note">
              A consultation you give away, a first session, a class. Nothing is collected and nothing else is asked.
            </span>
          </span>
        </button>

        {/*
          The price lives INSIDE the answer that needs it.
          That is the whole fix: it cannot be a field asked before its own
          subject exists, and it cannot be read as "free" while it is empty.
        */}
        <div className={pricedOpen ? 'sw-shape sw-shape-on sw-shape-open' : 'sw-shape sw-shape-open'}>
          <button
            type="button"
            aria-pressed={pricedOpen}
            onClick={() => pick('priced')}
            className="sw-shape-trigger"
          >
            <span className="sw-radio" data-on={pricedOpen ? '1' : '0'} />
            <span className="sw-shape-text">
              <span className="sw-shape-title">I charge a set price</span>
              <span className="sw-shape-note">The same amount every time. A client sees it before they book.</span>
            </span>
          </button>

          {pricedOpen && (
            <div className="sw-priced">
              <label className="sw-money">
                <span className="sw-label">Price</span>
                <span className="sw-money-box">
                  <span className="sw-money-code">
                    {currencySymbol} {currencyCode}
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={values.price}
                    onChange={event => onChange({ ...values, price: event.target.value })}
                    className="sw-money-input"
                    aria-label={'Price in ' + currencyCode}
                  />
                </span>
              </label>

              <div className="sw-plan">
                <span className="sw-label">Paid</span>
                <Segment
                  options={[
                    {
                      value: 'full',
                      label: 'in full',
                      active: values.payment_type !== 'installments',
                      onClick: () =>
                        onChange({ ...values, payment_type: 'full', installment_count: 1 }),
                    },
                    {
                      value: 'installments',
                      label: 'in instalments',
                      active: values.payment_type === 'installments',
                      /* Two is the smallest number that IS a plan. Landing on
                         1 would be "paid in full" with extra steps, and
                         `stepAnswered` refuses it. The old panel used the same
                         rule, written the same way. */
                      onClick: () =>
                        onChange({
                          ...values,
                          payment_type: 'installments',
                          installment_count: values.installment_count > 1 ? values.installment_count : 2,
                        }),
                    },
                  ]}
                />
              </div>

              {/*
                ───────────────────────────────────────────────────────────────
                THE SCHEDULE, WHICH THE CHIP ALONE NEVER WAS.
                ───────────────────────────────────────────────────────────────
                Pressing "in instalments" used to set a column and show nothing
                — no count, no cadence, no first payment — so the answer could
                not be given and the chip looked broken. Reported exactly that
                way.

                Shown only for a plan, and only inside the priced answer, so it
                cannot appear for a quote or a free service. The split is drawn
                with the real figures as it is chosen, because "3 of $100" is
                the thing the owner is actually deciding.
              */}
              {values.payment_type === 'installments' && (
                <div className="sw-schedule">
                  {/* Exactly two children, because the row is a two-column
                      grid: a label and ONE control. The input and the word
                      after it are one control, so they travel together. */}
                  <label className="sw-schedule-row">
                    <span className="sw-label">Split into</span>
                    <span className="sw-count-group">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={2}
                        max={24}
                        value={values.installment_count}
                        onChange={event =>
                          onChange({
                            ...values,
                            installment_count: Math.max(2, Math.min(24, Number(event.target.value) || 2)),
                          })
                        }
                        className="sw-schedule-count"
                        aria-label="Number of payments"
                      />
                      <span className="sw-label">payments</span>
                    </span>
                  </label>

                  <div className="sw-schedule-row">
                    <span className="sw-label">every</span>
                    <Segment
                      options={[
                        ['weekly', 'week'],
                        ['biweekly', 'two weeks'],
                        ['monthly', 'month'],
                        ['quarterly', 'quarter'],
                      ].map(([value, label]) => ({
                        value,
                        label,
                        active: values.installment_frequency === value,
                        onClick: () =>
                          onChange({
                            ...values,
                            installment_frequency: value as WizardValues['installment_frequency'],
                          }),
                      }))}
                    />
                  </div>

                  <div className="sw-schedule-row sw-schedule-row-wrap">
                    <span className="sw-label">first payment</span>
                    <Segment
                      options={[
                        {
                          value: 'on_booking',
                          label: 'when they book',
                          active: values.first_payment_due === 'on_booking',
                          /* Zero days, because there is no delay to remember. */
                          onClick: () =>
                            onChange({ ...values, first_payment_due: 'on_booking', first_payment_days: 0 }),
                        },
                        {
                          value: 'days_after',
                          label: 'later',
                          active: values.first_payment_due === 'days_after',
                          /* Seven, the old panel's default: "later" with no
                             number is not an answer, and landing on 0 would
                             mean the same as "when they book". */
                          onClick: () =>
                            onChange({
                              ...values,
                              first_payment_due: 'days_after',
                              first_payment_days: values.first_payment_days || 7,
                            }),
                        },
                      ]}
                    />
                    {/* The delay sits BESIDE the choice that creates it:
                        "later, 7 days after" is one sentence. On a row of its
                        own the number needed an empty label in front of it and
                        read as a fifth question. */}
                    {values.first_payment_due === 'days_after' && (
                      <>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={365}
                          /* At least a day. A zero here would mean the same
                             as "when they book", which is the other option. */
                          value={values.first_payment_days > 0 ? values.first_payment_days : 7}
                          onChange={event =>
                            onChange({
                              ...values,
                              first_payment_days: Math.max(
                                1,
                                Math.min(365, Number(event.target.value) || 1)
                              ),
                            })
                          }
                          className="sw-schedule-count"
                          aria-label="Days after booking"
                        />
                        <span className="sw-label">days after</span>
                      </>
                    )}
                  </div>


                  {/* The arrangement in the owner's own figures. */}
                  {Number(values.price) > 0 && values.installment_count >= 2 && (
                    <p className="sw-schedule-sum">
                      {values.installment_count} payments of{' '}
                      {currencySymbol +
                        (Number(values.price) / values.installment_count).toFixed(2).replace(/\.00$/, '')}
                      , one every{' '}
                      {values.installment_frequency === 'weekly'
                        ? 'week'
                        : values.installment_frequency === 'biweekly'
                          ? 'two weeks'
                          : values.installment_frequency === 'monthly'
                            ? 'month'
                            : 'quarter'}
                      .
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          aria-pressed={shape === 'quoted'}
          onClick={() => pick('quoted')}
          className={shape === 'quoted' ? 'sw-shape sw-shape-on' : 'sw-shape'}
        >
          <span className="sw-radio" data-on={shape === 'quoted' ? '1' : '0'} />
          <span className="sw-shape-text">
            <span className="sw-shape-title">I price it per job</span>
            <span className="sw-shape-note">
              Every job is different, so you send a quote and the amount is settled there. No price is needed now.
            </span>
          </span>
        </button>
      </div>
    </>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   3 · HOW THE MONEY REACHES YOU — a set price only
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * What the business has in place.
 *
 * KEPT, though this step no longer reads it: the shape is the vocabulary the
 * wizard uses for "ready to invoice" and "can actually charge", and step 4
 * answers the same two questions from `publishBlockers`. Deleting it would
 * only move the definition.
 */
export interface BusinessFacts {
  /** Invoice details complete, from the same test the publish gate uses. */
  invoiceReady: boolean;
  /** A processor that can actually charge. */
  processorReady: boolean;
  onFixInvoice?: () => void;
  onConnectProcessor?: () => void;
}

export function StepMoney({
  values,
  onChange,
  currencySymbol,
}: Omit<StepProps, 'currencyCode'>) {
  const amount = values.price.trim() ? currencySymbol + values.price.trim() : 'the amount';

  return (
    <>
      <div>
        <h2 className="sw-title">How does {amount} reach you?</h2>
        <p className="sw-lede">The amount is settled. This is only about how it arrives.</p>
      </div>

      <div className="sw-pair">
        <button
          type="button"
          aria-pressed={values.collection === 'online'}
          onClick={() => onChange({ ...values, collection: 'online' })}
          className={values.collection === 'online' ? 'sw-way sw-way-on' : 'sw-way'}
        >
          <span className="sw-way-head">
            <CreditCard className="sw-choice-icon" aria-hidden="true" />
            <span className="sw-way-title">They pay by card</span>
          </span>
          <span className="sw-way-note">
            Charged when they book. The money lands in your bank on Stripe&rsquo;s schedule.
          </span>
        </button>

        <button
          type="button"
          aria-pressed={values.collection === 'invoice'}
          onClick={() => onChange({ ...values, collection: 'invoice' })}
          className={values.collection === 'invoice' ? 'sw-way sw-way-on' : 'sw-way'}
        >
          <span className="sw-way-head">
            <FileText className="sw-choice-icon" aria-hidden="true" />
            <span className="sw-way-title">You invoice them</span>
          </span>
          <span className="sw-way-note">
            They book now and you bill afterwards. Bank transfer, cash, however you already work.
          </span>
        </button>
      </div>

      {/*
        ───────────────────────────────────────────────────────────────────────
        THE SETTING UP BELONGS TO STEP 4, AND IT WAS ASKED FOR HERE AS WELL.
        ───────────────────────────────────────────────────────────────────────
        This step used to carry two requirement rows under a "Taking a card
        needs" heading: the invoice details, with a Fill them in button, and a
        card account, with Connect. Step 4 already lists BOTH, built from
        `publishBlockers` — the real gate — with the same two actions.

        So an owner met the same two jobs twice, and the first time was in the
        middle of answering a different question. This step asks one thing,
        "how does the money reach you", and the owner should be able to answer
        it and move on.

        The copy is not lost. Step 4 states each job against what actually
        blocks publishing, and it is more accurate there: a card account is
        `optional` on that list, because a service with no processor still
        publishes and is invoiced instead, while the row here called it
        outstanding work.

        The one thing this step DID say that the gate does not — that a card
        service with no Stripe is invoiced for now — is said by the client rail
        beside it, in the client's own terms: "Gets an invoice, for now.
        Nobody is turned away."
      */}
    </>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   4 · READY TO PUBLISH
   ═══════════════════════════════════════════════════════════════════════════ */

export interface GateItem {
  state: 'done' | 'now' | 'optional';
  title: string;
  note: string;
  action?: { label: string; onPress?: () => void };
}

export function StepPublish({ items }: { items: GateItem[] }) {
  const outstanding = items.filter(item => item.state === 'now');

  return (
    <>
      <div>
        <h2 className="sw-title">
          {outstanding.length === 0
            ? 'Nothing stands between this and your clients'
            : outstanding.length === 1
              ? 'One thing stands between this and your clients'
              : outstanding.length + ' things stand between this and your clients'}
        </h2>
        <p className="sw-lede">This list is the publish gate itself, not a copy of it.</p>
      </div>

      <div className="sw-needs">
        {items.map(item => (
          <Requirement
            key={item.title}
            state={item.state === 'optional' ? 'waiting' : item.state}
            title={item.title}
            note={item.note}
            action={item.action}
            trailing={item.state === 'optional' ? 'Not blocking' : undefined}
          />
        ))}
      </div>

      <div className="sw-card">
        <p className="sw-card-head">Publishing does three things</p>
        <ul className="sw-card-list">
          <li>Puts it on your booking page, where clients can pick it.</li>
          <li>Opens your Money tab, because something can now be sold.</li>
          <li>Starts the reminders: a confirmation now, a nudge the day before.</li>
        </ul>
      </div>
    </>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   One requirement row, used by step 3 and step 4
   ═══════════════════════════════════════════════════════════════════════════ */

function Requirement({
  state,
  title,
  note,
  action,
  trailing,
}: {
  state: 'done' | 'now' | 'waiting';
  title: string;
  note: string;
  action?: { label: string; onPress?: () => void };
  trailing?: string;
}) {
  return (
    <div className={'sw-need sw-need-' + state}>
      <span className="sw-need-icon" aria-hidden="true">
        {state === 'done' ? (
          <Check width={16} height={16} color={DONE} strokeWidth={2.5} />
        ) : state === 'now' ? (
          <AlertTriangle width={16} height={16} color="var(--v2-warning)" strokeWidth={2} />
        ) : (
          <Clock width={16} height={16} color="var(--v2-text-tertiary, #64748B)" strokeWidth={2} />
        )}
      </span>

      <span className="sw-need-text">
        <span className="sw-need-title">{title}</span>
        <span className="sw-need-note">{note}</span>
      </span>

      {/* The action goes UNDER the text on a phone — see the stylesheet. Side
          by side, neither would have room to be read or pressed. */}
      {action && (
        <button
          type="button"
          onClick={action.onPress}
          className="sw-need-action"
          style={{ background: CONFIG_ACCENT }}
        >
          {action.label}
        </button>
      )}
      {!action && trailing && <span className="sw-need-trailing">{trailing}</span>}
    </div>
  );
}
