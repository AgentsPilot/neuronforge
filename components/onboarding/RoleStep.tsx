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
  icon: JSX.Element;
}

const RoleStep: React.FC<RoleStepProps> = ({ data, onChange }) => {
  const { user } = useAuth();
  const [isUpdating, setIsUpdating] = React.useState(false);

  const roleOptions: RoleOption[] = [
    {
      value: 'admin',
      title: 'Administrator',
      description: 'Full access to all features and settings',
      permissions: [
        'Manage all users and roles',
        'Access all data and analytics',
        'Configure integrations and plugins',
        'Manage billing and subscriptions',
      ],
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      ),
    },
    {
      value: 'user',
      title: 'User',
      description: 'Standard access for day-to-day work',
      permissions: [
        'Access personal dashboard',
        'View assigned projects',
        'Connect personal integrations',
        'Collaborate with team members',
      ],
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      ),
    },
    {
      value: 'viewer',
      title: 'Viewer',
      description: 'Read-only access for monitoring and reporting',
      permissions: [
        'View dashboards and reports',
        'Monitor project progress',
        'Export data and reports',
        'Receive notifications',
      ],
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
      ),
    },
  ];

  const handleRoleChange = async (selectedRole: UserRole) => {
    if (!user?.id) {
      console.error('No user ID available');
      return;
    }

    console.log('=== Role Selection Debug ===');
    console.log('Selected role:', selectedRole);
    console.log('Current data.role:', data);
    console.log('User ID:', user.id);
    
    setIsUpdating(true);
    
    try {
      // Update role in profiles table immediately
      const { data: updateData, error } = await supabase
        .from('profiles')
        .update({ 
          role: selectedRole, // Make sure we're using the selectedRole parameter
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id)
        .select('role');

      console.log('Database update payload:', { role: selectedRole });
      console.log('Database update result:', { updateData, error });

      if (error) {
        console.error('Error updating role in database:', error);
        // Still update local state even if database fails
        onChange(selectedRole);
        return;
      }

      console.log('Role successfully updated in database to:', updateData?.[0]?.role);
      
      // Update local state after successful database update
      onChange(selectedRole);
      
    } catch (error) {
      console.error('Unexpected error updating role:', error);
      // Still update local state as fallback
      onChange(selectedRole);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <p className="text-sm text-slate-600">
          Choose your role to customize your experience
        </p>
        <p className="text-xs text-slate-500 mt-1">
          This determines your permissions and what you can access
        </p>
      </div>

      {/* Role Options */}
      <div className="space-y-3">
        {roleOptions.map((role) => (
          <div key={role.value} className="relative">
            <input
              id={role.value}
              name="role"
              type="radio"
              value={role.value}
              checked={data === role.value}
              onChange={() => handleRoleChange(role.value)}
              disabled={isUpdating}
              className="sr-only"
            />
            <label
              htmlFor={role.value}
              className={`relative rounded-xl border p-4 cursor-pointer focus:outline-none transition-all duration-200 flex ${
                data === role.value
                  ? 'border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 shadow-md ring-1 ring-blue-200'
                  : 'border-slate-200 bg-white/50 hover:border-slate-300 hover:bg-white/80'
              } ${isUpdating ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className="flex items-start space-x-4 w-full">
                {/* Role Icon */}
                <div className={`flex-shrink-0 transition-colors duration-200 ${
                  data === role.value ? 'text-blue-600' : 'text-slate-400'
                }`}>
                  {role.icon}
                </div>

                {/* Role Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h3 className={`text-base font-semibold transition-colors duration-200 ${
                      data === role.value ? 'text-blue-900' : 'text-slate-900'
                    }`}>
                      {role.title}
                      {role.value === 'admin' && (
                        <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                          Recommended
                        </span>
                      )}
                    </h3>
                    
                    {/* Radio Button Visual */}
                    <div className={`relative h-5 w-5 rounded-full border-2 flex items-center justify-center transition-all duration-200 ${
                      data === role.value
                        ? 'border-blue-600 bg-blue-600 scale-110'
                        : 'border-slate-300 hover:border-slate-400'
                    }`}>
                      {data === role.value && !isUpdating && (
                        <div className="h-2 w-2 rounded-full bg-white" />
                      )}
                      {isUpdating && data === role.value && (
                        <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      )}
                    </div>
                  </div>

                  <p className={`text-sm mt-1 transition-colors duration-200 ${
                    data === role.value ? 'text-blue-700' : 'text-slate-500'
                  }`}>
                    {role.description}
                  </p>

                  {/* Permissions */}
                  <ul className={`text-xs mt-3 space-y-1 transition-colors duration-200 ${
                    data === role.value ? 'text-blue-600' : 'text-slate-500'
                  }`}>
                    {role.permissions.map((permission, index) => (
                      <li key={index} className="flex items-start">
                        <svg 
                          className="w-3 h-3 mr-2 mt-0.5 flex-shrink-0" 
                          fill="currentColor" 
                          viewBox="0 0 20 20"
                        >
                          <path 
                            fillRule="evenodd" 
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" 
                            clipRule="evenodd" 
                          />
                        </svg>
                        {permission}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </label>
          </div>
        ))}
      </div>

      {/* Help Text */}
      <div className="bg-gradient-to-r from-slate-50 to-blue-50 rounded-xl p-4 border border-slate-200">
        <div className="flex">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-semibold text-slate-800">
              Need help choosing?
            </h3>
            <div className="mt-1 text-sm text-slate-600">
              <p>Your role can be changed later by an administrator. If you're setting up the account for your organization, choose Administrator.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Update Status */}
      {isUpdating && (
        <div className="text-center">
          <div className="inline-flex items-center space-x-2 text-sm text-blue-600">
            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            <span>Updating your role...</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default RoleStep;