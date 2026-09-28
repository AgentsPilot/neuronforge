/**
 * Display helpers shared by the Archiving page and its confirm dialog.
 * Pure functions, no imports, safe in the browser.
 */

/** `2025-09-26 14:05 UTC`. Always UTC: a cutoff is a UTC instant (FR-3). */
export function formatUtc(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}
