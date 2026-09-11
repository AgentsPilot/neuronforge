/**
 * The accent the configuration dialog paints itself with.
 *
 * It lives in its own module rather than in `ConfigurationDialog` because the
 * dialog imports the section components, so a section importing the colour back
 * out of the dialog would close a cycle.
 *
 * `configAccentButton` is the dialog's save-button treatment — outlined and
 * faintly tinted, not filled. Availability, services and payments all use it,
 * so a filled button in one tab reads as a different product.
 */
export const CONFIG_ACCENT = '#D14E97';

/** Inline style for a save button inside the configuration dialog. */
export const configAccentButton = {
  borderRadius: 'var(--v2-radius-button)',
  color: CONFIG_ACCENT,
  borderColor: CONFIG_ACCENT,
  backgroundColor: `${CONFIG_ACCENT}10`,
} as const;
