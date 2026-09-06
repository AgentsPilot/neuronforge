'use client';

/**
 * The Business OS navigation bar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LINKS, NOT TAB STATE
 *
 * Every area is already its own route, each with its own data fetching and its
 * own deep-linkable parameters (`?view=design`, `?section=business`,
 * `?invoice=…`). So this is navigation, and it is built from `next/link`:
 * refresh, the back button and a pasted URL all keep working, and the
 * 7,000-line website page stays out of everyone else's bundle.
 *
 * `components/ui/tabs.tsx` exists but is a Radix controlled-state primitive for
 * tabs WITHIN a page. Using it here would mean mirroring the router into
 * component state and keeping the two in sync, for no gain.
 *
 * COLOURS AND NAMES ARE INHERITED, not invented. Each tab wears the colour its
 * capability card already had — `CARD_CONFIG` in CapabilityCard.tsx — so the
 * change reads as the same product rearranged rather than a redesign. Reports
 * and Payments share the green they have always shared and are told apart by
 * their icons, exactly as the two view buttons on the old Reports page were.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Sun, Users, Receipt, BarChart3, Globe, Settings } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { useConfigurationDialog } from '@/components/business-os/ConfigurationDialogProvider';
import { useCapabilities } from '@/components/business-os/CapabilitiesProvider';
import { filterByCapability } from '@/lib/business-os/tabVisibility';
import { PAGE_CONTAINER } from '@/lib/business-os/pageContainer';

interface TabDef {
  /**
   * The route this tab navigates to, or `null` for the one entry that opens a
   * dialog instead — Configuration. Services, availability, intake and payments
   * have never been a page; they are the modal the capability card on My Day
   * opens, and the tab opens the same modal so the two agree.
   *
   * The account settings reached by the gear in the header —
   * `/business-os/settings`, holding profile, business details, invoice details
   * and password — are a different screen and stay where they are.
   */
  href: string | null;
  color: string;
  Icon: typeof Sun;
  labelKey: string;
  fallback: string;
  /**
   * The capability that has to be switched on for this tab to appear — the same
   * gate the capability cards on My Day have always used. Absent means the tab
   * is unconditional: My Day is where everyone starts, and Configuration is how
   * capabilities get switched on in the first place, so gating it on one would
   * be a trap.
   */
  capability?: string;
}

/**
 * Order follows the working day: what needs attention, who it is for, what it
 * earned, how it is going, how people find you, and last the settings you
 * change rarely.
 */
const TABS: TabDef[] = [
  { href: '/business-os', color: '#F97316', Icon: Sun, labelKey: 'nav.myday', fallback: 'My day' },
  { href: '/business-os/crm', color: '#8B5CF6', Icon: Users, labelKey: 'cap.people.name', fallback: 'People', capability: 'crm' },
  { href: '/business-os/orders', color: '#22C58B', Icon: Receipt, labelKey: 'nav.payments', fallback: 'Orders', capability: 'payments' },
  { href: '/business-os/reports', color: '#22C58B', Icon: BarChart3, labelKey: 'cap.reports.name', fallback: 'Reports', capability: 'reports' },
  { href: '/business-os/website', color: '#4F6EF7', Icon: Globe, labelKey: 'cap.website.name', fallback: 'Online presence', capability: 'website' },
  { href: null, color: '#D14E97', Icon: Settings, labelKey: 'cap.config.name', fallback: 'Configuration' },
];

/**
 * One cell's geometry, shared by the five links and the one button so they
 * cannot drift apart. `appearance-none` and the explicit background keep the
 * button from inheriting a UA button style next to its five sibling anchors.
 */
const TAB_CLASS =
  'group flex flex-1 sm:flex-none flex-col sm:flex-row items-center justify-center ' +
  'sm:justify-start gap-1 sm:gap-2 px-1 sm:px-4 py-2 sm:py-3 whitespace-normal ' +
  'sm:whitespace-nowrap text-sm font-medium transition-colors border-b-2 min-w-0 ' +
  'appearance-none bg-transparent';

