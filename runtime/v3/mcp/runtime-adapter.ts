export const RUNTIME_MCP_TOOL_NAMES = [
  'plugin.install',
  'plugin.update',
  'plugin.status',
  'plugin.health',
  'plugin.rollback',
  'plugin.enable',
  'plugin.disable',
  'plugin.repair',
] as const;

export type RuntimeMCPToolName = (typeof RUNTIME_MCP_TOOL_NAMES)[number];

export interface MCPRuntimeBinding {
  serverId: string;
  runtime: 'dsh-runtime-v3';
  transport: 'local';
  capabilities: string[];
  tools: RuntimeMCPToolName[];
}

export class MCPRuntimeAdapter {
  bind(serverId: string, capabilities: string[]): MCPRuntimeBinding {
    return {
      serverId,
      runtime: 'dsh-runtime-v3',
      transport: 'local',
      capabilities,
      tools: [...RUNTIME_MCP_TOOL_NAMES],
    };
  }
}
