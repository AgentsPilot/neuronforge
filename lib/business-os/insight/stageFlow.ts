/**
 * How many people actually moved from one stage to the next.
 *
 * The funnel map used to divide one stage's CURRENT HEADCOUNT by the next
 * stage's current headcount and call the result a conversion rate. That is a
 * ratio of two queue lengths, not a flow, and it reports the wrong thing in
 * both directions:
 *
 *   Lead 20 · Consultation 3 · Active 2 · Past client 40
 *
 * Every one of those forty passed through the first gap, and the map called it
 * "17 dropped off" — because seventeen people are still sitting in Lead. Run it
 * the other way and a business where nothing ever completes, so everyone piles
 * up in Active, reads as healthy. A stall looks like health and speed looks like
 * a leak.
 *
 * What a funnel actually asks is a COHORT question: of the people who reached
 * this stage, how many went further? That needs history, and the CRM has been
 * recording it all along — every stage change writes a `stage_changed` activity
 * whose description carries the stage moved from and to, with a date.
 *
 * Pure and dependency-free so the detector and the dashboard can share one
 * implementation. Two answers to the same question would eventually disagree,
 * and the map contradicting the insight card about the same funnel is the exact
 * class of bug this module has already shipped once.
 */

/** A single recorded stage movement. */
export interface StageMove {
  contactId: string;
  from: string | null;
  to: string | null;
  /** Epoch milliseconds. */
  at: number;
}

/** What happened to everyone who reached one stage. */
export interface StageFlow {
  stageKey: string;
  /** People who arrived at this stage inside the window and have had time to move. */
  arrived: number;
  /** How many of those went on to any later stage. */
  movedOn: number;
  /** The ones still sitting here. `arrived - movedOn`, and real people. */
  stuck: number;
  /** Their contact ids, so a card can name them. */
  stuckIds: string[];
}

/** A stage's place in the pipeline, and whether it is somewhere good. */
export interface StageRank {
  stageKey: string;
  /** `crm_pipeline_stages.position` — later means further along. */
  position: number;
  /** `stage_type`. A move into a lost/archived stage is not progress. */
  type?: string | null;
}

/** Ending up in one of these is not having moved forward. */
const DEAD_END_TYPES = new Set(['lost', 'archived']);

export interface StageFlowOptions {
  /** Now, in epoch ms. Passed in rather than read, so this stays pure. */
  now: number;
  /**
   * The pipeline's own order, so progress can mean FORWARD.
   *
   * Without it, "moved on" means only "left the stage" — and someone who went
   * from Consultation straight to Lost would count as having progressed,
   * making a business that loses people look like one with throughput. The
   * stages are ordered per business by onboarding, so the order has to be
   * passed in rather than assumed.
   *
   * Omit it and movement alone counts, which is the honest fallback when the
   * caller has no ordering to offer.
   */
  ranks?: StageRank[];
  /**
   * How long someone must have been at a stage before not moving means
   * anything. Without it, everyone who arrived yesterday counts as stuck and
   * the stage nearest the top always looks like the worst leak.
   */
  settleDays?: number;
  /** How far back to gather arrivals. */
  windowDays?: number;
}

const DEFAULT_SETTLE_DAYS = 7;
const DEFAULT_WINDOW_DAYS = 60;
const DAY = 86_400_000;

/**
 * Fold recorded movements into one row per stage.
 *
 * Arrival is the FIRST time a contact reached a stage: someone who moved back
 * and forth has still only reached it once, and counting both would inflate the
 * denominator and make the stage look better than it is.
 */
