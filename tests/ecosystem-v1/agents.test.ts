import { describe, expect, it } from 'vitest';
import { CapabilityGraph } from '../../agents/v1/capability-graph';
import { AgentToolRouter } from '../../agents/v1/tool-router';
import { runWorkflow } from '../../agents/v1/workflow-engine';

describe('Ecosystem Platform agents', () => {
  it('builds a deterministic capability graph', () => {
    const graph = new CapabilityGraph().build({ id: 'agent', tools: ['search', 'search'], skills: ['summarize'] });
    expect(graph.tools).toEqual(['search']);
    expect(graph.edges).toHaveLength(2);
    expect(new CapabilityGraph().canUseTool(graph, 'search')).toBe(true);
  });

  it('routes workflows through explicitly registered tools and stops on failure', async () => {
    const router = new AgentToolRouter();
    router.register({ name: 'echo', run: (input) => input });
    const ok = await runWorkflow({ agentId: 'agent', steps: [{ tool: 'echo', input: 'hello' }] }, router);
    expect(ok.completed).toBe(true);
    expect(ok.steps[0].output).toBe('hello');
    const failed = await runWorkflow({ agentId: 'agent', steps: ['missing'] }, router);
    expect(failed.completed).toBe(false);
    expect(failed.error).toMatch(/not registered/);
  });
});
