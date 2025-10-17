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
  const domainOptions: DomainOption[] = [
    {
      value: 'sales',
      title: 'Sales',
      description: 'Drive revenue and build customer relationships',
      icon: '📈',
      examples: ['Lead generation', 'CRM management', 'Pipeline tracking'],
    },
    {
      value: 'marketing',
      title: 'Marketing',
      description: 'Create campaigns and grow brand awareness',
      icon: '🎯',
      examples: ['Campaign management', 'Content creation', 'Social media'],
    },
    {
      value: 'operations',
      title: 'Operations',
      description: 'Optimize processes and manage workflows',
      icon: '⚙️',
      examples: ['Process automation', 'Quality control', 'Resource planning'],
    },
    {
      value: 'engineering',
      title: 'IT & Engineering',
      description: 'Build technology solutions and maintain systems',
      icon: '💻',
      examples: ['System monitoring', 'Code deployment', 'Infrastructure'],
    },
    {
      value: 'executive',
      title: 'Executive Leadership',
      description: 'Strategic planning and organizational oversight',
      icon: '👔',
      examples: ['Strategic planning', 'Performance tracking', 'Team management'],
    },
    {
      value: 'other',
      title: 'Other',
      description: 'Custom workflows or multiple departments',
      icon: '🔧',
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
              className={`group relative px-4 py-2.5 border rounded-lg text-sm font-medium transition-all duration-200 hover:scale-105 ${
                data === domain.value
                  ? 'bg-blue-500/20 border-blue-400/50 text-blue-300 ring-2 ring-blue-400/30'
                  : 'bg-gray-700/50 border-gray-600/30 text-gray-300 hover:bg-blue-500/10 hover:border-blue-500/30 hover:text-blue-300'
              }`}
            >
              <div className="flex items-center space-x-2">
                <span className="text-base">{domain.icon}</span>
                <span>{domain.title}</span>
                {data === domain.value && (
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Selected Domain Details */}
      {selectedDomain && (
        <div className="mt-5 p-4 bg-blue-500/10 border border-blue-500/30 rounded-xl">
          <div className="flex items-start space-x-3">
            <div className="text-2xl">{selectedDomain.icon}</div>
            <div className="flex-1">
              <div className="flex items-center space-x-2 mb-2">
                <h4 className="font-medium text-blue-200">
                  {selectedDomain.title} Selected
                </h4>
                <div className="w-1.5 h-1.5 bg-green-400 rounded-full"></div>
              </div>
              <p className="text-sm text-blue-300/80 mb-3">
                {selectedDomain.description}
              </p>
              
              {/* Example workflows as compact badges */}
              <div className="space-y-2">
                <div className="text-xs font-medium text-blue-200">
                  Common workflows:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {selectedDomain.examples.map((example, index) => (
                    <span
                      key={index}
                      className="inline-flex items-center px-2 py-1 bg-blue-500/20 border border-blue-400/30 rounded-md text-xs text-blue-300"
                    >
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