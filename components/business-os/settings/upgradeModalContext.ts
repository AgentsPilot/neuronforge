/**
 * Why the plan comparison window was opened (upgrade modal UM-2, workplan §4.1;
 * UM-SA5 / C-4).
 *
 * This union is the ONLY thing a caller of `useUpgradeModal().openUpgradeModal`
 * may pass. No plan name, no price, no offer and no callback: the window reads
 * the plan itself (UM-SA1), so a caller cannot put a claim on screen that the
 * server did not make. `planId` is the id a server refusal named; the window
 * joins it against the payload and falls back to the `settings` copy when it
 * cannot (workplan §6.2). It is never sent to a server.
 *
 * Pinned by `upgradeModal.guard` (r): exactly these three members.
 */
export type UpgradeModalContext =
  | { kind: 'settings' }
  | { kind: 'locked_feature'; planId: string }
  | { kind: 'founding_partner' };

/** The context Settings opens with, and the default everywhere a context is optional. */
export const SETTINGS_CONTEXT: UpgradeModalContext = { kind: 'settings' };
