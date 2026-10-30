interface PluginIconProps {
  pluginId: string;
  className?: string;
  alt?: string;
}

/**
 * Where a plugin's mark lives, for the plugins whose file is not named after
 * their id.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `business-os` is the platform itself, not a third party.
 *
 * It is a real plugin with real actions — it is the channel between an agent
 * and the business's own records — but it has no vendor and so no vendor logo,
 * and `business-os-plugin-v2.svg` has never existed. Asking for it got the
 * `onError` path: a hidden image and a console warning on every agent row that
 * touches the business's own data, which is most of them.
 *
 * The app's own favicon is the honest mark for "us". An owner reading a list of
 * agents sees a Gmail logo for the mailbox it reads and our mark for the part
 * that writes to their records, which is exactly the distinction worth drawing.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const ICON_PATHS: Record<string, string> = {
  /* Gmail's file predates the `-plugin-v2` convention. */
  'google-mail': '/plugins/gmail-icon.svg',
  /* Served from `app/favicon.ico` by the App Router. */
  'business-os': '/favicon.ico',
};

export const PluginIcon = ({ pluginId, className = "w-8 h-8", alt }: PluginIconProps) => {
  const iconPath = ICON_PATHS[pluginId] ?? `/plugins/${pluginId}-plugin-v2.svg`;

  return (
    <img
      src={iconPath}
      // `??`, not `||`: callers that pass alt="" mean the icon is decorative
      // because a label sits beside it. With `||` the empty string fell through
      // to the plugin id, so "facebook פייסבוק" was read out and copied.
      alt={alt ?? pluginId}
      className={className}
      style={{
        objectFit: 'contain',
        maxWidth: '100%',
        maxHeight: '100%'
      }}
      onError={(e) => {
        // Fallback if image fails to load - hide the image
        const target = e.target as HTMLImageElement;
        target.style.display = 'none';
        console.warn(`Failed to load plugin icon: ${pluginId}`);
      }}
    />
  );
};
