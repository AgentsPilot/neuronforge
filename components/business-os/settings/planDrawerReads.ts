/**
 * The one read the "Your plan" drawer opens with (settings drawer review §0.6
 * C-2, C-1 folded in; C-b workplan A-1; SA-CB-2).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE COPY OF THE REQUEST
 *
 * `PlanSection` reads `my-plan` when it opens, and again after a checkout or an
 * upgrade. The settings page may start the first read earlier (idle, hover,
 * focus, press) through `useDrawerPrefetch`, and the section then takes it
 * instead of asking again. Every one of those reads goes through `readMyPlan`,
 * so the early read and the section's own reads are the same request and
 * cannot drift. The page imports `startPlanDrawerRead` only, so it never names
 * a route (`accountCard.guard`, B-4).
 *
 * NO LANGUAGE ON THE REQUEST, DELIBERATELY (B-3).
 *
 * Plan and feature NAMES are config data and are resolved server-side, from
 * the reader's own stored preference, not from anything sent here. That
 * route's guard protects the property that there is nothing to read in a
 * request, so no `?accountId=` can ever be honoured; a `?lang=` would be the
 * first crack in it. The language on a `PlanDrawerRead` is a label for the
 * page's key and the section's same-language check, never sent.
 *
 * THE READ NEVER REJECTS. A failure is an answer that says how it failed:
 * `threw` with the error (a network error, or a body that is not JSON). An
 * HTTP error is NOT a throw: like the section's read always has, a 401 or a
 * 500 carries `{ success: false }`, which the section judges as "no plan". So
 * this reads only `json()` and `status`, never `ok` (SA-CB-2). Nothing here
 * logs; the section logs exactly as it always has.
 *
 * THE ROUTE'S LOG. Since C-b the route's "Customer plan read" `info` line also
 * fires on an idle or hover warm, so it no longer means "the owner opened the
 * plan". Do not build anything on it meaning that.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** One `my-plan` read. Never rejects: a failure says how it failed. */
export type PlanRead =
  | { kind: 'answered'; status: number; body: unknown }
  | { kind: 'threw'; err: unknown };

/** A read started for the page's language (B-3: the language is NOT sent). */
export interface PlanDrawerRead {
  language: string;
  plan: Promise<PlanRead>;
}

/**
 * The `my-plan` GET, exactly as the section has always sent it: the URL alone,
 * no `init`, no query string. One `try` covers the request and the body, so a
 * synchronous `fetch` throw is a `threw` too. The body is returned unjudged.
 */
export async function readMyPlan(): Promise<PlanRead> {
  try {
    const response = await fetch('/api/business-os/entitlements/my-plan');
    const body: unknown = await response.json();
    return { kind: 'answered', status: response.status, body };
  } catch (err) {
    return { kind: 'threw', err };
  }
}

/** Starts the read now (synchronously) and hands back its promise, labelled with the language. */
export function startPlanDrawerRead(language: string): PlanDrawerRead {
  return { language, plan: readMyPlan() };
}
