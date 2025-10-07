import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { v4 as uuidv4 } from 'uuid'
import { AIAnalyticsService } from '@/lib/analytics/aiAnalytics'
import { OpenAIProvider } from '@/lib/ai/providers/openaiProvider'
import { 
  getConnectedPluginsWithMetadata, 
  getPluginDefinition, 
  pluginRegistry 
} from '@/lib/plugins/pluginRegistry'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Initialize AI Analytics
const aiAnalytics = new AIAnalyticsService(supabase)

// Helper function to validate UUID format
function isValidUUID(str: string): boolean {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  return uuidPattern.test(str)
}

// Detect mentioned services using plugin registry
function detectMentionedServices(prompt: string): string[] {
  const promptLower = prompt.toLowerCase();
  const mentionedServices: string[] = [];
  
  // Check against plugin registry
  for (const [pluginKey, pluginDef] of Object.entries(pluginRegistry)) {
    const serviceName = pluginDef.label.toLowerCase();
    const keyVariations = [
      pluginKey,
      serviceName,
      serviceName.replace(/\s+/g, ''),
      serviceName.replace(/\s+/g, '_'),
      serviceName.replace(/\s+/g, '-')
    ];
    
    const isDetected = keyVariations.some(variation => 
      promptLower.includes(variation)
    );
    
    if (isDetected && !mentionedServices.includes(pluginKey)) {
      mentionedServices.push(pluginKey);
    }
  }
  
  return mentionedServices;
}

// Validate mentioned plugins using plugin registry and database data
function validateConnectedPlugins(prompt: string, connectedPlugins: string[]): { 
  missingServices: string[], 
  availableServices: string[] 
} {
  const mentionedServices = detectMentionedServices(prompt);
  
  console.log('Plugin validation in clarification API:', {
    mentionedServices,
    connectedPlugins
  });
  
  const missingServices: string[] = [];
  const availableServices: string[] = [];
  
  mentionedServices.forEach(service => {
    if (connectedPlugins.includes(service)) {
      availableServices.push(service);
    } else {
      missingServices.push(service);
    }
  });
  
  return { missingServices, availableServices };
}

