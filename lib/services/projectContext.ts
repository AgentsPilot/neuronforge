import { exec } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ProjectContext {
  projectName: string;
  projectType: string;
  framework: string;
  activeFile?: string;
  gitInfo?: {
    repository: string;
    branch: string;
    owner: string;
  };
  dependencies?: Record<string, string>;
  workspaceFiles?: string[];
}

export class ProjectContextService {
  private static instance: ProjectContextService;

  private constructor() {}

  static getInstance(): ProjectContextService {
    if (!ProjectContextService.instance) {
      ProjectContextService.instance = new ProjectContextService();
    }
    return ProjectContextService.instance;
  }

  async getProjectContext(workspacePath: string, activeFilePath?: string): Promise<ProjectContext> {
    const [packageJson, gitInfo, workspaceFiles] = await Promise.all([
      this.readPackageJson(workspacePath),
      this.getGitInfo(workspacePath),
      this.getWorkspaceFiles(workspacePath)
    ]);

    return {
      projectName: packageJson.name || path.basename(workspacePath),
      projectType: this.determineProjectType(packageJson),
      framework: this.determineFramework(packageJson),
      activeFile: activeFilePath,
      gitInfo,
      dependencies: packageJson.dependencies,
      workspaceFiles
    };
  }

  formatForSystemMessage(context: ProjectContext): string {
    let message = `You are assisting with a ${context.projectType} project named "${context.projectName}" using ${context.framework}.\n\n`;

    if (context.activeFile) {
      message += `Current file: ${context.activeFile}\n\n`;
    }

    if (context.gitInfo) {
      message += `Git repository: ${context.gitInfo.owner}/${context.gitInfo.repository} (${context.gitInfo.branch})\n\n`;
    }

    if (context.dependencies) {
      message += 'Key dependencies:\n';
      Object.entries(context.dependencies)
        .filter(([name]) => !name.startsWith('@types/'))
        .forEach(([name, version]) => {
          message += `- ${name}: ${version}\n`;
        });
      message += '\n';
    }

    if (context.workspaceFiles && context.workspaceFiles.length > 0) {
      message += 'Key workspace files:\n';
      context.workspaceFiles.forEach(file => {
        message += `- ${file}\n`;
      });
    }

    return message;
  }

  private async readPackageJson(workspacePath: string): Promise<any> {
    try {
      const packageJsonPath = path.join(workspacePath, 'package.json');
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      console.warn('Failed to read package.json:', error);
      return {};
    }
  }

  private determineProjectType(packageJson: any): string {
    if (packageJson.dependencies?.['next']) return 'Next.js';
    if (packageJson.dependencies?.['react']) return 'React';
    if (packageJson.dependencies?.['vue']) return 'Vue.js';
    if (packageJson.dependencies?.['express']) return 'Node.js/Express';
    return 'Node.js';
  }

  private determineFramework(packageJson: any): string {
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    
    if (deps['next']) return 'Next.js';
    if (deps['react']) return 'React';
    if (deps['vue']) return 'Vue.js';
    if (deps['express']) return 'Express';
    if (deps['fastify']) return 'Fastify';
    return 'None';
  }

  private async getWorkspaceFiles(workspacePath: string): Promise<string[]> {
    try {
      const ignoreDirs = new Set(['.git', 'node_modules', '.next', 'out', 'build', 'dist']);
      const { stdout } = await execAsync('git ls-files', { cwd: workspacePath });
      
      return stdout
        .split('\n')
        .filter(file => file && !ignoreDirs.has(file.split('/')[0]))
        .slice(0, 100); // Limit to first 100 files to keep context manageable
    } catch (error) {
      console.warn('Failed to get workspace files:', error);
      return [];
    }
  }

  private async getGitInfo(workspacePath: string): Promise<ProjectContext['gitInfo'] | undefined> {
    try {
      const [{ stdout: remoteUrl }, { stdout: branch }] = await Promise.all([
        execAsync('git config --get remote.origin.url', { cwd: workspacePath }),
        execAsync('git rev-parse --abbrev-ref HEAD', { cwd: workspacePath })
      ]);

      // Extract owner and repo from remote URL
      const match = remoteUrl.trim().match(/[:/]([^/]+)\/([^.]+)(?:\.git)?$/);
      if (!match) return undefined;

      return {
        owner: match[1],
        repository: match[2],
        branch: branch.trim()
      };
    } catch (error) {
      console.warn('Failed to get git info:', error);
      return undefined;
    }
  }
}

export const projectContext = ProjectContextService.getInstance();