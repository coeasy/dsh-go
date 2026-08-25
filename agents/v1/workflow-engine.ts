export interface AgentWorkflow {
  agentId: string;
  steps: string[];
}

export interface WorkflowResult {
  completed: boolean;
}

export function runWorkflow(workflow: AgentWorkflow): WorkflowResult {
  return { completed: workflow.steps.length >= 0 };
}
