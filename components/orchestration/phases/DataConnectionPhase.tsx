import React, { useState, useCallback, useEffect } from 'react';
import { Database, Server, Cloud, HardDrive, Wifi, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

interface DataSource {
  id: string;
  name: string;
  type: 'database' | 'api' | 'file' | 'cloud';
  icon: React.ComponentType<any>;
  connected: boolean;
  lastSync?: Date;
  status: 'connected' | 'disconnected' | 'error' | 'syncing';
}

interface DataConnectionPhaseProps {
  onComplete: (connections: DataSource[]) => void;
  onBack?: () => void;
  initialConnections?: DataSource[];
}

const DataConnectionPhase: React.FC<DataConnectionPhaseProps> = ({
  onComplete,
  onBack,
  initialConnections = []
}) => {
  const [dataSources, setDataSources] = useState<DataSource[]>([
    {
      id: 'postgres-main',
      name: 'PostgreSQL Database',
      type: 'database',
      icon: Database,
      connected: false,
      status: 'disconnected'
    },
    {
      id: 'rest-api',
      name: 'REST API Endpoint',
      type: 'api',
      icon: Server,
      connected: false,
      status: 'disconnected'
    },
    {
      id: 'aws-s3',
      name: 'AWS S3 Bucket',
      type: 'cloud',
      icon: Cloud,
      connected: false,
      status: 'disconnected'
    },
    {
      id: 'local-files',
      name: 'Local File System',
      type: 'file',
      icon: HardDrive,
      connected: false,
      status: 'disconnected'
    }
  ]);

  const [isConnecting, setIsConnecting] = useState<string | null>(null);
  const [connectionErrors, setConnectionErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    // Initialize with any existing connections
    if (initialConnections.length > 0) {
      setDataSources(prevSources => 
        prevSources.map(source => {
          const existing = initialConnections.find(conn => conn.id === source.id);
          return existing ? { ...source, ...existing } : source;
        })
      );
    }
  }, [initialConnections]);

  const handleConnect = useCallback(async (sourceId: string) => {
    setIsConnecting(sourceId);
    setConnectionErrors(prev => ({ ...prev, [sourceId]: '' }));

    // Update status to syncing
    setDataSources(prev => 
      prev.map(source => 
        source.id === sourceId 
          ? { ...source, status: 'syncing' }
          : source
      )
    );

    try {
      // Simulate connection attempt
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Randomly simulate success or failure for demo
      const isSuccess = Math.random() > 0.2;
      
      if (isSuccess) {
        setDataSources(prev => 
          prev.map(source => 
            source.id === sourceId 
              ? { 
                  ...source, 
                  connected: true, 
                  status: 'connected',
                  lastSync: new Date() 
                }
              : source
          )
        );
      } else {
        throw new Error('Connection failed. Please check your credentials.');
      }
    } catch (error) {
      setConnectionErrors(prev => ({
        ...prev,
        [sourceId]: error instanceof Error ? error.message : 'Connection failed'
      }));
      
      setDataSources(prev => 
        prev.map(source => 
          source.id === sourceId 
            ? { ...source, status: 'error' }
            : source
        )
      );
    } finally {
      setIsConnecting(null);
    }
  }, []);

  const handleDisconnect = useCallback((sourceId: string) => {
    setDataSources(prev => 
      prev.map(source => 
        source.id === sourceId 
          ? { 
              ...source, 
              connected: false, 
              status: 'disconnected',
              lastSync: undefined 
            }
          : source
      )
    );
    setConnectionErrors(prev => ({ ...prev, [sourceId]: '' }));
  }, []);

  const getStatusIcon = (status: DataSource['status']) => {
    switch (status) {
      case 'connected':
        return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case 'error':
        return <AlertCircle className="w-5 h-5 text-red-500" />;
      case 'syncing':
        return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
      default:
        return <Wifi className="w-5 h-5 text-gray-400" />;
    }
  };

  const connectedSources = dataSources.filter(source => source.connected);
  const canProceed = connectedSources.length > 0;

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-8">
        <h2 className="text-3xl font-bold text-gray-900 mb-2">Connect Your Data Sources</h2>
        <p className="text-lg text-gray-600">
          Select and configure the data sources you want to connect to your application.
        </p>
      </div>

      <div className="grid gap-4 mb-8">
        {dataSources.map((source) => {
          const Icon = source.icon;
          const error = connectionErrors[source.id];
          
          return (
            <div
              key={source.id}
              className={`border rounded-lg p-6 transition-all ${
                source.connected 
                  ? 'border-green-500 bg-green-50' 
                  : error 
                    ? 'border-red-500 bg-red-50'
                    : 'border-gray-300 bg-white hover:border-gray-400'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <div className={`p-3 rounded-lg ${
                    source.connected 
                      ? 'bg-green-100' 
                      : error
                        ? 'bg-red-100'
                        : 'bg-gray-100'
                  }`}>
                    <Icon className={`w-6 h-6 ${
                      source.connected 
                        ? 'text-green-600' 
                        : error
                          ? 'text-red-600'
                          : 'text-gray-600'
                    }`} />
                  </div>
                  
                  <div>
                    <h3 className="font-semibold text-gray-900">{source.name}</h3>
                    <p className="text-sm text-gray-500">
                      Type: {source.type.charAt(0).toUpperCase() + source.type.slice(1)}
                    </p>
                    {source.lastSync && (
                      <p className="text-xs text-gray-400 mt-1">
                        Last synced: {source.lastSync.toLocaleTimeString()}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center space-x-3">
                  {getStatusIcon(source.status)}
                  
                  {source.connected ? (
                    <button
                      onClick={() => handleDisconnect(source.id)}
                      className="px-4 py-2 text-sm font-medium text-red-600 bg-white border border-red-300 rounded-md hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                    >
                      Disconnect
                    </button>
                  ) : (
                    <button
                      onClick={() => handleConnect(source.id)}
                      disabled={isConnecting === source.id}
                      className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isConnecting === source.id ? 'Connecting...' : 'Connect'}
                    </button>
                  )}
                </div>
              </div>
              
              {error && (
                <div className="mt-3 p-3 bg-red-100 border border-red-200 rounded-md">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="bg-gray-50 p-4 rounded-lg mb-6">
        <h4 className="font-medium text-gray-900 mb-2">Connection Summary</h4>
        <p className="text-sm text-gray-600">
          {connectedSources.length} of {dataSources.length} data sources connected
        </p>
        {connectedSources.length > 0 && (
          <ul className="mt-2 space-y-1">
            {connectedSources.map(source => (
              <li key={source.id} className="text-sm text-gray-600 flex items-center">
                <CheckCircle2 className="w-4 h-4 text-green-500 mr-2" />
                {source.name}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex justify-between">
        {onBack && (
          <button
            onClick={onBack}
            className="px-6 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Back
          </button>
        )}
        
        <button
          onClick={() => onComplete(connectedSources)}
          disabled={!canProceed}
          className={`px-6 py-2 text-sm font-medium text-white rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${
            canProceed
              ? 'bg-blue-600 hover:bg-blue-700'
              : 'bg-gray-300 cursor-not-allowed'
          }`}
        >
          Continue with {connectedSources.length} connection{connectedSources.length !== 1 ? 's' : ''}
        </button>
      </div>
    </div>
  );
};

export default DataConnectionPhase;