// FIXED: Only add these two standardized questions if AI doesn't generate them
function addStandardQuestionsIfMissing(questions: ClarificationQuestion[], userPrompt: string): ClarificationQuestion[] {
  const hasErrorHandling = questions.some(q => 
    q.dimension === 'error_handling' ||
    q.question.toLowerCase().includes('error') ||
    q.question.toLowerCase().includes('problem') ||
    q.question.toLowerCase().includes('fail')
  );

  const hasScheduling = questions.some(q => 
    q.dimension === 'scheduling_timing' ||
    q.question.toLowerCase().includes('when') ||
    q.question.toLowerCase().includes('schedule') ||
    q.question.toLowerCase().includes('frequency') ||
    q.question.toLowerCase().includes('time')
  );

  // Only add if missing and not already specified in user prompt
  const promptLower = userPrompt.toLowerCase();
  const userSpecifiedTiming = promptLower.includes('daily') || 
                              promptLower.includes('weekly') || 
                              promptLower.includes('monthly') ||
                              promptLower.includes('every') ||
                              /\d+\s*(am|pm|hour|minute)/.test(promptLower);

  const userSpecifiedErrorHandling = promptLower.includes('error') ||
                                     promptLower.includes('fail') ||
                                     promptLower.includes('retry') ||
                                     promptLower.includes('notify');

  // Add simple error handling if missing
// Find this section in your file and replace the error handling question:
if (!hasErrorHandling && !userSpecifiedErrorHandling) {
  questions.push({
    id: 'error_handling_standard',
    question: 'If something goes wrong, how should I be notified?',
    type: 'select',
    required: true,
    dimension: 'error_handling',
    placeholder: 'Choose notification method',
    options: [
      {
        value: 'email_me',
        label: 'Email me',
        description: 'Send an email notification when there\'s an issue'
      },
      {
        value: 'alert_me', 
        label: 'Alert me',
        description: 'Show a dashboard alert when there\'s a problem'
      },
      {
        value: 'retry_once',
        label: 'Retry (one time)',
        description: 'Try the automation once more before stopping'
      }
    ],
    allowCustom: false
  });
}
  // Add dynamic scheduling if missing
  if (!hasScheduling && !userSpecifiedTiming) {
    questions.push({
      id: 'schedule_frequency',
      question: 'How often should this automation run?',
      type: 'select',
      required: true,
      dimension: 'scheduling_timing',
      placeholder: 'Choose frequency',
      options: [
        { value: 'every_15_minutes', label: 'Every 15 minutes', description: 'Very frequent monitoring' },
        { value: 'hourly', label: 'Every hour', description: 'Regular hourly checks' },
        { value: 'every_4_hours', label: 'Every 4 hours', description: 'Several times per day' },
        { value: 'daily', label: 'Daily', description: 'Once per day' },
        { value: 'weekly', label: 'Weekly', description: 'Once per week' },
        { value: 'monthly', label: 'Monthly', description: 'Once per month' },
        { value: 'on_demand', label: 'Only when I trigger it', description: 'Manual execution only' }
      ],
      allowCustom: true,
      followUpQuestions: {
        'every_15_minutes': [
          {
            id: 'time_range_15min',
            question: 'During what hours should it run every 15 minutes?',
            type: 'select',
            required: true,
            options: [
              { value: 'business_hours', label: '9 AM to 5 PM', description: 'Only during work hours' },
              { value: 'extended_hours', label: '8 AM to 8 PM', description: 'Extended monitoring hours' },
              { value: 'all_day', label: '24/7', description: 'Around the clock monitoring' }
            ],
            allowCustom: true
          }
        ],
        'hourly': [
          {
            id: 'time_range_hourly',
            question: 'During what hours should it run every hour?',
            type: 'select',
            required: true,
            options: [
              { value: 'business_hours', label: '9 AM to 5 PM', description: 'Only during work hours' },
              { value: 'extended_hours', label: '8 AM to 8 PM', description: 'Extended hours' },
              { value: 'all_day', label: '24/7', description: 'All day monitoring' }
            ],
            allowCustom: true
          }
        ],
        'every_4_hours': [
          {
            id: 'start_time_4hour',
            question: 'What time should the 4-hour cycle start?',
            type: 'select',
            required: true,
            options: [
              { value: '8am', label: '8:00 AM', description: 'Start early morning (8 AM, 12 PM, 4 PM, 8 PM)' },
              { value: '9am', label: '9:00 AM', description: 'Start work day (9 AM, 1 PM, 5 PM, 9 PM)' },
              { value: '10am', label: '10:00 AM', description: 'Start mid-morning (10 AM, 2 PM, 6 PM, 10 PM)' }
            ],
            allowCustom: true
          }
        ],
        'daily': [
          {
            id: 'daily_time',
            question: 'What time each day should this run?',
            type: 'select',
            required: true,
            options: [
              { value: '6am', label: '6:00 AM', description: 'Very early morning' },
              { value: '8am', label: '8:00 AM', description: 'Early morning' },
              { value: '9am', label: '9:00 AM', description: 'Start of work day' },
              { value: '12pm', label: '12:00 PM', description: 'Midday' },
              { value: '3pm', label: '3:00 PM', description: 'Mid afternoon' },
              { value: '5pm', label: '5:00 PM', description: 'End of work day' },
              { value: '6pm', label: '6:00 PM', description: 'Early evening' },
              { value: '9pm', label: '9:00 PM', description: 'Evening' }
            ],
            allowCustom: true
          }
        ],
        'weekly': [
          {
            id: 'weekly_day',
            question: 'Which day of the week?',
            type: 'select',
            required: true,
            options: [
              { value: 'monday', label: 'Monday', description: 'Start of work week' },
              { value: 'tuesday', label: 'Tuesday', description: 'Early week' },
              { value: 'wednesday', label: 'Wednesday', description: 'Mid-week' },
              { value: 'thursday', label: 'Thursday', description: 'Late week' },
              { value: 'friday', label: 'Friday', description: 'End of work week' },
              { value: 'saturday', label: 'Saturday', description: 'Weekend' },
              { value: 'sunday', label: 'Sunday', description: 'Weekend/week preparation' }
            ],
            allowCustom: false,
            followUpQuestions: {
              'monday': [
                {
                  id: 'monday_time',
                  question: 'What time on Monday?',
                  type: 'select',
                  required: true,
                  options: [
                    { value: '8am', label: '8:00 AM', description: 'Early morning start' },
                    { value: '9am', label: '9:00 AM', description: 'Work day start' },
                    { value: '10am', label: '10:00 AM', description: 'Mid-morning' },
                    { value: '12pm', label: '12:00 PM', description: 'Midday' },
                    { value: '5pm', label: '5:00 PM', description: 'End of day' }
                  ],
                  allowCustom: true
                }
              ],
              'tuesday': [
                {
                  id: 'tuesday_time',
                  question: 'What time on Tuesday?',
                  type: 'select',
                  required: true,
                  options: [
                    { value: '8am', label: '8:00 AM', description: 'Early morning start' },
                    { value: '9am', label: '9:00 AM', description: 'Work day start' },
                    { value: '10am', label: '10:00 AM', description: 'Mid-morning' },
                    { value: '12pm', label: '12:00 PM', description: 'Midday' },
                    { value: '5pm', label: '5:00 PM', description: 'End of day' }
                  ],
                  allowCustom: true
                }
              ],
              'wednesday': [
                {
                  id: 'wednesday_time',
                  question: 'What time on Wednesday?',
                  type: 'select',
                  required: true,
                  options: [
                    { value: '8am', label: '8:00 AM', description: 'Early morning start' },
                    { value: '9am', label: '9:00 AM', description: 'Work day start' },
                    { value: '10am', label: '10:00 AM', description: 'Mid-morning' },
                    { value: '12pm', label: '12:00 PM', description: 'Midday' },
                    { value: '5pm', label: '5:00 PM', description: 'End of day' }
                  ],
                  allowCustom: true
                }
              ],
              'thursday': [
                {
                  id: 'thursday_time',
                  question: 'What time on Thursday?',
                  type: 'select',
                  required: true,
                  options: [
                    { value: '8am', label: '8:00 AM', description: 'Early morning start' },
                    { value: '9am', label: '9:00 AM', description: 'Work day start' },
                    { value: '10am', label: '10:00 AM', description: 'Mid-morning' },
                    { value: '12pm', label: '12:00 PM', description: 'Midday' },
                    { value: '5pm', label: '5:00 PM', description: 'End of day' }
                  ],
                  allowCustom: true
                }
              ],
              'friday': [
                {
                  id: 'friday_time',
                  question: 'What time on Friday?',
                  type: 'select',
                  required: true,
                  options: [
                    { value: '8am', label: '8:00 AM', description: 'Early morning start' },
                    { value: '9am', label: '9:00 AM', description: 'Work day start' },
                    { value: '10am', label: '10:00 AM', description: 'Mid-morning' },
                    { value: '12pm', label: '12:00 PM', description: 'Midday' },
                    { value: '3pm', label: '3:00 PM', description: 'Afternoon' },
                    { value: '5pm', label: '5:00 PM', description: 'End of work week' }
                  ],
                  allowCustom: true
                }
              ],
              'saturday': [
                {
                  id: 'saturday_time',
                  question: 'What time on Saturday?',
                  type: 'select',
                  required: true,
                  options: [
                    { value: '9am', label: '9:00 AM', description: 'Weekend morning' },
                    { value: '10am', label: '10:00 AM', description: 'Late morning' },
                    { value: '12pm', label: '12:00 PM', description: 'Midday' },
                    { value: '2pm', label: '2:00 PM', description: 'Afternoon' },
                    { value: '6pm', label: '6:00 PM', description: 'Evening' }
                  ],
                  allowCustom: true
                }
              ],
              'sunday': [
                {
                  id: 'sunday_time',
                  question: 'What time on Sunday?',
                  type: 'select',
                  required: true,
                  options: [
                    { value: '9am', label: '9:00 AM', description: 'Weekend morning' },
                    { value: '10am', label: '10:00 AM', description: 'Late morning' },
                    { value: '12pm', label: '12:00 PM', description: 'Midday' },
                    { value: '6pm', label: '6:00 PM', description: 'Sunday evening prep' },
                    { value: '8pm', label: '8:00 PM', description: 'Week preparation time' }
                  ],
                  allowCustom: true
                }
              ]
            }
          }
        ],
        'monthly': [
          {
            id: 'monthly_day_type',
            question: 'Which day of the month?',
            type: 'select',
            required: true,
            options: [
              { value: 'first_day', label: 'First day of the month', description: '1st of each month' },
              { value: 'specific_date', label: 'Specific date each month', description: 'Same date every month (e.g., 15th)' },
              { value: 'first_weekday', label: 'First weekday of the month', description: 'First Monday, Tuesday, etc.' },
              { value: 'last_day', label: 'Last day of the month', description: 'Final day of each month' },
              { value: 'last_weekday', label: 'Last weekday of the month', description: 'Last Friday, etc.' }
            ],
            allowCustom: false,
            followUpQuestions: {
              'first_day': [
                {
                  id: 'first_day_time',
                  question: 'What time on the 1st of each month?',
                  type: 'select',
                  required: true,
                  options: [
                    { value: '9am', label: '9:00 AM', description: 'Start of business day' },
                    { value: '12pm', label: '12:00 PM', description: 'Midday' },
                    { value: '5pm', label: '5:00 PM', description: 'End of business day' },
                    { value: '8pm', label: '8:00 PM', description: 'Evening' }
                  ],
                  allowCustom: true
                }
              ],
              'specific_date': [
                {
                  id: 'specific_date_day',
                  question: 'Which date each month?',
                  type: 'select',
                  required: true,
                  options: [
                    { value: '5th', label: '5th of each month', description: 'Early in the month' },
                    { value: '10th', label: '10th of each month', description: 'Early-mid month' },
                    { value: '15th', label: '15th of each month', description: 'Middle of month' },
                    { value: '20th', label: '20th of each month', description: 'Late in month' },
                    { value: '25th', label: '25th of each month', description: 'Near month end' }
                  ],
                  allowCustom: true,
                  followUpQuestions: {
                    '5th': [
                      {
                        id: 'fifth_time',
                        question: 'What time on the 5th?',
                        type: 'select',
                        required: true,
                        options: [
                          { value: '9am', label: '9:00 AM', description: 'Morning' },
                          { value: '12pm', label: '12:00 PM', description: 'Midday' },
                          { value: '5pm', label: '5:00 PM', description: 'Evening' }
                        ],
                        allowCustom: true
                      }
                    ],
                    '10th': [
                      {
                        id: 'tenth_time',
                        question: 'What time on the 10th?',
                        type: 'select',
                        required: true,
                        options: [
                          { value: '9am', label: '9:00 AM', description: 'Morning' },
                          { value: '12pm', label: '12:00 PM', description: 'Midday' },
                          { value: '5pm', label: '5:00 PM', description: 'Evening' }
                        ],
                        allowCustom: true
                      }
                    ],
                    '15th': [
                      {
                        id: 'fifteenth_time',
                        question: 'What time on the 15th?',
                        type: 'select',
                        required: true,
                        options: [
                          { value: '9am', label: '9:00 AM', description: 'Morning' },
                          { value: '12pm', label: '12:00 PM', description: 'Midday' },
                          { value: '5pm', label: '5:00 PM', description: 'Evening' }
                        ],
                        allowCustom: true
                      }
                    ],
                    '20th': [
                      {
                        id: 'twentieth_time',
                        question: 'What time on the 20th?',
                        type: 'select',
                        required: true,
                        options: [
                          { value: '9am', label: '9:00 AM', description: 'Morning' },
                          { value: '12pm', label: '12:00 PM', description: 'Midday' },
                          { value: '5pm', label: '5:00 PM', description: 'Evening' }
                        ],
                        allowCustom: true
                      }
                    ],
                    '25th': [
                      {
                        id: 'twentyfifth_time',
                        question: 'What time on the 25th?',
                        type: 'select',
                        required: true,
                        options: [
                          { value: '9am', label: '9:00 AM', description: 'Morning' },
                          { value: '12pm', label: '12:00 PM', description: 'Midday' },
                          { value: '5pm', label: '5:00 PM', description: 'Evening' }
                        ],
                        allowCustom: true
                      }
                    ]
                  }
                }
              ],
              'first_weekday': [
                {
                  id: 'first_weekday_type',
                  question: 'Which weekday?',
                  type: 'select',
                  required: true,
                  options: [
                    { value: 'first_monday', label: 'First Monday of each month', description: 'Start of work month' },
                    { value: 'first_tuesday', label: 'First Tuesday of each month', description: 'Early week start' },
                    { value: 'first_wednesday', label: 'First Wednesday of each month', description: 'Mid-week start' },
                    { value: 'first_friday', label: 'First Friday of each month', description: 'Week-end timing' }
                  ],
                  allowCustom: false,
                  followUpQuestions: {
                    'first_monday': [
                      {
                        id: 'first_monday_time',
                        question: 'What time on the first Monday?',
                        type: 'select',
                        required: true,
                        options: [
                          { value: '9am', label: '9:00 AM', description: 'Start of work day' },
                          { value: '12pm', label: '12:00 PM', description: 'Midday' },
                          { value: '5pm', label: '5:00 PM', description: 'End of work day' }
                        ],
                        allowCustom: true
                      }
                    ],
                    'first_tuesday': [
                      {
                        id: 'first_tuesday_time',
                        question: 'What time on the first Tuesday?',
                        type: 'select',
                        required: true,
                        options: [
                          { value: '9am', label: '9:00 AM', description: 'Start of work day' },
                          { value: '12pm', label: '12:00 PM', description: 'Midday' },
                          { value: '5pm', label: '5:00 PM', description: 'End of work day' }
                        ],
                        allowCustom: true
                      }
                    ],
                    'first_wednesday': [
                      {
                        id: 'first_wednesday_time',
                        question: 'What time on the first Wednesday?',
                        type: 'select',
                        required: true,
                        options: [
                          { value: '9am', label: '9:00 AM', description: 'Start of work day' },
                          { value: '12pm', label: '12:00 PM', description: 'Midday' },
                          { value: '5pm', label: '5:00 PM', description: 'End of work day' }
                        ],
                        allowCustom: true
                      }
                    ],
                    'first_friday': [
                      {
                        id: 'first_friday_time',
                        question: 'What time on the first Friday?',
                        type: 'select',
                        required: true,
                        options: [
                          { value: '9am', label: '9:00 AM', description: 'Start of work day' },
                          { value: '12pm', label: '12:00 PM', description: 'Midday' },
                          { value: '5pm', label: '5:00 PM', description: 'End of work day' }
                        ],
                        allowCustom: true
                      }
                    ]
                  }
                }
              ],
              'last_day': [
                {
                  id: 'last_day_time',
                  question: 'What time on the last day of each month?',
                  type: 'select',
                  required: true,
                  options: [
                    { value: '9am', label: '9:00 AM', description: 'Morning' },
                    { value: '12pm', label: '12:00 PM', description: 'Midday' },
                    { value: '5pm', label: '5:00 PM', description: 'End of business day' },
                    { value: '11pm', label: '11:00 PM', description: 'End of day processing' }
                  ],
                  allowCustom: true
                }
              ],
              'last_weekday': [
                {
                  id: 'last_weekday_type',
                  question: 'Which weekday?',
                  type: 'select',
                  required: true,
                  options: [
                    { value: 'last_monday', label: 'Last Monday of each month', description: 'End-month Monday' },
                    { value: 'last_wednesday', label: 'Last Wednesday of each month', description: 'End-month mid-week' },
                    { value: 'last_friday', label: 'Last Friday of each month', description: 'End-month Friday' }
                  ],
                  allowCustom: false,
                  followUpQuestions: {
                    'last_monday': [
                      {
                        id: 'last_monday_time',
                        question: 'What time on the last Monday?',
                        type: 'select',
                        required: true,
                        options: [
                          { value: '9am', label: '9:00 AM', description: 'Start of work day' },
                          { value: '12pm', label: '12:00 PM', description: 'Midday' },
                          { value: '5pm', label: '5:00 PM', description: 'End of work day' }
                        ],
                        allowCustom: true
                      }
                    ],
                    'last_wednesday': [
                      {
                        id: 'last_wednesday_time',
                        question: 'What time on the last Wednesday?',
                        type: 'select',
                        required: true,
                        options: [
                          { value: '9am', label: '9:00 AM', description: 'Start of work day' },
                          { value: '12pm', label: '12:00 PM', description: 'Midday' },
                          { value: '5pm', label: '5:00 PM', description: 'End of work day' }
                        ],
                        allowCustom: true
                      }
                    ],
                    'last_friday': [
                      {
                        id: 'last_friday_time',
                        question: 'What time on the last Friday?',
                        type: 'select',
                        required: true,
                        options: [
                          { value: '9am', label: '9:00 AM', description: 'Start of work day' },
                          { value: '12pm', label: '12:00 PM', description: 'Midday' },
                          { value: '5pm', label: '5:00 PM', description: 'End of work day' }
                        ],
                        allowCustom: true
                      }
                    ]
                  }
                }
              ]
            }
          }
        ]
      }
    });
  }

  return questions;
}

