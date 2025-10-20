import { ExecutionContext } from '../agents/AgentExecutor';
import { projectContext } from '../services/projectContext';

export async function enrichClaudeContext(context: ExecutionContext, workspacePath: string): Promise<ExecutionContext> {
  if (!context.metadata) {
    context.metadata = {};
  }

  // Get project context
  const projectInfo = await projectContext.getProjectContext(
    workspacePath,
    context.metadata.activeFile as string | undefined
  );

  // Format for system message
  const systemContext = projectContext.formatForSystemMessage(projectInfo);

  // Store both formatted and raw context
  context.metadata.systemContext = systemContext;
  context.metadata.projectInfo = projectInfo;

  return context;
}