export interface AgentManifest {
  id: string;
  version: string;
  tools: string[];
  skills: string[];
  workflow?: string;
}

export interface AgentWorkflowStep {
  id?: string;
  tool: string;
  input?: unknown;
}
