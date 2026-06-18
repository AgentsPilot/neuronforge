// Debug session manager for workflow execution debugging
interface DebugSession {
  sessionId: string;
  agentId: string;
  userId: string;
  createdAt: Date;
  events: any[];
}

export class DebugSessionManager {
  private static instance: DebugSessionManager;
  private static sessions: Map<string, DebugSession> = new Map();

  static getInstance(): DebugSessionManager {
    if (!DebugSessionManager.instance) {
      DebugSessionManager.instance = new DebugSessionManager();
    }
    return DebugSessionManager.instance;
  }

  static getSession(sessionId: string): DebugSession | undefined {
    return DebugSessionManager.sessions.get(sessionId);
  }

  static createSession(sessionId: string, agentId: string, userId: string): DebugSession {
    const session: DebugSession = {
      sessionId,
      agentId,
      userId,
      createdAt: new Date(),
      events: []
    };
    DebugSessionManager.sessions.set(sessionId, session);
    return session;
  }

  static deleteSession(sessionId: string): void {
    DebugSessionManager.sessions.delete(sessionId);
  }

  static cleanup(sessionId: string): void {
    DebugSessionManager.sessions.delete(sessionId);
  }

  static emitEvent(sessionId: string, event: any): void {
    const session = DebugSessionManager.sessions.get(sessionId);
    if (session) {
      session.events.push({ ...event, timestamp: new Date() });
    }
  }

  static async checkPause(sessionId: string): Promise<void> {
    // Placeholder for debug pause functionality
    // Can be extended to support breakpoints and step-through debugging
    const session = DebugSessionManager.sessions.get(sessionId);
    if (!session) return;
    // Future: check if session has pause flag set and wait
  }

  startSession(workflowId: string): string {
    return 'debug-' + workflowId + '-' + new Date().getTime();
  }

  logEvent(sessionId: string, event: any): void {
    const session = DebugSessionManager.sessions.get(sessionId);
    if (session) {
      session.events.push({ ...event, timestamp: new Date() });
    }
  }

  endSession(sessionId: string): void {
    DebugSessionManager.sessions.delete(sessionId);
  }
}
