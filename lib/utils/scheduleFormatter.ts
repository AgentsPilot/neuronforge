// Updated scheduleFormatter.ts with proper timezone support
import parser from 'cron-parser';

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

// FIXED: Use proper cron-parser with timezone support
export const calculateNextRun = (cronExpression: string, timezone: string = 'UTC'): Date | null => {
  if (!cronExpression) return null;
  
  try {
    const interval = parser.parseExpression(cronExpression, {
      tz: timezone,
      currentDate: new Date(),
    });
    
    const nextRun = interval.next().toDate();
    
    // Debug logging for timezone issues
    console.log(`calculateNextRun debug:`, {
      cronExpression,
      timezone,
      nextRunUTC: nextRun.toISOString(),
      nextRunLocal: nextRun.toLocaleString('en-US', { timeZone: timezone }),
      currentTime: new Date().toISOString()
    });
    
    return nextRun;
  } catch (error) {
    console.error('Error calculating next run:', error);
    return null;
  }
};

// Format the next run time in relative terms with timezone support
export const formatNextRun = (nextRun: Date | string | null, timezone: string = 'UTC'): string => {
  if (!nextRun) return 'On demand';
  
  const nextRunDate = typeof nextRun === 'string' ? new Date(nextRun) : nextRun;
  const now = new Date();
  const diffMs = nextRunDate.getTime() - now.getTime();
  
  // If the time has passed, return "Soon" or "Overdue"
  if (diffMs <= 0) return 'Overdue';
  
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffDays > 1) {
    return `In ${diffDays} days`;
  } else if (diffDays === 1) {
    return 'Tomorrow';
  } else if (diffHours > 1) {
    return `In ${diffHours} hours`;
  } else if (diffMinutes > 1) {
    return `In ${diffMinutes} minutes`;
  } else if (diffMinutes === 1) {
    return 'In 1 minute';
  } else {
    return 'Soon';
  }
};

// Get absolute formatted time for next run
export const formatAbsoluteTime = (date: Date, timezone: string = 'UTC'): string => {
  return date.toLocaleString('en-US', {
    timeZone: timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
};

// Format execution duration in human readable form
export const formatDuration = (milliseconds: number): string => {
  if (milliseconds < 1000) {
    return `${milliseconds}ms`;
  }
  
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }
  
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
};

// Format relative time for last execution
export const formatLastRun = (date: string | Date): string => {
  const lastRun = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - lastRun.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffDays > 1) {
    return `${diffDays} days ago`;
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffHours > 1) {
    return `${diffHours} hours ago`;
  } else if (diffMinutes > 1) {
    return `${diffMinutes} minutes ago`;
  } else if (diffMinutes === 1) {
    return '1 minute ago';
  } else {
    return 'Just now';
  }
};

// Get next few runs for display
export const getUpcomingRuns = (cronExpression: string, timezone: string = 'UTC', count: number = 3): Date[] => {
  const runs: Date[] = [];
  
  try {
    let currentDate = new Date();
    
    for (let i = 0; i < count; i++) {
      const interval = parser.parseExpression(cronExpression, {
        tz: timezone,
        currentDate: currentDate,
      });
      
      const next = interval.next().toDate();
      runs.push(next);
      currentDate = new Date(next.getTime() + 60000); // Add 1 minute to get next occurrence
    }
  } catch (error) {
    console.error('Error getting upcoming runs:', error);
  }
  
  return runs;
};