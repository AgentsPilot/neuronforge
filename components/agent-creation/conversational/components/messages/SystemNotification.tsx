import React from 'react';
import { CheckCircle } from 'lucide-react';

interface SystemNotificationProps {
  content: string;
}

export default function SystemNotification({ content }: SystemNotificationProps) {
  return (
    <div className="inline-flex items-center gap-2 bg-gradient-to-r from-emerald-500/20 to-green-500/20 text-emerald-700 px-4 py-2 rounded-lg text-xs font-medium border border-emerald-200/50 backdrop-blur-sm shadow-sm">
      <div className="w-4 h-4 bg-emerald-500 rounded-full flex items-center justify-center">
        <CheckCircle className="h-2.5 w-2.5 text-white" />
      </div>
      {content}
    </div>
  );
}
