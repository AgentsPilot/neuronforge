/**
 * The one POST behind Settings → Plan's cancel and reactivate (plan payments
 * P-7a.1; moved out of `PlanManage.tsx` by D3 / SX-2 so the Cancel drawer and
 * `PlanManage` share it rather than copy it).
 *
 * The caller names the body: Reactivate posts `{}` (C-5), the Cancel drawer
 * posts `{ reasonCode }` (D3; the route takes the code as optional, SA Q-1).
 * The routes take the account from the session only. A body that is not JSON
 * reads as `null`; the caller maps the answer.
 *
 * Client-safe: no import.
 */

export interface PlanManageAnswer {
  status: number;
  body: Record<string, unknown> | null;
}

export async function postPlanManage(path: string, payload: Record<string, unknown>): Promise<PlanManageAnswer> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let body: Record<string, unknown> | null = null;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }
  return { status: response.status, body };
}
