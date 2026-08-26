import { describe, expect, it } from 'vitest';
import { buildRuntimeToolCommand } from '../../runtime/mcp-tools.mjs';

describe('unified local runtime MCP tools', () => {
  it('routes lifecycle and execution tools through the official dsh entrypoint', () => {
    const install = buildRuntimeToolCommand('skill.install', { id: 'helper', version: '0.1.0', approved: true });
    expect(install.argv).toEqual(['node', 'bin/dsh.mjs', 'skill', 'install', 'helper@0.1.0', '--yes']);
    expect(install.requires_restart).toBe(true);

    const invoke = buildRuntimeToolCommand('mcp.invoke', { id: 'server', tool: 'echo', input: { value: 1 }, approved: true });
    expect(invoke.argv.slice(0, 6)).toEqual(['node', 'bin/dsh.mjs', 'mcp', 'invoke', 'server', 'echo']);
    expect(invoke.argv).toContain('--input');
    expect(invoke.requires_restart).toBe(false);
  });

  it('keeps legacy plugin tool names compatible', () => {
    const status = buildRuntimeToolCommand('plugin.status', { id: 'legacy' });
    expect(status.argv).toEqual(['node', 'bin/dsh.mjs', 'plugin', 'status', 'legacy']);
    expect(status.requires_approval).toBe(false);
  });
});
