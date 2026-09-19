/**
 * Split a briefing narration into the lines the card renders.
 *
 * Kept in its own dependency-free module because the browser dashboard
 * (`components/business-os/insight/LiveDashboard.tsx`) needs it. Importing it
 * from `BriefingNarrator.ts` pulled the whole server-side AI provider layer
 * (including `node:async_hooks`) into the client bundle and broke the build.
 * Do not add imports here.
 */
export function briefingLines(narrative: string): string[] {
  return narrative
    .split('\n')
    .map(line => line.replace(/^\s*[-•*\d.]+\s*/, '').trim())
    .filter(Boolean);
}
