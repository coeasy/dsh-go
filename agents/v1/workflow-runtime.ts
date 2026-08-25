export interface AgentWorkflowRuntime {
  agentId: string;
  workflow: string[];
  tools: string[];
  skills: string[];
}

export interface AgentWorkflowRuntimeOptions {
  workflow?: string[];
  tools?: string[];
  skills?: string[];
}

export function createWorkflowRuntime(
  agentId: string,
  options: AgentWorkflowRuntimeOptions = {},
): AgentWorkflowRuntime {
  if (!agentId.trim()) throw new Error('agent id is required');
  return {
    agentId,
    workflow: [...(options.workflow ?? [])],
    tools: [...new Set(options.tools ?? [])],
    skills: [...new Set(options.skills ?? [])],
  };
}
