export interface AgentCapability {
  id: string;
  tools: string[];
  skills: string[];
}

export class CapabilityGraph {
  build(agent: AgentCapability): AgentCapability {
    return agent;
  }
}
