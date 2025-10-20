import { projectContextService } from '@/lib/services/projectContextService';
import { ExecutionContext } from './AgentExecutor';

export async function enrichClaudeContext(context: ExecutionContext, workspacePath: string): Promise<ExecutionContext> {
  // Get project context
  const projectContext = await projectContextService.getProjectContext(
    workspacePath,
    context.metadata?.activeFile
  );

  // Format context for Claude
  const projectContextString = projectContextService.formatContextForClaude(projectContext);

  // Add project context to the system message
  if (!context.metadata) {
    context.metadata = {};
  }
  
  if (!context.metadata.systemContext) {
    context.metadata.systemContext = '';
  }

  context.metadata.systemContext = `${projectContextString}\n\n${context.metadata.systemContext}`;
  context.metadata.projectContext = projectContext;

  return context;
}