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

import { useEffect, useRef, useState } from 'react';
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
   * The account settings reached by the initials chip in the header —
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
 * earned, how people find you, how it is going, and last the settings you
 * change rarely. The overview sits after Online presence because it is the
 * step-back read on everything before it, not another thing to work through.
 */
const TABS: TabDef[] = [
  { href: '/business-os', color: '#F97316', Icon: Sun, labelKey: 'nav.myday', fallback: 'My day' },
  { href: '/business-os/crm', color: '#8B5CF6', Icon: Users, labelKey: 'cap.people.name', fallback: 'People', capability: 'crm' },
  /*
   * Money, which is the new design of what this tab has always opened.
   *
   * `/business-os/orders` still exists and still works — the Stripe Connect
   * callback lands on it, the chat links to it, and those URLs are in the
   * wild. It is simply no longer what the tab opens.
   */
  { href: '/business-os/money', color: '#22C58B', Icon: Receipt, labelKey: 'nav.payments', fallback: 'Money', capability: 'payments' },
  { href: '/business-os/website', color: '#4F6EF7', Icon: Globe, labelKey: 'cap.website.name', fallback: 'Online presence', capability: 'website' },
  { href: '/business-os/reports', color: '#22C58B', Icon: BarChart3, labelKey: 'cap.reports.name', fallback: 'Business overview', capability: 'reports' },
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

/**
 * Remembered across navigations, so the bar does not rearrange on every page.
 *
 * The answer takes a request, and a bar that shows six tabs and then collapses
 * to two a moment later is worse than either state on its own. Session storage
 * makes that happen at most once per session; the fetch below still runs and
 * corrects it the moment setup finishes.
 */
const SETUP_DONE_KEY = 'bos_setup_complete';

function rememberedSetupState(): boolean | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.sessionStorage.getItem(SETUP_DONE_KEY);
    return value === '1' ? true : value === '0' ? false : null;
  } catch {
    /* Private mode, or storage disabled. Unknown is a fine answer. */
    return null;
  }
}

