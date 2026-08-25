export interface MCPRuntimeBinding {
  serverId: string;
  runtime: string;
  capabilities: string[];
}

export class MCPRuntimeAdapter {
  bind(serverId: string, capabilities: string[]): MCPRuntimeBinding {
    return { serverId, runtime: 'dsh-runtime-v3', capabilities };
  }
}
