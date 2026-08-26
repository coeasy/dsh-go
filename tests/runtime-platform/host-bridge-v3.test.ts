import { describe, expect, it } from 'vitest';

const { buildInstallUri, parseDshUri, runtimeArgsForRequest } = await import('../../runtime/host-bridge.mjs');

describe('Runtime Platform V3 unified host bridge', () => {
  it('preserves the Phase 7 plugin URI and adds typed package URIs', () => {
    expect(buildInstallUri('owner/plugin@1.0.0')).toBe('dsh://plugin/install/owner%2Fplugin%401.0.0');
    const mcpUri = buildInstallUri('owner/server@2.0.0', { type: 'mcp', channel: 'stable' });
    expect(mcpUri).toBe('dsh://package/install/mcp/owner%2Fserver%402.0.0?channel=stable');
    const parsed = parseDshUri(mcpUri);
    expect(parsed).toMatchObject({ kind: 'mcp', type: 'mcp', action: 'install', spec: 'owner/server@2.0.0', legacy: false });
    expect(runtimeArgsForRequest(parsed)).toEqual(['mcp', 'install', 'owner/server@2.0.0', '--channel', 'stable']);
  });

  it('accepts typed convenience URLs and rejects unsafe or unknown types', () => {
    expect(parseDshUri('dsh://skill/install/helper%401.0.0')).toMatchObject({ type: 'skill', kind: 'skill', spec: 'helper@1.0.0' });
    expect(parseDshUri('dsh://agent/install/worker%401.0.0')).toMatchObject({ type: 'agent', kind: 'agent' });
    expect(() => parseDshUri('dsh://package/install/tool/demo%401.0.0')).toThrow(/unsupported runtime package type/);
    expect(() => parseDshUri('dsh://package/install/mcp/..%2F..%2Fevil%401.0.0')).toThrow(/invalid runtime package spec|unsafe/);
  });
});