// COMPLETELY AI-DRIVEN SYSTEM PROMPT - NO HARDCODED QUESTIONS
export function buildClarifySystemPrompt(connectedPlugins: string[], missingServices: string[]) {
  const connectedPluginData = getConnectedPluginsWithMetadata(connectedPlugins);
  const pluginCapabilities = connectedPluginData.length > 0 
    ? connectedPluginData.map(p => `${p.label}: ${p.capabilities.join(', ')}`).join(' | ')
    : 'No plugins currently connected';
  
  let pluginInstructions = '';
  if (missingServices.length > 0) {
    const missingDisplayNames = missingServices.map(service => {
      const definition = getPluginDefinition(service);
      return definition?.displayName || definition?.label || service;
    });
    
    pluginInstructions = `
CRITICAL PLUGIN RESTRICTION: 
The user mentioned these services but they are NOT connected: ${missingDisplayNames.join(', ')}
DO NOT generate any questions that reference these missing services.
Instead, focus ONLY on the connected plugins and their capabilities.
`;
  }

  return `
You are the Clarification Engine for AgentPilot, a no-code AI agent platform for non-technical users.

Your role is to analyze ANY user automation request and generate the minimal essential questions needed to build a complete, actionable agent configuration.

INPUTS:
- userPrompt: The user's description of their desired automation (could be ANYTHING)
- connectedPlugins: List of currently authenticated integrations with their capabilities

CONNECTED PLUGINS AND CAPABILITIES:
${pluginCapabilities}

${pluginInstructions}

CORE PRINCIPLES:
1. SUPPORT ANY USER PROMPT - Don't assume specific automation types
2. Ask only the most essential questions needed to build the automation
3. Prioritize clarity over completeness - better fewer, targeted questions
4. ONLY reference services in the connected plugins list
5. Generate questions dynamically based on what the user actually wants to do

CRITICAL REQUIREMENTS:
- DO NOT include scheduling/timing questions (system handles this automatically)
- DO NOT include error handling questions (system adds standardized options)
- Focus on the core automation logic and data flow

ANALYSIS DIMENSIONS TO EVALUATE:

**Data & Input Sources (data_input)**
- What specific data does the automation need?
- Which connected plugins contain this data?
- Any filters, criteria, or timeframes needed?

**Processing & Logic (processing_logic)** 
- What operations should be performed?
- What format should outputs take?
- Any conditional rules or decision points?

**Output & Actions (output_actions)** 
- How should results be delivered?
- Where should results go using connected plugins?
- What delivery method should be used?

**Integration Requirements (integration_requirements)**
- How should data flow between connected tools?
- Any specific plugin configurations needed?

QUESTION GENERATION RULES:

1. ALWAYS use "select" type with 3-5 relevant options
2. NEVER use "text" or "textarea" types
3. Each question MUST have this exact structure:

{
  "id": "unique_id",
  "dimension": "data_input | processing_logic | output_actions | integration_requirements",
  "question": "Clear, specific question text",
  "type": "select",
  "options": [
    {
      "value": "option_value",
      "label": "User-friendly option label", 
      "description": "Brief explanation of what this option does"
    }
  ],
  "allowCustom": true,
  "required": true
}

EXAMPLES:

For "analyze customer feedback from emails and create reports":
[
  {
    "id": "email_source",
    "dimension": "data_input",
    "question": "Which emails should be analyzed for customer feedback?",
    "type": "select",
    "options": [
      {"value": "all_recent", "label": "All emails from last 30 days", "description": "Analyze recent email communications"},
      {"value": "specific_folders", "label": "Only emails in specific folders", "description": "Focus on organized customer feedback"},
      {"value": "keyword_filter", "label": "Emails containing feedback keywords", "description": "Search for emails with words like 'feedback', 'complaint', 'suggestion'"}
    ],
    "allowCustom": true,
    "required": true
  },
  {
    "id": "report_format",
    "dimension": "processing_logic",
    "question": "What type of customer feedback report should be created?",
    "type": "select",
    "options": [
      {"value": "summary_highlights", "label": "Summary with key highlights", "description": "Brief overview of main feedback themes"},
      {"value": "detailed_breakdown", "label": "Detailed breakdown by category", "description": "Organize feedback into complaints, suggestions, praise"},
      {"value": "action_items", "label": "Focus on actionable items", "description": "Highlight feedback requiring follow-up or action"}
    ],
    "allowCustom": true,
    "required": true
  },
  {
    "id": "report_delivery",
    "dimension": "output_actions",
    "question": "How should the feedback report be delivered?",
    "type": "select",
    "options": [
      {"value": "email_report", "label": "Send via email", "description": "Email the report to specified recipients"},
      {"value": "save_drive", "label": "Save to Google Drive", "description": "Store report in a shared Drive folder"},
      {"value": "both_email_drive", "label": "Email and save to Drive", "description": "Send via email and keep a copy in Drive"}
    ],
    "allowCustom": false,
    "required": true
  }
]

For "backup important files to cloud storage":
[
  {
    "id": "file_selection",
    "dimension": "data_input", 
    "question": "Which files should be backed up?",
    "type": "select",
    "options": [
      {"value": "recent_modified", "label": "Recently modified files", "description": "Files changed in the last week"},
      {"value": "specific_folders", "label": "Files from specific folders", "description": "Choose particular directories to backup"},
      {"value": "file_types", "label": "Specific file types", "description": "Focus on documents, images, or other file types"}
    ],
    "allowCustom": true,
    "required": true
  },
  {
    "id": "backup_organization",
    "dimension": "processing_logic",
    "question": "How should backed up files be organized?",
    "type": "select", 
    "options": [
      {"value": "maintain_structure", "label": "Keep original folder structure", "description": "Preserve the existing organization"},
      {"value": "date_folders", "label": "Organize by backup date", "description": "Create folders based on when backup was performed"},
      {"value": "file_type_folders", "label": "Group by file type", "description": "Separate documents, images, etc. into different folders"}
    ],
    "allowCustom": true,
    "required": true
  }
]

CRITICAL: 
- Adapt questions to the ACTUAL user prompt - don't force pre-defined patterns
- Ask what you genuinely need to know to build their specific automation
- Keep questions relevant to their connected services only
- Return ONLY the JSON array, no markdown formatting or explanatory text

Analyze the user's specific request and generate the minimal essential clarification questions needed.
`.trim()
}

