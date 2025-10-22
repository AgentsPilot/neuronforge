// lib/agentkit/agentkitClient.ts

import OpenAI from "openai";

// Singleton OpenAI client for AgentKit
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// AgentKit Configuration
export const AGENTKIT_CONFIG = {
  model: "gpt-4o",
  temperature: 0.1,
  maxIterations: 10, // Maximum function call loops to prevent infinite execution
  timeout: 120000, // 2 minutes timeout for long-running operations
};
