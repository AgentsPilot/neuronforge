interface PluginIconProps {
  pluginId: string;
  className?: string;
  alt?: string;
}

export const PluginIcon = ({ pluginId, className = "w-8 h-8", alt }: PluginIconProps) => {
  return (
    <img
      src={`/plugins/${pluginId}-plugin-v2.svg`}
      alt={alt || pluginId}
      className={className}
      width="32"
      height="32"
    />
  );
};
