export interface AgentTool {
  name: string;
  run(input: unknown): unknown;
}

export class AgentToolRouter {
  private tools = new Map<string, AgentTool>();

  register(tool: AgentTool) {
    this.tools.set(tool.name, tool);
  }

  route(name: string, input: unknown) {
    return this.tools.get(name)?.run(input);
  }
}
