/**
 * Vector vocabulary, declared once for both sides of the client boundary.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 *
 * `VectorKey`, `VectorState`, `MaturityLevel` and `VectorStatus` were declared
 * twice — in `repository/InsightRepository.ts` and again in
 * `hooks/useInsights.ts` — because a `'use client'` hook cannot import a
 * repository (CLAUDE.md rule 1), and copying the types was the quickest way
 * past that. Hazard H9 recorded the obvious risk, and the pair had ALREADY
 * drifted by the time anyone checked.
 *
 * These four carry no behaviour and no imports, so they can live in one place
 * that both sides reach. The file is deliberately dependency-free: nothing
 * here may import a repository, a Supabase client, or anything server-only,
 * or the client bundle starts pulling the server in behind a type.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS NOT SHARED, AND WHY THAT IS CORRECT
 *
 * `VectorMaturityData` stays declared twice, on purpose. They are two
 * different shapes describing two different moments:
 *
 *   server  `journeyAnchors: JourneyAnchors`   always computed
 *   wire    `journeyAnchors?: { … }`           optional, because a response
 *                                              cached before anchors shipped
 *                                              has none, and the timeline
 *                                              degrades to undated nodes
 *                                              rather than to wrong ones
 *
 * Forcing those into one type would either make the server's guarantee
 * optional — so every reader must handle an absence that cannot happen — or
 * make the client's optional field required, which is a lie about old cached
 * payloads. The duplication there is a real distinction, not an oversight.
 *
 * @module lib/business-os/insight/vectorTypes
 */

/** The seven things the advisor learns about a business, in dashboard order. */
export type VectorKey = 'wins' | 'conv' | 'ops' | 'cash' | 'leads' | 'ret' | 'price';

/**
 * How much a vector knows.
 *
 * Three states, not two. `learn` means at least one row of data has arrived
 * but the volume threshold has not been met — the distinction that `dark`/`lit`
 * alone cannot express, and whose collapse in `DetectorEngine` produced the
 * day-52 report (hazard H12).
 */
export type VectorState = 'dark' | 'learn' | 'lit';

/** How far along the whole account is, derived from how many vectors are lit. */
export type MaturityLevel = 'cold_start' | 'early' | 'running' | 'mature';

/**
 * One vector's standing, as both the server and the strip understand it.
 *
 * ⚠️ The client's copy was missing `also` — a second drift H9 predicted. The
 * server has been sending the volume clause and the hook's type said it did
 * not exist, so any client code wanting it had to cast. It is optional, so
 * adopting the shared type here takes a field away from nobody.
 */
export interface VectorStatus {
  key: VectorKey;
  name: string;
  state: VectorState;
  dataPoints: number;
  threshold: number;
  note?: string;
  /**
   * The volume condition behind a time-based vector, with where it stands.
   *
   * Separate from `threshold` so the journey timeline can tell the two apart:
   * days are arithmetic and can be stated as a date, volume cannot. Absent on
   * vectors that have only one condition.
   */
  also?: { metric: string; current: number; threshold: number };
}