/**
 * Which tab owns this path.
 *
 * Longest match wins, so `/business-os/website/design/x` highlights Online
 * presence rather than My Day — a plain `startsWith` against `/business-os`
 * would match everything, since it is the prefix of every other route.
 */
function activeHref(pathname: string): string {
  return TABS.map((tab) => tab.href)
    .filter((href): href is string => href !== null)
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0] ?? '';
}

export function BusinessOSTabs() {
  const pathname = usePathname();
  const { t, isRTL } = useLanguage();
  const { openConfiguration } = useConfigurationDialog();
  const { capabilities, status } = useCapabilities();
  const tabs = filterByCapability(TABS, capabilities, status);
  const active = activeHref(pathname ?? '');
  const activeRef = useRef<HTMLAnchorElement>(null);

  // Only matters between the two layouts — a narrow tablet wide enough for
  // labels but not for six of them. On a phone nothing scrolls, and on a desktop
  // everything fits. `nearest` so a tab already visible does not jump.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);

  return (
    <nav
      dir={isRTL ? 'rtl' : 'ltr'}
      aria-label={t('nav.label') || 'Business areas'}
      className="border-b border-[var(--v2-border)] bg-[var(--v2-surface)]"
    >
      <div className={PAGE_CONTAINER}>
        {/*
          Two layouts, and the phone one is not a squeezed desktop.

          Below `sm` the six tabs SHARE the width — `flex-1`, name stacked under
          the icon, nothing scrolling. A horizontally scrolling strip hides half
          the product behind a gesture most people never try, and the previous
          version made it worse by showing only the active tab's label, so the
          row reflowed on every navigation.

          From `sm` up they size to their labels and the row scrolls if a narrow
          tablet cannot fit all six.
        */}
        <div className="flex gap-0 sm:gap-1 sm:overflow-x-auto scrollbar-hide">
          {tabs.map(({ href, color, Icon, labelKey, fallback }) => {
            const isActive = href !== null && href === active;

            // The area's own colour when active; the underline is what carries
            // it, so an inactive tab stays quiet rather than painting six
            // colours across the bar at once.
            const tint = {
              color: isActive ? color : 'var(--v2-text-secondary)',
              borderBottomColor: isActive ? color : 'transparent',
            };

            const body = (
              <>
                <Icon
                  className="h-4 w-4 flex-shrink-0"
                  style={{ color: isActive ? color : 'var(--v2-text-muted)' }}
                  strokeWidth={2}
                />
                {/* Every tab keeps its name, including on a phone — under the
                    icon, small, wrapping to at most two lines. Icons alone would
                    leave two green tabs (Payments and Reports) distinguishable
                    only by the shape of a glyph.

                    `break-words` is for "Configuration" / "Configuración":
                    thirteen characters with nowhere to wrap, which would
                    otherwise be clipped mid-word by the line clamp. */}
                <span className="text-[10px] leading-tight text-center break-words sm:text-sm sm:leading-normal sm:text-start sm:break-normal line-clamp-2 sm:line-clamp-none">
                  {t(labelKey) || fallback}
                </span>
              </>
            );

            // Configuration opens a dialog rather than going anywhere, so it is
            // a button — not a link with a fake href. It never shows as active,
            // because nothing about the URL changes when it is open.
            if (href === null) {
              return (
                <button
                  key={labelKey}
                  type="button"
                  onClick={() => openConfiguration()}
                  className={TAB_CLASS}
                  style={tint}
                >
                  {body}
                </button>
              );
            }

            return (
              <Link
                key={href}
                href={href}
                ref={isActive ? activeRef : undefined}
                aria-current={isActive ? 'page' : undefined}
                className={TAB_CLASS}
                style={tint}
              >
                {body}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
