'use client';

/**
 * Model pricing: the `ai_model_pricing` table every Business OS credit charge
 * is computed from.
 *
 * ADMIN_BOS_CLEANUP slice 2 (FR-PR1, FR-PR4, FR-PR6; conditions C2-1, C2-2,
 * C2-4, C2-8; SA W2-1, W2-3, W2-8). The AgentsPilot billing settings that
 * used to share this page (grace period, boost packs, the Pilot Credit
 * calculator, the read-only dump) moved to `app/admin/agentspilot-billing/page.tsx`.
 *
 * The page reads `GET /api/admin/system-config/pricing` and, since slice 4,
 * the price comparison (below). A failed read
 * clears the table and says so (C2-4): the table shows only what the last
 * read returned, never an empty or stale list posing as current.
 *
 * Sync is parked (UC-5) and its handler and button are frozen byte for byte
 * (C2-1). AI_MODEL_PRICE_REVIEW slice 1 (SA 2026-10-08 R-5) rewrote the false
 * info-box and helper text around it; slice 8 retires Sync.
 *
 * AI_MODEL_PRICE_REVIEW slice 4 (user decision UF-5): this table IS the price
 * comparison. Every displayed price, gap, status, area and flag comes from
 * `GET /api/admin/model-pricing/comparison` (read in `priceComparisonRead.ts`),
 * printed from the server's decimal strings. The pricing list read here only
 * supplies the row id behind Edit, the dates and the retired rows (SA N-1,
 * NR-1). Either read failing fails the table (SA N-4, C2-4). There is no Apply,
 * no provider check and no history yet (slices 5, 8, 9).
 *
 * Page layout slice (user feedback UF-7, 2026-10-16): a KPI strip from the
 * data already read (`priceKpis.ts`; the last check comes from the status
 * `ProviderPriceCheck` reads, through `onStatus`), a "Show retired" toggle
 * (off by default; superseded rows follow it), and the old always-open info
 * box moved behind a ? button into the shared drawer. The Sync paragraph and
 * the "within 1 hour" sentence stay verbatim in this file (source guard S-4,
 * MT-2).
 */

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  RefreshCw,
  AlertCircle,
  CheckCircle,
  DollarSign,
  Edit,
  X,
  Check,
  Download,
  ChevronUp,
  ChevronDown,
  HelpCircle
} from 'lucide-react';

import { clientLogger } from '@/lib/logger/client';
import type { ComparisonModel } from '@/lib/ai/pricing-research/comparisonModel';
import { AdminDrawer, DrawerSection } from '@/app/admin/components/layout/AdminDrawer';
import { AdminNotice } from '@/app/admin/components/layout/AdminStates';
import { KpiStrip, KpiTile } from '@/app/admin/components/layout/KpiStrip';
import { formatCount, formatUtcDate } from '@/app/admin/components/layout/adminFormat';
import {
  ADMIN_BUTTON,
  ADMIN_TABLE,
  ADMIN_TBODY,
  ADMIN_TD,
  ADMIN_TH,
  ADMIN_TH_NUM,
  ADMIN_THEAD,
} from '@/app/admin/components/layout/adminTable';
import { ManualPriceEntryForm, type ManualEntryPrefill } from '@/app/admin/system-config/components/ManualPriceEntryForm';
import {
  EmptyPriceCells,
  PriceCells,
  SourceCell,
  StatusCell,
  UsedByCell,
} from '@/app/admin/system-config/components/PriceRowCells';
import ProviderPriceCheck from '@/app/admin/system-config/components/ProviderPriceCheck';
import { readPriceComparison } from '@/app/admin/system-config/priceComparisonRead';
import { priceKpis, type CheckStatusState } from '@/app/admin/system-config/priceKpis';
import {
  EDIT_UNIT_WORDS,
  ENTER_PROVIDER_PRICE,
  HELP_WORDS,
  IN_EFFECT_SINCE,
  KPI_WORDS,
  NO_MODELS_LINE,
  NO_PENDING_NOTICE,
  PRICE_REVIEW_NOTE,
  RETIRED_FILTER_WORDS,
  SORT_LABEL,
  SORT_OPTIONS,
  type PriceSortMode,
} from '@/app/admin/system-config/priceReviewCopy';
import { buildPriceTableRows, sortPriceTableRows, type PriceTableRow } from '@/app/admin/system-config/priceTableRows';

