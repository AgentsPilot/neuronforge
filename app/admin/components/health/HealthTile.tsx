'use client';

/**
 * One Health tile (admin reorganisation slice 4).
 *
 * Renders only what the route sent: the status, the headline (the first
 * matching rule's description, or "Normal"), the figures with their links, and
 * the tile's own rule list with a condition summary generated from each rule
 * (SA C-22). It imports no rule config and no evaluator (SA C-21): the rules on
 * screen are the rules that were applied.
 *
 * There is no green anywhere (SA C-10). Every status carries a text label as
 * well as a colour, and icons are hidden from screen readers (SA C-16).
 */

import { AlertOctagon, AlertTriangle, CircleDashed, HelpCircle, Minus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { HealthTile as HealthTileData, TileStatus } from '@/lib/admin/health/healthTypes';

interface StatusStyle {
  label: string;
  icon: LucideIcon;
  card: string;
  accent: string;
}

/** Exported for the render test, which compares the class sets (SA C-10). */
export const STATUS_STYLES: Record<TileStatus, StatusStyle> = {
  red: {
    label: 'Needs action',
    icon: AlertOctagon,
    card: 'bg-slate-800 border border-red-500/40',
    accent: 'text-red-300',
  },
  amber: {
    label: 'Needs a look',
    icon: AlertTriangle,
    card: 'bg-slate-800 border border-amber-500/40',
    accent: 'text-amber-300',
  },
  neutral: {
    label: 'Normal',
    icon: Minus,
    card: 'bg-slate-800 border border-slate-700',
    accent: 'text-slate-300',
  },
  not_measured: {
    label: 'Not measured yet',
    icon: CircleDashed,
    card: 'bg-slate-800/60 border border-dashed border-slate-600',
    accent: 'text-slate-400',
  },
  unavailable: {
    label: 'Could not check',
    icon: HelpCircle,
    card: 'bg-slate-800/60 border border-slate-600',
    accent: 'text-slate-400',
  },
};

const RULE_CHIP: Record<'red' | 'amber', string> = {
  red: 'bg-red-500/20 text-red-300',
  amber: 'bg-amber-500/20 text-amber-300',
};

export function HealthTile({ tile }: { tile: HealthTileData }) {
  const style = STATUS_STYLES[tile.status];
  const Icon = style.icon;
  const headingId = `health-tile-${tile.id}`;

  return (
    <section
      aria-labelledby={headingId}
      data-testid={`health-tile-${tile.id}`}
      data-status={tile.status}
      className={`rounded-xl p-5 space-y-3 ${style.card}`}
    >
      <header className="flex items-start justify-between gap-3">
        <h2 id={headingId} className="text-sm font-medium text-white">
          {tile.title}
        </h2>
        <span className={`flex items-center gap-1 text-xs font-medium whitespace-nowrap ${style.accent}`}>
          <Icon className="w-4 h-4" aria-hidden="true" />
          <span data-testid="status-label">{style.label}</span>
        </span>
      </header>

      <p data-testid="headline" className={`text-base font-semibold ${style.accent}`}>
        {tile.headline}
      </p>

      {tile.figures.length > 0 && (
        <dl className="space-y-2">
          {tile.figures.map((figure) => (
            <div key={figure.label}>
              <dt className="text-xs text-slate-400">{figure.label}</dt>
              <dd className="text-sm text-slate-200">
                {figure.href ? (
                  <a
                    href={figure.href}
                    aria-label={figure.linkLabel ?? undefined}
                    className="underline decoration-slate-500 underline-offset-2 hover:text-white"
                  >
                    {figure.value}
                  </a>
                ) : (
                  <span>{figure.value}</span>
                )}
                {figure.note && <span className="block text-xs text-slate-400 mt-0.5">{figure.note}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {tile.footnote && <p className="text-xs text-slate-500">{tile.footnote}</p>}

      {tile.rules.length > 0 && (
        <details className="text-xs text-slate-400">
          <summary className="cursor-pointer select-none hover:text-slate-300">How this tile is coloured</summary>
          <ol className="mt-2 space-y-1.5 list-decimal list-inside" data-testid="rule-list">
            {tile.rules.map((rule, index) => (
              <li key={`${index}-${rule.description}`}>
                <span className={`px-1.5 py-0.5 rounded ${RULE_CHIP[rule.colour]}`}>{rule.colour}</span>{' '}
                <span className="text-slate-300">{rule.description}</span>
                <span className="block pl-5 text-slate-500">when {rule.condition}</span>
              </li>
            ))}
            {tile.otherwise && (
              <li data-testid="rule-otherwise" className="list-none text-slate-500">
                {tile.otherwise}
              </li>
            )}
          </ol>
        </details>
      )}
    </section>
  );
}
