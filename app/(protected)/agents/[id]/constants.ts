// constants.ts
// UI strings and configuration for agent details page

export const UI_STRINGS = {
  // Loading states
  LOADING_AGENT: 'Loading your assistant...',

  // Error states
  AGENT_NOT_FOUND: 'Assistant Not Found',
  AGENT_NO_ACCESS: "This assistant doesn't exist or you don't have access to it.",
  BACK_TO_ASSISTANTS: 'Back to Assistants',

  // Section titles
  WHAT_THIS_AGENT_DOES: 'What This Agent Does',
  PLUGINS: 'Plugins',
  PLUGIN_REQUIREMENTS: 'Plugin Requirements',
  CURRENT_STATUS: 'Current Status',
  AGENT_ID: 'Agent ID',
  SCHEDULE: 'Schedule',
  CREATED: 'Created',
  PERFORMANCE: 'Performance',
  AIS_COMPLEXITY: 'AIS Complexity',
  TEST_PLAYGROUND: 'Test Playground',
  RECENT_ACTIVITY: 'Recent Activity',

  // Performance metrics
  RUNS: 'Runs',
  SUCCESS: 'Success',
  SPEED: 'Speed',
  PILOT_CREDITS: 'Pilot Credits',
  TOTAL_PILOT_CREDITS: 'Total Pilot Credits',
  EXECUTION_DURATION_TREND: 'Execution Duration Trend',
  LAST_EXECUTIONS: 'Last {count}',

  // Actions
  COPY_ID: 'Copy ID',
  EDIT: 'Edit',
  DUPLICATE: 'Duplicate',
  EXPORT: 'Export',
  SHARE: 'Share',
  DELETE: 'Delete',
  PAUSE: 'Pause',
  ACTIVATE: 'Activate',
  LAUNCH: 'Launch',
  TEST: 'Test',
  VIEW_LOGS: 'View Logs',
  DOWNLOAD: 'Download',

  // Status
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  PAUSED: 'Paused',
  ERROR: 'Error',

  // Plugin status
  CONNECTED: 'Connected',
  NOT_CONNECTED: 'Not Connected',
  REQUIRED: 'Required',

  // Sharing
  SHARING_REWARD: 'Sharing Reward',
  EARN_CREDITS: 'Earn {amount} credits when someone uses your shared agent',
  SHARE_THIS_AGENT: 'Share This Agent',
  COPY_SHARE_LINK: 'Copy Share Link',

  // Modals
  CONFIRM_DELETE: 'Confirm Delete',
  DELETE_WARNING: 'Are you sure you want to delete this agent? This action cannot be undone.',
  CONFIRM_PAUSE: 'Confirm Pause',
  PAUSE_WARNING: 'Are you sure you want to pause this agent? It will stop processing scheduled tasks.',
  CANCEL: 'Cancel',
  CONFIRM: 'Confirm',

  // Notifications
  COPIED_TO_CLIPBOARD: 'Copied to clipboard!',
  AGENT_DELETED: 'Agent deleted successfully',
  AGENT_PAUSED: 'Agent paused successfully',
  AGENT_ACTIVATED: 'Agent activated successfully',
  SHARE_LINK_COPIED: 'Share link copied! Earn {amount} credits per use.',

  // Time formats
  JUST_NOW: 'Just now',
  MINUTES_AGO: '{count}m ago',
  HOURS_AGO: '{count}h ago',
  DAYS_AGO: '{count}d ago',
} as const;

export const DEFAULT_VALUES = {
  SHARING_REWARD_AMOUNT: 500,
  PERFORMANCE_GRAPH_LIMIT: 10,
  NOTIFICATION_DURATION: 3000, // 3 seconds
} as const;
