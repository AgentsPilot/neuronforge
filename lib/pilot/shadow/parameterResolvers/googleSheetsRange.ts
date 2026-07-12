/**
 * Google Sheets range resolver (Calibration Option A — Phase 2, first tenant).
 *
 * Fires when `google-sheets.read_range` fails with "Unable to parse range: <X>"
 * (the requested tab name doesn't exist in the spreadsheet). It reads the
 * spreadsheet's real tabs and maps the bad range → the correct tab title:
 *   • the requested name already matches a real tab → unresolved (the range
 *     problem is elsewhere — never clobber a valid value; SA Risk 3 / no-clobber)
 *   • exactly one tab                               → resolved (confidence 0.95)
 *   • multiple tabs, no match                       → ambiguous; the engine
 *     best-effort applies the FIRST tab (= lost gid=0 intent) and discloses it
 *   • no spreadsheet id / unreadable / no tabs       → unresolved
 *
 * The look-up reuses the plugin CONNECTION/auth (via UserPluginConnections, with
 * token refresh) — not a fresh googleapis client (SA Q6). The pure resolve logic
 * takes an injected reader so it's fully unit-testable with no network.
 */

import { createLogger } from '@/lib/logger';
import type { ParameterResolver, ResolverContext, ResolverResult } from './types';

const logger = createLogger({ module: 'googleSheetsRangeResolver', service: 'shadow-agent' });

export interface SheetsTab {
  title: string;
  index: number;
}

/** Reads a spreadsheet's tabs (ordered by index). Injected for testability. */
export type SheetsMetadataReader = (spreadsheetId: string, userId: string) => Promise<SheetsTab[]>;

/** Pull the spreadsheet id from the resolved inputs (or a literal step param). */
function pickSpreadsheetId(inputs: Record<string, any>, stepParams: Record<string, any>): string | undefined {
  const fromInputs =
    inputs?.spreadsheet_id ??
    inputs?.['google-sheets__table/get__spreadsheet_id'] ??
    inputs?.spreadsheetId;
  if (typeof fromInputs === 'string' && fromInputs.trim()) return fromInputs.trim();
  const raw = stepParams?.spreadsheet_id;
  if (typeof raw === 'string' && raw.trim() && !raw.includes('{{')) return raw.trim();
  return undefined;
}

/** Preserve any A1 suffix: "Sheet1!A1:B10" + title "Leads" → "Leads!A1:B10". */
function rebuildRange(title: string, currentValue: unknown): string {
  const s = String(currentValue ?? '');
  const bang = s.indexOf('!');
  return bang >= 0 ? `${title}${s.slice(bang)}` : title;
}

/** Sheet-name part of the requested range (before any "!"). */
function requestedSheetName(currentValue: unknown): string {
  return String(currentValue ?? '').split('!')[0].trim();
}

export function createGoogleSheetsRangeResolver(readTabs: SheetsMetadataReader): ParameterResolver {
  return {
    plugin: 'google-sheets',
    action: 'read_range',
    parameter: 'range',

    appliesTo(ctx: ResolverContext): boolean {
      return /Unable to parse range/i.test(ctx.rawError || '');
    },

    async resolve(ctx: ResolverContext): Promise<ResolverResult> {
      const spreadsheetId = pickSpreadsheetId(ctx.resolvedInputs, ctx.stepParams);
      if (!spreadsheetId) {
        return { status: 'unresolved', reason: 'Could not determine which spreadsheet to check.' };
      }

      let tabs: SheetsTab[];
      try {
        tabs = await readTabs(spreadsheetId, ctx.userId);
      } catch (err) {
        logger.warn({ err, spreadsheetId }, '[googleSheetsRange] Could not read spreadsheet metadata');
        return { status: 'unresolved', reason: "Couldn't read the spreadsheet's tabs to correct the range." };
      }
      if (!tabs || tabs.length === 0) {
        return { status: 'unresolved', reason: 'The spreadsheet has no readable tabs.' };
      }

      const requested = requestedSheetName(ctx.currentValue);

      // No-clobber: if the requested name already matches a real tab, the parse
      // error isn't about the tab name — don't guess (SA Risk 3).
      const existing = tabs.find((t) => t.title.toLowerCase() === requested.toLowerCase());
      if (existing) {
        return { status: 'unresolved', reason: `The tab "${existing.title}" exists — the range problem is elsewhere.` };
      }

      if (tabs.length === 1) {
        const only = tabs[0];
        return {
          status: 'resolved',
          value: rebuildRange(only.title, ctx.currentValue),
          confidence: 0.95,
          reason: `The spreadsheet has one tab, "${only.title}", so I set the sheet to it.`,
        };
      }

      // Multiple tabs, requested name not found → best-effort first tab (= gid=0),
      // engine auto-applies candidates[0] and discloses the alternatives.
      const sorted = [...tabs].sort((a, b) => a.index - b.index);
      const candidates = sorted.map((t) => ({ value: rebuildRange(t.title, ctx.currentValue), label: t.title }));
      return {
        status: 'ambiguous',
        candidates,
        confidence: 0.6,
        reason:
          `The tab "${requested || '(blank)'}" wasn't found. The spreadsheet's tabs are: ` +
          `${sorted.map((t) => `"${t.title}"`).join(', ')}. I used the first one.`,
      };
    },
  };
}

/**
 * Default reader — reuses the google-sheets plugin connection/auth (with token
 * refresh) and reads `spreadsheets.get` (same call as the executor's
 * list_sheet_names). Dynamic imports keep server-only deps out of module load.
 */
export const defaultReadSheetTabs: SheetsMetadataReader = async (spreadsheetId, userId) => {
  const PluginManagerV2 = (await import('@/lib/server/plugin-manager-v2')).default;
  const pm = await PluginManagerV2.getInstance();
  const def: any = pm.getPluginDefinition('google-sheets');
  const authConfig = def?.auth;
  if (!authConfig) return [];

  const { UserPluginConnections } = await import('@/lib/server/user-plugin-connections');
  const conn: any = await UserPluginConnections.getInstance().getConnection(userId, 'google-sheets', authConfig);
  if (!conn?.access_token) return [];

  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`);
  url.searchParams.set('fields', 'sheets(properties(sheetId,title,index))');
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${conn.access_token}` } });
  if (!res.ok) throw new Error(`Google Sheets metadata error: ${res.status} ${res.statusText}`);

  const data: any = await res.json();
  const sheets = Array.isArray(data?.sheets) ? data.sheets : [];
  return sheets
    .map((s: any, i: number) => ({ title: s?.properties?.title, index: s?.properties?.index ?? i }))
    .filter((t: SheetsTab) => typeof t.title === 'string' && t.title.length > 0);
};

/** The registered resolver (wired into the default registry in ./index). */
export const googleSheetsRangeResolver: ParameterResolver = createGoogleSheetsRangeResolver(defaultReadSheetTabs);
