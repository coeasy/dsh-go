export type AgentWorkflow = {
  agentId: string;
  steps: string[];
};

export function createWorkflow(agentId: string, steps: string[]): AgentWorkflow {
  if (!agentId.trim()) throw new Error('agent id is required');
  return { agentId, steps: [...steps] };
}
