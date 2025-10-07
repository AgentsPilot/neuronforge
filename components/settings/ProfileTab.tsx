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
    <div className="space-y-6">
      {/* Profile Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="group relative overflow-hidden bg-gradient-to-br from-purple-50 to-indigo-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-indigo-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-indigo-500 rounded-2xl flex items-center justify-center shadow-lg">
              <User className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-purple-700 font-semibold">Profile</p>
              <p className="text-2xl font-bold text-purple-900">{profileForm.full_name ? '✓' : '○'}</p>
            </div>
          </div>
        </div>

        <div className="group relative overflow-hidden bg-gradient-to-br from-indigo-50 to-purple-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Crown className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-indigo-700 font-semibold">Plan</p>
              <p className="text-2xl font-bold text-indigo-900">{profile?.plan || 'Free'}</p>
            </div>
          </div>
        </div>

        <div className="group relative overflow-hidden bg-gradient-to-br from-purple-50 to-violet-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-violet-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-violet-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Clock className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-purple-700 font-semibold">Member</p>
              <p className="text-2xl font-bold text-purple-900">
                {profile?.created_at ? new Date(profile.created_at).toLocaleDateString('en-US', { month: 'short' }) : 'New'}
              </p>
            </div>
          </div>
        </div>

        <div className={`group relative overflow-hidden bg-gradient-to-br ${currentRoleConfig.bgColor} p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300`}>
          <div className={`absolute inset-0 bg-gradient-to-br ${currentRoleConfig.color}/10 opacity-0 group-hover:opacity-100 transition-opacity`}></div>
          <div className="relative flex items-center gap-3">
            <div className={`w-12 h-12 bg-gradient-to-br ${currentRoleConfig.color} rounded-2xl flex items-center justify-center shadow-lg`}>
              <currentRoleConfig.icon className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className={`text-sm font-semibold ${currentRoleConfig.textColor}`}>Role</p>
              <p className={`text-2xl font-bold ${currentRoleConfig.textColor.replace('700', '900')}`}>{currentRoleConfig.label}</p>
            </div>
          </div>
        </div>
      </div>
      
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-2xl flex items-center justify-center shadow-lg">
            <User className="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-800">Profile Information</h3>
            <p className="text-sm text-slate-600 font-medium">Update your personal details and preferences</p>
          </div>
        </div>

        <div className="flex items-start gap-6 mb-8">
          {/* Avatar Section */}
          <div className="relative group">
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
            <div className="mb-4">
              <h4 className="font-bold text-slate-900 text-lg">
                {profileForm.full_name || user?.email || 'User'}
              </h4>
              <p className="text-sm text-slate-600 font-medium">
                {profileForm.job_title && profileForm.company 
                  ? `${profileForm.job_title} at ${profileForm.company}`
                  : profileForm.job_title || profileForm.company || 'Complete your profile'
                }
              </p>
            </div>
            
            <div className="flex items-center gap-4">
              <div className={`px-4 py-2 rounded-xl shadow-sm ${
                profile?.plan === 'Pro' 
                  ? 'bg-gradient-to-r from-purple-50 to-indigo-50 text-purple-800'
                  : 'bg-gradient-to-r from-indigo-50 to-purple-50 text-indigo-800'
              }`}>
                <span className="text-sm font-bold">{profile?.plan || 'Free'} Plan</span>
              </div>
              <div className={`px-4 py-2 rounded-xl shadow-sm bg-gradient-to-r ${currentRoleConfig.bgColor} ${currentRoleConfig.textColor}`}>
                <span className="text-sm font-bold">{currentRoleConfig.label}</span>
              </div>
              {profile?.created_at && (
                <span className="text-sm text-slate-500 font-medium">
                  Member since {new Date(profile.created_at).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Form Fields */}
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="block text-sm font-bold text-slate-700">Full Name</label>
              <div className="relative">
                <User className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={profileForm.full_name || ''}
                  onChange={(e) => setProfileForm(prev => ({ ...prev, full_name: e.target.value }))}
                  className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-slate-900 font-medium placeholder-slate-400"
                  placeholder="Enter your full name"
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <label className="block text-sm font-bold text-slate-700">Email</label>
              <input
                type="email"
                value={user?.email || ''}
                disabled
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl bg-gray-100 text-slate-500 font-medium"
              />
              <p className="text-xs text-slate-500 font-medium">Email cannot be changed from this panel</p>
            </div>
            
            <div className="space-y-2">
              <label className="block text-sm font-bold text-slate-700">Company</label>
              <div className="relative">
                <Building className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={profileForm.company || ''}
                  onChange={(e) => setProfileForm(prev => ({ ...prev, company: e.target.value }))}
                  className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-slate-900 font-medium placeholder-slate-400"
                  placeholder="Your company name"
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <label className="block text-sm font-bold text-slate-700">Job Title</label>
              <div className="relative">
                <Briefcase className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={profileForm.job_title || ''}
                  onChange={(e) => setProfileForm(prev => ({ ...prev, job_title: e.target.value }))}
                  className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-slate-900 font-medium placeholder-slate-400"
                  placeholder="Your job title"
                />
              </div>
            </div>

            {/* Role Selection */}
            <div className="space-y-2">
              <label className="block text-sm font-bold text-slate-700">Role</label>
              <div className="relative">
                <currentRoleConfig.icon className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
                <select
                  value={profileForm.role || profile?.role || 'user'}
                  onChange={(e) => setProfileForm(prev => ({ ...prev, role: e.target.value }))}
                  className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-slate-900 font-medium appearance-none cursor-pointer"
                >
                  {roleOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                  <svg className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
              <p className="text-xs text-slate-500 font-medium">{currentRoleConfig.description}</p>
            </div>
            
            {/* Smart Timezone Search */}
            <div className="space-y-2 relative">
              <label className="block text-sm font-bold text-slate-700">Timezone</label>
              
              {/* Selected timezone display */}
              {profileForm.timezone && !isTimezoneDropdownOpen && (
                <div className="w-full px-3 py-3 border-2 border-gray-200 rounded-xl bg-blue-50 text-blue-900 mb-2">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-blue-600" />
                      <span className="text-sm font-medium">{getSelectedTimezoneDisplay()}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setIsTimezoneDropdownOpen(true);
                        setTimezoneSearch('');
                      }}
                      className="text-blue-600 hover:text-blue-800 text-sm px-2 py-1 rounded"
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
                    <Clock className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search timezone (e.g., New York, PST, Japan)..."
                      value={timezoneSearch}
                      onChange={(e) => setTimezoneSearch(e.target.value)}
                      className="w-full pl-10 pr-10 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-slate-900 font-medium placeholder-slate-400"
                      autoComplete="off"
                      autoFocus={isTimezoneDropdownOpen}
                    />
                    
                    {/* Search/Clear icon */}
                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                      {timezoneSearch ? (
                        <button
                          type="button"
                          onClick={() => setTimezoneSearch('')}
                          className="text-slate-400 hover:text-slate-600"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      ) : (
                        <Search className="w-4 h-4 text-slate-400" />
                      )}
                    </div>
                  </div>

                  {/* Dropdown results */}
                  <div className="absolute z-50 w-full mt-1 bg-white border-2 border-gray-200 rounded-xl shadow-lg max-h-60 overflow-y-auto">
                    {filteredTimezones.length === 0 ? (
                      <div className="px-4 py-3 text-sm text-gray-500">
                        {timezoneSearch.trim() ? 
                          `No timezones found for "${timezoneSearch}"` :
                          'Start typing to search timezones...'
                        }
                      </div>
                    ) : (
                      <>
                        {/* Search hint */}
                        {timezoneSearch.trim() && (
                          <div className="px-4 py-2 text-xs text-indigo-600 bg-indigo-50 border-b border-gray-100">
                            {filteredTimezones.length} timezone{filteredTimezones.length !== 1 ? 's' : ''} found
                          </div>
                        )}
                        
                        {filteredTimezones.map((timezone) => (
                          <button
                            key={timezone}
                            type="button"
                            onClick={() => handleTimezoneSelect(timezone)}
                            className="w-full px-4 py-3 text-left text-sm hover:bg-indigo-50 focus:bg-indigo-50 focus:outline-none"
                          >
                            <div className="font-medium text-slate-900">
                              {formatTimezone(timezone)}
                            </div>
                            <div className="text-xs text-slate-500">
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
                      className="mt-2 text-sm text-gray-500 hover:text-gray-700"
                    >
                      Cancel
                    </button>
                  )}
                </>
              )}
            </div>
            
            <div className="space-y-2">
              <label className="block text-sm font-bold text-slate-700">Language</label>
              <div className="relative">
                <Globe className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value="English"
                  disabled
                  className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 rounded-xl bg-gray-100 text-slate-500 font-medium"
                />
              </div>
              <p className="text-xs text-slate-500 font-medium">Currently only English is supported</p>
            </div>
          </div>
        </div>
        
        <div className="flex gap-3 pt-8 border-t border-gray-200 mt-8">
          <button 
            onClick={saveProfile}
            disabled={saving}
            className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl hover:from-indigo-700 hover:to-purple-700 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105 font-semibold disabled:opacity-50 disabled:transform-none"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Changes
          </button>
          <button 
            onClick={() => setProfileForm(profile || {})}
            className="px-6 py-3 bg-white border-2 border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 hover:border-gray-400 transition-all duration-300 shadow-sm hover:shadow-md font-semibold"
          >
            Cancel
          </button>
        </div>

        {/* Success/Error Messages - Below Save Button */}
        {successMessage && (
          <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-2xl p-4 shadow-lg mt-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-r from-purple-500 to-indigo-500 rounded-xl flex items-center justify-center shadow-lg">
                <CheckCircle className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="font-semibold text-purple-800">Success!</p>
                <p className="text-sm text-purple-700">{successMessage}</p>
              </div>
            </div>
          </div>
        )}
        
        {errorMessage && (
          <div className="bg-gradient-to-r from-red-50 to-pink-50 rounded-2xl p-4 shadow-lg mt-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-r from-red-500 to-pink-500 rounded-xl flex items-center justify-center shadow-lg">
                <AlertCircle className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="font-semibold text-red-800">Error</p>
                <p className="text-sm text-red-700">{errorMessage}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}