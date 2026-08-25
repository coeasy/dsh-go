export interface AgentCapability {
  id: string;
  tools: string[];
  skills: string[];
}

export interface AgentCapabilityGraph extends AgentCapability {
  nodes: string[];
  edges: Array<{ from: string; to: string; type: 'tool' | 'skill' }>;
}

export class CapabilityGraph {
  build(agent: AgentCapability): AgentCapabilityGraph {
    const tools = [...new Set(agent.tools)].sort();
    const skills = [...new Set(agent.skills)].sort();
    return {
      id: agent.id,
      tools,
      skills,
      nodes: [agent.id, ...tools, ...skills],
      edges: [
        ...tools.map((tool) => ({ from: agent.id, to: tool, type: 'tool' as const })),
        ...skills.map((skill) => ({ from: agent.id, to: skill, type: 'skill' as const })),
      ],
    };
  }

  canUseTool(graph: AgentCapabilityGraph, tool: string): boolean {
    return graph.tools.includes(tool);
  }
}
