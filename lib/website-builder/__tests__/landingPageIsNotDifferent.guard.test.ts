/**
 * A landing page behaves like the website. It just sells one service.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG
 *
 * Three surfaces render a services block, and a visitor should not be able to
 * tell them apart:
 *
 *   the published site     `/api/website/public/[subdomain]`
 *   the website preview    `/api/website/pages/[id]/blocks-with-content`
 *   the landing preview    `/api/website/landing-pages/preview`
 *
 * The first two replace whatever the generator wrote with the LIVE catalogue.
 * The third did not, and the difference was not cosmetic. A stored card carries
 * a name and a price and none of `id`, `is_scheduled`, `collection` or
 * `sale_mode` — the facts `flowForService` reads to choose a service's journey,
 * taken by `WebsiteBlocks` straight out of this block's content. So on a
 * landing page every service fell back to the page's default flow, and a card
 * the generator had invented ("קורס מומחים", on an account with no such
 * service) resolved to nothing at all.
 *
 * The reporting account made both halves visible at once: four cards on the
 * landing page, three real and one imaginary, none with an id.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PINS
 *
 * That the landing route loads the same catalogue the other two do, through the
 * one helper rather than a fourth copy of the read — `toServiceCard` exists
 * because the MAPPING had already been copied five times and the copies drifted.
 * And that the narrowing to one service is the only difference.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

import { narrowToPageService, type LiveServiceCard } from '../liveServiceCards';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const codeOf = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const LANDING = 'app/api/website/landing-pages/preview/route.ts';
const PAGE = 'app/landing-preview/page.tsx';

const landing = codeOf(LANDING);
const page = codeOf(PAGE);

const card = (id: string, name: string): LiveServiceCard => ({
  id,
  name,
  description: '',
  icon: 'calendar',
  is_scheduled: true,
  collection: 'online',
  sale_mode: 'direct',
  isActive: true,
});

describe('the landing page shows the live service', () => {
  it('strips comments before matching, or it fails on its own explanation', () => {
    expect(read(LANDING)).toContain('THE REAL SERVICE, NOT THE ONE THE GENERATOR DESCRIBED');
    expect(landing).not.toContain('THE REAL SERVICE, NOT THE ONE THE GENERATOR DESCRIBED');
  });

  it('loads the catalogue through the shared helper', () => {
    // Not a fourth copy of the read: the mapping was already copied five times
    // and the copies drifted.
    expect(landing).toContain("from '@/lib/website-builder/liveServiceCards'");
    expect(landing).toContain('loadLiveServiceCards(user.id)');
  });

  it('writes it into the services block, which is where the journey is read from', () => {
    expect(landing).toMatch(/block\.block_type === 'services'/);
    expect(landing).toContain('content.services = liveServiceCards;');
  });

  it('asks for the payment capability the other surfaces are given', () => {
    // Without it the journey draws no payment step, so a service sold online
    // behaved like one that is invoiced.
    expect(landing).toContain('resolvePaymentCollectionCapability(supabaseServer, user.id)');
    expect(landing).toContain('paymentsEnabled:');
  });

  it('and the preview page passes that on to the blocks', () => {
    expect(page).toContain('paymentsEnabled: result.paymentsEnabled === true');
    expect(page).toContain('paymentsEnabled={paymentsEnabled}');
  });
});

describe('selling one service is the only difference', () => {
  const catalogue = [card('a', 'ייעוץ אישי'), card('b', 'פגישת היכרות'), card('c', 'קורס קשב')];

  it('narrows to the page’s own service', () => {
    expect(narrowToPageService(catalogue, 'b').map(c => c.name)).toEqual(['פגישת היכרות']);
  });

  it('keeps the whole catalogue when the page names none', () => {
    expect(narrowToPageService(catalogue, undefined)).toHaveLength(3);
    expect(narrowToPageService(catalogue, null)).toHaveLength(3);
  });

  it('shows nothing rather than the others when the service is gone', () => {
    /*
     * Deleted or deactivated. Offering the remaining four services on a page
     * written to sell one answers a question nobody asked, which is the fault
     * the public route already guards against for its pricing block.
     */
    expect(narrowToPageService(catalogue, 'deleted-id')).toEqual([]);
  });

  it('carries the facts a journey is built from', () => {
    // The whole point: these are what the stored cards lacked.
    const [one] = narrowToPageService(catalogue, 'a');
    expect(one).toMatchObject({ id: 'a', is_scheduled: true, collection: 'online', sale_mode: 'direct' });
  });
});
