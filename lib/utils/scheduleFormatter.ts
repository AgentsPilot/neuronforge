// Updated scheduleFormatter.ts with new execution tracking functions

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

// NEW FUNCTIONS FOR EXECUTION TRACKING

// Calculate when the agent should run next
export const calculateNextRun = (cronExpression: string, lastRun?: string): Date | null => {
  if (!cronExpression) return null;
  
  try {
    const parts = cronExpression.split(' ');
    if (parts.length !== 5) return null;
    
    const [minute, hour, dayMonth, month, dayWeek] = parts;
    
    const now = new Date();
    const next = new Date();
    
    // Set the target time
    next.setHours(parseInt(hour), parseInt(minute), 0, 0);
    
    // Handle different schedule types
    if (dayWeek !== '*') {
      // Weekly schedule
      const targetDay = parseInt(dayWeek);
      const currentDay = now.getDay();
      let daysUntil = (targetDay - currentDay + 7) % 7;
      
      if (daysUntil === 0 && now >= next) {
        daysUntil = 7; // Next week
      }
      
      next.setDate(now.getDate() + daysUntil);
    } else if (dayMonth !== '*') {
      // Monthly schedule
      const targetDate = parseInt(dayMonth);
      next.setDate(targetDate);
      
      // If the target date has passed this month, go to next month
      if (now >= next) {
        next.setMonth(next.getMonth() + 1);
        next.setDate(targetDate);
      }
    } else {
      // Daily schedule
      if (now >= next) {
        next.setDate(next.getDate() + 1);
      }
    }
    
    return next;
  } catch (error) {
    console.error('Error calculating next run:', error);
    return null;
  }
};

// Format the next run time in relative terms
export const formatNextRun = (nextRun: Date | null): string => {
  if (!nextRun) return 'On demand';
  
  const now = new Date();
  const diffMs = nextRun.getTime() - now.getTime();
  
  // If the time has passed, return "Soon" or "Overdue"
  if (diffMs <= 0) return 'Soon';
  
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
export const formatAbsoluteTime = (date: Date): string => {
  return date.toLocaleString('en-US', {
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
export const getUpcomingRuns = (cronExpression: string, count: number = 3): Date[] => {
  const runs: Date[] = [];
  let current = new Date();
  
  for (let i = 0; i < count; i++) {
    const next = calculateNextRun(cronExpression);
    if (next) {
      runs.push(next);
      current = new Date(next.getTime() + 60000); // Add 1 minute to get next occurrence
    }
  }
  
  return runs;
};