interface ClarificationQuestion {
  id: string
  question: string
  placeholder?: string
  required?: boolean
  type: 'text' | 'textarea' | 'select' | 'multiselect' | 'enum' | 'date'
  options?: Array<{
    value: string
    label: string
    description: string
  }> | string[]
  dimension?: string
  allowCustom?: boolean
  followUpQuestions?: Record<string, ClarificationQuestion[]>
}

interface ClarificationResponse {
  questions: ClarificationQuestion[]
  reasoning: string
  confidence: number
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { 
      original_prompt, 
      agent_name, 
      description, 
      connected_plugins, 
      user_id,
      sessionId: providedSessionId,
      agentId: providedAgentId
    } = body

    if (!original_prompt?.trim()) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const sessionId = providedSessionId || 
                      request.headers.get('x-session-id') || 
                      uuidv4()

    const agentId = providedAgentId || 
                    request.headers.get('x-agent-id') || 
                    uuidv4()

    console.log('🆔 CLARIFICATION API - Using CONSISTENT agent ID:', {
      providedAgentId,
      providedSessionId,
      finalAgentId: agentId,
      finalSessionId: sessionId
    })

    // Get connected plugins from multiple sources
    let pluginKeys: string[] = []

    if (connected_plugins && typeof connected_plugins === 'object') {
      pluginKeys = Object.keys(connected_plugins)
    }

