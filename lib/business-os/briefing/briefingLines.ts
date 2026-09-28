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
    /*
     * A LIST MARKER, not any leading number.
     *
     * This was `[-•*\d.]+`, a character class containing `\d` — so it ate the
     * digits off ANY line that began with one. A real briefing read
     * "1 מהן כבר הסתיימו." in the database and reached the owner as
     * "מהן כבר הסתיימו." — "of them are already done", with no count. The same
     * line feeds the dashboard card, so it was wrong in both places.
     *
     * A marker is a bullet, or digits followed by `.` or `)` and a space. A
     * sentence that opens with a figure — "2 invoices are overdue" — has the
     * digits followed by a space and nothing else, and must survive: the whole
     * point of the line is the number.
     */
    .map(line => line.replace(/^\s*(?:[-•*]+\s*|\d+[.)]\s+)/, '').trim())
    .filter(Boolean);
}
