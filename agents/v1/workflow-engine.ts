import type { AgentWorkflowStep } from './types';
import type { AgentToolRouter } from './tool-router';

export interface AgentWorkflow {
  agentId: string;
  steps: Array<string | AgentWorkflowStep>;
}

export interface WorkflowStepResult {
  tool: string;
  success: boolean;
  output?: unknown;
  error?: string;
}

export interface WorkflowResult {
  completed: boolean;
  steps: WorkflowStepResult[];
  error?: string;
}

export async function runWorkflow(workflow: AgentWorkflow, router?: AgentToolRouter): Promise<WorkflowResult> {
  if (!workflow.agentId.trim()) return { completed: false, steps: [], error: 'agent id is required' };
  if (workflow.steps.length > 0 && !router) return { completed: false, steps: [], error: 'agent tool router is required' };

  const results: WorkflowStepResult[] = [];
  for (const rawStep of workflow.steps) {
    const step = typeof rawStep === 'string' ? { tool: rawStep, input: undefined } : rawStep;
    try {
      const output = await router?.route(step.tool, step.input);
      results.push({ tool: step.tool, success: true, output });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ tool: step.tool, success: false, error: message });
      return { completed: false, steps: results, error: message };
    }
  }
  return { completed: true, steps: results };
}
