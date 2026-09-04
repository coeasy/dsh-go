import { normalizePackageType } from '../../packages/protocol-core/index.mjs';
import { pluginRuntimeAdapter } from './plugin.mjs';
import { mcpRuntimeAdapter } from './mcp.mjs';
import { skillRuntimeAdapter } from './skill.mjs';
import { agentRuntimeAdapter } from './agent.mjs';

const ADAPTERS = Object.freeze({
  plugin: pluginRuntimeAdapter,
  mcp: mcpRuntimeAdapter,
  skill: skillRuntimeAdapter,
  agent: agentRuntimeAdapter,
});

export function getRuntimeAdapter(type) {
  return ADAPTERS[normalizePackageType(type)];
}

export function runtimeAdapterContract() {
  return Object.fromEntries(Object.entries(ADAPTERS).map(([type, adapter]) => [type, {
    type,
    abi_version: adapter.abi_version,
    methods: ['validate', 'prepare', 'bind', 'activate', 'health', 'deactivate', 'cleanup'],
  }]));
}

export { RUNTIME_ADAPTER_ABI_VERSION, createRuntimeAdapter } from './base.mjs';
