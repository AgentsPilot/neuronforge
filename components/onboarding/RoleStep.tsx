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

  const getIconSvg = (iconType: string) => {
    switch(iconType) {
      case 'admin':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        );
      case 'user':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        );
      case 'viewer':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        );
      default:
        return null;
    }
  };

  const roleOptions: RoleOption[] = [
    {
      value: 'admin',
      title: 'Administrator',
      description: 'Full platform access with management capabilities',
      recommended: true,
      icon: 'admin',
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
      icon: 'user',
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
      icon: 'viewer',
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
              className={`group relative px-4 py-2.5 border rounded-xl text-sm font-medium transition-all duration-200 hover:scale-105 ${
                data === role.value
                  ? 'bg-purple-500/20 border-purple-400/50 text-purple-300 ring-2 ring-purple-400/30 shadow-lg shadow-purple-500/25'
                  : 'bg-white/5 border-white/10 text-slate-300 hover:bg-purple-500/10 hover:border-purple-500/30 hover:text-purple-300'
              } ${isUpdating ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className="flex items-center space-x-2">
                <span className={data === role.value ? 'text-purple-400' : 'text-slate-400 group-hover:text-purple-400'}>
                  {getIconSvg(role.icon)}
                </span>
                <span>{role.title}</span>
                {role.recommended && (
                  <span className="px-1.5 py-0.5 bg-gradient-to-r from-blue-500/20 to-purple-500/20 border border-purple-400/30 rounded-full text-[10px] text-purple-300 font-semibold">
                    RECOMMENDED
                  </span>
                )}
                {data === role.value && !isUpdating && (
                  <div className="w-2 h-2 bg-purple-400 rounded-full animate-pulse"></div>
                )}
                {isUpdating && data === role.value && (
                  <div className="w-3 h-3 border-2 border-purple-300 border-t-transparent rounded-full animate-spin"></div>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Selected Role Details */}
      {selectedRole && (
        <div className="mt-5 p-5 bg-gradient-to-br from-purple-500/10 to-blue-500/10 border border-purple-500/30 rounded-xl shadow-lg">
          <div className="flex items-start space-x-4">
            <div className="w-12 h-12 bg-purple-500/20 rounded-xl flex items-center justify-center text-purple-400 shadow-lg">
              {getIconSvg(selectedRole.icon)}
            </div>
            <div className="flex-1">
              <div className="flex items-center space-x-2 mb-2">
                <h4 className="font-bold text-purple-200">
                  {selectedRole.title} Selected
                </h4>
                {selectedRole.recommended && (
                  <span className="px-2 py-0.5 bg-gradient-to-r from-blue-500/20 to-purple-500/20 border border-purple-400/30 rounded-full text-xs text-purple-300 font-semibold">
                    Recommended
                  </span>
                )}
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse shadow-lg shadow-green-400/50"></div>
              </div>
              <p className="text-sm text-slate-300 mb-3">
                {selectedRole.description}
              </p>

              {/* Permissions as compact badges */}
              <div className="space-y-2">
                <div className="text-xs font-semibold text-purple-300">
                  Key permissions:
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedRole.permissions.map((permission, index) => (
                    <span
                      key={index}
                      className="inline-flex items-center px-2.5 py-1 bg-purple-500/20 border border-purple-400/30 rounded-lg text-xs text-purple-300 font-medium"
                    >
                      <svg className="w-3 h-3 mr-1.5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
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