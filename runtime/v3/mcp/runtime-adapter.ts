import type { RuntimePackageType } from '../storage/persistence';

const PACKAGE_ACTIONS = ['install', 'update', 'status', 'health', 'rollback', 'enable', 'disable', 'repair'] as const;
export type RuntimePackageAction = (typeof PACKAGE_ACTIONS)[number];
export type RuntimeMCPToolName = `package.${RuntimePackageAction}` | `plugin.${RuntimePackageAction}`;

export const RUNTIME_MCP_TOOL_NAMES: RuntimeMCPToolName[] = [
  ...PACKAGE_ACTIONS.map((action) => `package.${action}` as const),
  ...PACKAGE_ACTIONS.map((action) => `plugin.${action}` as const),
];

export interface MCPRuntimeBinding {
  serverId: string;
  packageType: RuntimePackageType;
  runtime: 'dsh-runtime-v3';
  transport: 'local';
  capabilities: string[];
  tools: RuntimeMCPToolName[];
}

export class MCPRuntimeAdapter {
  bind(serverId: string, capabilities: string[], packageType: RuntimePackageType = 'mcp'): MCPRuntimeBinding {
    return {
      serverId,
      packageType,
      runtime: 'dsh-runtime-v3',
      transport: 'local',
      capabilities,
      tools: [...RUNTIME_MCP_TOOL_NAMES],
    };
  }
}
