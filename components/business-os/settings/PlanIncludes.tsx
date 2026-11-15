'use client';

/**
 * What the plan gives you, in the order an owner asks it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS REPLACES (owner review of the plan drawer, 2026-11-15)
 *
 * One list, ten rows, every row a bold heading, an orange tick and a sentence.
 * Three faults, and the tick was the smallest:
 *
 *   · a tick against every row carries no information. It means "included,
 *     unlike elsewhere", and when nothing is excluded it is decoration that
 *     costs a column on every line;
 *   · the FIGURES were inside the prose. "5,000 a month", "10,000 emails",
 *     "1 seat", "1 location" each sat mid-sentence, and those are the facts
 *     the drawer is opened to check;
 *   · one category (AI chat) holds nine capabilities and printed them as a
 *     comma run nobody finishes, while a one-item category got the same weight.
 *
 * So the payload is split by what the server already knows about each feature:
 *
 *   amounts      a figure you spend or fill up   → a band with its own meter
 *   capabilities a thing the plan has or has not → one row per category, which
 *                                                  opens to show its items
 *
 * ── NO CAPABILITY IS RECOGNISED BY NAME HERE ────────────────────────────────
 * The split reads `PlanFeature.amountKind`, which the server fills from the
 * catalog's shape (metered / fair-use / quantity). Nothing in this file knows
 * what credits are, and `upgradeModal.guard` refuses a capability id written as
 * a literal in this folder — a capability added to the catalog tomorrow
 * presents correctly with no edit here.
 *
 * @module components/business-os/settings/PlanIncludes
 */

