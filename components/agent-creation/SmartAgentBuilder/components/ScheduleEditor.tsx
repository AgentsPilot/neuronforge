// components/agent-creation/SmartAgentBuilder/components/ScheduleEditor.tsx

import React, { useState, useEffect } from 'react';
import { Clock, Calendar, PlayCircle, ChevronDown } from 'lucide-react';

interface ScheduleEditorProps {
  mode?: 'on_demand' | 'scheduled';
  scheduleCron?: string | null;
  isEditing: boolean;
  onUpdate: (updates: { mode?: string; schedule_cron?: string | null }) => void;
}

export default function ScheduleEditor({
  mode = 'on_demand',
  scheduleCron,
  isEditing,
  onUpdate
}: ScheduleEditorProps) {
  const [currentMode, setCurrentMode] = useState(mode);
  const [selectedTime, setSelectedTime] = useState('09:00');
  const [selectedFrequency, setSelectedFrequency] = useState('daily');
  const [selectedDays, setSelectedDays] = useState<string[]>(['monday']);
  const [selectedMonthDay, setSelectedMonthDay] = useState('1');

  const timeOptions = [
    '06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00',
    '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00'
  ];

  const dayOptions = [
    { value: 'monday', short: 'M' }, { value: 'tuesday', short: 'T' },
    { value: 'wednesday', short: 'W' }, { value: 'thursday', short: 'T' },
    { value: 'friday', short: 'F' }, { value: 'saturday', short: 'S' }, { value: 'sunday', short: 'S' }
  ];

  const dayToCron = {
    'monday': '1', 'tuesday': '2', 'wednesday': '3', 'thursday': '4',
    'friday': '5', 'saturday': '6', 'sunday': '0'
  };

  const cronToDay = {
    '1': 'monday', '2': 'tuesday', '3': 'wednesday', '4': 'thursday',
    '5': 'friday', '6': 'saturday', '0': 'sunday'
  };

  useEffect(() => {
    if (scheduleCron) {
      const parts = scheduleCron.split(' ');
      if (parts.length >= 5) {
        const minute = parts[0];
        const hour = parts[1];
        const dayOfMonth = parts[2];
        const dayOfWeek = parts[4];
        
        const timeStr = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
        setSelectedTime(timeStr);
        
        if (dayOfWeek === '1-5') {
          setSelectedFrequency('weekdays');
        } else if (dayOfWeek === '*') {
          if (dayOfMonth === '*') {
            setSelectedFrequency('daily');
          } else {
            setSelectedFrequency('monthly');
            setSelectedMonthDay(dayOfMonth);
          }
        } else {
          setSelectedFrequency('weekly');
          const days = dayOfWeek.split(',').map(d => cronToDay[d]).filter(Boolean);
          setSelectedDays(days);
        }
      }
    }
  }, [scheduleCron]);

  const generateCron = () => {
    const [hour, minute] = selectedTime.split(':');
    
    switch (selectedFrequency) {
      case 'daily': return `${minute} ${hour} * * *`;
      case 'weekdays': return `${minute} ${hour} * * 1-5`;
      case 'weekly': 
        const cronDays = selectedDays.map(day => dayToCron[day]).join(',');
        return `${minute} ${hour} * * ${cronDays}`;
      case 'monthly': return `${minute} ${hour} ${selectedMonthDay} * *`;
      default: return `${minute} ${hour} * * *`;
    }
  };

  const formatTime = (time: string) => {
    const [hour, minute] = time.split(':');
    const h = parseInt(hour);
    const period = h >= 12 ? 'PM' : 'AM';
    const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${displayHour}:${minute} ${period}`;
  };

  const getScheduleDescription = () => {
    const timeDesc = formatTime(selectedTime);
    switch (selectedFrequency) {
      case 'daily': return `Daily at ${timeDesc}`;
      case 'weekdays': return `Weekdays at ${timeDesc}`;
      case 'weekly':
        const dayNames = selectedDays.map(day => dayOptions.find(d => d.value === day)?.short).join(',');
        return `${dayNames} at ${timeDesc}`;
      case 'monthly': return `${selectedMonthDay}${['th','st','nd','rd'][selectedMonthDay.slice(-1)] || 'th'} monthly at ${timeDesc}`;
      default: return `Daily at ${timeDesc}`;
    }
  };

  const handleModeChange = (newMode: 'on_demand' | 'scheduled') => {
    setCurrentMode(newMode);
    onUpdate({ mode: newMode, schedule_cron: newMode === 'scheduled' ? generateCron() : null });
  };

  const handleTimeChange = (time: string) => {
    setSelectedTime(time);
    if (currentMode === 'scheduled') {
      const [hour, minute] = time.split(':');
      let cronValue;
      switch (selectedFrequency) {
        case 'daily': cronValue = `${minute} ${hour} * * *`; break;
        case 'weekdays': cronValue = `${minute} ${hour} * * 1-5`; break;
        case 'weekly': 
          const cronDays = selectedDays.map(day => dayToCron[day]).join(',');
          cronValue = `${minute} ${hour} * * ${cronDays}`;
          break;
        case 'monthly': cronValue = `${minute} ${hour} ${selectedMonthDay} * *`; break;
        default: cronValue = `${minute} ${hour} * * *`;
      }
      onUpdate({ schedule_cron: cronValue });
    }
  };

  const handleFrequencyChange = (frequency: string) => {
    setSelectedFrequency(frequency);
    if (currentMode === 'scheduled') {
      const [hour, minute] = selectedTime.split(':');
      let cronValue;
      switch (frequency) {
        case 'daily': cronValue = `${minute} ${hour} * * *`; break;
        case 'weekdays': cronValue = `${minute} ${hour} * * 1-5`; break;
        case 'weekly': 
          const cronDays = selectedDays.map(day => dayToCron[day]).join(',');
          cronValue = `${minute} ${hour} * * ${cronDays}`;
          break;
        case 'monthly': cronValue = `${minute} ${hour} ${selectedMonthDay} * *`; break;
        default: cronValue = `${minute} ${hour} * * *`;
      }
      onUpdate({ schedule_cron: cronValue });
    }
  };

  const handleDayToggle = (day: string) => {
    const newDays = selectedDays.includes(day)
      ? selectedDays.filter(d => d !== day)
      : [...selectedDays, day];
    const finalDays = newDays.length > 0 ? newDays : ['monday'];
    setSelectedDays(finalDays);
    
    if (currentMode === 'scheduled' && selectedFrequency === 'weekly') {
      const [hour, minute] = selectedTime.split(':');
      const cronDays = finalDays.map(day => dayToCron[day]).join(',');
      onUpdate({ schedule_cron: `${minute} ${hour} * * ${cronDays}` });
    }
  };

  const handleMonthlyDayChange = (day: string) => {
    setSelectedMonthDay(day);
    if (currentMode === 'scheduled') {
      const [hour, minute] = selectedTime.split(':');
      onUpdate({ schedule_cron: `${minute} ${hour} ${day} * *` });
    }
  };

  return (
    <div className="space-y-3">
      {/* Current Schedule - Modern glassmorphism */}
      {scheduleCron && (
        <div className="relative overflow-hidden bg-gradient-to-r from-violet-500 via-purple-500 to-indigo-500 rounded-xl px-4 py-3 text-white shadow-lg">
          <div className="absolute inset-0 bg-white/10 backdrop-blur-sm"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center backdrop-blur-sm">
              <Clock className="h-4 w-4" />
            </div>
            <div>
              <div className="font-semibold text-sm">{getScheduleDescription()}</div>
              <div className="inline-flex items-center px-3 py-1 bg-white/20 backdrop-blur-sm rounded-full text-xs text-white/90 font-medium border border-white/10">
                Active schedule
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mode Selection - Modern cards */}
      <div className="flex gap-3">
        <button
          onClick={() => handleModeChange('on_demand')}
          disabled={!isEditing}
          className={`group flex-1 relative overflow-hidden rounded-xl p-3 transition-all duration-300 ${
            currentMode === 'on_demand'
              ? 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg shadow-blue-500/25 scale-[1.02]'
              : 'bg-white/80 backdrop-blur-sm border border-gray-200/50 hover:border-gray-300/50 hover:shadow-md'
          } ${!isEditing ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          <div className="relative z-10 flex items-center gap-2">
            <div className={`w-6 h-6 rounded-lg flex items-center justify-center transition-colors ${
              currentMode === 'on_demand' ? 'bg-white/20' : 'bg-blue-100'
            }`}>
              <PlayCircle className={`h-3 w-3 ${currentMode === 'on_demand' ? 'text-white' : 'text-blue-600'}`} />
            </div>
            <div className="text-left">
              <div className="text-sm font-semibold">Manual</div>
              <div className={`text-xs ${currentMode === 'on_demand' ? 'text-white/80' : 'text-gray-600'}`}>
                Run when needed
              </div>
            </div>
          </div>
          {currentMode !== 'on_demand' && (
            <div className="absolute inset-0 bg-gradient-to-br from-blue-50/50 to-indigo-50/50 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          )}
        </button>
        
        <button
          onClick={() => handleModeChange('scheduled')}
          disabled={!isEditing}
          className={`group flex-1 relative overflow-hidden rounded-xl p-3 transition-all duration-300 ${
            currentMode === 'scheduled'
              ? 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/25 scale-[1.02]'
              : 'bg-white/80 backdrop-blur-sm border border-gray-200/50 hover:border-gray-300/50 hover:shadow-md'
          } ${!isEditing ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          <div className="relative z-10 flex items-center gap-2">
            <div className={`w-6 h-6 rounded-lg flex items-center justify-center transition-colors ${
              currentMode === 'scheduled' ? 'bg-white/20' : 'bg-emerald-100'
            }`}>
              <Calendar className={`h-3 w-3 ${currentMode === 'scheduled' ? 'text-white' : 'text-emerald-600'}`} />
            </div>
            <div className="text-left">
              <div className="text-sm font-semibold">Scheduled</div>
              <div className={`text-xs ${currentMode === 'scheduled' ? 'text-white/80' : 'text-gray-600'}`}>
                Run automatically
              </div>
            </div>
          </div>
          {currentMode !== 'scheduled' && (
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/50 to-teal-50/50 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          )}
        </button>
      </div>

      {/* Schedule Options - Modern glass container */}
      {currentMode === 'scheduled' && (
        <div className="relative overflow-hidden bg-white/60 backdrop-blur-xl rounded-2xl border border-white/20 shadow-xl p-4 space-y-3">
          <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent"></div>
          
          {/* Time & Frequency - Modern selectors */}
          <div className="relative z-10 grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-700">Time</label>
              <div className="relative group">
                <select
                  value={selectedTime}
                  onChange={(e) => handleTimeChange(e.target.value)}
                  disabled={!isEditing}
                  className="w-full px-3 py-2.5 text-sm bg-white/80 backdrop-blur-sm border-0 rounded-xl shadow-sm focus:ring-2 focus:ring-indigo-500/50 focus:shadow-lg transition-all appearance-none cursor-pointer disabled:opacity-60 font-medium"
                >
                  {timeOptions.map(time => (
                    <option key={time} value={time}>{formatTime(time)}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none group-hover:text-gray-600 transition-colors" />
              </div>
            </div>
            
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-700">Frequency</label>
              <div className="relative group">
                <select
                  value={selectedFrequency}
                  onChange={(e) => handleFrequencyChange(e.target.value)}
                  disabled={!isEditing}
                  className="w-full px-3 py-2.5 text-sm bg-white/80 backdrop-blur-sm border-0 rounded-xl shadow-sm focus:ring-2 focus:ring-indigo-500/50 focus:shadow-lg transition-all appearance-none cursor-pointer disabled:opacity-60 font-medium"
                >
                  <option value="daily">Daily</option>
                  <option value="weekdays">Weekdays</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
                <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none group-hover:text-gray-600 transition-colors" />
              </div>
            </div>
          </div>

          {/* Weekly Days - Smaller modern button grid */}
          {selectedFrequency === 'weekly' && (
            <div className="relative z-10 space-y-2">
              <label className="text-xs font-medium text-gray-700">Days</label>
              <div className="grid grid-cols-7 gap-1">
                {dayOptions.map((day) => (
                  <button
                    key={day.value}
                    onClick={() => handleDayToggle(day.value)}
                    disabled={!isEditing}
                    className={`w-7 h-7 rounded-lg text-xs font-semibold transition-all duration-200 hover:scale-105 ${
                      selectedDays.includes(day.value)
                        ? 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/25'
                        : 'bg-white/80 backdrop-blur-sm border border-gray-200/50 text-gray-700 hover:border-gray-300/50 hover:shadow-md'
                    } ${!isEditing ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    {day.short}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Monthly Day - Modern selector */}
          {selectedFrequency === 'monthly' && (
            <div className="relative z-10 space-y-2">
              <label className="text-xs font-medium text-gray-700">Day of month</label>
              <div className="relative group">
                <select
                  value={selectedMonthDay}
                  onChange={(e) => handleMonthlyDayChange(e.target.value)}
                  disabled={!isEditing}
                  className="w-full px-3 py-2.5 text-sm bg-white/80 backdrop-blur-sm border-0 rounded-xl shadow-sm focus:ring-2 focus:ring-indigo-500/50 focus:shadow-lg transition-all appearance-none cursor-pointer disabled:opacity-60 font-medium"
                >
                  {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                    <option key={day} value={day.toString()}>
                      {day}{['th','st','nd','rd'][day%10] || 'th'} day
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none group-hover:text-gray-600 transition-colors" />
              </div>
            </div>
          )}

          {/* Preview - Modern pill */}
          <div className="relative z-10 inline-flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-emerald-500/10 to-teal-500/10 backdrop-blur-sm rounded-full border border-emerald-200/50">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
            <span className="text-xs font-medium text-emerald-700">{getScheduleDescription()}</span>
          </div>
        </div>
      )}
    </div>
  );
}