import { describe, expect, it } from 'vitest';
import { discoverMCP } from '../../mcp/v1/discovery';
import { installMCP } from '../../mcp/v1/install-flow';
import { checkMCPPermissions } from '../../mcp/v1/permission-check';
import { MCPRuntimeBinder } from '../../mcp/v1/runtime-binding';

const servers = [
  { id: 'search', name: 'Search', version: '0.1.0', capabilities: ['search'], permissions: { network: true } },
  { id: 'local', name: 'Local', version: '0.1.0', capabilities: ['files'], permissions: { filesystem: true } },
];

describe('Ecosystem Platform MCP', () => {
  it('discovers by capability and denies ungranted permissions by default', () => {
    expect(discoverMCP(servers, { capability: 'search' }).map((item) => item.id)).toEqual(['search']);
    expect(checkMCPPermissions(['network']).allowed).toBe(false);
    expect(checkMCPPermissions(['network'], ['network']).allowed).toBe(true);
  });

  it('plans installs and bindings without claiming remote side effects', () => {
    const denied = installMCP('search', { requestedPermissions: ['network'] });
    expect(denied.state).toBe('failed');
    const planned = installMCP('search', { requestedPermissions: ['network'], grantedPermissions: ['network'] });
    expect(planned.state).toBe('planned');
    expect(planned.plan?.requiresLocalRuntime).toBe(true);

    const binder = new MCPRuntimeBinder();
    expect(binder.bind({ serverId: 'search', capabilities: ['search'], permissions: ['network'] }, { grantedPermissions: ['network'] }).bound).toBe(false);
    expect(binder.bind({ serverId: 'search', capabilities: ['search'], permissions: ['network'] }, { localRuntime: true, grantedPermissions: ['network'] }).bound).toBe(true);
  });
});