import { useEffect, useState } from 'react';
import {
  BarChart3,
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Globe,
  Info,
  LifeBuoy,
  Package,
  Send,
  Server,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { bandColor, creditPercentLeft } from '@/lib/business-os/credits/creditBands';
import type { OwnerCreditUsage } from '@/lib/business-os/credits/ownerCreditUsageTypes';
import { createLogger } from '@/lib/logger';
import { planCategoryLine } from '@/lib/business-os/planCategoryLine';

import type { PlanFeature, PlanPayload } from './planPayloadTypes';

const logger = createLogger({ module: 'PlanIncludes' });

/**
 * A face per category, so the list is scannable rather than nine identical
 * lines of text.
 *
 * Keyed on the CATEGORY, which is a presentation grouping the customer view
 * already names (`CATEGORY_PRESENTATION`), never on a capability id: every
 * capability id in the catalog carries a dot, so these bare words cannot
 * collide with one, and `upgradeModal.guard`'s literal check stays meaningful.
 *
 * A category with no entry gets the neutral mark rather than no mark: a row
 * missing its tile would look like a row missing its meaning, and a new
 * category must not make the list ragged until somebody remembers this file.
 */
const CATEGORY_ICON: Record<string, LucideIcon> = {
  crm: Users,
  website_intake: Globe,
  payments: CreditCard,
  ai_chat: Bot,
  marketing: Send,
  insights: BarChart3,
  support: LifeBuoy,
  platform: Server,
};

/** The card the dashboard reads for the same figures. One endpoint, one truth. */
const USAGE_URL = '/api/business-os/usage';

/** A feature that carries a figure, with the category it came from. */
export interface PlanAmountItem {
  feature: PlanFeature;
  /**
   * `level` is not a catalog shape: it is a category that turned out to hold
   * ONE feature with a word for a value — a support tier, say. The server has
   * no amount to mark there, but a row whose whole content is "Support level
   * (priority)" is a figure wearing a sentence, and it reads as a card beside
   * the counts. See `splitIncluded`.
   */
  kind: 'metered' | 'fair_use' | 'quantity' | 'level';
  /** The category's sentence ("what a credit is"), where it has one. */
  noteKey: string | null;
  category: string;
}

/** A category and the features in it that are NOT figures. */
export interface PlanCapabilityGroup {
  category: string;
  labelKey: string;
  features: PlanFeature[];
  /** The server's own joined line, for a group nothing was lifted out of. */
  summary: string;
  /**
   * The category's sentence, kept HERE only where the category contributed no
   * figure to the band.
   *
   * That is the older-payload case and it matters: a body with no `amountKind`
   * (a recorded fixture, a deploy mid-flight) has no amounts at all, so the
   * band does not render, and dropping the note with it would silently delete
   * the one explanation of what a credit is. With a current payload the
   * allowance IS an amount, the row is gone, and the note is on the meter.
   */
  noteKey: string | null;
}

/**
 * The two halves of `included`.
 *
 * A category whose every feature is a figure disappears from the list: its
 * content is in the band above, and an empty row that says nothing is worse
 * than no row. A category nothing was lifted out of keeps the server's summary,
 * so its line reads exactly as it did before.
 */
export function splitIncluded(plan: PlanPayload): {
  amounts: PlanAmountItem[];
  groups: PlanCapabilityGroup[];
} {
  const amounts: PlanAmountItem[] = [];
  const groups: PlanCapabilityGroup[] = [];

  for (const row of plan.included) {
    const plain: PlanFeature[] = [];

    for (const feature of row.features) {
      const kind = feature.amountKind;
      if (kind === 'metered' || kind === 'fair_use' || kind === 'quantity') {
        amounts.push({ feature, kind, noteKey: row.noteKey, category: row.category });
      } else {
        plain.push(feature);
      }
    }

    const contributedAnAmount = amounts.some((item) => item.category === row.category);

    /*
     * ONE FEATURE WITH A WORD FOR A VALUE IS A CARD, NOT A ROW.
     *
     * A category that contributed no figure and holds a single feature whose
     * value is not the plain `yes` is a setting with a level — the support
     * tier is the live example, and it rendered as "Support (Support level
     * (priority))", a row that spends two lines saying one word.
     *
     * By shape again: one feature, a value that says something. Nothing here
     * knows which category that is, and a category whose single value IS `yes`
     * stays a row, because "Marketing: yes" would be a card with nothing on it.
     */
    if (!contributedAnAmount && plain.length === 1 && plain[0].value !== 'yes') {
      amounts.push({ feature: plain[0], kind: 'level', noteKey: row.noteKey, category: row.category });
      continue;
    }

    if (plain.length > 0) {
      groups.push({
        category: row.category,
        labelKey: row.labelKey,
        features: plain,
        summary: row.summary,
        noteKey: contributedAnAmount ? null : row.noteKey,
      });
    }
  }

  return { amounts, groups };
}

/**
 * The account's credit usage, or `null` while unknown.
 *
 * Asked for only when the plan actually has a metered amount, and failure is
 * silent on purpose: the figure the plan GRANTS is already on screen, and a
 * drawer about what you have must not turn into an error about what you have
 * used. The dashboard card owns reporting that.
 */
function useCreditUsage(enabled: boolean): OwnerCreditUsage | null {
  const [usage, setUsage] = useState<OwnerCreditUsage | null>(null);

  useEffect(() => {
    if (!enabled) return;

    /*
     * NO "already asked" REF HERE, and that is the whole point.
     *
     * It had one, set before the fetch. In development React mounts an effect
     * twice: the first run set the flag and started the read, the cleanup
     * aborted it, and the second run returned early because the flag was
     * already set — so the meter never got its figures on a dev machine, which
     * is where this screen is looked at. The AbortController alone is the
     * right guard: the first read is abandoned, the second completes.
     */
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(USAGE_URL, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) return;
        const body = (await response.json()) as { success?: boolean; data?: unknown };
        if (body?.success && readsAsUsage(body.data)) setUsage(body.data);
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        logger.warn({ err }, 'Credit usage unavailable for the plan drawer');
      }
    })();

    return () => controller.abort();
  }, [enabled]);

  return usage;
}

/**
 * The three fields the meter reads, checked before they are drawn.
 *
 * Deliberately NARROWER than `UsageCard`'s own guard, which validates the whole
 * payload because it shows the whole payload — the split between owner and
 * automatic, the extra credits, the error line. This draws a bar and a date, so
 * it checks a bar and a date, and anything else malformed simply leaves the
 * meter off. Not shared with the card's guard for a mechanical reason worth
 * recording: `ownerCreditSurface.guard` pins the card's credit-module imports
 * to an exact list, so extracting that function would be a change to a pinned
 * surface in service of a screen that needs a third of it.
 */
function readsAsUsage(value: unknown): value is OwnerCreditUsage {
  if (!value || typeof value !== 'object') return false;
  const usage = value as Partial<OwnerCreditUsage>;
  const finite = (figure: unknown) => typeof figure === 'number' && Number.isFinite(figure);

  if (!finite(usage.used)) return false;
  if (usage.allowance !== null && !finite(usage.allowance?.amount)) return false;
  const resets = usage.period?.resetsOn;
  return resets === null || resets === undefined || typeof resets === 'string';
}