    if (user_id) {
      try {
        const { data: connections, error: pluginError } = await supabase
          .from('plugin_connections')
          .select('plugin_key')
          .eq('user_id', user_id)
          .eq('status', 'active')

        if (!pluginError && connections && connections.length > 0) {
          const dbPlugins = connections.map(c => c.plugin_key)
          pluginKeys = [...new Set([...pluginKeys, ...dbPlugins])]
        }
      } catch (dbError) {
        console.warn('Database plugin query failed, using frontend plugins:', dbError)
      }
    }

    if (pluginKeys.length === 0) {
      pluginKeys = ['google-mail', 'google-drive', 'chatgpt-research']
    }

    const { missingServices, availableServices } = validateConnectedPlugins(original_prompt, pluginKeys)
    
    let pluginWarning = null
    if (missingServices.length > 0) {
      const missingDisplayNames = missingServices.map(service => {
        const definition = getPluginDefinition(service);
        return definition?.displayName || definition?.label || service;
      });
      
      pluginWarning = {
        missingServices,
        message: `Note: Your request mentions ${missingDisplayNames.join(', ')} but ${missingServices.length === 1 ? 'this service isn\'t' : 'these services aren\'t'} connected. Questions will focus on your available services instead.`
      }
    }

    const connectedPluginData = getConnectedPluginsWithMetadata(pluginKeys);

