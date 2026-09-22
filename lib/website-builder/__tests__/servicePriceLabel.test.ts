/**
 * What a service card says where the price goes.
 *
 * Written because the free case was reported broken twice while the code read
 * as though it worked. A test settles that; re-reading the code does not.
 */

import { blockServiceIcon, SERVICE_ICON, servicePriceLabel, toServiceCard } from '../serviceCard';

const LABELS = { free: 'Free', onRequest: 'Price on request' };

describe('servicePriceLabel', () => {
  it('says Free for a service priced at zero', () => {
    expect(servicePriceLabel({ priceRaw: 0 }, LABELS)).toBe('Free');
  });

  it('says Free even though there is no formatted price', () => {
    // The live shape: a zero price produces no `price` string on purpose,
    // because "$0" reads as a pricing error rather than as free.
    expect(servicePriceLabel({ price: undefined, priceRaw: 0, sale_mode: 'direct' }, LABELS)).toBe('Free');
  });

  it('says nothing for a service nobody has priced', () => {
    // Absent is not zero. Announcing "Free" here would invent a price.
    expect(servicePriceLabel({ sale_mode: 'direct' }, LABELS)).toBeNull();
    expect(servicePriceLabel({ priceRaw: null }, LABELS)).toBeNull();
  });

  it('shows the figure for a priced service', () => {
    expect(servicePriceLabel({ price: '$200', priceRaw: 200 }, LABELS)).toBe('$200');
  });

  it('says Price on request for a quoted service, whatever its price', () => {
    expect(servicePriceLabel({ sale_mode: 'proposal' }, LABELS)).toBe('Price on request');
    expect(servicePriceLabel({ priceRaw: 0, sale_mode: 'proposal' }, LABELS)).toBe('Price on request');
  });
});

describe('toServiceCard', () => {
  const base = { id: 's1', service_name: 'Intro', currency: 'USD' };

  it('keeps a zero price instead of dropping it', () => {
    // `||` collapsed 0 into undefined in three of the four producers, which is
    // what made a free service render with no price line at all.
    const card = toServiceCard({ ...base, price: 0 });
    expect(card.priceRaw).toBe(0);
    expect(card.price).toBeUndefined();
    expect(servicePriceLabel(card, LABELS)).toBe('Free');
  });

  it('leaves priceRaw absent when no price is set', () => {
    expect(toServiceCard({ ...base, price: null }).priceRaw).toBeUndefined();
  });

  it('formats a real price', () => {
    const card = toServiceCard({ ...base, price: 200 });
    expect(card.price).toBe('$200');
    expect(servicePriceLabel(card, LABELS)).toBe('$200');
  });

  it('gives every service the same icon, whatever its name or language', () => {
    // The bug this replaces: an English-keyword matcher gave "Custom Training"
    // a dumbbell and left "קורס ADHD" and "Intro" on a fallback star.
    const names = ['Custom Training', 'קורס ADHD', 'Intro', 'Entrenamiento'];
    const icons = names.map(n => toServiceCard({ ...base, service_name: n }).icon);
    expect(new Set(icons).size).toBe(1);
  });
});

describe('blockServiceIcon', () => {
  it('gives a trainer a dumbbell, including on the services that match nothing', () => {
    // The user's real catalogue. "Intro" and "קורס ADHD" match no rule on their
    // own — under the old per-card guess they showed a fallback star beside a
    // dumbbell, which is what made the row look broken.
    const icon = blockServiceIcon([
      { name: 'Training' },
      { name: 'Training Package' },
      { name: 'Training 60 min' },
      { name: 'Custom Training' },
      { name: 'Intro' },
      { name: 'קורס ADHD' },
    ]);

    expect(icon).toBe('Dumbbell');
  });

  it('reads Hebrew, so a Hebrew-speaking business is not left on the default', () => {
    expect(blockServiceIcon([{ name: 'אימון אישי' }, { name: 'אימון זוגי' }])).toBe('Dumbbell');
    expect(blockServiceIcon([{ name: 'טיפול רגשי' }, { name: 'טיפול משפחתי' }])).toBe('Heart');
  });

  it('follows the majority rather than the first match', () => {
    const icon = blockServiceIcon([
      { name: 'Intro call' },       // MessageCircle
      { name: 'Personal training' }, // Dumbbell
      { name: 'Group training' },    // Dumbbell
    ]);

    expect(icon).toBe('Dumbbell');
  });

  it('falls back to the neutral mark when nothing is recognisable', () => {
    // The honest answer: none of these names says what the service is.
    expect(blockServiceIcon([{ name: 'Alpha' }, { name: 'Beta' }])).toBe(SERVICE_ICON);
    expect(blockServiceIcon([])).toBe(SERVICE_ICON);
  });

  it('gives every card on a page the SAME icon', () => {
    // The whole point. One value for the block, not one guess per card.
    const services = [{ name: 'Training' }, { name: 'Intro' }, { name: 'קורס ADHD' }];
    const icon = blockServiceIcon(services);
    expect(services.every(() => blockServiceIcon(services) === icon)).toBe(true);
  });
});
