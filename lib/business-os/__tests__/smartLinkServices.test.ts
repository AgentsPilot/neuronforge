/**
 * What a booking link offers, and the one thing it must never do: go stale.
 *
 * The bug these pin down was found on a live account. A smart link had five
 * service ids written into its URL on the day it was made. Two of those services
 * had since been deleted, and the newest service — added weeks later — was not
 * in the list and therefore could not appear on the link at all. The link was
 * named "5 services" and served three.
 */

import { servicesForLink } from '../smartLinkServices';

const CONSULT = { id: 'consult' };
const COURSE = { id: 'course' };
/** Created after the link was — the one that used to be invisible. */
const NEW_SERVICE = { id: 'brand-new' };
const CATALOGUE = [CONSULT, COURSE, NEW_SERVICE];

describe('a link that excludes nothing', () => {
  it('offers everything, including services added since', () => {
    expect(servicesForLink(CATALOGUE, {})).toEqual(CATALOGUE);
  });

  it('treats an empty parameter as no parameter', () => {
    expect(servicesForLink(CATALOGUE, { excludeParam: '', servicesParam: '' })).toEqual(CATALOGUE);
    expect(servicesForLink(CATALOGUE, { excludeParam: ' , ' })).toEqual(CATALOGUE);
  });
});

describe('a link that leaves something off', () => {
  it('drops what it excludes and keeps the rest', () => {
    expect(servicesForLink(CATALOGUE, { excludeParam: 'course' })).toEqual([CONSULT, NEW_SERVICE]);
  });

  it('still picks up a service created after the link was made', () => {
    // The whole point of storing exclusions: `brand-new` was never named
    // anywhere, and that is exactly why it is on the link.
    const offered = servicesForLink(CATALOGUE, { excludeParam: 'course' });
    expect(offered).toContain(NEW_SERVICE);
  });

  it('ignores an excluded id that no longer exists', () => {
    expect(servicesForLink(CATALOGUE, { excludeParam: 'deleted-service,course' })).toEqual([
      CONSULT,
      NEW_SERVICE,
    ]);
  });
});

describe('links written the old way, with an inclusion list', () => {
  it('narrows to the pinned services', () => {
    expect(servicesForLink(CATALOGUE, { servicesParam: 'consult,course' })).toEqual([
      CONSULT,
      COURSE,
    ]);
  });

  it('drops pinned ids that no longer resolve', () => {
    // Two of this link's five ids are deleted services — the live case.
    expect(servicesForLink(CATALOGUE, { servicesParam: 'consult,gone-1,gone-2' })).toEqual([
      CONSULT,
    ]);
  });

  it('falls back to the whole catalogue when NOTHING pinned survives', () => {
    // Rather than an empty booking page, which tells the visitor nothing and
    // leaves the business unaware their link has stopped selling.
    expect(servicesForLink(CATALOGUE, { servicesParam: 'gone-1,gone-2' })).toEqual(CATALOGUE);
  });

  it('is what it is: a frozen list does not pick up a new service', () => {
    // Asserted rather than merely true, because it is the reason links are no
    // longer written this way.
    expect(servicesForLink(CATALOGUE, { servicesParam: 'consult,course' })).not.toContain(
      NEW_SERVICE
    );
  });
});

describe('when both are present', () => {
  it('the exclusion wins — it is the one that keeps up', () => {
    expect(
      servicesForLink(CATALOGUE, { excludeParam: 'consult', servicesParam: 'consult,course' })
    ).toEqual([COURSE, NEW_SERVICE]);
  });
});
