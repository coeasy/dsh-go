import { describe, expect, it, vi } from 'vitest';

const { buildRuntimeToolCommand, executeRuntimeTool } = await import('../../runtime/mcp-tools.mjs');

describe('local Runtime MCP tools', () => {
  it('maps mutating tools to local CLI commands and restart semantics', () => {
    const plan = buildRuntimeToolCommand('plugin.install', { id: 'demo', version: '0.1.0', channel: 'stable' });
    expect(plan.transport).toBe('local');
    expect(plan.argv).toContain('demo@0.1.0');
    expect(plan.requires_restart).toBe(true);
  });

  it('executes only through explicitly supplied local handlers', async () => {
    const handler = vi.fn(async () => ({ ok: true }));
    const result = await executeRuntimeTool('plugin.health', { id: 'demo' }, { 'plugin.health': handler });
    expect(result.executed).toBe(true);
    expect(handler).toHaveBeenCalledOnce();
    const unbound = await executeRuntimeTool('plugin.rollback', { id: 'demo' });
    expect(unbound.executed).toBe(false);
    expect(unbound.plan.requires_local_runtime).toBe(true);
  });
});
