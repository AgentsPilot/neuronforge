/**
 * Every button a person presses takes its colour from ONE place.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `oneDashboardOneButton.guard.test.ts` settled this for two cards on the
 * dashboard. The rest of the platform had not moved: six more primary buttons
 * were painted with a fixed `#F97316`, or a two- or three-stop gradient down to
 * `#EA580C`, each with its own orange glow underneath.
 *
 * Three faults, not one taste:
 *
 *   · a fixed hex cannot follow the brand. `--v2-primary` is admin-set
 *     (`system_settings_config.v2_custom_tokens`) and is #fb923c for this
 *     business, #6366F1 by default — so the Needs-you button and the button on
 *     the next page were already different colours, and nobody could change
 *     both from one place;
 *   · a fixed hex has no dark mode. `ap-primary-lift` exists because a white
 *     label on a bright orange fill stops resolving into letters on a dark
 *     ground: the class deepens the fill and swaps the coloured halo for a
 *     plain dark shadow. An inline gradient gets neither;
 *   · the glows themselves. `0 6px 16px -8px rgba(249,115,22,0.9)` on a dark
 *     surface is a halo, which is the "buttons look blurry" report.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE ACCENT KEEPS, which is why this test names files rather than
 * grepping for orange: the advisor's orb, the chat avatars and the owner's own
 * message bubble, the station icons, the timeline dots, the eyebrows. None of
 * them is pressed. The asserted counts below are there so removing a BUTTON's
 * gradient cannot quietly take a piece of chrome with it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const read = (...parts: string[]) => readFileSync(join(root, ...parts), 'utf-8');

const FUNNEL_DRAWER = read('components', 'business-os', 'insight', 'FunnelDrawer.tsx');
const REACH = read('components', 'business-os', 'insight', 'ClientReachJourney.tsx');
const DASHBOARD = read('components', 'business-os', 'insight', 'LiveDashboard.tsx');
const PREVIEW = read('components', 'business-os', 'PreviewSlidePanel.tsx');
const CHAT = read('components', 'business-os', 'ChatCommandPanel.tsx');
const ONBOARDING = read('app', 'onboarding-chat', 'page.tsx');
const DRAWER_PAYMENTS = read('components', 'crm', 'contact-drawer', 'PaymentsSection.tsx');

const count = (source: string, needle: string) => source.split(needle).length - 1;

describe('the fill comes from the token', () => {
  it.each([
    ['the funnel drawer todo button', FUNNEL_DRAWER],
    ['the reach journey primary', REACH],
    ['the dashboard publish CTA', DASHBOARD],
    ['the preview panel publish', PREVIEW],
    ['the chat panel confirm and send', CHAT],
    ['the onboarding forward button', ONBOARDING],
  ])('%s paints with --v2-primary and lifts with the class', (_name, source) => {
    expect(source).toContain('--v2-primary');
    expect(source).toContain('ap-primary-lift');
  });
});

describe('no pressable keeps a hardcoded orange', () => {
  it('the funnel drawer todo button lost the gradient and its glow', () => {
    /* The orb three lines above it keeps BOTH: `rgba(249,115,22,0.13)` is a
       3px ring on a 20px circle, not a shadow under a button. */
    expect(FUNNEL_DRAWER).not.toContain('-7px rgba(249,115,22,0.9)');
    expect(count(FUNNEL_DRAWER, 'linear-gradient(120deg, #FFB454')).toBe(1);
  });

  it('the reach journey button lost its hex and its glow', () => {
    expect(REACH).not.toContain('background: #F97316');
    expect(REACH).not.toContain('rgba(249,115,22,0.9)');
    /*
     * The whole file is now free of hardcoded orange.
     *
     * This used to anchor on `.crj-ic` keeping its gradient, as proof the file
     * had not simply been emptied. That element is gone: the journey was
     * rebuilt and the station no longer draws a gradient icon, so the anchor
     * is the token instead — the one colour a pressable here may paint with,
     * and the business's own brand rather than our orange.
     */
    expect(REACH).not.toContain('#FFB454');
    expect(REACH).not.toContain('#F97316');
    expect(REACH).toContain('var(--v2-primary)');
  });

  it('the dashboard CTA and the preview publish lost the 135deg gradient', () => {
    expect(DASHBOARD).not.toContain('linear-gradient(135deg, #F97316');
    expect(PREVIEW).not.toContain('linear-gradient(135deg, #F97316');
    expect(DASHBOARD).not.toContain('rgba(249, 115, 22, 0.4)');
  });

  it('the chat panel keeps the gradient on its chrome only', () => {
    /* Two avatars (135deg) and the owner's own bubble (120deg). The send key
       was the third 120deg and is now the token. */
    expect(CHAT).not.toContain("background: '#F97316'");
    expect(count(CHAT, 'linear-gradient(135deg, #F97316')).toBe(2);
    expect(count(CHAT, 'linear-gradient(120deg, #FFB454')).toBe(1);
  });

  it('the onboarding button is a token, not the hex it was', () => {
    /* The hexes are asserted as the CLASSES they were, because the comment
       above `ORANGE_BUTTON` still names them to say what changed. */
    expect(ONBOARDING).not.toContain('bg-[#F97316]');
    expect(ONBOARDING).not.toContain('border-[#EA580C]');
    expect(ONBOARDING).not.toContain('hover:bg-[#EA580C]');
    expect(ONBOARDING).toContain('bg-[var(--v2-primary)] ap-primary-lift');
  });
});

