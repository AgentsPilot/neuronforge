// components/wizard/Step4_5_Mode.js

import React from "react";

const Step4_5_Mode = ({ data, onUpdate }) => {
  const { mode = "on_demand", schedule_cron = "", trigger_conditions = "" } = data;

  const update = (field, value) => {
    onUpdate({ [field]: value });
  };
  
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Execution Mode</h2>

      <div className="grid grid-cols-3 gap-4">
        {[
          { key: "on_demand", label: "On-Demand", description: "Run manually anytime" },
          { key: "scheduled", label: "Scheduled", description: "Run automatically at a set time" },
          { key: "triggered", label: "Triggered", description: "Run when a specific event occurs" },
        ].map((m) => (
          <div
            key={m.key}
            onClick={() => update("mode", m.key)}
            className={`p-4 rounded-xl border shadow-sm cursor-pointer ${
              mode === m.key ? "border-blue-500 bg-blue-50" : "border-gray-300"
            }`}
          >
            <h3 className="font-medium">{m.label}</h3>
            <p className="text-sm text-gray-500">{m.description}</p>
          </div>
        ))}
      </div>

      {mode === "scheduled" && (
        <div>
          <label className="block text-sm font-medium">Cron Schedule</label>
          <input
            type="text"
            value={schedule_cron}
            onChange={(e) => update("schedule_cron", e.target.value)}
            className="mt-1 p-2 w-full border rounded"
            placeholder="e.g. 0 9 * * * (every day at 9am)"
          />
        </div>
      )}

      {mode === "triggered" && (
        <div>
          <label className="block text-sm font-medium">Trigger Conditions (JSON)</label>
          <textarea
            rows={4}
            value={trigger_conditions}
            onChange={(e) => update("trigger_conditions", e.target.value)}
            className="mt-1 p-2 w-full border rounded"
            placeholder='e.g. {"source": "gmail", "subject_contains": "urgent"}'
          />
        </div>
      )}
    </div>
  );
};

export default Step4_5_Mode;