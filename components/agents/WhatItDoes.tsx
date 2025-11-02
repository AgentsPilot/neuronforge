// components/agents/WhatItDoes.tsx
'use client';

import React from 'react';
import { Mail, MessageSquare, Database, Calendar, FileText, Plug } from 'lucide-react';

interface ConnectedService {
  name: string;
  type: 'email' | 'messaging' | 'database' | 'calendar' | 'files' | 'other';
}

interface WhatItDoesProps {
  description: string;
  connectedServices?: ConnectedService[];
}

const serviceIcons = {
  email: { icon: Mail, emoji: '📧' },
  messaging: { icon: MessageSquare, emoji: '💬' },
  database: { icon: Database, emoji: '🗄️' },
  calendar: { icon: Calendar, emoji: '📅' },
  files: { icon: FileText, emoji: '📄' },
  other: { icon: Plug, emoji: '🔌' }
};

export default function WhatItDoes({ description, connectedServices = [] }: WhatItDoesProps) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">What It Does</h3>

      <p className="text-gray-800 text-base leading-relaxed mb-4">
        {description || 'This agent performs automated tasks based on your configuration.'}
      </p>

      {connectedServices.length > 0 && (
        <div className="pt-3 border-t border-gray-100">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-gray-600">Connected:</span>
            {connectedServices.map((service, index) => {
              const config = serviceIcons[service.type] || serviceIcons.other;
              return (
                <div
                  key={index}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-gray-50 border border-gray-200 text-xs font-medium text-gray-700"
                >
                  <span>{config.emoji}</span>
                  <span>{service.name}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
