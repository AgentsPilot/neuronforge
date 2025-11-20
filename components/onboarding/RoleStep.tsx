'use client';

import React from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/components/UserProvider';
import { UserRole } from './hooks/useOnboarding';
import { Briefcase, Users, TrendingUp, Settings, DollarSign, Megaphone, Calculator, HelpCircle } from 'lucide-react';

interface RoleStepProps {
  data: UserRole | null;
  onChange: (role: UserRole) => void;
}

interface RoleOption {
  value: UserRole;
  title: string;
  description: string;
  icon: React.ReactNode;
}

const RoleStep: React.FC<RoleStepProps> = ({ data, onChange }) => {
  const { user } = useAuth();
  const [isUpdating, setIsUpdating] = React.useState(false);

  const roleOptions: RoleOption[] = [
    {
      value: 'business_owner',
      title: 'Business owner',
      description: 'Running or managing a business',
      icon: <Briefcase className="w-5 h-5" />
    },
    {
      value: 'manager',
      title: 'Manager',
      description: 'Leading teams or projects',
      icon: <Users className="w-5 h-5" />
    },
    {
      value: 'consultant',
      title: 'Consultant',
      description: 'Advising clients or organizations',
      icon: <TrendingUp className="w-5 h-5" />
    },
    {
      value: 'operations',
      title: 'Operations',
      description: 'Managing day-to-day workflows',
      icon: <Settings className="w-5 h-5" />
    },
    {
      value: 'sales',
      title: 'Sales',
      description: 'Driving revenue and customer relationships',
      icon: <DollarSign className="w-5 h-5" />
    },
    {
      value: 'marketing',
      title: 'Marketing',
      description: 'Growing brand and audience',
      icon: <Megaphone className="w-5 h-5" />
    },
    {
      value: 'finance',
      title: 'Finance',
      description: 'Managing budgets and financial data',
      icon: <Calculator className="w-5 h-5" />
    },
    {
      value: 'other',
      title: 'Other',
      description: "Something else entirely",
      icon: <HelpCircle className="w-5 h-5" />
    }
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

  return (
    <div className="space-y-4">
      {/* Header - Compact */}
      <div className="text-center">
        <h3 className="text-lg font-semibold text-slate-100 mb-1">
          What best describes your role?
        </h3>
        <p className="text-xs text-slate-400">
          This helps us personalize your experience
        </p>
      </div>

      {/* Role Selection - Compact Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {roleOptions.map((role) => (
          <button
            key={role.value}
            onClick={() => handleRoleChange(role.value)}
            disabled={isUpdating}
            className={`group relative p-3 border rounded-lg text-left transition-all duration-200 hover:scale-[1.02] ${
              data === role.value
                ? 'bg-purple-500/20 border-purple-400/50 ring-2 ring-purple-400/30 shadow-lg shadow-purple-500/20'
                : 'bg-white/5 border-white/10 hover:bg-purple-500/5 hover:border-purple-500/20'
            } ${isUpdating ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <div className="flex flex-col items-center text-center gap-2">
              {/* Icon */}
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                data === role.value
                  ? 'bg-gradient-to-br from-purple-500/40 to-pink-500/40 text-purple-200'
                  : 'bg-white/10 text-slate-400 group-hover:bg-purple-500/20 group-hover:text-purple-300'
              }`}>
                {role.icon}
              </div>

              {/* Title */}
              <div className="w-full">
                <div className={`text-xs font-semibold mb-0.5 transition-colors ${
                  data === role.value ? 'text-purple-100' : 'text-slate-100 group-hover:text-purple-200'
                }`}>
                  {role.title}
                </div>
                <p className={`text-[10px] leading-tight transition-colors ${
                  data === role.value ? 'text-slate-300' : 'text-slate-500 group-hover:text-slate-400'
                }`}>
                  {role.description}
                </p>
              </div>

              {/* Selection Indicator */}
              {data === role.value && !isUpdating && (
                <div className="absolute top-1.5 right-1.5">
                  <div className="w-4 h-4 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center">
                    <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                </div>
              )}

              {/* Loading Indicator */}
              {isUpdating && data === role.value && (
                <div className="absolute top-1.5 right-1.5">
                  <div className="w-4 h-4 border-2 border-purple-300 border-t-transparent rounded-full animate-spin"></div>
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default RoleStep;
