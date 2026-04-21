// app/api/v2/calibrate/inspect/route.ts
// Diagnostic endpoint to inspect agent structure and identify issues

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedServerClient } from '@/lib/supabaseServerAuth';
import { PreFlightValidator } from '@/lib/pilot/validation/PreFlightValidator';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'InspectAPI', service: 'calibration' });

export async function POST(req: NextRequest) {
  try {
    // Authenticate
    const supabase = await createAuthenticatedServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get agentId
    const { agentId } = await req.json();

    if (!agentId) {
      return NextResponse.json({ error: 'Missing agentId' }, { status: 400 });
    }

    // Fetch agent
    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select('*')
      .eq('id', agentId)
      .eq('user_id', user.id)
      .single();

    if (agentError || !agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // Run pre-flight validation
    const validator = new PreFlightValidator();
    const validation = validator.validate(agent);

    // Collect step diagnostics
    const stepDiagnostics = (agent.pilot_steps || []).map((step: any, index: number) => ({
      index,
      id: step.id || `<missing>`,
      type: step.type || `<missing>`,
      name: step.name || `<missing>`,
      plugin: step.plugin || (step.type === 'action' ? `<missing>` : 'n/a'),
      action: step.action || (step.type === 'action' ? `<missing>` : 'n/a'),
      hasParams: !!step.params,
      hasConfig: !!step.config,
      issues: []
    }));

    // Add validation issues to relevant steps
    validation.issues.forEach(issue => {
      issue.affectedSteps.forEach(affectedStep => {
        const diagnostic = stepDiagnostics.find(d => d.id === affectedStep.id);
        if (diagnostic) {
          diagnostic.issues.push({
            type: issue.type,
            severity: issue.severity,
            title: issue.title,
            description: issue.description
          });
        }
      });
    });

    return NextResponse.json({
      success: true,
      agent: {
        id: agent.id,
        name: agent.agent_name,
        status: agent.status,
        hasPilotSteps: !!agent.pilot_steps,
        pilotStepsCount: agent.pilot_steps?.length || 0,
        hasAgentWorkflow: !!agent.agent_workflow
      },
      validation: {
        valid: validation.valid,
        canExecute: validation.canExecute,
        totalIssues: validation.issues.length,
        criticalIssues: validation.criticalIssues.length,
        warningIssues: validation.warningIssues.length
      },
      steps: stepDiagnostics,
      issues: validation.issues.map(issue => ({
        id: issue.id,
        type: issue.type,
        severity: issue.severity,
        title: issue.title,
        description: issue.description,
        affectedSteps: issue.affectedSteps.map(s => s.id),
        suggestions: issue.suggestions
      }))
    });

  } catch (error: any) {
    logger.error({ err: error }, 'Inspection failed');
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
