'use client'

import React, { useState, useMemo } from 'react'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { Save, Loader2, CheckCircle, AlertCircle, User, Building, Briefcase, Globe, Clock, Crown, Search, X, Shield } from 'lucide-react'
import { UserProfile } from '@/types/settings'
import AvatarUpload from '../ui/AvatarUpload'

interface ProfileTabProps {
  profile: UserProfile | null
  profileForm: Partial<UserProfile>
  setProfileForm: React.Dispatch<React.SetStateAction<Partial<UserProfile>>>
  onSave: () => void
}

export default function ProfileTab({ 
  profile, 
  profileForm, 
  setProfileForm, 
  onSave 
}: ProfileTabProps) {
  const { user } = useAuth()
  const [saving, setSaving] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  
  // Timezone search state
  const [timezoneSearch, setTimezoneSearch] = useState('')
  const [isTimezoneDropdownOpen, setIsTimezoneDropdownOpen] = useState(false)

  // Role options
  const roleOptions = [
    {
      value: 'admin',
      label: 'Administrator',
      description: 'Full access to all features and settings',
      color: 'from-red-500 to-pink-500',
      bgColor: 'from-red-50 to-pink-50',
      textColor: 'text-red-700',
      icon: Shield
    },
    {
      value: 'user',
      label: 'User',
      description: 'Standard access for day-to-day work',
      color: 'from-blue-500 to-indigo-500',
      bgColor: 'from-blue-50 to-indigo-50',
      textColor: 'text-blue-700',
      icon: User
    },
    {
      value: 'viewer',
      label: 'Viewer',
      description: 'Read-only access for monitoring and reporting',
      color: 'from-green-500 to-emerald-500',
      bgColor: 'from-green-50 to-emerald-50',
      textColor: 'text-green-700',
      icon: Globe
    }
  ]

  // Comprehensive timezone list - matching ProfileStep
  const timezones = [
    // Africa
    'Africa/Abidjan', 'Africa/Accra', 'Africa/Addis_Ababa', 'Africa/Algiers', 'Africa/Asmara',
    'Africa/Bamako', 'Africa/Bangui', 'Africa/Banjul', 'Africa/Bissau', 'Africa/Blantyre',
    'Africa/Brazzaville', 'Africa/Bujumbura', 'Africa/Cairo', 'Africa/Casablanca', 'Africa/Ceuta',
    'Africa/Conakry', 'Africa/Dakar', 'Africa/Dar_es_Salaam', 'Africa/Djibouti', 'Africa/Douala',
    'Africa/El_Aaiun', 'Africa/Freetown', 'Africa/Gaborone', 'Africa/Harare', 'Africa/Johannesburg',
    'Africa/Juba', 'Africa/Kampala', 'Africa/Khartoum', 'Africa/Kigali', 'Africa/Kinshasa',
    'Africa/Lagos', 'Africa/Libreville', 'Africa/Lome', 'Africa/Luanda', 'Africa/Lubumbashi',
    'Africa/Lusaka', 'Africa/Malabo', 'Africa/Maputo', 'Africa/Maseru', 'Africa/Mbabane',
    'Africa/Mogadishu', 'Africa/Monrovia', 'Africa/Nairobi', 'Africa/Ndjamena', 'Africa/Niamey',
    'Africa/Nouakchott', 'Africa/Ouagadougou', 'Africa/Porto-Novo', 'Africa/Sao_Tome',
    'Africa/Tripoli', 'Africa/Tunis', 'Africa/Windhoek',

    // America
    'America/Adak', 'America/Anchorage', 'America/Anguilla', 'America/Antigua', 'America/Araguaina',
    'America/Argentina/Buenos_Aires', 'America/Argentina/Catamarca', 'America/Argentina/Cordoba',
    'America/Argentina/Jujuy', 'America/Argentina/La_Rioja', 'America/Argentina/Mendoza',
    'America/Argentina/Rio_Gallegos', 'America/Argentina/Salta', 'America/Argentina/San_Juan',
    'America/Argentina/San_Luis', 'America/Argentina/Tucuman', 'America/Argentina/Ushuaia',
    'America/Aruba', 'America/Asuncion', 'America/Atikokan', 'America/Bahia', 'America/Bahia_Banderas',
    'America/Barbados', 'America/Belem', 'America/Belize', 'America/Blanc-Sablon', 'America/Boa_Vista',
    'America/Bogota', 'America/Boise', 'America/Cambridge_Bay', 'America/Campo_Grande', 'America/Cancun',
    'America/Caracas', 'America/Cayenne', 'America/Cayman', 'America/Chicago', 'America/Chihuahua',
    'America/Ciudad_Juarez', 'America/Costa_Rica', 'America/Creston', 'America/Cuiaba', 'America/Curacao',
    'America/Danmarkshavn', 'America/Dawson', 'America/Dawson_Creek', 'America/Denver', 'America/Detroit',
    'America/Dominica', 'America/Edmonton', 'America/Eirunepe', 'America/El_Salvador', 'America/Fort_Nelson',
    'America/Fortaleza', 'America/Glace_Bay', 'America/Goose_Bay', 'America/Grand_Turk', 'America/Grenada',
    'America/Guadeloupe', 'America/Guatemala', 'America/Guayaquil', 'America/Guyana', 'America/Halifax',
    'America/Havana', 'America/Hermosillo', 'America/Indiana/Indianapolis', 'America/Indiana/Knox',
    'America/Indiana/Marengo', 'America/Indiana/Petersburg', 'America/Indiana/Tell_City',
    'America/Indiana/Vevay', 'America/Indiana/Vincennes', 'America/Indiana/Winamac', 'America/Inuvik',
    'America/Iqaluit', 'America/Jamaica', 'America/Juneau', 'America/Kentucky/Louisville',
    'America/Kentucky/Monticello', 'America/Kralendijk', 'America/La_Paz', 'America/Lima',
    'America/Los_Angeles', 'America/Lower_Princes', 'America/Maceio', 'America/Managua',
    'America/Manaus', 'America/Marigot', 'America/Martinique', 'America/Matamoros', 'America/Mazatlan',
    'America/Menominee', 'America/Merida', 'America/Metlakatla', 'America/Mexico_City', 'America/Miquelon',
    'America/Moncton', 'America/Monterrey', 'America/Montevideo', 'America/Montserrat', 'America/Nassau',
    'America/New_York', 'America/Nipigon', 'America/Nome', 'America/Noronha', 'America/North_Dakota/Beulah',
    'America/North_Dakota/Center', 'America/North_Dakota/New_Salem', 'America/Nuuk', 'America/Ojinaga',
    'America/Panama', 'America/Pangnirtung', 'America/Paramaribo', 'America/Phoenix', 'America/Port-au-Prince',
    'America/Port_of_Spain', 'America/Porto_Velho', 'America/Puerto_Rico', 'America/Punta_Arenas',
    'America/Rainy_River', 'America/Rankin_Inlet', 'America/Recife', 'America/Regina', 'America/Resolute',
    'America/Rio_Branco', 'America/Santarem', 'America/Santiago', 'America/Santo_Domingo', 'America/Sao_Paulo',
    'America/Scoresbysund', 'America/Sitka', 'America/St_Barthelemy', 'America/St_Johns', 'America/St_Kitts',
    'America/St_Lucia', 'America/St_Thomas', 'America/St_Vincent', 'America/Swift_Current',
    'America/Tegucigalpa', 'America/Thule', 'America/Thunder_Bay', 'America/Tijuana', 'America/Toronto',
    'America/Tortola', 'America/Vancouver', 'America/Whitehorse', 'America/Winnipeg', 'America/Yakutat',
    'America/Yellowknife',

    // Asia
    'Asia/Aden', 'Asia/Almaty', 'Asia/Amman', 'Asia/Anadyr', 'Asia/Aqtau', 'Asia/Aqtobe',
    'Asia/Ashgabat', 'Asia/Atyrau', 'Asia/Baghdad', 'Asia/Bahrain', 'Asia/Baku', 'Asia/Bangkok',
    'Asia/Barnaul', 'Asia/Beirut', 'Asia/Bishkek', 'Asia/Brunei', 'Asia/Chita', 'Asia/Choibalsan',
    'Asia/Colombo', 'Asia/Damascus', 'Asia/Dhaka', 'Asia/Dili', 'Asia/Dubai', 'Asia/Dushanbe',
    'Asia/Famagusta', 'Asia/Gaza', 'Asia/Hebron', 'Asia/Ho_Chi_Minh', 'Asia/Hong_Kong', 'Asia/Hovd',
    'Asia/Irkutsk', 'Asia/Jakarta', 'Asia/Jayapura', 'Asia/Jerusalem', 'Asia/Kabul', 'Asia/Kamchatka',
    'Asia/Karachi', 'Asia/Kathmandu', 'Asia/Khandyga', 'Asia/Kolkata', 'Asia/Krasnoyarsk',
    'Asia/Kuala_Lumpur', 'Asia/Kuching', 'Asia/Kuwait', 'Asia/Macau', 'Asia/Magadan', 'Asia/Makassar',
    'Asia/Manila', 'Asia/Muscat', 'Asia/Nicosia', 'Asia/Novokuznetsk', 'Asia/Novosibirsk', 'Asia/Omsk',
    'Asia/Oral', 'Asia/Phnom_Penh', 'Asia/Pontianak', 'Asia/Pyongyang', 'Asia/Qatar', 'Asia/Qostanay',
    'Asia/Qyzylorda', 'Asia/Riyadh', 'Asia/Sakhalin', 'Asia/Samarkand', 'Asia/Seoul', 'Asia/Shanghai',
    'Asia/Singapore', 'Asia/Srednekolymsk', 'Asia/Taipei', 'Asia/Tashkent', 'Asia/Tbilisi', 'Asia/Tehran',
    'Asia/Thimphu', 'Asia/Tokyo', 'Asia/Tomsk', 'Asia/Ulaanbaatar', 'Asia/Urumqi', 'Asia/Ust-Nera',
    'Asia/Vientiane', 'Asia/Vladivostok', 'Asia/Yakutsk', 'Asia/Yangon', 'Asia/Yekaterinburg', 'Asia/Yerevan',

    // Europe
    'Europe/Amsterdam', 'Europe/Andorra', 'Europe/Astrakhan', 'Europe/Athens', 'Europe/Belgrade',
    'Europe/Berlin', 'Europe/Bratislava', 'Europe/Brussels', 'Europe/Bucharest', 'Europe/Budapest',
    'Europe/Busingen', 'Europe/Chisinau', 'Europe/Copenhagen', 'Europe/Dublin', 'Europe/Gibraltar',
    'Europe/Guernsey', 'Europe/Helsinki', 'Europe/Isle_of_Man', 'Europe/Istanbul', 'Europe/Jersey',
    'Europe/Kaliningrad', 'Europe/Kiev', 'Europe/Kirov', 'Europe/Lisbon', 'Europe/Ljubljana',
    'Europe/London', 'Europe/Luxembourg', 'Europe/Madrid', 'Europe/Malta', 'Europe/Mariehamn',
    'Europe/Minsk', 'Europe/Monaco', 'Europe/Moscow', 'Europe/Oslo', 'Europe/Paris', 'Europe/Podgorica',
    'Europe/Prague', 'Europe/Riga', 'Europe/Rome', 'Europe/Samara', 'Europe/San_Marino', 'Europe/Sarajevo',
    'Europe/Saratov', 'Europe/Simferopol', 'Europe/Skopje', 'Europe/Sofia', 'Europe/Stockholm',
    'Europe/Tallinn', 'Europe/Tirane', 'Europe/Ulyanovsk', 'Europe/Uzhgorod', 'Europe/Vaduz',
    'Europe/Vatican', 'Europe/Vienna', 'Europe/Vilnius', 'Europe/Volgograd', 'Europe/Warsaw',
    'Europe/Zagreb', 'Europe/Zaporozhye', 'Europe/Zurich',

    // Australia & Pacific
    'Australia/Adelaide', 'Australia/Brisbane', 'Australia/Broken_Hill', 'Australia/Darwin',
    'Australia/Eucla', 'Australia/Hobart', 'Australia/Lindeman', 'Australia/Lord_Howe',
    'Australia/Melbourne', 'Australia/Perth', 'Australia/Sydney',
    'Pacific/Apia', 'Pacific/Auckland', 'Pacific/Chatham', 'Pacific/Fiji', 'Pacific/Honolulu',
    'Pacific/Guam', 'Pacific/Tahiti', 'Pacific/Tongatapu',

    // UTC
    'UTC',
  ];

  // Helper function to format timezone display names
  const formatTimezone = (timezone: string) => {
    if (timezone === 'UTC') return 'UTC';
    
    const parts = timezone.split('/');
    const city = parts[parts.length - 1].replace(/_/g, ' ');
    const region = parts[0];
    
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
    if (!timezoneSearch.trim()) return timezones.slice(0, 50);

    const searchTerm = timezoneSearch.toLowerCase().trim();
    const results = timezones.filter(timezone => {
      const formatted = formatTimezone(timezone).toLowerCase();
      const parts = timezone.toLowerCase().split('/');
      const city = parts[parts.length - 1].replace(/_/g, ' ');
      const region = parts[0];
      
      return (
        formatted.includes(searchTerm) ||
        timezone.toLowerCase().includes(searchTerm) ||
        city.includes(searchTerm) ||
        region.includes(searchTerm) ||
        // Smart abbreviation matching
        (searchTerm === 'pst' && timezone.includes('Los_Angeles')) ||
        (searchTerm === 'est' && timezone.includes('New_York')) ||
        (searchTerm === 'mst' && timezone.includes('Denver')) ||
        (searchTerm === 'cst' && timezone.includes('Chicago')) ||
        (searchTerm === 'gmt' && timezone.includes('London')) ||
        (searchTerm === 'jst' && timezone.includes('Tokyo'))
      );
    });

    return results.sort((a, b) => {
      const aFormatted = formatTimezone(a).toLowerCase();
      const bFormatted = formatTimezone(b).toLowerCase();
      
      if (aFormatted.startsWith(searchTerm) && !bFormatted.startsWith(searchTerm)) return -1;
      if (bFormatted.startsWith(searchTerm) && !aFormatted.startsWith(searchTerm)) return 1;
      
      return aFormatted.localeCompare(bFormatted);
    }).slice(0, 100);
  }, [timezoneSearch, timezones]);

  const handleTimezoneSelect = (timezone: string) => {
    setProfileForm(prev => ({ ...prev, timezone }));
    setTimezoneSearch('');
    setIsTimezoneDropdownOpen(false);
  };

  const getSelectedTimezoneDisplay = () => {
    if (!profileForm.timezone) return '';
    return formatTimezone(profileForm.timezone);
  };

  const getRoleConfig = (role: string) => {
    return roleOptions.find(option => option.value === role) || roleOptions[1]; // Default to 'user'
  };

  const saveProfile = async () => {
    if (!user) return
    
    try {
      setSaving(true)
      setSuccessMessage('')
      setErrorMessage('')
      
      const { error } = await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          ...profileForm,
          updated_at: new Date().toISOString()
        })

      if (error) throw error
      
      setSuccessMessage('Profile updated successfully!')
      
    } catch (error) {
      console.error('Error saving profile:', error)
      setErrorMessage('Failed to save profile. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const currentRoleConfig = getRoleConfig(profileForm.role || profile?.role || 'user');

  return (
    <div className="space-y-4">
      {/* Profile Stats - Horizontal Compact Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200/50 rounded-xl p-3 hover:shadow-md transition-all duration-300">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg">
              <User className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-xs text-blue-700 font-medium">Profile</p>
              <p className="text-xl font-bold text-blue-900">{profileForm.full_name ? '✓' : '○'}</p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-purple-50 to-pink-50 border border-purple-200/50 rounded-xl p-3 hover:shadow-md transition-all duration-300">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg">
              <Crown className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-xs text-purple-700 font-medium">Plan</p>
              <p className="text-xl font-bold text-purple-900">{profile?.plan || 'Free'}</p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200/50 rounded-xl p-3 hover:shadow-md transition-all duration-300">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg">
              <Clock className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-xs text-emerald-700 font-medium">Member</p>
              <p className="text-xl font-bold text-emerald-900">
                {profile?.created_at ? new Date(profile.created_at).toLocaleDateString('en-US', { month: 'short' }) : 'New'}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-orange-50 to-red-50 border border-orange-200/50 rounded-xl p-3 hover:shadow-md transition-all duration-300">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-red-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg">
              <currentRoleConfig.icon className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-xs text-orange-700 font-medium">Role</p>
              <p className="text-xl font-bold text-orange-900">{currentRoleConfig.label}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white/80 backdrop-blur-sm border border-gray-200/50 rounded-xl p-4 shadow-sm">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-gray-900">Profile Information</h3>
          <p className="text-xs text-gray-600 mt-0.5">Update your personal details and preferences</p>
        </div>

        <div className="flex items-start gap-4 mb-6 pb-4 border-b border-gray-200">
          <div className="relative">
            <AvatarUpload
              currentAvatarUrl={profileForm.avatar_url}
              userName={profileForm.full_name}
              userEmail={user?.email}
              size="lg"
              onAvatarChange={(avatarUrl) => {
                setProfileForm(prev => ({ ...prev, avatar_url: avatarUrl }));
              }}
            />
          </div>

          <div className="flex-1">
            <h4 className="font-semibold text-gray-900 text-sm">
              {profileForm.full_name || user?.email || 'User'}
            </h4>
            <p className="text-xs text-gray-600 mt-0.5">
              {profileForm.job_title && profileForm.company
                ? `${profileForm.job_title} at ${profileForm.company}`
                : profileForm.job_title || profileForm.company || 'Complete your profile'
              }
            </p>

            <div className="flex items-center gap-2 mt-2">
              <div className="px-2 py-1 rounded bg-gray-100 border border-gray-200">
                <span className="text-xs font-semibold text-gray-700">{profile?.plan || 'Free'}</span>
              </div>
              <div className="px-2 py-1 rounded bg-gray-100 border border-gray-200">
                <span className="text-xs font-semibold text-gray-700">{currentRoleConfig.label}</span>
              </div>
              {profile?.created_at && (
                <span className="text-xs text-gray-500">
                  Since {new Date(profile.created_at).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Form Fields */}
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-gray-700">Full Name</label>
              <div className="relative">
                <User className="w-3.5 h-3.5 absolute left-2.5 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={profileForm.full_name || ''}
                  onChange={(e) => setProfileForm(prev => ({ ...prev, full_name: e.target.value }))}
                  className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-gray-300 focus:border-gray-300 bg-white text-gray-900 placeholder-gray-400"
                  placeholder="Enter your full name"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-gray-700">Email</label>
              <input
                type="email"
                value={user?.email || ''}
                disabled
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 text-gray-500"
              />
              <p className="text-xs text-gray-500">Email cannot be changed</p>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-gray-700">Company</label>
              <div className="relative">
                <Building className="w-3.5 h-3.5 absolute left-2.5 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={profileForm.company || ''}
                  onChange={(e) => setProfileForm(prev => ({ ...prev, company: e.target.value }))}
                  className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-gray-300 focus:border-gray-300 bg-white text-gray-900 placeholder-gray-400"
                  placeholder="Your company name"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-gray-700">Job Title</label>
              <div className="relative">
                <Briefcase className="w-3.5 h-3.5 absolute left-2.5 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={profileForm.job_title || ''}
                  onChange={(e) => setProfileForm(prev => ({ ...prev, job_title: e.target.value }))}
                  className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-gray-300 focus:border-gray-300 bg-white text-gray-900 placeholder-gray-400"
                  placeholder="Your job title"
                />
              </div>
            </div>

            {/* Role Selection */}
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-gray-700">Role</label>
              <div className="relative">
                <currentRoleConfig.icon className="w-3.5 h-3.5 absolute left-2.5 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <select
                  value={profileForm.role || profile?.role || 'user'}
                  onChange={(e) => setProfileForm(prev => ({ ...prev, role: e.target.value }))}
                  className="w-full pl-8 pr-8 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-gray-300 focus:border-gray-300 bg-white text-gray-900 appearance-none cursor-pointer"
                >
                  {roleOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
                  <svg className="h-3.5 w-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
              <p className="text-xs text-gray-500">{currentRoleConfig.description}</p>
            </div>
            
            {/* Smart Timezone Search */}
            <div className="space-y-1 relative">
              <label className="block text-xs font-semibold text-gray-700">Timezone</label>

              {/* Selected timezone display */}
              {profileForm.timezone && !isTimezoneDropdownOpen && (
                <div className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 mb-1">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <Clock className="w-3.5 h-3.5 text-gray-600" />
                      <span className="text-sm text-gray-900">{getSelectedTimezoneDisplay()}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setIsTimezoneDropdownOpen(true);
                        setTimezoneSearch('');
                      }}
                      className="text-gray-600 hover:text-gray-900 text-xs px-2 py-0.5 rounded"
                    >
                      Change
                    </button>
                  </div>
                </div>
              )}

              {/* Search input */}
              {(!profileForm.timezone || isTimezoneDropdownOpen) && (
                <>
                  <div className="relative">
                    <Clock className="w-3.5 h-3.5 absolute left-2.5 top-1/2 transform -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search timezone..."
                      value={timezoneSearch}
                      onChange={(e) => setTimezoneSearch(e.target.value)}
                      className="w-full pl-8 pr-8 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-gray-300 focus:border-gray-300 bg-white text-gray-900 placeholder-gray-400"
                      autoComplete="off"
                      autoFocus={isTimezoneDropdownOpen}
                    />

                    {/* Search/Clear icon */}
                    <div className="absolute inset-y-0 right-0 pr-2.5 flex items-center">
                      {timezoneSearch ? (
                        <button
                          type="button"
                          onClick={() => setTimezoneSearch('')}
                          className="text-gray-400 hover:text-gray-600"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <Search className="w-3.5 h-3.5 text-gray-400" />
                      )}
                    </div>
                  </div>

                  {/* Dropdown results */}
                  <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {filteredTimezones.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-gray-500">
                        {timezoneSearch.trim() ?
                          `No timezones found for "${timezoneSearch}"` :
                          'Start typing to search timezones...'
                        }
                      </div>
                    ) : (
                      <>
                        {timezoneSearch.trim() && (
                          <div className="px-3 py-1.5 text-xs text-gray-600 bg-gray-50 border-b border-gray-100">
                            {filteredTimezones.length} timezone{filteredTimezones.length !== 1 ? 's' : ''} found
                          </div>
                        )}

                        {filteredTimezones.map((timezone) => (
                          <button
                            key={timezone}
                            type="button"
                            onClick={() => handleTimezoneSelect(timezone)}
                            className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
                          >
                            <div className="font-medium text-gray-900 text-xs">
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
                  {profileForm.timezone && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsTimezoneDropdownOpen(false);
                        setTimezoneSearch('');
                      }}
                      className="mt-1 text-xs text-gray-500 hover:text-gray-700"
                    >
                      Cancel
                    </button>
                  )}
                </>
              )}
            </div>


            <div className="space-y-1">
              <label className="block text-xs font-semibold text-gray-700">Language</label>
              <div className="relative">
                <Globe className="w-3.5 h-3.5 absolute left-2.5 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value="English"
                  disabled
                  className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 text-gray-500"
                />
              </div>
              <p className="text-xs text-gray-500">Only English supported</p>
            </div>
          </div>
        </div>

        <div className="flex gap-2 pt-4 border-t border-gray-200 mt-4">
          <button
            onClick={saveProfile}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-emerald-500 to-green-600 text-white rounded-lg hover:from-emerald-600 hover:to-green-700 transition-colors text-xs font-semibold disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save Changes
          </button>
          <button
            onClick={() => setProfileForm(profile || {})}
            className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-colors text-xs font-semibold"
          >
            Cancel
          </button>
        </div>

        {/* Success/Error Messages - Below Save Button */}
        {successMessage && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 mt-3">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-600" />
              <p className="text-xs font-semibold text-emerald-900">{successMessage}</p>
            </div>
          </div>
        )}

        {errorMessage && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mt-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600" />
              <p className="text-xs font-semibold text-red-900">{errorMessage}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}