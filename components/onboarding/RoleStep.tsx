'use client';

import React from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/components/UserProvider';
import { UserRole } from './hooks/useOnboarding';

interface RoleStepProps {
  data: UserRole;
  onChange: (role: UserRole) => void;
}

interface RoleOption {
  value: UserRole;
  title: string;
  description: string;
  permissions: string[];
  icon: string;
  recommended?: boolean;
}

const RoleStep: React.FC<RoleStepProps> = ({ data, onChange }) => {
  const { user } = useAuth();
  const [isUpdating, setIsUpdating] = React.useState(false);

  const roleOptions: RoleOption[] = [
    {
      value: 'admin',
      title: 'Administrator',
      description: 'Full platform access with management capabilities',
      recommended: true,
      icon: '🔑',
      permissions: [
        'Manage all users and roles',
        'Access all data and analytics',
        'Configure integrations and plugins',
        'Manage billing and subscriptions',
      ],
    },
    {
      value: 'user',
      title: 'User',
      description: 'Standard access for everyday workflow management',
      icon: '👤',
      permissions: [
        'Access personal dashboard',
        'Create and manage workflows',
        'Connect personal integrations',
        'Collaborate with team members',
      ],
    },
    {
      value: 'viewer',
      title: 'Viewer',
      description: 'Read-only access for monitoring and reporting',
      icon: '👁️',
      permissions: [
        'View dashboards and reports',
        'Monitor workflow progress',
        'Export data and insights',
        'Receive notifications',
      ],
    },
  ];

  const handleRoleChange = async (selectedRole: UserRole) => {
    if (!user?.id) {
      console.error('No user ID available');
      return;
    }

    setIsUpdating(true);
    
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ 
          role: selectedRole,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id);

      if (error) {
        console.error('Error updating role in database:', error);
      }
      
      onChange(selectedRole);
      
    } catch (error) {
      console.error('Unexpected error updating role:', error);
      onChange(selectedRole);
    } finally {
      setIsUpdating(false);
    }
  };

  const selectedRole = roleOptions.find(r => r.value === data);

  return (
    <div className="space-y-5">
      <div className="text-center">
        <p className="text-gray-300 text-sm mb-1">
          Choose your role to customize your experience
        </p>
        <p className="text-gray-500 text-xs">
          This determines your permissions and dashboard layout
        </p>
      </div>

      {/* Role Badge Selection */}
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2 justify-center">
          {roleOptions.map((role) => (
            <button
              key={role.value}
              onClick={() => handleRoleChange(role.value)}
              disabled={isUpdating}
              className={`group relative px-4 py-2.5 border rounded-lg text-sm font-medium transition-all duration-200 hover:scale-105 ${
                data === role.value
                  ? 'bg-blue-500/20 border-blue-400/50 text-blue-300 ring-2 ring-blue-400/30'
                  : 'bg-gray-700/50 border-gray-600/30 text-gray-300 hover:bg-blue-500/10 hover:border-blue-500/30 hover:text-blue-300'
              } ${isUpdating ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className="flex items-center space-x-2">
                <span className="text-base">{role.icon}</span>
                <span>{role.title}</span>
                {role.recommended && (
                  <div className="w-1.5 h-1.5 bg-purple-400 rounded-full"></div>
                )}
                {data === role.value && !isUpdating && (
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
                )}
                {isUpdating && data === role.value && (
                  <div className="w-3 h-3 border-2 border-blue-300 border-t-transparent rounded-full animate-spin"></div>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Selected Role Details */}
      {selectedRole && (
        <div className="mt-5 p-4 bg-blue-500/10 border border-blue-500/30 rounded-xl">
          <div className="flex items-start space-x-3">
            <div className="text-2xl">{selectedRole.icon}</div>
            <div className="flex-1">
              <div className="flex items-center space-x-2 mb-2">
                <h4 className="font-medium text-blue-200">
                  {selectedRole.title} Selected
                </h4>
                {selectedRole.recommended && (
                  <span className="px-2 py-0.5 bg-purple-500/20 border border-purple-400/30 rounded-full text-xs text-purple-300">
                    Recommended
                  </span>
                )}
                <div className="w-1.5 h-1.5 bg-green-400 rounded-full"></div>
              </div>
              <p className="text-sm text-blue-300/80 mb-3">
                {selectedRole.description}
              </p>
              
              {/* Permissions as compact badges */}
              <div className="space-y-2">
                <div className="text-xs font-medium text-blue-200">
                  Key permissions:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {selectedRole.permissions.map((permission, index) => (
                    <span
                      key={index}
                      className="inline-flex items-center px-2 py-1 bg-blue-500/20 border border-blue-400/30 rounded-md text-xs text-blue-300"
                    >
                      <svg className="w-2.5 h-2.5 mr-1.5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      {permission}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Help Section - Compact */}
      <div className="p-3 bg-gray-800/30 border border-gray-700/50 rounded-lg">
        <div className="flex items-center space-x-2 text-xs text-gray-400">
          <svg className="w-3 h-3 text-blue-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
          <span>
            Your role can be changed later by an administrator. Choose Administrator if you're setting up for your organization.
          </span>
        </div>
      </div>

      {/* Update Status */}
      {isUpdating && (
        <div className="text-center">
          <div className="inline-flex items-center space-x-2 text-sm text-blue-400">
            <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
            <span>Updating your role...</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default RoleStep;