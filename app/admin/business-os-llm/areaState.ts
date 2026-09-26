/**
 * The ONE copy of "is this area / how many calls are configured off" (admin
 * reorganisation slice 4, SA C-6).
 *
 * `AreaCard` renders it, and the Health landing's route counts with it, so the
 * Business OS AI page and the Health tile that links to it cannot disagree.
 *
 * Typed STRUCTURALLY and imports nothing: the screen's source guard forbids any
 * `@/lib/` import here and any import of `adminSettingsView`, and the server
 * route passes its own `AreaView` objects, which already have these fields.
 * No `'use client'`: it is plain logic, usable on both sides.
 */

export interface AreaOffInput {
  /** False when the area can never be switched off (onboarding). */
  switchable: boolean;
  /** What the row configures for the area as a whole. */
  configuredEnabled: boolean;
  calls: ReadonlyArray<{ resolved: { enabled: boolean } }>;
}

export interface AreaOffSummary {
  /** The area itself is configured off (only possible when it is switchable). */
  areaShowsOff: boolean;
  /**
   * Calls configured off. Counted ONLY while the area is not off: with the area
   * off every switchable call inherits `enabled: false`, and the area chip is
   * already the card's one "off" statement (RC-4, RC-6).
   */
  offCalls: number;
}

export function areaOffSummary(area: AreaOffInput): AreaOffSummary {
  const areaShowsOff = area.switchable && !area.configuredEnabled;
  const offCalls = areaShowsOff ? 0 : area.calls.filter((call) => !call.resolved.enabled).length;
  return { areaShowsOff, offCalls };
}
