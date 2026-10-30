/**
 * Words of the admin "Data export" box of the Businesses drawer (data export
 * DE-10a; export redesign MX-3.1, workplan §8). English only, like the rest
 * of the admin console. Pure: no React, no I/O.
 *
 * MX-3.1 (BQ-E6.1-1, 2026-10-27): the admin ZIP is gone, so the box shows one
 * line until MX-5 brings "Send export to owner".
 */

export const DATA_EXPORT_COPY = {
  title: 'Data export',
  placeholder: "Admin export is coming back as 'Send export to owner'.",
} as const;
