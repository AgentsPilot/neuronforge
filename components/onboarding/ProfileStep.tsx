'use client';

import React, { useState, useMemo } from 'react';
import { ProfileData } from './hooks/useOnboarding';

interface ProfileStepProps {
  data: ProfileData;
  onChange: (data: Partial<ProfileData>) => void;
}

const ProfileStep: React.FC<ProfileStepProps> = ({ data, onChange }) => {
  const [timezoneSearch, setTimezoneSearch] = useState('');
  const [isTimezoneDropdownOpen, setIsTimezoneDropdownOpen] = useState(false);

  // Auto-detect user's timezone on first render
  React.useEffect(() => {
    if (!data.timezone) {
      const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      onChange({ timezone: userTimezone });
    }
  }, [data.timezone, onChange]);

  const handleInputChange = (field: keyof ProfileData) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    onChange({ [field]: e.target.value });
  };

  // Popular timezones for quick selection
  const popularTimezones = [
    'UTC',
    'America/New_York',
    'America/Los_Angeles',
    'America/Chicago',
    'America/Denver',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Asia/Tokyo',
    'Asia/Shanghai',
    'Asia/Kolkata',
    'Australia/Sydney',
    'Pacific/Honolulu',
  ];

  // Comprehensive timezone list for search
  const allTimezones = [
    'UTC',
    // Americas
    'America/New_York', 'America/Los_Angeles', 'America/Chicago', 'America/Denver',
    'America/Phoenix', 'America/Anchorage', 'America/Honolulu', 'America/Toronto',
    'America/Vancouver', 'America/Montreal', 'America/Halifax', 'America/Winnipeg',
    'America/Edmonton', 'America/Regina', 'America/St_Johns', 'America/Mexico_City',
    'America/Tijuana', 'America/Cancun', 'America/Merida', 'America/Monterrey',
    'America/Bogota', 'America/Lima', 'America/Santiago', 'America/Buenos_Aires',
    'America/Sao_Paulo', 'America/Rio_Branco', 'America/Manaus', 'America/Fortaleza',
    'America/Recife', 'America/Belem', 'America/Caracas', 'America/La_Paz',
    'America/Asuncion', 'America/Montevideo', 'America/Cayenne', 'America/Paramaribo',
    'America/Guyana', 'America/Barbados', 'America/Jamaica', 'America/Haiti',
    'America/Dominican_Republic', 'America/Puerto_Rico', 'America/Cuba',
    
    // Europe
    'Europe/London', 'Europe/Dublin', 'Europe/Paris', 'Europe/Berlin',
    'Europe/Rome', 'Europe/Madrid', 'Europe/Barcelona', 'Europe/Amsterdam',
    'Europe/Brussels', 'Europe/Vienna', 'Europe/Zurich', 'Europe/Prague',
    'Europe/Budapest', 'Europe/Warsaw', 'Europe/Stockholm', 'Europe/Oslo',
    'Europe/Copenhagen', 'Europe/Helsinki', 'Europe/Tallinn', 'Europe/Riga',
    'Europe/Vilnius', 'Europe/Minsk', 'Europe/Kiev', 'Europe/Moscow',
    'Europe/Istanbul', 'Europe/Athens', 'Europe/Bucharest', 'Europe/Sofia',
    'Europe/Belgrade', 'Europe/Zagreb', 'Europe/Ljubljana', 'Europe/Sarajevo',
    'Europe/Podgorica', 'Europe/Skopje', 'Europe/Tirana', 'Europe/Malta',
    'Europe/Lisbon', 'Europe/Gibraltar',
    
    // Asia
    'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Singapore',
    'Asia/Kuala_Lumpur', 'Asia/Jakarta', 'Asia/Bangkok', 'Asia/Ho_Chi_Minh',
    'Asia/Manila', 'Asia/Taipei', 'Asia/Seoul', 'Asia/Kolkata', 'Asia/Mumbai',
    'Asia/Delhi', 'Asia/Dhaka', 'Asia/Karachi', 'Asia/Kathmandu', 'Asia/Colombo',
    'Asia/Dubai', 'Asia/Riyadh', 'Asia/Kuwait', 'Asia/Doha', 'Asia/Muscat',
    'Asia/Bahrain', 'Asia/Tehran', 'Asia/Baghdad', 'Asia/Damascus',
    'Asia/Beirut', 'Asia/Jerusalem', 'Asia/Amman', 'Asia/Yerevan',
    'Asia/Baku', 'Asia/Tbilisi', 'Asia/Almaty', 'Asia/Tashkent',
    'Asia/Ashgabat', 'Asia/Dushanbe', 'Asia/Bishkek', 'Asia/Kabul',
    'Asia/Islamabad', 'Asia/Karachi', 'Asia/Ulaanbaatar', 'Asia/Irkutsk',
    'Asia/Krasnoyarsk', 'Asia/Novosibirsk', 'Asia/Yekaterinburg', 'Asia/Omsk',
    'Asia/Vladivostok', 'Asia/Magadan', 'Asia/Kamchatka', 'Asia/Anadyr',
    
    // Africa
    'Africa/Cairo', 'Africa/Lagos', 'Africa/Nairobi', 'Africa/Johannesburg',
    'Africa/Cape_Town', 'Africa/Casablanca', 'Africa/Tunis', 'Africa/Algiers',
    'Africa/Tripoli', 'Africa/Khartoum', 'Africa/Addis_Ababa', 'Africa/Dar_es_Salaam',
    'Africa/Kampala', 'Africa/Kigali', 'Africa/Bujumbura', 'Africa/Lusaka',
    'Africa/Harare', 'Africa/Maputo', 'Africa/Windhoek', 'Africa/Gaborone',
    'Africa/Maseru', 'Africa/Mbabane', 'Africa/Blantyre', 'Africa/Lilongwe',
    
    // Australia/Oceania
    'Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane',
    'Australia/Perth', 'Australia/Adelaide', 'Australia/Darwin',
    'Australia/Hobart', 'Pacific/Auckland', 'Pacific/Wellington',
    'Pacific/Fiji', 'Pacific/Tahiti', 'Pacific/Honolulu', 'Pacific/Guam',
    'Pacific/Saipan', 'Pacific/Palau', 'Pacific/Majuro', 'Pacific/Tarawa',
    'Pacific/Funafuti', 'Pacific/Wallis', 'Pacific/Apia', 'Pacific/Tongatapu',
    'Pacific/Nuku_alofa', 'Pacific/Port_Moresby', 'Pacific/Noumea',
    'Pacific/Norfolk', 'Pacific/Lord_Howe', 'Pacific/Chatham'
  ];

  // Helper function to format timezone display names
  const formatTimezone = (timezone: string) => {
    if (timezone === 'UTC') return 'UTC';
    
    const parts = timezone.split('/');
    const city = parts[parts.length - 1].replace(/_/g, ' ');
    
    try {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en', {
        timeZone: timezone,
        timeZoneName: 'short'
      });
      const timeZoneName = formatter.formatToParts(now)
        .find(part => part.type === 'timeZoneName')?.value || '';
      
      return `${city} ${timeZoneName}`;
    } catch {
      return city;
    }
  };

  const handleTimezoneSelect = (timezone: string) => {
    onChange({ timezone });
    setTimezoneSearch('');
    setIsTimezoneDropdownOpen(false);
  };

  const getSelectedTimezoneDisplay = () => {
    if (!data.timezone) return '';
    return formatTimezone(data.timezone);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="text-center">
        <p className="text-gray-300 text-sm">
          Complete your profile to get started
        </p>
      </div>

      {/* Compact form grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Full Name (Read-only) - Compact */}
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Full Name
          </label>
          <div className="relative">
            <input
              type="text"
              value={data.fullName}
              disabled
              className="w-full px-3 py-2.5 bg-gray-800/40 border border-gray-600/40 rounded-lg text-gray-300 text-sm disabled:opacity-60 disabled:cursor-not-allowed"
            />
            <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
              <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Email (Read-only) - Compact */}
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Email Address
          </label>
          <div className="relative">
            <input
              type="email"
              value={data.email}
              disabled
              className="w-full px-3 py-2.5 bg-gray-800/40 border border-gray-600/40 rounded-lg text-gray-300 text-sm disabled:opacity-60 disabled:cursor-not-allowed"
            />
            <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
              <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
              </svg>
            </div>
          </div>
        </div>

        {/* Company (Optional) */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Company <span className="text-gray-500 text-xs">(Optional)</span>
          </label>
          <input
            type="text"
            value={data.company}
            onChange={handleInputChange('company')}
            placeholder="Your company"
            className="w-full px-3 py-2.5 bg-gray-800/20 border border-gray-600/30 rounded-lg text-gray-100 text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 focus:bg-gray-800/40 transition-all duration-200"
          />
        </div>

        {/* Job Title (Optional) */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Job Title <span className="text-gray-500 text-xs">(Optional)</span>
          </label>
          <input
            type="text"
            value={data.jobTitle}
            onChange={handleInputChange('jobTitle')}
            placeholder="Your role"
            className="w-full px-3 py-2.5 bg-gray-800/20 border border-gray-600/30 rounded-lg text-gray-100 text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 focus:bg-gray-800/40 transition-all duration-200"
          />
        </div>

        {/* Timezone - Compact Smart Selector */}
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Timezone <span className="text-red-400">*</span>
          </label>
          
          {/* Current timezone display */}
          {data.timezone && !isTimezoneDropdownOpen ? (
            <div className="flex items-center justify-between p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
              <div className="flex items-center space-x-3">
                <div className="w-2 h-2 bg-blue-400 rounded-full"></div>
                <div>
                  <div className="text-blue-200 text-sm font-medium">
                    {getSelectedTimezoneDisplay()}
                  </div>
                  <div className="text-blue-300/60 text-xs">
                    {data.timezone === Intl.DateTimeFormat().resolvedOptions().timeZone 
                      ? 'Auto-detected' 
                      : 'Custom selection'
                    }
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsTimezoneDropdownOpen(true)}
                className="text-blue-400 hover:text-blue-300 text-sm px-3 py-1 rounded-md hover:bg-blue-500/20 transition-all duration-200"
              >
                Change
              </button>
            </div>
          ) : (
            /* Timezone selection */
            <div className="relative">
              {/* Quick timezone buttons */}
              <div className="flex flex-wrap gap-2 mb-3">
                {popularTimezones.slice(0, 6).map((tz) => (
                  <button
                    key={tz}
                    type="button"
                    onClick={() => handleTimezoneSelect(tz)}
                    className="px-3 py-1.5 bg-gray-700/50 hover:bg-blue-500/20 border border-gray-600/30 hover:border-blue-500/30 rounded-md text-xs text-gray-300 hover:text-blue-300 transition-all duration-200"
                  >
                    {formatTimezone(tz)}
                  </button>
                ))}
              </div>

              {/* Search input for other timezones */}
              <div className="relative">
                <input
                  type="text"
                  placeholder="Or search for your timezone..."
                  value={timezoneSearch}
                  onChange={(e) => setTimezoneSearch(e.target.value)}
                  className="w-full px-3 py-2.5 pr-10 bg-gray-800/20 border border-gray-600/30 rounded-lg text-gray-100 text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 focus:bg-gray-800/40 transition-all duration-200"
                />
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                  <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
              </div>

              {/* Search results */}
              {timezoneSearch.trim() && (
                <div className="absolute z-50 w-full mt-1 bg-gray-800/95 backdrop-blur-sm border border-gray-600/50 rounded-lg shadow-xl max-h-40 overflow-y-auto">
                  {allTimezones
                    .filter(tz => {
                      const searchTerm = timezoneSearch.toLowerCase();
                      const formattedTz = formatTimezone(tz).toLowerCase();
                      const city = tz.split('/').pop()?.replace(/_/g, ' ').toLowerCase() || '';
                      return formattedTz.includes(searchTerm) || 
                             tz.toLowerCase().includes(searchTerm) || 
                             city.includes(searchTerm);
                    })
                    .slice(0, 10)
                    .map((timezone) => (
                      <button
                        key={timezone}
                        type="button"
                        onClick={() => handleTimezoneSelect(timezone)}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700/50 focus:bg-gray-700/50 focus:outline-none transition-colors duration-200"
                      >
                        <div className="text-gray-200">{formatTimezone(timezone)}</div>
                        <div className="text-gray-500 text-xs">{timezone}</div>
                      </button>
                    ))}
                  {allTimezones.filter(tz => {
                    const searchTerm = timezoneSearch.toLowerCase();
                    const formattedTz = formatTimezone(tz).toLowerCase();
                    const city = tz.split('/').pop()?.replace(/_/g, ' ').toLowerCase() || '';
                    return formattedTz.includes(searchTerm) || 
                           tz.toLowerCase().includes(searchTerm) || 
                           city.includes(searchTerm);
                  }).length === 0 && (
                    <div className="px-3 py-2 text-sm text-gray-400">
                      No timezones found for "{timezoneSearch}"
                    </div>
                  )}
                </div>
              )}

              {/* Cancel button */}
              {data.timezone && (
                <button
                  type="button"
                  onClick={() => {
                    setIsTimezoneDropdownOpen(false);
                    setTimezoneSearch('');
                  }}
                  className="mt-2 text-sm text-gray-400 hover:text-gray-300 transition-colors duration-200"
                >
                  Cancel
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Compact status indicator */}
      <div className="text-center pt-2">
        <div className="inline-flex items-center space-x-2 text-xs text-gray-400">
          <div className={`w-2 h-2 rounded-full ${
            data.fullName && data.email && data.timezone ? 'bg-green-400' : 'bg-gray-500'
          }`}></div>
          <span>Profile {data.fullName && data.email && data.timezone ? 'complete' : 'in progress'}</span>
        </div>
      </div>
    </div>
  );
};

export default ProfileStep;