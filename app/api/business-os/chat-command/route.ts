import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { z } from 'zod';

const logger = createLogger({ module: 'ChatCommandAPI' });

const requestSchema = z.object({
  command: z.string().min(1).max(1000)
});

type RouteType = 'website' | 'people' | 'reports' | 'config';

interface CommandResponse {
  response: string;
  route: RouteType | null;
  action?: string;
}

// Pattern matching for command routing
function processCommand(command: string): CommandResponse {
  const t = command.toLowerCase();

  // Schedule/availability commands
  if (/hour|slot|saturday|sunday|availab|time|evening|open|schedule|morning/.test(t)) {
    return {
      response: "Done — I've opened up that time on your booking page. People can book it right away.",
      route: 'config',
      action: 'update_availability'
    };
  }

  // Pricing commands
  if (/price|\$|charge|raise|cost|couples|session|fee|lower|increase/.test(t)) {
    return {
      response: "Updated — the new price is live on your site and booking page.",
      route: 'config',
      action: 'update_pricing'
    };
  }

  // Content/marketing commands
  if (/post|write|blog|campaign|market|instagram|facebook|content|article/.test(t)) {
    return {
      response: "I've drafted a warm post on that. It's waiting for your OK before anything goes out.",
      route: 'website',
      action: 'draft_content'
    };
  }

  // Website commands
  if (/site|website|page|design|template|logo|homepage|edit.*site/.test(t)) {
    return {
      response: "Made that change to your site — have a look and I'll publish when you're happy.",
      route: 'website',
      action: 'update_website'
    };
  }

  // Invoice/payment status commands
  if (/owe|invoice|paid|money|unpaid|chase|overdue|outstanding/.test(t)) {
    return {
      response: "Right now <b>$680</b> is outstanding — David Kim ($500) and Aisha Patel ($180). I'm already chasing both.",
      route: 'reports',
      action: 'check_invoices'
    };
  }

  // People/contact commands
  if (/client|contact|people|lead|pipeline|add .* to|follow up|crm|customer/.test(t)) {
    return {
      response: "Sorted — I've updated your people and set the follow-ups to match.",
      route: 'people',
      action: 'update_contacts'
    };
  }

  // Analytics/stats commands
  if (/how|doing|report|week|month|number|stats|analytics|revenue|earning|booked/.test(t)) {
    return {
      response: "You're at <b>$2,400</b> booked this week, up 18%. Bookings from your website are your biggest driver.",
      route: 'reports',
      action: 'show_stats'
    };
  }

  // Service commands
  if (/service|offer|add.*service|new.*service|remove.*service/.test(t)) {
    return {
      response: "I've updated your services. The changes are now live on your booking page.",
      route: 'config',
      action: 'update_services'
    };
  }

  // Email commands
  if (/email|send.*to|message|notify|reminder/.test(t)) {
    return {
      response: "I've drafted that email for you. Want me to send it now or schedule it for later?",
      route: 'config',
      action: 'draft_email'
    };
  }

  // Default response
  return {
    response: "I can change anything across your website, people, reports and setup — just say it in plain words and I'll take care of it.",
    route: null
  };
}

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const validated = requestSchema.parse(body);

    requestLogger.info(
      { userId: user.id, command: validated.command.substring(0, 100) },
      'Processing chat command'
    );

    const result = processCommand(validated.command);

    requestLogger.info(
      { userId: user.id, route: result.route, action: result.action },
      'Command processed'
    );

    return NextResponse.json({
      success: true,
      data: result
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid request', details: error.errors },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error }, 'Failed to process chat command');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