describe('the token alone is only half of it', () => {
  /*
   * The contact drawer's "send a reminder" was the case that proves the pair
   * has to be guarded together: it already painted `var(--v2-primary)` and
   * still looked like the old orange, because without the class nothing
   * deepens the fill in dark mode. A test that only checked the fill would
   * have passed on it.
   */
  it('the reminder button carries both, and the lift only while filled', () => {
    /* To the end of the element, not a guessed character count: the comment
       above the className is long enough that a window would clip the style. */
    const from = DRAWER_PAYMENTS.indexOf('onClick={() => void remind(item)}');
    const button = DRAWER_PAYMENTS.slice(from, DRAWER_PAYMENTS.indexOf('</button>', from));

    expect(button).toContain("background: 'var(--v2-primary)', color: '#fff'");
    expect(button.replace(/\s+/g, ' ')).toContain(
      "(reminded.has(item.key) ? '' : ' ap-primary-lift')"
    );
  });

  it('and animates what it now changes', () => {
    /* `transition-colors` had nothing to carry a brightness or a scale. */
    expect(DRAWER_PAYMENTS).toContain(
      'transition-all hover:brightness-110 active:scale-[0.97]'
    );
  });
});

describe('settings, where the token was there and the lift was not', () => {
  /*
   * Reported on the plan drawer: "השוואת תוכניות is not by the new button
   * design". It was already `bg-[var(--v2-primary)]` — and that was the whole
   * trap. Every filled button in Settings had the fill and none had the class,
   * so none of them deepened in dark mode, and several faded themselves with
   * `hover:opacity-90`: on the brand orange that takes a white label from about
   * 2.26:1 to under 2:1, on the one interaction meant to make it clearer.
   *
   * Listed by file rather than swept, because the same token is also a TINT
   * here (`/5` on the recommended column, `/10` on the band, `/15` on a badge)
   * and a tint must not be touched.
   */
  const SETTINGS = [
    'PlanSection.tsx',
    'PlanManage.tsx',
    'PlanPurchase.tsx',
    'PlanUpgrade.tsx',
    'PlanCancelDrawer.tsx',
    'ChangePasswordDrawer.tsx',
    'InviteFriendsSection.tsx',
    'MarketingConsentPanel.tsx',
    'InvoiceSettingsSection.tsx',
    'UpgradeModal.tsx',
  ] as const;

  it.each(SETTINGS)('%s gives its filled primary the lift', (file) => {
    expect(read('components', 'business-os', 'settings', file)).toContain('ap-primary-lift');
  });

  it('and the settings page itself', () => {
    expect(read('app', 'business-os', 'settings', 'page.tsx')).toContain('ap-primary-lift');
  });

  it('no settings primary fades itself on hover any more', () => {
    /*
     * `hover:opacity-90` is the one to stay gone: it dims the LABEL with the
     * fill. `brightness` moves the fill and leaves white at white.
     *
     * Comments are stripped the way `upgradeModal.guard`'s own `code()` does,
     * because the note explaining this change quotes the class it removed.
     */
    const stripped = (source: string) =>
      source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((line) => (/^\s*\/\//.test(line) ? '' : line.replace(/\s\/\/\s.*$/, '')))
        .join('\n');

    for (const file of SETTINGS) {
      const source = stripped(read('components', 'business-os', 'settings', file));
      expect(`${file}: ${source.includes('hover:opacity-90')}`).toBe(`${file}: false`);
    }
  });

  it('the compare-plans button sits in the drawer footer, not at the end of the scroll', () => {
    /*
     * `TabFooter` portals into the slot `SettingsDrawer` renders after the
     * scroll body — the same mechanism the profile and invoice tabs use for
     * Save. The modal stays OUT of the footer: only the button moved.
     */
    const section = read('components', 'business-os', 'settings', 'PlanSection.tsx');

    expect(section).toContain("import { TabFooter } from './TabFooter';");
    expect(section.indexOf('<TabFooter>')).toBeLessThan(
      section.indexOf('data-testid="plan-compare-open"')
    );
    expect(section.indexOf('data-testid="plan-compare-open"')).toBeLessThan(
      section.indexOf('</TabFooter>')
    );
    expect(section.indexOf('</TabFooter>')).toBeLessThan(section.indexOf('<UpgradeModal'));
  });

  it('and keeps the spelling the upgrade-modal guard pins', () => {
    /*
     * `upgradeModal.guard` proves its own colour pin by rewriting the literal
     * `text-white bg-[var(--v2-primary)]` and expecting a throw. Inserting the
     * lift BETWEEN those two classes would leave that negative control with
     * nothing to replace, and it would stop failing on the thing it exists to
     * catch. The lift goes after the fill.
     */
    expect(read('components', 'business-os', 'settings', 'PlanSection.tsx')).toContain(
      'text-white bg-[var(--v2-primary)] ap-primary-lift'
    );
    for (const file of ['PlanUpgrade.tsx', 'PlanPurchase.tsx'] as const) {
      expect(read('components', 'business-os', 'settings', file)).toContain(
        "'rounded bg-[var(--v2-primary)]"
      );
    }
  });
});

describe('the lift stays a class, never an inline shadow', () => {
  /*
   * The one rule that cannot be inlined: `app/globals.css` answers `.dark` for
   * it. Written inline, dark mode goes back to a coloured halo and a white
   * label at roughly 2:1.
   */
  it.each([
    ['FunnelDrawer', FUNNEL_DRAWER],
    ['LiveDashboard', DASHBOARD],
    ['PreviewSlidePanel', PREVIEW],
    ['ChatCommandPanel', CHAT],
  ])('%s declares no shadow beside the token fill', (_name, source) => {
    expect(source).not.toContain("boxShadow: '0 2px 8px -2px");
  });

  it('and the reach journey does not redeclare it in styled-jsx', () => {
    /*
     * Specificity, not taste: styled-jsx scopes `.crj-btn` to `.crj-btn.jsx-x`,
     * which outranks the global `.ap-primary-lift`. A `box-shadow` left in that
     * rule would win and the class would do nothing in light mode.
     */
    const rule = REACH.slice(REACH.indexOf('.crj-btn {'), REACH.indexOf('.crj-btn:hover'));

    expect(rule).toContain('background: var(--v2-primary)');
    expect(rule).not.toContain('box-shadow');
  });

  it('the reach journey quiet variant does NOT wear the lift', () => {
    /*
     * It overrides the fill with `!important`, and the class's dark-mode rule
     * is `!important` too and more specific. Both on one element paints the
     * SECONDARY orange in dark mode.
     */
    expect(REACH).toContain('className="crj-btn crj-btn-quiet"');
    expect(REACH).not.toContain('crj-btn crj-btn-quiet ap-primary-lift');
  });
});
