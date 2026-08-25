export interface AgentTool {
  name: string;
  run(input: unknown): unknown | Promise<unknown>;
}

export class AgentToolRouter {
  private readonly tools = new Map<string, AgentTool>();

  register(tool: AgentTool): void {
    if (!tool.name.trim()) throw new Error('agent tool name is required');
    this.tools.set(tool.name, tool);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  async route(name: string, input: unknown): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`agent tool not registered: ${name}`);
    return tool.run(input);
  }
}