const logger = clientLogger.child({ module: 'AdminModelPricingPage' });

interface ModelPricing {
  id: string;
  provider: string;
  model_name: string;
  input_cost_per_token: number;
  output_cost_per_token: number;
  effective_date: string;
  /** Set on a retired row (slice 4 labels it, SA RC-4). */
  retired_date?: string | null;
}

/** The two sub-header rows of the unit groups (slice 4, SA NR-5). */
const UNIT_SUB_HEADERS = ['ours', 'provider', 'gap'] as const;

/** Rows hidden while "Show retired" is off (UF-7): neither is charged, today or later. */
const HIDDEN_UNLESS_RETIRED_SHOWN: ReadonlySet<PriceTableRow<ModelPricing>['kind']> = new Set(['retired', 'superseded'] as const);

const HELP_TEXT = 'text-sm leading-relaxed text-slate-300';
const HELP_LABEL = 'text-green-300';

/**
 * The help drawer body (UF-7): the flow, the units and the buttons in plain
 * words. Kept in this file because the source guard reads the Sync paragraph
 * (S-4) and the "within 1 hour" sentence (MT-2) from `page.tsx`. MT-1 and G-2
 * also scan this file, so some words are avoided on purpose.
 */
function PricingHelp() {
  return (
    <>
      <DrawerSection title="What this page is">
        <p className={HELP_TEXT}>
          This table defines the cost per token for each AI model&apos;s input (prompts) and output (responses). Business OS credit charges for the models listed here are computed from these prices, so a wrong price here is a wrong charge for every customer who uses that model.
        </p>
      </DrawerSection>
      <DrawerSection title="How a price review works">
        <ol className={`list-decimal space-y-2 pl-5 ${HELP_TEXT}`}>
          <li>
            <strong className={HELP_LABEL}>Get the provider&apos;s price.</strong> Check provider prices reads OpenAI&apos;s official pricing page. For Anthropic, Google and Kimi, use Enter provider price and type the price from the provider&apos;s page. Either way the price is saved as a pending price: nothing is charged from it.
          </li>
          <li>
            <strong className={HELP_LABEL}>Read green and red.</strong> Each row shows what we charge today (ours) next to the provider&apos;s new price, and the gap. Green (Covered) means we charge at or above the provider&apos;s price. Red (Undercharging) means we charge less than the provider charges us, so every call on that model loses money. Red rows sort first.
          </li>
          <li>
            <strong className={HELP_LABEL}>Apply (coming later).</strong> Makes a pending price the live price, one model at a time, with a short reason.
          </li>
          <li>
            <strong className={HELP_LABEL}>History (coming later).</strong> Every past price of a model: who applied it, when, why, and from which source.
          </li>
        </ol>
      </DrawerSection>
      <DrawerSection title="The units">
        <div className="space-y-2">
          <p className={HELP_TEXT}>
            <strong className={HELP_LABEL}>Input /1M:</strong> Price per 1M input tokens (prompts, context, memory), in USD, the figure providers publish. The table stores the price per token, and the Edit field still takes the per-token value. Example: $0.15 per 1M tokens = $0.00000015 per token.
          </p>
          <p className={HELP_TEXT}>
            <strong className={HELP_LABEL}>Output /1M:</strong> Price per 1M output tokens (AI responses, generated content), in USD. Usually higher than input. Example: $0.60 per 1M tokens = $0.0000006 per token.
          </p>
        </div>
      </DrawerSection>
      <DrawerSection title="The buttons">
        <div className="space-y-2">
          <p className={HELP_TEXT}>
            <strong className={HELP_LABEL}>Check provider prices and Enter provider price:</strong> only create pending prices. No charge changes.
          </p>
          <p className={HELP_TEXT}>
            <strong className="text-green-300">Sync Latest Pricing:</strong> Copies a built-in price list, kept in the code, into this table: it overwrites the price of every model on that list, including manual edits, and adds any listed model that is missing. It does not contact OpenAI, Anthropic or any other provider.
          </p>
          <p className={HELP_TEXT}>
            <strong className={HELP_LABEL}>Edit (the pencil on a row):</strong> changes the stored price of that model directly.
          </p>
          <p className={HELP_TEXT}>
            Sync and Edit change live prices directly, with no pending step and no review, and will be removed in a later update, when Apply arrives. Each server keeps its own copy of these prices for up to 1 hour, so a change (an edit or a Sync) is in effect on all servers within 1 hour. Changes don&apos;t alter provider billing.
          </p>
        </div>
      </DrawerSection>
    </>
  );
}