export function BusinessOSTabs() {
  const pathname = usePathname();
  const { t, isRTL } = useLanguage();
  const { openConfiguration } = useConfigurationDialog();
  const { capabilities, status } = useCapabilities();

  /**
   * ───────────────────────────────────────────────────────────────────────────
   * WHILE THE SETUP IS UNFINISHED, THERE ARE TWO TABS.
   *
   * My day, which is where the work is, and Business Setup, which is where it
   * is done. People, Money, Online presence and Business overview all read from
   * a business that has sold something; before that they are four doors onto
   * empty rooms, and an owner opening them learns only that the product looks
   * broken.
   *
   * `null` means NOT KNOWN YET, and it shows everything. That direction matters:
   * the cost of being wrong is asymmetric. Hiding four tabs from a business that
   * has been trading for a year because one request was slow is a far worse
   * failure than briefly showing a new account a tab it cannot use yet.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const [setupDone, setSetupDone] = useState<boolean | null>(rememberedSetupState);
  /**
   * The steps that ARE finished, so a tab can come back one at a time.
   *
   * Hiding four tabs until the whole setup is complete was too blunt: an owner
   * who has just published their link has somewhere real to go, and the tab for
   * it was still missing. A tab returns when its own area works, which is the
   * same rule its page uses (`NotYetGate`), so the bar and the page cannot
   * disagree about whether somewhere is worth opening.
   */
  const [doneSteps, setDoneSteps] = useState<string[]>([]);
  /** Every step this business owes, finished or not. See the fetch below. */
  const [applicableSteps, setApplicableSteps] = useState<string[]>([]);
  /*
   * `allComplete` is deliberately NOT held here any more. It gated the
   * overview tab and almost nobody passed it — the step list includes `design`,
   * which is recommended and never required — so the tab was withheld from
   * working businesses forever. See the overview rule below.
   */

  /** Bumped by the window event, which is what re-runs the fetch below. */
  const [pulse, setPulse] = useState(0);

  useEffect(() => {
    const onChanged = () => setPulse(n => n + 1);
    window.addEventListener('bos:setup-changed', onChanged);
    return () => window.removeEventListener('bos:setup-changed', onChanged);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch('/api/business-os/setup-status');
        /* Same reasoning as the catch below: a step list that will not load
           says nothing about whether the walkthrough is finished, and the
           answer to that is in the key. */
        if (!response.ok) { if (!cancelled) setSetupDone(rememberedSetupState()); return; }

        const body = await response.json();
        if (!body?.success || !body.status) { if (!cancelled) setSetupDone(rememberedSetupState()); return; }

        if (cancelled) return;

        const steps: Array<{ id: string; complete: boolean }> = body.status.steps ?? [];
        /*
         * PRESENT AND COMPLETE. An absent step is NOT a finished one here.
         *
         * The page gates (`NotYetGate`) read an absent step as done, and that is
         * right there: the route filters by the graph's own `applies`, so an
         * invoice-only shop has no `payments` step and must not be locked out of
         * its money page over a processor it will never own.
         *
         * This bar asks a different question — is there anything in there worth
         * opening during setup — and for that, absent means "this business does
         * not do that at all", which is the strongest possible no. Reading it as
         * done put the Money tab in front of an account whose every service is
         * unpriced, with nothing behind it.
         */
        /*
         * DISMISSED counts here, where ABSENT does not, and the difference is
         * the owner.
         *
         * Absent means the graph decided this business will never owe the step,
         * so there is nothing behind the tab. Dismissed means the owner looked
         * at it and said they would handle it themselves — and the tab is
         * exactly where they would do that. Withholding it leaves them declining
         * a thing and then having nowhere to go and do it.
         */
        const dismissed: string[] = body.status.dismissedSteps ?? [];
        setDoneSteps([
          ...steps.filter(step => step.complete === true).map(step => step.id),
          ...dismissed,
        ]);
        /*
         * Which steps this business owes AT ALL, complete or not.
         *
         * `setup-status` returns only the steps whose `applies` is true, so the
         * presence of `payments` means this account takes cards.
         *
         * NOT the whole test for the Money tab any more, and the example this
         * comment used to give was the case it got wrong: a contractor selling
         * one quoted job DOES bill — acceptance raises an invoice — so Money
         * has content for them even with no processor. `invoicing` is the step
         * that says so, and the rule below reads both.
         */
        setApplicableSteps(steps.map(step => step.id));

        /*
         * ───────────────────────────────────────────────────────────────────
         * THE BAR NO LONGER DECIDES WHETHER THE SETUP IS FINISHED.
         *
         * It used to answer from `allComplete` and write that answer into
         * SETUP_DONE_KEY. The dashboard now writes the same key with
         * `everyPhaseAnswered`, which is the honest question — and two writers
         * on one key is two different answers overwriting each other on every
         * navigation. `allComplete` is almost never true (the step list
         * includes `design`, which is recommended and never required), so the
         * bar's answer would win half the time and hide the navigation from a
         * business that had finished.
         *
         * One writer, one reader. The dashboard knows about phases a step list
         * cannot see — a catalogue declared finished, a website skipped, a
         * mailbox declined — so it says, and this listens.
         * ───────────────────────────────────────────────────────────────────
         */
        setSetupDone(rememberedSetupState());
      } catch {
        /*
         * The STEPS could not be read, which says nothing about whether the
         * walkthrough is over. That answer lives in the key and is still
         * there, so it is re-read rather than thrown away — the old code
         * failed open here and reopened every tab on one slow request.
         */
        if (!cancelled) setSetupDone(rememberedSetupState());
      }
    })();

    return () => { cancelled = true; };
    /* Re-asked on every navigation AND on `bos:setup-changed`, which the
       dashboard fires when something goes live where the owner is standing —
       publishing a link never changes the route, and the tab it opens has to
       appear without a reload. */
  }, [pathname, pulse]);

  const byCapability = filterByCapability(TABS, capabilities, status);

  /**
   * ───────────────────────────────────────────────────────────────────────────
   * A TAB APPEARS WHEN ITS AREA HAS SOMETHING IN IT. ALWAYS, NOT ONLY IN SETUP.
   *
   * The bar used to open in full the moment every setup phase was answered, and
   * that put six tabs in front of an account selling one quoted job: no price,
   * no processor, no hours, nothing booked. Money and Business overview both
   * opened onto nothing. Reported as "the tabs need to be open based on the
   * capabilities and the service this user created".
   *
   *   Money             the `payments` step EXISTS, which `setup-status` only
   *                     returns where `collectsOnline` is true. Absent means
   *                     this business takes no cards, today. Add a card service
   *                     next month and the step appears with it.
   *   Online presence   the website step is finished, or the owner said they
   *                     would handle being found themselves. Either way there
   *                     is a page and links to look after.
   *   Business overview everything is complete. It reads what the rest
   *                     produced, so it is the last thing to have content.
   *
   * People keeps its capability gate and nothing more: contacts work from the
   * first day, and an empty list is a true answer rather than an empty room.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const areaHasContent = (href: string | null): boolean => {
    /* My day is where the work is; Business Setup is where it is done. */
    if (href === null || href === '/business-os') return true;

    /*
     * ───────────────────────────────────────────────────────────────────────
     * NOTHING IS LIVE, SO NOTHING HAS CONTENT.
     *
     * `services` is complete when at least one service is `active`. Until then
     * no client can buy anything, so People has nobody, Money has no money and
     * the overview has nothing to read. That is the whole of the setup period,
     * and it is the state the two-tab bar was asked for.
     *
     * This is the test the Money tab needed and did not have. It asked whether
     * the `payments` STEP applies, and `payments.applies` is `collectsOnline`,
     * which falls back to the interview's answer when there is no published
     * catalogue to read. An account that said "clients pay by card" in the chat
     * and has published nothing therefore answered true — an intention, not a
     * thing with content — and Money opened onto an empty page.
     * ───────────────────────────────────────────────────────────────────────
     */
    /*
     * ───────────────────────────────────────────────────────────────────────
     * NOTHING OPENS WHILE THE WALKTHROUGH IS RUNNING.
     *
     * This read "is a service live", and a service goes live in the MIDDLE of
     * the setup — so publishing the first one opened Money, Online presence
     * and Business overview while the owner was still being walked through,
     * with the setup cards carrying on underneath a full navigation bar.
     *
     * `setupDone` is now the dashboard's own `everyPhaseAnswered`, written to
     * this key as it changes: profile answered, catalogue declared finished,
     * being-found settled, mailbox answered or declined. A step list cannot
     * see three of those.
     *
     * `false` only. `null` is "not asked yet" and keeps every tab, for the
     * reason it always has: a slow check must not take the navigation away
     * from a business that has been trading for a year.
     * ───────────────────────────────────────────────────────────────────────
     */
    if (setupDone === false) return false;

    if (!doneSteps.includes('services')) return false;

    /*
     * Past that, each area answers for itself.
     *
     *   Money    only where cards are actually taken. An invoice-only business
     *            has no `payments` step at all — `applies` is `collectsOnline`
     *            — and `applicableSteps` is the honest reading of that once a
     *            real catalogue exists to derive it from.
     *   Presence the website step finished, or the owner saying they will
     *            handle being found themselves. Either way there are links.
     */

    /*
     * ───────────────────────────────────────────────────────────────────────
     * MONEY: THE LIVE CATALOGUE GATE ABOVE IS THE WHOLE TEST HERE.
     *
     * This asked `applicableSteps.includes('payments')`, whose `applies` is
     * `collectsOnline` — true only where a card is charged at booking. So a
     * business selling quoted work or invoicing for everything had Money
     * hidden permanently while its clients were being billed.
     *
     * The honest question is `moneyMoves`, and it is ALREADY ANSWERED one
     * layer up: this tab carries `capability: 'payments'`, and
     * `capabilityKeysFromShape` grants that capability on `moneyMoves`, not on
     * `collectsOnline` — it says so outright: "a business that invoices for
     * everything still has orders to look at". A business where no money moves
     * never reaches this function, because `filterByCapability` has already
     * removed the tab.
     *
     * Asking `applicableSteps` again was also asking the wrong source:
     * `setup-status` returns six steps — services, availability, payments,
     * calendar, website, design — and `invoicing` is not among them, so that
     * half of the test could never be true however the business sells.
     *
     * What remains is the gate above: nothing live, nothing to show. Past it,
     * a tab the capability layer kept has content.
     * ───────────────────────────────────────────────────────────────────────
     */
    if (href === '/business-os/money') return true;

    if (href === '/business-os/website') return doneSteps.includes('website');

    /*
     * ───────────────────────────────────────────────────────────────────────
     * THE OVERVIEW OPENS WITH THE FIRST LIVE SERVICE, NOT WITH EVERYTHING.
     *
     * `allComplete` is a gate almost nobody passes: the step list includes
     * `design`, the brand look, which is recommended and never required. A
     * business trading for a year that never opened the theme editor has
     * `allComplete` false forever, and had this tab withheld forever with it.
     *
     * `NotYetGate` — the gate on the PAGE this tab leads to — already uses
     * `services` for exactly this reason, and documents it. The bar was the
     * only surface still asking the harder question, so the tab stayed hidden
     * in front of a page that would have rendered perfectly well.
     *
     * `services` is already guaranteed above, so reaching here IS the answer.
     * Written out rather than folded into the fall-through so the rule stays
     * visible to the next reader.
     * ───────────────────────────────────────────────────────────────────────
     */
    if (href === '/business-os/reports') return doneSteps.includes('services');

    /* People, and anything added later: live catalogue is enough. */
    return true;
  };

  /* Unknown shows everything, for the reason on `setupDone`: a slow check must
     not take a working business's tabs away. */
  const tabs = setupDone === null ? byCapability : byCapability.filter(tab => areaHasContent(tab.href));

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
                  /*
                   * ─────────────────────────────────────────────────────────
                   * DURING SETUP, THIS OPENS THE TWO TABS THE SETUP IS ABOUT.
                   *
                   * The dialog has six: Business, Services, Availability,
                   * Client Forms, Payments, Invoices. Four of those are
                   * consequences of a service — hours exist because something
                   * is booked against a time, a processor because something
                   * takes a card — and putting all six in front of somebody on
                   * their first day asks them to work out which of six places
                   * they should be in, and whether the other five are also
                   * theirs to do now.
                   *
                   * So while the setup is unfinished it opens on Business, with
                   * Services and Client Forms beside it. Availability, Payments
                   * and Invoices are hidden until something actually needs
                   * them, and the thing that needs them is a service: a
                   * scheduled one wants hours, a card one wants a processor, an
                   * invoiced one wants the bank details. Each names its own
                   * requirement in its own editor, which is where the owner
                   * already is when the question becomes real.
                   *
                   * NOT narrowed to Business alone, though that is the first
                   * step: this tab is the only way into the dialog, and once
                   * the profile is filled in an owner coming back here would
                   * find a single finished tab and no way to their services.
                   *
                   * Unknown (`null`) opens everything, for the same reason the
                   * bar shows every tab then: a slow check must not take the
                   * settings away from a business that has been trading for a
                   * year.
                   * ─────────────────────────────────────────────────────────
                   */
                  /*
                   * ─────────────────────────────────────────────────────────
                   * THE NARROWING ENDS WHEN SOMETHING GOES LIVE, NOT WHEN
                   * EVERY STEP IS TICKED.
                   *
                   * This keyed on `setupDone`, which is `status.allComplete` —
                   * a flag almost nobody ever reaches, because the step list
                   * includes `design`, the brand look, which is recommended
                   * and never required. So the three-tab dialog was not a
                   * first-day simplification, it was permanent: a business
                   * trading with live services, hours set and invoices going
                   * out still opened Business Setup to Business, Services and
                   * Client Forms, with Availability and Invoices hidden and no
                   * way to reach them from here.
                   *
                   * `services` complete means at least one service is active,
                   * which is exactly the moment the hidden tabs stop being
                   * hypothetical: a live scheduled service HAS hours to set, a
                   * live billed one HAS invoice details to fill in.
                   *
                   * Past that the dialog opens with no `visibleTabs` at all,
                   * which hands the decision to `configTabsForShape` — the one
                   * rule that reads the catalogue. For a business selling
                   * quoted work it yields business, services, availability,
                   * intake and invoice, and keeps Payments hidden because no
                   * card is charged at booking. That is the accuracy a
                   * hardcoded list here cannot have.
                   * ─────────────────────────────────────────────────────────
                   */
                  onClick={() =>
                    setupDone !== null && !doneSteps.includes('services')
                      ? openConfiguration('business', {
                          visibleTabs: ['business', 'services', 'intake'],
                        })
                      : openConfiguration()
                  }
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
