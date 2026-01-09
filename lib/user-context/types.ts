/**
 * User context for LLM personalization
 * Used across agent creation, workflow execution, and other AI-powered features
 */
export interface UserContext {
  full_name?: string;
  email?: string;
  role?: string;
  company?: string;
  domain?: string;
}
