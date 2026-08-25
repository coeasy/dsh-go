import { describe, expect, it } from 'vitest';

const {
  buildInstallUri,
  parseDshUri,
  protocolRegistration,
  runtimeArgsForRequest,
} = await import('../../runtime/host-bridge.mjs');

describe('Phase 7 host bridge', () => {
  it('builds and parses the canonical install URI', () => {
    const uri = buildInstallUri('coeasy/example@0.1.0', { channel: 'stable' });
    expect(uri).toBe('dsh://plugin/install/coeasy%2Fexample%400.1.0?channel=stable');
    expect(parseDshUri(uri)).toEqual({
      protocol: 'dsh',
      kind: 'plugin',
      action: 'install',
      spec: 'coeasy/example@0.1.0',
      channel: 'stable',
      legacy: false,
    });
  });

  it('keeps the existing marketplace dsh://install URI compatible', () => {
    const request = parseDshUri('dsh://install?plugin=ruvnet%2Fruflo');
    expect(request.spec).toBe('ruvnet/ruflo');
    expect(request.legacy).toBe(true);
    expect(runtimeArgsForRequest(request)).toEqual(['install', 'ruvnet/ruflo']);
  });

  it('rejects non-dsh protocols and unsafe plugin specs', () => {
    expect(() => parseDshUri('https://example.com/plugin')).toThrow(/unsupported protocol/);
    expect(() => parseDshUri('dsh://install?plugin=..%2F..%2Fevil')).toThrow(/invalid plugin spec/);
    expect(() => buildInstallUri('owner/repo\n--force')).toThrow(/invalid plugin spec/);
  });

  it('returns platform-specific registration contracts', () => {
    const linux = protocolRegistration({
      platform: 'linux',
      executable: '/usr/bin/node',
      scriptPath: '/opt/dsh/bin/dsh.mjs',
      desktopFile: '/tmp/dsh-go.desktop',
    });
    expect(linux.supported).toBe(true);
    expect(linux.desktop_content).toContain('MimeType=x-scheme-handler/dsh;');
    expect(linux.desktop_content).toContain('host handle %u');

    const windows = protocolRegistration({
      platform: 'win32',
      executable: 'C:\\node.exe',
      scriptPath: 'C:\\dsh\\bin\\dsh.mjs',
    });
    expect(windows.supported).toBe(true);
    expect((windows.commands ?? []).some((entry) => entry[0] === 'reg.exe')).toBe(true);

    const mac = protocolRegistration({
      platform: 'darwin',
      executable: '/usr/local/bin/node',
      scriptPath: '/Applications/DSH.app/dsh.mjs',
    });
    expect(mac.supported).toBe(false);
    expect(mac.requires_client_bundle).toBe(true);
    expect(mac.info_plist?.CFBundleURLTypes[0].CFBundleURLSchemes).toEqual(['dsh']);
  });
});
