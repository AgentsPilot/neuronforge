import { 
  AlertTriangle,
  FileText,
  Grid3X3,
  List
} from 'lucide-react';

export const systemOutputs = {
  'dashboard-alert': { 
    name: 'Dashboard Alert Feed', 
    category: 'system', 
    icon: <AlertTriangle className="w-5 h-5 text-amber-600" />,
    pluginKey: 'dashboard-alert',
    description: 'Display alerts on dashboard'
  },
  'pdf-report': { 
    name: 'PDF Report Download', 
    category: 'system', 
    icon: <FileText className="w-5 h-5 text-red-600" />,
    pluginKey: 'pdf-report',
    description: 'Generate downloadable PDF reports'
  },
  'summary-block': { 
    name: 'Dashboard Summary Widget', 
    category: 'system', 
    icon: <Grid3X3 className="w-5 h-5 text-blue-600" />,
    pluginKey: 'summary-block',
    description: 'Show summary widgets on dashboard'
  },
  'agent-log': { 
    name: 'Agent Execution Log', 
    category: 'system', 
    icon: <List className="w-5 h-5 text-gray-600" />,
    pluginKey: 'agent-log',
    description: 'Log agent execution details'
  }
};