function Figure({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[13px] text-[var(--v2-text-secondary)] tabular-nums shrink-0">{children}</span>
  );
}

/**
 * A formatted value split into the figure and the caveat that trails it.
 *
 * "10,000 per month (alerts, never blocks)" is two different things on one
 * line: a ceiling, and what happens at it. The second belongs under the first,
 * in muted type, the way the mockup reads it — crammed in beside the number it
 * makes the row look like an error message.
 *
 * By SHAPE, not by words: a single trailing bracket, nothing nested. A value
 * with none (every quantity, every allowance) comes back whole and unchanged,
 * so this can never mangle a figure it does not understand. The brackets are
 * the server's own formatting in all three languages.
 */
function splitCaveat(value: string): { figure: string; caveat: string | null } {
  const match = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(value);
  if (!match || match[1].trim().length === 0) return { figure: value, caveat: null };
  return { figure: match[1].trim(), caveat: match[2].trim() };
}

/**
 * A count split into the number and the words after it.
 *
 * The server formats a quantity as "1 seat" / "1 מושב", and the row already
 * carries the capability's own name ("Team seats"). Printed together that is
 * the same fact twice in two voices. The mockup makes the NUMBER the thing you
 * see and the capability's name the caption under it, which is what a count
 * card is for.
 *
 * Leading digits only, and the value is returned whole when there are none —
 * a value that does not start with a number is not a count we can take apart.
 */
/** "{used} of {total}", with both figures already formatted for the reader. */
function fillUsed(template: string, used: string, total: string): string {
  return template.replace('{used}', used).replace('{total}', total);
}

function splitCount(value: string): { number: string; rest: string } | null {
  const match = /^\s*([\d][\d.,\u00A0\s]*)\s*(.*)$/.exec(value);
  if (!match) return null;
  return { number: match[1].trim(), rest: match[2].trim() };
}

/**
 * The figures, lifted out of the prose.
 *
 * Each shape is READ differently, which is why the kind travels rather than a
 * boolean: metered is spent and wants a meter of what is left; fair-use is a
 * ceiling that warns rather than blocks and wants its number stated; quantity
 * is a fixed count and reads as a card.
 */
