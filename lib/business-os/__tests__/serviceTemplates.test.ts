/**
 * "What are you selling?" pre-fills the wizard and decides nothing else.
 *
 * The screen in front of a new service's four questions. Each card is a set of
 * starting answers, applied through the wizard's own `applyCostShape`, so a
 * template can never put the wizard in a state its own controls could not.
 * These cases pin what each card fills in, that the owner-only fields stay
 * empty, and that a business with no calendar is not offered one it would
 * need.
 */

import { applyCostShape, costShapeOf, type WizardValues } from '@/lib/business-os/serviceWizard';
import { serviceRequirements } from '@/lib/business-os/setup/serviceRequirements';
import {
  SERVICE_TEMPLATES,
  applyServiceTemplate,
  templateRequirements,
  templatesFor,
} from '@/lib/business-os/serviceTemplates';

/** A new row as "Add a service" opens it today: price '0', which reads as free. */
const NEW_ROW: WizardValues & { currency: string } = {
  name: '',
  description: '',
  duration: '60',
  buffer: '0',
  is_scheduled: true,
  price: '0',
  collection: 'invoice',
  sale_mode: 'direct',
  payment_type: 'full',
  installment_count: 1,
  installment_frequency: 'monthly',
  first_payment_due: 'on_booking',
  first_payment_days: 0,
  currency: 'USD',
};

const needsOf = (values: WizardValues) =>
  serviceRequirements({
    is_scheduled: values.is_scheduled,
    price: values.price === '' ? null : parseFloat(values.price),
    collection: values.collection,
    sale_mode: values.sale_mode,
  });

describe('what each card fills in', () => {
  it('a course is bought, not booked, set-priced and paid by card', () => {
    const course = applyServiceTemplate(NEW_ROW, 'course');

    expect(course.is_scheduled).toBe(false);
    expect(costShapeOf(course)).toBe('unanswered'); // the price is the owner's to type
    expect(course.sale_mode).toBe('direct');
    expect(course.collection).toBe('online');
    /* No hours: nothing to book. Card: invoice details first, then the processor. */
    expect(needsOf({ ...course, price: '120' })).toEqual(['invoice', 'processor']);
  });

  it('a job by quote has no calendar step and is settled in the quote', () => {
    const quote = applyServiceTemplate(NEW_ROW, 'quote');

    expect(quote.is_scheduled).toBe(false);
    expect(costShapeOf(quote)).toBe('quoted');
    expect(needsOf(quote)).not.toContain('hours');
  });

  it('a package is booked and priced by quote, where its sessions are set', () => {
    const pack = applyServiceTemplate(NEW_ROW, 'package');

    expect(pack.is_scheduled).toBe(true);
    expect(costShapeOf(pack)).toBe('quoted');
    expect(needsOf(pack)).toContain('hours');
  });

  it('an appointment is booked with a price still to type', () => {
    const appointment = applyServiceTemplate(NEW_ROW, 'appointment');

    expect(appointment.is_scheduled).toBe(true);
    /* '0' would read as free. The template clears it for the owner to type. */
    expect(appointment.price).toBe('');
    expect(appointment.sale_mode).toBe('direct');
  });

  it('an intro call is booked and free', () => {
    const call = applyServiceTemplate(NEW_ROW, 'intro_call');

    expect(call.is_scheduled).toBe(true);
    expect(costShapeOf(call)).toBe('free');
    expect(needsOf(call)).toEqual(['hours']);
  });
});

describe('the checklist the card shows', () => {
  it('a course lists invoice details and a card account, though its price is still empty', () => {
    /* Read as "collects nothing" without the adjustment, which would hide the
       two things a card-paid course needs most. */
    expect(templateRequirements(applyServiceTemplate(NEW_ROW, 'course'))).toEqual(['invoice', 'processor']);
  });

  it('an appointment lists hours and invoice details', () => {
    expect(templateRequirements(applyServiceTemplate(NEW_ROW, 'appointment'))).toEqual(['hours', 'invoice']);
  });

  it('a free intro call needs only hours: free stays free', () => {
    expect(templateRequirements(applyServiceTemplate(NEW_ROW, 'intro_call'))).toEqual(['hours']);
  });

  it('a job by quote needs only invoice details', () => {
    expect(templateRequirements(applyServiceTemplate(NEW_ROW, 'quote'))).toEqual(['invoice']);
  });
});

describe('what a template never does', () => {
  it.each(SERVICE_TEMPLATES.map(template => template.id))(
    '%s leaves the name, description and currency alone',
    id => {
      const typed = { ...NEW_ROW, name: 'Mine', description: 'Also mine', currency: 'ILS' };
      const result = applyServiceTemplate(typed, id);

      expect(result.name).toBe('Mine');
      expect(result.description).toBe('Also mine');
      expect(result.currency).toBe('ILS');
    }
  );

  it.each(SERVICE_TEMPLATES.map(template => template.id))(
    '%s lands on a state the wizard itself would produce',
    id => {
      /* Re-applying the wizard's own transform for the shape it ended on
         changes nothing money-related: no half-applied shape. */
      const result = applyServiceTemplate(NEW_ROW, id);
      const shape = costShapeOf(result);
      if (shape === 'unanswered') return;

      const again = applyCostShape(result, shape);
      expect(again.sale_mode).toBe(result.sale_mode);
      expect(again.price).toBe(result.price);
      expect(again.collection).toBe(result.collection);
    }
  );
});

describe('only what the business can sell', () => {
  it('with no working hours, no card needs a calendar', () => {
    const offered = templatesFor(false).map(template => template.id);

    expect(offered).toEqual(['course', 'quote']);
    expect(templatesFor(false).every(template => !template.needsCalendar)).toBe(true);
  });

  it('with working hours, every card', () => {
    expect(templatesFor(true)).toHaveLength(SERVICE_TEMPLATES.length);
  });

  it('unknown offers every card rather than hiding one on a slow request', () => {
    expect(templatesFor(null)).toHaveLength(SERVICE_TEMPLATES.length);
  });

  it('every card that needs a calendar is one whose service needs hours', () => {
    for (const template of SERVICE_TEMPLATES) {
      const needsHours = needsOf(applyServiceTemplate({ ...NEW_ROW, price: '50' }, template.id)).includes('hours');
      expect(template.needsCalendar).toBe(needsHours);
    }
  });
});
