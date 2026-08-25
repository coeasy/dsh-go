export type AgentWorkflow = {
  agentId: string;
  steps: string[];
};

export function createWorkflow(agentId: string, steps: string[]): AgentWorkflow {
  return { agentId, steps };
}
