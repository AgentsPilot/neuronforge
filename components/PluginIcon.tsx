interface PluginIconProps {
  pluginId: string;
  className?: string;
  alt?: string;
}

export const PluginIcon = ({ pluginId, className = "w-8 h-8", alt }: PluginIconProps) => {
  // Special case for Gmail - uses different naming convention
  const iconPath = pluginId === 'google-mail'
    ? '/plugins/gmail-icon.svg'
    : `/plugins/${pluginId}-plugin-v2.svg`;

  return (
    <img
      src={iconPath}
      alt={alt || pluginId}
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
