// components/ScheduledAgentsCard.tsx
import React from 'react'

const ScheduledAgentsCard = () => (
  <div className="bg-white dark:bg-zinc-900 shadow rounded-xl p-4 mt-6">
    <h3 className="text-lg font-semibold mb-2">⏰ Scheduled Agents</h3>
    <p className="text-sm text-zinc-500 mb-4">Scheduled agents will run at specific times or intervals.</p>
    <div className="border border-dashed border-zinc-300 dark:border-zinc-700 p-6 rounded-lg text-center">
      <p className="text-zinc-400 italic">No scheduled agents yet.</p>
      <button
        className="mt-4 px-4 py-2 bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-100 rounded"
        disabled
      >
        Create Schedule (Coming Soon)
      </button>
    </div>
  </div>
)

export default ScheduledAgentsCard