    const contextMessage = `
user_prompt: "${original_prompt}"
connected_plugins: ${JSON.stringify(pluginKeys)}
agent_name: "${agent_name || 'Not specified'}"
description: "${description || 'Not provided'}"

IMPORTANT: Only ask questions about services in the connected_plugins list above. Do not reference any other services. Do not include scheduling/timing or error handling questions - the system handles these automatically.

Analyze this automation request and return the essential clarifying questions as a JSON array that will help build this specific automation.
`

    const openaiProvider = new OpenAIProvider(process.env.OPENAI_API_KEY!, aiAnalytics)
    
    const openAIResponse = await openaiProvider.chatCompletion(
      {
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: buildClarifySystemPrompt(pluginKeys, missingServices) },
          { role: 'user', content: contextMessage }
        ],
        temperature: 0.3,
        max_tokens: 1500
      },
      {
        userId: user_id,
        sessionId: sessionId,
        feature: 'clarification_questions',
        component: 'clarification-api',
        workflow_step: 'question_generation',
        category: 'agent_creation',
        activity_type: 'agent_creation',
        activity_name: 'Generating clarification questions for workflow automation',
        activity_step: 'question_generation',
        agent_id: agentId
      }
    )

    let content = openAIResponse.choices[0]?.message?.content || '[]'

    // Remove markdown wrapper
    content = content.trim()
    if (content.startsWith('```')) {
      content = content.replace(/```json|```/g, '').trim()
    }

    console.log('Raw GPT response:', content)
    
    let llmResponse
    try {
      llmResponse = JSON.parse(content)
    } catch (e) {
      console.error('GPT parse failure:', e)
      llmResponse = []
    }

    const clarificationData = await parseAndValidateLLMResponse(llmResponse, original_prompt)

    // Log analytics
    try {
      await supabase.from('clarification_analytics').insert([{
        user_id,
        original_prompt,
        agent_name,
        description,
        connected_plugins: pluginKeys,
        missing_services: missingServices,
        generated_questions: clarificationData.questions,
        questions_count: clarificationData.questions.length,
        agent_id: agentId,
        session_id: sessionId,
        generated_at: new Date().toISOString()
      }])
    } catch (analyticsError) {
      console.warn('Analytics logging failed:', analyticsError)
    }

    return NextResponse.json({
      ...clarificationData,
      connectedPluginData,
      agentId: agentId,
      sessionId: sessionId,
      ...(pluginWarning && { pluginWarning })
    })

  } catch (error) {
    console.error('Clarification API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function parseAndValidateLLMResponse(llmResponse: any, originalPrompt: string): Promise<ClarificationResponse> {
  try {
    let questionsArray: any[] = []
    
    if (Array.isArray(llmResponse)) {
      questionsArray = llmResponse
    } else if (llmResponse && typeof llmResponse === 'object') {
      if (llmResponse.questionsSequence && Array.isArray(llmResponse.questionsSequence)) {
        questionsArray = llmResponse.questionsSequence
      } else if (llmResponse.questions && Array.isArray(llmResponse.questions)) {
        questionsArray = llmResponse.questions
      } else {
        for (const [key, value] of Object.entries(llmResponse)) {
          if (Array.isArray(value) && value.length > 0) {
            questionsArray = value
            break
          }
        }
      }
    }

    const questions: ClarificationQuestion[] = questionsArray
      .map((q, i) => {
        if (!q || typeof q !== 'object') {
          return null
        }

        const type = (q.type || 'text').toLowerCase() as ClarificationQuestion['type']
        const structured = ['select', 'enum', 'multiselect'].includes(type)

        if (!q.question?.trim() || !q.type) {
          return null
        }
        
        if (structured && (!Array.isArray(q.options) || q.options.length < 2)) {
          return null
        }

        return {
          id: q.id || `question_${i + 1}`,
          question: q.question.trim(),
          type,
          required: q.required !== false,
          placeholder: q.placeholder || 'Choose from the options above',
          dimension: q.dimension || 'general',
          options: structured ? q.options : undefined,
          allowCustom: q.allowCustom,
          followUpQuestions: q.followUpQuestions
        }
      })
      .filter(Boolean) as ClarificationQuestion[]

    // Add standard questions only if missing
    const finalQuestions = addStandardQuestionsIfMissing(questions, originalPrompt);

    if (finalQuestions.length === 0) {
      return {
        questions: [
// In the fallback questions section, replace the error handling question:
        {
          id: 'error_handling_standard',
          question: 'If something goes wrong, how should I be notified?',
          type: 'select',
          required: true,
          dimension: 'error_handling',
          placeholder: 'Choose notification method',
          options: [
            {
              value: 'email_me',
              label: 'Email me',
              description: 'Send an email notification when there\'s an issue'
            },
            {
              value: 'alert_me',
              label: 'Alert me', 
              description: 'Show a dashboard alert when there\'s a problem'
            },
            {
              value: 'retry_once',
              label: 'Retry (one time)',
              description: 'Try the automation once more before stopping'
            }
          ],
          allowCustom: false
        },
          {
            id: 'schedule_frequency',
            question: 'How often should this automation run?',
            type: 'select',
            required: true,
            dimension: 'scheduling_timing',
            placeholder: 'Choose frequency',
            options: [
              { value: 'daily', label: 'Daily', description: 'Once per day' },
              { value: 'weekly', label: 'Weekly', description: 'Once per week' },
              { value: 'on_demand', label: 'Only when I trigger it', description: 'Manual execution only' }
            ],
            allowCustom: true,
            followUpQuestions: {
              'daily': [
                {
                  id: 'daily_time',
                  question: 'What time each day?',
                  type: 'select',
                  options: [
                    { value: '9am', label: '9:00 AM', description: 'Start of work day' },
                    { value: '5pm', label: '5:00 PM', description: 'End of work day' }
                  ]
                }
              ]
            }
          }
        ],
        reasoning: 'Using fallback questions with smart scheduling follow-ups.',
        confidence: 30
      }
    }

    return {
      questions: finalQuestions.slice(0, 8),
      reasoning: `Generated ${finalQuestions.length} targeted clarification questions with dynamic scheduling follow-ups.`,
      confidence: Math.min(95, 70 + (finalQuestions.length * 5))
    }

  } catch (e) {
    console.error('Parse validation error:', e)
    
    return {
      questions: [
        {
          id: 'error_fallback',
          question: 'Could you describe what you want this automation to accomplish?',
          type: 'select',
          required: true,
          dimension: 'processing_logic',
          options: [
            { value: 'process_emails', label: 'Process emails', description: 'Work with email data' },
            { value: 'create_reports', label: 'Create reports', description: 'Generate summaries or analysis' },
            { value: 'monitor_changes', label: 'Monitor for changes', description: 'Watch for updates or alerts' },
            { value: 'organize_files', label: 'Organize files', description: 'Manage documents or data' }
          ],
          allowCustom: true
        }
      ],
      reasoning: 'Unable to parse AI response, using basic fallback questions.',
      confidence: 30
    }
  }
}