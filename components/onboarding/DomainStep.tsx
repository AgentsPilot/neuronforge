'use client';

import React from 'react';

interface DomainStepProps {
  data: string;
  onChange: (domain: string) => void;
}

interface DomainOption {
  value: string;
  title: string;
  description: string;
  icon: string;
  examples: string[];
}

const DomainStep: React.FC<DomainStepProps> = ({ data, onChange }) => {
  const getIconSvg = (iconType: string) => {
    switch(iconType) {
      case 'sales':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
        );
      case 'marketing':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
          </svg>
        );
      case 'operations':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        );
      case 'engineering':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
        );
      case 'executive':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        );
      case 'other':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
          </svg>
        );
      default:
        return null;
    }
  };

  const domainOptions: DomainOption[] = [
    {
      value: 'sales',
      title: 'Sales',
      description: 'Drive revenue and build customer relationships',
      icon: 'sales',
      examples: ['Lead generation', 'CRM management', 'Pipeline tracking'],
    },
    {
      value: 'marketing',
      title: 'Marketing',
      description: 'Create campaigns and grow brand awareness',
      icon: 'marketing',
      examples: ['Campaign management', 'Content creation', 'Social media'],
    },
    {
      value: 'operations',
      title: 'Operations',
      description: 'Optimize processes and manage workflows',
      icon: 'operations',
      examples: ['Process automation', 'Quality control', 'Resource planning'],
    },
    {
      value: 'engineering',
      title: 'IT & Engineering',
      description: 'Build technology solutions and maintain systems',
      icon: 'engineering',
      examples: ['System monitoring', 'Code deployment', 'Infrastructure'],
    },
    {
      value: 'executive',
      title: 'Executive Leadership',
      description: 'Strategic planning and organizational oversight',
      icon: 'executive',
      examples: ['Strategic planning', 'Performance tracking', 'Team management'],
    },
    {
      value: 'other',
      title: 'Other',
      description: 'Custom workflows or multiple departments',
      icon: 'other',
      examples: ['Multi-department', 'Specialized role', 'Consulting'],
    },
  ];

  const handleDomainSelect = (domain: string) => {
    onChange(domain);
  };

  const selectedDomain = domainOptions.find(d => d.value === data);

  return (
    <div className="space-y-5">
      <div className="text-center">
        <p className="text-gray-300 text-sm mb-1">
          Which domain best describes your primary work area?
        </p>
        <p className="text-gray-500 text-xs">
          We'll customize templates and integrations for your specific needs
        </p>
      </div>

      {/* Domain Badge Selection */}
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2 justify-center">
          {domainOptions.map((domain) => (
            <button
              key={domain.value}
              onClick={() => handleDomainSelect(domain.value)}
              className={`group relative px-4 py-2.5 border rounded-xl text-sm font-medium transition-all duration-200 hover:scale-105 ${
                data === domain.value
                  ? 'bg-purple-500/20 border-purple-400/50 text-purple-300 ring-2 ring-purple-400/30 shadow-lg shadow-purple-500/25'
                  : 'bg-white/5 border-white/10 text-slate-300 hover:bg-purple-500/10 hover:border-purple-500/30 hover:text-purple-300'
              }`}
            >
              <div className="flex items-center space-x-2">
                <span className={data === domain.value ? 'text-purple-400' : 'text-slate-400 group-hover:text-purple-400'}>
                  {getIconSvg(domain.icon)}
                </span>
                <span>{domain.title}</span>
                {data === domain.value && (
                  <div className="w-2 h-2 bg-purple-400 rounded-full animate-pulse"></div>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Selected Domain Details */}
      {selectedDomain && (
        <div className="mt-5 p-5 bg-gradient-to-br from-purple-500/10 to-blue-500/10 border border-purple-500/30 rounded-xl shadow-lg">
          <div className="flex items-start space-x-4">
            <div className="w-12 h-12 bg-purple-500/20 rounded-xl flex items-center justify-center text-purple-400 shadow-lg">
              {getIconSvg(selectedDomain.icon)}
            </div>
            <div className="flex-1">
              <div className="flex items-center space-x-2 mb-2">
                <h4 className="font-bold text-purple-200">
                  {selectedDomain.title} Selected
                </h4>
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse shadow-lg shadow-green-400/50"></div>
              </div>
              <p className="text-sm text-slate-300 mb-3">
                {selectedDomain.description}
              </p>

              {/* Example workflows as compact badges */}
              <div className="space-y-2">
                <div className="text-xs font-semibold text-purple-300">
                  Common workflows:
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedDomain.examples.map((example, index) => (
                    <span
                      key={index}
                      className="inline-flex items-center px-2.5 py-1 bg-purple-500/20 border border-purple-400/30 rounded-lg text-xs text-purple-300 font-medium"
                    >
                      <svg className="w-3 h-3 mr-1.5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      {example}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Help Text */}
      <div className="text-center">
        <p className="text-xs text-gray-500">
          You can access all domain templates regardless of your selection
        </p>
      </div>
    </div>
  );
};

export default DomainStep;