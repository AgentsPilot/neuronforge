// Create this file: utils/scheduleFormatter.ts

export const formatScheduleDisplay = (mode: string, scheduleCron?: string): string => {
  if (mode === 'on_demand') {
    return 'Manual trigger only';
  }
  
  if (mode === 'scheduled' && scheduleCron) {
    return parseCronToHuman(scheduleCron);
  }
  
  return 'Not scheduled';
};

const parseCronToHuman = (cron: string): string => {
  if (!cron || typeof cron !== 'string') return 'Invalid schedule';
  
  const parts = cron.trim().split(' ');
  if (parts.length !== 5) return cron; // fallback to raw cron
  
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  
  try {
    // Convert hour to 12-hour format
    const hourNum = parseInt(hour);
    const minuteNum = parseInt(minute);
    
    if (isNaN(hourNum) || isNaN(minuteNum)) return cron;
    
    const time = hourNum === 0 ? `12:${minuteNum.toString().padStart(2, '0')} AM` : 
                 hourNum < 12 ? `${hourNum}:${minuteNum.toString().padStart(2, '0')} AM` :
                 hourNum === 12 ? `12:${minuteNum.toString().padStart(2, '0')} PM` :
                 `${hourNum - 12}:${minuteNum.toString().padStart(2, '0')} PM`;
    
    // Handle day of week
// Handle day of week
        if (dayOfWeek !== '*') {
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        
        // Handle multiple days (comma-separated)
        if (dayOfWeek.includes(',')) {
            const dayNames = dayOfWeek.split(',').map(d => {
            const dayNum = parseInt(d.trim());
            return days[dayNum] || `Day ${d.trim()}`;
            });
            return `${dayNames.join(' and ')} at ${time}`;
        } else {
            // Handle single day
            const dayName = days[parseInt(dayOfWeek)] || `Day ${dayOfWeek}`;
            return `${dayName}s at ${time}`;
        }
        }    
    // Handle daily
    if (dayOfMonth === '*' && month === '*') {
      return `Daily at ${time}`;
    }
    
    // Handle monthly
    if (dayOfMonth !== '*' && month === '*') {
      const getOrdinalSuffix = (num: number): string => {
        const j = num % 10;
        const k = num % 100;
        if (j == 1 && k != 11) return "st";
        if (j == 2 && k != 12) return "nd";
        if (j == 3 && k != 13) return "rd";
        return "th";
      };
      return `Monthly on the ${dayOfMonth}${getOrdinalSuffix(parseInt(dayOfMonth))} at ${time}`;
    }
    
    return cron; // fallback
  } catch (error) {
    return cron; // fallback to raw cron on any parsing error
  }
};