export function computeStageFlow(moves: StageMove[], options: StageFlowOptions): StageFlow[] {
  const settleDays = options.settleDays ?? DEFAULT_SETTLE_DAYS;
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;

  const windowStart = options.now - windowDays * DAY;
  const settledBefore = options.now - settleDays * DAY;

  /*
   * Ordering is used only when it actually orders something.
   *
   * A pipeline whose stages all carry position 0 — unset, or never migrated —
   * would otherwise make `destination.position > origin.position` false for
   * every move, so NOTHING would count as progress and every stage would report
   * its whole cohort as stuck. That is a silent, total failure dressed as a
   * finding, and it is the shape of bug this module keeps producing: a lookup
   * that comes back empty and a calculation that carries on regardless.
   *
   * With no usable ordering, fall back to "any movement counts" — the same
   * honest default as supplying no ranks at all.
   */
  const usableRanks = options.ranks ?? [];
  const distinctPositions = new Set(usableRanks.map(r => r.position)).size;
  const rankOf =
    distinctPositions > 1 ? new Map(usableRanks.map(r => [r.stageKey, r])) : new Map<string, StageRank>();

  /**
   * Whether leaving `from` for `to` counts as getting further.
   *
   * With no ordering supplied, any movement counts — the caller has told us
   * nothing better. With ordering, the destination must be later in the
   * pipeline and must not be a dead end: someone marked Lost has left the
   * stage, but reporting that as progress would make losing people look like
   * throughput, and the connector above them would turn green for it.
   */
  const isProgress = (from: string, to: string | null): boolean => {
    if (!to) return false;
    if (rankOf.size === 0) return true;

    const destination = rankOf.get(to);
    const origin = rankOf.get(from);
    if (!destination || !origin) return true; // Unknown stage: do not penalise.

    if (DEAD_END_TYPES.has(String(destination.type ?? ''))) return false;
    return destination.position > origin.position;
  };

  /** Everyone who got FURTHER than a given stage. */
  const leftStage = new Map<string, Set<string>>();
  for (const move of moves) {
    if (!move.from) continue;
    if (!isProgress(move.from, move.to)) continue;
    if (!leftStage.has(move.from)) leftStage.set(move.from, new Set());
    leftStage.get(move.from)!.add(move.contactId);
  }

  /** First arrival per contact per stage. */
  const arrivals = new Map<string, Map<string, number>>();
  for (const move of moves) {
    if (!move.to) continue;
    if (move.at < windowStart) continue;
    if (!arrivals.has(move.to)) arrivals.set(move.to, new Map());
    const byContact = arrivals.get(move.to)!;
    if (!byContact.has(move.contactId)) byContact.set(move.contactId, move.at);
  }

  const flows: StageFlow[] = [];

  for (const [stageKey, byContact] of arrivals) {
    const settled = [...byContact.entries()].filter(([, at]) => at <= settledBefore);
    if (settled.length === 0) continue;

    const movedOnSet = leftStage.get(stageKey) ?? new Set<string>();
    const stuckIds = settled.filter(([id]) => !movedOnSet.has(id)).map(([id]) => id);

    flows.push({
      stageKey,
      arrived: settled.length,
      movedOn: settled.length - stuckIds.length,
      stuck: stuckIds.length,
      stuckIds,
    });
  }

  return flows;
}

/**
 * Pull a stage movement out of a `crm_activities` row.
 *
 * The from/to pair lives inside `description` as a JSON string — the CRM writes
 * it there rather than in columns of its own. Anything that does not parse, or
 * carries no stage change, is skipped rather than guessed at: a malformed row
 * must not become a phantom member of a cohort and quietly shift a percentage.
 */
export function parseStageMove(row: {
  contact_id?: unknown;
  description?: unknown;
  activity_date?: unknown;
}): StageMove | null {
  const contactId = row.contact_id ? String(row.contact_id) : '';
  const at = Date.parse(String(row.activity_date ?? ''));
  if (!contactId || Number.isNaN(at)) return null;

  try {
    const parsed = JSON.parse(String(row.description ?? '')) as {
      changes?: { stage?: { from?: unknown; to?: unknown } };
    };
    const stage = parsed?.changes?.stage;
    if (!stage) return null;

    const from = stage.from ? String(stage.from) : null;
    const to = stage.to ? String(stage.to) : null;
    if (!from && !to) return null;

    return { contactId, from, to, at };
  } catch {
    return null;
  }
}
