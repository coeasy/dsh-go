export interface MCPRuntimeBinding {
  serverId: string;
  capabilities: string[];
  permissions: string[];
}

export class MCPRuntimeBinder {
  bind(binding: MCPRuntimeBinding): MCPRuntimeBinding {
    return binding;
  }
}
