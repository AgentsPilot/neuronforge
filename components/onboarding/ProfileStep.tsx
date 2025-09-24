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

  // Comprehensive timezone list - all IANA timezone identifiers
  const timezones = [
    // Africa
    'Africa/Abidjan',
    'Africa/Accra',
    'Africa/Addis_Ababa',
    'Africa/Algiers',
    'Africa/Asmara',
    'Africa/Bamako',
    'Africa/Bangui',
    'Africa/Banjul',
    'Africa/Bissau',
    'Africa/Blantyre',
    'Africa/Brazzaville',
    'Africa/Bujumbura',
    'Africa/Cairo',
    'Africa/Casablanca',
    'Africa/Ceuta',
    'Africa/Conakry',
    'Africa/Dakar',
    'Africa/Dar_es_Salaam',
    'Africa/Djibouti',
    'Africa/Douala',
    'Africa/El_Aaiun',
    'Africa/Freetown',
    'Africa/Gaborone',
    'Africa/Harare',
    'Africa/Johannesburg',
    'Africa/Juba',
    'Africa/Kampala',
    'Africa/Khartoum',
    'Africa/Kigali',
    'Africa/Kinshasa',
    'Africa/Lagos',
    'Africa/Libreville',
    'Africa/Lome',
    'Africa/Luanda',
    'Africa/Lubumbashi',
    'Africa/Lusaka',
    'Africa/Malabo',
    'Africa/Maputo',
    'Africa/Maseru',
    'Africa/Mbabane',
    'Africa/Mogadishu',
    'Africa/Monrovia',
    'Africa/Nairobi',
    'Africa/Ndjamena',
    'Africa/Niamey',
    'Africa/Nouakchott',
    'Africa/Ouagadougou',
    'Africa/Porto-Novo',
    'Africa/Sao_Tome',
    'Africa/Tripoli',
    'Africa/Tunis',
    'Africa/Windhoek',

    // America
    'America/Adak',
    'America/Anchorage',
    'America/Anguilla',
    'America/Antigua',
    'America/Araguaina',
    'America/Argentina/Buenos_Aires',
    'America/Argentina/Catamarca',
    'America/Argentina/Cordoba',
    'America/Argentina/Jujuy',
    'America/Argentina/La_Rioja',
    'America/Argentina/Mendoza',
    'America/Argentina/Rio_Gallegos',
    'America/Argentina/Salta',
    'America/Argentina/San_Juan',
    'America/Argentina/San_Luis',
    'America/Argentina/Tucuman',
    'America/Argentina/Ushuaia',
    'America/Aruba',
    'America/Asuncion',
    'America/Atikokan',
    'America/Bahia',
    'America/Bahia_Banderas',
    'America/Barbados',
    'America/Belem',
    'America/Belize',
    'America/Blanc-Sablon',
    'America/Boa_Vista',
    'America/Bogota',
    'America/Boise',
    'America/Cambridge_Bay',
    'America/Campo_Grande',
    'America/Cancun',
    'America/Caracas',
    'America/Cayenne',
    'America/Cayman',
    'America/Chicago',
    'America/Chihuahua',
    'America/Ciudad_Juarez',
    'America/Costa_Rica',
    'America/Creston',
    'America/Cuiaba',
    'America/Curacao',
    'America/Danmarkshavn',
    'America/Dawson',
    'America/Dawson_Creek',
    'America/Denver',
    'America/Detroit',
    'America/Dominica',
    'America/Edmonton',
    'America/Eirunepe',
    'America/El_Salvador',
    'America/Fort_Nelson',
    'America/Fortaleza',
    'America/Glace_Bay',
    'America/Goose_Bay',
    'America/Grand_Turk',
    'America/Grenada',
    'America/Guadeloupe',
    'America/Guatemala',
    'America/Guayaquil',
    'America/Guyana',
    'America/Halifax',
    'America/Havana',
    'America/Hermosillo',
    'America/Indiana/Indianapolis',
    'America/Indiana/Knox',
    'America/Indiana/Marengo',
    'America/Indiana/Petersburg',
    'America/Indiana/Tell_City',
    'America/Indiana/Vevay',
    'America/Indiana/Vincennes',
    'America/Indiana/Winamac',
    'America/Inuvik',
    'America/Iqaluit',
    'America/Jamaica',
    'America/Juneau',
    'America/Kentucky/Louisville',
    'America/Kentucky/Monticello',
    'America/Kralendijk',
    'America/La_Paz',
    'America/Lima',
    'America/Los_Angeles',
    'America/Lower_Princes',
    'America/Maceio',
    'America/Managua',
    'America/Manaus',
    'America/Marigot',
    'America/Martinique',
    'America/Matamoros',
    'America/Mazatlan',
    'America/Menominee',
    'America/Merida',
    'America/Metlakatla',
    'America/Mexico_City',
    'America/Miquelon',
    'America/Moncton',
    'America/Monterrey',
    'America/Montevideo',
    'America/Montserrat',
    'America/Nassau',
    'America/New_York',
    'America/Nipigon',
    'America/Nome',
    'America/Noronha',
    'America/North_Dakota/Beulah',
    'America/North_Dakota/Center',
    'America/North_Dakota/New_Salem',
    'America/Nuuk',
    'America/Ojinaga',
    'America/Panama',
    'America/Pangnirtung',
    'America/Paramaribo',
    'America/Phoenix',
    'America/Port-au-Prince',
    'America/Port_of_Spain',
    'America/Porto_Velho',
    'America/Puerto_Rico',
    'America/Punta_Arenas',
    'America/Rainy_River',
    'America/Rankin_Inlet',
    'America/Recife',
    'America/Regina',
    'America/Resolute',
    'America/Rio_Branco',
    'America/Santarem',
    'America/Santiago',
    'America/Santo_Domingo',
    'America/Sao_Paulo',
    'America/Scoresbysund',
    'America/Sitka',
    'America/St_Barthelemy',
    'America/St_Johns',
    'America/St_Kitts',
    'America/St_Lucia',
    'America/St_Thomas',
    'America/St_Vincent',
    'America/Swift_Current',
    'America/Tegucigalpa',
    'America/Thule',
    'America/Thunder_Bay',
    'America/Tijuana',
    'America/Toronto',
    'America/Tortola',
    'America/Vancouver',
    'America/Whitehorse',
    'America/Winnipeg',
    'America/Yakutat',
    'America/Yellowknife',

    // Antarctica
    'Antarctica/Casey',
    'Antarctica/Davis',
    'Antarctica/DumontDUrville',
    'Antarctica/Macquarie',
    'Antarctica/Mawson',
    'Antarctica/McMurdo',
    'Antarctica/Palmer',
    'Antarctica/Rothera',
    'Antarctica/Syowa',
    'Antarctica/Troll',
    'Antarctica/Vostok',

    // Arctic
    'Arctic/Longyearbyen',

    // Asia
    'Asia/Aden',
    'Asia/Almaty',
    'Asia/Amman',
    'Asia/Anadyr',
    'Asia/Aqtau',
    'Asia/Aqtobe',
    'Asia/Ashgabat',
    'Asia/Atyrau',
    'Asia/Baghdad',
    'Asia/Bahrain',
    'Asia/Baku',
    'Asia/Bangkok',
    'Asia/Barnaul',
    'Asia/Beirut',
    'Asia/Bishkek',
    'Asia/Brunei',
    'Asia/Chita',
    'Asia/Choibalsan',
    'Asia/Colombo',
    'Asia/Damascus',
    'Asia/Dhaka',
    'Asia/Dili',
    'Asia/Dubai',
    'Asia/Dushanbe',
    'Asia/Famagusta',
    'Asia/Gaza',
    'Asia/Hebron',
    'Asia/Ho_Chi_Minh',
    'Asia/Hong_Kong',
    'Asia/Hovd',
    'Asia/Irkutsk',
    'Asia/Jakarta',
    'Asia/Jayapura',
    'Asia/Jerusalem',
    'Asia/Kabul',
    'Asia/Kamchatka',
    'Asia/Karachi',
    'Asia/Kathmandu',
    'Asia/Khandyga',
    'Asia/Kolkata',
    'Asia/Krasnoyarsk',
    'Asia/Kuala_Lumpur',
    'Asia/Kuching',
    'Asia/Kuwait',
    'Asia/Macau',
    'Asia/Magadan',
    'Asia/Makassar',
    'Asia/Manila',
    'Asia/Muscat',
    'Asia/Nicosia',
    'Asia/Novokuznetsk',
    'Asia/Novosibirsk',
    'Asia/Omsk',
    'Asia/Oral',
    'Asia/Phnom_Penh',
    'Asia/Pontianak',
    'Asia/Pyongyang',
    'Asia/Qatar',
    'Asia/Qostanay',
    'Asia/Qyzylorda',
    'Asia/Riyadh',
    'Asia/Sakhalin',
    'Asia/Samarkand',
    'Asia/Seoul',
    'Asia/Shanghai',
    'Asia/Singapore',
    'Asia/Srednekolymsk',
    'Asia/Taipei',
    'Asia/Tashkent',
    'Asia/Tbilisi',
    'Asia/Tehran',
    'Asia/Thimphu',
    'Asia/Tokyo',
    'Asia/Tomsk',
    'Asia/Ulaanbaatar',
    'Asia/Urumqi',
    'Asia/Ust-Nera',
    'Asia/Vientiane',
    'Asia/Vladivostok',
    'Asia/Yakutsk',
    'Asia/Yangon',
    'Asia/Yekaterinburg',
    'Asia/Yerevan',

    // Atlantic
    'Atlantic/Azores',
    'Atlantic/Bermuda',
    'Atlantic/Canary',
    'Atlantic/Cape_Verde',
    'Atlantic/Faroe',
    'Atlantic/Madeira',
    'Atlantic/Reykjavik',
    'Atlantic/South_Georgia',
    'Atlantic/St_Helena',
    'Atlantic/Stanley',

    // Australia
    'Australia/Adelaide',
    'Australia/Brisbane',
    'Australia/Broken_Hill',
    'Australia/Darwin',
    'Australia/Eucla',
    'Australia/Hobart',
    'Australia/Lindeman',
    'Australia/Lord_Howe',
    'Australia/Melbourne',
    'Australia/Perth',
    'Australia/Sydney',

    // Europe
    'Europe/Amsterdam',
    'Europe/Andorra',
    'Europe/Astrakhan',
    'Europe/Athens',
    'Europe/Belgrade',
    'Europe/Berlin',
    'Europe/Bratislava',
    'Europe/Brussels',
    'Europe/Bucharest',
    'Europe/Budapest',
    'Europe/Busingen',
    'Europe/Chisinau',
    'Europe/Copenhagen',
    'Europe/Dublin',
    'Europe/Gibraltar',
    'Europe/Guernsey',
    'Europe/Helsinki',
    'Europe/Isle_of_Man',
    'Europe/Istanbul',
    'Europe/Jersey',
    'Europe/Kaliningrad',
    'Europe/Kiev',
    'Europe/Kirov',
    'Europe/Lisbon',
    'Europe/Ljubljana',
    'Europe/London',
    'Europe/Luxembourg',
    'Europe/Madrid',
    'Europe/Malta',
    'Europe/Mariehamn',
    'Europe/Minsk',
    'Europe/Monaco',
    'Europe/Moscow',
    'Europe/Oslo',
    'Europe/Paris',
    'Europe/Podgorica',
    'Europe/Prague',
    'Europe/Riga',
    'Europe/Rome',
    'Europe/Samara',
    'Europe/San_Marino',
    'Europe/Sarajevo',
    'Europe/Saratov',
    'Europe/Simferopol',
    'Europe/Skopje',
    'Europe/Sofia',
    'Europe/Stockholm',
    'Europe/Tallinn',
    'Europe/Tirane',
    'Europe/Ulyanovsk',
    'Europe/Uzhgorod',
    'Europe/Vaduz',
    'Europe/Vatican',
    'Europe/Vienna',
    'Europe/Vilnius',
    'Europe/Volgograd',
    'Europe/Warsaw',
    'Europe/Zagreb',
    'Europe/Zaporozhye',
    'Europe/Zurich',

    // Indian
    'Indian/Antananarivo',
    'Indian/Chagos',
    'Indian/Christmas',
    'Indian/Cocos',
    'Indian/Comoro',
    'Indian/Kerguelen',
    'Indian/Mahe',
    'Indian/Maldives',
    'Indian/Mauritius',
    'Indian/Mayotte',
    'Indian/Reunion',

    // Pacific
    'Pacific/Apia',
    'Pacific/Auckland',
    'Pacific/Bougainville',
    'Pacific/Chatham',
    'Pacific/Chuuk',
    'Pacific/Easter',
    'Pacific/Efate',
    'Pacific/Enderbury',
    'Pacific/Fakaofo',
    'Pacific/Fiji',
    'Pacific/Funafuti',
    'Pacific/Galapagos',
    'Pacific/Gambier',
    'Pacific/Guadalcanal',
    'Pacific/Guam',
    'Pacific/Honolulu',
    'Pacific/Kiritimati',
    'Pacific/Kosrae',
    'Pacific/Kwajalein',
    'Pacific/Majuro',
    'Pacific/Marquesas',
    'Pacific/Midway',
    'Pacific/Nauru',
    'Pacific/Niue',
    'Pacific/Norfolk',
    'Pacific/Noumea',
    'Pacific/Pago_Pago',
    'Pacific/Palau',
    'Pacific/Pitcairn',
    'Pacific/Pohnpei',
    'Pacific/Port_Moresby',
    'Pacific/Rarotonga',
    'Pacific/Saipan',
    'Pacific/Tahiti',
    'Pacific/Tarawa',
    'Pacific/Tongatapu',
    'Pacific/Wake',
    'Pacific/Wallis',

    // UTC
    'UTC',
  ];

  // Helper function to format timezone display names
  const formatTimezone = (timezone: string) => {
    if (timezone === 'UTC') return 'UTC';
    
    // Convert timezone to readable format
    const parts = timezone.split('/');
    const city = parts[parts.length - 1].replace(/_/g, ' ');
    const region = parts[0];
    
    // Get current time offset
    try {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en', {
        timeZone: timezone,
        timeZoneName: 'short'
      });
      const timeZoneName = formatter.formatToParts(now)
        .find(part => part.type === 'timeZoneName')?.value || '';
      
      return `${city} (${region}) - ${timeZoneName}`;
    } catch {
      return `${city} (${region})`;
    }
  };

  // Smart search for timezones
  const filteredTimezones = useMemo(() => {
    if (!timezoneSearch.trim()) return timezones.slice(0, 50); // Show first 50 by default

    const searchTerm = timezoneSearch.toLowerCase().trim();
    const results = timezones.filter(timezone => {
      const formatted = formatTimezone(timezone).toLowerCase();
      const parts = timezone.toLowerCase().split('/');
      const city = parts[parts.length - 1].replace(/_/g, ' ');
      const region = parts[0];
      
      // Search in multiple ways for smart matching
      return (
        formatted.includes(searchTerm) ||
        timezone.toLowerCase().includes(searchTerm) ||
        city.includes(searchTerm) ||
        region.includes(searchTerm) ||
        // Smart abbreviation matching (e.g., "pst" matches Pacific)
        (searchTerm === 'pst' && timezone.includes('Los_Angeles')) ||
        (searchTerm === 'est' && timezone.includes('New_York')) ||
        (searchTerm === 'mst' && timezone.includes('Denver')) ||
        (searchTerm === 'cst' && timezone.includes('Chicago')) ||
        (searchTerm === 'gmt' && timezone.includes('London')) ||
        (searchTerm === 'cet' && (timezone.includes('Paris') || timezone.includes('Berlin'))) ||
        (searchTerm === 'jst' && timezone.includes('Tokyo')) ||
        (searchTerm === 'ist' && timezone.includes('Kolkata')) ||
        // Country name matching
        (searchTerm.includes('united states') && timezone.startsWith('America/')) ||
        (searchTerm.includes('usa') && timezone.startsWith('America/')) ||
        (searchTerm.includes('uk') && timezone.includes('London')) ||
        (searchTerm.includes('japan') && timezone.includes('Tokyo')) ||
        (searchTerm.includes('india') && timezone.includes('Kolkata')) ||
        (searchTerm.includes('australia') && timezone.startsWith('Australia/')) ||
        (searchTerm.includes('canada') && (timezone.includes('Toronto') || timezone.includes('Vancouver'))) ||
        (searchTerm.includes('france') && timezone.includes('Paris')) ||
        (searchTerm.includes('germany') && timezone.includes('Berlin')) ||
        (searchTerm.includes('china') && timezone.includes('Shanghai')) ||
        // Common city aliases
        (searchTerm.includes('nyc') && timezone.includes('New_York')) ||
        (searchTerm.includes('la') && timezone.includes('Los_Angeles')) ||
        (searchTerm.includes('sf') && timezone.includes('Los_Angeles')) ||
        (searchTerm.includes('chicago') && timezone.includes('Chicago'))
      );
    });

    // Sort results by relevance
    return results.sort((a, b) => {
      const aFormatted = formatTimezone(a).toLowerCase();
      const bFormatted = formatTimezone(b).toLowerCase();
      
      // Exact matches first
      if (aFormatted.startsWith(searchTerm) && !bFormatted.startsWith(searchTerm)) return -1;
      if (bFormatted.startsWith(searchTerm) && !aFormatted.startsWith(searchTerm)) return 1;
      
      // Then city name matches
      const aCity = a.split('/').pop()?.replace(/_/g, ' ').toLowerCase() || '';
      const bCity = b.split('/').pop()?.replace(/_/g, ' ').toLowerCase() || '';
      if (aCity.startsWith(searchTerm) && !bCity.startsWith(searchTerm)) return -1;
      if (bCity.startsWith(searchTerm) && !aCity.startsWith(searchTerm)) return 1;
      
      return aFormatted.localeCompare(bFormatted);
    }).slice(0, 100); // Limit to 100 results for performance
  }, [timezoneSearch, timezones]);

  const handleTimezoneSelect = (timezone: string) => {
    console.log('Selecting timezone:', timezone); // Debug log
    onChange({ timezone });
    setTimezoneSearch('');
    setIsTimezoneDropdownOpen(false);
  };

  // Get display text for selected timezone
  const getSelectedTimezoneDisplay = () => {
    if (!data.timezone) return '';
    return formatTimezone(data.timezone);
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <p className="text-sm text-gray-600">
          Tell us a bit about yourself to personalize your experience
        </p>
      </div>

      <div className="space-y-4">
        {/* Full Name (Read-only from signup) */}
        <div>
          <label htmlFor="fullName" className="block text-sm font-medium text-gray-700 mb-2">
            Full Name
          </label>
          <input
            id="fullName"
            type="text"
            value={data.fullName}
            disabled
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm bg-gray-50 text-gray-500 cursor-not-allowed"
          />
          <p className="text-xs text-gray-500 mt-1">This was set during signup and cannot be changed here.</p>
        </div>

        {/* Email (Read-only from signup) */}
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
            Email Address
          </label>
          <input
            id="email"
            type="email"
            value={data.email}
            disabled
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm bg-gray-50 text-gray-500 cursor-not-allowed"
          />
          <p className="text-xs text-gray-500 mt-1">Your account email address.</p>
        </div>

        {/* Company Field (Optional) */}
        <div>
          <label htmlFor="company" className="block text-sm font-medium text-gray-700 mb-2">
            Company Name
          </label>
          <input
            id="company"
            type="text"
            value={data.company}
            onChange={handleInputChange('company')}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            placeholder="Enter your company name (optional)"
          />
        </div>

        {/* Job Title Field (Optional) */}
        <div>
          <label htmlFor="jobTitle" className="block text-sm font-medium text-gray-700 mb-2">
            Job Title
          </label>
          <input
            id="jobTitle"
            type="text"
            value={data.jobTitle}
            onChange={handleInputChange('jobTitle')}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            placeholder="e.g., Software Engineer, Product Manager (optional)"
          />
        </div>

        {/* Timezone Field - Smart Searchable */}
        <div className="relative">
          <label htmlFor="timezone" className="block text-sm font-medium text-gray-700 mb-2">
            Timezone *
          </label>
          
          {/* Selected timezone display */}
          {data.timezone && !isTimezoneDropdownOpen && (
            <div className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm bg-blue-50 text-blue-900 mb-2">
              <div className="flex justify-between items-center">
                <div className="flex-1">
                  <span className="text-sm font-medium">{getSelectedTimezoneDisplay()}</span>
                  <div className="text-xs text-gray-600 mt-1">
                    {data.timezone === Intl.DateTimeFormat().resolvedOptions().timeZone 
                      ? '✓ Auto-detected based on your location' 
                      : 'Manually selected'
                    }
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsTimezoneDropdownOpen(true);
                    setTimezoneSearch('');
                  }}
                  className="text-blue-600 hover:text-blue-800 text-sm ml-2 px-2 py-1 rounded"
                >
                  Change
                </button>
              </div>
            </div>
          )}

          {/* Search input - always show when dropdown is open OR no timezone selected */}
          {(!data.timezone || isTimezoneDropdownOpen) && (
            <>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search for your city, country, or timezone (e.g., 'New York', 'PST', 'Japan')..."
                  value={timezoneSearch}
                  onChange={(e) => setTimezoneSearch(e.target.value)}
                  className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  autoComplete="off"
                  autoFocus={isTimezoneDropdownOpen}
                />
                
                {/* Search icon */}
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
              </div>

              {/* Dropdown results */}
              <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                {filteredTimezones.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-gray-500">
                    {timezoneSearch.trim() ? 
                      `No timezones found for "${timezoneSearch}". Try searching for a city or country name.` :
                      'Start typing to search for timezones...'
                    }
                  </div>
                ) : (
                  <>
                    {/* Search hint */}
                    {timezoneSearch.trim() && (
                      <div className="px-3 py-2 text-xs text-blue-600 bg-blue-50 border-b border-gray-100">
                        📍 {filteredTimezones.length} timezone{filteredTimezones.length !== 1 ? 's' : ''} found
                      </div>
                    )}
                    
                    {/* Popular/Default options when no search */}
                    {!timezoneSearch.trim() && (
                      <div className="px-3 py-2 text-xs text-green-600 bg-green-50 border-b border-gray-100">
                        🌟 Popular timezones (or start typing to search all 400+)
                      </div>
                    )}
                    
                    {filteredTimezones.map((timezone) => (
                      <button
                        key={timezone}
                        type="button"
                        onClick={() => handleTimezoneSelect(timezone)}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-blue-50 focus:bg-blue-50 focus:outline-none border-none bg-transparent"
                      >
                        <div className="font-medium text-gray-900">
                          {formatTimezone(timezone)}
                        </div>
                        <div className="text-xs text-gray-500">
                          {timezone}
                        </div>
                      </button>
                    ))}
                  </>
                )}
              </div>

              {/* Cancel button */}
              {data.timezone && (
                <button
                  type="button"
                  onClick={() => {
                    setIsTimezoneDropdownOpen(false);
                    setTimezoneSearch('');
                  }}
                  className="mt-2 text-sm text-gray-500 hover:text-gray-700"
                >
                  Cancel
                </button>
              )}
            </>
          )}

          {/* Help text */}
          <p className="text-xs text-gray-500 mt-1">
            Try searching: city names, countries, abbreviations (PST, EST, GMT), or regions
          </p>
        </div>
      </div>

      {/* Helper Text */}
      <div className="text-xs text-gray-500 text-center">
        <p>This information helps us customize your dashboard and notifications</p>
      </div>
    </div>
  );
};

export default ProfileStep;