export default function ModelPricingPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [pricingModels, setPricingModels] = useState<ModelPricing[]>([]);
  // C2-4: true when the last price read failed. The table is not drawn.
  const [pricingReadFailed, setPricingReadFailed] = useState(false);

  // Pricing editing state
  const [editingPricing, setEditingPricing] = useState<string | null>(null);
  const [editedInputCost, setEditedInputCost] = useState<number>(0);
  const [editedOutputCost, setEditedOutputCost] = useState<number>(0);

  // Open by default (SA W2-8): on a page that is the table, a closed card is
  // an extra click and would hide the C2-4 failure line.
  const [pricingExpanded, setPricingExpanded] = useState(true);

  // Slice 4: the comparison behind every displayed price, the sort, the
  // manual-entry form, and the busy flag of a silent re-read (SA NR-2).
  const [comparison, setComparison] = useState<ComparisonModel | null>(null);
  const [sortMode, setSortMode] = useState<PriceSortMode>('recommended');
  const [entryOpen, setEntryOpen] = useState(false);
  const [entryPrefill, setEntryPrefill] = useState<ManualEntryPrefill | null>(null);
  const [entryKey, setEntryKey] = useState(0);
  const [rereading, setRereading] = useState(false);

  // UF-7: retired and superseded rows hidden by default; the help drawer; the
  // provider check status reported by ProviderPriceCheck (undefined = not yet).
  const [showRetired, setShowRetired] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const helpButtonRef = useRef<HTMLButtonElement>(null);
  const [checkStatus, setCheckStatus] = useState<CheckStatusState>(undefined);

  useEffect(() => {
    fetchData();
    // Mount-only load, as on the page before the split; refreshes are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // C2-4 / O-5: the table shows only what the last read returned. A failed
  // read (including a refresh after Sync) clears it and any open editor.
  const markPricingReadFailed = () => {
    setPricingReadFailed(true);
    setPricingModels([]);
    setComparison(null);
    setEditingPricing(null);
    setError('Could not load model prices.');
  };

  const fetchData = async (silent = false) => {
    try {
      if (!silent) {
        setLoading(true);
      } else {
        setRereading(true);
      }
      setError(null);

      // Both lists in one go (SA N-4). The comparison read never throws, so a
      // throw here is the pricing read, as before.
      const [response, comparisonRead] = await Promise.all([
        fetch('/api/admin/system-config/pricing', {
          method: 'GET',
          cache: 'no-store'
        }),
        readPriceComparison(),
      ]);

      if (!response.ok) {
        logger.error({ status: response.status }, 'Model prices read failed');
        markPricingReadFailed();
        return;
      }

      const result = await response.json();

      if (!result.success) {
        logger.error({ status: response.status }, 'Model prices read returned unsuccessful');
        markPricingReadFailed();
        return;
      }

      if (!comparisonRead.ok) {
        logger.error({ status: comparisonRead.status, read: 'comparison' }, 'Price comparison read failed');
        markPricingReadFailed();
        return;
      }

      setPricingModels(result.data);
      setComparison(comparisonRead.data);
      setPricingReadFailed(false);
      logger.debug({ count: result.data.length, compared: comparisonRead.data.rows.length }, 'Model prices loaded');
    } catch (err) {
      logger.error({ err }, 'Model prices read threw');
      markPricingReadFailed();
    } finally {
      if (!silent) {
        setLoading(false);
      } else {
        setRereading(false);
      }
    }
  };

  // After a saved edit "ours" must show the stored price exactly, so the
  // comparison is read once more (SA N-5). If that read fails, the save still
  // succeeded: its message stays and the table is cleared (SA NR-2, C2-4).
  const rereadComparison = async () => {
    setRereading(true);
    const comparisonRead = await readPriceComparison();
    setRereading(false);
    if (comparisonRead.ok) {
      setComparison(comparisonRead.data);
      return;
    }
    logger.error({ status: comparisonRead.status, read: 'comparison' }, 'Price comparison re-read after save failed');
    markPricingReadFailed();
  };

  const openEntry = (prefill: ManualEntryPrefill | null) => {
    setEntryPrefill(prefill);
    setEntryKey((key) => key + 1);
    setEntryOpen(true);
  };

  const handleEditPricing = (model: ModelPricing) => {
    setEditingPricing(model.id);
    setEditedInputCost(model.input_cost_per_token);
    setEditedOutputCost(model.output_cost_per_token);
  };

  const handleCancelEditPricing = () => {
    setEditingPricing(null);
    setEditedInputCost(0);
    setEditedOutputCost(0);
  };

  const handleSavePricing = async (modelId: string) => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const response = await fetch('/api/admin/system-config/pricing', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: modelId,
          input_cost_per_token: editedInputCost,
          output_cost_per_token: editedOutputCost
        })
      });

      if (!response.ok) {
        throw new Error('Failed to update pricing');
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to update pricing');
      }

      // SA W2-1: show the saved price. The PUT returns the saved row in the
      // same shape as the GET rows, so it replaces the old row in place.
      const saved = result.data as ModelPricing | undefined;
      if (saved?.id) {
        setPricingModels((rows) => rows.map((row) => (row.id === saved.id ? saved : row)));
      } else {
        // Defensive: if the PUT ever stops returning the row, re-read rather
        // than show a stale price or throw after a save that succeeded.
        await fetchData(true);
      }

      setSuccess('Pricing updated successfully!');
      setEditingPricing(null);

      setTimeout(() => setSuccess(null), 3000);

      if (saved?.id) {
        await rereadComparison();
      }

    } catch (error) {
      logger.error({ err: error, pricingId: modelId }, 'Model price save failed');
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setSaving(false);
    }
  };

  const handleSyncPricing = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const response = await fetch('/api/admin/system-config/pricing/sync', {
        method: 'POST'
      });

      if (!response.ok) {
        throw new Error('Failed to sync pricing');
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to sync pricing');
      }

      setSuccess(result.message || 'Pricing synced successfully!');

      // Refresh pricing data after sync since it fetches from external API
      await fetchData(true);

      setTimeout(() => setSuccess(null), 5000);

    } catch (error) {
      logger.error({ err: error }, 'Pricing sync failed');
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setSaving(false);
    }
  };

  // Slice 4: the rows of the one table, sorted as the admin chose. Every
  // displayed price comes from the comparison (SA N-1); none is formatted here.
  const allRows = comparison ? sortPriceTableRows(buildPriceTableRows(pricingModels, comparison), sortMode) : [];
  const tableRows = showRetired ? allRows : allRows.filter((row) => !HIDDEN_UNLESS_RETIRED_SHOWN.has(row.kind));
  const hiddenCount = allRows.length - tableRows.length;
  const kpis = comparison ? priceKpis(comparison, checkStatus) : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-8 h-8 text-purple-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="border-b border-slate-700">
        <div className="flex items-center justify-between pb-4">
          <div className="flex items-center gap-4">
            <div className="flex flex-col">
              <div className="flex items-center gap-4 mb-1">
                <h1 className="text-xl font-semibold text-white">Model pricing</h1>
              </div>
              <p className="text-sm text-slate-400">AI cost per token for each model. Every Business OS credit charge is computed from these prices.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Refresh stays the first header button (E-3 reaches it by position). */}
            <button
              onClick={() => fetchData()}
              disabled={loading}
              aria-label="Refresh"
              className="p-2 rounded-lg border border-slate-700 hover:bg-slate-800 transition-colors"
            >
              <RefreshCw className={`w-5 h-5 text-slate-400 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              ref={helpButtonRef}
              type="button"
              onClick={() => setHelpOpen(true)}
              aria-label={HELP_WORDS.button}
              aria-haspopup="dialog"
              data-testid="pricing-help-button"
              className="p-2 rounded-lg border border-slate-700 hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
            >
              <HelpCircle className="w-5 h-5 text-slate-400" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      {/* UF-7: the KPI strip, from the reads the page already made. Not drawn when the table read failed (C2-4). */}
      {kpis && (
        <KpiStrip>
          <KpiTile testId="kpi-undercharging" label={KPI_WORDS.undercharging} {...kpis.undercharging} />
          <KpiTile testId="kpi-pending" label={KPI_WORDS.pending} {...kpis.pending} />
          <KpiTile testId="kpi-last-check" label={KPI_WORDS.lastCheck} {...kpis.lastCheck} />
          <KpiTile testId="kpi-models-in-use" label={KPI_WORDS.modelsInUse} {...kpis.modelsInUse} />
        </KpiStrip>
      )}

      {/* Success/Error Messages */}
      {success && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-green-500/10 border border-green-500/50 rounded-lg p-4 flex items-center gap-3"
        >
          <CheckCircle className="w-5 h-5 text-green-400" />
          <p className="text-green-400">{success}</p>
        </motion.div>
      )}

      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 flex items-center gap-3"
        >
          <AlertCircle className="w-5 h-5 text-red-400" />
          <p className="text-red-400">{error}</p>
        </motion.div>
      )}

      {/* AI Model Pricing Table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-slate-800 border border-slate-700 rounded-xl"
      >
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-green-400" />
                AI Model Pricing
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                Cost per token for each AI model. Sync copies a built-in price list; it does not fetch prices from providers.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSyncPricing}
                disabled={saving}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
              >
                {saving ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    Sync Latest Pricing
                  </>
                )}
              </button>
              <button
                data-testid="pricing-toggle"
                onClick={() => setPricingExpanded(!pricingExpanded)}
                aria-expanded={pricingExpanded}
                aria-controls="model-pricing-body"
                aria-label={pricingExpanded ? 'Collapse model prices' : 'Expand model prices'}
                className="p-2 bg-slate-900/50 hover:bg-slate-600/50 rounded-lg transition-colors"
              >
                {pricingExpanded ? (
                  <ChevronUp className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                )}
              </button>
            </div>
          </div>
        </div>

        {pricingExpanded && (
          <div id="model-pricing-body" className="p-6 space-y-4">
          {/* Slice 5: "Check provider prices"; a stored check re-reads the table (silent, as after a manual entry). */}
          <ProviderPriceCheck
            onFinished={() => {
              void fetchData(true);
            }}
            onStatus={setCheckStatus}
          />

          {/* Slice 4: the bar, note, notice and form sit above the table, so a failed read never hides them. */}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <button type="button" onClick={() => openEntry(null)} className={ADMIN_BUTTON}>
              {ENTER_PROVIDER_PRICE}
            </button>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                aria-pressed={showRetired}
                onClick={() => setShowRetired((shown) => !shown)}
                data-testid="show-retired-toggle"
                className={`${ADMIN_BUTTON} inline-flex items-center gap-1 ${showRetired ? 'ring-1 ring-purple-500' : ''}`}
              >
                {showRetired && <Check className="w-4 h-4" aria-hidden="true" />}
                {RETIRED_FILTER_WORDS.toggle}
              </button>
              <label htmlFor="price-sort" className="text-xs text-slate-300">
                {SORT_LABEL}
              </label>
              <select
                id="price-sort"
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value as PriceSortMode)}
                className="rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p data-testid="price-review-note" className="text-xs text-slate-400">
            {PRICE_REVIEW_NOTE}
          </p>
          {hiddenCount > 0 && (
            <p data-testid="retired-hidden-line" className="text-xs text-slate-400">
              {`${formatCount(hiddenCount)} ${hiddenCount === 1 ? RETIRED_FILTER_WORDS.hiddenOne : RETIRED_FILTER_WORDS.hidden}`}
            </p>
          )}
          {comparison && comparison.rows.length > 0 && comparison.rows.every((row) => row.pending.length === 0) && (
            <AdminNotice testId="no-pending-notice">{NO_PENDING_NOTICE}</AdminNotice>
          )}
          {entryOpen && (
            <ManualPriceEntryForm
              key={entryKey}
              prefill={entryPrefill}
              onSaved={() => {
                void fetchData(true);
              }}
              onClose={() => setEntryOpen(false)}
            />
          )}

          {/* C2-4: a failed read is said, never drawn as an empty table. */}
          {pricingReadFailed ? (
            <p data-testid="pricing-read-failed" className="text-sm text-red-400">
              Model prices could not be read. Use the refresh button to try again.
            </p>
          ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-700" aria-busy={rereading || undefined} data-testid="pricing-table-wrap">
          <table className={ADMIN_TABLE}>
            <caption className="sr-only">Model prices: what we charge today next to the provider&apos;s new price, per 1M tokens or per image</caption>
            <thead className={ADMIN_THEAD}>
              <tr>
                <th scope="col" rowSpan={2} className={ADMIN_TH}>Model</th>
                <th scope="col" rowSpan={2} className={ADMIN_TH}>Used by</th>
                <th scope="colgroup" colSpan={3} className={`${ADMIN_TH} text-center`}>Input /1M</th>
                <th scope="colgroup" colSpan={3} className={`${ADMIN_TH} text-center`}>Output /1M</th>
                <th scope="col" rowSpan={2} className={ADMIN_TH}>Status</th>
                <th scope="col" rowSpan={2} className={ADMIN_TH}>Source</th>
                <th scope="col" rowSpan={2} className={ADMIN_TH_NUM}>Actions</th>
              </tr>
              <tr>
                {[...UNIT_SUB_HEADERS, ...UNIT_SUB_HEADERS].map((label, index) => (
                  <th key={`${label}-${index}`} scope="col" className={ADMIN_TH_NUM}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className={ADMIN_TBODY}>
              {tableRows.length === 0 ? (
                <tr>
                  <td colSpan={11} className={ADMIN_TD}>
                    {NO_MODELS_LINE}
                  </td>
                </tr>
              ) : tableRows.map((row) => {
                const comparisonRow = row.kind === 'compared' ? row.comparison : null;
                // Edit only on a stored row that is, or will be, charged
                // (SA RC-4, NR-1): not on retired or superseded rows, and not
                // on a model with no stored row.
                const model = row.kind === 'compared' || row.kind === 'starts_later' ? row.stored : null;
                const isEditing = model !== null && editingPricing === model.id;
                const provider = comparisonRow ? comparisonRow.provider : row.stored?.provider ?? null;
                const modelName = comparisonRow ? comparisonRow.modelName : row.stored?.model_name ?? '';

                return (
                  <tr key={row.key} className="hover:bg-slate-700/20 transition-colors">
                    <td className={ADMIN_TD}>
                      <span className="font-mono text-white">{modelName}</span>
                      <span className="block text-[11px] text-slate-400">
                        {comparisonRow?.kind === 'image' ? `${provider ?? '—'} · images` : provider ?? '—'}
                      </span>
                      {/* SA F-1: when the charged stored price took effect (text only, no Date). */}
                      {row.kind === 'compared' && row.stored && (
                        <span className="block text-[11px] text-slate-400">
                          {`${IN_EFFECT_SINCE} ${formatUtcDate(row.stored.effective_date.slice(0, 10))}`}
                        </span>
                      )}
                    </td>
                    <UsedByCell row={comparisonRow} />
                    {isEditing && model ? (
                      <td className={ADMIN_TD} colSpan={6}>
                        <div className="flex flex-wrap items-center gap-4">
                        <div className="flex items-center justify-end gap-1">
                          <label htmlFor={`edit-input-${model.id}`} className="text-xs text-slate-300">
                            Input, {EDIT_UNIT_WORDS}
                          </label>
                          <input
                            id={`edit-input-${model.id}`}
                            type="text"
                            value={editedInputCost.toFixed(10)}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              if (!isNaN(val)) setEditedInputCost(val);
                            }}
                            className="w-40 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-sm font-mono text-right"
                            placeholder="0.00000000"
                          />
                          <div className="flex flex-col">
                            <button
                              onClick={() => setEditedInputCost(editedInputCost + 0.00000001)}
                              className="p-0.5 bg-slate-600 hover:bg-slate-500 text-white rounded-t transition-colors"
                              title="Increase"
                            >
                              <ChevronUp className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => setEditedInputCost(Math.max(0, editedInputCost - 0.00000001))}
                              className="p-0.5 bg-slate-600 hover:bg-slate-500 text-white rounded-b transition-colors"
                              title="Decrease"
                            >
                              <ChevronDown className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                        <div className="flex items-center justify-end gap-1">
                          <label htmlFor={`edit-output-${model.id}`} className="text-xs text-slate-300">
                            Output, {EDIT_UNIT_WORDS}
                          </label>
                          <input
                            id={`edit-output-${model.id}`}
                            type="text"
                            value={editedOutputCost.toFixed(10)}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              if (!isNaN(val)) setEditedOutputCost(val);
                            }}
                            className="w-40 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-sm font-mono text-right"
                            placeholder="0.00000000"
                          />
                          <div className="flex flex-col">
                            <button
                              onClick={() => setEditedOutputCost(editedOutputCost + 0.00000001)}
                              className="p-0.5 bg-slate-600 hover:bg-slate-500 text-white rounded-t transition-colors"
                              title="Increase"
                            >
                              <ChevronUp className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => setEditedOutputCost(Math.max(0, editedOutputCost - 0.00000001))}
                              className="p-0.5 bg-slate-600 hover:bg-slate-500 text-white rounded-b transition-colors"
                              title="Decrease"
                            >
                              <ChevronDown className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                        </div>
                      </td>
                    ) : comparisonRow ? (
                      <PriceCells row={comparisonRow} />
                    ) : (
                      <EmptyPriceCells />
                    )}
                    <StatusCell row={row} />
                    <SourceCell row={comparisonRow} />
                    <td className={`${ADMIN_TD} whitespace-nowrap text-right`}>
                      {isEditing && model ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleSavePricing(model.id)}
                            disabled={saving}
                            className="p-1.5 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 text-white rounded transition-colors"
                            title="Save"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            onClick={handleCancelEditPricing}
                            disabled={saving}
                            className="p-1.5 bg-slate-600 hover:bg-slate-700 disabled:bg-slate-700 text-white rounded transition-colors"
                            title="Cancel"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-2">
                          {comparisonRow && (
                            <button
                              type="button"
                              onClick={() =>
                                openEntry({ kind: comparisonRow.kind, provider: comparisonRow.provider, modelName: comparisonRow.modelName })
                              }
                              aria-label={`${ENTER_PROVIDER_PRICE} for ${comparisonRow.modelName}`}
                              className={ADMIN_BUTTON}
                            >
                              {ENTER_PROVIDER_PRICE}
                            </button>
                          )}
                          {model && (
                            <button
                              onClick={() => handleEditPricing(model)}
                              className="p-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                              title="Edit pricing"
                              aria-label={`Edit the stored price of ${modelName}`}
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          )}
        </div>
        )}
      </motion.div>

      {/* UF-7: the help that used to be an always-open info box. */}
      <AdminDrawer
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        onReturnFocus={() => helpButtonRef.current?.focus()}
        title={HELP_WORDS.title}
        testId="pricing-help-drawer"
      >
        <PricingHelp />
      </AdminDrawer>
    </div>
  );
}
