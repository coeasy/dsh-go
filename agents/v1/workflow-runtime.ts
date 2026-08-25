export interface AgentWorkflowRuntime {
  agentId: string;
  workflow: string[];
  tools: string[];
}

export function createWorkflowRuntime(agentId: string): AgentWorkflowRuntime {
  return { agentId, workflow: [], tools: [] };
}