export function PlanAmounts({
  amounts,
  t,
  language,
  noteTestIdPrefix,
}: {
  amounts: PlanAmountItem[];
  t: (key: string) => string;
  language: string;
  noteTestIdPrefix: string;
}) {
  const metered = amounts.filter((item) => item.kind === 'metered');
  const ceilings = amounts.filter((item) => item.kind === 'fair_use');
  /* Counts and levels share the card row: both are one short value under its
     own name, and both are facts about the plan rather than things it does. */
  const counts = amounts.filter((item) => item.kind === 'quantity' || item.kind === 'level');
  const usage = useCreditUsage(metered.length > 0);
  const [explaining, setExplaining] = useState<string | null>(null);

  if (amounts.length === 0) return null;

  const locale = language === 'he' ? 'he-IL' : language === 'es' ? 'es-ES' : 'en-US';
  const number = (value: number) => Math.round(value).toLocaleString(locale);

  return (
    <section aria-label={t('plan.amounts_heading')} data-testid="plan-amounts">
      <h4 className="text-xs uppercase tracking-wide text-[var(--v2-text-muted)] mb-2">
        {t('plan.amounts_heading')}
      </h4>

      {(metered.length > 0 || ceilings.length > 0) && (
        <div
          className="border border-[var(--v2-border)] overflow-hidden"
          style={{ borderRadius: 'var(--v2-radius-card)', background: 'var(--v2-surface)' }}
        >
          {metered.map((item, index) => {
            const allowance = usage?.allowance?.amount ?? null;
            const percent = usage ? creditPercentLeft(usage.used, allowance) : null;
            const open = explaining === item.feature.capability;

            return (
              <div
                key={item.feature.capability}
                data-testid={`plan-amount-${item.feature.capability}`}
                className={index === 0 ? 'p-4' : 'p-4 border-t border-[var(--v2-border)]'}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-semibold text-[var(--v2-text-primary)] truncate">
                      {item.feature.label}
                    </span>
                    {item.noteKey && (
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-label={t('plan.amount_explain')}
                        data-testid={`plan-amount-explain-${item.category}`}
                        /*
                         * NOT A MONEY CONTROL, SAID OUT LOUD.
                         *
                         * `PlanPurchase.render` asserts that an account which
                         * must see no Choose or Pay button sees NO button at
                         * all, excluding the one it names by exact id — a rule
                         * written so a money control can never hide behind a
                         * loose matcher.
                         *
                         * This toggle opens a sentence explaining a figure. It
                         * takes no money and cannot start a purchase, but its
                         * test id is per-capability, so there is no exact id
                         * for the guard to name. Declaring the FACT here keeps
                         * the guard exact: it excludes controls that say they
                         * are not money, and anything that forgets to say so —
                         * every real Choose button included — still trips it.
                         */
                        data-money="no"
                        onClick={() => setExplaining(open ? null : item.feature.capability)}
                        className="inline-flex items-center justify-center w-6 h-6 shrink-0 rounded-full text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface-hover)] transition-colors"
                      >
                        <Info className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  {/* The plan's own figure always; what is used only when we
                      know it, and in words rather than a slash — "41 / 5,000"
                      reads as a date or a score before it reads as a share. */}
                  <Figure>
                    {percent && allowance !== null
                      ? fillUsed(t('plan.amount_used_of'), number(usage!.used), number(allowance))
                      : item.feature.value}
                  </Figure>
                </div>

                {percent && allowance !== null && (
                  <div
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round((1 - percent.share) * 100)}
                    aria-label={item.feature.label}
                    className="mt-2.5 h-2 rounded-full overflow-hidden"
                    style={{ background: 'var(--v2-bg)' }}
                  >
                    {/*
                      Drawn as what is USED, coloured by the band of what is
                      LEFT — the same band the dashboard ring turns, from the
                      same function, so the two cannot disagree about when a
                      balance has become a problem.
                    */}
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, Math.max(0, (1 - percent.share) * 100))}%`,
                        /*
                          The brand colour while there is nothing to say, the
                          dashboard's own band colour once there is.
                          ───────────────────────────────────────────────────
                          A bar that is always green reads as "fine" at 4%
                          left; a bar that is always orange cannot warn at all.
                          `bandFor` turns at the same point the dashboard ring
                          turns, from the same function, so the two screens
                          cannot disagree about when a balance has become a
                          problem — and until it has, this is the plain
                          primary the mockup draws.
                        */
                        background:
                          percent.band === 'low' || percent.band === 'below_line'
                            ? bandColor(percent.band)
                            : 'var(--v2-primary)',
                      }}
                    />
                  </div>
                )}

                {usage?.period?.resetsOn && (
                  <p className="mt-2 text-[11.5px] text-[var(--v2-text-muted)]">
                    {t('usage.resets_on').replace(
                      '{date}',
                      new Date(usage.period.resetsOn).toLocaleDateString(locale, {
                        day: 'numeric',
                        month: 'long',
                      })
                    )}
                  </p>
                )}

                {/*
                  The four-line definition that used to OPEN the drawer, now
                  beside the thing it defines and only when asked for.
                */}
                {open && item.noteKey && (
                  <p
                    className="mt-3 p-3 text-xs leading-relaxed text-[var(--v2-text-secondary)] border border-[var(--v2-border)]"
                    style={{ borderRadius: 'var(--v2-radius-button)', background: 'var(--v2-bg)' }}
                    data-testid={`${noteTestIdPrefix}${item.category}`}
                  >
                    {t(item.noteKey)}
                  </p>
                )}
              </div>
            );
          })}

          {ceilings.map((item) => {
            const { figure, caveat } = splitCaveat(item.feature.value);

            return (
              <div
                key={item.feature.capability}
                data-testid={`plan-amount-${item.feature.capability}`}
                className="p-4 border-t border-[var(--v2-border)]"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-[var(--v2-text-primary)] min-w-0 truncate">
                    {item.feature.label}
                  </span>
                  <Figure>{figure}</Figure>
                </div>
                {/* What happens AT the ceiling, under it rather than crammed
                    in beside the number. */}
                {caveat && <p className="mt-1.5 text-[11.5px] text-[var(--v2-text-muted)]">{caveat}</p>}
              </div>
            );
          })}
        </div>
      )}

      {counts.length > 0 && (
        <ul className="flex gap-2.5 mt-2.5 list-none p-0 m-0">
          {counts.map((item) => (
            <li
              key={item.feature.capability}
              data-testid={`plan-amount-${item.feature.capability}`}
              className="flex-1 min-w-0 border border-[var(--v2-border)] p-3"
              style={{ borderRadius: 'var(--v2-radius-card)', background: 'var(--v2-surface)' }}
            >
              <div className="text-lg font-bold leading-tight text-[var(--v2-text-primary)] truncate">
                {splitCount(item.feature.value)?.number ?? item.feature.value}
              </div>
              <div className="mt-0.5 text-xs text-[var(--v2-text-secondary)] truncate">
                {item.feature.label}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * One row per category, which opens to show what is in it.
 *
 * Collapsed, the row still CARRIES its line in the DOM — truncated by CSS, not
 * by JavaScript — so a reader scanning with a screen reader, and a test looking
 * for a feature by name, both find it without opening anything.
 */
export function PlanCapabilityRows({
  groups,
  t,
  isRTL,
  noteTestIdPrefix,
}: {
  groups: PlanCapabilityGroup[];
  t: (key: string) => string;
  isRTL: boolean;
  noteTestIdPrefix: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const Chevron = isRTL ? ChevronLeft : ChevronRight;

  if (groups.length === 0) {
    return <p className="text-sm text-[var(--v2-text-muted)]">{t('plan.features_unavailable')}</p>;
  }

  return (
    <ul className="list-none p-0 m-0 border-t border-[var(--v2-border)]" aria-label={t('plan.includes')}>
      {groups.map((group) => {
        const heading = t(group.labelKey);
        const expanded = open === group.category;
        const Glyph = CATEGORY_ICON[group.category] ?? Package;
        /* The server's line where nothing moved out of the row; otherwise the
           names of what is left, so the lead cannot promise a figure that is
           now in the band above. */
        const lead =
          planCategoryLine(heading, { features: group.features, summary: group.summary }) ??
          group.features.map((feature) => feature.label).join(', ');

        return (
          <li key={group.category} className="border-b border-[var(--v2-border)]">
            <button
              type="button"
              aria-expanded={expanded}
              data-testid={`plan-includes-row-${group.category}`}
              /* NOT A MONEY CONTROL. It folds a category open. See the longer
                 note on the amount-explain toggle above: `PlanPurchase.render`
                 counts every button that does not declare itself, so a real
                 Choose button can never hide, and a disclosure like this one
                 says what it is instead of being matched by name. */
              data-money="no"
              onClick={() => setOpen(expanded ? null : group.category)}
              className="w-full flex items-center gap-3 py-3 text-start bg-transparent border-0 hover:bg-[var(--v2-surface-hover)] transition-colors"
            >
              {/* The tile is decoration with a job: it gives the eye something
                  to land on per row. Hidden from the reader who is listening,
                  because the heading beside it already says what this is. */}
              <span
                aria-hidden="true"
                className="inline-flex items-center justify-center w-8 h-8 shrink-0 rounded-[10px] text-[var(--v2-primary)]"
                style={{ background: 'var(--v2-surface)' }}
              >
                <Glyph className="w-4 h-4" strokeWidth={2} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-[var(--v2-text-primary)]">{heading}</span>
                {!expanded && (
                  <span className="block mt-0.5 text-xs text-[var(--v2-text-secondary)] truncate">{lead}</span>
                )}
                {group.noteKey && (
                  <span
                    className="block mt-0.5 text-xs text-[var(--v2-text-muted)]"
                    data-testid={`${noteTestIdPrefix}${group.category}`}
                  >
                    {t(group.noteKey)}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-xs text-[var(--v2-text-muted)] tabular-nums">
                {group.features.length}
              </span>
              {expanded ? (
                <ChevronDown className="w-4 h-4 shrink-0 text-[var(--v2-text-muted)]" aria-hidden="true" />
              ) : (
                <Chevron className="w-4 h-4 shrink-0 text-[var(--v2-text-muted)]" aria-hidden="true" />
              )}
            </button>

            {expanded && (
              <ul className="flex flex-wrap gap-1.5 list-none p-0 m-0 pb-3 ps-11">
                {group.features.map((feature) => (
                  <li
                    key={feature.capability}
                    className="inline-flex items-center h-7 px-2.5 rounded-full border border-[var(--v2-border)] text-xs text-[var(--v2-text-secondary)]"
                    style={{ background: 'var(--v2-surface)' }}
                  >
                    {/* The value only where it says something: a plain "yes"
                        repeats the fact that the row is here at all. */}
                    {feature.value === 'yes' ? feature.label : `${feature.label} · ${feature.value}`}
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
